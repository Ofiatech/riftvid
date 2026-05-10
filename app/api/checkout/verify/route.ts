import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { verifyTransaction } from '@/lib/korapay';
import { getOrCreateProfile } from '@/lib/credits';

export const maxDuration = 30;

// GET /api/checkout/verify?reference=xxx — verify a payment and add credits
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reference = req.nextUrl.searchParams.get('reference');
    if (!reference) {
      return NextResponse.json({ error: 'Reference required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Look up our transaction record
    const { data: transaction, error: fetchError } = await supabase
      .from('transactions')
      .select('*')
      .eq('korapay_reference', reference)
      .eq('user_id', userId)
      .single();

    if (fetchError || !transaction) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    // Idempotency: if already completed, return success without re-processing
    if (transaction.status === 'completed') {
      return NextResponse.json({
        status: 'already_completed',
        credits_added: transaction.credits_delta,
        message: 'Credits already applied to your account',
      });
    }

    // If already failed, return error
    if (transaction.status === 'failed') {
      return NextResponse.json(
        { status: 'failed', error: 'This payment was previously marked failed' },
        { status: 400 }
      );
    }

    // Verify with Korapay
    let korapayResult;
    try {
      korapayResult = await verifyTransaction(reference);
    } catch (verifyError) {
      console.error('Korapay verify error:', verifyError);
      return NextResponse.json(
        {
          error:
            verifyError instanceof Error
              ? verifyError.message
              : 'Failed to verify with Korapay',
        },
        { status: 500 }
      );
    }

    const korapayStatus = korapayResult.data.status;

    // Handle Korapay status
    if (korapayStatus === 'success') {
      // Get or create user profile
      const profile = await getOrCreateProfile(userId);
      const newBalance = profile.credits_balance + transaction.credits_delta;
      const newLifetimePurchased =
        profile.credits_lifetime_purchased + transaction.credits_delta;

      // Add credits to user balance
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          credits_balance: newBalance,
          credits_lifetime_purchased: newLifetimePurchased,
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Credit update error:', updateError);
        return NextResponse.json(
          { error: 'Failed to update credits' },
          { status: 500 }
        );
      }

      // Mark transaction completed
      await supabase
        .from('transactions')
        .update({
          status: 'completed',
          korapay_transaction_id: korapayResult.data.reference,
        })
        .eq('id', transaction.id);

      return NextResponse.json({
        status: 'success',
        credits_added: transaction.credits_delta,
        new_balance: newBalance,
        amount: korapayResult.data.amount,
        currency: korapayResult.data.currency,
      });
    }

    if (korapayStatus === 'processing') {
      return NextResponse.json({
        status: 'processing',
        message: 'Payment is still being processed. Please wait a moment and refresh.',
      });
    }

    // Failed or expired
    await supabase
      .from('transactions')
      .update({ status: 'failed' })
      .eq('id', transaction.id);

    return NextResponse.json(
      {
        status: 'failed',
        error: `Payment ${korapayStatus}`,
      },
      { status: 400 }
    );
  } catch (error) {
    console.error('Verify error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}
