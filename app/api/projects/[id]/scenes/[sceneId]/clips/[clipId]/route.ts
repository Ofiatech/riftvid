import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { deductCredits, getCreditCost } from '@/lib/credits';
import type { ClipRecord, UpdateClipRequest } from '@/lib/types';

export const maxDuration = 60;

// ============================================================================
// CHUNK 2 HELPER: shared with POST route (clips/route.ts) for the regenerate path.
// Inlined here so this file is self-contained — duplicating ~25 lines is fine
// vs. introducing a new shared module mid-feature.
// ============================================================================
async function uploadBase64ToStorage(
  base64Data: string,
  userId: string,
  clipId: string
): Promise<string> {
  const supabase = getSupabaseAdmin();

  const match = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  let mimeType = 'image/png';
  let base64Body = base64Data;

  if (match) {
    mimeType = `image/${match[1]}`;
    base64Body = match[2];
  }

  const buffer = Buffer.from(base64Body, 'base64');
  const ext = mimeType.split('/')[1] || 'png';
  const fileName = `${userId}/clips/${clipId}/source-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('videos')
    .upload(fileName, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) throw new Error(`Source image upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(fileName);
  return urlData.publicUrl;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; sceneId: string; clipId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clipId } = await context.params;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }

    return NextResponse.json(data as ClipRecord);
  } catch (error) {
    console.error('=== CLIP GET ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH — dual mode:
//   1. Cosmetic update (existing): body has only clip_order and/or refined_prompt.
//      No credit deduction, no status change. Used by future rename/reorder UI.
//   2. Regenerate (CHUNK 2): body has regenerate: true plus new source +
//      prompt + duration. Resets the clip in place: deducts credits, updates
//      source fields, clears generated_video_url / last_frame_url / errors,
//      sets status='queued'. Frontend then calls /api/generate-video which
//      picks up the now-queued clip and re-renders it.
//
// REGENERATE BEHAVIOR (matches Chunk 2 spec):
//   - Same clip_id, same clip_order (clip stays in place on timeline)
//   - Credits are deducted (same getCreditCost as fresh clips)
//   - Duration delta (newDuration - oldDuration) updates scene + project totals
//   - Old generated_video_url and last_frame_url URLs are forgotten in the DB,
//     but the underlying storage files become orphaned (accepted tech debt;
//     future cron job can clean orphans by user_id pattern)
// ============================================================================
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; sceneId: string; clipId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: projectId, sceneId, clipId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Partial<UpdateClipRequest> & {
      regenerate?: boolean;
      source_type?: 'upload' | 'last_frame' | 'library' | 'url';
      source_image_url?: string;
      source_image_base64?: string;
      source_clip_id?: string;
      base_prompt?: string | null;
      rift_used?: boolean;
      rift_answers?: unknown;
      scene_description?: string | null;
      duration?: 5 | 10;
    };

    const supabase = getSupabaseAdmin();

    // --- Verify ownership and fetch current state ---
    const { data: existingClip, error: fetchError } = await supabase
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingClip) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }

    // ========================================================================
    // BRANCH A: REGENERATE PATH (NEW — Chunk 2)
    // ========================================================================
    if (body.regenerate === true) {
      // --- Validation ---
      if (!body.refined_prompt || typeof body.refined_prompt !== 'string' || !body.refined_prompt.trim()) {
        return NextResponse.json({ error: 'refined_prompt is required for regenerate' }, { status: 400 });
      }
      if (body.duration !== 5 && body.duration !== 10) {
        return NextResponse.json({ error: 'duration must be 5 or 10' }, { status: 400 });
      }
      if (!body.source_type) {
        return NextResponse.json({ error: 'source_type is required for regenerate' }, { status: 400 });
      }

      // --- Resolve new source image ---
      let newSourceImageUrl: string;
      let newSourceClipId: string | null = null;

      if (body.source_type === 'upload') {
        if (body.source_image_base64) {
          newSourceImageUrl = await uploadBase64ToStorage(
            body.source_image_base64,
            userId,
            clipId
          );
        } else if (body.source_image_url) {
          newSourceImageUrl = body.source_image_url;
        } else {
          return NextResponse.json(
            { error: 'source_image_base64 or source_image_url required for upload type' },
            { status: 400 }
          );
        }
      } else if (body.source_type === 'last_frame') {
        if (!body.source_clip_id) {
          return NextResponse.json(
            { error: 'source_clip_id required for last_frame type' },
            { status: 400 }
          );
        }
        // Edge case: don't allow chaining to yourself
        if (body.source_clip_id === clipId) {
          return NextResponse.json(
            { error: 'Cannot chain a clip to its own last frame' },
            { status: 400 }
          );
        }
        const { data: sourceClip, error: srcError } = await supabase
          .from('clips')
          .select('last_frame_url')
          .eq('id', body.source_clip_id)
          .eq('user_id', userId)
          .single();

        if (srcError || !sourceClip) {
          return NextResponse.json({ error: 'Source clip not found' }, { status: 404 });
        }
        if (!sourceClip.last_frame_url) {
          return NextResponse.json(
            { error: 'Source clip has no last frame yet — wait for it to complete' },
            { status: 400 }
          );
        }
        newSourceImageUrl = sourceClip.last_frame_url as string;
        newSourceClipId = body.source_clip_id;
      } else if (body.source_type === 'library' || body.source_type === 'url') {
        // 'library' uses an existing source_image_url; 'url' uses an external URL.
        // Both flows just pass the URL through.
        if (!body.source_image_url) {
          return NextResponse.json(
            { error: `source_image_url required for ${body.source_type} type` },
            { status: 400 }
          );
        }
        newSourceImageUrl = body.source_image_url;
      } else {
        return NextResponse.json(
          { error: `Invalid source_type: ${body.source_type}` },
          { status: 400 }
        );
      }

      // --- Credit deduction ---
      // We charge full price for regenerate — it's real compute on Fal.
      const creditCost = getCreditCost(body.duration);
      try {
        await deductCredits(
          userId,
          creditCost,
          sceneId,
          `Regenerate clip (${body.duration}s) in scene ${sceneId}`
        );
      } catch (creditError) {
        console.error('Credit deduction failed (regenerate):', creditError);
        return NextResponse.json(
          {
            error: creditError instanceof Error ? creditError.message : 'Insufficient credits',
            out_of_credits: true,
          },
          { status: 402 }
        );
      }

      // --- Duration delta calculation for scene/project totals ---
      const oldDuration = (existingClip.duration as number) || 0;
      const newDuration = body.duration;
      const durationDelta = newDuration - oldDuration;

      // --- Update the clip in place ---
      const { data: updatedClip, error: updateError } = await supabase
        .from('clips')
        .update({
          source_image_url: newSourceImageUrl,
          source_type: body.source_type,
          source_clip_id: newSourceClipId,
          base_prompt: typeof body.base_prompt === 'string' ? body.base_prompt.trim() || null : null,
          refined_prompt: body.refined_prompt.trim(),
          rift_used: body.rift_used ?? false,
          rift_answers: body.rift_answers ?? null,
          scene_description:
            typeof body.scene_description === 'string'
              ? body.scene_description.trim() || null
              : null,
          duration: newDuration,
          // Clear render outputs — fresh queue
          status: 'queued',
          generated_video_url: null,
          last_frame_url: null,
          fal_request_id: null,
          error_message: null,
          // updated_at signals to UI that something changed
          updated_at: new Date().toISOString(),
        })
        .eq('id', clipId)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (updateError || !updatedClip) {
        console.error('Regenerate update error:', updateError);
        // NB: credits already deducted above. This is a real edge case.
        // The lib/credits deductCredits function logs the transaction; an
        // admin can manually refund if this fires repeatedly. Logging
        // loudly so we notice in Vercel.
        console.error('CRITICAL: credits deducted but clip update failed', {
          userId,
          clipId,
          creditCost,
        });
        return NextResponse.json({ error: 'Failed to update clip for regenerate' }, { status: 500 });
      }

      // --- Update scene total_duration if duration changed ---
      if (durationDelta !== 0) {
        const { data: scene } = await supabase
          .from('scenes')
          .select('total_duration')
          .eq('id', sceneId)
          .single();

        if (scene) {
          await supabase
            .from('scenes')
            .update({
              total_duration: Math.max(0, (scene.total_duration as number) + durationDelta),
              updated_at: new Date().toISOString(),
            })
            .eq('id', sceneId);
        }

        // --- Update project total_duration ---
        const { data: project } = await supabase
          .from('projects')
          .select('total_duration')
          .eq('id', projectId)
          .single();

        if (project) {
          await supabase
            .from('projects')
            .update({
              total_duration: Math.max(0, (project.total_duration as number) + durationDelta),
              updated_at: new Date().toISOString(),
            })
            .eq('id', projectId);
        }
      }

      console.log('Clip regenerated:', {
        clipId,
        sceneId,
        projectId,
        oldDuration,
        newDuration,
        sourceType: body.source_type,
        creditCost,
      });

      return NextResponse.json(updatedClip as ClipRecord);
    }

    // ========================================================================
    // BRANCH B: COSMETIC UPDATE (existing behavior — preserved)
    // ========================================================================
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.clip_order === 'number' && body.clip_order > 0) {
      updates.clip_order = body.clip_order;
    }

    if (typeof body.refined_prompt === 'string' && body.refined_prompt.trim().length > 0) {
      updates.refined_prompt = body.refined_prompt.trim();
    }

    const { data, error } = await supabase
      .from('clips')
      .update(updates)
      .eq('id', clipId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error || !data) {
      console.error('Clip update error:', error);
      return NextResponse.json({ error: 'Failed to update clip' }, { status: 500 });
    }

    return NextResponse.json(data as ClipRecord);
  } catch (error) {
    console.error('=== CLIP PATCH ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; sceneId: string; clipId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: projectId, sceneId, clipId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .eq('user_id', userId)
      .single();

    if (clipError || !clip) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }

    const { error: deleteError } = await supabase
      .from('clips')
      .delete()
      .eq('id', clipId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Clip delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete clip' }, { status: 500 });
    }

    const { data: scene } = await supabase
      .from('scenes')
      .select('total_clips, total_duration, cover_clip_id')
      .eq('id', sceneId)
      .single();

    if (scene) {
      const updates: Record<string, unknown> = {
        total_clips: Math.max(0, scene.total_clips - 1),
        total_duration: Math.max(0, scene.total_duration - (clip.duration as number)),
        updated_at: new Date().toISOString(),
      };

      if (scene.cover_clip_id === clipId) {
        const { data: nextCover } = await supabase
          .from('clips')
          .select('id')
          .eq('scene_id', sceneId)
          .neq('id', clipId)
          .order('clip_order', { ascending: true })
          .limit(1);

        updates.cover_clip_id = nextCover && nextCover.length > 0 ? nextCover[0].id : null;
      }

      await supabase.from('scenes').update(updates).eq('id', sceneId);
    }

    const { data: project } = await supabase
      .from('projects')
      .select('total_clips, total_duration')
      .eq('id', projectId)
      .single();

    if (project) {
      await supabase
        .from('projects')
        .update({
          total_clips: Math.max(0, project.total_clips - 1),
          total_duration: Math.max(0, project.total_duration - (clip.duration as number)),
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId);
    }

    console.log('Clip deleted:', { clipId, sceneId, projectId });
    return NextResponse.json({ success: true, deleted_id: clipId });
  } catch (error) {
    console.error('=== CLIP DELETE ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}