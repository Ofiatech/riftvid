import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const maxDuration = 30;

interface RiftFeedbackRequest {
  basePrompt: string;
  imageDescription?: string;
  questionText: string;
  questionOptions?: string[];
  questionStep?: number;
  totalSteps?: number;
  targetGap?: string;
  reason: string;
  suggestedQuestion?: string;
  riftVersion?: string;
}

const VALID_REASONS = [
  'already_specified',
  'wrong_question',
  'too_many_questions',
  'missing_question',
  'other',
];

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: RiftFeedbackRequest = await req.json();

    if (!body.basePrompt || typeof body.basePrompt !== 'string') {
      return NextResponse.json({ error: 'Base prompt is required' }, { status: 400 });
    }
    if (!body.questionText || typeof body.questionText !== 'string') {
      return NextResponse.json({ error: 'Question text is required' }, { status: 400 });
    }
    if (!body.reason || !VALID_REASONS.includes(body.reason)) {
      return NextResponse.json(
        { error: `Reason must be one of: ${VALID_REASONS.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('rift_feedback')
      .insert({
        user_id: userId,
        base_prompt: body.basePrompt.trim(),
        image_description: body.imageDescription?.trim() || null,
        question_text: body.questionText.trim(),
        question_options: body.questionOptions || null,
        question_step: body.questionStep ?? null,
        total_steps: body.totalSteps ?? null,
        target_gap: body.targetGap?.trim() || null,
        reason: body.reason,
        suggested_question: body.suggestedQuestion?.trim() || null,
        rift_version: body.riftVersion?.trim() || 'v3',
      })
      .select('id, created_at')
      .single();

    if (error) {
      console.error('Rift feedback insert error:', error);
      return NextResponse.json(
        { error: 'Failed to save feedback' },
        { status: 500 }
      );
    }

    console.log('Rift feedback saved:', {
      id: data.id,
      userId,
      reason: body.reason,
      targetGap: body.targetGap,
    });

    return NextResponse.json({
      success: true,
      feedbackId: data.id,
      message: 'Thank you for the feedback! This helps us improve Rift.',
    });
  } catch (error) {
    console.error('=== RIFT FEEDBACK API ERROR ===');
    console.error(error);
    console.error('=== END ERROR ===');

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Server error',
      },
      { status: 500 }
    );
  }
}