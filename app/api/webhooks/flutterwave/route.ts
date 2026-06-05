/**
 * POST /api/webhooks/flutterwave
 *
 * Receives webhook calls from Flutterwave when payment status changes.
 *
 * This handler covers TWO scenarios:
 *
 *   A) INITIAL PAYMENT — user just paid via hosted checkout
 *      • tx_ref matches a pending row we created at checkout time
 *      • 6 defense layers, then grant tier + credits + period_end + customer_id
 *
 *   B) RECURRING RENEWAL — Flutterwave auto-charged a subscriber
 *      • tx_ref is FLW-generated, we've never seen it
 *      • Look up user via Flutterwave customer_id (stored on profile from initial)
 *      • Insert a new transaction row, extend period_end +30d, ADD credits on top
 *
 * SECURITY (initial path, 6 layers):
 *   1. Signature check       → reject if `verif-hash` ≠ our secret hash
 *   2. tx_ref lookup         → if not found, FALL THROUGH to renewal path
 *   3. Idempotency guard     → if already 'verified', return success
 *   4. Re-verify with FLW    → don't trust the payload; call FLW verify API
 *   5. Amount/currency check → must match what we recorded at checkout
 *   6. Conditional update    → only update if still 'pending' (race-safe)
 *
 * SECURITY (renewal path):
 *   1. Same signature check
 *   2. Re-verify with FLW for ground truth
 *   3. Look up user by stored Flutterwave customer_id
 *   4. Confirm tier match (don't grant Studio if profile says Creator)
 *   5. Insert new transaction with renewal's tx_ref (idempotent — unique constraint)
 *   6. Update profile (extend period, add credits)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  verifyWebhookSignature,
  verifyTransaction,
} from '@/lib/flutterwave';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

interface FlutterwaveWebhookEvent {
  event?: string;
  'event.type'?: string;
  data?: {
    id?: number;
    tx_ref?: string;
    flw_ref?: string;
    amount?: number;
    currency?: string;
    status?: string;
    customer?: { id?: number; email?: string; name?: string };
    meta?: Record<string, unknown>;
    payment_plan?: number | string | null;
  };
}

export async function POST(req: NextRequest) {
  try {
    // ─── LAYER 1: Signature verification ─────────────────────────────────
    const receivedHash = req.headers.get('verif-hash');
    if (!verifyWebhookSignature(receivedHash)) {
      console.warn('[FLW Webhook] Invalid signature, rejecting');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // ─── Parse payload ───────────────────────────────────────────────────
    let payload: FlutterwaveWebhookEvent;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const txRef = payload.data?.tx_ref;
    const flwTxId = payload.data?.id;
    const flwCustomerId = payload.data?.customer?.id;
    const customerEmail = payload.data?.customer?.email;
    const eventName = payload.event || payload['event.type'] || 'unknown';

    console.log('[FLW Webhook] Received:', {
      event: eventName,
      tx_ref: txRef,
      flw_tx_id: flwTxId,
      flw_customer_id: flwCustomerId,
      status: payload.data?.status,
      amount: payload.data?.amount,
      currency: payload.data?.currency,
    });

    if (!txRef || !flwTxId) {
      console.warn('[FLW Webhook] Missing tx_ref or tx_id in payload');
      return NextResponse.json({ received: true, ignored: 'malformed' });
    }

    // Only process successful events. Failed/abandoned payments don't need action.
    if (payload.data?.status !== 'successful') {
      console.log('[FLW Webhook] Non-successful status, no action:', payload.data?.status);
      return NextResponse.json({ received: true, status: payload.data?.status });
    }

    // ─── LAYER 2: Try to find the transaction by tx_ref ──────────────────
    const supabase = getSupabaseAdmin();
    const { data: tx, error: txLookupErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('tx_ref', txRef)
      .maybeSingle();

    if (txLookupErr) {
      console.error('[FLW Webhook] tx lookup error:', txLookupErr);
      return NextResponse.json({ error: 'DB error' }, { status: 500 });
    }

    // ═════════════════════════════════════════════════════════════════════
    // PATH A: INITIAL PAYMENT (we created this tx_ref at checkout)
    // ═════════════════════════════════════════════════════════════════════
    if (tx) {
      return await handleInitialPayment({
        tx,
        flwTxId,
        flwCustomerId,
        supabase,
      });
    }

    // ═════════════════════════════════════════════════════════════════════
    // PATH B: RECURRING RENEWAL (Flutterwave-generated tx_ref, never seen)
    // ═════════════════════════════════════════════════════════════════════
    console.log('[FLW Webhook] tx_ref not in DB — checking for renewal:', txRef);
    return await handleRenewal({
      txRef,
      flwTxId,
      flwCustomerId,
      customerEmail,
      payload,
      supabase,
    });
  } catch (error) {
    console.error('=== FLW WEBHOOK FATAL ===', error);
    // 500 so Flutterwave RETRIES — could be transient
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Server error',
      },
      { status: 500 }
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// INITIAL PAYMENT HANDLER (Path A)
// ───────────────────────────────────────────────────────────────────────────
async function handleInitialPayment({
  tx,
  flwTxId,
  flwCustomerId,
  supabase,
}: {
  tx: Record<string, unknown>;
  flwTxId: number;
  flwCustomerId: number | undefined;
  supabase: ReturnType<typeof getSupabaseAdmin>;
}) {
  const txRef = String(tx.tx_ref);
  const userId = String(tx.user_id);

  // ─── LAYER 3: Idempotency ─────────────────────────────────────────────
  if (tx.status === 'verified') {
    console.log('[FLW Webhook] Initial: already verified, idempotent:', txRef);
    return NextResponse.json({ received: true, already_verified: true });
  }
  if (tx.status === 'failed') {
    console.log('[FLW Webhook] Initial: previously failed, skip:', txRef);
    return NextResponse.json({ received: true, already_failed: true });
  }

  // ─── LAYER 4: Re-verify with Flutterwave ─────────────────────────────
  const verification = await verifyTransaction(flwTxId);
  if (!verification.verified) {
    console.warn('[FLW Webhook] Initial: verification failed:', { txRef, flwStatus: verification.status });
    await supabase
      .from('transactions')
      .update({
        status: 'failed',
        provider_tx_id: String(flwTxId),
        updated_at: new Date().toISOString(),
      })
      .eq('tx_ref', txRef);
    return NextResponse.json({ received: true, verified: false });
  }

  // ─── LAYER 5: Amount + currency cross-check ──────────────────────────
  const expectedAmount = parseFloat(String(tx.amount));
  const actualAmount = verification.amount;
  const amountsMatch = Math.abs(expectedAmount - actualAmount) < 0.01;
  const currenciesMatch =
    String(tx.currency).toUpperCase() === verification.currency.toUpperCase();

  if (!amountsMatch || !currenciesMatch) {
    console.error('[FLW Webhook] Initial: amount/currency mismatch — REFUSING:', {
      txRef,
      expected: { amount: expectedAmount, currency: tx.currency },
      actual: { amount: actualAmount, currency: verification.currency },
    });
    await supabase
      .from('transactions')
      .update({
        status: 'failed',
        provider_tx_id: String(flwTxId),
        updated_at: new Date().toISOString(),
      })
      .eq('tx_ref', txRef);
    return NextResponse.json({ received: true, error: 'amount_or_currency_mismatch' });
  }

  // ─── LAYER 6: Conditional update — grant the upgrade ─────────────────
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() + 30);
  const isSubscription = tx.billing_interval === 'monthly';

  const { error: txUpdateErr, count: txUpdated } = await supabase
    .from('transactions')
    .update(
      {
        status: 'verified',
        provider_tx_id: String(flwTxId),
        verified_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { count: 'exact' }
    )
    .eq('tx_ref', txRef)
    .eq('status', 'pending');

  if (txUpdateErr) {
    console.error('[FLW Webhook] Initial: tx update error:', txUpdateErr);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  if (txUpdated === 0) {
    console.log('[FLW Webhook] Initial: race won by concurrent webhook:', txRef);
    return NextResponse.json({ received: true, race_won_by_other: true });
  }

  // Update profile: tier + credits + period + customer_id (for future renewals)
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('credits_balance, credits_lifetime_purchased')
    .eq('user_id', userId)
    .single();

  const currentCredits = currentProfile?.credits_balance ?? 0;
  const currentLifetime = currentProfile?.credits_lifetime_purchased ?? 0;
  const creditsGranted = Number(tx.credits_granted ?? 0);

  const { error: profileErr } = await supabase
    .from('profiles')
    .update({
      subscription_tier: tx.tier,
      subscription_status: 'active',
      subscription_period_end: periodEnd.toISOString(),
      subscription_auto_renew: isSubscription,
      subscription_provider: 'flutterwave',
      // Store the Flutterwave customer_id for future renewal lookups
      subscription_customer_id: flwCustomerId ? String(flwCustomerId) : null,
      credits_balance: currentCredits + creditsGranted,
      credits_lifetime_purchased: currentLifetime + creditsGranted,
    })
    .eq('user_id', userId);

  if (profileErr) {
    console.error('[FLW Webhook] Initial: PROFILE UPDATE FAILED — MANUAL FIX NEEDED:', {
      txRef,
      userId,
      tier: tx.tier,
      creditsGranted,
      error: profileErr,
    });
    return NextResponse.json({ error: 'Profile update failed' }, { status: 500 });
  }

  console.log('[FLW Webhook] ✅ INITIAL SUCCESS:', {
    txRef,
    userId,
    tier: tx.tier,
    creditsGranted,
    newBalance: currentCredits + creditsGranted,
    periodEnd: periodEnd.toISOString(),
    isSubscription,
    flwCustomerId,
  });

  return NextResponse.json({ received: true, verified: true, path: 'initial', tier: tx.tier });
}

// ───────────────────────────────────────────────────────────────────────────
// RENEWAL HANDLER (Path B) — Flutterwave-generated tx_ref, look up by customer
// ───────────────────────────────────────────────────────────────────────────
async function handleRenewal({
  txRef,
  flwTxId,
  flwCustomerId,
  customerEmail,
  payload,
  supabase,
}: {
  txRef: string;
  flwTxId: number;
  flwCustomerId: number | undefined;
  customerEmail: string | undefined;
  payload: FlutterwaveWebhookEvent;
  supabase: ReturnType<typeof getSupabaseAdmin>;
}) {
  // Need at least one way to identify the user
  if (!flwCustomerId) {
    console.warn('[FLW Webhook] Renewal: no customer_id in payload, cannot map to user:', { txRef });
    return NextResponse.json({ received: true, ignored: 'no_customer_id' });
  }

  // Re-verify with Flutterwave first — don't trust payload alone
  const verification = await verifyTransaction(flwTxId);
  if (!verification.verified) {
    console.warn('[FLW Webhook] Renewal: verification failed:', { txRef, flwStatus: verification.status });
    return NextResponse.json({ received: true, verified: false });
  }

  // Look up user by stored Flutterwave customer_id
  const { data: profile, error: profileLookupErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('subscription_customer_id', String(flwCustomerId))
    .maybeSingle();

  if (profileLookupErr) {
    console.error('[FLW Webhook] Renewal: profile lookup error:', profileLookupErr);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!profile) {
    console.warn('[FLW Webhook] Renewal: no profile matches customer_id', {
      flwCustomerId,
      customerEmail,
      txRef,
    });
    // Return 200 — this isn't our user. Don't retry.
    return NextResponse.json({ received: true, ignored: 'unknown_customer' });
  }

  // Idempotency: if a transaction already exists with this tx_ref, the renewal
  // was already processed. The DB unique constraint on tx_ref would also
  // catch this, but checking explicitly gives us a cleaner success response.
  const { data: existingTx } = await supabase
    .from('transactions')
    .select('id, status')
    .eq('tx_ref', txRef)
    .maybeSingle();

  if (existingTx) {
    console.log('[FLW Webhook] Renewal: tx_ref already processed, idempotent:', txRef);
    return NextResponse.json({ received: true, already_processed: true });
  }

  // Determine tier + credits from the user's profile (NOT from payload — safer)
  const tier = profile.subscription_tier;

  // Look up credit allowance for this tier from our canonical pricing
  // (Avoid importing from flutterwave.ts to keep this file self-contained;
  // duplicate the small map here.)
  const TIER_CREDITS: Record<string, number> = {
    creator: 50,
    pro: 200,
    studio: 800,
    team: 800, // legacy alias
  };
  const creditsToGrant = TIER_CREDITS[tier] ?? 0;

  if (creditsToGrant === 0) {
    console.warn('[FLW Webhook] Renewal: tier has no credit grant, skipping:', { tier, txRef });
    return NextResponse.json({ received: true, ignored: 'no_credits_for_tier' });
  }

  // Insert renewal transaction row. The unique constraint on tx_ref makes
  // this idempotent even if two webhook deliveries race.
  const now = new Date();
  const { error: txInsertErr } = await supabase.from('transactions').insert({
    user_id: profile.user_id,
    type: 'subscription_renewal',
    tier,
    amount: verification.amount,
    currency: verification.currency,
    status: 'verified',
    provider: 'flutterwave',
    provider_tx_id: String(flwTxId),
    tx_ref: txRef,
    billing_interval: 'monthly',
    credits_granted: creditsToGrant,
    verified_at: now.toISOString(),
  });

  if (txInsertErr) {
    // Could be the unique-constraint race — another delivery beat us to it
    if (
      typeof txInsertErr.message === 'string' &&
      txInsertErr.message.toLowerCase().includes('duplicate')
    ) {
      console.log('[FLW Webhook] Renewal: duplicate tx_ref (race), idempotent:', txRef);
      return NextResponse.json({ received: true, already_processed: true });
    }
    console.error('[FLW Webhook] Renewal: tx insert error:', txInsertErr);
    return NextResponse.json({ error: 'DB insert failed' }, { status: 500 });
  }

  // Extend the subscription period and add credits (rollover model — never replace)
  const currentEnd = profile.subscription_period_end
    ? new Date(profile.subscription_period_end)
    : now;
  // If they renewed before expiry, extend from current end. Otherwise from now.
  const newPeriodEnd = currentEnd > now ? new Date(currentEnd) : new Date(now);
  newPeriodEnd.setDate(newPeriodEnd.getDate() + 30);

  const newBalance = (profile.credits_balance ?? 0) + creditsToGrant;
  const newLifetime = (profile.credits_lifetime_purchased ?? 0) + creditsToGrant;

  const { error: profileUpdateErr } = await supabase
    .from('profiles')
    .update({
      subscription_status: 'active',
      subscription_period_end: newPeriodEnd.toISOString(),
      subscription_auto_renew: true,
      credits_balance: newBalance,
      credits_lifetime_purchased: newLifetime,
    })
    .eq('user_id', profile.user_id);

  if (profileUpdateErr) {
    console.error('[FLW Webhook] Renewal: PROFILE UPDATE FAILED — MANUAL FIX NEEDED:', {
      txRef,
      userId: profile.user_id,
      tier,
      creditsToGrant,
      error: profileUpdateErr,
    });
    return NextResponse.json({ error: 'Profile update failed' }, { status: 500 });
  }

  console.log('[FLW Webhook] ✅ RENEWAL SUCCESS:', {
    txRef,
    userId: profile.user_id,
    tier,
    creditsGranted: creditsToGrant,
    newBalance,
    newPeriodEnd: newPeriodEnd.toISOString(),
    flwCustomerId,
  });

  return NextResponse.json({ received: true, verified: true, path: 'renewal', tier });
}