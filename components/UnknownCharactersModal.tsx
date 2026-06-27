'use client';

// components/UnknownCharactersModal.tsx
//
// Phase 4.3.5c — "I don't know Marcus" UX
//
// Shown after the user taps Generate in the Generate-from-Prompt tab, IF Rift
// detected character names that don't already match avatars in their library.
// Each detected character gets a row with one of several action states:
//
//   ✅ exact          — already in library, just shows the match
//   🔍 fuzzy-suggest  — "Did you mean Markus?" with [Use Markus] / [Create new]
//   ✅ fuzzy-accept   — user picked the existing avatar
//   ❓ unknown        — [Auto-create] button
//   ⏳ creating       — full-screen blocking spinner during Fal Flux + save
//   ✅ created        — avatar saved to library, row shows ✓
//   ⚠️ error          — Fal/save failed; [Retry] or [Skip]
//   💎 tier-limit     — user hit their avatar cap; [Upgrade] or [Skip]
//   ⏭️ skipped        — user explicitly bowed out, generation will use Flux Dev fallback
//
// When all rows are in a terminal state (exact, fuzzy-accept, created, or skipped),
// the Continue button activates. On Continue, the modal emits:
//   - createdAvatarIds: IDs of newly-created avatars
//   - nameSubstitutions: [{ from: "Markus", to: "Marcus" }] for fuzzy-accepted rows
//     (so the parent can swap names in the prompt before calling
//      /api/clips/generate-from-prompt, where the existing word-boundary
//      detection will then find the resolved avatars)
//
// PHASE 5 NOTE: This component is intentionally reusable. The Story-to-Scenes
// engine will call it with a much larger detectedCharacters list spanning
// every character across every scene of a story. No code changes should be
// needed for that.

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
} from 'lucide-react';
import { resolveName, type NameResolution } from '@/lib/fuzzyMatchName';
import type { AvatarRecord } from '@/lib/avatars';

// ============================================================================
// TYPES
// ============================================================================

interface DetectedCharacter {
  name: string;
  portraitPrompt: string;
}

interface UnknownCharactersModalProps {
  open: boolean;
  /** Output of /api/prompts/detect-characters */
  detectedCharacters: DetectedCharacter[];
  /** The user's CURRENT avatar library (parent fetches and passes in) */
  avatars: AvatarRecord[];
  /** User dismissed without finishing (X button). Parent should abort gen. */
  onClose: () => void;
  /** All rows resolved — parent should proceed with the original generation. */
  onAllResolved: (result: {
    createdAvatarIds: string[];
    nameSubstitutions: Array<{ from: string; to: string }>;
  }) => void;
  /** User hit avatar tier limit and tapped Upgrade — open TierPickerModal. */
  onAtLimit: () => void;
}

/** Per-row state machine. */
type RowStatus =
  | { kind: 'exact'; avatar: AvatarRecord }
  | { kind: 'fuzzy-suggested'; suggested: AvatarRecord; similarity: number }
  | { kind: 'fuzzy-accepted'; avatar: AvatarRecord }
  | { kind: 'unknown' }
  | { kind: 'creating' }
  | { kind: 'created'; avatar: AvatarRecord }
  | { kind: 'error'; message: string }
  | { kind: 'tier-limit' }
  | { kind: 'skipped' };

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
  avatars,
  onClose,
  onAllResolved,
  onAtLimit,
}: UnknownCharactersModalProps) {
  // === STATE ===
  const [rowStatuses, setRowStatuses] = useState<Record<string, RowStatus>>({});
  const [draftSessionId, setDraftSessionId] = useState<string>('');
  const [blockingCharacter, setBlockingCharacter] = useState<string | null>(null);

  // === INIT ON OPEN ===
  // When the modal opens, resolve every detected character against the current
  // avatars list and set the initial row statuses. We DON'T re-resolve as new
  // avatars get created during the session — that could cause spooky linking
  // (e.g. user auto-creates "Marcus", then "Markus" later in the same prompt
  // suddenly fuzzy-matches to it). Keep each row's destiny independent.
  useEffect(() => {
    if (!open) return;

    setDraftSessionId(makeDraftSessionId());

    const initial: Record<string, RowStatus> = {};
    for (const char of detectedCharacters) {
      const resolution = resolveName(char.name, avatars);
      initial[char.name] = resolutionToStatus(resolution);
    }
    setRowStatuses(initial);
    setBlockingCharacter(null);
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

  const handleAutoCreate = useCallback(
    async (name: string, portraitPrompt: string) => {
      if (blockingCharacter) return; // already creating something

      setBlockingCharacter(name);
      setRowStatuses((prev) => ({ ...prev, [name]: { kind: 'creating' } }));

      try {
        // Step 1: Generate the portrait via Fal Flux
        // (Reuses the same backend endpoint that the existing NewAvatarModal uses)
        const genRes = await fetch('/api/avatars/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: portraitPrompt,
            draftSessionId,
          }),
        });

        const genData = await genRes.json();

        // Out of credits → mark row as tier-limit (user gets Upgrade/Skip choice)
        if (genRes.status === 402 || genData.error === 'out_of_credits') {
          setRowStatuses((prev) => ({ ...prev, [name]: { kind: 'tier-limit' } }));
          setBlockingCharacter(null);
          return;
        }

        if (!genRes.ok || !genData.falImageUrl) {
          throw new Error(
            genData.message || genData.error || 'Portrait generation failed'
          );
        }

        // Step 2: Save the avatar with the generated portrait
        // (Backend rehosts the Fal URL to permanent Supabase storage automatically)
        const saveRes = await fetch('/api/avatars', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            source: 'ai_generated',
            photoUrls: [genData.falImageUrl],
          }),
        });

        const saveData = await saveRes.json();

        // Avatar tier limit reached → tier-limit state
        if (saveRes.status === 403 && saveData.error === 'avatar_limit_reached') {
          setRowStatuses((prev) => ({ ...prev, [name]: { kind: 'tier-limit' } }));
          setBlockingCharacter(null);
          return;
        }

        if (!saveRes.ok || !saveData.avatar) {
          throw new Error(
            saveData.message || saveData.error || 'Failed to save avatar'
          );
        }

        // Success — mark row as created
        const newAvatar = saveData.avatar as AvatarRecord;
        setRowStatuses((prev) => ({
          ...prev,
          [name]: { kind: 'created', avatar: newAvatar },
        }));
        setBlockingCharacter(null);
      } catch (err) {
        console.error('Auto-create error:', err);
        setRowStatuses((prev) => ({
          ...prev,
          [name]: {
            kind: 'error',
            message: err instanceof Error ? err.message : 'Something went wrong',
          },
        }));
        setBlockingCharacter(null);
      }
    },
    [blockingCharacter, draftSessionId]
  );

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
        // The new avatar's name matches the detected name → no substitution
      } else if (status.kind === 'fuzzy-accepted') {
        // User picked an existing avatar with a different spelling.
        // Substitute the detected name → avatar name in the prompt so the
        // existing word-boundary detection in /api/clips/generate-from-prompt
        // finds the matched avatar.
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* No click-outside-to-close — the user must explicitly Continue or close */}
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
              disabled={!!blockingCharacter}
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
                onUseFuzzyMatch={(avatar) => handleUseFuzzyMatch(char.name, avatar)}
                onSkip={() => handleSkip(char.name)}
                onRetry={() => handleRetry(char.name, char.portraitPrompt)}
                onUpgrade={handleUpgrade}
                disabled={!!blockingCharacter}
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
              disabled={!allResolved || !!blockingCharacter}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>

      {/* ===== FULL-SCREEN BLOCKING OVERLAY DURING AUTO-CREATE ===== */}
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
  );
}

// ============================================================================
// CHARACTER ROW SUB-COMPONENT
// ============================================================================

interface CharacterRowProps {
  character: DetectedCharacter;
  status: RowStatus;
  onAutoCreate: () => void;
  onUseFuzzyMatch: (avatar: AvatarRecord) => void;
  onSkip: () => void;
  onRetry: () => void;
  onUpgrade: () => void;
  disabled: boolean;
}

function CharacterRow({
  character,
  status,
  onAutoCreate,
  onUseFuzzyMatch,
  onSkip,
  onRetry,
  onUpgrade,
  disabled,
}: CharacterRowProps) {
  // Small avatar thumb (matches the photo styling in NewAvatarModal)
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
        <div className="flex items-center gap-3 mb-2">
          {renderAvatarThumb(status.suggested)}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white">{character.name}</div>
            <div className="text-[11px] text-amber-300">
              Did you mean{' '}
              <span className="font-semibold">{status.suggested.name}</span>?
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onUseFuzzyMatch(status.suggested)}
            disabled={disabled}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-200 text-[12px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="w-3 h-3" strokeWidth={2.5} />
            Use {status.suggested.name}
          </button>
          <button
            onClick={onAutoCreate}
            disabled={disabled}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-purple-500/80 to-purple-600/80 hover:from-purple-500 hover:to-purple-600 text-white text-[12px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-3 h-3" strokeWidth={2.5} />
            Create new
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
      <div className="flex items-center gap-3 p-3 rounded-xl border border-[#1f2937] bg-white/[0.02]">
        {renderPlaceholder()}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">{character.name}</div>
          <div className="text-[11px] text-zinc-500">Not in your library yet</div>
        </div>
        <button
          onClick={onAutoCreate}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[12px] font-semibold shadow-sm shadow-purple-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Sparkles className="w-3 h-3" strokeWidth={2.5} />
          Auto-create
        </button>
      </div>
    );
  }

  if (status.kind === 'creating') {
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

  if (status.kind === 'created') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
        {renderAvatarThumb(status.avatar)}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">{character.name}</div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-300">
            <Check className="w-3 h-3" strokeWidth={2.5} />
            <span>Created and saved to your library</span>
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
            onClick={onRetry}
            disabled={disabled}
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