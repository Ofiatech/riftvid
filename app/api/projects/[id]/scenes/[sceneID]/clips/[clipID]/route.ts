import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import type { ClipRecord, UpdateClipRequest } from '@/lib/types';

export const maxDuration = 30;

// GET /api/projects/[id]/scenes/[sceneId]/clips/[clipId]
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

// PATCH /api/projects/[id]/scenes/[sceneId]/clips/[clipId]
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; sceneId: string; clipId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clipId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Partial<UpdateClipRequest>;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.clip_order === 'number' && body.clip_order > 0) {
      updates.clip_order = body.clip_order;
    }

    if (typeof body.refined_prompt === 'string' && body.refined_prompt.trim().length > 0) {
      updates.refined_prompt = body.refined_prompt.trim();
    }

    const supabase = getSupabaseAdmin();
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

// DELETE /api/projects/[id]/scenes/[sceneId]/clips/[clipId]
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

    // Fetch clip for counter updates
    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .eq('user_id', userId)
      .single();

    if (clipError || !clip) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }

    // Delete the clip
    const { error: deleteError } = await supabase
      .from('clips')
      .delete()
      .eq('id', clipId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Clip delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete clip' }, { status: 500 });
    }

    // Update scene counters
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

      // If we deleted the cover clip, pick a new one (or null if no clips left)
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

    // Update project counters
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

    // TODO: Clean up generated_video_url and last_frame_url from Storage
    // For v1, leave them — Storage cleanup comes in Session 11 polish

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