'use client';

// useSceneMerge — React hook for Cloudinary scene merging
//
// v2 FIX (Session 11C-1 bugfix):
// Original bug: when user reopened a scene with new clips added since last
// merge, hook trusted the database's `merge_status='ready'` and used the
// stale merged_video_url that only contained the old clips.
//
// Root cause: hook compared "what clips exist now" against "what clips
// existed when hook mounted" — but missed the case where clips were added
// BETWEEN merges (or BETWEEN page loads).
//
// Fix: when hook mounts, compare merge_updated_at against newest clip's
// created_at. If newest clip is newer than the merge, the merge is stale
// even if the DB says 'ready' — trigger a fresh merge immediately.

import { useState, useEffect, useRef, useCallback } from 'react';

export type MergeStatus =
  | 'idle'
  | 'pending'
  | 'triggering'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'stale';

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
  debounceMs?: number;
  pollIntervalMs?: number;
  autoMerge?: boolean;
}

interface ClipSnapshot {
  id: string;
  status: string;
  generated_video_url: string | null;
  // Hook uses created_at to compare against merge_updated_at (catches new clips
  // added to a scene after the last merge).
  created_at?: string;
  // 4.3.5b regenerate-fix: also check updated_at. When a clip is REGENERATED,
  // created_at stays the same — only updated_at changes — so without this the
  // staleness check is blind to regenerates and never triggers a fresh merge.
  updated_at?: string;
}

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
  // NEW: track whether we've done the initial staleness check
  const initialStalenessCheckedRef = useRef(false);

  const completedClipSignature = clips
    .filter((c) => c.status === 'completed' && c.generated_video_url)
    .map((c) => `${c.id}:${c.generated_video_url}`)
    .sort()
    .join('|');

  const completedClipCount = clips.filter(
    (c) => c.status === 'completed' && c.generated_video_url
  ).length;

  // Find the newest "touch" timestamp across completed clips. We prefer
  // updated_at (catches regenerates), and fall back to created_at when
  // updated_at isn't present in the data. This single value is what we
  // compare against the scene's merge_updated_at to decide if the merge
  // is stale and needs to be re-run.
  const newestClipTouchedAt = clips
    .filter((c) => c.status === 'completed' && c.generated_video_url)
    .reduce<string | null>((newest, c) => {
      const touch = c.updated_at || c.created_at;
      if (!touch) return newest;
      if (!newest) return touch;
      return touch > newest ? touch : newest;
    }, null);

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
  // AND check if it's stale relative to the newest clip's created_at
  useEffect(() => {
    let cancelled = false;

    fetchMergeStatus().then((data) => {
      if (cancelled || !data) return;

      setTotalCompletedClips(data.total_completed_clips || 0);
      setMergedVideoUrl(data.merged_video_url || null);
      setLastMergedAt(data.merge_updated_at || null);
      setErrorMessage(data.merge_error || null);

      const serverStatus = data.merge_status;

      // === STALENESS CHECK ===
      // Even if server says 'ready', the merge might be stale because clips
      // were added OR REGENERATED after the merge completed. Compare timestamps.
      const mergeIsStaleByTimestamp =
        serverStatus === 'ready' &&
        data.merge_updated_at &&
        newestClipTouchedAt &&
        newestClipTouchedAt > data.merge_updated_at;

      if (mergeIsStaleByTimestamp) {
        console.log(
          '[useSceneMerge] Merge is stale by timestamp:',
          `merge=${data.merge_updated_at}`,
          `newest_clip_touched=${newestClipTouchedAt}`
        );
        // Set status to stale and trigger a fresh merge
        setStatus('stale');
        if (autoMerge && !initialStalenessCheckedRef.current && completedClipCount > 0) {
          initialStalenessCheckedRef.current = true;
          // Trigger after a tiny delay to let React settle
          setTimeout(() => {
            if (!cancelled) triggerMerge();
          }, 100);
        }
        return;
      }

      // Map server status to hook status (no staleness detected)
      if (serverStatus === 'ready' && data.merged_video_url) {
        setStatus('ready');
      } else if (serverStatus === 'processing') {
        setStatus('processing');
      } else if (serverStatus === 'failed') {
        setStatus('failed');
      } else if (serverStatus === 'stale') {
        setStatus('stale');
        // If server itself says stale and we have clips, trigger merge
        if (autoMerge && !initialStalenessCheckedRef.current && completedClipCount > 0) {
          initialStalenessCheckedRef.current = true;
          setTimeout(() => {
            if (!cancelled) triggerMerge();
          }, 100);
        }
      } else if (data.total_completed_clips > 0) {
        setStatus('pending');
        // No merge exists yet — trigger one
        if (autoMerge && !initialStalenessCheckedRef.current) {
          initialStalenessCheckedRef.current = true;
          setTimeout(() => {
            if (!cancelled) triggerMerge();
          }, 100);
        }
      } else {
        setStatus('idle');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    sceneId,
    fetchMergeStatus,
    newestClipTouchedAt,
    autoMerge,
    completedClipCount,
    triggerMerge,
  ]);

  useEffect(() => {
    setTotalCompletedClips(completedClipCount);
  }, [completedClipCount]);

  // Detect clip changes — if completed clips changed, mark stale and queue merge
  useEffect(() => {
    if (lastClipSignatureRef.current === '') {
      lastClipSignatureRef.current = completedClipSignature;
      return;
    }

    if (lastClipSignatureRef.current === completedClipSignature) {
      return;
    }

    lastClipSignatureRef.current = completedClipSignature;

    if (status === 'ready') {
      setStatus('stale');
    }

    if (!autoMerge) return;
    if (completedClipCount === 0) return;
    if (isTriggeringRef.current) return;

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