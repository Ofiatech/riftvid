import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { deductCredits, getCreditCost } from '@/lib/credits';
import type {
  ClipRecord,
  CreateClipRequest,
  SceneRecord,
  ProjectRecord,
} from '@/lib/types';

export const maxDuration = 60;

// Upload base64 image to Supabase Storage, return URL
async function uploadBase64ToStorage(
  base64Data: string,
  userId: string,
  clipId: string
): Promise<string> {
  const supabase = getSupabaseAdmin();

  // Strip data URL prefix if present (e.g. "data:image/png;base64,xxx")
  const match = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  let mimeType = 'image/png';
  let base64Body = base64Data;

  if (match) {
    mimeType = `image/${match[1]}`;
    base64Body = match[2];
  }

  const buffer = Buffer.from(base64Body, 'base64');
  const ext = mimeType.split('/')[1] || 'png';
  const fileName = `${userId}/clips/${clipId}/source.${ext}`;

  const { error } = await supabase.storage
    .from('videos') // reuse existing 'videos' bucket
    .upload(fileName, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) throw new Error(`Source image upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(fileName);
  return urlData.publicUrl;
}

// GET /api/projects/[id]/scenes/[sceneId]/clips — list clips in scene
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sceneId } = await context.params;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('clips')
      .select('*')
      .eq('scene_id', sceneId)
      .eq('user_id', userId)
      .order('clip_order', { ascending: true });

    if (error) {
      console.error('Clips list error:', error);
      return NextResponse.json({ error: 'Failed to fetch clips' }, { status: 500 });
    }

    return NextResponse.json({ clips: (data as ClipRecord[]) || [] });
  } catch (error) {
    console.error('=== CLIPS GET ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}

// POST /api/projects/[id]/scenes/[sceneId]/clips — create new clip
// This is the gateway: validates ownership, resolves source image,
// deducts credits, creates clip record. Generation is triggered separately
// via /api/generate-video (reuses existing pipeline).
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: projectId, sceneId } = await context.params;

    const supabase = getSupabaseAdmin();

    // Verify scene + project ownership
    const { data: scene, error: sceneError } = await supabase
      .from('scenes')
      .select('*')
      .eq('id', sceneId)
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single();

    if (sceneError || !scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const body = (await req.json()) as CreateClipRequest;

    // Validate required fields
    if (!body.refined_prompt || typeof body.refined_prompt !== 'string') {
      return NextResponse.json({ error: 'refined_prompt is required' }, { status: 400 });
    }
    if (body.duration !== 5 && body.duration !== 10) {
      return NextResponse.json({ error: 'duration must be 5 or 10' }, { status: 400 });
    }
    if (!body.source_type) {
      return NextResponse.json({ error: 'source_type is required' }, { status: 400 });
    }

    // Determine clip_order (max + 1 in scene)
    const { data: existingClips } = await supabase
      .from('clips')
      .select('clip_order')
      .eq('scene_id', sceneId)
      .order('clip_order', { ascending: false })
      .limit(1);

    const nextClipOrder = existingClips && existingClips.length > 0
      ? (existingClips[0].clip_order as number) + 1
      : 1;

    // Resolve source image based on source_type
    let sourceImageUrl: string;
    let sourceClipId: string | null = null;

    if (body.source_type === 'upload') {
      if (body.source_image_base64) {
        // Upload base64 → Supabase Storage
        const tempId = crypto.randomUUID();
        sourceImageUrl = await uploadBase64ToStorage(
          body.source_image_base64,
          userId,
          tempId
        );
      } else if (body.source_image_url) {
        sourceImageUrl = body.source_image_url;
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
      // Fetch the source clip's last_frame_url
      const { data: sourceClip, error: srcError } = await supabase
        .from('clips')
        .select('last_frame_url, status')
        .eq('id', body.source_clip_id)
        .eq('user_id', userId)
        .single();

      if (srcError || !sourceClip) {
        return NextResponse.json(
          { error: 'Source clip not found' },
          { status: 404 }
        );
      }
      if (!sourceClip.last_frame_url) {
        return NextResponse.json(
          { error: 'Source clip has no last frame yet — wait for it to complete' },
          { status: 400 }
        );
      }

      sourceImageUrl = sourceClip.last_frame_url;
      sourceClipId = body.source_clip_id;
    } else if (body.source_type === 'library') {
      if (!body.source_image_url) {
        return NextResponse.json(
          { error: 'source_image_url required for library type' },
          { status: 400 }
        );
      }
      sourceImageUrl = body.source_image_url;
    } else {
      return NextResponse.json(
        { error: `Invalid source_type: ${body.source_type}` },
        { status: 400 }
      );
    }

    // Deduct credits BEFORE creating clip record (so we don't create orphans on failure)
    const creditCost = getCreditCost(body.duration);
    try {
      await deductCredits(
        userId,
        creditCost,
        null, // related_video_id set after clip insert
        `Sequencer clip (${body.duration}s) in scene ${sceneId}`
      );
    } catch (creditError) {
      console.error('Credit deduction failed:', creditError);
      return NextResponse.json(
        {
          error: creditError instanceof Error ? creditError.message : 'Insufficient credits',
          out_of_credits: true,
        },
        { status: 402 }
      );
    }

    // Insert clip record
    const { data: newClip, error: insertError } = await supabase
      .from('clips')
      .insert({
        scene_id: sceneId,
        project_id: projectId,
        user_id: userId,
        clip_order: nextClipOrder,
        source_image_url: sourceImageUrl,
        source_type: body.source_type,
        source_clip_id: sourceClipId,
        base_prompt: body.base_prompt?.trim() || null,
        refined_prompt: body.refined_prompt.trim(),
        rift_used: body.rift_used || false,
        rift_answers: body.rift_answers || null,
        scene_description: body.scene_description?.trim() || null,
        duration: body.duration,
        status: 'queued',
      })
      .select('*')
      .single();

    if (insertError) {
      console.error('Clip insert error:', insertError);
      // TODO: Refund credits since we deducted but failed to create
      return NextResponse.json(
        { error: 'Failed to create clip' },
        { status: 500 }
      );
    }

    // Update scene + project counters
    await supabase
      .from('scenes')
      .update({
        total_clips: scene.total_clips + 1,
        total_duration: scene.total_duration + body.duration,
        cover_clip_id: scene.cover_clip_id || newClip.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sceneId);

    // Update project counters
    const { data: project } = await supabase
      .from('projects')
      .select('total_clips, total_duration, cover_image_url')
      .eq('id', projectId)
      .single();

    if (project) {
      await supabase
        .from('projects')
        .update({
          total_clips: project.total_clips + 1,
          total_duration: project.total_duration + body.duration,
          cover_image_url: project.cover_image_url || sourceImageUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId);
    }

    console.log('Clip created:', {
      clipId: newClip.id,
      sceneId,
      projectId,
      sourceType: body.source_type,
    });

    return NextResponse.json(newClip as ClipRecord, { status: 201 });
  } catch (error) {
    console.error('=== CLIPS POST ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}