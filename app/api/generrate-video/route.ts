import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

// Configure Fal client with API key from env
fal.config({
  credentials: process.env.FAL_KEY,
});

export const maxDuration = 60;

interface GenerateVideoRequest {
  prompt: string;
  imageUrl: string; // base64 data URL or http URL
  duration: 5 | 10;
  // Future: model selection
}

interface GenerateVideoResponse {
  requestId: string;
  status: 'queued';
  estimatedSeconds: number;
}

export async function POST(req: NextRequest) {
  try {
    // Verify API key is configured
    if (!process.env.FAL_KEY) {
      return NextResponse.json(
        { error: 'Fal.ai API key not configured' },
        { status: 500 }
      );
    }

    const body: GenerateVideoRequest = await req.json();
    const { prompt, imageUrl, duration } = body;

    // Validation
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }
    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json(
        { error: 'Image is required' },
        { status: 400 }
      );
    }
    if (duration !== 5 && duration !== 10) {
      return NextResponse.json(
        { error: 'Duration must be 5 or 10 seconds' },
        { status: 400 }
      );
    }

    // Submit to Fal.ai Kling 2.5 Turbo Pro (image-to-video)
    // Docs: https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video
    const submission = await fal.queue.submit('fal-ai/kling-video/v2.5-turbo/pro/image-to-video', {
      input: {
        prompt: prompt.trim(),
        image_url: imageUrl,
        duration: duration.toString() as '5' | '10', // Fal expects string
        negative_prompt: 'blurry, low quality, distorted, deformed face, melting, glitch',
        cfg_scale: 0.5,
      },
    });

    const response: GenerateVideoResponse = {
      requestId: submission.request_id,
      status: 'queued',
      estimatedSeconds: duration === 5 ? 45 : 75, // rough estimate
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Video generation error:', error);

    let userMessage = 'Failed to start video generation';
    if (error instanceof Error) {
      if (error.message.includes('credit') || error.message.includes('balance')) {
        userMessage = 'Out of Fal.ai credits. Please top up.';
      } else if (error.message.includes('rate limit')) {
        userMessage = 'Too many requests. Wait a moment.';
      } else if (error.message.includes('401') || error.message.includes('unauthorized')) {
        userMessage = 'Fal.ai API key issue';
      } else {
        userMessage = error.message;
      }
    }

    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
