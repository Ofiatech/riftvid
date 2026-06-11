// app/api/avatars/generate/route.ts
// POST /api/avatars/generate
//
// Body: { prompt: string, draftSessionId: string }
//
// Returns:
//   200 { falImageUrl, attemptNumber, creditCharged, freeAttemptsRemaining, creditsBalance }
//   400 invalid input
//   401 unauthorized
//   402 out of credits (when paid attempt and balance < 1)
//   500 fal/server error
//
// Pricing model (LOCKED, Session 11C-4):
//   - Attempts 1-3 per draft session: FREE
//   - Attempts 4+: 1 credit per attempt, deducted atomically BEFORE the Fal call
//   - On Fal failure: credit is refunded automatically

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { fal } from '@fal-ai/client';
import { getOrCreateProfile } from '@/lib/credits';
import { getAvatarsSupabaseClient } from '@/lib/avatars';

export const maxDuration = 60;

// ============================================================================
// CONSTANTS
// ============================================================================

const FAL_MODEL = 'fal-ai/flux/dev';
const FAL_IMAGE_SIZE = 'portrait_4_3'; // matches our 4:5 avatar card aesthetic

const FREE_ATTEMPT_LIMIT = 3;          // first 3 attempts per draft session = free
const CREDIT_COST_PER_PAID = 1;        // 1 credit per attempt after the free 3

const PROMPT_MIN = 5;
const PROMPT_MAX = 2000;

// ============================================================================
// TYPES
// ============================================================================

interface GenerateRequestBody {
  prompt: string;
  draftSessionId: string;
}

interface FalFluxResponse {
  data?: {
    images?: Array<{ url: string; width?: number; height?: number }>;
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Atomically decrement user's credits by `amount`.
 * Returns the new balance, or null if insufficient credits.
 */
async function deductCredits(
  supabase: ReturnType<typeof getAvatarsSupabaseClient>,
  userId: string,
  amount: number
): Promise<number | null> {
  // Fetch current balance
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('credits_balance, credits_lifetime_used')
    .eq('user_id', userId)
    .single();

  if (fetchError || !profile) {
    console.error('deductCredits: profile fetch error', fetchError);
    return null;
  }

  const profileTyped = profile as { credits_balance: number; credits_lifetime_used: number };
  const currentBalance = profileTyped.credits_balance ?? 0;

  if (currentBalance < amount) return null;

  // Optimistic concurrency: only decrement if balance still matches
  const newBalance = currentBalance - amount;
  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({
      credits_balance: newBalance,
      credits_lifetime_used: (profileTyped.credits_lifetime_used ?? 0) + amount,
    })
    .eq('user_id', userId)
    .eq('credits_balance', currentBalance) // race-safety
    .select('credits_balance')
    .single();

  if (updateError || !updated) {
    console.error('deductCredits: update race/error', updateError);
    return null;
  }

  return (updated as { credits_balance: number }).credits_balance;
}

/**
 * Refund credits to a user — used when a paid generation fails.
 */
async function refundCredits(
  supabase: ReturnType<typeof getAvatarsSupabaseClient>,
  userId: string,
  amount: number
): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('credits_balance, credits_lifetime_used')
      .eq('user_id', userId)
      .single();

    if (!profile) return;

    const profileTyped = profile as { credits_balance: number; credits_lifetime_used: number };
    await supabase
      .from('profiles')
      .update({
        credits_balance: (profileTyped.credits_balance ?? 0) + amount,
        credits_lifetime_used: Math.max(0, (profileTyped.credits_lifetime_used ?? 0) - amount),
      })
      .eq('user_id', userId);
  } catch (err) {
    console.error('refundCredits failed:', err);
  }
}

// ============================================================================
// POST HANDLER
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    // --- Auth ---
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // --- Fal credentials check ---
    if (!process.env.FAL_KEY) {
      console.error('FAL_KEY not configured');
      return NextResponse.json(
        { error: 'AI generation not configured. Contact support.' },
        { status: 500 }
      );
    }

    // --- Parse body ---
    let body: GenerateRequestBody;
    try {
      body = (await req.json()) as GenerateRequestBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const prompt = (body.prompt ?? '').trim();
    const draftSessionId = (body.draftSessionId ?? '').trim();

    if (!prompt || prompt.length < PROMPT_MIN) {
      return NextResponse.json(
        { error: `Prompt must be at least ${PROMPT_MIN} characters` },
        { status: 400 }
      );
    }
    if (prompt.length > PROMPT_MAX) {
      return NextResponse.json(
        { error: `Prompt too long (max ${PROMPT_MAX} characters)` },
        { status: 400 }
      );
    }
    if (!draftSessionId || draftSessionId.length < 8) {
      return NextResponse.json(
        { error: 'draftSessionId required' },
        { status: 400 }
      );
    }

    const supabase = getAvatarsSupabaseClient();

    // Ensure profile exists (so credits_balance is initialized)
    await getOrCreateProfile(userId);

    // --- Count existing attempts in this draft session ---
    const { count: existingAttempts, error: countError } = await supabase
      .from('avatar_generation_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('draft_session_id', draftSessionId);

    if (countError) {
      console.error('attempt count error:', countError);
      return NextResponse.json(
        { error: 'Failed to check generation attempts' },
        { status: 500 }
      );
    }

    const attemptNumber = (existingAttempts ?? 0) + 1; // 1-indexed
    const isPaidAttempt = attemptNumber > FREE_ATTEMPT_LIMIT;

    // --- Charge credit upfront if this is a paid attempt ---
    let creditsBalanceAfter: number | null = null;
    if (isPaidAttempt) {
      creditsBalanceAfter = await deductCredits(supabase, userId, CREDIT_COST_PER_PAID);
      if (creditsBalanceAfter === null) {
        return NextResponse.json(
          {
            error: 'out_of_credits',
            message: `You're out of credits. Each generation after the first 3 in a session costs ${CREDIT_COST_PER_PAID} credit.`,
            attemptNumber,
            requiredCredits: CREDIT_COST_PER_PAID,
          },
          { status: 402 }
        );
      }
    } else {
      // Free attempt — fetch current balance for response
      const { data: profile } = await supabase
        .from('profiles')
        .select('credits_balance')
        .eq('user_id', userId)
        .single();
      creditsBalanceAfter =
        (profile as { credits_balance: number } | null)?.credits_balance ?? 0;
    }

    // --- Call Fal Flux Dev ---
    let falImageUrl: string | null = null;
    let falError: string | null = null;

    try {
      // Configure fal client (idempotent)
      fal.config({ credentials: process.env.FAL_KEY });

      const result = (await fal.subscribe(FAL_MODEL, {
        input: {
          prompt,
          image_size: FAL_IMAGE_SIZE,
          // Optional Flux Dev defaults — leaving num_inference_steps at 28 (default)
          // and guidance_scale at default (3.5) for now. Tunable in v2.
        },
        logs: false,
      })) as FalFluxResponse;

      const url = result?.data?.images?.[0]?.url;
      if (!url) {
        throw new Error('Fal returned no image URL');
      }
      falImageUrl = url;
    } catch (err) {
      falError =
        err instanceof Error
          ? err.message
          : 'Image generation failed. Please try again.';
      console.error('Fal Flux error:', falError);
    }

    // --- Handle Fal failure: refund credit if charged, log failed attempt ---
    if (!falImageUrl) {
      if (isPaidAttempt) {
        await refundCredits(supabase, userId, CREDIT_COST_PER_PAID);
        // Fetch fresh balance for response
        const { data: refunded } = await supabase
          .from('profiles')
          .select('credits_balance')
          .eq('user_id', userId)
          .single();
        creditsBalanceAfter =
          (refunded as { credits_balance: number } | null)?.credits_balance ?? 0;
      }

      // Log the failure
      await supabase.from('avatar_generation_attempts').insert({
        user_id: userId,
        draft_session_id: draftSessionId,
        attempt_number: attemptNumber,
        prompt,
        fal_image_url: null,
        credit_charged: false, // refunded if charged
        status: 'failed',
        error_message: falError,
      });

      return NextResponse.json(
        {
          error: 'generation_failed',
          message: falError || 'Image generation failed',
          attemptNumber,
          creditsBalance: creditsBalanceAfter,
          refunded: isPaidAttempt,
        },
        { status: 500 }
      );
    }

    // --- Success: log the attempt ---
    await supabase.from('avatar_generation_attempts').insert({
      user_id: userId,
      draft_session_id: draftSessionId,
      attempt_number: attemptNumber,
      prompt,
      fal_image_url: falImageUrl,
      credit_charged: isPaidAttempt,
      status: 'completed',
    });

    const freeAttemptsRemaining = Math.max(0, FREE_ATTEMPT_LIMIT - attemptNumber);

    return NextResponse.json({
      falImageUrl,
      attemptNumber,
      creditCharged: isPaidAttempt,
      freeAttemptsRemaining,
      creditsBalance: creditsBalanceAfter,
      nextAttemptCostsCredit: attemptNumber + 1 > FREE_ATTEMPT_LIMIT,
    });
  } catch (err) {
    console.error('/api/avatars/generate error:', err);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}