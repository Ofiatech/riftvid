// lib/fuzzyMatchName.ts
//
// Phase 4.3.5c — name resolution for character detection
//
// Given a character name detected by GPT-4o and the user's avatar library,
// decide whether the name resolves to:
//   - an EXACT match (case-insensitive)
//   - a FUZZY match (Levenshtein similarity >= threshold) — e.g. "Markus" → "Marcus"
//   - UNKNOWN (no match — needs Auto-create)
//
// Used client-side by UnknownCharactersModal. Pure function, no I/O.
//
// Examples:
//   resolveName("Marcus", [{ id: "1", name: "Marcus" }])
//     → { type: "exact", avatar: { id: "1", name: "Marcus" } }
//
//   resolveName("Markus", [{ id: "1", name: "Marcus" }])
//     → { type: "fuzzy", avatar: ..., similarity: 0.83 }   (above 0.8 threshold)
//
//   resolveName("Adaeze", [{ id: "1", name: "Marcus" }])
//     → { type: "unknown" }

import type { AvatarRecord } from '@/lib/avatars';

/** Below this similarity ratio, names are treated as unrelated. */
const FUZZY_THRESHOLD = 0.8;

export type NameResolution =
  | { type: 'exact'; avatar: AvatarRecord }
  | { type: 'fuzzy'; avatar: AvatarRecord; similarity: number }
  | { type: 'unknown' };

// ============================================================================
// LEVENSHTEIN DISTANCE — classic dynamic programming, O(m*n)
// ============================================================================
//
// We use a two-row implementation rather than a full matrix to keep memory
// usage low — character names are short (typically 3–20 chars), so this is
// more about correctness/readability than speed.

function levenshtein(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  const m = s1.length;
  const n = s2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/** Similarity ratio: 1.0 = identical, 0.0 = completely different. */
function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ============================================================================
// MAIN ENTRY
// ============================================================================

/**
 * Resolve a detected character name against the user's avatar library.
 *
 * Resolution priority:
 *   1. EXACT match (case-insensitive) wins immediately
 *   2. Otherwise, the avatar with HIGHEST fuzzy similarity above threshold
 *      (ties broken by most-recently-updated avatar, since that's likely
 *       the "live" version of a character the user is actively using)
 *   3. Otherwise, UNKNOWN
 */
export function resolveName(
  detectedName: string,
  avatars: AvatarRecord[]
): NameResolution {
  const target = detectedName.trim();
  if (!target || avatars.length === 0) return { type: 'unknown' };

  // 1) Exact match (case-insensitive)
  const targetLower = target.toLowerCase();
  const exact = avatars.find((a) => a.name.toLowerCase() === targetLower);
  if (exact) return { type: 'exact', avatar: exact };

  // 2) Fuzzy match — find the best candidate above threshold
  let bestAvatar: AvatarRecord | null = null;
  let bestSimilarity = 0;

  for (const avatar of avatars) {
    const sim = similarityRatio(target, avatar.name);
    if (sim < FUZZY_THRESHOLD) continue;

    if (
      sim > bestSimilarity ||
      // Tie-break: prefer the most recently updated avatar
      (sim === bestSimilarity &&
        bestAvatar &&
        new Date(avatar.updated_at).getTime() > new Date(bestAvatar.updated_at).getTime())
    ) {
      bestAvatar = avatar;
      bestSimilarity = sim;
    }
  }

  if (bestAvatar) {
    return { type: 'fuzzy', avatar: bestAvatar, similarity: bestSimilarity };
  }

  // 3) Unknown — must be auto-created
  return { type: 'unknown' };
}

/**
 * Convenience: bulk-resolve a list of detected names.
 * Returns an array preserving the input order.
 */
export function resolveNames(
  detectedNames: string[],
  avatars: AvatarRecord[]
): Array<{ name: string; resolution: NameResolution }> {
  return detectedNames.map((name) => ({
    name,
    resolution: resolveName(name, avatars),
  }));
}