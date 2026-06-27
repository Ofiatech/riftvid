// app/api/prompts/detect-characters/route.ts
//
// Phase 4.3.5c — "I don't know Marcus" detection
//
// Called by the Generate-from-Prompt flow in Rift Studio before image generation.
// Uses GPT-4o to extract proper-noun character references from the user's prompt
// and, for each one, suggest a portrait description rich enough to feed Fal Flux
// during Auto-create.
//
// The frontend takes this list, cross-references against the user's existing
// avatars (exact + fuzzy match), and only opens the Unknown Characters modal
// if there's anything to resolve. By the time the user gets back to the actual
// /api/clips/generate-from-prompt call, all referenced characters exist as
// avatars in their library.
//
// IMPORTANT: this route only EXTRACTS character mentions. It does not check
// whether the user already has them — that's a client-side step using the
// already-fetched avatars list (saves a database round-trip and keeps fuzzy-
// match logic in one place).

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import OpenAI from 'openai';

export const maxDuration = 30;

// ============================================================================
// CONFIG
// ============================================================================

const MIN_PROMPT_LENGTH = 5;
const MAX_PROMPT_LENGTH = 5000; // generous — Story-to-Scenes will pass full stories here in Phase 5

// ============================================================================
// TYPES
// ============================================================================

interface DetectedCharacter {
  /** Proper-noun name as it appears in the user's prompt */
  name: string;
  /**
   * A portrait prompt rich enough to feed Fal Flux during Auto-create.
   * GPT-4o infers from the scene context, defaulting to culturally appropriate
   * choices when the user didn't specify (e.g. "Lagos" → Nigerian by default).
   */
  portraitPrompt: string;
}

interface DetectResponseBody {
  detectedCharacters: DetectedCharacter[];
  /** Echoed back for client-side cache busting if needed */
  promptHash: string;
}

// ============================================================================
// OPENAI CLIENT
// ============================================================================

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: key });
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================
//
// This is the contract with GPT-4o. We want strict JSON, no chatter, no
// preamble, no "here's the JSON:" wrapper. The model returns either an empty
// array (no characters detected) or a list of { name, portraitPrompt } objects.
//
// Rules baked in:
//   - Skip pronouns ("he", "she", "they") even if they refer to a character
//   - Skip common nouns that look capitalized due to sentence position
//   - Skip place names, brand names, animal-only references
//   - Treat dialogue-tagged names as characters ("Marcus said...")
//   - Infer culturally appropriate appearance when prompt is sparse, using
//     setting cues (Lagos → Nigerian, Tokyo → Japanese, etc.). If no setting
//     cue is given, default to a neutral adult human description rather than
//     defaulting to white/Western — this is Riftvid's African-creators
//     superpower in action.
//
// The portrait prompt must be a SINGLE LINE, ready to feed to Fal Flux.

const SYSTEM_PROMPT = `You are Rift's character extraction engine. Given a short clip prompt or longer story, your job is to identify every distinct fictional CHARACTER named in the text — and for each one, write a one-line portrait description rich enough to generate a consistent reference photo.

DEFINITION OF A CHARACTER:
- A proper-noun name (or distinctive nickname) that refers to a person or human-like being in the scene.
- Examples: "Marcus", "Adaeze", "Detective Rivers", "Old Mama Ngozi", "Captain Yusuf".
- NOT characters: pronouns ("he", "she", "they"), generic roles without a name ("the bartender"), places ("Lagos", "Tokyo"), brands, animal-only references, time/day names ("Saturday").

DEFINITION OF A PORTRAIT PROMPT:
- A single line of ~10–30 words describing the character's appearance.
- Pull explicit details from the prompt (ethnicity, age, attire, build, hairstyle) when present.
- When the prompt doesn't specify appearance, use SETTING CUES to infer culturally appropriate defaults:
  - Nigerian / Lagos / Abuja / Pidgin → adult Nigerian by default
  - Japanese / Tokyo / Osaka → adult Japanese by default
  - Brazilian / Rio / São Paulo → adult Brazilian by default
  - American / NYC / LA → mixed defaults; lean diverse
  - No setting cue at all → neutral phrasing like "adult person" with no ethnicity assumed
- Always include: "portrait orientation, neutral expression, studio lighting" at the end for consistency.
- Never invent specific facts not implied by the prompt (e.g. don't add "scar on left cheek" if not mentioned).

OUTPUT FORMAT:
Strict JSON only, no preamble, no markdown fences, no commentary. Schema:
{
  "characters": [
    { "name": "Marcus", "portraitPrompt": "Adult Nigerian man, business attire, portrait orientation, neutral expression, studio lighting" }
  ]
}

If no characters are detected, return: { "characters": [] }

Be conservative. If you're unsure whether something is a character name, leave it out. False positives are worse than false negatives here — the user will be asked to auto-create an avatar for every name you return.`;

// ============================================================================
// HELPERS
// ============================================================================

/** Stable cheap hash so the client can cache results per prompt. */
function hashPrompt(prompt: string): string {
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = (hash << 5) - hash + prompt.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash).toString(36)}`;
}

/** Safely parse GPT-4o's JSON response, tolerating accidental code fences. */
function parseModelJson(raw: string): unknown {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

/** Validate that the parsed payload matches our expected shape. */
function extractCharacters(parsed: unknown): DetectedCharacter[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as Record<string, unknown>;
  const arr = obj.characters;
  if (!Array.isArray(arr)) return [];

  const out: DetectedCharacter[] = [];
  const seenNames = new Set<string>();

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    const portraitPrompt = typeof c.portraitPrompt === 'string' ? c.portraitPrompt.trim() : '';

    if (!name) continue;
    if (name.length > 80) continue; // sanity guard

    // Dedupe case-insensitive — Marcus and marcus are the same character
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    out.push({
      name,
      portraitPrompt:
        portraitPrompt ||
        // Safety net: if GPT-4o forgot the portrait prompt, build a generic one
        `Adult person, portrait orientation, neutral expression, studio lighting`,
    });
  }

  return out;
}

// ============================================================================
// POST /api/prompts/detect-characters
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate body
    let body: { prompt?: string };
    try {
      body = (await req.json()) as { prompt?: string };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const prompt = (body.prompt ?? '').toString().trim();

    if (prompt.length < MIN_PROMPT_LENGTH) {
      return NextResponse.json(
        { error: 'Prompt too short', detectedCharacters: [], promptHash: '' },
        { status: 400 }
      );
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json(
        { error: 'Prompt too long', detectedCharacters: [], promptHash: '' },
        { status: 400 }
      );
    }

    // Call GPT-4o
    const openai = getOpenAI();
    let raw: string;
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: 'json_object' },
      });

      raw = completion.choices?.[0]?.message?.content?.trim() ?? '';
      if (!raw) throw new Error('Empty response from GPT-4o');
    } catch (err) {
      console.error('GPT-4o character detection failed:', err);
      // Don't block the user — return empty list, they can still generate.
      // The existing word-boundary detection in /api/clips/generate-from-prompt
      // will pick up any avatars that DO match by exact name.
      return NextResponse.json<DetectResponseBody>({
        detectedCharacters: [],
        promptHash: hashPrompt(prompt),
      });
    }

    // Parse + validate the model's JSON
    let detectedCharacters: DetectedCharacter[];
    try {
      const parsed = parseModelJson(raw);
      detectedCharacters = extractCharacters(parsed);
    } catch (err) {
      console.error('Failed to parse GPT-4o response:', err, 'raw:', raw);
      // Same graceful fallback — never block the user on a parse error
      detectedCharacters = [];
    }

    return NextResponse.json<DetectResponseBody>({
      detectedCharacters,
      promptHash: hashPrompt(prompt),
    });
  } catch (err) {
    console.error('POST /api/prompts/detect-characters error:', err);
    return NextResponse.json(
      {
        error: 'Internal server error',
        detectedCharacters: [],
        promptHash: '',
      },
      { status: 500 }
    );
  }
}