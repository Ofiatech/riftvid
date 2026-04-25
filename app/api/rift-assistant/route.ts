import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface RiftRequest {
  basePrompt: string;
  answers: string[];
  step: number;
}

interface RiftResponse {
  done: boolean;
  question?: string;
  options?: string[];
  refinedPrompt?: string;
  step: number;
  totalSteps: number;
}

const SYSTEM_PROMPT = `You are Rift Assistant, a cinematic AI video prompt expert for Riftvid (an AI video generation platform).

Your job: Help users transform basic video ideas into cinematic, detailed prompts by asking 4 short clarifying questions with quick-tap options.

CRITICAL RULES:
1. Ask EXACTLY 4 questions total — no more, no less
2. Each question must have 4 short, distinct options (2-4 words each, ideally with an emoji)
3. The 4 questions MUST cover IN ORDER:
   - Question 1: Lighting / time of day / mood
   - Question 2: Camera angle / composition / movement
   - Question 3: Visual style / aesthetic
   - Question 4: VOICE & ACCENT — what voice/accent should the video have? Always include diverse options like Nigerian Gen Z, American, British/UK, neutral African, plus other relevant accents based on the user's video idea. If the video clearly has NO voice/dialogue/narration (e.g. abstract motion, silent landscape), ask about audio mood instead (cinematic score, ambient sound, etc.)
4. Keep questions ultra-short (under 10 words)
5. After question 4 is answered, generate a final cinematic prompt that combines the user's idea with their answers. Include voice/accent in the prompt.
6. The final prompt should be 3-4 sentences, vivid, professional, cinema-grade

VOICE/ACCENT EXAMPLES (always include these or similar):
- "🇳🇬 Nigerian Gen Z"
- "🇺🇸 American"
- "🇬🇧 British / UK"
- "🌍 Neutral African"
Other relevant: Australian, French-accented English, South African, Indian English, Caribbean, etc. — pick 4 that fit the video's vibe.

RESPONSE FORMAT — ALWAYS return valid JSON:

For questions (steps 0, 1, 2, 3):
{
  "type": "question",
  "question": "What time of day?",
  "options": ["🌅 Sunset", "🌙 Night", "☀️ Bright day", "✨ Golden hour"]
}

For final prompt (step 4):
{
  "type": "final",
  "refinedPrompt": "Aerial drone shot of a sleek black sports car gliding through golden-lit downtown streets at sunset, warm lens flares dancing across the windshield, cinematic 24fps motion blur, shot on RED camera with anamorphic lens. Hollywood action movie aesthetic with deep shadows and amber highlights. Voiceover narration in confident Nigerian Gen Z tone with energetic pacing."
}

Return ONLY the JSON object, no markdown, no extra text.`;

export async function POST(req: NextRequest) {
  try {
    const body: RiftRequest = await req.json();
    const { basePrompt, answers, step } = body;

    if (!basePrompt || typeof basePrompt !== 'string') {
      return NextResponse.json(
        { error: 'Base prompt is required' },
        { status: 400 }
      );
    }

    if (step < 0 || step > 4) {
      return NextResponse.json(
        { error: 'Invalid step' },
        { status: 400 }
      );
    }

    const userContext = `
User's video idea: "${basePrompt}"

${answers.length > 0 ? `Answers so far:\n${answers.map((a, i) => `Q${i + 1}: ${a}`).join('\n')}` : 'No answers yet — this is the first question.'}

Current step: ${step} of 4
${step === 4 ? 'Generate the FINAL cinematic prompt now. Include the voice/accent in the prompt.' : `Generate question ${step + 1} of 4.`}
${step === 3 ? 'This is the VOICE & ACCENT question — make sure to include diverse accent options.' : ''}
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContext },
      ],
      temperature: 0.8,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const aiResponse = completion.choices[0]?.message?.content;
    if (!aiResponse) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(aiResponse);

    if (parsed.type === 'final' && step === 4) {
      const response: RiftResponse = {
        done: true,
        refinedPrompt: parsed.refinedPrompt,
        step: 4,
        totalSteps: 4,
      };
      return NextResponse.json(response);
    }

    if (parsed.type === 'question' && step < 4) {
      const response: RiftResponse = {
        done: false,
        question: parsed.question,
        options: parsed.options || [],
        step,
        totalSteps: 4,
      };
      return NextResponse.json(response);
    }

    throw new Error('Unexpected AI response format');
  } catch (error) {
    console.error('Rift Assistant error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate response',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
