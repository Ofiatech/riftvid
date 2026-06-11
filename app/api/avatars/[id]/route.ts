// app/api/avatars/[id]/route.ts
// GET    /api/avatars/[id]   — fetch single avatar (owner only)
// PATCH  /api/avatars/[id]   — edit name/description/age_range/gender (NOT photos in v1)
// DELETE /api/avatars/[id]   — delete avatar record + cleanup storage

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  AvatarRecord,
  getAvatarsSupabaseClient,
  AVATAR_NAME_MIN,
  AVATAR_NAME_MAX,
  AVATAR_DESCRIPTION_MAX,
  AvatarAgeRange,
  AvatarGender,
} from '@/lib/avatars';

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ============================================================================
// GET /api/avatars/[id]
// ============================================================================
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: 'Avatar ID required' }, { status: 400 });
    }

    const supabase = getAvatarsSupabaseClient();
    const { data, error } = await supabase
      .from('avatars')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
    }

    return NextResponse.json({ avatar: data as AvatarRecord });
  } catch (err) {
    console.error('GET /api/avatars/[id] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// PATCH /api/avatars/[id]
// Editable in v1: name, description, age_range, gender, voice_id
// NOT editable in v1: photo_urls (would require full re-upload flow)
// ============================================================================

interface AvatarPatchInput {
  name?: string;
  description?: string | null;
  age_range?: AvatarAgeRange | null;
  gender?: AvatarGender | null;
  voice_id?: string | null;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: 'Avatar ID required' }, { status: 400 });
    }

    let body: AvatarPatchInput;
    try {
      body = (await req.json()) as AvatarPatchInput;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Build patch payload — only include defined fields
    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (trimmed.length < AVATAR_NAME_MIN || trimmed.length > AVATAR_NAME_MAX) {
        return NextResponse.json(
          { error: `Name must be 1-${AVATAR_NAME_MAX} characters` },
          { status: 400 }
        );
      }
      patch.name = trimmed;
    }

    if (body.description !== undefined) {
      if (body.description === null) {
        patch.description = null;
      } else {
        if (body.description.length > AVATAR_DESCRIPTION_MAX) {
          return NextResponse.json(
            { error: `Description must be ${AVATAR_DESCRIPTION_MAX} characters or fewer` },
            { status: 400 }
          );
        }
        patch.description = body.description.trim() || null;
      }
    }

    if (body.age_range !== undefined) {
      const valid: AvatarAgeRange[] = ['child', 'teen', 'young_adult', 'adult', 'senior'];
      if (body.age_range !== null && !valid.includes(body.age_range)) {
        return NextResponse.json({ error: 'Invalid age range' }, { status: 400 });
      }
      patch.age_range = body.age_range;
    }

    if (body.gender !== undefined) {
      const valid: AvatarGender[] = ['female', 'male', 'non_binary', 'other'];
      if (body.gender !== null && !valid.includes(body.gender)) {
        return NextResponse.json({ error: 'Invalid gender' }, { status: 400 });
      }
      patch.gender = body.gender;
    }

    if (body.voice_id !== undefined) {
      // Soft-validation: UUID-ish or null. Strict validation happens when voices ships in 4.4.
      if (body.voice_id !== null && typeof body.voice_id !== 'string') {
        return NextResponse.json({ error: 'Invalid voice_id' }, { status: 400 });
      }
      patch.voice_id = body.voice_id;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const supabase = getAvatarsSupabaseClient();
    const { data, error } = await supabase
      .from('avatars')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error || !data) {
      console.error('Avatar update error:', error);
      return NextResponse.json({ error: 'Avatar not found or update failed' }, { status: 404 });
    }

    return NextResponse.json({ avatar: data as AvatarRecord });
  } catch (err) {
    console.error('PATCH /api/avatars/[id] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// DELETE /api/avatars/[id]
// Removes the avatar record AND attempts to clean up its storage folder.
// Storage cleanup is best-effort: if it fails, we still consider delete successful
// (the row is gone, orphan files can be cleaned up by a future maintenance pass).
// ============================================================================
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: 'Avatar ID required' }, { status: 400 });
    }

    const supabase = getAvatarsSupabaseClient();

    // Verify ownership BEFORE delete (RLS-lockdown means we trust Service Role to scope it)
    const { data: existing, error: fetchError } = await supabase
      .from('avatars')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
    }

    // Delete DB row first (single source of truth)
    const { error: deleteError } = await supabase
      .from('avatars')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Avatar delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete avatar' }, { status: 500 });
    }

    // Best-effort storage cleanup: list all files under {userId}/{id}/ and remove
    try {
      const { data: files } = await supabase.storage
        .from('avatars')
        .list(`${userId}/${id}`, { limit: 100 });

      if (files && files.length > 0) {
        const paths = files.map((f) => `${userId}/${id}/${f.name}`);
        await supabase.storage.from('avatars').remove(paths);
      }
    } catch (cleanupErr) {
      // Non-fatal — log and move on
      console.warn('Avatar storage cleanup warning:', cleanupErr);
    }

    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('DELETE /api/avatars/[id] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}