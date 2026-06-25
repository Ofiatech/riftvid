'use client';

// useSceneMerge — React hook for Cloudinary scene merging
//
// v3 FIX (4.3.5b regenerate-staleness, June 2026)
// =============================================================================
// v2 fixed the case where clips were ADDED to a scene without invalidating
// the cached merge. v3 extends that to handle REGENERATED clips:
// when a clip is regenerated, its created_at stays the same — only updated_at
// changes — so v2's created_at-based staleness check missed regenerates.
//
// What v3 fixes:
//   1. Staleness check uses MAX(clip.updated_at) instead of MAX(created_at)
//      so regenerated clips are detected on page reload.
//   2. Don't trigger a merge while any clip is in flight (queued/processing).
//      Otherwise we'd merge an incomplete set during a regenerate (excluding
//      the clip being regenerated), then have to re-merge once it finishes.
//      That's the "stuck on merging" badge the user was seeing.

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
  // v2 staleness signal — detects clips ADDED to a scene after the last merge.
  created_at?: string;
  // v3 staleness signal — detects clips REGENERATED in a scene after the
  // last merge (regenerates touch updated_at but not created_at).
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
  const initialStalenessCheckedRef = useRef(false);

  const completedClipSignature = clips
    .filter((c) => c.status === 'completed' && c.generated_video_url)
    .map((c) => `${c.id}:${c.generated_video_url}`)
    .sort()
    .join('|');

  const completedClipCount = clips.filter(
    (c) => c.status === 'completed' && c.generated_video_url
  ).length;

  // v3 fix #2: if any clip is in flight (queued or processing), we should NOT
  // trigger a merge. Wait for it to finish — otherwise we'd produce an
  // intermediate merge missing that clip, then have to re-merge once it
  // completes. The user sees the "merging" badge longer than needed.
  const hasInFlightClips = clips.some(
    (c) => c.status === 'queued' || c.status === 'processing'
  );

  // v3 fix #1: compute newest "touch" timestamp across all completed clips.
  // Prefer updated_at (catches regenerates); fall back to created_at if the
  // backend didn't return updated_at for some reason. This is what we compare
  // against merge_updated_at for the on-mount staleness check.
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
  // AND check if it's stale relative to the newest clip touch (created OR
  // updated). This is the v3 fix: regenerates change updated_at but not
  // created_at, so we use whichever is newer per clip.
  useEffect(() => {
    let cancelled = false;

    fetchMergeStatus().then((data) => {
      if (cancelled || !data) return;

      setTotalCompletedClips(data.total_completed_clips || 0);
      setMergedVideoUrl(data.merged_video_url || null);
      setLastMergedAt(data.merge_updated_at || null);
      setErrorMessage(data.merge_error || null);

      const serverStatus = data.merge_status;

      // === STALENESS CHECK (v3) ===
      // Even if server says 'ready', the merge might be stale because clips
      // were added OR regenerated AFTER the merge completed. Compare the
      // newest clip touch timestamp against the merge's update timestamp.
      const mergeIsStaleByTimestamp =
        serverStatus === 'ready' &&
        data.merge_updated_at &&
        newestClipTouchedAt &&
        newestClipTouchedAt > data.merge_updated_at;

      if (mergeIsStaleByTimestamp) {
        console.log(
          '[useSceneMerge] Merge is stale by timestamp:',
          `merge=${data.merge_updated_at}`,
          `newest_clip_touch=${newestClipTouchedAt}`
        );
        setStatus('stale');
        // Belt-and-braces: clear the stale URL from state so the player
        // can't accidentally fall back to it if mergeReady flickers true.
        setMergedVideoUrl(null);
        if (
          autoMerge &&
          !initialStalenessCheckedRef.current &&
          completedClipCount > 0 &&
          !hasInFlightClips
        ) {
          initialStalenessCheckedRef.current = true;
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
        if (
          autoMerge &&
          !initialStalenessCheckedRef.current &&
          completedClipCount > 0 &&
          !hasInFlightClips
        ) {
          initialStalenessCheckedRef.current = true;
          setTimeout(() => {
            if (!cancelled) triggerMerge();
          }, 100);
        }
      } else if (data.total_completed_clips > 0) {
        setStatus('pending');
        if (
          autoMerge &&
          !initialStalenessCheckedRef.current &&
          !hasInFlightClips
        ) {
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
    hasInFlightClips,
    triggerMerge,
  ]);

  useEffect(() => {
    setTotalCompletedClips(completedClipCount);
  }, [completedClipCount]);

  // Detect clip changes — if completed clips changed, mark stale and queue
  // a debounced merge. v3 fix: ALSO require no in-flight clips. Otherwise a
  // regenerate fires this effect (because the clip dropped from the completed
  // set), the debounce timer queues a merge with only the OTHER clips, and we
  // get a useless intermediate merge before the regenerate finishes.
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
      // Clear the stale URL — see comment in mount effect for rationale
      setMergedVideoUrl(null);
    }

    if (!autoMerge) return;
    if (completedClipCount === 0) return;
    if (isTriggeringRef.current) return;
    // v3 fix #2: don't merge while clips are still being regenerated
    if (hasInFlightClips) {
      console.log(
        '[useSceneMerge] Skipping merge trigger — clips still in flight'
      );
      return;
    }

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
    hasInFlightClips,
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