import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import type {
  SceneRecord,
  ClipRecord,
  UpdateSceneRequest,
} from '@/lib/types';

export const maxDuration = 30;

// Helper: verify scene belongs to user
async function verifyScene(
  sceneId: string,
  projectId: string,
  userId: string
): Promise<SceneRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('scenes')
    .select('*')
    .eq('id', sceneId)
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data as SceneRecord;
}

// GET /api/projects/[id]/scenes/[sceneId] — get scene with all clips
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: projectId, sceneId } = await context.params;

    const scene = await verifyScene(sceneId, projectId, userId);
    if (!scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();
    const { data: clips, error: clipsError } = await supabase
      .from('clips')
      .select('*')
      .eq('scene_id', sceneId)
      .order('clip_order', { ascending: true });

    if (clipsError) {
      console.error('Clips fetch error:', clipsError);
      return NextResponse.json({ error: 'Failed to fetch clips' }, { status: 500 });
    }

    return NextResponse.json({
      ...scene,
      clips: (clips as ClipRecord[]) || [],
    });
  } catch (error) {
    console.error('=== SCENE GET ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/[id]/scenes/[sceneId] — update scene (rename, reorder, status)
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: projectId, sceneId } = await context.params;

    const scene = await verifyScene(sceneId, projectId, userId);
    if (!scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<UpdateSceneRequest>;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.name === 'string') {
      const trimmed = body.name.trim();
      if (trimmed.length > 100) {
        return NextResponse.json(
          { error: 'Scene name must be 100 characters or less' },
          { status: 400 }
        );
      }
      updates.name = trimmed || null;
    }

    if (body.description !== undefined) {
      updates.description = body.description?.trim() || null;
    }

    if (typeof body.scene_order === 'number' && body.scene_order > 0) {
      updates.scene_order = body.scene_order;
    }

    if (body.status) {
      const validStatuses = ['draft', 'completed'];
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: `Status must be: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }
      updates.status = body.status;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('scenes')
      .update(updates)
      .eq('id', sceneId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) {
      console.error('Scene update error:', error);
      return NextResponse.json({ error: 'Failed to update scene' }, { status: 500 });
    }

    return NextResponse.json(data as SceneRecord);
  } catch (error) {
    console.error('=== SCENE PATCH ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[id]/scenes/[sceneId] — cascade deletes clips
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: projectId, sceneId } = await context.params;

    const scene = await verifyScene(sceneId, projectId, userId);
    if (!scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();

    // Get current project to update counters
    const { data: project } = await supabase
      .from('projects')
      .select('total_scenes, total_clips, total_duration')
      .eq('id', projectId)
      .single();

    // CASCADE in SQL auto-deletes clips
    const { error } = await supabase
      .from('scenes')
      .delete()
      .eq('id', sceneId)
      .eq('user_id', userId);

    if (error) {
      console.error('Scene delete error:', error);
      return NextResponse.json({ error: 'Failed to delete scene' }, { status: 500 });
    }

    // Update project counters
    if (project) {
      await supabase
        .from('projects')
        .update({
          total_scenes: Math.max(0, project.total_scenes - 1),
          total_clips: Math.max(0, project.total_clips - scene.total_clips),
          total_duration: Math.max(0, project.total_duration - scene.total_duration),
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId);
    }

    console.log('Scene deleted:', { sceneId, projectId });
    return NextResponse.json({ success: true, deleted_id: sceneId });
  } catch (error) {
    console.error('=== SCENE DELETE ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}