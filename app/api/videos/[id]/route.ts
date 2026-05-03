import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const maxDuration = 30;

// GET /api/videos/[id] — fetch one video (must be owned by current user)
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Get video error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/videos/[id] — remove video + associated storage files
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const supabase = getSupabaseAdmin();

    // First verify ownership
    const { data: video, error: fetchError } = await supabase
      .from('videos')
      .select('id, user_id, source_image_url, generated_video_url')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Try to delete files from storage (best effort — don't fail whole request if files missing)
    try {
      // Source image — extract path from URL
      if (video.source_image_url && video.source_image_url.includes('source-images/')) {
        const sourcePath = video.source_image_url.split('source-images/')[1];
        if (sourcePath) {
          await supabase.storage.from('source-images').remove([sourcePath]);
        }
      }
      // Generated video
      if (video.generated_video_url && video.generated_video_url.includes('videos/')) {
        const videoPath = video.generated_video_url.split('/videos/')[1];
        if (videoPath) {
          await supabase.storage.from('videos').remove([videoPath]);
        }
      }
    } catch (storageError) {
      console.warn('Storage cleanup error (non-fatal):', storageError);
    }

    // Delete database record
    const { error: deleteError } = await supabase
      .from('videos')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}