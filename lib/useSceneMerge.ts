'use client';

// useSceneMerge — React hook for Cloudinary scene merging
//
// What it does:
// 1. Tracks merge status for a scene
// 2. Auto-triggers merge when scene becomes ready (debounced)
// 3. Polls merge status while processing
// 4. Returns merged video URL when ready
//
// Usage in scene editor:
//   const merge = useSceneMerge(projectId, sceneId, clips);
//   <PreviewPlayer
//     clips={clips}
//     mergedVideoUrl={merge.mergedVideoUrl}
//     mergeStatus={merge.status}
//   />

import { useState, useEffect, useRef, useCallback } from 'react';

export type MergeStatus =
  | 'idle'           // no clips yet OR initial state
  | 'pending'        // clips exist but merge not started
  | 'triggering'    // about to call merge API
  | 'processing'    // Cloudinary is merging
  | 'ready'          // merged video URL available
  | 'failed'         // merge failed (use clip-by-clip fallback)
  | 'stale';         // clips changed since last merge

interface UseSceneMergeReturn {
  status: MergeStatus;
  mergedVideoUrl: string | null;
  errorMessage: string | null;
  lastMergedAt: string | null;
  totalCompletedClips: number;
  isMerging: boolean;
  triggerMergeManually: () => Promise<void>;
}

interface SceneMergeOptions {
  // Wait this many ms after the last clip-completion before triggering merge
  // Prevents triggering 3 merges if 3 clips complete back-to-back
  debounceMs?: number;
  // How often to poll status while merging
  pollIntervalMs?: number;
  // Auto-trigger merge when clips become ready (default true)
  autoMerge?: boolean;
}

interface ClipSnapshot {
  id: string;
  status: string;
  generated_video_url: string | null;
}

/**
 * Hook that manages a scene's merge lifecycle.
 *
 * @param projectId - the project ID
 * @param sceneId   - the scene ID
 * @param clips     - current list of clips in the scene (for change detection)
 * @param options   - merge behavior config
 */
export function useSceneMerge(
  projectId: string,
  sceneId: string,
  clips: ClipSnapshot[],
  options: SceneMergeOptions = {}
): UseSceneMergeReturn {
  const {
    debounceMs = 3000,
    pollIntervalMs = 5000,
    autoMerge = true,
  } = options;

  const [status, setStatus] = useState<MergeStatus>('idle');
  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastMergedAt, setLastMergedAt] = useState<string | null>(null);
  const [totalCompletedClips, setTotalCompletedClips] = useState(0);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastClipSignatureRef = useRef<string>('');
  const isTriggeringRef = useRef(false);

  // Build a signature of completed clips — when this changes, merge is stale
  const completedClipSignature = clips
    .filter((c) => c.status === 'completed' && c.generated_video_url)
    .map((c) => `${c.id}:${c.generated_video_url}`)
    .sort()
    .join('|');

  const completedClipCount = clips.filter(
    (c) => c.status === 'completed' && c.generated_video_url
  ).length;

  // Fetch current merge status from API
  const fetchMergeStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/scenes/${sceneId}/merge`,
        { method: 'GET' }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data;
    } catch (err) {
      console.error('Fetch merge status error:', err);
      return null;
    }
  }, [projectId, sceneId]);

  // Trigger merge via API
  const triggerMerge = useCallback(async () => {
    if (isTriggeringRef.current) return;
    isTriggeringRef.current = true;

    try {
      setStatus('triggering');
      setErrorMessage(null);

      const res = await fetch(
        `/api/projects/${projectId}/scenes/${sceneId}/merge`,
        { method: 'POST' }
      );
      const data = await res.json();

      if (!res.ok) {
        setStatus('failed');
        setErrorMessage(data.error || `Merge failed (HTTP ${res.status})`);
        return;
      }

      if (data.merged_video_url) {
        setMergedVideoUrl(data.merged_video_url);
        setStatus('ready');
        setLastMergedAt(new Date().toISOString());
        setErrorMessage(null);
      }
    } catch (err) {
      setStatus('failed');
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
    } finally {
      isTriggeringRef.current = false;
    }
  }, [projectId, sceneId]);

  // On mount + when scene changes — fetch current merge status from server
  useEffect(() => {
    let cancelled = false;

    fetchMergeStatus().then((data) => {
      if (cancelled || !data) return;

      setTotalCompletedClips(data.total_completed_clips || 0);
      setMergedVideoUrl(data.merged_video_url || null);
      setLastMergedAt(data.merge_updated_at || null);
      setErrorMessage(data.merge_error || null);

      // Map server status to hook status
      const serverStatus = data.merge_status;
      if (serverStatus === 'ready' && data.merged_video_url) {
        setStatus('ready');
      } else if (serverStatus === 'processing') {
        setStatus('processing');
      } else if (serverStatus === 'failed') {
        setStatus('failed');
      } else if (serverStatus === 'stale') {
        setStatus('stale');
      } else if (data.total_completed_clips > 0) {
        setStatus('pending');
      } else {
        setStatus('idle');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, sceneId, fetchMergeStatus]);

  // Update completed-clip count whenever clips change
  useEffect(() => {
    setTotalCompletedClips(completedClipCount);
  }, [completedClipCount]);

  // Detect clip changes — if completed clips changed, mark stale and queue merge
  useEffect(() => {
    // Skip first render (signature initialization)
    if (lastClipSignatureRef.current === '') {
      lastClipSignatureRef.current = completedClipSignature;
      return;
    }

    if (lastClipSignatureRef.current === completedClipSignature) {
      return; // no change
    }

    lastClipSignatureRef.current = completedClipSignature;

    // Clips changed — mark current merge as stale
    if (status === 'ready') {
      setStatus('stale');
    }

    if (!autoMerge) return;
    if (completedClipCount === 0) return;
    if (isTriggeringRef.current) return;

    // Debounce: wait `debounceMs` after the last clip change before triggering
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      triggerMerge();
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [
    completedClipSignature,
    completedClipCount,
    status,
    autoMerge,
    debounceMs,
    triggerMerge,
  ]);

  // Poll for status updates while processing
  useEffect(() => {
    if (status !== 'processing') {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = setInterval(async () => {
      const data = await fetchMergeStatus();
      if (!data) return;

      if (data.merge_status === 'ready' && data.merged_video_url) {
        setMergedVideoUrl(data.merged_video_url);
        setStatus('ready');
        setLastMergedAt(data.merge_updated_at || new Date().toISOString());
        setErrorMessage(null);
      } else if (data.merge_status === 'failed') {
        setStatus('failed');
        setErrorMessage(data.merge_error || 'Merge failed');
      }
    }, pollIntervalMs);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [status, fetchMergeStatus, pollIntervalMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const isMerging =
    status === 'triggering' || status === 'processing';

  return {
    status,
    mergedVideoUrl,
    errorMessage,
    lastMergedAt,
    totalCompletedClips,
    isMerging,
    triggerMergeManually: triggerMerge,
  };
}
