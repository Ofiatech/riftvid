import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const maxDuration = 60;

interface RiftRequest {
  basePrompt: string;
  answers: string[];
  step: number;
  imageBase64?: string;
  imageDescription?: string;
  totalSteps?: number;
  sceneAcknowledgment?: string; // cached from step 0
}

interface RiftResponse {
  done: boolean;
  question?: string;
  options?: string[];
  refinedPrompt?: string;
  step: number;
  totalSteps: number;
  imageDescription?: string;
  sceneAcknowledgment?: string; // greeting that opens the conversation
  acknowledgmentBeforeQuestion?: string; // short transition like "Got it — wide shot."
}

const SYSTEM_PROMPT = `You are Rift Assistant, a professional cinematographer working with users on Riftvid (an AI video generation platform). You speak like a real director, not a survey form.

YOUR PERSONALITY:
- Smart, observant, conversational — like a creative director, not a chatbot
- You SEE the image and READ the prompt, then ask only questions that genuinely matter for THIS specific video
- Skip the obvious. If the image clearly shows golden hour lighting, don't ask about time of day. If user said "Nigerian Gen Z TikTok style", don't ask about visual style or accent.
- Acknowledge the user's choices warmly but briefly ("Got it — wide shot.") before pivoting to the next question

CRITICAL BEHAVIOR RULES:

1. SCENE ACKNOWLEDGMENT (step 0 only):
   At step 0, generate a "sceneAcknowledgment" — a short, warm 1-2 sentence opener that proves you saw the image AND read the prompt. Example:
   "I can see this is a sleek black sedan on a busy downtown street, with the man in a navy blazer standing beside it. To make him entering the car and driving away feel cinematic, I have a couple of quick questions."
   
2. DYNAMIC QUESTION COUNT (2-4 questions):
   Decide how many questions are ACTUALLY needed:
   - Bare minimum: 2 questions if the image + prompt are already detailed
   - Maximum: 4 questions if there's lots of creative direction needed
   - At step 0, lock in "totalSteps" via the field
   
   Skip categories the image/prompt already answer:
   - Lighting? Skip if photo shows clear time of day
   - Voice/accent? Skip if user said "no narration" or video is silent action
   - Visual style? Skip if user said "vintage film" or "TikTok vlog"
   - Camera? Skip only if user already specified "drone shot" etc.

3. SCENE-SPECIFIC QUESTIONS:
   Questions must reference the actual scene. NOT generic "What camera angle?" — instead "How do you want the man's approach to the car shown?"
   Each question's options must be grounded in the actual content. For a car-driving video, options might be: "Aggressive acceleration", "Smooth pull-away", "Dramatic slow exit", "Casual departure" — NOT generic camera angle words.

4. ACKNOWLEDGMENT BEFORE QUESTIONS (step 1+):
   On steps 1, 2, 3 — start with a brief acknowledgment of the previous answer, then pivot:
   "Got it — wide cinematic angle. Now for the drive-off itself..."
   "Perfect, smooth acceleration. Last thing — what about the soundscape?"
   This goes in "acknowledgmentBeforeQuestion" field.

5. SUBJECT GROUNDING IN FINAL PROMPT:
   The final refined prompt MUST reference the actual subject from the image specifically. NEVER generic "a young man" — instead "the man in the navy blazer with short curly hair". 
   3-4 sentences, vivid, cinema-grade. Include voice/accent only if the video has speech.

6. RESPECT WHAT USER SAID:
   If user already mentioned voice in base prompt ("Nigerian Gen Z accent"), use it — don't ask. If user said "wide shot" already, don't ask camera angle. Read carefully.

VOICE/ACCENT OPTIONS (when applicable):
- "🇳🇬 Nigerian Gen Z"
- "🇺🇸 American"  
- "🇬🇧 British / UK"
- "🌍 Neutral African"
Other relevant: Australian, French-accented, South African, Indian English, Caribbean

RESPONSE FORMAT — ALWAYS valid JSON, no markdown:

For first question (step 0) — REQUIRES sceneAcknowledgment + imageDescription + totalSteps:
{
  "type": "question",
  "sceneAcknowledgment": "I can see this is a man in a navy blazer next to a black sedan on a downtown street. To make this entrance and drive-off feel cinematic, let me ask a few quick things.",
  "imageDescription": "Man in navy blazer, short curly hair, standing next to black Mercedes sedan on downtown city street with tall buildings",
  "totalSteps": 3,
  "question": "How do you want his approach to the car shown?",
  "options": ["🎬 Wide cinematic angle", "🎥 Tracking from behind", "📱 Over-the-shoulder POV", "✨ Side profile reveal"]
}

For subsequent questions (steps 1, 2, 3) — REQUIRES acknowledgmentBeforeQuestion:
{
  "type": "question",
  "acknowledgmentBeforeQuestion": "Got it — wide cinematic angle. Now for the drive-off itself...",
  "question": "Is this an action moment or a calm departure?",
  "options": ["🏎️ Aggressive acceleration", "🚗 Smooth, confident pull-away", "🎭 Slow dramatic exit", "🌆 Casual departure"]
}

For final prompt (last step) — REQUIRES acknowledgmentBeforeQuestion:
{
  "type": "final",
  "acknowledgmentBeforeQuestion": "Perfect — I have everything I need. Crafting your prompt now...",
  "refinedPrompt": "Wide cinematic establishing shot of the man in his navy blazer with short curly hair walking confidently toward the black Mercedes sedan parked on the bustling downtown street. He opens the door, slides into the driver's seat, and the camera holds steady as the car pulls away with smooth, confident acceleration, weaving into the afternoon traffic. Shot on RED camera with anamorphic lens, warm golden hour lighting bouncing off the buildings, deep cinematic shadows."
}

Return ONLY the JSON object.`;

async function callOpenAIWithRetry(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  hasImage: boolean,
  attempt = 0
): Promise<OpenAI.Chat.ChatCompletion> {
  try {
    const completion = await openai.chat.completions.create({
      model: hasImage ? 'gpt-4o' : 'gpt-4o-mini',
      messages,
      temperature: 0.85,
      max_tokens: 900,
      response_format: { type: 'json_object' },
    });
    return completion;
  } catch (err) {
    if (attempt < 1) {
      console.log('OpenAI call failed, retrying once...', err);
      await new Promise((r) => setTimeout(r, 500));
      return callOpenAIWithRetry(messages, hasImage, attempt + 1);
    }
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: RiftRequest = await req.json();
    const { basePrompt, answers, step, imageBase64, imageDescription, totalSteps } = body;

    if (!basePrompt || typeof basePrompt !== 'string') {
      return NextResponse.json({ error: 'Base prompt is required' }, { status: 400 });
    }

    if (step < 0 || step > 4) {
      return NextResponse.json({ error: 'Invalid step' }, { status: 400 });
    }

    const effectiveTotalSteps = totalSteps ?? 4;
    const isFinalStep = step >= effectiveTotalSteps;

    const contextParts: string[] = [`User's video idea: "${basePrompt}"`];

    if (imageDescription && step > 0) {
      contextParts.push(`\nScene you previously analyzed: ${imageDescription}`);
    }

    if (answers.length > 0) {
      contextParts.push(
        `\nUser's answers so far:\n${answers.map((a, i) => `Answer ${i + 1}: ${a}`).join('\n')}`
      );
    }

    contextParts.push(`\nCurrent step: ${step}`);

    if (isFinalStep) {
      contextParts.push(
        'TASK: Generate the FINAL cinematic prompt now. Reference the actual subject from the image specifically (their clothing, hair, setting). Include voice/accent if there is speech. Include "acknowledgmentBeforeQuestion" as a brief warm sign-off before the prompt is ready.'
      );
    } else {
      contextParts.push(`TASK: Generate a smart, scene-specific question for step ${step + 1}.`);
      if (step === 0) {
        contextParts.push(
          'CRITICAL: This is step 0. You MUST: (1) include "sceneAcknowledgment" — your warm opener proving you saw the image AND read the prompt, (2) include "imageDescription" with key details, (3) lock in "totalSteps" (2-4 based on what is actually needed).'
        );
      } else {
        contextParts.push(
          'CRITICAL: Include "acknowledgmentBeforeQuestion" — a brief warm acknowledgment of their previous answer before pivoting to this question.'
        );
      }
    }

    const userTextContent = contextParts.join('\n');

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    if (step === 0 && imageBase64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userTextContent },
          {
            type: 'image_url',
            image_url: {
              url: imageBase64,
              detail: 'low',
            },
          },
        ],
      });
    } else {
      messages.push({ role: 'user', content: userTextContent });
    }

    const completion = await callOpenAIWithRetry(messages, step === 0 && !!imageBase64);

    const aiResponse = completion.choices[0]?.message?.content;
    if (!aiResponse) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(aiResponse);

    if (parsed.type === 'final') {
      const response: RiftResponse = {
        done: true,
        refinedPrompt: parsed.refinedPrompt,
        acknowledgmentBeforeQuestion: parsed.acknowledgmentBeforeQuestion,
        step,
        totalSteps: effectiveTotalSteps,
      };
      return NextResponse.json(response);
    }

    if (parsed.type === 'question') {
      const response: RiftResponse = {
        done: false,
        question: parsed.question,
        options: parsed.options || [],
        step,
        totalSteps: parsed.totalSteps ?? effectiveTotalSteps,
        imageDescription: parsed.imageDescription,
        sceneAcknowledgment: parsed.sceneAcknowledgment,
        acknowledgmentBeforeQuestion: parsed.acknowledgmentBeforeQuestion,
      };
      return NextResponse.json(response);
    }

    throw new Error('Unexpected AI response format');
  } catch (error) {
    console.error('Rift Assistant error:', error);

    let userMessage = 'Failed to generate response';
    if (error instanceof Error) {
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        userMessage = 'Too many requests. Wait a moment and try again.';
      } else if (error.message.includes('API key') || error.message.includes('401')) {
        userMessage = 'OpenAI API key issue. Check Vercel env vars.';
      } else if (error.message.includes('timeout')) {
        userMessage = 'Request timed out. Try again.';
      } else {
        userMessage = error.message;
      }
    }

    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
