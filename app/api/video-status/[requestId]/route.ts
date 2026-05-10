import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { refundCredits, getCreditCost } from '@/lib/credits';

fal.config({
  credentials: process.env.FAL_KEY,
});

export const maxDuration = 60;

// Must match the model used in generate-video/route.ts
const VIDEO_MODEL = 'xai/grok-imagine-video/image-to-video';

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

// Helper: refund credits when video fails (only refund if not already refunded)
async function handleVideoFailure(
  userId: string,
  videoId: string,
  duration: number,
  errorMessage: string
) {
  const supabase = getSupabaseAdmin();

  // Check if already refunded by looking at transactions
  const { data: existingRefund } = await supabase
    .from('transactions')
    .select('id')
    .eq('related_video_id', videoId)
    .eq('type', 'refund')
    .maybeSingle();

  if (existingRefund) {
    // Already refunded, don't double-refund
    return;
  }

  // Update video status
  await supabase
    .from('videos')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', videoId);

  // Refund credits
  try {
    const creditAmount = getCreditCost(duration as 5 | 10);
    await refundCredits(userId, creditAmount, videoId, `Auto-refund: ${errorMessage}`);
  } catch (refundError) {
    console.error('Refund failed (non-fatal):', refundError);
    // Don't throw — we still want to return the failed status to the user
  }
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
      .select('id, user_id, status, generated_video_url, duration')
      .eq('fal_request_id', requestId)
      .eq('user_id', userId)
      .single();

    if (findError || !video) {
      return NextResponse.json({ error: 'Video record not found' }, { status: 404 });
    }

    // If we already persisted the video, return the cached URL immediately
    if (video.status === 'completed' && video.generated_video_url) {
      return NextResponse.json({
        status: 'completed',
        progress: 100,
        videoUrl: video.generated_video_url,
      } as StatusResponse);
    }

    // If already failed (e.g., from earlier check), return that status
    if (video.status === 'failed') {
      return NextResponse.json({
        status: 'failed',
        error: 'Generation failed (credits already refunded)',
      } as StatusResponse);
    }

    // Check status with Fal (Grok Imagine model)
    const statusInfo = await fal.queue.status(VIDEO_MODEL, {
      requestId,
      logs: true,
    });

    if (statusInfo.status === 'COMPLETED') {
      const result = await fal.queue.result(VIDEO_MODEL, { requestId });

      // Grok returns: { video: { url, content_type, height, width, fps, duration, ... } }
      const data = result.data as { video?: { url: string } };
      const falVideoUrl = data?.video?.url;

      if (!falVideoUrl) {
        await handleVideoFailure(userId, video.id, video.duration, 'Video generated but URL missing');
        return NextResponse.json({
          status: 'failed',
          error: 'Video generated but URL missing — credits refunded',
        } as StatusResponse);
      }

      // Persist to our Storage (so the video doesn't expire from Fal CDN)
      let permanentUrl: string;
      try {
        permanentUrl = await persistVideoToStorage(falVideoUrl, userId, video.id);
      } catch (persistError) {
        console.error('Persist error:', persistError);
        permanentUrl = falVideoUrl; // fallback to Fal URL
      }

      await supabase
        .from('videos')
        .update({
          status: 'completed',
          generated_video_url: permanentUrl,
        })
        .eq('id', video.id);

      return NextResponse.json({
        status: 'completed',
        progress: 100,
        videoUrl: permanentUrl,
      } as StatusResponse);
    }

    if (statusInfo.status === 'IN_PROGRESS') {
      const logs = (statusInfo as { logs?: { message: string }[] }).logs || [];
      const logMessages = logs.map((l) => l.message);
      // Grok is faster, so progress moves quicker
      const estimatedProgress = Math.min(95, 25 + logMessages.length * 10);

      return NextResponse.json({
        status: 'processing',
        progress: estimatedProgress,
        logs: logMessages.slice(-3),
      } as StatusResponse);
    }

    if (statusInfo.status === 'IN_QUEUE') {
      return NextResponse.json({
        status: 'queued',
        progress: 10,
      } as StatusResponse);
    }

    // Unknown status — mark as failed and refund
    const errorMsg = `Unexpected Fal status: ${(statusInfo as { status: string }).status}`;
    await handleVideoFailure(userId, video.id, video.duration, errorMsg);

    return NextResponse.json({
      status: 'failed',
      error: `${errorMsg} — credits refunded`,
    } as StatusResponse);
  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { status: 'failed', error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}
