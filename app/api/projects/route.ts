import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import type {
  CreateProjectRequest,
  ProjectRecord,
} from '@/lib/types';
import { generateDefaultProjectName } from '@/lib/types';

export const maxDuration = 30;

// GET /api/projects — list all projects for current user
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Projects list error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch projects' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      projects: (data as ProjectRecord[]) || [],
    });
  } catch (error) {
    console.error('=== PROJECTS GET ERROR ===');
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Server error',
      },
      { status: 500 }
    );
  }
}

// POST /api/projects — create new project
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<CreateProjectRequest>;

    // Name is optional — if not provided, generate a default
    const name = body.name?.trim() || generateDefaultProjectName();
    const description = body.description?.trim() || null;

    if (name.length > 100) {
      return NextResponse.json(
        { error: 'Project name must be 100 characters or less' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('projects')
      .insert({
        user_id: userId,
        name,
        description,
        status: 'draft',
      })
      .select('*')
      .single();

    if (error) {
      console.error('Project insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create project' },
        { status: 500 }
      );
    }

    console.log('Project created:', { id: data.id, userId, name });

    return NextResponse.json(data as ProjectRecord, { status: 201 });
  } catch (error) {
    console.error('=== PROJECTS POST ERROR ===');
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Server error',
      },
      { status: 500 }
    );
  }
}