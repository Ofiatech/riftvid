import { getSupabaseAdmin } from './supabase-server';

export interface UserProfile {
  id: string;
  user_id: string;
  credits_balance: number;
  credits_lifetime_purchased: number;
  credits_lifetime_used: number;
  subscription_tier: 'free' | 'creator' | 'pro' | 'team';
  subscription_status: 'active' | 'inactive' | 'canceled' | 'past_due' | 'trialing';
  subscription_period_end: string | null;
  korapay_customer_id: string | null;
  korapay_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export const FREE_TIER_INITIAL_CREDITS = 5;

/**
 * Get user profile, creating with 5 free credits if first visit
 */
export async function getOrCreateProfile(userId: string): Promise<UserProfile> {
  const supabase = getSupabaseAdmin();

  // Try to fetch existing profile
  const { data: existing, error: fetchError } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (existing && !fetchError) {
    return existing as UserProfile;
  }

  // Create new profile with 5 free credits
  const { data: created, error: createError } = await supabase
    .from('profiles')
    .insert({
      user_id: userId,
      credits_balance: FREE_TIER_INITIAL_CREDITS,
      credits_lifetime_purchased: 0,
      credits_lifetime_used: 0,
      subscription_tier: 'free',
      subscription_status: 'inactive',
    })
    .select()
    .single();

  if (createError || !created) {
    // Race condition: maybe another request created it. Try fetching again.
    const { data: retry } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (retry) return retry as UserProfile;

    throw new Error(`Failed to create profile: ${createError?.message}`);
  }

  // Log the free credits as a transaction
  await supabase.from('transactions').insert({
    user_id: userId,
    type: 'free_credits',
    credits_delta: FREE_TIER_INITIAL_CREDITS,
    description: 'Welcome bonus: 5 free credits to get started',
    status: 'completed',
  });

  return created as UserProfile;
}

/**
 * Calculate credit cost for a video duration
 */
export function getCreditCost(duration: 5 | 10): number {
  return duration === 5 ? 1 : 2;
}

/**
 * Check if user has enough credits — does NOT deduct
 */
export async function hasEnoughCredits(userId: string, required: number): Promise<{
  hasEnough: boolean;
  balance: number;
  required: number;
}> {
  const profile = await getOrCreateProfile(userId);
  return {
    hasEnough: profile.credits_balance >= required,
    balance: profile.credits_balance,
    required,
  };
}

/**
 * Deduct credits atomically — used when video generation starts
 * Returns the new balance after deduction
 * Throws if insufficient credits
 */
export async function deductCredits(
  userId: string,
  amount: number,
  videoId: string,
  description?: string
): Promise<number> {
  const supabase = getSupabaseAdmin();

  // Fetch current balance
  const profile = await getOrCreateProfile(userId);

  if (profile.credits_balance < amount) {
    throw new Error(`Insufficient credits. Have ${profile.credits_balance}, need ${amount}.`);
  }

  const newBalance = profile.credits_balance - amount;
  const newLifetimeUsed = profile.credits_lifetime_used + amount;

  // Atomic update with optimistic concurrency check
  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      credits_balance: newBalance,
      credits_lifetime_used: newLifetimeUsed,
    })
    .eq('user_id', userId)
    .eq('credits_balance', profile.credits_balance); // optimistic lock

  if (updateError) {
    throw new Error(`Failed to deduct credits: ${updateError.message}`);
  }

  // Log transaction
  await supabase.from('transactions').insert({
    user_id: userId,
    type: 'credit_usage',
    credits_delta: -amount,
    description: description || `Video generation (${amount} credit${amount > 1 ? 's' : ''})`,
    related_video_id: videoId,
    status: 'completed',
  });

  return newBalance;
}

/**
 * Refund credits — used when video generation fails
 */
export async function refundCredits(
  userId: string,
  amount: number,
  videoId: string,
  reason?: string
): Promise<number> {
  const supabase = getSupabaseAdmin();

  const profile = await getOrCreateProfile(userId);
  const newBalance = profile.credits_balance + amount;
  const newLifetimeUsed = Math.max(0, profile.credits_lifetime_used - amount);

  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      credits_balance: newBalance,
      credits_lifetime_used: newLifetimeUsed,
    })
    .eq('user_id', userId);

  if (updateError) {
    throw new Error(`Failed to refund credits: ${updateError.message}`);
  }

  // Log refund transaction
  await supabase.from('transactions').insert({
    user_id: userId,
    type: 'refund',
    credits_delta: amount,
    description: reason || `Refund for failed video generation`,
    related_video_id: videoId,
    status: 'completed',
  });

  return newBalance;
}