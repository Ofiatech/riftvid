'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Loader2, Film, ArrowLeft, MoreVertical, Edit2, Trash2,
  Clock, Sparkles, Play, Pause, Link2, Upload, Wand2, Copy,
  RefreshCw, Image as ImageIcon, Download, Share2, Volume2, VolumeX, Check,
  X, Maximize2, FileVideo, AlertCircle, ChevronRight,
} from 'lucide-react';
import ClipGenerationModal from '@/components/ClipGenerationModal';
import { useSceneMerge } from '@/lib/useSceneMerge';
import MergeStatusBadge from '@/components/MergeStatusBadge';
import LastFrameExtractor from '@/components/LastFrameExtractor';
import ExportSheet from '@/components/ExportSheet';
import TierPickerModal from '@/components/TierPickerModal';

interface ClipItem {
  id: string;
  clip_order: number;
  source_image_url: string;
  source_type: 'upload' | 'last_frame' | 'library' | 'url';
  source_clip_id: string | null;
  // CHUNK 2 (Regenerate): these fields exist on the backend clip row already.
  // We declare them on the frontend type so editingClip can be passed to
  // ClipGenerationModal which needs them to pre-fill its state correctly.
  base_prompt: string | null;
  refined_prompt: string;
  rift_used: boolean;
  rift_answers: unknown;
  scene_description: string | null;
  duration: 5 | 10;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  generated_video_url: string | null;
  last_frame_url: string | null;
  error_message: string | null;
  created_at: string;
}

interface SceneDetail {
  id: string;
  scene_order: number;
  name: string | null;
  description: string | null;
  total_clips: number;
  total_duration: number;
  status: string;
  project_id: string;
  clips: ClipItem[];
}

interface ParentProject {
  id: string;
  name: string;
}

interface UserProfileData {
  credits_balance: number;
  credits_lifetime_used: number;
  subscription_tier: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// =============================================================================
// CINEMATIC PREVIEW PLAYER
// Treats all clips as ONE continuous scene with smart preload + total duration.
// When mergedVideoUrl is provided AND mergeReady is true → plays the merged
// video as a single seamless file (no clip transitions at all).
// =============================================================================
function PreviewPlayer({
  clips,
  activeClipIndex,
  setActiveClipIndex,
  autoPlay,
  onSceneEnded,
  mergedVideoUrl,
  mergeReady,
  pendingClipSeek,
}: {
  clips: ClipItem[];
  activeClipIndex: number;
  setActiveClipIndex: (idx: number) => void;
  autoPlay: boolean;
  onSceneEnded: () => void;
  mergedVideoUrl?: string | null;
  mergeReady?: boolean;
  // Parent signals a user-initiated seek (e.g. thumbnail tap) by changing the
  // nonce. The player seeks the merged video to that clip's start and briefly
  // suppresses the auto-sync effect to prevent a feedback loop. null = no seek.
  pendingClipSeek?: { clipIndex: number; nonce: number } | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const preloadRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  // When true, the auto-sync effect skips its work. Set true synchronously
  // when a user-initiated seek happens (thumbnail tap), cleared shortly after
  // so the video has time to update its currentTime before auto-sync resumes.
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [clipTime, setClipTime] = useState(0);
  const [clipDuration, setClipDuration] = useState(0);
  // While the user is actively scrubbing, the visible bar follows the finger
  // rather than the video's timeupdate (which lags slightly). null = not scrubbing.
  const [scrubbingFraction, setScrubbingFraction] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);

  const activeClip = clips[activeClipIndex] || null;
  const nextClip = clips[activeClipIndex + 1] || null;

  // SEAMLESS MODE: when merged video is ready, play that ONE file instead of clip-by-clip.
  const useSeamlessMerged = !!(mergeReady && mergedVideoUrl);

  const totalSceneDuration = clips
    .filter((c) => c.status === 'completed')
    .reduce((sum, c) => sum + c.duration, 0);

  const elapsedBeforeActive = clips
    .slice(0, activeClipIndex)
    .filter((c) => c.status === 'completed')
    .reduce((sum, c) => sum + c.duration, 0);

  const sceneProgress = totalSceneDuration > 0
    ? ((useSeamlessMerged ? clipTime : elapsedBeforeActive + clipTime) / totalSceneDuration) * 100
    : 0;

  useEffect(() => {
    // In clip-by-clip mode, switching clips reloads a new src → reset clipTime.
    // In merged mode, the same merged video keeps playing — DON'T reset, or
    // the progress bar visually jumps backwards every time the playhead
    // crosses a clip boundary during auto-sync.
    if (!useSeamlessMerged) {
      setClipTime(0);
    }
    const video = videoRef.current;
    if (!video) return;

    if (!useSeamlessMerged && (!activeClip?.generated_video_url || activeClip.status !== 'completed')) {
      setPlaying(false);
      return;
    }
    // autoPlay is only meaningful in clip-by-clip mode (it fires on auto-advance
    // between clips). In merged mode the single merged video plays continuously,
    // so re-triggering play() on every boundary cross is wasteful and can fight
    // the user's pause state.
    if (!useSeamlessMerged && autoPlay) {
      const t = setTimeout(() => {
        video.play().catch(() => setPlaying(false));
      }, 80);
      return () => clearTimeout(t);
    }
  }, [activeClip?.id, activeClip?.generated_video_url, activeClip?.status, autoPlay, useSeamlessMerged]);

  useEffect(() => {
    if (useSeamlessMerged) return;
    const preload = preloadRef.current;
    if (!preload || !nextClip?.generated_video_url || nextClip.status !== 'completed') return;
    if (preload.src !== nextClip.generated_video_url) {
      preload.src = nextClip.generated_video_url;
      preload.load();
    }
  }, [nextClip?.id, nextClip?.generated_video_url, nextClip?.status, useSeamlessMerged]);

  // === User-initiated seek (e.g. thumbnail tap) ===
  // Parent bumps the nonce to request a seek. We set seekingRef true BEFORE
  // touching video.currentTime so the auto-sync effect below (declared next)
  // sees the flag in the same render cycle and skips its run. seekingRef is
  // released after a short window so the auto-sync effect can resume tracking
  // the playhead naturally once timeupdate has caught up. Premiere-style:
  // we never force play/pause; the video's current play state is preserved.
  useEffect(() => {
    if (!pendingClipSeek || !useSeamlessMerged) return;
    const video = videoRef.current;
    if (!video) return;

    let runningTotal = 0;
    for (let i = 0; i < pendingClipSeek.clipIndex; i++) {
      const c = clips[i];
      if (c.status === 'completed') runningTotal += c.duration;
    }

    seekingRef.current = true;
    try {
      video.currentTime = runningTotal;
    } catch {
      /* not seekable yet */
    }

    const timer = setTimeout(() => {
      seekingRef.current = false;
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingClipSeek?.nonce, useSeamlessMerged]);

  // === Auto-sync activeClipIndex to playhead during merged playback ===
  // As the merged video plays, figure out which clip the current scene-time
  // falls into and update activeClipIndex so the timeline thumbnail follows.
  // Walks each clip using its actual duration, so any mix of clip lengths
  // (5s + 10s + 5s + 7s, whatever) is handled with the same code.
  //
  // Skipped while a user-initiated seek is in flight (seekingRef=true), so
  // we don't fight the seek with stale clipTime data.
  //
  // We read activeClipIndex via a ref (not closure) so the comparison
  // `i !== current` is always against the FRESHEST value. With closure-based
  // reads, the effect could see a stale activeClipIndex from a prior render
  // and call setActiveClipIndex(i) repeatedly even though state already
  // equals i — that was the "dancing thumbnails" bug.
  const activeClipIndexRef = useRef(activeClipIndex);
  useEffect(() => {
    activeClipIndexRef.current = activeClipIndex;
  }, [activeClipIndex]);

  useEffect(() => {
    if (!useSeamlessMerged) return;
    if (totalSceneDuration === 0) return;
    if (seekingRef.current) return;

    let runningTotal = 0;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (c.status !== 'completed') continue;
      const clipEnd = runningTotal + c.duration;
      // Pick this clip if playhead is inside its range, OR if it's the last
      // clip and the playhead is at or past its end (end-of-scene).
      if (clipTime < clipEnd || i === clips.length - 1) {
        if (i !== activeClipIndexRef.current) {
          setActiveClipIndex(i);
        }
        return;
      }
      runningTotal = clipEnd;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSeamlessMerged, clipTime, clips, totalSceneDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setClipTime(video.currentTime);
    const handleLoadedMeta = () => setClipDuration(video.duration);
    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleEnded = () => {
      setPlaying(false);
      if (useSeamlessMerged) {
        onSceneEnded();
        return;
      }
      if (activeClipIndex < clips.length - 1) {
        setActiveClipIndex(activeClipIndex + 1);
      } else {
        onSceneEnded();
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMeta);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMeta);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [activeClipIndex, clips.length, setActiveClipIndex, onSceneEnded, useSeamlessMerged]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) video.pause();
    else video.play().catch(() => {});
  };

  // === Mute toggle — wires the megaphone button ===
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const newMuted = !video.muted;
    video.muted = newMuted;
    setMuted(newMuted);
  };

  // === Fullscreen — iOS Safari needs the video element's webkitEnterFullscreen
  // specifically; container-level requestFullscreen doesn't work on iPhone. ===
  const requestFullscreen = () => {
    const video = videoRef.current as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitRequestFullscreen?: () => void;
        })
      | null;
    if (!video) return;
    if (typeof video.webkitEnterFullscreen === 'function') {
      video.webkitEnterFullscreen();
      return;
    }
    if (typeof video.requestFullscreen === 'function') {
      video.requestFullscreen().catch(() => {});
      return;
    }
    if (typeof video.webkitRequestFullscreen === 'function') {
      video.webkitRequestFullscreen();
    }
  };

  // === Seek to a scene-time fraction (0-1). Used by both the scrubber and
  // by future programmatic seeks. Premiere-style: never forces play or pause. ===
  const seekToFraction = (fraction: number) => {
    if (totalSceneDuration === 0) return;
    const clamped = Math.max(0, Math.min(1, fraction));
    const targetSceneTime = clamped * totalSceneDuration;

    if (useSeamlessMerged) {
      const video = videoRef.current;
      if (!video) return;
      try {
        video.currentTime = targetSceneTime;
      } catch {
        /* not yet seekable */
      }
      return;
    }

    // Clip-by-clip fallback: figure out which clip and seek within it
    let runningTotal = 0;
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      if (clip.status !== 'completed') continue;
      if (targetSceneTime <= runningTotal + clip.duration) {
        const timeInClip = targetSceneTime - runningTotal;
        if (i !== activeClipIndex) {
          setActiveClipIndex(i);
          setTimeout(() => {
            const video = videoRef.current;
            if (video) {
              try {
                video.currentTime = timeInClip;
              } catch {
                /* not seekable yet */
              }
            }
          }, 100);
        } else {
          const video = videoRef.current;
          if (video) {
            try {
              video.currentTime = timeInClip;
            } catch {
              /* not seekable yet */
            }
          }
        }
        return;
      }
      runningTotal += clip.duration;
    }
  };

  // === Scrubber pointer handlers (tap + drag, mouse + touch) ===
  const fractionFromPointer = (clientX: number): number | null => {
    const el = scrubRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return null;
    return (clientX - rect.left) / rect.width;
  };

  const handleScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const fraction = fractionFromPointer(e.clientX);
    if (fraction === null) return;
    setScrubbingFraction(Math.max(0, Math.min(1, fraction)));
    seekToFraction(fraction);
    // Capture the pointer so drag keeps working even if the finger leaves the bar
    scrubRef.current?.setPointerCapture(e.pointerId);
  };

  const handleScrubPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbingFraction === null) return;
    const fraction = fractionFromPointer(e.clientX);
    if (fraction === null) return;
    setScrubbingFraction(Math.max(0, Math.min(1, fraction)));
    seekToFraction(fraction);
  };

  const handleScrubPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbingFraction === null) return;
    setScrubbingFraction(null);
    try {
      scrubRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer might already be released */
    }
  };

  if (!activeClip) {
    return (
      <div className="relative w-full h-full rounded-2xl overflow-hidden border border-[#1f2937] bg-gradient-to-br from-[#1a1530] via-[#0a0a0b] to-[#050505] flex items-center justify-center">
        <div className="text-center px-6">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3 mx-auto">
            <FileVideo className="w-7 h-7 text-purple-300" strokeWidth={1.5} />
          </div>
          <div className="text-[14px] font-semibold text-white mb-1">No clips yet</div>
          <div className="text-[11px] text-zinc-400">Generate your first clip to start your scene</div>
        </div>
      </div>
    );
  }

  if (!useSeamlessMerged && (activeClip.status !== 'completed' || !activeClip.generated_video_url)) {
    return (
      <div className="relative w-full h-full rounded-2xl overflow-hidden border border-purple-500/30 bg-[#0a0a0b]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={activeClip.source_image_url}
          alt="Clip preview"
          className="w-full h-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {activeClip.status === 'failed' ? (
            <>
              <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center mb-3">
                <AlertCircle className="w-6 h-6 text-rose-300" strokeWidth={1.75} />
              </div>
              <div className="text-[14px] font-semibold text-rose-200 mb-1">Generation failed</div>
              <div className="text-[11px] text-zinc-400 max-w-xs text-center px-4">
                {activeClip.error_message || 'Something went wrong'}
              </div>
              <div className="text-[10px] text-emerald-300 mt-2 flex items-center gap-1">
                <Check className="w-3 h-3" strokeWidth={2.5} />
                Credits refunded
              </div>
            </>
          ) : (
            <>
              <Loader2 className="w-12 h-12 text-purple-300 animate-spin mb-3" strokeWidth={1.75} />
              <div className="text-[14px] font-semibold text-white mb-1">
                {activeClip.status === 'processing' ? 'Rendering clip...' : 'In queue...'}
              </div>
              <div className="text-[11px] text-purple-300">
                Clip {activeClipIndex + 1} of {clips.length}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const videoSrc = useSeamlessMerged ? mergedVideoUrl! : activeClip.generated_video_url!;

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-[#1f2937] bg-black group">
      <video
        ref={videoRef}
        src={videoSrc}
        poster={activeClip.source_image_url}
        className="w-full h-full object-contain"
        playsInline
        preload="auto"
        onClick={togglePlay}
      />

      <video
        ref={preloadRef}
        muted
        playsInline
        preload="auto"
        className="hidden"
      />

      {!playing && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center group/play"
        >
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-2xl group-hover/play:scale-110 group-hover/play:bg-white/20 transition-all duration-300">
            <Play className="w-6 h-6 sm:w-8 sm:h-8 text-white fill-white ml-1" strokeWidth={0} />
          </div>
        </button>
      )}

      <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-semibold text-white">
        <span className={`w-1.5 h-1.5 rounded-full ${useSeamlessMerged ? 'bg-emerald-400' : 'bg-purple-400 animate-pulse'}`} />
        {useSeamlessMerged
          ? `Seamless scene · ${clips.length} clips`
          : `Clip ${activeClipIndex + 1} of ${clips.length}`}
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 sm:p-4">
        {(() => {
          const displayProgress =
            scrubbingFraction !== null ? scrubbingFraction * 100 : sceneProgress;
          return (
            <div
              ref={scrubRef}
              onPointerDown={handleScrubPointerDown}
              onPointerMove={handleScrubPointerMove}
              onPointerUp={handleScrubPointerUp}
              onPointerCancel={handleScrubPointerUp}
              // touch-none stops the browser from interpreting horizontal touch
              // drags as page scroll, which was eating the scrub gesture entirely.
              // The negative margin enlarges the touch target without changing
              // the visual height.
              className="relative h-3 -my-[3px] mb-2 cursor-pointer touch-none group/scrub"
            >
              {/* Visual bar centered inside the larger hit area */}
              <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5">
                <div className="absolute inset-0 rounded-full bg-white/15" />
                {clips
                  .filter((c) => c.status === 'completed')
                  .map((clip, idx, arr) => {
                    if (idx === arr.length - 1) return null;
                    const beforeDuration = arr.slice(0, idx + 1).reduce((s, c) => s + c.duration, 0);
                    const tickPct = (beforeDuration / totalSceneDuration) * 100;
                    return (
                      <div
                        key={clip.id}
                        className="absolute top-0 bottom-0 w-px bg-black/50"
                        style={{ left: `${tickPct}%` }}
                      />
                    );
                  })}
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-purple-400 to-blue-400 transition-[width] duration-100"
                  style={{ width: `${displayProgress}%` }}
                />
                <div
                  className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg transition-opacity ${
                    scrubbingFraction !== null ? 'opacity-100' : 'opacity-0 group-hover/scrub:opacity-100'
                  }`}
                  style={{ left: `calc(${displayProgress}% - 6px)` }}
                />
              </div>
            </div>
          );
        })()}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center hover:bg-white/25 transition-all active:scale-95"
            >
              {playing ? (
                <Pause className="w-3.5 h-3.5 text-white fill-white" strokeWidth={0} />
              ) : (
                <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" strokeWidth={0} />
              )}
            </button>
            <div className="text-[10px] text-white/90 font-mono tabular-nums">
              {formatTime(useSeamlessMerged ? clipTime : (elapsedBeforeActive + clipTime))} / {formatTime(totalSceneDuration)}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleMute}
              className="w-8 h-8 rounded-full hover:bg-white/15 transition-colors flex items-center justify-center"
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? (
                <VolumeX className="w-3.5 h-3.5 text-white/80" strokeWidth={2} />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-white/80" strokeWidth={2} />
              )}
            </button>
            <button
              onClick={requestFullscreen}
              className="w-8 h-8 rounded-full hover:bg-white/15 transition-colors flex items-center justify-center"
              aria-label="Fullscreen"
            >
              <Maximize2 className="w-3.5 h-3.5 text-white/80" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// CINEMATIC TIMELINE CLIP CARD
// =============================================================================
function TimelineClipCard({
  clip,
  index,
  isActive,
  onSelect,
}: {
  clip: ClipItem;
  index: number;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`relative shrink-0 transition-all duration-200 ease-out ${
        isActive
          ? 'w-[60px] sm:w-[68px] lg:w-[96px] z-10'
          : 'w-[56px] sm:w-[64px] lg:w-[88px] opacity-65 hover:opacity-100'
      }`}
    >
      <div
        className={`relative aspect-[9/16] lg:aspect-video rounded-xl overflow-hidden border-2 transition-all duration-300 ${
          isActive
            ? 'border-purple-400 shadow-2xl shadow-purple-500/40'
            : 'border-[#1f2937] hover:border-[#2d3748]'
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={clip.source_image_url}
          alt={`Clip ${index + 1}`}
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />

        <div
          className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border-2 transition-all ${
            isActive
              ? 'bg-purple-500 border-white text-white shadow-lg'
              : 'bg-black/60 border-white/30 text-white backdrop-blur-md'
          }`}
        >
          {index + 1}
        </div>

        {clip.status === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <Loader2 className="w-5 h-5 text-purple-300 animate-spin" strokeWidth={2} />
          </div>
        )}
        {clip.status === 'queued' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <Clock className="w-5 h-5 text-zinc-300" strokeWidth={2} />
          </div>
        )}
        {clip.status === 'failed' && (
          <div className="absolute inset-0 flex items-center justify-center bg-rose-950/60 backdrop-blur-[2px]">
            <AlertCircle className="w-5 h-5 text-rose-300" strokeWidth={2} />
          </div>
        )}
        {clip.status === 'completed' && isActive && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-8 h-8 rounded-full bg-white/15 backdrop-blur-md border border-white/30 flex items-center justify-center">
              <Play className="w-3 h-3 text-white fill-white ml-0.5" strokeWidth={0} />
            </div>
          </div>
        )}

        {clip.source_type === 'last_frame' && (
          <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-purple-500/80 backdrop-blur-md border border-white/30 flex items-center justify-center">
            <Link2 className="w-2 h-2 text-white" strokeWidth={2.5} />
          </div>
        )}

        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-[8px] font-bold text-white border border-white/10">
          {clip.duration}s
        </div>
      </div>
    </button>
  );
}

// =============================================================================
// PLUS CONNECTOR
// =============================================================================
function PlusConnector({
  onClick,
  variant = 'between',
  hasChainOption,
}: {
  onClick: () => void;
  variant?: 'between' | 'end';
  hasChainOption?: boolean;
}) {
  if (variant === 'end') {
    return (
      <button
        onClick={onClick}
        className="shrink-0 w-[90px] sm:w-[110px] aspect-video rounded-xl border-2 border-dashed border-purple-500/40 bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.04] hover:border-purple-500/60 hover:bg-purple-500/[0.12] active:scale-95 flex flex-col items-center justify-center gap-1 transition-all group"
      >
        <div className="w-7 h-7 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center group-hover:scale-110 transition-transform">
          <Plus className="w-3.5 h-3.5 text-purple-200" strokeWidth={2.5} />
        </div>
        <div className="text-[9px] font-semibold text-purple-200">Add clip</div>
        {hasChainOption && (
          <div className="text-[7px] text-purple-300/70 flex items-center gap-0.5">
            <Link2 className="w-2 h-2" strokeWidth={2.5} />
            Chains
          </div>
        )}
      </button>
    );
  }

  return (
    <div className="shrink-0 flex items-center justify-center px-1 sm:px-1.5">
      <button
        onClick={onClick}
        className="w-7 h-7 rounded-full bg-[#0a0a0b] border border-purple-500/40 hover:border-purple-400 hover:bg-purple-500/10 active:scale-90 flex items-center justify-center transition-all group relative"
      >
        <Plus className="w-3.5 h-3.5 text-purple-300 group-hover:text-purple-200" strokeWidth={2.5} />
        <div className="absolute inset-0 rounded-full bg-purple-500/20 blur-md scale-150 opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
      </button>
    </div>
  );
}

// =============================================================================
// ADD CLIP ACTION SHEET — NO BLUR, drawer slides up cleanly
// =============================================================================
function AddClipActionSheet({
  open,
  onClose,
  onPickAction,
  canChain,
}: {
  open: boolean;
  onClose: () => void;
  onPickAction: (action: 'chain' | 'upload' | 'prompt' | 'url' | 'transition') => void;
  canChain: boolean;
}) {
  if (!open) return null;

  const options = [
    {
      id: 'chain' as const,
      icon: Link2,
      title: 'Continue from previous',
      desc: 'Chain seamlessly using last frame',
      color: 'purple',
      disabled: !canChain,
    },
    {
      id: 'upload' as const,
      icon: Upload,
      title: 'Upload new reference',
      desc: 'Use a fresh image for this clip',
      color: 'blue',
      disabled: false,
    },
    {
      id: 'prompt' as const,
      icon: Wand2,
      title: 'Generate from prompt',
      desc: 'Create from text description',
      color: 'pink',
      disabled: false,
    },
    {
      id: 'url' as const,
      icon: ImageIcon,
      title: 'Import from URL',
      desc: 'Use an image from the web',
      color: 'emerald',
      disabled: false,
    },
    {
      id: 'transition' as const,
      icon: Sparkles,
      title: 'Add transition shot',
      desc: 'Coming soon — v2 feature',
      color: 'amber',
      disabled: true,
    },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        className="fixed left-0 right-0 bottom-0 z-50 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:bottom-4 sm:max-w-md sm:rounded-3xl rounded-t-3xl border-t border-x sm:border border-purple-500/20 bg-[#0a0a0b] shadow-2xl shadow-purple-500/20"
        style={{
          animation: 'slideUpSheet 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          maxHeight: '60vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-1.5">
                <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
                Add Next Clip
              </div>
              <h2 className="text-[16px] font-semibold text-white tracking-tight">
                How do you want to continue?
              </h2>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-white/[0.05] transition-colors flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5 text-zinc-400" strokeWidth={2} />
            </button>
          </div>

          <div className="space-y-1.5">
            {options.map((opt) => {
              const Icon = opt.icon;
              const colorClass = {
                purple: 'bg-purple-500/15 border-purple-500/30 text-purple-300',
                blue: 'bg-blue-500/15 border-blue-500/30 text-blue-300',
                pink: 'bg-pink-500/15 border-pink-500/30 text-pink-300',
                emerald: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
                amber: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
              }[opt.color];

              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    if (opt.disabled) return;
                    onPickAction(opt.id);
                  }}
                  disabled={opt.disabled}
                  className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl border transition-all text-left ${
                    opt.disabled
                      ? 'border-[#1f2937] bg-white/[0.01] opacity-40 cursor-not-allowed'
                      : 'border-[#1f2937] bg-white/[0.02] hover:bg-white/[0.05] hover:border-[#2d3748] active:scale-[0.98]'
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${colorClass}`}
                  >
                    <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-white flex items-center gap-1.5">
                      {opt.title}
                      {opt.id === 'chain' && !opt.disabled && (
                        <span className="text-[7px] font-bold px-1 py-0.5 rounded-full bg-purple-500/30 text-purple-100 border border-purple-500/40">
                          BEST
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-0.5">{opt.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// CLIP ACTION DRAWER — RICH STATS RESTORED, NO BLUR
// =============================================================================
function ClipActionDrawer({
  open,
  onClose,
  clip,
  clipIndex,
  onDelete,
  onDuplicate,
  onReplace,
  onRegenerate,
  onDownload,
}: {
  open: boolean;
  onClose: () => void;
  clip: ClipItem | null;
  clipIndex: number;
  onDelete: () => void;
  onDuplicate: () => void;
  onReplace: () => void;
  onRegenerate: () => void;
  onDownload: () => void;
}) {
  if (!open || !clip) return null;

  const actions = [
    {
      id: 'regenerate',
      icon: Sparkles,
      label: 'Regenerate',
      desc: 'Edit prompt & remake',
      onClick: onRegenerate,
      color: 'purple',
      disabled: clip.status === 'processing' || clip.status === 'queued',
    },
    {
      id: 'replace',
      icon: RefreshCw,
      label: 'Replace',
      desc: 'New source image',
      onClick: onReplace,
      color: 'emerald',
      disabled: clip.status === 'processing' || clip.status === 'queued',
    },
    {
      id: 'duplicate',
      icon: Copy,
      label: 'Duplicate',
      desc: 'Copy this clip',
      onClick: onDuplicate,
      color: 'blue',
      disabled: clip.status !== 'completed',
    },
    {
      id: 'download',
      icon: Download,
      label: 'Download',
      desc: 'Save MP4 file',
      onClick: onDownload,
      color: 'amber',
      disabled: clip.status !== 'completed',
    },
  ];

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />

      <div
        className="fixed left-0 right-0 bottom-0 z-40 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:bottom-4 sm:max-w-2xl sm:rounded-3xl rounded-t-3xl border-t border-x sm:border border-purple-500/20 bg-[#0a0a0b] shadow-2xl shadow-purple-500/20"
        style={{
          animation: 'slideUpSheet 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          maxHeight: '60vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between mb-4">
            <div className="min-w-0 flex-1 pr-2">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-1.5">
                <Film className="w-2.5 h-2.5" strokeWidth={2.5} />
                Clip {clipIndex + 1} selected
              </div>
              <h2 className="text-[16px] font-semibold text-white tracking-tight">
                Edit this clip
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">
                {clip.refined_prompt}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-white/[0.05] transition-colors flex items-center justify-center shrink-0"
            >
              <X className="w-3.5 h-3.5 text-zinc-400" strokeWidth={2} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-lg bg-white/[0.02] border border-[#1f2937] p-2">
              <div className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">
                Duration
              </div>
              <div className="text-[13px] font-bold text-white">{clip.duration}s</div>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-[#1f2937] p-2">
              <div className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">
                Source
              </div>
              <div className="text-[10px] font-semibold text-white flex items-center gap-1">
                {clip.source_type === 'last_frame' ? (
                  <>
                    <Link2 className="w-2.5 h-2.5 text-purple-300" strokeWidth={2.5} />
                    Chain
                  </>
                ) : clip.source_type === 'upload' ? (
                  <>
                    <Upload className="w-2.5 h-2.5" strokeWidth={2.5} />
                    Upload
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-2.5 h-2.5" strokeWidth={2.5} />
                    Library
                  </>
                )}
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-[#1f2937] p-2">
              <div className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">
                Status
              </div>
              <div
                className={`text-[10px] font-semibold flex items-center gap-1 ${
                  clip.status === 'completed'
                    ? 'text-emerald-300'
                    : clip.status === 'processing' || clip.status === 'queued'
                    ? 'text-purple-300'
                    : 'text-rose-300'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    clip.status === 'completed'
                      ? 'bg-emerald-400'
                      : clip.status === 'processing' || clip.status === 'queued'
                      ? 'bg-purple-400 animate-pulse'
                      : 'bg-rose-400'
                  }`}
                />
                {clip.status === 'completed'
                  ? 'Ready'
                  : clip.status === 'processing'
                  ? 'Rendering'
                  : clip.status === 'queued'
                  ? 'Queued'
                  : 'Failed'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2">
            {actions.map((action) => {
              const Icon = action.icon;
              const colorClass = {
                purple: 'border-purple-500/30 bg-purple-500/[0.05]',
                emerald: 'border-emerald-500/30 bg-emerald-500/[0.05]',
                blue: 'border-blue-500/30 bg-blue-500/[0.05]',
                amber: 'border-amber-500/30 bg-amber-500/[0.05]',
              }[action.color];
              const iconColorClass = {
                purple: 'text-purple-300',
                emerald: 'text-emerald-300',
                blue: 'text-blue-300',
                amber: 'text-amber-300',
              }[action.color];

              return (
                <button
                  key={action.id}
                  onClick={() => {
                    if (action.disabled) return;
                    action.onClick();
                  }}
                  disabled={action.disabled}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all text-left ${
                    action.disabled
                      ? 'border-[#1f2937] bg-white/[0.01] opacity-40 cursor-not-allowed'
                      : `${colorClass} hover:scale-[1.02] active:scale-95`
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${iconColorClass} shrink-0`} strokeWidth={2} />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-white truncate">
                      {action.label}
                    </div>
                    <div className="text-[9px] text-zinc-400 truncate">{action.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <button
            onClick={onDelete}
            className="w-full flex items-center gap-2 p-2.5 rounded-xl border border-rose-500/30 bg-rose-500/[0.05] hover:bg-rose-500/10 active:scale-[0.98] transition-all"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-300 shrink-0" strokeWidth={2} />
            <div className="flex-1 text-left min-w-0">
              <div className="text-[11px] font-semibold text-rose-200">Delete clip</div>
              <div className="text-[9px] text-zinc-400">Remove from this scene</div>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// DESKTOP CLIP DETAILS PANEL (right side, persistent — no drawer)
// =============================================================================
function DesktopClipPanel({
  clip,
  clipIndex,
  totalClips,
  onDelete,
  onDuplicate,
  onReplace,
  onRegenerate,
  onDownload,
}: {
  clip: ClipItem | null;
  clipIndex: number;
  totalClips: number;
  onDelete: () => void;
  onDuplicate: () => void;
  onReplace: () => void;
  onRegenerate: () => void;
  onDownload: () => void;
}) {
  if (!clip) {
    return (
      <div className="h-full rounded-2xl border border-[#1f2937] bg-[#0a0a0b]/40 backdrop-blur-sm p-5 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3">
          <Film className="w-5 h-5 text-purple-300" strokeWidth={1.5} />
        </div>
        <div className="text-[12px] font-semibold text-white mb-1">No clip selected</div>
        <div className="text-[10px] text-zinc-400">
          Generate a clip or select one from the timeline
        </div>
      </div>
    );
  }

  const actions = [
    {
      id: 'regenerate',
      icon: Sparkles,
      label: 'Regenerate',
      desc: 'Edit prompt & remake',
      onClick: onRegenerate,
      color: 'purple',
      disabled: clip.status === 'processing' || clip.status === 'queued',
    },
    {
      id: 'replace',
      icon: RefreshCw,
      label: 'Replace',
      desc: 'New source image',
      onClick: onReplace,
      color: 'emerald',
      disabled: clip.status === 'processing' || clip.status === 'queued',
    },
    {
      id: 'duplicate',
      icon: Copy,
      label: 'Duplicate',
      desc: 'Copy this clip',
      onClick: onDuplicate,
      color: 'blue',
      disabled: clip.status !== 'completed',
    },
    {
      id: 'download',
      icon: Download,
      label: 'Download',
      desc: 'Save MP4 file',
      onClick: onDownload,
      color: 'amber',
      disabled: clip.status !== 'completed',
    },
  ];

  return (
    <div className="h-full rounded-2xl border border-[#1f2937] bg-[#0a0a0b]/40 backdrop-blur-sm p-4 flex flex-col overflow-hidden">
      <div className="mb-3">
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-1.5">
          <Film className="w-2.5 h-2.5" strokeWidth={2.5} />
          Clip {clipIndex + 1} of {totalClips}
        </div>
        <h3 className="text-[14px] font-semibold text-white tracking-tight">
          Clip details
        </h3>
        <p className="text-[10px] text-zinc-400 mt-1 line-clamp-3 leading-relaxed">
          {clip.refined_prompt}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <div className="rounded-lg bg-white/[0.02] border border-[#1f2937] p-2">
          <div className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">
            Duration
          </div>
          <div className="text-[12px] font-bold text-white">{clip.duration}s</div>
        </div>
        <div className="rounded-lg bg-white/[0.02] border border-[#1f2937] p-2">
          <div className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">
            Source
          </div>
          <div className="text-[10px] font-semibold text-white flex items-center gap-1">
            {clip.source_type === 'last_frame' ? (
              <>
                <Link2 className="w-2.5 h-2.5 text-purple-300" strokeWidth={2.5} />
                Chain
              </>
            ) : clip.source_type === 'upload' ? (
              <>
                <Upload className="w-2.5 h-2.5" strokeWidth={2.5} />
                Upload
              </>
            ) : (
              <>
                <ImageIcon className="w-2.5 h-2.5" strokeWidth={2.5} />
                Library
              </>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.02] border border-[#1f2937] p-2">
          <div className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">
            Status
          </div>
          <div
            className={`text-[10px] font-semibold flex items-center gap-1 ${
              clip.status === 'completed'
                ? 'text-emerald-300'
                : clip.status === 'processing' || clip.status === 'queued'
                ? 'text-purple-300'
                : 'text-rose-300'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                clip.status === 'completed'
                  ? 'bg-emerald-400'
                  : clip.status === 'processing' || clip.status === 'queued'
                  ? 'bg-purple-400 animate-pulse'
                  : 'bg-rose-400'
              }`}
            />
            {clip.status === 'completed'
              ? 'Ready'
              : clip.status === 'processing'
              ? 'Rendering'
              : clip.status === 'queued'
              ? 'Queued'
              : 'Failed'}
          </div>
        </div>
      </div>

      <div className="space-y-1.5 flex-1 overflow-y-auto">
        {actions.map((action) => {
          const Icon = action.icon;
          const colorClass = {
            purple: 'border-purple-500/30 bg-purple-500/[0.05]',
            emerald: 'border-emerald-500/30 bg-emerald-500/[0.05]',
            blue: 'border-blue-500/30 bg-blue-500/[0.05]',
            amber: 'border-amber-500/30 bg-amber-500/[0.05]',
          }[action.color];
          const iconColorClass = {
            purple: 'text-purple-300',
            emerald: 'text-emerald-300',
            blue: 'text-blue-300',
            amber: 'text-amber-300',
          }[action.color];

          return (
            <button
              key={action.id}
              onClick={() => {
                if (action.disabled) return;
                action.onClick();
              }}
              disabled={action.disabled}
              className={`w-full flex items-center gap-2 p-2.5 rounded-xl border transition-all text-left ${
                action.disabled
                  ? 'border-[#1f2937] bg-white/[0.01] opacity-40 cursor-not-allowed'
                  : `${colorClass} hover:scale-[1.01] active:scale-[0.99]`
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${iconColorClass} shrink-0`} strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-white truncate">
                  {action.label}
                </div>
                <div className="text-[9px] text-zinc-400 truncate">{action.desc}</div>
              </div>
              <ChevronRight className="w-3 h-3 text-zinc-600" strokeWidth={2} />
            </button>
          );
        })}

        <button
          onClick={onDelete}
          className="w-full flex items-center gap-2 p-2.5 rounded-xl border border-rose-500/30 bg-rose-500/[0.05] hover:bg-rose-500/10 active:scale-[0.98] transition-all"
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-300 shrink-0" strokeWidth={2} />
          <div className="flex-1 text-left min-w-0">
            <div className="text-[11px] font-semibold text-rose-200">Delete clip</div>
            <div className="text-[9px] text-zinc-400">Remove from this scene</div>
          </div>
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================
export default function SceneStudioPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const sceneId = params.sceneId as string;

  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [parentProject, setParentProject] = useState<ParentProject | null>(null);
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeClipIndex, setActiveClipIndexState] = useState(0);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [addActionSheetOpen, setAddActionSheetOpen] = useState(false);
  const [clipDrawerOpen, setClipDrawerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'idle'>('saved');
  const [autoPlayActiveClip, setAutoPlayActiveClip] = useState(false);

  // === CHAIN MOAT: Remember which action user picked in the action sheet ===
  // The action sheet has 4 options; we need to pre-select the matching tab
  // in ClipGenerationModal. Without this, every action just opens "Upload"
  // which defeats the purpose of "Continue from previous".
  const [pendingSourceType, setPendingSourceType] = useState<'upload' | 'last_frame' | 'library' | 'url'>('upload');

  // === CHUNK 2 (Regenerate): when set, ClipGenerationModal opens in regenerate
  // mode. Pre-fills all state from this clip's existing data and submits via
  // PATCH with regenerate:true instead of POST. Same clip_id preserved (clip
  // stays in place on timeline). Cleared on modal close.
  const [editingClip, setEditingClip] = useState<ClipItem | null>(null);

  // === USER-INITIATED PLAYER SEEK ===
  // When user taps a thumbnail and merged playback is active, we set this
  // so the player seeks the merged video to that clip's start. Using a nonce
  // (rather than just clipIndex) lets the same clip be re-tapped repeatedly.
  const [pendingClipSeek, setPendingClipSeek] = useState<{ clipIndex: number; nonce: number } | null>(null);

  const setActiveClipIndex = (idx: number) => {
    setActiveClipIndexState(idx);
  };

  // === CLOUDINARY SCENE MERGE ===
  // NOTE: v2 hook also reads created_at to detect when the merged file is
  // older than the newest clip (e.g. after chain-generating a new clip).
  const merge = useSceneMerge(
    projectId,
    sceneId,
    scene?.clips.map((c) => ({
      id: c.id,
      status: c.status,
      generated_video_url: c.generated_video_url,
      created_at: c.created_at,
    })) || [],
    { autoMerge: true, debounceMs: 3000 }
  );

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/profile');
      if (!res.ok) return;
      const data = await res.json();
      setProfile(data);
    } catch (err) {
      console.error('Profile fetch error:', err);
    }
  }, []);

  const fetchScene = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`);
      if (!res.ok) {
        if (res.status === 404) setError('Scene not found');
        else throw new Error('Failed to fetch scene');
        return;
      }
      const data = await res.json();
      setScene(data);
      setEditName(data.name || `Scene ${data.scene_order}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scene');
    } finally {
      setLoading(false);
    }
  }, [projectId, sceneId]);

  const fetchParentProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      setParentProject({ id: data.id, name: data.name });
    } catch (err) {
      console.error('Parent project fetch error:', err);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProfile();
    fetchScene();
    fetchParentProject();
  }, [fetchProfile, fetchScene, fetchParentProject]);

  useEffect(() => {
    if (!scene) return;
    const hasProcessing = scene.clips.some(
      (c) => c.status === 'queued' || c.status === 'processing'
    );
    if (!hasProcessing) return;
    const interval = setInterval(fetchScene, 5000);
    return () => clearInterval(interval);
  }, [scene, fetchScene]);

  useEffect(() => {
    if (!scene) return;
    if (scene.clips.length === 0) {
      setActiveClipIndexState(0);
    } else if (activeClipIndex >= scene.clips.length) {
      setActiveClipIndexState(scene.clips.length - 1);
    }
  }, [scene, activeClipIndex]);

  const handleClipSelect = (index: number) => {
    if (index === activeClipIndex) {
      setClipDrawerOpen(true);
    } else {
      setActiveClipIndexState(index);
      setAutoPlayActiveClip(false);
      setClipDrawerOpen(false);
      // If merged playback is active, ask the player to seek to this clip's
      // start in the merged file. Premiere-style — preserves current play state.
      if (merge.status === 'ready') {
        setPendingClipSeek({ clipIndex: index, nonce: Date.now() });
      }
    }
  };

  const handleSceneEnded = () => {
    setAutoPlayActiveClip(false);
  };

  const handleAdvanceFromPlayer = useCallback((newIdx: number) => {
    setAutoPlayActiveClip(true);
    setActiveClipIndexState(newIdx);
  }, []);

  // Default "+" tap (timeline + buttons, floating + button) — opens action sheet.
  // User then picks from "Continue from previous", "Upload new reference", etc.
  const handleAddClick = () => {
    setAddActionSheetOpen(true);
  };

  // === CHAIN MOAT: action sheet pick → pre-select correct modal tab ===
  // This is the fix for the bug founder caught: previously, ALL action sheet
  // picks ignored the action and opened the modal in default "Upload" mode.
  // Now we honor the user's intent and route them to the right tab.
  const handlePickAddAction = (
    action: 'chain' | 'upload' | 'prompt' | 'url' | 'transition'
  ) => {
    if (action === 'chain') {
      setPendingSourceType('last_frame');
    } else if (action === 'url') {
      // CHUNK 1 (Bug 2): URL action now opens its dedicated URL tab in the modal.
      setPendingSourceType('url');
    } else {
      // 'upload' and 'prompt' still fall back to upload tab.
      // Prompt will get its own routing in Chunk 3 (4.3.5b).
      setPendingSourceType('upload');
    }
    setAddActionSheetOpen(false);
    setGenerateModalOpen(true);
  };

  const handleDeleteClip = async (clipId: string) => {
    if (!confirm('Delete this clip? This cannot be undone.')) return;
    setAutoSaveStatus('saving');
    try {
      const res = await fetch(
        `/api/projects/${projectId}/scenes/${sceneId}/clips/${clipId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Failed to delete');
      setClipDrawerOpen(false);
      await fetchScene();
      setAutoSaveStatus('saved');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
      setAutoSaveStatus('idle');
    }
  };

  const handleDeleteScene = async () => {
    if (
      !confirm(
        'Delete this entire scene? All clips inside will be deleted. This cannot be undone.'
      )
    )
      return;
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete scene');
      router.push(`/studio/${projectId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleSaveName = async () => {
    if (!scene) return;
    const trimmed = editName.trim();
    const original = scene.name || `Scene ${scene.scene_order}`;
    if (trimmed === original || !trimmed) {
      setEditName(original);
      setEditingName(false);
      return;
    }
    setAutoSaveStatus('saving');
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error('Failed to rename');
      setEditingName(false);
      await fetchScene();
      setAutoSaveStatus('saved');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to rename');
      setEditName(original);
      setEditingName(false);
      setAutoSaveStatus('idle');
    }
  };

  const handleDownloadClip = () => {
    const clip = scene?.clips[activeClipIndex];
    if (!clip?.generated_video_url) return;
    const a = document.createElement('a');
    a.href = clip.generated_video_url;
    a.download = `riftvid-clip-${clip.clip_order}.mp4`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDuplicateClip = () => {
    alert('🚧 Duplicate coming in v2 — for now you can regenerate with the same prompt.');
  };

  // CHUNK 2 (Regenerate): Replace and Regenerate both open the modal in
  // regenerate mode by passing the active clip via setEditingClip. The modal
  // pre-fills all state from the clip's existing data and submits via PATCH
  // when the user confirms. Same clip_id is preserved (clip stays in place
  // on the timeline). Same handler for both buttons — the spec doesn't
  // distinguish them yet; if we ever do, branch here.
  const handleReplaceClip = () => {
    const activeClip = scene?.clips[activeClipIndex];
    if (!activeClip) return;
    setClipDrawerOpen(false);
    // pendingSourceType still seeds initialSourceType for fresh flows; the
    // modal ignores it when editingClip is set and uses editingClip.source_type
    setPendingSourceType('upload');
    setEditingClip(activeClip);
    setGenerateModalOpen(true);
  };

  const handleRegenerateClip = () => {
    const activeClip = scene?.clips[activeClipIndex];
    if (!activeClip) return;
    setClipDrawerOpen(false);
    setPendingSourceType('upload');
    setEditingClip(activeClip);
    setGenerateModalOpen(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" strokeWidth={2} />
          <div className="text-[13px] text-zinc-400">Loading studio...</div>
        </div>
      </div>
    );
  }

  if (error || !scene) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 mx-auto">
            <Film className="w-7 h-7 text-rose-300" strokeWidth={1.75} />
          </div>
          <h2 className="text-[20px] font-semibold text-white mb-2">
            {error || 'Scene not found'}
          </h2>
          <Link
            href={`/studio/${projectId}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white text-[13px] font-semibold transition-all"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
            Back to project
          </Link>
        </div>
      </div>
    );
  }

  const sceneName = scene.name || `Scene ${scene.scene_order}`;
  const activeClip = scene.clips[activeClipIndex] || null;
  const lastCompletedClip = [...scene.clips]
    .reverse()
    .find((c) => c.status === 'completed' && c.last_frame_url);
  const canChain = !!lastCompletedClip;

  const lastFrameOptions = scene.clips
    .filter((c) => c.status === 'completed' && c.last_frame_url)
    .map((c) => ({
      clipId: c.id,
      clipNumber: scene.clips.findIndex((x) => x.id === c.id) + 1,
      lastFrameUrl: c.last_frame_url!,
      prompt: c.refined_prompt,
    }));

  return (
    <div className="h-screen overflow-hidden bg-[#050505] text-white relative">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-purple-500/[0.06] blur-[120px] pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-[400px] h-[300px] rounded-full bg-blue-500/[0.05] blur-[100px] pointer-events-none" />

      <style jsx global>{`
        @keyframes slideUpSheet {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {/* =================== TOP BAR =================== */}
      <div className="sticky top-0 z-20 border-b border-[#141821]/80 bg-[#050505]/80 backdrop-blur-2xl">
        <div className="flex items-center justify-between px-3 sm:px-5 h-14 gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link
              href={`/studio/${projectId}`}
              className="w-9 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-[#1f2937] flex items-center justify-center transition-all active:scale-95 shrink-0"
            >
              <ArrowLeft className="w-4 h-4 text-zinc-300" strokeWidth={2} />
            </Link>
            <div className="min-w-0 flex-1">
              {editingName ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') {
                      setEditName(sceneName);
                      setEditingName(false);
                    }
                  }}
                  autoFocus
                  maxLength={100}
                  className="text-[14px] font-semibold text-white bg-white/[0.04] border border-purple-500/30 rounded-md px-2 py-0.5 w-full focus:outline-none focus:border-purple-500/60"
                />
              ) : (
                <button
                  onClick={() => setEditingName(true)}
                  className="text-left min-w-0 max-w-full block"
                >
                  <div className="text-[13px] font-semibold text-white truncate">{sceneName}</div>
                  <div className="text-[10px] text-purple-300 flex items-center gap-1.5">
                    <span>Scene {scene.scene_order}</span>
                    <span className="w-0.5 h-0.5 rounded-full bg-zinc-600" />
                    <span>{formatTime(scene.total_duration)}</span>
                    {parentProject && (
                      <>
                        <span className="w-0.5 h-0.5 rounded-full bg-zinc-600" />
                        <span className="truncate max-w-[80px]">{parentProject.name}</span>
                      </>
                    )}
                    {autoSaveStatus === 'saved' && (
                      <>
                        <span className="w-0.5 h-0.5 rounded-full bg-zinc-600" />
                        <span className="flex items-center gap-0.5 text-emerald-400">
                          <Check className="w-2 h-2" strokeWidth={3} />
                          Saved
                        </span>
                      </>
                    )}
                    {autoSaveStatus === 'saving' && (
                      <>
                        <span className="w-0.5 h-0.5 rounded-full bg-zinc-600" />
                        <span className="flex items-center gap-0.5 text-purple-300">
                          <Loader2 className="w-2 h-2 animate-spin" strokeWidth={3} />
                          Saving
                        </span>
                      </>
                    )}
                  </div>
                </button>
              )}
            </div>
            <MergeStatusBadge
              status={merge.status}
              errorMessage={merge.errorMessage}
              onRetry={merge.triggerMergeManually}
              compact
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setExportOpen(true)}
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[12px] font-semibold shadow-lg shadow-purple-500/30 transition-all active:scale-95"
              aria-label="Export this scene"
            >
              <Share2 className="w-3 h-3" strokeWidth={2.5} />
              <span className="hidden sm:inline">Export</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setSceneMenuOpen(!sceneMenuOpen)}
                className="w-9 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-[#1f2937] flex items-center justify-center transition-all active:scale-95"
              >
                <MoreVertical className="w-4 h-4 text-zinc-300" strokeWidth={2} />
              </button>
              {sceneMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setSceneMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-20 rounded-xl bg-[#0a0a0b] border border-[#1f2937] shadow-2xl overflow-hidden min-w-[180px]">
                    <button
                      onClick={() => {
                        setSceneMenuOpen(false);
                        setEditingName(true);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] text-zinc-300 hover:bg-white/[0.05] transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" strokeWidth={2} />
                      Rename scene
                    </button>
                    <Link
                      href={`/studio/${projectId}`}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] text-zinc-300 hover:bg-white/[0.05] transition-colors"
                    >
                      <Film className="w-3.5 h-3.5" strokeWidth={2} />
                      All scenes
                    </Link>
                    <div className="border-t border-[#1f2937]" />
                    <button
                      onClick={() => {
                        setSceneMenuOpen(false);
                        handleDeleteScene();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] text-rose-300 hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                      Delete scene
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* =================== STUDIO BODY =================== */}
      <main className="relative z-[1] h-[calc(100vh-3.5rem)] overflow-y-auto lg:overflow-hidden">
        {/* DESKTOP LAYOUT (≥1024px) */}
        <div className="hidden lg:grid lg:grid-cols-[1fr_320px] lg:grid-rows-[1fr_auto] lg:gap-3 lg:p-4 lg:h-full">
          <div className="row-start-1 col-start-1 min-h-0">
            <PreviewPlayer
              clips={scene.clips}
              activeClipIndex={activeClipIndex}
              setActiveClipIndex={handleAdvanceFromPlayer}
              autoPlay={autoPlayActiveClip}
              onSceneEnded={handleSceneEnded}
              mergedVideoUrl={merge.mergedVideoUrl}
              mergeReady={merge.status === 'ready'}
              pendingClipSeek={pendingClipSeek}
            />
          </div>

          <div className="row-start-1 row-span-2 col-start-2 min-h-0">
            <DesktopClipPanel
              clip={activeClip}
              clipIndex={activeClipIndex}
              totalClips={scene.clips.length}
              onDelete={() => activeClip && handleDeleteClip(activeClip.id)}
              onDuplicate={handleDuplicateClip}
              onReplace={handleReplaceClip}
              onRegenerate={handleRegenerateClip}
              onDownload={handleDownloadClip}
            />
          </div>

          <div className="row-start-2 col-start-1 rounded-2xl border border-[#1f2937] bg-[#0a0a0b]/40 backdrop-blur-sm p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-bold text-purple-300 uppercase tracking-[0.15em]">
                  Timeline
                </div>
                <div className="text-[10px] text-zinc-500">
                  {scene.clips.length} {scene.clips.length === 1 ? 'clip' : 'clips'} ·{' '}
                  {formatTime(scene.total_duration)}
                </div>
              </div>
              {canChain && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-[9px] font-semibold text-purple-300">
                  <Link2 className="w-2.5 h-2.5" strokeWidth={2.5} />
                  Chain ready
                </div>
              )}
            </div>

            {scene.clips.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-purple-500/30 bg-gradient-to-br from-purple-500/[0.05] to-blue-500/[0.02] p-5 text-center">
                <div className="text-[13px] font-semibold text-white mb-1">Direct your first shot</div>
                <div className="text-[10px] text-zinc-400 mb-3">
                  Upload an image, describe the motion, and generate.
                </div>
                <button
                  onClick={handleAddClick}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[11px] font-semibold shadow-lg shadow-purple-500/30 transition-all active:scale-95"
                >
                  <Wand2 className="w-3 h-3" strokeWidth={2.25} />
                  Generate first clip
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex items-center gap-1.5 pb-2 min-w-min">
                  {scene.clips.map((clip, idx) => (
                    <TimelineClipCard
                      key={clip.id}
                      clip={clip}
                      index={idx}
                      isActive={idx === activeClipIndex}
                      onSelect={() => handleClipSelect(idx)}
                    />
                  ))}
                  <div className="w-2" />
                  <PlusConnector
                    onClick={handleAddClick}
                    variant="end"
                    hasChainOption={canChain}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* MOBILE LAYOUT (<1024px) — stacked, scrollable */}
        <div className="lg:hidden pb-8">
          <div className="px-3 sm:px-5 pt-4 sm:pt-5">
            <div className="h-[60vh] max-h-[640px] min-h-[420px] w-full">
              <PreviewPlayer
                clips={scene.clips}
                activeClipIndex={activeClipIndex}
                setActiveClipIndex={handleAdvanceFromPlayer}
                autoPlay={autoPlayActiveClip}
                onSceneEnded={handleSceneEnded}
                mergedVideoUrl={merge.mergedVideoUrl}
                mergeReady={merge.status === 'ready'}
                pendingClipSeek={pendingClipSeek}
              />
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between px-3 sm:px-5 mb-3">
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-bold text-purple-300 uppercase tracking-[0.15em]">
                  Timeline
                </div>
                <div className="text-[10px] text-zinc-500">
                  {scene.clips.length} {scene.clips.length === 1 ? 'clip' : 'clips'} ·{' '}
                  {formatTime(scene.total_duration)}
                </div>
              </div>
              {canChain && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-[9px] font-semibold text-purple-300">
                  <Link2 className="w-2.5 h-2.5" strokeWidth={2.5} />
                  Chain ready
                </div>
              )}
            </div>

            {scene.clips.length === 0 ? (
              <div className="mx-3 sm:mx-5 rounded-2xl border-2 border-dashed border-purple-500/30 bg-gradient-to-br from-purple-500/[0.05] to-blue-500/[0.02] p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center mb-3 mx-auto">
                  <Sparkles className="w-6 h-6 text-purple-300" strokeWidth={1.75} />
                </div>
                <div className="text-[14px] font-semibold text-white mb-1">Direct your first shot</div>
                <div className="text-[11px] text-zinc-400 mb-4 max-w-xs mx-auto">
                  Upload an image, describe the motion, and Rift Studio generates your first cinematic clip.
                </div>
                <button
                  onClick={handleAddClick}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[12px] font-semibold shadow-lg shadow-purple-500/30 transition-all active:scale-95"
                >
                  <Wand2 className="w-3.5 h-3.5" strokeWidth={2.25} />
                  Generate first clip
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex items-center gap-1.5 px-3 sm:px-5 pb-5 min-w-min">
                  {scene.clips.map((clip, idx) => (
                    <TimelineClipCard
                      key={clip.id}
                      clip={clip}
                      index={idx}
                      isActive={idx === activeClipIndex}
                      onSelect={() => handleClipSelect(idx)}
                    />
                  ))}
                  <div className="w-2" />
                  {/* Inline "Add clip" tile on the same row as the thumbnails,
                      matching the desktop layout. Replaces the floating + button. */}
                  <PlusConnector onClick={handleAddClick} variant="end" hasChainOption={canChain} />
                </div>
              </div>
            )}
          </div>

          {scene.clips.length === 1 && (
            <div className="mx-3 sm:mx-5 mt-4 rounded-xl border border-purple-500/20 bg-gradient-to-r from-purple-500/[0.04] to-blue-500/[0.02] p-3 flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0">
                <Link2 className="w-3.5 h-3.5 text-purple-300" strokeWidth={2} />
              </div>
              <div className="text-[11px] text-zinc-300 leading-relaxed">
                <span className="font-semibold text-white">Tip: </span>
                {canChain
                  ? 'Tap "Add clip" at the end of the timeline to chain a seamless continuation from the last frame.'
                  : 'When your clip completes, you can chain the next one from its last frame for cinematic continuity.'}
              </div>
            </div>
          )}

          {scene.clips.length > 1 && (
            <div className="mx-3 sm:mx-5 mt-3 rounded-xl border border-[#1f2937] bg-white/[0.02] p-2.5 flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-md bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-3 h-3 text-purple-300" strokeWidth={2.5} />
              </div>
              <div className="text-[10px] text-zinc-400 leading-relaxed">
                <span className="text-white font-medium">Tap a clip</span> to preview,
                <span className="text-white font-medium"> tap again</span> to edit. Clips auto-play in sequence.
              </div>
            </div>
          )}
        </div>

        {/* Floating + button removed — the inline "Add clip" tile in the
            timeline (above) now serves as the add-clip affordance on both
            mobile and desktop, in the same row as the thumbnails. */}
      </main>

      {/* =================== BACKGROUND MOAT: Last-frame extraction =================== */}
      {/* Invisible component. Watches clips. When a clip completes, extracts the
          last frame using HTML5 Canvas and saves it via /extract-frame endpoint.
          This is what makes the "Chain" feature actually work. */}
      <LastFrameExtractor
        clips={scene.clips.map((c) => ({
          id: c.id,
          status: c.status,
          generated_video_url: c.generated_video_url,
          last_frame_url: c.last_frame_url,
          duration: c.duration,
        }))}
        onFrameExtracted={() => {
          // Refresh the scene to pull in the new last_frame_url
          fetchScene();
        }}
        debug
      />

      {/* =================== MODALS & DRAWERS =================== */}
      <ClipGenerationModal
        open={generateModalOpen}
        onClose={() => {
          setGenerateModalOpen(false);
          // CHUNK 2 (Regenerate): clear editing context when modal closes so
          // the next "Add clip" opens fresh, not in regenerate mode.
          setEditingClip(null);
        }}
        projectId={projectId}
        sceneId={sceneId}
        nextClipNumber={scene.clips.length + 1}
        lastFrameOptions={lastFrameOptions}
        profile={profile}
        onClipCreated={fetchScene}
        onProfileUpdate={fetchProfile}
        initialSourceType={pendingSourceType}
        editingClip={editingClip}
      />

      <AddClipActionSheet
        open={addActionSheetOpen}
        onClose={() => setAddActionSheetOpen(false)}
        onPickAction={handlePickAddAction}
        canChain={canChain}
      />

      <div className="lg:hidden">
        <ClipActionDrawer
          open={clipDrawerOpen}
          onClose={() => setClipDrawerOpen(false)}
          clip={activeClip}
          clipIndex={activeClipIndex}
          onDelete={() => activeClip && handleDeleteClip(activeClip.id)}
          onDuplicate={handleDuplicateClip}
          onReplace={handleReplaceClip}
          onRegenerate={handleRegenerateClip}
          onDownload={handleDownloadClip}
        />
      </div>

      <ExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        mode="scene"
        scenes={[
          {
            id: scene.id,
            name: scene.name,
            sceneOrder: scene.scene_order,
            totalDuration: scene.total_duration,
            // Live merge hook is the source of truth here — its status reflects
            // any in-flight merges that haven't yet been persisted to the DB.
            mergeStatus: merge.status,
            mergedVideoUrl: merge.mergedVideoUrl,
          },
        ]}
        tier={profile?.subscription_tier ?? 'free'}
        onUpgradeClick={() => {
          setExportOpen(false);
          setUpgradeOpen(true);
        }}
      />

      <TierPickerModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentTier={profile?.subscription_tier ?? 'free'}
      />
    </div>
  );
}