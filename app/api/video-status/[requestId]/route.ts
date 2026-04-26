import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

fal.config({
  credentials: process.env.FAL_KEY,
});

export const maxDuration = 30;

interface StatusResponse {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number; // 0-100
  videoUrl?: string;
  error?: string;
  logs?: string[];
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

    const { requestId } = await context.params;

    if (!requestId) {
      return NextResponse.json(
        { error: 'Request ID is required' },
        { status: 400 }
      );
    }

    // Check status with Fal
    const statusInfo = await fal.queue.status(
      'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
      {
        requestId,
        logs: true,
      }
    );

    // Map Fal's status to our friendly states
    if (statusInfo.status === 'COMPLETED') {
      // Fetch the actual result
      const result = await fal.queue.result(
        'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
        { requestId }
      );

      // Type the result data — Fal returns { video: { url: string } }
      const data = result.data as { video?: { url: string } };
      const videoUrl = data?.video?.url;

      if (!videoUrl) {
        const response: StatusResponse = {
          status: 'failed',
          error: 'Video generated but URL missing',
        };
        return NextResponse.json(response);
      }

      const response: StatusResponse = {
        status: 'completed',
        progress: 100,
        videoUrl,
      };
      return NextResponse.json(response);
    }

    if (statusInfo.status === 'IN_PROGRESS') {
      // Estimate progress from logs (Fal doesn't provide explicit %)
      const logs = (statusInfo as { logs?: { message: string }[] }).logs || [];
      const logMessages = logs.map((l) => l.message);

      // Rough progress estimate based on log count
      // Most generations have ~5-10 log entries
      const estimatedProgress = Math.min(90, 20 + logMessages.length * 8);

      const response: StatusResponse = {
        status: 'processing',
        progress: estimatedProgress,
        logs: logMessages.slice(-3), // last 3 logs only
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

    // Unknown status — treat as failed
    const response: StatusResponse = {
      status: 'failed',
      error: `Unexpected status: ${(statusInfo as { status: string }).status}`,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Status check error:', error);

    let userMessage = 'Failed to check video status';
    if (error instanceof Error) {
      userMessage = error.message;
    }

    const response: StatusResponse = {
      status: 'failed',
      error: userMessage,
    };
    return NextResponse.json(response, { status: 500 });
  }
}
