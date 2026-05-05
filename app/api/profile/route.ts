import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getOrCreateProfile } from '@/lib/credits';

export const maxDuration = 10;

// GET /api/profile — get current user's profile (auto-creates if first visit)
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await getOrCreateProfile(userId);

    return NextResponse.json({
      credits_balance: profile.credits_balance,
      credits_lifetime_purchased: profile.credits_lifetime_purchased,
      credits_lifetime_used: profile.credits_lifetime_used,
      subscription_tier: profile.subscription_tier,
      subscription_status: profile.subscription_status,
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}