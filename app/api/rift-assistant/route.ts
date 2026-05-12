import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const maxDuration = 60;

// ============================================================================
// RIFT v3 — DIRECTOR-BRAIN ARCHITECTURE
// ============================================================================
// Single intelligent GPT-4o call analyzes image + prompt holistically and
// generates 0-4 scene-specific questions like a real film director would.
// No rigid scoring, no regex pattern matching — pure contextual intelligence
// with hard rules as safety rails.
//
// Visual ANTI_GLITCH_SAFEGUARDS: UNTOUCHED (working perfectly)
// Audio AUDIO_SAFEGUARDS: NEW (separate constant for audio quality)
// Mode architecture: PRESERVED (only cinematic active)
// Frontend contract: UNCHANGED
// ============================================================================

// --- MODE CONFIGURATION ---
const ACTIVE_MODES = ['cinematic'] as const;
type VideoMode = 'cinematic' | 'social' | 'creative' | 'commercial';

// --- VISUAL ANTI-GLITCH PROTECTION (DO NOT MODIFY — working in production) ---
const ANTI_GLITCH_SAFEGUARDS = `Realistic facial features with natural skin texture, anatomically correct hands and fingers with proper finger count, smooth natural body movements with physically plausible motion, natural eye blink and gaze, lip-sync visible when speech occurs, no distortion or morphing, no extra limbs or duplicated body parts, no warping of facial features, consistent character appearance throughout the clip, smooth motion blur on movement, photorealistic quality.`;

// --- AUDIO QUALITY PROTECTION (NEW — approved by founder) ---
const AUDIO_SAFEGUARDS = `Audio quality: clear and accurate pronunciation, no stammering or stuttering, distinct word articulation with no slurred speech, natural conversational rhythm without word mixing or repetition, precise lip-sync matching every spoken word, no audio glitches, skips, or artifacts, consistent voice tone throughout the clip, natural breathing pauses between sentences.`;

// =============================================================================
// TYPES
// =============================================================================
interface RiftRequest {
  basePrompt: string;
  answers: string[];
  step: number;
  imageBase64?: string;
  imageDescription?: string;
  totalSteps?: number;
  // NEW v3: cache the question plan across steps
  questionPlan?: QuestionPlan;
}

interface DirectorQuestion {
  question: string;
  options: string[];
  acknowledgmentBeforeQuestion?: string;
  targetGap: string; // e.g. "dialogue", "camera", "accent", "team_identity"
}

interface QuestionPlan {
  questions: DirectorQuestion[];
  reasoning: string; // For logging/debugging
  sceneAcknowledgment: string;
}

interface RiftResponse {
  question?: string;
  options?: string[];
  acknowledgmentBeforeQuestion?: string;
  sceneAcknowledgment?: string;
  imageDescription?: string;
  totalSteps?: number;
  done?: boolean;
  refinedPrompt?: string;
  questionPlan?: QuestionPlan; // NEW v3: passed back for caching
  error?: string;
}

// =============================================================================
// IMAGE ANALYSIS — uses safety-filter-friendly vocabulary
// =============================================================================
async function describeImage(imageBase64: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 350,
      messages: [
        {
          role: 'system',
          content: `You are a visual composition analyst. Describe what is depicted in images for video generation purposes. Focus on visual elements: subjects, clothing, setting, lighting, mood, composition. Do not identify specific real people. Describe characters as visual elements (e.g. "a man in a blue suit", "a woman with curly hair") without naming or recognizing individuals.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe the visual composition in this image for video generation. Include: main subject visual features (clothing, hairstyle, expression, perceived ethnicity/region for accent purposes), setting and background details, lighting and color palette, mood and atmosphere, any other people or objects in frame. Keep description concise (4-5 sentences).',
            },
            {
              type: 'image_url',
              image_url: { url: imageBase64 },
            },
          ],
        },
      ],
    });

    return completion.choices[0]?.message?.content || 'A scene with visual subjects.';
  } catch (err) {
    console.error('Vision error (using fallback):', err);
    return 'A scene with visual subjects ready for animation.';
  }
}

// =============================================================================
// DIRECTOR-BRAIN QUESTION PLANNING — the heart of v3
// =============================================================================
async function generateQuestionPlan(
  basePrompt: string,
  imageDescription: string
): Promise<QuestionPlan> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are Rift, a senior film director helping users create AI-generated videos.

Your job: Look at the user's scene (image) and prompt, then decide what 0-4 questions would MOST improve their video output. Generate ALL questions at once as a complete plan.

═══ CRITICAL HARD RULES ═══
These rules override your judgment. You MUST follow them:

RULE 1 — Speech check:
If the user mentions someone speaking (says, tells, asks, speaks, whispers, etc.) but did NOT provide the actual quoted dialogue line → MUST ask: "What does [subject] say?" with 3 scene-appropriate suggested lines + "Let me write my own" as options.

EXCEPTION: If user already wrote dialogue in quotes ("hello world") or after a colon (says: hello world) → DO NOT ask, dialogue is provided.

RULE 2 — Camera intent check:
If user did NOT specify camera intent (push-in, pull-back, follow, static, pan, zoom, etc.) → MUST ask camera intent. Options: "Hold still on subject", "Slow push-in toward subject", "Slow pull-back to reveal scene", "Follow subject as they move".

EXCEPTION: If user already specified camera (e.g. "slow push-in", "wide shot", "camera follows") → DO NOT ask.

RULE 3 — Accent check (for character-driven scenes):
If the scene involves a character speaking AND the user did not specify accent/voice tone → ask about accent. Options should be scene-relevant: e.g. for African scenes ("Nigerian English", "Pidgin English", "South African", "Let me describe"). For other regions, adapt accordingly. Generic option: ("Natural English", "American accent", "British accent", "Let me describe").

EXCEPTION: If user mentioned accent or specific dialect → skip.

═══ SCENE-SPECIFIC INTELLIGENCE ═══

Beyond hard rules, use your director's eye to identify what would make THIS specific video better:

- Multiple people in scene? → Ask about their identity/role ("These look like a team — what's their work? Engineers, content creators, etc.")
- Vague action? → Ask what specifically happens
- Unclear emotion? → Ask performance intensity (subtle, expressive, intense)
- Unclear time/lighting if image is ambiguous → Ask lighting/time of day
- Object-focused scene → Ask about object behavior

═══ OUTPUT RULES ═══

1. Generate 0-4 questions TOTAL (mandatory rules + scene-specific, no duplicates)
2. Each question MUST have 4 options (specific to user's actual scene, not generic)
3. Each option must be max 50 characters
4. Skip ANY question for what user already specified
5. Order questions: mandatory rules first, then scene-specific
6. NEVER ask about what's clearly visible in the image (e.g. don't ask "what color shirt?" if image shows shirt)

═══ OUTPUT FORMAT (strict JSON) ═══

{
  "sceneAcknowledgment": "1-2 sentences showing you understood the scene and user's intent. End with: 'No questions needed — let me polish your prompt.' if 0 questions, OR 'Just one question to nail this.' if 1, OR 'A few quick questions to make this cinematic.' if 2-4.",
  "questions": [
    {
      "question": "The actual question text",
      "options": ["Option 1", "Option 2", "Option 3", "Let me describe"],
      "targetGap": "dialogue|camera|accent|emotion|team_identity|action|lighting|setting|other",
      "acknowledgmentBeforeQuestion": "Brief acknowledgment of previous answer (only for questions 2+, leave empty string for question 1)"
    }
  ],
  "reasoning": "Brief explanation of why you chose these questions (for logging)"
}

If 0 questions are needed: return empty questions array. The prompt is complete and just needs polish + safeguards.`,
        },
        {
          role: 'user',
          content: `Analyze this scene and generate a question plan.

USER'S PROMPT: "${basePrompt}"

SCENE DESCRIPTION: ${imageDescription}

Apply the hard rules. Then add scene-specific questions if needed. Return your complete plan as JSON.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('No question plan generated');

    const parsed = JSON.parse(raw);

    // Validate and normalize the plan
    const questions: DirectorQuestion[] = Array.isArray(parsed.questions)
      ? parsed.questions.slice(0, 4).map((q: Record<string, unknown>, idx: number) => ({
          question: typeof q.question === 'string' ? q.question : 'What feel do you want?',
          options: Array.isArray(q.options) && q.options.length === 4
            ? (q.options as string[])
            : ['Option 1', 'Option 2', 'Option 3', 'Let me describe'],
          targetGap: typeof q.targetGap === 'string' ? q.targetGap : 'other',
          acknowledgmentBeforeQuestion:
            idx === 0
              ? undefined
              : typeof q.acknowledgmentBeforeQuestion === 'string' && q.acknowledgmentBeforeQuestion.length > 0
                ? q.acknowledgmentBeforeQuestion
                : 'Got it.',
        }))
      : [];

    const plan: QuestionPlan = {
      questions,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided',
      sceneAcknowledgment:
        typeof parsed.sceneAcknowledgment === 'string'
          ? parsed.sceneAcknowledgment
          : 'I see your scene. Let me help refine this.',
    };

    console.log('Rift v3 director plan:', {
      questionCount: plan.questions.length,
      gaps: plan.questions.map((q) => q.targetGap),
      reasoning: plan.reasoning,
    });

    return plan;
  } catch (err) {
    console.error('Director plan error (using fallback):', err);
    // Conservative fallback: ask camera + emotion as safe defaults
    return {
      questions: [
        {
          question: 'How should the camera move in this scene?',
          options: [
            'Hold still on subject',
            'Slow push-in toward subject',
            'Slow pull-back to reveal',
            'Follow subject as they move',
          ],
          targetGap: 'camera',
        },
        {
          question: 'What emotional tone should the performance have?',
          options: ['Subtle and natural', 'Confident and bold', 'Dramatic and intense', 'Let me describe'],
          targetGap: 'emotion',
          acknowledgmentBeforeQuestion: 'Got it.',
        },
      ],
      reasoning: 'Fallback questions used due to error',
      sceneAcknowledgment: 'I see your scene. A few quick questions to make this cinematic.',
    };
  }
}

// =============================================================================
// FINAL PROMPT SYNTHESIS — bakes BOTH visual AND audio safeguards
// =============================================================================
async function synthesizeFinalPrompt(
  basePrompt: string,
  imageDescription: string,
  answers: string[],
  questionPlan: QuestionPlan | undefined,
  mode: VideoMode
): Promise<{ refinedPrompt: string; finalAcknowledgment: string }> {
  try {
    // Build answer context with which gap each answer addresses
    const answerContext =
      questionPlan && questionPlan.questions.length > 0
        ? questionPlan.questions
            .map((q, idx) => `${q.targetGap}: ${answers[idx] || 'not answered'}`)
            .join('\n')
        : 'No additional answers — prompt was complete';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content: `You are Rift, an AI video director who writes professional video generation prompts for the Grok Imagine model.

CRITICAL OUTPUT FORMAT:
Write ONE flowing paragraph (no bullet points, no labels, no headers) combining:
1. Camera framing and movement (from answers if provided)
2. Subject visual details from the scene description
3. Specific action/motion
4. Emotional performance level
5. Dialogue (in quotes) if scene calls for speech
6. Accent/voice tone if specified
7. Setting and lighting context
8. Ambient sound cues
9. Quality safeguards (appended at end — see below)

ALWAYS end the prompt with these EXACT safeguards in this exact order:
"${ANTI_GLITCH_SAFEGUARDS} ${AUDIO_SAFEGUARDS}"

Mode: ${mode}
${
  mode === 'cinematic'
    ? '- Use cinematic language: medium shot, push-in, golden hour, shallow depth of field, etc.\n- Emphasize realism and character performance.\n- Lock down lip-sync if dialogue is present.'
    : ''
}`,
        },
        {
          role: 'user',
          content: `Synthesize the final video generation prompt.

SCENE DESCRIPTION: ${imageDescription}
USER'S BASE PROMPT: ${basePrompt}
USER'S ANSWERS (by target gap):
${answerContext}

Write one flowing cinematic paragraph that ends with the exact visual + audio safeguards. No labels, no headers, no bullets — just professional prompt prose.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || '';
    let refinedPrompt = raw.trim();

    // SAFETY NET: ensure BOTH safeguards are present even if AI forgot
    const hasVisualSafeguards =
      refinedPrompt.includes('Realistic facial features') ||
      refinedPrompt.includes('anatomically correct hands');
    const hasAudioSafeguards =
      refinedPrompt.includes('Audio quality') ||
      refinedPrompt.includes('no stammering');

    if (!hasVisualSafeguards) {
      refinedPrompt = `${refinedPrompt} ${ANTI_GLITCH_SAFEGUARDS}`;
    }
    if (!hasAudioSafeguards) {
      refinedPrompt = `${refinedPrompt} ${AUDIO_SAFEGUARDS}`;
    }

    const finalAcknowledgment =
      answers.length === 0
        ? "Your prompt was already strong — I added cinematic polish and quality safeguards to prevent AI glitches."
        : "Perfect — I've crafted your cinematic prompt with visual and audio safeguards built in.";

    return { refinedPrompt, finalAcknowledgment };
  } catch (err) {
    console.error('Synthesis error (using fallback):', err);
    const fallback = `${basePrompt}. ${imageDescription}. ${ANTI_GLITCH_SAFEGUARDS} ${AUDIO_SAFEGUARDS}`;
    return {
      refinedPrompt: fallback,
      finalAcknowledgment: 'Prompt ready with visual and audio safeguards applied.',
    };
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================
export async function POST(req: NextRequest): Promise<NextResponse<RiftResponse>> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const body: RiftRequest = await req.json();
    const { basePrompt, answers, step, imageBase64, imageDescription, totalSteps, questionPlan } = body;

    if (!basePrompt || typeof basePrompt !== 'string') {
      return NextResponse.json({ error: 'Base prompt is required' }, { status: 400 });
    }

    // === STEP 0: Initialize — analyze image, generate full question plan ===
    if (step === 0) {
      const imageDesc = imageBase64
        ? await describeImage(imageBase64)
        : 'A scene ready for animation.';

      // Generate the complete director plan in one call
      const plan = await generateQuestionPlan(basePrompt, imageDesc);
      const questionCount = plan.questions.length;

      // CASE A: 0 questions — director thinks prompt is complete
      if (questionCount === 0) {
        const { refinedPrompt, finalAcknowledgment } = await synthesizeFinalPrompt(
          basePrompt,
          imageDesc,
          [],
          plan,
          'cinematic'
        );

        return NextResponse.json({
          done: true,
          refinedPrompt,
          imageDescription: imageDesc,
          sceneAcknowledgment: plan.sceneAcknowledgment,
          acknowledgmentBeforeQuestion: finalAcknowledgment,
          totalSteps: 0,
        });
      }

      // CASE B: 1-4 questions — return first question + cache the plan
      const firstQ = plan.questions[0];

      return NextResponse.json({
        question: firstQ.question,
        options: firstQ.options,
        sceneAcknowledgment: plan.sceneAcknowledgment,
        imageDescription: imageDesc,
        totalSteps: questionCount,
        questionPlan: plan, // Cache for subsequent calls
      });
    }

    // === STEP 1+: Follow-up question OR final synthesis ===
    const cachedImageDesc = imageDescription || 'A scene ready for animation.';
    const totalQuestions = totalSteps ?? (questionPlan?.questions.length ?? 4);

    // All questions answered → synthesize final prompt
    if (step >= totalQuestions) {
      const { refinedPrompt, finalAcknowledgment } = await synthesizeFinalPrompt(
        basePrompt,
        cachedImageDesc,
        answers,
        questionPlan,
        'cinematic'
      );

      return NextResponse.json({
        done: true,
        refinedPrompt,
        acknowledgmentBeforeQuestion: finalAcknowledgment,
        totalSteps: totalQuestions,
      });
    }

    // Still need more questions → return next one from cached plan
    if (questionPlan && questionPlan.questions[step]) {
      const nextQ = questionPlan.questions[step];

      return NextResponse.json({
        question: nextQ.question,
        options: nextQ.options,
        acknowledgmentBeforeQuestion: nextQ.acknowledgmentBeforeQuestion,
        totalSteps: totalQuestions,
        questionPlan, // Pass it back to keep caching
      });
    }

    // Edge case: no cached plan, regenerate
    // (This shouldn't normally happen since frontend caches imageDescription and we pass plan)
    console.warn('Rift v3: no cached questionPlan, regenerating');
    const newPlan = await generateQuestionPlan(basePrompt, cachedImageDesc);

    if (newPlan.questions[step]) {
      const nextQ = newPlan.questions[step];
      return NextResponse.json({
        question: nextQ.question,
        options: nextQ.options,
        acknowledgmentBeforeQuestion: nextQ.acknowledgmentBeforeQuestion,
        totalSteps: newPlan.questions.length,
        questionPlan: newPlan,
      });
    }

    // Final fallback: synthesize with what we have
    const { refinedPrompt, finalAcknowledgment } = await synthesizeFinalPrompt(
      basePrompt,
      cachedImageDesc,
      answers,
      newPlan,
      'cinematic'
    );

    return NextResponse.json({
      done: true,
      refinedPrompt,
      acknowledgmentBeforeQuestion: finalAcknowledgment,
      totalSteps: answers.length,
    });
  } catch (error) {
    console.error('=== RIFT V3 ERROR ===');
    console.error(error);
    console.error('=== END RIFT V3 ERROR ===');

    let userMessage = 'Rift couldn\'t process your request';
    if (error instanceof Error) {
      if (error.message.includes('rate limit')) {
        userMessage = 'OpenAI rate limit. Wait a moment.';
      } else if (error.message.includes('api key') || error.message.includes('401')) {
        userMessage = 'OpenAI API key issue';
      } else if (error.message.includes('safety') || error.message.includes('content_policy')) {
        userMessage = 'Content filter triggered — try rephrasing your prompt';
      } else {
        userMessage = error.message;
      }
    }

    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}

export type { VideoMode };
export { ACTIVE_MODES };