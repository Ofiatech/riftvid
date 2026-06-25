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

type TableMode = 'videos' | 'clips';

interface StatusResponse {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  videoUrl?: string;
  error?: string;
  logs?: string[];
}

// Helper: download from Fal URL and upload to Supabase Storage
//
// 4.3.5b regenerate-fix (June 2026):
// =============================================================================
// The clips-mode filename now includes a timestamp suffix. Without it, every
// regeneration of the same clip wrote to the SAME file path (recordId-based),
// which meant the public URL was identical before and after regen — even
// though the bytes had been replaced via upsert. Browsers (and React's
// <video src={...}> equality check) treat that as the same resource and
// keep showing the cached old video.
//
// With the timestamp, each render produces a unique URL. React sees a new
// src, browser fetches the new bytes, user sees the new clip.
//
// Side effect: old video files become orphans in storage. Storage cost grows
// per regenerate. Same orphan pattern as source images (see PATCH endpoint
// in clips/[clipId]/route.ts which already uses `source-${Date.now()}`). A
// future cron job can clean orphans by user_id pattern.
//
// videos-mode keeps its original `${userId}/${recordId}.mp4` path because the
// videos table doesn't have a regenerate flow (each render = new row = new ID
// = naturally unique path).
async function persistVideoToStorage(
  falVideoUrl: string,
  userId: string,
  recordId: string,
  tableMode: TableMode
): Promise<string> {
  const supabase = getSupabaseAdmin();

  const response = await fetch(falVideoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video from Fal: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // For clips: timestamp in filename so regenerations produce unique URLs.
  // For videos: keep the original recordId-only path (no regen flow there).
  const fileName = tableMode === 'clips'
    ? `${userId}/clips/${recordId}/video-${Date.now()}.mp4`
    : `${userId}/${recordId}.mp4`;

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

// Helper: extract last frame from video (browser-side won't work in API route,
// so we use Fal's video URL and rely on client-side extraction via the modal later.
// For now, we record the video URL itself; the actual last-frame extraction
// happens via /api/clips/[clipId]/extract-frame which the modal can call.)
async function persistLastFramePlaceholder(
  recordId: string,
  tableMode: TableMode
): Promise<void> {
  // For 'clips' table, we leave last_frame_url null at completion time.
  // The frontend will call /api/clips/[clipId]/extract-frame to populate it
  // when the user views the completed clip.
  // For 'videos' table, there's no last_frame_url field, so nothing to do.
  void recordId;
  void tableMode;
}

// Helper: refund credits when video fails (only refund if not already refunded)
async function handleVideoFailure(
  userId: string,
  recordId: string,
  duration: number,
  errorMessage: string,
  tableMode: TableMode
) {
  const supabase = getSupabaseAdmin();
  const tableName = tableMode === 'clips' ? 'clips' : 'videos';

  // Check if already refunded by looking at transactions
  const { data: existingRefund } = await supabase
    .from('transactions')
    .select('id')
    .eq('related_video_id', recordId)
    .eq('type', 'refund')
    .maybeSingle();

  if (existingRefund) {
    return; // Already refunded, don't double-refund
  }

  // Update record status
  await supabase
    .from(tableName)
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', recordId);

  // Refund credits
  try {
    const creditAmount = getCreditCost(duration as 5 | 10);
    await refundCredits(userId, creditAmount, recordId, `Auto-refund: ${errorMessage}`);
  } catch (refundError) {
    console.error('Refund failed (non-fatal):', refundError);
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

    // Determine which table to look in (default: videos for backward compat)
    const tableModeParam = req.nextUrl.searchParams.get('tableMode');
    const tableMode: TableMode = tableModeParam === 'clips' ? 'clips' : 'videos';
    const tableName = tableMode === 'clips' ? 'clips' : 'videos';

    const supabase = getSupabaseAdmin();

    // Find the record matching this Fal request ID + user
    const { data: record, error: findError } = await supabase
      .from(tableName)
      .select('id, user_id, status, generated_video_url, duration')
      .eq('fal_request_id', requestId)
      .eq('user_id', userId)
      .single();

    if (findError || !record) {
      return NextResponse.json(
        { error: `${tableMode === 'clips' ? 'Clip' : 'Video'} record not found` },
        { status: 404 }
      );
    }

    // If we already persisted the video, return the cached URL immediately
    if (record.status === 'completed' && record.generated_video_url) {
      return NextResponse.json({
        status: 'completed',
        progress: 100,
        videoUrl: record.generated_video_url,
      } as StatusResponse);
    }

    // If already failed (e.g., from earlier check), return that status
    if (record.status === 'failed') {
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
        await handleVideoFailure(userId, record.id, record.duration, 'Video generated but URL missing', tableMode);
        return NextResponse.json({
          status: 'failed',
          error: 'Video generated but URL missing — credits refunded',
        } as StatusResponse);
      }

      // Persist to our Storage (so the video doesn't expire from Fal CDN)
      let permanentUrl: string;
      try {
        permanentUrl = await persistVideoToStorage(falVideoUrl, userId, record.id, tableMode);
      } catch (persistError) {
        console.error('Persist error:', persistError);
        permanentUrl = falVideoUrl; // fallback to Fal URL
      }

      // Update record with completed status + video URL.
      // We ALSO clear last_frame_url here for clips so any old extracted
      // frame from a previous render doesn't linger. The LastFrameExtractor
      // component will repopulate it from the new video once it's played.
      const updatePayload: Record<string, unknown> = {
        status: 'completed',
        generated_video_url: permanentUrl,
      };
      if (tableMode === 'clips') {
        updatePayload.last_frame_url = null;
      }

      await supabase
        .from(tableName)
        .update(updatePayload)
        .eq('id', record.id);

      // For clips, leave last_frame_url null — frontend can trigger extraction later
      await persistLastFramePlaceholder(record.id, tableMode);

      return NextResponse.json({
        status: 'completed',
        progress: 100,
        videoUrl: permanentUrl,
      } as StatusResponse);
    }

    if (statusInfo.status === 'IN_PROGRESS') {
      const logs = (statusInfo as { logs?: { message: string }[] }).logs || [];
      const logMessages = logs.map((l) => l.message);
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
    await handleVideoFailure(userId, record.id, record.duration, errorMsg, tableMode);

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