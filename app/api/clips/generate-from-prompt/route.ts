// app/api/clips/generate-from-prompt/route.ts
//
// POST /api/clips/generate-from-prompt
//
// Body:
//   {
//     sceneId: string (uuid),
//     projectId: string (uuid),
//     prompt: string (5-2000),
//     duration: 5 | 10
//   }
//
// Behavior:
//   1. Auth + ownership check on the scene
//   2. Detect known avatar names mentioned in the prompt (word-boundary match)
//   3. Pricing: read live cost from pricing_config table (admin-tunable)
//   4. Pre-flight credit check (fail fast if user can't afford this + the eventual video gen)
//   5. Branch on (avatars detected) × (scene has anchor):
//        avatars + no anchor   → Nano Banana Pro Edit (avatar photos as image_urls)
//                                → save result as scene anchor
//        avatars + has anchor  → Nano Banana Pro Edit (anchor + avatar photos)
//                                → "preserve scene" prompt suffix locks background/outfits
//        no avatars            → Flux Dev plain text-to-image (cheap, no anchor)
//   6. Rehost result image to Supabase storage (Fal URLs expire)
//   7. Insert clip row with source_type='ai_generated_scene' or 'ai_generated_flux'
//   8. Return clip + detected avatars + meta
//
// The frontend then calls /api/generate-video with the clip's id to kick off
// the actual video render. This endpoint DOES NOT deduct base video credits
// (/api/generate-video does). It DOES deduct the EXTRA premium credits for
// AI-scene generation.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { fal } from '@fal-ai/client';
import { getOrCreateProfile } from '@/lib/credits';
import { getAvatarsSupabaseClient, AvatarRecord, AvatarPhoto } from '@/lib/avatars';

export const maxDuration = 180; // Nano Banana Pro can take 15-45s

// ============================================================================
// CONSTANTS
// ============================================================================

const PROMPT_MIN = 5;
const PROMPT_MAX = 2000;

const MODEL_NANO_BANANA_EDIT = 'fal-ai/nano-banana-pro/edit';
const MODEL_FLUX_DEV = 'fal-ai/flux/dev';
const FLUX_IMAGE_SIZE = 'landscape_16_9'; // cinematic default for video clips

// Pricing fallbacks if pricing_config lookup somehow fails
const FALLBACK_PRICING: Record<string, number> = {
  clip_normal_5s: 1,
  clip_normal_10s: 2,
  clip_ai_scene_5s: 3,
  clip_ai_scene_10s: 5,
  clip_flux_fallback_5s: 1,
  clip_flux_fallback_10s: 2,
};

// ============================================================================
// TYPES
// ============================================================================

interface GenerateFromPromptBody {
  sceneId: string;
  projectId: string;
  prompt: string;
  duration: 5 | 10;
}

interface DetectedAvatar {
  id: string;
  name: string;
  description: string | null;
  primary_photo_url: string;
}

interface SceneRecord {
  id: string;
  project_id: string;
  user_id: string;
  anchor_image_url: string | null;
}

interface ClipRecord {
  id: string;
  scene_id: string;
  project_id: string;
  user_id: string;
  clip_order: number;
  source_image_url: string;
  source_type: string;
  refined_prompt: string;
  duration: number;
  status: string;
}

interface FalImageResult {
  data?: {
    images?: Array<{ url: string; width?: number; height?: number }>;
  };
}

// ============================================================================
// PRICING LOOKUP — reads from pricing_config table at runtime
// ============================================================================

async function getPricingCost(
  supabase: ReturnType<typeof getAvatarsSupabaseClient>,
  key: string
): Promise<number> {
  const { data, error } = await supabase
    .from('pricing_config')
    .select('value')
    .eq('key', key)
    .single();

  if (error || !data) {
    console.warn(`pricing_config lookup failed for '${key}', using fallback`);
    return FALLBACK_PRICING[key] ?? 0;
  }
  return (data as { value: number }).value;
}

// ============================================================================
// AVATAR DETECTION
// ============================================================================

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectAvatarsInPrompt(
  prompt: string,
  avatars: AvatarRecord[]
): DetectedAvatar[] {
  const matches: Array<{ avatar: AvatarRecord; firstIndex: number }> = [];

  for (const avatar of avatars) {
    if (!avatar.name) continue;
    const safe = escapeRegex(avatar.name.trim());
    if (!safe) continue;

    const regex = new RegExp(`\\b${safe}\\b`, 'i');
    const match = prompt.match(regex);
    if (match && match.index !== undefined) {
      matches.push({ avatar, firstIndex: match.index });
    }
  }

  // Sort by first occurrence so the primary character (mentioned first) is
  // the first reference image — Nano Banana respects ordering for anchoring.
  matches.sort((a, b) => a.firstIndex - b.firstIndex);

  return matches.map(({ avatar }) => {
    const photos: AvatarPhoto[] = Array.isArray(avatar.photo_urls)
      ? (avatar.photo_urls as AvatarPhoto[])
      : [];
    const sorted = [...photos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const primary = sorted[0]?.url ?? '';

    return {
      id: avatar.id,
      name: avatar.name,
      description: avatar.description,
      primary_photo_url: primary,
    };
  });
}

// ============================================================================
// PROMPT CONSTRUCTION
// ============================================================================

/**
 * For the FIRST clip in a scene (no anchor yet) — establish the scene.
 * Append directives that help Nano Banana use the avatar reference photos
 * consistently across all detected characters.
 */
function buildAnchorPrompt(userPrompt: string, detected: DetectedAvatar[]): string {
  const namesList = detected.map((a) => a.name).join(' and ');
  const descriptions = detected
    .filter((a) => a.description && a.description.trim().length > 0)
    .map((a) => `${a.name}: ${a.description!.trim()}`);

  const characterDirective =
    detected.length === 1
      ? `Use the reference image for ${detected[0].name}'s face, hair, and overall appearance.`
      : `The characters are ${namesList}. Use the reference images to keep each character's face, hair, and appearance consistent.`;

  const descBlock =
    descriptions.length > 0
      ? ` Additional character details — ${descriptions.join('; ')}.`
      : '';

  return `${userPrompt}\n\n${characterDirective}${descBlock}\n\nRender as a cinematic wide shot, photorealistic, natural lighting.`;
}

/**
 * For SUBSEQUENT clips in the same scene (anchor exists) — preserve scene.
 * This is where Nano Banana's strength comes in: explicit "keep X, change Y"
 * prompting tells the model what to lock from the reference anchor image.
 */
function buildEditPrompt(userPrompt: string, detected: DetectedAvatar[]): string {
  const namesList = detected.map((a) => a.name).join(' and ');

  return `${userPrompt}\n\nKeep the background, lighting, camera angle, and overall composition identical to the reference image. Preserve ${namesList}'s facial features, hairstyle, and clothing exactly as shown in the reference image. Only change the action, pose, or expression as described above. Do not change the setting, time of day, or wardrobe.`;
}

// ============================================================================
// IMAGE REHOSTING — Fal URLs expire, so we mirror to Supabase storage
// ============================================================================

function inferImageExt(contentType: string, url: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  const urlExt = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
  if (urlExt === 'jpg' || urlExt === 'jpeg') return 'jpg';
  if (urlExt === 'png') return 'png';
  if (urlExt === 'webp') return 'webp';
  return 'jpg';
}

async function rehostImageToSupabase(
  supabase: ReturnType<typeof getAvatarsSupabaseClient>,
  externalUrl: string,
  userId: string,
  sceneId: string,
  filenameSuffix: string
): Promise<string> {
  const res = await fetch(externalUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch generated image (status ${res.status})`);
  }
  const contentType = res.headers.get('content-type')?.split(';')[0].trim() || '';
  const ext = inferImageExt(contentType, externalUrl);
  const mimeType =
    ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const path = `scenes/${userId}/${sceneId}/${filenameSuffix}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, buffer, { contentType: mimeType, upsert: true });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  return pub.publicUrl;
}

// ============================================================================
// CREDIT DEDUCTION — for the premium AI-scene portion only
// (/api/generate-video deducts the BASE clip credits later when video runs)
// ============================================================================

async function deductExtraCredits(
  supabase: ReturnType<typeof getAvatarsSupabaseClient>,
  userId: string,
  amount: number
): Promise<number | null> {
  if (amount <= 0) return null; // no-op

  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('credits_balance, credits_lifetime_used')
    .eq('user_id', userId)
    .single();

  if (fetchError || !profile) return null;

  const p = profile as { credits_balance: number; credits_lifetime_used: number };
  const current = p.credits_balance ?? 0;
  if (current < amount) return null;

  // Optimistic concurrency: only decrement if balance still matches
  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({
      credits_balance: current - amount,
      credits_lifetime_used: (p.credits_lifetime_used ?? 0) + amount,
    })
    .eq('user_id', userId)
    .eq('credits_balance', current)
    .select('credits_balance')
    .single();

  if (updateError || !updated) return null;
  return (updated as { credits_balance: number }).credits_balance;
}

async function refundCredits(
  supabase: ReturnType<typeof getAvatarsSupabaseClient>,
  userId: string,
  amount: number
): Promise<void> {
  if (amount <= 0) return;
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('credits_balance, credits_lifetime_used')
      .eq('user_id', userId)
      .single();
    if (!profile) return;
    const p = profile as { credits_balance: number; credits_lifetime_used: number };
    await supabase
      .from('profiles')
      .update({
        credits_balance: (p.credits_balance ?? 0) + amount,
        credits_lifetime_used: Math.max(0, (p.credits_lifetime_used ?? 0) - amount),
      })
      .eq('user_id', userId);
  } catch (err) {
    console.error('refundCredits failed:', err);
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    // --- Auth ---
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.FAL_KEY) {
      return NextResponse.json(
        { error: 'AI generation not configured. Contact support.' },
        { status: 500 }
      );
    }

    // --- Parse + validate input ---
    let body: GenerateFromPromptBody;
    try {
      body = (await req.json()) as GenerateFromPromptBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const prompt = (body.prompt ?? '').trim();
    const sceneId = (body.sceneId ?? '').trim();
    const projectId = (body.projectId ?? '').trim();
    const duration = body.duration === 10 ? 10 : 5;

    if (!sceneId || !projectId) {
      return NextResponse.json(
        { error: 'sceneId and projectId are required' },
        { status: 400 }
      );
    }
    if (prompt.length < PROMPT_MIN) {
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

    const supabase = getAvatarsSupabaseClient();

    // --- Fetch scene, verify ownership, get anchor status ---
    const { data: sceneRow, error: sceneError } = await supabase
      .from('scenes')
      .select('id, project_id, user_id, anchor_image_url')
      .eq('id', sceneId)
      .eq('user_id', userId)
      .single();

    if (sceneError || !sceneRow) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }
    const scene = sceneRow as SceneRecord;

    if (scene.project_id !== projectId) {
      return NextResponse.json(
        { error: 'Scene does not belong to the given project' },
        { status: 400 }
      );
    }

    // --- Detect avatars in prompt ---
    const { data: avatarRows, error: avatarsError } = await supabase
      .from('avatars')
      .select('*')
      .eq('user_id', userId);

    if (avatarsError) {
      console.error('Avatar fetch error:', avatarsError);
      return NextResponse.json(
        { error: 'Failed to load avatars' },
        { status: 500 }
      );
    }

    const userAvatars = (avatarRows ?? []) as AvatarRecord[];
    const detectedAvatars = detectAvatarsInPrompt(prompt, userAvatars);
    const hasAvatars = detectedAvatars.length > 0;

    // --- Determine pricing ---
    // Total cost = base clip cost (deducted by /api/generate-video later) + extra premium
    // We only deduct the EXTRA here. /api/generate-video deducts the base.
    let totalKey: string;
    let baseKey: string;
    if (hasAvatars) {
      totalKey = duration === 10 ? 'clip_ai_scene_10s' : 'clip_ai_scene_5s';
      baseKey = duration === 10 ? 'clip_normal_10s' : 'clip_normal_5s';
    } else {
      totalKey = duration === 10 ? 'clip_flux_fallback_10s' : 'clip_flux_fallback_5s';
      baseKey = duration === 10 ? 'clip_normal_10s' : 'clip_normal_5s';
    }

    const totalCost = await getPricingCost(supabase, totalKey);
    const baseCost = await getPricingCost(supabase, baseKey);
    const extraCost = Math.max(0, totalCost - baseCost);

    // --- Pre-flight credit check (must afford TOTAL cost: base + extra) ---
    const profile = await getOrCreateProfile(userId);
    const balance = (profile as { credits_balance?: number } | null)?.credits_balance ?? 0;
    if (balance < totalCost) {
      return NextResponse.json(
        {
          error: 'out_of_credits',
          message: `You need ${totalCost} credit${totalCost === 1 ? '' : 's'} for this clip. You have ${balance}.`,
          required: totalCost,
          balance,
          base_cost: baseCost,
          extra_cost: extraCost,
        },
        { status: 402 }
      );
    }

    // --- Determine clip_order ---
    const { count: existingClipCount, error: countError } = await supabase
      .from('clips')
      .select('id', { count: 'exact', head: true })
      .eq('scene_id', sceneId)
      .eq('user_id', userId);

    if (countError) {
      console.error('Clip count error:', countError);
      return NextResponse.json(
        { error: 'Failed to count clips' },
        { status: 500 }
      );
    }

    const clipOrder = existingClipCount ?? 0;

    // --- Deduct EXTRA credits upfront (refunded if generation fails) ---
    let creditsAfterExtra: number | null = balance;
    if (extraCost > 0) {
      creditsAfterExtra = await deductExtraCredits(supabase, userId, extraCost);
      if (creditsAfterExtra === null) {
        // Race: someone else spent credits between check and deduct
        return NextResponse.json(
          {
            error: 'out_of_credits',
            message: 'Credit balance changed during request. Please try again.',
            required: totalCost,
            balance,
          },
          { status: 402 }
        );
      }
    }

    // ========================================================================
    // BRANCH: generate the source image based on (avatars × anchor) state
    // ========================================================================
    fal.config({ credentials: process.env.FAL_KEY });

    let generatedExternalUrl: string | null = null;
    let modeUsed:
      | 'nano_banana_anchor'
      | 'nano_banana_edit'
      | 'flux_no_avatar' = 'flux_no_avatar';
    let anchorWasCreated = false;

    try {
      if (hasAvatars && !scene.anchor_image_url) {
        // ============================================================
        // FIRST CLIP IN SCENE — generate anchor via Nano Banana Pro Edit
        // image_urls = avatars only (no anchor yet)
        // ============================================================
        modeUsed = 'nano_banana_anchor';
        const anchorPrompt = buildAnchorPrompt(prompt, detectedAvatars);
        const refUrls = detectedAvatars
          .map((a) => a.primary_photo_url)
          .filter((u) => u && u.length > 0)
          .slice(0, 14); // Nano Banana limit

        const result = (await fal.subscribe(MODEL_NANO_BANANA_EDIT, {
          input: {
            prompt: anchorPrompt,
            image_urls: refUrls,
          },
          logs: false,
        })) as FalImageResult;

        const url = result?.data?.images?.[0]?.url;
        if (!url) throw new Error('Nano Banana returned no image');
        generatedExternalUrl = url;
      } else if (hasAvatars && scene.anchor_image_url) {
        // ============================================================
        // SUBSEQUENT CLIP — preserve scene via Nano Banana Pro Edit
        // image_urls = [anchor, ...avatar photos]
        // ============================================================
        modeUsed = 'nano_banana_edit';
        const editPrompt = buildEditPrompt(prompt, detectedAvatars);
        const refUrls = [
          scene.anchor_image_url,
          ...detectedAvatars
            .map((a) => a.primary_photo_url)
            .filter((u) => u && u.length > 0),
        ].slice(0, 14);

        const result = (await fal.subscribe(MODEL_NANO_BANANA_EDIT, {
          input: {
            prompt: editPrompt,
            image_urls: refUrls,
          },
          logs: false,
        })) as FalImageResult;

        const url = result?.data?.images?.[0]?.url;
        if (!url) throw new Error('Nano Banana Edit returned no image');
        generatedExternalUrl = url;
      } else {
        // ============================================================
        // NO AVATARS — Flux Dev plain text-to-image (cheap fallback)
        // ============================================================
        modeUsed = 'flux_no_avatar';
        const result = (await fal.subscribe(MODEL_FLUX_DEV, {
          input: {
            prompt,
            image_size: FLUX_IMAGE_SIZE,
          },
          logs: false,
        })) as FalImageResult;

        const url = result?.data?.images?.[0]?.url;
        if (!url) throw new Error('Flux returned no image');
        generatedExternalUrl = url;
      }
    } catch (err) {
      // Refund any premium credits we charged before the call
      if (extraCost > 0) {
        await refundCredits(supabase, userId, extraCost);
      }
      console.error('Image generation error:', err);
      return NextResponse.json(
        {
          error: 'image_generation_failed',
          message:
            err instanceof Error
              ? err.message
              : 'Scene image generation failed. Please try again.',
          mode: modeUsed,
          refunded: extraCost > 0 ? extraCost : 0,
        },
        { status: 500 }
      );
    }

    if (!generatedExternalUrl) {
      if (extraCost > 0) await refundCredits(supabase, userId, extraCost);
      return NextResponse.json(
        { error: 'image_generation_failed', message: 'No image was generated' },
        { status: 500 }
      );
    }

    // ========================================================================
    // Rehost image to Supabase storage (Fal URLs expire)
    // ========================================================================
    let supabaseImageUrl: string;
    try {
      const filenameSuffix =
        modeUsed === 'nano_banana_anchor' || modeUsed === 'flux_no_avatar'
          ? `clip-${clipOrder}-source`
          : `clip-${clipOrder}-edit`;

      supabaseImageUrl = await rehostImageToSupabase(
        supabase,
        generatedExternalUrl,
        userId,
        sceneId,
        filenameSuffix
      );
    } catch (rehostErr) {
      if (extraCost > 0) await refundCredits(supabase, userId, extraCost);
      console.error('Rehost error:', rehostErr);
      return NextResponse.json(
        {
          error: 'rehost_failed',
          message:
            rehostErr instanceof Error
              ? rehostErr.message
              : 'Could not save generated image',
        },
        { status: 500 }
      );
    }

    // ========================================================================
    // If this was the anchor (first clip in scene with avatars) — save to scene
    // ========================================================================
    if (modeUsed === 'nano_banana_anchor' && !scene.anchor_image_url) {
      const { error: anchorErr } = await supabase
        .from('scenes')
        .update({ anchor_image_url: supabaseImageUrl })
        .eq('id', sceneId)
        .eq('user_id', userId);
      if (anchorErr) {
        console.warn('Failed to save scene anchor:', anchorErr);
      } else {
        anchorWasCreated = true;
      }
    }

    // ========================================================================
    // Insert the clip row
    // ========================================================================
    const sourceType =
      modeUsed === 'flux_no_avatar' ? 'ai_generated_flux' : 'ai_generated_scene';

    const { data: insertedClip, error: insertError } = await supabase
      .from('clips')
      .insert({
        scene_id: sceneId,
        project_id: projectId,
        user_id: userId,
        clip_order: clipOrder,
        source_image_url: supabaseImageUrl,
        source_type: sourceType,
        refined_prompt: prompt,
        scene_description: prompt,
        duration,
        status: 'queued',
      })
      .select('*')
      .single();

    if (insertError || !insertedClip) {
      if (extraCost > 0) await refundCredits(supabase, userId, extraCost);
      console.error('Clip insert error:', insertError);
      return NextResponse.json(
        {
          error: 'clip_insert_failed',
          message: 'Image generated but failed to create clip record',
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        clip: insertedClip as ClipRecord,
        detected_avatars: detectedAvatars.map((a) => ({
          id: a.id,
          name: a.name,
          primary_photo_url: a.primary_photo_url,
        })),
        meta: {
          mode_used: modeUsed,
          anchor_was_created: anchorWasCreated,
          scene_had_anchor: scene.anchor_image_url !== null,
          clip_order: clipOrder,
          source_image_url: supabaseImageUrl,
          pricing: {
            total_cost: totalCost,
            base_cost: baseCost,
            extra_cost: extraCost,
            extra_deducted_now: extraCost,
            credits_balance_after_extra: creditsAfterExtra,
            note: 'Base cost will be deducted by /api/generate-video when video render kicks off.',
          },
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('/api/clips/generate-from-prompt error:', err);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}