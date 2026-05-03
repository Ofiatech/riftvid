
import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

fal.config({
  credentials: process.env.FAL_KEY,
});

export const maxDuration = 60;

interface GenerateVideoRequest {
  videoId: string; // ID from /api/videos POST response
  prompt: string;
  imageUrl: string;
  duration: 5 | 10;
}

export async function POST(req: NextRequest) {
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

    const body: GenerateVideoRequest = await req.json();
    const { videoId, prompt, imageUrl, duration } = body;

    if (!videoId) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }
    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 });
    }
    if (duration !== 5 && duration !== 10) {
      return NextResponse.json({ error: 'Duration must be 5 or 10 seconds' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Verify the video record exists and belongs to current user
    const { data: video, error: verifyError } = await supabase
      .from('videos')
      .select('id, user_id, status')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (verifyError || !video) {
      return NextResponse.json({ error: 'Video record not found' }, { status: 404 });
    }

    if (video.status !== 'queued') {
      return NextResponse.json({ error: 'Video already submitted or completed' }, { status: 400 });
    }

    console.log('Submitting to Fal:', {
      videoId,
      promptLength: prompt.length,
      duration,
    });

    // Submit to Fal.ai
    const submission = await fal.queue.submit('fal-ai/kling-video/v2.5-turbo/pro/image-to-video', {
      input: {
        prompt: prompt.trim(),
        image_url: imageUrl,
        duration: duration.toString() as '5' | '10',
      },
    });

    // Update DB with fal request ID and status
    await supabase
      .from('videos')
      .update({
        fal_request_id: submission.request_id,
        status: 'processing',
      })
      .eq('id', videoId);

    return NextResponse.json({
      requestId: submission.request_id,
      videoId,
      status: 'queued',
      estimatedSeconds: duration === 5 ? 45 : 75,
    });
  } catch (error) {
    console.error('=== FAL ERROR ===');
    console.error(error);
    console.error('=== END FAL ERROR ===');

    let userMessage = 'Failed to start video generation';

    if (error && typeof error === 'object') {
      const errObj = error as {
        message?: string;
        body?: { detail?: string | { msg?: string; loc?: string[] }[] };
        status?: number;
      };

      if (errObj.body?.detail) {
        if (typeof errObj.body.detail === 'string') {
          userMessage = errObj.body.detail;
        } else if (Array.isArray(errObj.body.detail) && errObj.body.detail.length > 0) {
          const firstErr = errObj.body.detail[0];
          userMessage = firstErr?.msg
            ? `${firstErr.msg}${firstErr.loc ? ` (field: ${firstErr.loc.join('.')})` : ''}`
            : 'Validation error from Fal.ai';
        }
      } else if (errObj.message) {
        if (errObj.message.includes('credit') || errObj.message.includes('balance')) {
          userMessage = 'Out of Fal.ai credits. Please top up.';
        } else if (errObj.message.includes('rate limit')) {
          userMessage = 'Too many requests. Wait a moment.';
        } else if (errObj.message.includes('401') || errObj.message.includes('unauthorized')) {
          userMessage = 'Fal.ai API key issue';
        } else {
          userMessage = errObj.message;
        }
      }
    }

    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}