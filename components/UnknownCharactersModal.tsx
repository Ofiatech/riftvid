'use client';

// components/UnknownCharactersModal.tsx
//
// Phase 4.3.5c v2 — "I don't know Marcus" UX (revised after first test)
//
// REVISIONS FROM v1 (post-test feedback):
//
// 1. INVERTED BUTTON HIERARCHY
//    v1 made Auto-create the primary action. That was wrong — Auto-create is
//    the convenience escape hatch for lazy users, not the default. v2 makes
//    [Create avatar] the primary purple button (opens NewAvatarModal with
//    full upload/generate control) and [Auto-create] the secondary action.
//
// 2. TWO-STAGE AUTO-CREATE (no more library clutter)
//    v1 saved the auto-generated avatar permanently the moment Fal Flux
//    finished. After a few story sessions, the avatar library filled with
//    one-shot characters the user never wanted to keep.
//    v2 splits Auto-create into:
//      (a) Generate portrait (Fal Flux call)  → shows preview in the row
//      (b) [Save & use] / [Try again] / [Skip] decision
//    Only [Save & use] writes to the library. [Skip] uses Flux Dev fallback
//    for this generation without polluting the library.
//
// 3. MANUAL CREATE PATH
//    The [Create avatar] button opens the existing NewAvatarModal pre-filled
//    with the character's name. User gets full upload-or-generate control.
//    On save, the new avatar lands in their library and this modal updates
//    the row to ✓ created.
//
// PHASE 5 NOTE: still reusable. The Story-to-Scenes engine will call this
// component with a story-wide list of detected characters; no code changes
// will be needed.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  Sparkles,
  UserSquare2,
  Check,
  AlertCircle,
  RefreshCw,
  Loader2,
  Zap,
  ArrowRight,
  Users,
  Wand2,
} from 'lucide-react';
import { resolveName, type NameResolution } from '@/lib/fuzzyMatchName';
import type { AvatarRecord } from '@/lib/avatars';
import NewAvatarModal from '@/components/NewAvatarModal';

// ============================================================================
// TYPES
// ============================================================================

interface DetectedCharacter {
  name: string;
  portraitPrompt: string;
}

interface UnknownCharactersModalProps {
  open: boolean;
  detectedCharacters: DetectedCharacter[];
  avatars: AvatarRecord[];
  onClose: () => void;
  onAllResolved: (result: {
    createdAvatarIds: string[];
    nameSubstitutions: Array<{ from: string; to: string }>;
  }) => void;
  onAtLimit: () => void;
}

/**
 * Per-row state machine. v2 has more states because Auto-create is now
 * a two-stage flow (generate → preview → save) instead of one-shot.
 */
type RowStatus =
  // No user action needed — resolved on modal open
  | { kind: 'exact'; avatar: AvatarRecord }
  | { kind: 'fuzzy-suggested'; suggested: AvatarRecord; similarity: number }
  | { kind: 'fuzzy-accepted'; avatar: AvatarRecord }
  // Unknown — awaiting user choice between [Create avatar] and [Auto-create]
  | { kind: 'unknown' }
  // Manual create — NewAvatarModal is open for this character
  // returnTo lets us revert if the user cancels NewAvatarModal
  | { kind: 'manual-creating'; returnTo: RowStatusTerminal }
  // Auto-create stage 1: Fal Flux generating the portrait (full-screen blocker)
  | { kind: 'auto-generating' }
  // Auto-create stage 2: portrait ready, awaiting Save/Try again/Skip
  | { kind: 'auto-preview'; falImageUrl: string }
  // Auto-create stage 3: /api/avatars POST in flight
  | { kind: 'auto-saving'; falImageUrl: string }
  // Terminal states
  | { kind: 'created'; avatar: AvatarRecord }
  | { kind: 'skipped' }
  // Error states
  | { kind: 'error'; message: string; portraitPrompt: string }
  | { kind: 'tier-limit' };

/**
 * Subset of RowStatus that we're willing to revert TO from manual-creating.
 * (Can't revert back to 'manual-creating' itself — that would be a loop.)
 */
type RowStatusTerminal =
  | { kind: 'unknown' }
  | { kind: 'fuzzy-suggested'; suggested: AvatarRecord; similarity: number };

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a draft session ID. The /api/avatars/generate endpoint scopes the
 * "3 free attempts then 1 credit each" counter per draftSessionId — so a fresh
 * ID per modal session means the user gets 3 free auto-creates shared across
 * all characters in this modal. After that, each auto-create costs 1 credit.
 */
function makeDraftSessionId(): string {
  return `unknowns-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Convert a NameResolution from the fuzzy matcher into an initial RowStatus. */
function resolutionToStatus(resolution: NameResolution): RowStatus {
  if (resolution.type === 'exact') return { kind: 'exact', avatar: resolution.avatar };
  if (resolution.type === 'fuzzy') {
    return {
      kind: 'fuzzy-suggested',
      suggested: resolution.avatar,
      similarity: resolution.similarity,
    };
  }
  return { kind: 'unknown' };
}

/** A row is "terminal" when it's been fully decided one way or another. */
function isTerminal(status: RowStatus): boolean {
  return (
    status.kind === 'exact' ||
    status.kind === 'fuzzy-accepted' ||
    status.kind === 'created' ||
    status.kind === 'skipped'
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function UnknownCharactersModal({
  open,
  detectedCharacters,
  avatars: initialAvatars,
  onClose,
  onAllResolved,
  onAtLimit,
}: UnknownCharactersModalProps) {
  // === STATE ===
  const [rowStatuses, setRowStatuses] = useState<Record<string, RowStatus>>({});
  const [draftSessionId, setDraftSessionId] = useState<string>('');
  const [blockingCharacter, setBlockingCharacter] = useState<string | null>(null);

  // Local avatars state — kept in sync with initialAvatars prop AND with new
  // avatars created during the modal session. We use a local copy so we can
  // immediately update on Save without waiting for the parent to refetch.
  const [avatars, setAvatars] = useState<AvatarRecord[]>(initialAvatars);

  // Manual-create flow state
  const [manualCharacter, setManualCharacter] = useState<string | null>(null);
  // Snapshot of avatar IDs before NewAvatarModal opens — used to find the
  // newly-created avatar by diff (instead of brittle name matching, which
  // would break if user edited the name in NewAvatarModal).
  const [knownAvatarIdsBeforeManual, setKnownAvatarIdsBeforeManual] = useState<Set<string>>(
    new Set()
  );

  // === INIT ON OPEN ===
  useEffect(() => {
    if (!open) return;

    setDraftSessionId(makeDraftSessionId());
    setAvatars(initialAvatars);

    const initial: Record<string, RowStatus> = {};
    for (const char of detectedCharacters) {
      const resolution = resolveName(char.name, initialAvatars);
      initial[char.name] = resolutionToStatus(resolution);
    }
    setRowStatuses(initial);
    setBlockingCharacter(null);
    setManualCharacter(null);
    setKnownAvatarIdsBeforeManual(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // === HANDLERS ===

  const handleUseFuzzyMatch = useCallback((name: string, avatar: AvatarRecord) => {
    setRowStatuses((prev) => ({
      ...prev,
      [name]: { kind: 'fuzzy-accepted', avatar },
    }));
  }, []);

  const handleSkip = useCallback((name: string) => {
    setRowStatuses((prev) => ({
      ...prev,
      [name]: { kind: 'skipped' },
    }));
  }, []);

  /**
   * AUTO-CREATE STAGE 1 — generate portrait via Fal Flux.
   * Full-screen blocking while in flight (10–15s).
   * On success, transitions row to 'auto-preview' so user can review.
   */
  const handleAutoCreate = useCallback(
    async (name: string, portraitPrompt: string) => {
      if (blockingCharacter) return;

      setBlockingCharacter(name);
      setRowStatuses((prev) => ({ ...prev, [name]: { kind: 'auto-generating' } }));

      try {
        const res = await fetch('/api/avatars/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: portraitPrompt,
            draftSessionId,
          }),
        });

        const data = await res.json();

        if (res.status === 402 || data.error === 'out_of_credits') {
          setRowStatuses((prev) => ({ ...prev, [name]: { kind: 'tier-limit' } }));
          setBlockingCharacter(null);
          return;
        }

        if (!res.ok || !data.falImageUrl) {
          throw new Error(
            data.message || data.error || 'Portrait generation failed'
          );
        }

        // Stage 1 complete — row now shows preview + Save/Try again/Skip
        setRowStatuses((prev) => ({
          ...prev,
          [name]: { kind: 'auto-preview', falImageUrl: data.falImageUrl },
        }));
        setBlockingCharacter(null);
      } catch (err) {
        console.error('Auto-create generation error:', err);
        setRowStatuses((prev) => ({
          ...prev,
          [name]: {
            kind: 'error',
            message: err instanceof Error ? err.message : 'Something went wrong',
            portraitPrompt,
          },
        }));
        setBlockingCharacter(null);
      }
    },
    [blockingCharacter, draftSessionId]
  );

  /**
   * AUTO-CREATE STAGE 2 — user tapped [Save & use] in the preview state.
   * Calls /api/avatars POST, which rehosts the Fal URL to permanent
   * Supabase storage. Inline spinner; modal is NOT full-screen-blocked
   * during this short call.
   */
  const handleSaveAutoCreated = useCallback(
    async (name: string, falImageUrl: string) => {
      setRowStatuses((prev) => ({
        ...prev,
        [name]: { kind: 'auto-saving', falImageUrl },
      }));

      try {
        const res = await fetch('/api/avatars', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            source: 'ai_generated',
            photoUrls: [falImageUrl],
          }),
        });

        const data = await res.json();

        if (res.status === 403 && data.error === 'avatar_limit_reached') {
          setRowStatuses((prev) => ({ ...prev, [name]: { kind: 'tier-limit' } }));
          return;
        }

        if (!res.ok || !data.avatar) {
          throw new Error(data.message || data.error || 'Failed to save avatar');
        }

        const newAvatar = data.avatar as AvatarRecord;
        setAvatars((prev) => [...prev, newAvatar]);
        setRowStatuses((prev) => ({
          ...prev,
          [name]: { kind: 'created', avatar: newAvatar },
        }));
      } catch (err) {
        console.error('Auto-create save error:', err);
        // We don't have the portraitPrompt here, fall back to a generic one
        // so Retry still works. Source: row's character.portraitPrompt would
        // be cleaner — wire it through if this becomes an issue in practice.
        const charDetails = detectedCharacters.find((c) => c.name === name);
        setRowStatuses((prev) => ({
          ...prev,
          [name]: {
            kind: 'error',
            message: err instanceof Error ? err.message : 'Failed to save',
            portraitPrompt: charDetails?.portraitPrompt ?? '',
          },
        }));
      }
    },
    [detectedCharacters]
  );

  /** User tapped [Try again] in auto-preview — kick off another portrait gen. */
  const handleTryAgain = useCallback(
    (name: string, portraitPrompt: string) => {
      handleAutoCreate(name, portraitPrompt);
    },
    [handleAutoCreate]
  );

  /** User tapped Retry on an error row — kick off another portrait gen. */
  const handleRetry = useCallback(
    (name: string, portraitPrompt: string) => {
      handleAutoCreate(name, portraitPrompt);
    },
    [handleAutoCreate]
  );

  const handleUpgrade = useCallback(() => {
    onClose();
    onAtLimit();
  }, [onClose, onAtLimit]);

  /**
   * MANUAL CREATE — user tapped [Create avatar] for this character.
   * Opens NewAvatarModal with the character's name pre-filled.
   * Snapshots the current avatar IDs so we can detect the new one on save.
   */
  const handleStartManualCreate = useCallback(
    (name: string) => {
      if (blockingCharacter || manualCharacter) return;

      // Stash the previous status so we can revert if the user cancels
      const previousStatus = rowStatuses[name];
      let returnTo: RowStatusTerminal = { kind: 'unknown' };
      if (previousStatus?.kind === 'fuzzy-suggested') {
        returnTo = {
          kind: 'fuzzy-suggested',
          suggested: previousStatus.suggested,
          similarity: previousStatus.similarity,
        };
      }

      setKnownAvatarIdsBeforeManual(new Set(avatars.map((a) => a.id)));
      setRowStatuses((prev) => ({
        ...prev,
        [name]: { kind: 'manual-creating', returnTo },
      }));
      setManualCharacter(name);
    },
    [blockingCharacter, manualCharacter, rowStatuses, avatars]
  );

  /**
   * NewAvatarModal called onCreated — refetch avatars, find the new one,
   * mark the row as created.
   */
  const handleManualCreated = useCallback(async () => {
    if (!manualCharacter) return;

    try {
      const res = await fetch('/api/avatars');
      if (!res.ok) throw new Error('Avatars refetch failed');
      const data = await res.json();
      const refreshedAvatars: AvatarRecord[] = data.avatars || [];
      setAvatars(refreshedAvatars);

      // Find the new avatar — the one not in our pre-open snapshot
      const newAvatar = refreshedAvatars.find(
        (a) => !knownAvatarIdsBeforeManual.has(a.id)
      );

      if (newAvatar) {
        setRowStatuses((prev) => ({
          ...prev,
          [manualCharacter]: { kind: 'created', avatar: newAvatar },
        }));
      } else {
        // Couldn't find the new avatar (shouldn't happen) — revert
        setRowStatuses((prev) => {
          const current = prev[manualCharacter];
          if (current?.kind === 'manual-creating') {
            return { ...prev, [manualCharacter]: current.returnTo };
          }
          return prev;
        });
      }
    } catch (err) {
      console.error('Manual create post-success refetch failed:', err);
    }
  }, [manualCharacter, knownAvatarIdsBeforeManual]);

  /**
   * NewAvatarModal closed. If we're still in 'manual-creating' for this row
   * (meaning onCreated didn't fire), revert to the previous status. If
   * onCreated DID fire (row is now 'created'), no revert needed.
   */
  const handleManualClose = useCallback(() => {
    if (!manualCharacter) return;

    setRowStatuses((prev) => {
      const current = prev[manualCharacter];
      if (current?.kind === 'manual-creating') {
        // User cancelled without creating — revert
        return { ...prev, [manualCharacter]: current.returnTo };
      }
      return prev;
    });
    setManualCharacter(null);
    setKnownAvatarIdsBeforeManual(new Set());
  }, [manualCharacter]);

  // === COMPUTED ===

  const allResolved = useMemo(() => {
    return detectedCharacters.every((char) => {
      const status = rowStatuses[char.name];
      return status && isTerminal(status);
    });
  }, [detectedCharacters, rowStatuses]);

  const unresolvedCount = useMemo(() => {
    return detectedCharacters.filter((char) => {
      const status = rowStatuses[char.name];
      return !status || !isTerminal(status);
    }).length;
  }, [detectedCharacters, rowStatuses]);

  const resolvedCount = detectedCharacters.length - unresolvedCount;

  const handleContinue = useCallback(() => {
    const createdAvatarIds: string[] = [];
    const nameSubstitutions: Array<{ from: string; to: string }> = [];

    for (const char of detectedCharacters) {
      const status = rowStatuses[char.name];
      if (!status) continue;

      if (status.kind === 'created') {
        createdAvatarIds.push(status.avatar.id);
        // If the user changed the name in NewAvatarModal, the new avatar's
        // name might differ from the detected name. Substitute so the
        // word-boundary matcher finds it.
        if (status.avatar.name !== char.name) {
          nameSubstitutions.push({ from: char.name, to: status.avatar.name });
        }
      } else if (status.kind === 'fuzzy-accepted') {
        // User picked an existing avatar with a different spelling.
        if (status.avatar.name !== char.name) {
          nameSubstitutions.push({ from: char.name, to: status.avatar.name });
        }
      }
      // 'exact' and 'skipped' need no substitution
    }

    onAllResolved({ createdAvatarIds, nameSubstitutions });
  }, [detectedCharacters, rowStatuses, onAllResolved]);

  // === RENDER ===

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 animate-backdrop-in" />

        <div
          className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#1f2937] bg-[#0a0a0b] shadow-2xl animate-modal-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-purple-500/20 blur-[80px] opacity-50 pointer-events-none" />

          <div className="relative p-6 md:p-8">
            {/* ===== HEADER ===== */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-2">
                  <Users className="w-2.5 h-2.5" strokeWidth={2.5} />
                  Cast Setup
                </div>
                <h2 className="text-[22px] font-semibold text-white tracking-tight">
                  Rift detected some characters
                </h2>
                <p className="text-[13px] text-zinc-400 mt-1">
                  {detectedCharacters.length === 1
                    ? "I noticed a character in your prompt. Let's make sure they're in your library so they stay consistent."
                    : `I noticed ${detectedCharacters.length} characters. Let's set them up so each one stays consistent across your clips.`}
                </p>
              </div>
              <button
                onClick={onClose}
                disabled={!!blockingCharacter || !!manualCharacter}
                className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
              </button>
            </div>

            {/* ===== PROGRESS BAR ===== */}
            <div className="mb-5 flex items-center gap-2 text-[12px]">
              <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-400 to-blue-400 rounded-full transition-all duration-500"
                  style={{
                    width: `${
                      detectedCharacters.length > 0
                        ? (resolvedCount / detectedCharacters.length) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <span className="text-zinc-400 font-medium shrink-0">
                {resolvedCount} / {detectedCharacters.length} ready
              </span>
            </div>

            {/* ===== ROWS ===== */}
            <div className="space-y-2 mb-5">
              {detectedCharacters.map((char) => (
                <CharacterRow
                  key={char.name}
                  character={char}
                  status={rowStatuses[char.name] ?? { kind: 'unknown' }}
                  onAutoCreate={() => handleAutoCreate(char.name, char.portraitPrompt)}
                  onSaveAutoCreated={(falImageUrl) =>
                    handleSaveAutoCreated(char.name, falImageUrl)
                  }
                  onTryAgain={() => handleTryAgain(char.name, char.portraitPrompt)}
                  onUseFuzzyMatch={(avatar) => handleUseFuzzyMatch(char.name, avatar)}
                  onCreateManually={() => handleStartManualCreate(char.name)}
                  onSkip={() => handleSkip(char.name)}
                  onRetry={(portraitPrompt) => handleRetry(char.name, portraitPrompt)}
                  onUpgrade={handleUpgrade}
                  disabled={!!blockingCharacter || !!manualCharacter}
                />
              ))}
            </div>

            {/* ===== FOOTER ===== */}
            <div className="flex items-center justify-between pt-4 border-t border-[#141821] gap-3">
              <div className="text-[11px] text-zinc-500">
                {allResolved
                  ? '✓ All set — your cast is ready'
                  : `${unresolvedCount} character${unresolvedCount === 1 ? '' : 's'} still need${
                      unresolvedCount === 1 ? 's' : ''
                    } setup`}
              </div>
              <button
                onClick={handleContinue}
                disabled={!allResolved || !!blockingCharacter || !!manualCharacter}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>

        {/* ===== FULL-SCREEN BLOCKING OVERLAY DURING AUTO-CREATE STAGE 1 ===== */}
        {blockingCharacter && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-md">
            <div className="text-center max-w-sm px-6">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-500/30">
                <Loader2
                  className="w-8 h-8 text-purple-300 animate-spin"
                  strokeWidth={1.75}
                />
              </div>
              <div className="text-[18px] font-semibold text-white mb-1.5">
                Generating {blockingCharacter}...
              </div>
              <div className="text-[13px] text-zinc-400">
                Rift is painting their portrait — this takes about 10–15 seconds.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== MANUAL CREATE — NewAvatarModal opened for this character ===== */}
      <NewAvatarModal
        open={manualCharacter !== null}
        initialName={manualCharacter ?? ''}
        onClose={handleManualClose}
        onCreated={handleManualCreated}
        onLimitReached={handleUpgrade}
      />
    </>
  );
}

// ============================================================================
// CHARACTER ROW SUB-COMPONENT
// ============================================================================

interface CharacterRowProps {
  character: DetectedCharacter;
  status: RowStatus;
  onAutoCreate: () => void;
  onSaveAutoCreated: (falImageUrl: string) => void;
  onTryAgain: () => void;
  onUseFuzzyMatch: (avatar: AvatarRecord) => void;
  onCreateManually: () => void;
  onSkip: () => void;
  onRetry: (portraitPrompt: string) => void;
  onUpgrade: () => void;
  disabled: boolean;
}

function CharacterRow({
  character,
  status,
  onAutoCreate,
  onSaveAutoCreated,
  onTryAgain,
  onUseFuzzyMatch,
  onCreateManually,
  onSkip,
  onRetry,
  onUpgrade,
  disabled,
}: CharacterRowProps) {
  // Small avatar thumb (used for existing avatars + linked-to states)
  const renderAvatarThumb = (avatar: AvatarRecord) => {
    const primaryPhoto = avatar.photo_urls?.[0]?.url;
    return (
      <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/[0.08] bg-purple-500/[0.05] shrink-0">
        {primaryPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primaryPhoto}
            alt={avatar.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <UserSquare2 className="w-5 h-5 text-purple-300/50" strokeWidth={1.5} />
          </div>
        )}
      </div>
    );
  };

  // Larger portrait thumb (used in auto-preview / auto-saving states)
  const renderPortraitThumb = (imageUrl: string) => (
    <div className="w-14 h-[70px] rounded-lg overflow-hidden border border-purple-500/30 bg-[#050505] shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={character.name}
        className="w-full h-full object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </div>
  );

  const renderPlaceholder = () => (
    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-purple-500/[0.05] border border-purple-500/15 shrink-0">
      <UserSquare2 className="w-5 h-5 text-purple-300/50" strokeWidth={1.5} />
    </div>
  );

  // === STATUS-SPECIFIC RENDERING ===

  if (status.kind === 'exact') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
        {renderAvatarThumb(status.avatar)}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">{character.name}</div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-300">
            <Check className="w-3 h-3" strokeWidth={2.5} />
            <span>Already in your library</span>
          </div>
        </div>
      </div>
    );
  }

  if (status.kind === 'fuzzy-suggested') {
    return (
      <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.04]">
        <div className="flex items-center gap-3 mb-3">
          {renderAvatarThumb(status.suggested)}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white">{character.name}</div>
            <div className="text-[11px] text-amber-300">
              Did you mean{' '}
              <span className="font-semibold">{status.suggested.name}</span>?
            </div>
          </div>
        </div>

        {/* Two-row layout: primary action on top, alternatives below */}
        <button
          onClick={() => onUseFuzzyMatch(status.suggested)}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[12px] font-semibold shadow-md shadow-purple-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed mb-1.5"
        >
          <Check className="w-3 h-3" strokeWidth={2.5} />
          Use {status.suggested.name}
        </button>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={onCreateManually}
            disabled={disabled}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-200 text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-3 h-3" strokeWidth={2.5} />
            Create new
          </button>
          <button
            onClick={onAutoCreate}
            disabled={disabled}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-200 text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wand2 className="w-3 h-3" strokeWidth={2.5} />
            Auto-create
          </button>
        </div>
      </div>
    );
  }

  if (status.kind === 'fuzzy-accepted') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
        {renderAvatarThumb(status.avatar)}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">{character.name}</div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-300">
            <Check className="w-3 h-3" strokeWidth={2.5} />
            <span>Linked to {status.avatar.name}</span>
          </div>
        </div>
      </div>
    );
  }

  if (status.kind === 'unknown') {
    return (
      <div className="p-3 rounded-xl border border-[#1f2937] bg-white/[0.02]">
        <div className="flex items-center gap-3 mb-3">
          {renderPlaceholder()}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white">{character.name}</div>
            <div className="text-[11px] text-zinc-500">Not in your library yet</div>
          </div>
        </div>

        {/* PRIMARY action — Create avatar (opens NewAvatarModal) */}
        <button
          onClick={onCreateManually}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[12px] font-semibold shadow-md shadow-purple-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed mb-1.5"
        >
          <Sparkles className="w-3 h-3" strokeWidth={2.5} />
          Create avatar
        </button>

        {/* SECONDARY action — Auto-create (smaller, ghost button) */}
        <button
          onClick={onAutoCreate}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-300 text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Wand2 className="w-3 h-3" strokeWidth={2.5} />
          Auto-create
        </button>
      </div>
    );
  }

  if (status.kind === 'manual-creating') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-purple-500/25 bg-purple-500/[0.04]">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-purple-500/15 border border-purple-500/25 shrink-0">
          <Loader2 className="w-5 h-5 text-purple-300 animate-spin" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">{character.name}</div>
          <div className="text-[11px] text-purple-300">Creating avatar...</div>
        </div>
      </div>
    );
  }

  if (status.kind === 'auto-generating') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-purple-500/25 bg-purple-500/[0.04]">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-purple-500/15 border border-purple-500/25 shrink-0">
          <Loader2 className="w-5 h-5 text-purple-300 animate-spin" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">{character.name}</div>
          <div className="text-[11px] text-purple-300">Generating portrait...</div>
        </div>
      </div>
    );
  }

  if (status.kind === 'auto-preview') {
    return (
      <div className="p-3 rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.03]">
        <div className="flex items-center gap-3 mb-3">
          {renderPortraitThumb(status.falImageUrl)}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white">{character.name}</div>
            <div className="flex items-center gap-1 text-[11px] text-purple-300">
              <Sparkles className="w-3 h-3" strokeWidth={2.5} />
              <span>Portrait ready — keep it?</span>
            </div>
          </div>
        </div>

        {/* PRIMARY — Save & use */}
        <button
          onClick={() => onSaveAutoCreated(status.falImageUrl)}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[12px] font-semibold shadow-md shadow-purple-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed mb-1.5"
        >
          <Check className="w-3 h-3" strokeWidth={2.5} />
          Save &amp; use
        </button>

        {/* SECONDARY — Try again / Skip */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={onTryAgain}
            disabled={disabled}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-200 text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-3 h-3" strokeWidth={2.5} />
            Try again
          </button>
          <button
            onClick={onSkip}
            disabled={disabled}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-400 text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  if (status.kind === 'auto-saving') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-purple-500/30 bg-purple-500/[0.04]">
        {renderPortraitThumb(status.falImageUrl)}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">{character.name}</div>
          <div className="flex items-center gap-1 text-[11px] text-purple-300">
            <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />
            <span>Saving to your library...</span>
          </div>
        </div>
      </div>
    );
  }

  if (status.kind === 'created') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
        {renderAvatarThumb(status.avatar)}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">{character.name}</div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-300">
            <Check className="w-3 h-3" strokeWidth={2.5} />
            <span>Saved to your library</span>
          </div>
        </div>
      </div>
    );
  }

  if (status.kind === 'error') {
    return (
      <div className="p-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.04]">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-rose-500/15 border border-rose-500/25 shrink-0">
            <AlertCircle className="w-5 h-5 text-rose-300" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white">{character.name}</div>
            <div className="text-[11px] text-rose-300 truncate">{status.message}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onRetry(status.portraitPrompt)}
            disabled={disabled || !status.portraitPrompt}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-200 text-[12px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-3 h-3" strokeWidth={2.5} />
            Retry
          </button>
          <button
            onClick={onSkip}
            disabled={disabled}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  if (status.kind === 'tier-limit') {
    return (
      <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.04]">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-500/15 border border-amber-500/25 shrink-0">
            <Zap className="w-5 h-5 text-amber-300" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white">{character.name}</div>
            <div className="text-[11px] text-amber-300">Avatar limit reached</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onUpgrade}
            disabled={disabled}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-[12px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Zap className="w-3 h-3" strokeWidth={2.5} />
            Upgrade
          </button>
          <button
            onClick={onSkip}
            disabled={disabled}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  if (status.kind === 'skipped') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-[#1f2937] bg-white/[0.02] opacity-60">
        {renderPlaceholder()}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-zinc-400">{character.name}</div>
          <div className="text-[11px] text-zinc-500">
            Skipped — will use generic appearance
          </div>
        </div>
      </div>
    );
  }

  // Exhaustiveness fallback (should never hit)
  return null;
}

// === END OF FILE — if you can see this line, the file saved completely ===