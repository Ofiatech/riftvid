import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

fal.config({
  credentials: process.env.FAL_KEY,
});

export const maxDuration = 60;

interface StatusResponse {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  videoUrl?: string;
  error?: string;
  logs?: string[];
}

// Helper: download from Fal URL and upload to Supabase Storage
async function persistVideoToStorage(
  falVideoUrl: string,
  userId: string,
  videoId: string
): Promise<string> {
  const supabase = getSupabaseAdmin();

  // Download video from Fal's CDN
  const response = await fetch(falVideoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video from Fal: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const fileName = `${userId}/${videoId}.mp4`;

  const { error } = await supabase.storage
    .from('videos')
    .upload(fileName, buffer, {
      contentType: 'video/mp4',
      upsert: true,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from('videos')
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  try {
    if (!process.env.FAL_KEY) {
      return NextResponse.json(
        { error: 'Fal.ai API key not configured' },
        { status: 500 }
      );
    }

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { requestId } = await context.params;
    if (!requestId) {
      return NextResponse.json({ error: 'Request ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Find the video record matching this Fal request ID + user
    const { data: video, error: findError } = await supabase
      .from('videos')
      .select('id, user_id, status, generated_video_url')
      .eq('fal_request_id', requestId)
      .eq('user_id', userId)
      .single();

    if (findError || !video) {
      return NextResponse.json({ error: 'Video record not found' }, { status: 404 });
    }

    // If we already persisted the video, return the cached URL immediately
    if (video.status === 'completed' && video.generated_video_url) {
      const cachedResponse: StatusResponse = {
        status: 'completed',
        progress: 100,
        videoUrl: video.generated_video_url,
      };
      return NextResponse.json(cachedResponse);
    }

    // Check status with Fal
    const statusInfo = await fal.queue.status(
      'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
      { requestId, logs: true }
    );

    if (statusInfo.status === 'COMPLETED') {
      // Fetch result from Fal
      const result = await fal.queue.result(
        'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
        { requestId }
      );

      const data = result.data as { video?: { url: string } };
      const falVideoUrl = data?.video?.url;

      if (!falVideoUrl) {
        await supabase
          .from('videos')
          .update({ status: 'failed', error_message: 'Video generated but URL missing' })
          .eq('id', video.id);

        const failed: StatusResponse = {
          status: 'failed',
          error: 'Video generated but URL missing',
        };
        return NextResponse.json(failed);
      }

      // Persist to our Storage so the video never expires
      let permanentUrl: string;
      try {
        permanentUrl = await persistVideoToStorage(falVideoUrl, userId, video.id);
      } catch (persistError) {
        console.error('Persist error:', persistError);
        // Even if storage upload fails, return the Fal URL so user can at least see it now
        permanentUrl = falVideoUrl;
      }

      // Update DB
      await supabase
        .from('videos')
        .update({
          status: 'completed',
          generated_video_url: permanentUrl,
        })
        .eq('id', video.id);

      const response: StatusResponse = {
        status: 'completed',
        progress: 100,
        videoUrl: permanentUrl,
      };
      return NextResponse.json(response);
    }

    if (statusInfo.status === 'IN_PROGRESS') {
      const logs = (statusInfo as { logs?: { message: string }[] }).logs || [];
      const logMessages = logs.map((l) => l.message);
      const estimatedProgress = Math.min(90, 20 + logMessages.length * 8);

      const response: StatusResponse = {
        status: 'processing',
        progress: estimatedProgress,
        logs: logMessages.slice(-3),
      };
      return NextResponse.json(response);
    }

    if (statusInfo.status === 'IN_QUEUE') {
      const response: StatusResponse = {
        status: 'queued',
        progress: 5,
      };
      return NextResponse.json(response);
    }

    // Unknown status — mark as failed
    await supabase
      .from('videos')
      .update({
        status: 'failed',
        error_message: `Unexpected Fal status: ${(statusInfo as { status: string }).status}`,
      })
      .eq('id', video.id);

    const response: StatusResponse = {
      status: 'failed',
      error: `Unexpected status: ${(statusInfo as { status: string }).status}`,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { status: 'failed', error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}