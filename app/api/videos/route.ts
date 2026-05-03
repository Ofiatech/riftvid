import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { CreateVideoRequest, generateTitleFromPrompt } from '@/lib/types';

export const maxDuration = 30;

// Helper: upload base64 image to Supabase Storage
async function uploadBase64Image(
  base64DataUrl: string,
  userId: string,
  videoId: string
): Promise<string> {
  const supabase = getSupabaseAdmin();

  // Parse data URL: "data:image/png;base64,xxxxx..."
  const match = base64DataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid base64 image format');

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');

  const fileName = `${userId}/${videoId}.${ext}`;

  const { error } = await supabase.storage
    .from('source-images')
    .upload(fileName, buffer, {
      contentType: `image/${match[1]}`,
      upsert: true,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('source-images')
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}

// POST /api/videos — create a new video record (called when user clicks Generate)
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: CreateVideoRequest = await req.json();
    const {
      basePrompt,
      refinedPrompt,
      riftUsed,
      riftAnswers,
      sceneType,
      sceneDescription,
      duration,
      sourceImageBase64,
      sourceImageUrl,
    } = body;

    // Validation
    if (!refinedPrompt || refinedPrompt.trim().length === 0) {
      return NextResponse.json({ error: 'Refined prompt is required' }, { status: 400 });
    }
    if (duration !== 5 && duration !== 10) {
      return NextResponse.json({ error: 'Duration must be 5 or 10' }, { status: 400 });
    }
    if (!sourceImageBase64 && !sourceImageUrl) {
      return NextResponse.json({ error: 'Source image is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Step 1: Insert video record (status: queued, no URLs yet)
    const { data: video, error: insertError } = await supabase
      .from('videos')
      .insert({
        user_id: userId,
        base_prompt: basePrompt || null,
        refined_prompt: refinedPrompt.trim(),
        rift_used: riftUsed,
        rift_answers: riftAnswers || null,
        scene_type: sceneType || null,
        scene_description: sceneDescription || null,
        duration,
        source_image_url: 'pending', // placeholder until upload completes
        status: 'queued',
        title: generateTitleFromPrompt(refinedPrompt),
      })
      .select()
      .single();

    if (insertError || !video) {
      console.error('Insert error:', insertError);
      return NextResponse.json(
        { error: insertError?.message || 'Failed to create video record' },
        { status: 500 }
      );
    }

    // Step 2: Upload source image to Storage (or use external URL)
    let finalSourceImageUrl: string;
    try {
      if (sourceImageBase64) {
        finalSourceImageUrl = await uploadBase64Image(sourceImageBase64, userId, video.id);
      } else {
        finalSourceImageUrl = sourceImageUrl!;
      }
    } catch (uploadError) {
      // If upload fails, mark video as failed and clean up
      await supabase
        .from('videos')
        .update({
          status: 'failed',
          error_message: uploadError instanceof Error ? uploadError.message : 'Upload failed',
        })
        .eq('id', video.id);

      return NextResponse.json(
        { error: uploadError instanceof Error ? uploadError.message : 'Image upload failed' },
        { status: 500 }
      );
    }

    // Step 3: Update record with image URL
    const { data: updated, error: updateError } = await supabase
      .from('videos')
      .update({ source_image_url: finalSourceImageUrl })
      .eq('id', video.id)
      .select()
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message || 'Failed to update record' },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Create video error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}

// GET /api/videos — list current user's videos (newest first)
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ videos: data || [] });
  } catch (error) {
    console.error('List videos error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}