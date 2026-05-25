'use client';

// LastFrameExtractor — invisible background component that captures the last
// frame of each completed clip and persists it as clips.last_frame_url.
//
// This is THE moat for Rift Studio: without last_frame_url populated, users
// can't chain clips together (Chain button stays disabled).
//
// HOW IT WORKS:
// 1. Component is mounted by the scene editor with the list of clips
// 2. It scans for clips that are 'completed' but have no last_frame_url
// 3. For each one, it:
//    a) Creates a hidden <video> element with the clip's generated_video_url
//    b) Waits for metadata to load (knows the duration)
//    c) Seeks to ~0.1s before the end (last frame timestamp)
//    d) Draws that frame to a hidden <canvas>
//    e) Converts canvas → base64 JPG
//    f) POSTs to /api/clips/[clipId]/extract-frame
//    g) Calls onFrameExtracted() so parent can refresh scene data
//
// CRITICAL: Videos must be served with proper CORS headers, otherwise the
// canvas will be "tainted" and toDataURL() will throw a security error.
// Supabase Storage videos served via public URLs handle this correctly.
//
// PROCESS ONE AT A TIME: We don't extract all clips simultaneously — that
// would hammer the network and CPU. We process the oldest pending clip,
// then move on.

import { useEffect, useRef, useState } from 'react';

interface ClipForExtraction {
  id: string;
  status: string;
  generated_video_url: string | null;
  last_frame_url: string | null;
  duration: number;
}

interface LastFrameExtractorProps {
  clips: ClipForExtraction[];
  onFrameExtracted?: (clipId: string, lastFrameUrl: string) => void;
  // Set to true to see verbose console logs while testing
  debug?: boolean;
}

export default function LastFrameExtractor({
  clips,
  onFrameExtracted,
  debug = false,
}: LastFrameExtractorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentClipId, setCurrentClipId] = useState<string | null>(null);
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());

  // Find the next clip that needs frame extraction
  useEffect(() => {
    if (currentClipId) return; // already processing one

    const pending = clips.find(
      (c) =>
        c.status === 'completed' &&
        c.generated_video_url &&
        !c.last_frame_url &&
        !processedIds.has(c.id)
    );

    if (pending) {
      if (debug) {
        console.log('[LastFrameExtractor] Starting extraction for clip:', pending.id);
      }
      setCurrentClipId(pending.id);
    }
  }, [clips, currentClipId, processedIds, debug]);

  // Extract the frame when currentClipId changes
  useEffect(() => {
    if (!currentClipId) return;

    const clip = clips.find((c) => c.id === currentClipId);
    if (!clip || !clip.generated_video_url) {
      // Clip vanished — skip
      setProcessedIds((prev) => new Set(prev).add(currentClipId));
      setCurrentClipId(null);
      return;
    }

    let cancelled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      setCurrentClipId(null);
      return;
    }

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      video.removeAttribute('src');
      video.load();
    };

    const finishWithError = (reason: string) => {
      if (cancelled) return;
      if (debug) {
        console.error('[LastFrameExtractor] Extraction failed:', reason);
      }
      // Mark as processed even on failure — don't retry indefinitely
      setProcessedIds((prev) => new Set(prev).add(currentClipId));
      cleanup();
      setCurrentClipId(null);
    };

    const handleLoadedMetadata = () => {
      if (cancelled) return;
      // Seek to slightly before the end (last frame)
      const seekTime = Math.max(0, video.duration - 0.1);
      if (debug) {
        console.log(
          `[LastFrameExtractor] Video loaded. Duration: ${video.duration}s. Seeking to ${seekTime}s.`
        );
      }
      video.currentTime = seekTime;
    };

    const handleSeeked = async () => {
      if (cancelled) return;
      try {
        // Draw current frame to canvas
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w === 0 || h === 0) {
          finishWithError('Video has zero dimensions');
          return;
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finishWithError('Could not get canvas 2D context');
          return;
        }

        ctx.drawImage(video, 0, 0, w, h);

        // Convert canvas to base64 JPG (smaller than PNG, fine for source frames)
        let base64: string;
        try {
          base64 = canvas.toDataURL('image/jpeg', 0.9);
        } catch (canvasErr) {
          finishWithError(
            'Canvas tainted (CORS): ' +
              (canvasErr instanceof Error ? canvasErr.message : 'unknown')
          );
          return;
        }

        if (debug) {
          console.log(
            `[LastFrameExtractor] Frame captured (${(base64.length / 1024).toFixed(1)} KB). Uploading...`
          );
        }

        // POST to extract-frame endpoint
        const res = await fetch(`/api/clips/${currentClipId}/extract-frame`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frame_base64: base64 }),
        });

        if (cancelled) return;

        const data = await res.json();
        if (!res.ok) {
          finishWithError(`Server rejected frame: ${data.error || res.status}`);
          return;
        }

        if (debug) {
          console.log('[LastFrameExtractor] SUCCESS:', data.last_frame_url);
        }

        // Mark as processed and notify parent
        setProcessedIds((prev) => new Set(prev).add(currentClipId));
        if (onFrameExtracted && data.last_frame_url) {
          onFrameExtracted(currentClipId, data.last_frame_url);
        }

        cleanup();
        setCurrentClipId(null);
      } catch (err) {
        finishWithError(
          err instanceof Error ? err.message : 'Unknown extraction error'
        );
      }
    };

    const handleError = () => {
      finishWithError('Video failed to load');
    };

    // Safety timeout — if a video never loads after 30s, give up
    timeoutId = setTimeout(() => {
      finishWithError('Timeout waiting for video to load (30s)');
    }, 30000);

    // Wire up listeners
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    // CORS is critical — without crossOrigin set, canvas extraction will fail
    video.crossOrigin = 'anonymous';
    video.muted = true; // some browsers require muted for programmatic load
    video.playsInline = true;
    video.src = clip.generated_video_url;
    video.load();

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      cleanup();
    };
  }, [currentClipId, clips, onFrameExtracted, debug]);

  return (
    <>
      {/*
        Hidden video + canvas. These never render visibly.
        We keep them in the DOM so the refs persist across re-renders.
      */}
      <video
        ref={videoRef}
        style={{ display: 'none' }}
        muted
        playsInline
        preload="auto"
        crossOrigin="anonymous"
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </>
  );
}
