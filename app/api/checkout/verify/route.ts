/**
 * GET /api/checkout/verify?tx_ref=xxx
 *
 * REPLACES the Korapay verify endpoint.
 *
 * Read-only status reporter for the post-payment verify page.
 *
 * IMPORTANT: this endpoint does NOT grant credits or update tier.
 * That's the WEBHOOK's job (see /api/webhooks/flutterwave/route.ts).
 * The webhook has 6 layers of defense and is the single source of truth.
 *
 * This endpoint just reports what the webhook has done so far:
 *   - 'verified'  → webhook confirmed payment, tier+credits granted
 *   - 'pending'   → user paid on Flutterwave, webhook hasn't arrived yet
 *   - 'failed'    → webhook marked it failed (or never arrived for a real payment)
 *   - 'not_found' → tx_ref doesn't match anything we created
 *
 * The frontend polls this every 2s for up to 30s, waiting for 'verified'.
 * If still 'pending' after 30s, the frontend tells the user to check their
 * dashboard in a few minutes — the webhook will eventually fire.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

interface VerifyResponse {
  status: 'verified' | 'pending' | 'failed' | 'not_found';
  tier?: string;
  amount?: number;
  currency?: string;
  creditsGranted?: number;
  newBalance?: number;
  billingInterval?: string;
  error?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse<VerifyResponse>> {
  try {
    // ─── Auth ───────────────────────────────────────────────────────────
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { status: 'failed', error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // ─── Read tx_ref from query string ──────────────────────────────────
    const txRef = req.nextUrl.searchParams.get('tx_ref');
    if (!txRef) {
      return NextResponse.json(
        { status: 'failed', error: 'tx_ref query parameter required' },
        { status: 400 }
      );
    }

    // ─── Look up the transaction ────────────────────────────────────────
    const supabase = getSupabaseAdmin();
    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('tx_ref', txRef)
      .eq('user_id', userId) // critical: a user can only verify their own transactions
      .maybeSingle();

    if (txErr) {
      console.error('[Verify] tx lookup error:', txErr);
      return NextResponse.json(
        { status: 'failed', error: 'Database error' },
        { status: 500 }
      );
    }

    if (!tx) {
      // Either tx_ref doesn't exist, or it belongs to a different user.
      // Don't leak which — both look the same to the client.
      return NextResponse.json({
        status: 'not_found',
        error: 'Transaction not found',
      });
    }

    // ─── Report status based on DB state ────────────────────────────────
    if (tx.status === 'verified') {
      // Webhook has confirmed and granted. Fetch current balance for display.
      const { data: profile } = await supabase
        .from('profiles')
        .select('credits_balance')
        .eq('user_id', userId)
        .single();

      return NextResponse.json({
        status: 'verified',
        tier: tx.tier,
        amount: parseFloat(String(tx.amount)),
        currency: tx.currency,
        creditsGranted: tx.credits_granted ?? 0,
        newBalance: profile?.credits_balance ?? 0,
        billingInterval: tx.billing_interval,
      });
    }

    if (tx.status === 'failed') {
      return NextResponse.json({
        status: 'failed',
        error: 'Payment verification failed. If you were charged, contact support.',
      });
    }

    // tx.status === 'pending' — payment in flight, webhook hasn't arrived
    return NextResponse.json({
      status: 'pending',
      tier: tx.tier,
      amount: parseFloat(String(tx.amount)),
      currency: tx.currency,
      billingInterval: tx.billing_interval,
    });
  } catch (error) {
    console.error('[Verify] Unexpected error:', error);
    return NextResponse.json(
      {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Server error',
      },
      { status: 500 }
    );
  }
}
