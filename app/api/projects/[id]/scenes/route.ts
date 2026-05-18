import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import type {
  CreateSceneRequest,
  SceneRecord,
  ProjectRecord,
} from '@/lib/types';

export const maxDuration = 30;

// Helper: verify project ownership
async function verifyProjectOwnership(
  projectId: string,
  userId: string
): Promise<ProjectRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data as ProjectRecord;
}

// GET /api/projects/[id]/scenes — list all scenes in project
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: projectId } = await context.params;
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const project = await verifyProjectOwnership(projectId, userId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('scenes')
      .select('*')
      .eq('project_id', projectId)
      .order('scene_order', { ascending: true });

    if (error) {
      console.error('Scenes list error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch scenes' },
        { status: 500 }
      );
    }

    return NextResponse.json({ scenes: (data as SceneRecord[]) || [] });
  } catch (error) {
    console.error('=== SCENES GET ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}

// POST /api/projects/[id]/scenes — create new scene at end of project
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: projectId } = await context.params;
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const project = await verifyProjectOwnership(projectId, userId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<CreateSceneRequest>;

    const name = body.name?.trim() || null;
    const description = body.description?.trim() || null;

    if (name && name.length > 100) {
      return NextResponse.json(
        { error: 'Scene name must be 100 characters or less' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Determine next scene_order (current max + 1)
    const { data: existingScenes } = await supabase
      .from('scenes')
      .select('scene_order')
      .eq('project_id', projectId)
      .order('scene_order', { ascending: false })
      .limit(1);

    const nextOrder = existingScenes && existingScenes.length > 0
      ? (existingScenes[0].scene_order as number) + 1
      : 1;

    // Insert scene
    const { data: newScene, error: insertError } = await supabase
      .from('scenes')
      .insert({
        project_id: projectId,
        user_id: userId,
        scene_order: nextOrder,
        name: name || `Scene ${nextOrder}`,
        description,
        status: 'draft',
      })
      .select('*')
      .single();

    if (insertError) {
      console.error('Scene insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to create scene' },
        { status: 500 }
      );
    }

    // Update project counters
    await supabase
      .from('projects')
      .update({
        total_scenes: project.total_scenes + 1,
        status: project.status === 'draft' ? 'in_progress' : project.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    console.log('Scene created:', { sceneId: newScene.id, projectId });

    return NextResponse.json(newScene as SceneRecord, { status: 201 });
  } catch (error) {
    console.error('=== SCENES POST ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}