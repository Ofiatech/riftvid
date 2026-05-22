import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

fal.config({
  credentials: process.env.FAL_KEY,
});

export const maxDuration = 60;

// Riftvid uses Grok Imagine for native audio + video generation
const VIDEO_MODEL = 'xai/grok-imagine-video/image-to-video';

type TableMode = 'videos' | 'clips';

interface GenerateVideoRequest {
  videoId: string; // ID from either /api/videos OR /api/projects/.../clips
  prompt: string;
  imageUrl: string;
  duration: 5 | 10;
  tableMode?: TableMode; // 'videos' (default) or 'clips' for Sequencer
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
    const { videoId, prompt, imageUrl, duration, tableMode = 'videos' } = body;

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
    if (tableMode !== 'videos' && tableMode !== 'clips') {
      return NextResponse.json({ error: 'Invalid tableMode' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const tableName = tableMode === 'clips' ? 'clips' : 'videos';

    // Verify record exists and belongs to current user
    const { data: record, error: verifyError } = await supabase
      .from(tableName)
      .select('id, user_id, status')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (verifyError || !record) {
      return NextResponse.json(
        { error: `${tableMode === 'clips' ? 'Clip' : 'Video'} record not found` },
        { status: 404 }
      );
    }

    if (record.status !== 'queued') {
      return NextResponse.json(
        { error: `${tableMode === 'clips' ? 'Clip' : 'Video'} already submitted or completed` },
        { status: 400 }
      );
    }

    console.log('Submitting to Grok Imagine:', {
      videoId,
      tableMode,
      promptLength: prompt.length,
      duration,
      model: VIDEO_MODEL,
    });

    // Submit to Fal.ai (Grok Imagine model)
    const submission = await fal.queue.submit(VIDEO_MODEL, {
      input: {
        prompt: prompt.trim(),
        image_url: imageUrl,
        duration: duration,
        resolution: '720p',
      },
    });

    const requestId = submission.request_id;

    console.log('Fal.ai submission accepted:', { videoId, tableMode, requestId });

    // Update record with the Fal.ai request ID and set status to processing
    const { error: updateError } = await supabase
      .from(tableName)
      .update({
        status: 'processing',
        fal_request_id: requestId,
      })
      .eq('id', videoId)
      .eq('user_id', userId);

    if (updateError) {
      console.error('Failed to update record with request ID:', updateError);
      // Don't fail — submission is already in queue, polling will catch it
    }

    return NextResponse.json({
      success: true,
      requestId,
      videoId,
      tableMode,
      status: 'processing',
    });
  } catch (error) {
    console.error('=== GENERATE VIDEO ERROR ===');
    console.error(error);
    console.error('=== END GENERATE VIDEO ERROR ===');

    let userMessage = 'Failed to start video generation';
    if (error instanceof Error) {
      if (error.message.includes('rate limit')) {
        userMessage = 'Generation rate limit hit. Try again in a moment.';
      } else if (error.message.includes('credentials') || error.message.includes('401')) {
        userMessage = 'Fal.ai API key issue';
      } else if (error.message.includes('safety') || error.message.includes('moderation')) {
        userMessage = 'Content filter triggered — try rephrasing your prompt';
      } else {
        userMessage = error.message;
      }
    }

    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}