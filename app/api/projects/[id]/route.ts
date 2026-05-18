import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import type {
  ProjectRecord,
  SceneRecord,
  UpdateProjectRequest,
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

// GET /api/projects/[id] — get single project with all scenes
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const project = await verifyProjectOwnership(id, userId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();

    // Fetch all scenes for this project, ordered
    const { data: scenes, error: scenesError } = await supabase
      .from('scenes')
      .select('*')
      .eq('project_id', id)
      .order('scene_order', { ascending: true });

    if (scenesError) {
      console.error('Scenes fetch error:', scenesError);
      return NextResponse.json(
        { error: 'Failed to fetch scenes' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...project,
      scenes: (scenes as SceneRecord[]) || [],
    });
  } catch (error) {
    console.error('=== PROJECT GET ERROR ===');
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Server error',
      },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/[id] — update project (rename, change status, etc.)
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const project = await verifyProjectOwnership(id, userId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<UpdateProjectRequest>;

    // Build update object only with provided fields
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.name === 'string') {
      const trimmed = body.name.trim();
      if (trimmed.length === 0) {
        return NextResponse.json(
          { error: 'Project name cannot be empty' },
          { status: 400 }
        );
      }
      if (trimmed.length > 100) {
        return NextResponse.json(
          { error: 'Project name must be 100 characters or less' },
          { status: 400 }
        );
      }
      updates.name = trimmed;
    }

    if (body.description !== undefined) {
      updates.description = body.description?.trim() || null;
    }

    if (body.status) {
      const validStatuses = ['draft', 'in_progress', 'completed', 'archived'];
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: `Status must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }
      updates.status = body.status;
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) {
      console.error('Project update error:', error);
      return NextResponse.json(
        { error: 'Failed to update project' },
        { status: 500 }
      );
    }

    return NextResponse.json(data as ProjectRecord);
  } catch (error) {
    console.error('=== PROJECT PATCH ERROR ===');
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Server error',
      },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[id] — delete project (cascades to scenes + clips)
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const project = await verifyProjectOwnership(id, userId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();

    // CASCADE in SQL will auto-delete scenes + clips
    // But generated_video_url files in Storage need separate cleanup
    // TODO Session 8: Add storage cleanup for clip videos

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      console.error('Project delete error:', error);
      return NextResponse.json(
        { error: 'Failed to delete project' },
        { status: 500 }
      );
    }

    console.log('Project deleted:', { id, userId });

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (error) {
    console.error('=== PROJECT DELETE ERROR ===');
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Server error',
      },
      { status: 500 }
    );
  }
}