import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

fal.config({
  credentials: process.env.FAL_KEY,
});

fal.config({
  credentials: process.env.FAL_KEY,
});

console.log('Env check:', {
  FAL_KEY: process.env.FAL_KEY ? `Set (${process.env.FAL_KEY.length} chars)` : 'NOT SET',
  OPENAI: process.env.OPENAI_API_KEY ? 'Set' : 'NOT SET',
  CLERK: process.env.CLERK_SECRET_KEY ? 'Set' : 'NOT SET',
});

export const maxDuration = 60;

interface GenerateVideoRequest {
  prompt: string;
  imageUrl: string;
  duration: 5 | 10;
}

interface GenerateVideoResponse {
  requestId: string;
  status: 'queued';
  estimatedSeconds: number;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.FAL_KEY) {
      return NextResponse.json(
        { error: 'Fal.ai API key not configured' },
        { status: 500 }
      );
    }

    const body: GenerateVideoRequest = await req.json();
    const { prompt, imageUrl, duration } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }
    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 });
    }
    if (duration !== 5 && duration !== 10) {
      return NextResponse.json({ error: 'Duration must be 5 or 10 seconds' }, { status: 400 });
    }

    // Log what we're sending (helps debug if Fal rejects)
    console.log('Submitting to Fal:', {
      promptLength: prompt.length,
      imageUrlPrefix: imageUrl.substring(0, 50) + '...',
      duration,
    });

    // Minimal payload — only the documented fields for Kling 2.5 Turbo Pro
    const submission = await fal.queue.submit('fal-ai/kling-video/v2.5-turbo/pro/image-to-video', {
      input: {
        prompt: prompt.trim(),
        image_url: imageUrl,
        duration: duration.toString() as '5' | '10',
      },
    });

    const response: GenerateVideoResponse = {
      requestId: submission.request_id,
      status: 'queued',
      estimatedSeconds: duration === 5 ? 45 : 75,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('=== FAL ERROR ===');
    console.error(error);
    console.error('=== END FAL ERROR ===');

    let userMessage = 'Failed to start video generation';

    // Try to extract details from Fal error
    if (error && typeof error === 'object') {
      const errObj = error as {
        message?: string;
        body?: { detail?: string | { msg?: string; loc?: string[] }[] };
        status?: number;
      };

      // Fal returns detailed validation errors in body.detail
      if (errObj.body?.detail) {
        if (typeof errObj.body.detail === 'string') {
          userMessage = errObj.body.detail;
        } else if (Array.isArray(errObj.body.detail) && errObj.body.detail.length > 0) {
          // Validation errors come as array of {msg, loc}
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
