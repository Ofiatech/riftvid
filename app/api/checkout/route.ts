import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { initializeCharge, generateReference } from '@/lib/korapay';
import { getPackById, getCurrencyForCountry, getPriceForKorapay, formatPrice } from '@/lib/pricing';

export const maxDuration = 30;

// POST /api/checkout — initialize payment for a credit pack
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await currentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress;
    const name = user?.fullName || user?.firstName || user?.username || 'Riftvid User';

    if (!email) {
      return NextResponse.json({ error: 'Email required for payment' }, { status: 400 });
    }

    const body = await req.json();
    const { packId } = body as { packId: string };

    if (!packId) {
      return NextResponse.json({ error: 'Pack ID required' }, { status: 400 });
    }

    // Verify pack exists in our config (don't trust client)
    const pack = getPackById(packId);
    if (!pack) {
      return NextResponse.json({ error: 'Invalid pack' }, { status: 400 });
    }

    // Detect user country from Vercel geo headers
    // Falls back to USD for non-Nigerian users
    const countryCode = req.headers.get('x-vercel-ip-country') || null;
    const currency = getCurrencyForCountry(countryCode);
    const amount = getPriceForKorapay(pack, currency);

    // Generate unique reference
    const reference = generateReference('riftvid');

    // Get the host for redirect URL
    const origin = req.headers.get('origin') || `https://${req.headers.get('host')}`;
    const redirectUrl = `${origin}/checkout/verify?reference=${reference}`;

    // Build Korapay request
    const supabase = getSupabaseAdmin();

    // Create a pending transaction record FIRST (so we can match webhook later)
    const { error: insertError } = await supabase.from('transactions').insert({
      user_id: userId,
      type: 'credit_purchase',
      amount_cents: currency === 'USD' ? pack.price_usd_cents : Math.round(pack.price_ngn_kobo / 14), // convert kobo to USD cents for analytics
      currency: currency.toLowerCase(),
      credits_delta: pack.credits,
      korapay_reference: reference,
      description: `${pack.name} pack: ${pack.credits} credits (${formatPrice(pack, currency)})`,
      status: 'pending',
    });

    if (insertError) {
      console.error('Failed to create pending transaction:', insertError);
      return NextResponse.json(
        { error: 'Failed to initialize payment record' },
        { status: 500 }
      );
    }

    // Initialize Korapay charge
    let checkoutData;
    try {
      checkoutData = await initializeCharge({
        amount,
        currency,
        reference,
        customer: {
          name,
          email,
        },
        redirect_url: redirectUrl,
        narration: `Riftvid: ${pack.credits} credits (${pack.name} pack)`,
        metadata: {
          user_id: userId,
          pack_id: packId,
          credits: pack.credits,
        },
      });
    } catch (korapayError) {
      // Mark transaction as failed
      await supabase
        .from('transactions')
        .update({ status: 'failed' })
        .eq('korapay_reference', reference);

      console.error('Korapay initialize error:', korapayError);
      return NextResponse.json(
        {
          error:
            korapayError instanceof Error
              ? korapayError.message
              : 'Payment initialization failed',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      checkout_url: checkoutData.data.checkout_url,
      reference,
      amount,
      currency,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}

// GET /api/checkout — for frontend to detect user's currency before showing modal
export async function GET(req: NextRequest) {
  try {
    const countryCode = req.headers.get('x-vercel-ip-country') || null;
    const currency = getCurrencyForCountry(countryCode);

    return NextResponse.json({
      country: countryCode,
      currency,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}
