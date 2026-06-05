/**
 * POST /api/checkout
 *
 * REPLACES the previous Korapay credit-pack checkout.
 * Initiates a Flutterwave payment for tier upgrade.
 *
 * Flow:
 *   1. Authenticate the user via Clerk
 *   2. Validate { tier, currency, billing } against allowed values
 *   3. Look up the user's email/name from Clerk
 *   4. Insert a `pending` row in `transactions` with a unique tx_ref
 *   5. Call Flutterwave to initiate the payment (returns hosted checkout URL)
 *   6. Return the URL to the frontend, which redirects the user there
 *
 * SECURITY:
 *   - Pricing is resolved SERVER-SIDE from lib/flutterwave.ts.
 *     Frontend never sends an amount.
 *   - tx_ref is generated server-side — no way to reuse/guess valid refs.
 *
 * NOTE: This handles INITIAL payments (first time a user subscribes/upgrades).
 * Recurring renewal charges DO NOT pass through this endpoint — Flutterwave
 * auto-charges and fires the webhook directly. See app/api/webhooks/flutterwave/.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  buildTxRef,
  getPricing,
  initiatePayment,
  type Tier,
  type Currency,
  type BillingInterval,
} from '@/lib/flutterwave';

export const maxDuration = 30;

const VALID_TIERS: Tier[] = ['creator', 'pro', 'studio'];
const VALID_CURRENCIES: Currency[] = ['USD', 'NGN'];
const VALID_BILLING: BillingInterval[] = ['one_time', 'monthly'];

interface CheckoutBody {
  tier?: unknown;
  currency?: unknown;
  billing?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    // ─── STEP 1: Auth ─────────────────────────────────────────────────────
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ─── STEP 2: Validate inputs ──────────────────────────────────────────
    const body = (await req.json().catch(() => ({}))) as CheckoutBody;
    const tier = body.tier as Tier;
    const currency = body.currency as Currency;
    const billing = body.billing as BillingInterval;

    if (!VALID_TIERS.includes(tier)) {
      return NextResponse.json(
        { error: `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}` },
        { status: 400 }
      );
    }
    if (!VALID_CURRENCIES.includes(currency)) {
      return NextResponse.json(
        { error: `Invalid currency. Must be one of: ${VALID_CURRENCIES.join(', ')}` },
        { status: 400 }
      );
    }
    if (!VALID_BILLING.includes(billing)) {
      return NextResponse.json(
        { error: `Invalid billing. Must be one of: ${VALID_BILLING.join(', ')}` },
        { status: 400 }
      );
    }

    // ─── STEP 3: Fetch user details from Clerk ────────────────────────────
    let email: string | undefined;
    let fullName = 'Riftvid User';
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      email = user.emailAddresses[0]?.emailAddress;
      const nameParts = [user.firstName, user.lastName].filter(Boolean);
      if (nameParts.length > 0) {
        fullName = nameParts.join(' ').trim();
      } else if (user.username) {
        fullName = user.username;
      }
    } catch (err) {
      console.error('[Checkout] Could not load Clerk user:', err);
      return NextResponse.json(
        { error: 'Could not load your account details. Please try again.' },
        { status: 500 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { error: 'No email on file. Please update your account before paying.' },
        { status: 400 }
      );
    }

    // ─── STEP 4: Resolve pricing SERVER-SIDE and build tx_ref ─────────────
    const pricing = getPricing(tier, currency);
    const txRef = buildTxRef(userId);

    // ─── STEP 5: Insert pending transaction row ───────────────────────────
    const supabase = getSupabaseAdmin();
    const { error: insertErr } = await supabase.from('transactions').insert({
      user_id: userId,
      type: billing === 'monthly' ? 'subscription' : 'one_time',
      tier,
      amount: pricing.amount,
      currency,
      status: 'pending',
      provider: 'flutterwave',
      tx_ref: txRef,
      billing_interval: billing,
      credits_granted: pricing.credits,
    });

    if (insertErr) {
      console.error('[Checkout] Transaction insert error:', insertErr);
      return NextResponse.json(
        { error: 'Could not start checkout. Please try again.' },
        { status: 500 }
      );
    }

    // ─── STEP 6: Build redirect URL and initiate Flutterwave payment ──────
    // NEXT_PUBLIC_APP_URL makes the eventual domain migration to riftvid.ai
    // a one-env-var change instead of code changes.
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || 'https://riftvid.vercel.app';
    const redirectUrl = `${baseUrl}/checkout/verify?tx_ref=${encodeURIComponent(txRef)}`;

    let paymentLink: string;
    try {
      const result = await initiatePayment({
        userId,
        email,
        fullName,
        tier,
        currency,
        billing,
        txRef,
        redirectUrl,
      });
      paymentLink = result.paymentLink;
    } catch (err) {
      console.error('[Checkout] Flutterwave initiation failed:', err);
      // Mark the pending tx as failed so it doesn't sit forever
      await supabase
        .from('transactions')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('tx_ref', txRef);
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : 'Payment initiation failed. Please try again.',
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      paymentLink,
      txRef,
      amount: pricing.amount,
      currency,
      tier,
      billing,
    });
  } catch (error) {
    console.error('=== CHECKOUT ERROR ===', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Server error',
      },
      { status: 500 }
    );
  }
}