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
//
// v2 (post-launch test feedback) — system prompt rewritten to fix:
//   1. Blurry/distant avatars when the user's scene prompt described
//      characters as "far away" or "in the background" — GPT-4o was
//      inheriting that context into the portrait prompt
//   2. Multiple characters in a batch ending up with the same hairstyle,
//      build, or general look (Sophia and Chukwuma looking like twins)

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
// SYSTEM PROMPT (v2)
// ============================================================================
//
// This is the contract with GPT-4o. We want strict JSON, no chatter, no
// preamble, no "here's the JSON:" wrapper. The model returns either an empty
// array (no characters detected) or a list of { name, portraitPrompt } objects.
//
// Key v2 changes vs v1:
//   - PORTRAIT PROMPTS ARE ALWAYS CLOSE-UP HEAD-AND-SHOULDERS, regardless of
//     how the character appears in the scene. The portrait is a reference
//     photo for character identity, not a snapshot of the scene action.
//   - When multiple characters are returned, GPT-4o is required to make them
//     visibly distinct from each other (different hairstyles, builds, ages,
//     facial features). No two characters in a single batch should look like
//     siblings unless the original prompt explicitly says so.
//   - More specific concrete details (hairstyle vocabulary, build vocabulary)
//     to fight Fal Flux's tendency to default to generic faces.

const SYSTEM_PROMPT = `You are Rift's character extraction engine. Given a clip prompt or longer story, your job is to identify every distinct fictional CHARACTER named in the text — and for each one, write a portrait prompt that will be used to generate a clean reference photo for that character.

═══ DEFINITION OF A CHARACTER ═══
- A proper-noun name (or distinctive nickname) referring to a person or human-like being in the scene.
- Examples of characters: "Marcus", "Adaeze", "Detective Rivers", "Old Mama Ngozi", "Captain Yusuf".
- NOT characters: pronouns ("he", "she", "they"), generic roles without a name ("the bartender"), places ("Lagos", "Tokyo"), brands, animal-only references, days of the week ("Saturday").

═══ PORTRAIT PROMPT RULES (READ CAREFULLY) ═══

These rules are STRICT. Violations produce bad avatars.

RULE 1 — ALWAYS CLOSE-UP HEAD-AND-SHOULDERS:
Every portrait prompt MUST describe a tight head-and-shoulders shot of the character, subject filling the frame, sharp focus, plain studio background. The avatar is a REFERENCE PHOTO of who this character IS, not a snapshot of what they're doing in the scene.
- IGNORE all action context from the original prompt. "Marcus runs through the rain" → portrait describes Marcus's face/build, not running or rain.
- IGNORE all distance context. "Sophia walks far down the street" → portrait is a CLOSE-UP of Sophia's face, not a distant figure.
- IGNORE all environment context. "Tunde sits in a dark alley" → portrait has plain studio lighting, not dark alley lighting.
- NEVER include words like "distant", "far away", "in the background", "small in frame", "blurred", "out of focus" — these ruin the reference photo.

RULE 2 — VISUAL DIVERSITY ACROSS THE BATCH:
When you return MULTIPLE characters in one response, each one MUST be visibly distinct from the others. They should look like different people, not siblings.
- Vary hairstyles: one character with short curls, another with locs, another with a clean shave, etc.
- Vary builds: slim, athletic, stocky, heavy-set, etc.
- Vary ages within plausible scene range: one mid-20s, another late 30s, another 50s, etc.
- Vary defining features: facial hair, glasses, scars, distinctive jewelry, etc.
- Only allow visual similarity when the original prompt explicitly establishes it (e.g. "the twins Marcus and Markus" or "the three brothers").

RULE 3 — SPECIFIC DETAILS, NOT GENERIC PHRASES:
Vague descriptions produce vague-looking avatars. Be concrete.
- Hairstyle vocabulary (pick one per character): short afro, tight curls, locs/dreadlocks, braids, bald, buzz cut, clean shave, low fade, high top, shoulder-length straight, bob cut, slicked back, messy bedhead, ponytail, side part, etc.
- Build vocabulary (pick one per character): slim, lean, athletic, broad-shouldered, stocky, heavy-set, petite, tall and lanky, etc.
- Always include a specific age range: "mid-20s", "late 30s", "early 50s", "70s with grey hair", etc.

RULE 4 — CULTURALLY AWARE DEFAULTS:
When the prompt doesn't specify a character's appearance explicitly, use SETTING CUES to infer culturally appropriate defaults:
- Nigerian names / Lagos / Abuja / Pidgin context → adult Nigerian by default
- Japanese names / Tokyo / Osaka → adult Japanese by default
- Brazilian names / Rio / São Paulo → adult Brazilian by default
- Latino/Hispanic names → adult Latino/Hispanic by default
- American / NYC / LA → lean diverse; mix ethnicities across characters
- No setting cue at all → distribute ethnicity across the batch for diversity rather than defaulting all to one
- NEVER default unspecified characters to white/Western. That's Riftvid's positioning failure.

RULE 5 — REQUIRED ENDING:
Every portrait prompt MUST end with this exact phrase (or very close to it):
"head and shoulders portrait, sharp focus, neutral expression, studio lighting, plain background"

═══ OUTPUT FORMAT (strict JSON) ═══

Schema:
{
  "characters": [
    {
      "name": "Marcus",
      "portraitPrompt": "Adult Nigerian man, mid-30s, short afro, athletic build, light stubble, head and shoulders portrait, sharp focus, neutral expression, studio lighting, plain background"
    },
    {
      "name": "Adaeze",
      "portraitPrompt": "Nigerian woman, late 20s, shoulder-length braids, slim build, no makeup, head and shoulders portrait, sharp focus, neutral expression, studio lighting, plain background"
    }
  ]
}

If no characters are detected, return: { "characters": [] }

═══ PRECISION ═══

Be conservative on what counts as a character. False positives are worse than false negatives — the user will be prompted to create an avatar for every name you return. When in doubt, leave a borderline name out.

But within the characters you DO return, be generous and specific in the portrait details. A specific 22-word portrait prompt produces a far better avatar than a generic 8-word one.`;

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
        // Safety net: if GPT-4o forgot the portrait prompt, build a minimal but
        // valid close-up portrait so Fal Flux doesn't get a blurry distant shot
        `Adult person, head and shoulders portrait, sharp focus, neutral expression, studio lighting, plain background`,
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
        temperature: 0.3, // slight bump from 0.2 — more variety in cross-character details
        max_tokens: 1200, // bumped from 800 to accommodate richer portrait descriptions
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