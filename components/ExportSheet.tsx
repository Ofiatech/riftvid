'use client';

/**
 * ExportSheet — shared component for both scene-level and project-level export.
 *
 * Behavior:
 *  - Free tier: shows an "Upgrade to export" CTA instead of downloads
 *  - Paid tiers (creator/pro/studio/team): shows per-scene export buttons
 *  - Each export uses the merged Cloudinary MP4 (one file per scene)
 *  - On tap: tries Web Share API (native share sheet on iPhone/Android),
 *    falls back to direct download if share isn't supported or fails
 *  - "Scene merging..." disabled state when merge isn't ready yet
 *
 * Used by:
 *  - app/studio/[id]/scenes/[sceneId]/page.tsx (scene-level: passes one scene)
 *  - app/studio/[id]/page.tsx (project-level: passes all scenes in the project)
 */

import { useState } from 'react';
import {
  X, Share2, Download, Loader2, Film, Sparkles, Check, AlertCircle,
  Clock, Zap, Lock,
} from 'lucide-react';

// Scenes the user can export. Each entry contains everything ExportSheet needs
// to render the row + actually perform the export (no extra fetches from inside
// the sheet).
export interface ExportableScene {
  id: string;
  name: string | null;
  sceneOrder: number;
  totalDuration: number;
  mergeStatus: 'idle' | 'pending' | 'processing' | 'ready' | 'failed' | string;
  mergedVideoUrl: string | null;
}

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  mode: 'scene' | 'project';
  projectName?: string; // shown in title for project mode
  scenes: ExportableScene[];
  /**
   * Subscription tier. Free users see an upgrade CTA instead of downloads.
   * Anything other than 'free' (creator, pro, studio, team) gets full access.
   */
  tier: string;
  /** Called when a free user taps "Upgrade" — parent opens the tier picker. */
  onUpgradeClick: () => void;
}

type ExportState =
  | { kind: 'idle' }
  | { kind: 'preparing'; sceneId: string }
  | { kind: 'sharing'; sceneId: string }
  | { kind: 'success'; sceneId: string; method: 'shared' | 'downloaded' }
  | { kind: 'error'; sceneId: string; message: string };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Try the native share sheet first (iPhone/Android), fall back to direct download.
 * Returns 'shared', 'downloaded', or throws on real error (cancel is silent).
 */
async function exportSceneMp4(
  url: string,
  filename: string,
  title: string
): Promise<'shared' | 'downloaded'> {
  // Step 1: fetch the MP4 as a Blob — needed for both share-with-file and
  // forced download with a friendly filename.
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not fetch video (${res.status})`);
  }
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type || 'video/mp4' });

  // Step 2: try Web Share API with file. Native share sheet → WhatsApp /
  // Messages / Save Video / etc. on iPhone and Android.
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const canShareFile =
    nav &&
    typeof nav.share === 'function' &&
    typeof nav.canShare === 'function' &&
    nav.canShare({ files: [file] });

  if (canShareFile) {
    try {
      await nav.share({ files: [file], title, text: title });
      return 'shared';
    } catch (err) {
      // AbortError = user canceled the share sheet. Don't fall back to download
      // in that case — they intentionally backed out.
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Treat cancel as "no-op success" — caller shouldn't show an error.
        return 'shared';
      }
      // Real share failure → fall through to download
    }
  }

  // Step 3: forced download with friendly filename via Blob URL.
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

  return 'downloaded';
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '') || 'scene';
}

function SceneRow({
  scene,
  exportState,
  onExport,
  disabled,
}: {
  scene: ExportableScene;
  exportState: ExportState;
  onExport: () => void;
  disabled: boolean;
}) {
  const ready = scene.mergeStatus === 'ready' && !!scene.mergedVideoUrl;
  const sceneLabel = scene.name || `Scene ${scene.sceneOrder}`;

  const isThisRowBusy =
    (exportState.kind === 'preparing' || exportState.kind === 'sharing') &&
    exportState.sceneId === scene.id;
  const isThisRowSuccess =
    exportState.kind === 'success' && exportState.sceneId === scene.id;
  const isThisRowError =
    exportState.kind === 'error' && exportState.sceneId === scene.id;

  return (
    <div
      className={`rounded-xl border p-3 flex items-center gap-3 transition-all ${
        ready
          ? 'border-[#1f2937] bg-white/[0.02]'
          : 'border-[#1f2937] bg-white/[0.01] opacity-60'
      }`}
    >
      <div className="w-9 h-9 rounded-lg bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0">
        <Film className="w-4 h-4 text-purple-300" strokeWidth={1.75} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-white truncate">
          {sceneLabel}
        </div>
        <div className="text-[10px] text-zinc-400 flex items-center gap-1.5 mt-0.5">
          <Clock className="w-2.5 h-2.5" strokeWidth={2} />
          {formatTime(scene.totalDuration)}
          <span className="w-0.5 h-0.5 rounded-full bg-zinc-600" />
          {ready ? (
            <span className="text-emerald-300 flex items-center gap-0.5">
              <span className="w-1 h-1 rounded-full bg-emerald-400" />
              Ready
            </span>
          ) : scene.mergeStatus === 'failed' ? (
            <span className="text-rose-300">Merge failed</span>
          ) : scene.mergeStatus === 'processing' ? (
            <span className="text-purple-300 flex items-center gap-0.5">
              <Loader2 className="w-2 h-2 animate-spin" strokeWidth={2} />
              Merging
            </span>
          ) : (
            <span className="text-zinc-500">Not ready</span>
          )}
        </div>
        {isThisRowError && (
          <div className="text-[10px] text-rose-300 mt-1 flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5" strokeWidth={2} />
            {exportState.message}
          </div>
        )}
      </div>

      <button
        onClick={onExport}
        disabled={!ready || disabled || isThisRowBusy}
        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
          ready && !disabled && !isThisRowBusy
            ? 'bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white shadow-lg shadow-purple-500/30 active:scale-95'
            : 'bg-white/[0.04] text-zinc-500 cursor-not-allowed'
        }`}
        aria-label={`Export ${sceneLabel}`}
      >
        {isThisRowBusy ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2.5} />
            {exportState.kind === 'sharing' ? 'Sharing...' : 'Preparing...'}
          </>
        ) : isThisRowSuccess ? (
          <>
            <Check className="w-3 h-3" strokeWidth={2.5} />
            {exportState.method === 'shared' ? 'Shared' : 'Saved'}
          </>
        ) : (
          <>
            <Share2 className="w-3 h-3" strokeWidth={2.5} />
            Export
          </>
        )}
      </button>
    </div>
  );
}

export default function ExportSheet({
  open,
  onClose,
  mode,
  projectName,
  scenes,
  tier,
  onUpgradeClick,
}: ExportSheetProps) {
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });

  if (!open) return null;

  const isFree = tier === 'free';
  const readyCount = scenes.filter(
    (s) => s.mergeStatus === 'ready' && s.mergedVideoUrl
  ).length;

  const handleExport = async (scene: ExportableScene) => {
    if (!scene.mergedVideoUrl) return;
    setExportState({ kind: 'preparing', sceneId: scene.id });

    const sceneLabel = scene.name || `Scene_${scene.sceneOrder}`;
    const filename = `riftvid_${sanitizeFilename(sceneLabel)}.mp4`;
    const title = `${sceneLabel} — Riftvid`;

    try {
      setExportState({ kind: 'sharing', sceneId: scene.id });
      const method = await exportSceneMp4(scene.mergedVideoUrl, filename, title);
      setExportState({ kind: 'success', sceneId: scene.id, method });
      // Reset success state after a moment so user can export again
      setTimeout(() => {
        setExportState((curr) =>
          curr.kind === 'success' && curr.sceneId === scene.id
            ? { kind: 'idle' }
            : curr
        );
      }, 2500);
    } catch (err) {
      setExportState({
        kind: 'error',
        sceneId: scene.id,
        message:
          err instanceof Error ? err.message : 'Export failed. Try again.',
      });
    }
  };

  const title =
    mode === 'scene'
      ? 'Export this scene'
      : `Export ${projectName || 'project'}`;

  const subtitle =
    mode === 'scene'
      ? 'Save the merged MP4 or share it directly.'
      : `${scenes.length} scene${scenes.length === 1 ? '' : 's'} · ${readyCount} ready to export.`;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer (mobile: bottom sheet · desktop: floating panel anchored to bottom-center, matching existing drawers) */}
      <div
        className="fixed left-0 right-0 bottom-0 z-50 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:bottom-4 sm:max-w-md sm:rounded-3xl rounded-t-3xl border-t border-x sm:border border-purple-500/20 bg-[#0a0a0b] shadow-2xl shadow-purple-500/20"
        style={{
          animation: 'slideUpSheet 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>

        <div className="p-4 sm:p-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="min-w-0 flex-1 pr-2">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-1.5">
                <Share2 className="w-2.5 h-2.5" strokeWidth={2.5} />
                Export
              </div>
              <h2 className="text-[16px] font-semibold text-white tracking-tight truncate">
                {title}
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">{subtitle}</p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-white/[0.05] transition-colors flex items-center justify-center shrink-0"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5 text-zinc-400" strokeWidth={2} />
            </button>
          </div>

          {/* Free tier gate */}
          {isFree ? (
            <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.04] p-5 text-center">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto mb-3">
                <Lock className="w-5 h-5 text-amber-300" strokeWidth={1.75} />
              </div>
              <div className="text-[14px] font-semibold text-white mb-1.5">
                Export is a paid feature
              </div>
              <div className="text-[11px] text-zinc-400 mb-4 max-w-xs mx-auto">
                Upgrade to Creator and you can export every scene you make — no credit cost, unlimited downloads.
              </div>
              <button
                onClick={() => {
                  onClose();
                  onUpgradeClick();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-b from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-[12px] font-semibold shadow-lg shadow-amber-500/30 transition-all active:scale-95"
              >
                <Zap className="w-3.5 h-3.5" strokeWidth={2.25} />
                Upgrade to export
              </button>
            </div>
          ) : (
            <>
              {/* Scene list */}
              {scenes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#1f2937] bg-white/[0.01] p-6 text-center">
                  <Film className="w-7 h-7 text-zinc-600 mx-auto mb-2" strokeWidth={1.75} />
                  <div className="text-[12px] text-zinc-400">
                    No scenes to export yet.
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {scenes
                    .slice()
                    .sort((a, b) => a.sceneOrder - b.sceneOrder)
                    .map((scene) => (
                      <SceneRow
                        key={scene.id}
                        scene={scene}
                        exportState={exportState}
                        onExport={() => handleExport(scene)}
                        disabled={
                          exportState.kind === 'preparing' ||
                          exportState.kind === 'sharing'
                        }
                      />
                    ))}
                </div>
              )}

              {/* Footer hint */}
              <div className="mt-4 flex items-start gap-2 px-2.5 py-2 rounded-lg bg-white/[0.02] border border-[#1f2937]">
                <Sparkles className="w-3 h-3 text-purple-300 shrink-0 mt-0.5" strokeWidth={2} />
                <div className="text-[10px] text-zinc-400 leading-relaxed">
                  Tapping <span className="text-white font-medium">Export</span>{' '}
                  opens your share sheet — save to Photos, send to WhatsApp, or
                  download directly.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Animation keyframe — defined inline so this component is self-contained.
          Identical to the one defined in the scene editor for AddClipActionSheet
          and ClipActionDrawer, so it's safe if both are present in the same tree
          (CSS @keyframes are scoped to the global style. The browser de-dupes). */}
      <style jsx global>{`
        @keyframes slideUpSheet {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
}
