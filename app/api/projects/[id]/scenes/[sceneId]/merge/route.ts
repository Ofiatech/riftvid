// Scene merge endpoint
// POST /api/projects/[id]/scenes/[sceneId]/merge — trigger merge
// GET  /api/projects/[id]/scenes/[sceneId]/merge — check status

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  mergeSceneClips,
  deleteSceneSourceClips,
  ClipForMerge,
} from '@/lib/cloudinary';

export const maxDuration = 60;

interface MergeStatusResponse {
  merge_status: 'pending' | 'queued' | 'processing' | 'ready' | 'failed' | 'stale';
  merged_video_url: string | null;
  merge_updated_at: string | null;
  merge_error: string | null;
  total_completed_clips: number;
}

// =============================================================================
// GET — Check merge status
// =============================================================================
export async function GET(
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

    const { data: scene, error: sceneError } = await supabase
      .from('scenes')
      .select(
        'id, merge_status, merged_video_url, merge_updated_at, merge_error, project_id'
      )
      .eq('id', sceneId)
      .eq('project_id', projectId)
      .single();

    if (sceneError || !scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { count } = await supabase
      .from('clips')
      .select('id', { count: 'exact', head: true })
      .eq('scene_id', sceneId)
      .eq('status', 'completed');

    const response: MergeStatusResponse = {
      merge_status: scene.merge_status,
      merged_video_url: scene.merged_video_url,
      merge_updated_at: scene.merge_updated_at,
      merge_error: scene.merge_error,
      total_completed_clips: count || 0,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Merge status GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST — Trigger merge
// =============================================================================
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json(
        { error: 'Cloudinary not configured' },
        { status: 500 }
      );
    }

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: projectId, sceneId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: scene, error: sceneError } = await supabase
      .from('scenes')
      .select(
        'id, project_id, merge_status, merged_video_url, merge_cloudinary_public_id'
      )
      .eq('id', sceneId)
      .eq('project_id', projectId)
      .single();

    if (sceneError || !scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (scene.merge_status === 'processing') {
      return NextResponse.json(
        { error: 'Merge already in progress', merge_status: 'processing' },
        { status: 409 }
      );
    }

    // Fetch all completed clips
    const { data: clips, error: clipsError } = await supabase
      .from('clips')
      .select('id, generated_video_url, clip_order, status, duration')
      .eq('scene_id', sceneId)
      .eq('status', 'completed')
      .order('clip_order', { ascending: true });

    if (clipsError) {
      return NextResponse.json(
        { error: 'Failed to fetch clips: ' + clipsError.message },
        { status: 500 }
      );
    }

    if (!clips || clips.length === 0) {
      return NextResponse.json(
        { error: 'Scene has no completed clips to merge' },
        { status: 400 }
      );
    }

    const mergeableClips: ClipForMerge[] = clips
      .filter((c) => c.generated_video_url)
      .map((c) => ({
        clipId: c.id,
        videoUrl: c.generated_video_url!,
        clipOrder: c.clip_order,
      }));

    if (mergeableClips.length === 0) {
      return NextResponse.json(
        { error: 'No clips have generated video URLs yet' },
        { status: 400 }
      );
    }

    // Total duration = sum of all clip durations
    const totalDurationSeconds = clips.reduce(
      (sum, c) => sum + (c.duration || 0),
      0
    );

    // Mark scene as processing
    await supabase
      .from('scenes')
      .update({
        merge_status: 'processing',
        merge_updated_at: new Date().toISOString(),
        merge_error: null,
      })
      .eq('id', sceneId);

    // Clean up old source clips before re-merging (best effort)
    if (scene.merged_video_url) {
      deleteSceneSourceClips(userId, sceneId).catch((err) =>
        console.error('Old source clip cleanup failed (non-fatal):', err)
      );
    }

    // Perform the merge
    try {
      const result = await mergeSceneClips(
        mergeableClips,
        userId,
        sceneId,
        totalDurationSeconds
      );

      // Update scene with merged result
      const { error: updateError } = await supabase
        .from('scenes')
        .update({
          merge_status: 'ready',
          merged_video_url: result.merged_video_url,
          merge_cloudinary_public_id: result.public_id,
          merge_updated_at: new Date().toISOString(),
          merge_error: null,
        })
        .eq('id', sceneId);

      if (updateError) {
        console.error('Failed to update scene after merge:', updateError);
        return NextResponse.json(
          {
            error: 'Merge succeeded but DB update failed: ' + updateError.message,
            merged_video_url: result.merged_video_url,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        merge_status: 'ready',
        merged_video_url: result.merged_video_url,
        duration: result.duration,
        bytes: result.bytes,
        clips_merged: mergeableClips.length,
      });
    } catch (mergeError) {
      const errorMessage =
        mergeError instanceof Error ? mergeError.message : 'Unknown merge error';

      await supabase
        .from('scenes')
        .update({
          merge_status: 'failed',
          merge_updated_at: new Date().toISOString(),
          merge_error: errorMessage,
        })
        .eq('id', sceneId);

      return NextResponse.json(
        {
          error: 'Cloudinary merge failed: ' + errorMessage,
          merge_status: 'failed',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('=== MERGE ENDPOINT ERROR ===');
    console.error(error);
    console.error('=== END MERGE ENDPOINT ERROR ===');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}