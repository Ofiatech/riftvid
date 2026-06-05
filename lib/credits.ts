import { getSupabaseAdmin } from './supabase-server';

/**
 * User profile shape.
 *
 * NOTE: subscription_tier was renamed from 'team' to 'studio' (May 2026)
 * to match ROADMAP.md. We keep 'team' in the union as a deprecated value
 * for any historical DB rows; new code should write 'studio'.
 *
 * subscription_status now includes 'expired' for one-time tiers whose
 * 30-day period has ended.
 */
export interface UserProfile {
  id: string;
  user_id: string;
  credits_balance: number;
  credits_lifetime_purchased: number;
  credits_lifetime_used: number;
  subscription_tier: 'free' | 'creator' | 'pro' | 'studio' | 'team'; // 'team' deprecated
  subscription_status:
    | 'active'
    | 'inactive'
    | 'canceled'
    | 'past_due'
    | 'trialing'
    | 'expired';
  subscription_period_end: string | null;
  subscription_auto_renew?: boolean | null;
  subscription_provider?: string | null;
  subscription_customer_id?: string | null;
  subscription_payment_plan_id?: string | null;
  // Legacy Korapay fields — kept for backwards compat, unused by new code
  korapay_customer_id?: string | null;
  korapay_subscription_id?: string | null;
  created_at: string;
  updated_at: string;
}

export const FREE_TIER_INITIAL_CREDITS = 5;

/**
 * Monthly credit allowance per tier (matches lib/flutterwave.ts PRICING table).
 * This is what each tier GRANTS when the user subscribes/renews — NOT a hard cap.
 * Users can exceed this via credit pack top-ups. Credits roll over forever.
 */
export const TIER_MONTHLY_CREDITS: Record<UserProfile['subscription_tier'], number> = {
  free: 0, // free users get FREE_TIER_INITIAL_CREDITS once at signup; no monthly refill
  creator: 50,
  pro: 200,
  studio: 800,
  team: 800, // legacy alias for studio
};

/**
 * Human-readable tier labels.
 */
export const TIER_LABELS: Record<UserProfile['subscription_tier'], string> = {
  free: 'Free',
  creator: 'Creator',
  pro: 'Pro',
  studio: 'Studio',
  team: 'Studio', // legacy alias
};

/**
 * Get user profile, creating with 5 free credits if first visit.
 * Also runs a just-in-time tier-expiry check — if a one-time tier purchase's
 * 30 days have elapsed, drops the user to Free tier (credits untouched).
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
    // JIT tier expiry — only relevant for non-renewing tiers past their period
    return await maybeExpireOneTimeTier(existing as UserProfile);
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
 * If a user's one-time tier purchase has expired (period_end passed,
 * auto_renew=false), drop them back to Free. Credits stay forever.
 *
 * Runs every time we load a profile — cheap, no DB write unless actually expired.
 * The `.eq('subscription_status', 'active')` guard makes this race-safe:
 * if another request already expired the tier, the UPDATE touches 0 rows.
 */
async function maybeExpireOneTimeTier(profile: UserProfile): Promise<UserProfile> {
  // Quick exits — most calls hit one of these and skip the date check
  if (profile.subscription_tier === 'free') return profile;
  if (profile.subscription_status !== 'active') return profile;
  if (profile.subscription_auto_renew === true) return profile; // subscription auto-renews, leave alone
  if (!profile.subscription_period_end) return profile;

  const periodEnd = new Date(profile.subscription_period_end);
  if (periodEnd > new Date()) return profile; // not yet expired

  // Expired one-time tier — downgrade to Free.
  // Credits, lifetime stats, customer_id all stay untouched.
  const supabase = getSupabaseAdmin();
  const { data: updated } = await supabase
    .from('profiles')
    .update({
      subscription_tier: 'free',
      subscription_status: 'expired',
    })
    .eq('user_id', profile.user_id)
    .eq('subscription_status', 'active') // race-safe guard
    .select()
    .single();

  return (updated as UserProfile) || { ...profile, subscription_tier: 'free', subscription_status: 'expired' };
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
