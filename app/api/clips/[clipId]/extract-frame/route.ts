import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import type { ExtractFrameResponse } from '@/lib/types';

export const maxDuration = 30;

// POST /api/clips/[clipId]/extract-frame
// Accepts a base64 frame image from the client (browser already extracted it
// using HTML5 video API). Uploads to Supabase Storage and stores URL on clip.
//
// Why this design: doing FFmpeg server-side on Vercel is risky (60s timeouts,
// large bundle). Browser-side extraction is fast and free. This endpoint
// just persists the frame the browser already captured.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ clipId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clipId } = await context.params;
    if (!clipId) {
      return NextResponse.json({ error: 'Clip ID required' }, { status: 400 });
    }

    const body = (await req.json()) as { frame_base64?: string };
    if (!body.frame_base64 || typeof body.frame_base64 !== 'string') {
      return NextResponse.json(
        { error: 'frame_base64 is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Verify clip ownership
    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .select('id, status, last_frame_url')
      .eq('id', clipId)
      .eq('user_id', userId)
      .single();

    if (clipError || !clip) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }

    if (clip.status !== 'completed') {
      return NextResponse.json(
        { error: 'Clip must be completed before extracting frame' },
        { status: 400 }
      );
    }

    // If already extracted, return existing URL
    if (clip.last_frame_url) {
      return NextResponse.json({
        success: true,
        last_frame_url: clip.last_frame_url,
        clip_id: clipId,
      } as ExtractFrameResponse);
    }

    // Strip data URL prefix
    const match = body.frame_base64.match(/^data:image\/(\w+);base64,(.+)$/);
    let mimeType = 'image/png';
    let base64Body = body.frame_base64;

    if (match) {
      mimeType = `image/${match[1]}`;
      base64Body = match[2];
    }

    const buffer = Buffer.from(base64Body, 'base64');
    const ext = mimeType.split('/')[1] || 'png';
    const fileName = `${userId}/clips/${clipId}/last-frame.${ext}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('videos')
      .upload(fileName, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error('Frame upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload frame' },
        { status: 500 }
      );
    }

    const { data: urlData } = supabase.storage
      .from('videos')
      .getPublicUrl(fileName);

    const lastFrameUrl = urlData.publicUrl;

    // Save URL to clip
    await supabase
      .from('clips')
      .update({
        last_frame_url: lastFrameUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clipId);

    console.log('Frame extracted:', { clipId, lastFrameUrl });

    return NextResponse.json({
      success: true,
      last_frame_url: lastFrameUrl,
      clip_id: clipId,
    } as ExtractFrameResponse);
  } catch (error) {
    console.error('=== EXTRACT FRAME ERROR ===', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}