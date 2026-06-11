// app/api/avatars/route.ts
// GET  /api/avatars          — list current user's avatars (newest first)
// POST /api/avatars          — create a new avatar (upload OR pre-uploaded URLs)
//
// CHANGED in 4.3.4b: photoUrls (used by AI generation flow) now get rehosted
// to Supabase storage when they're external URLs (e.g. Fal.ai), since Fal URLs
// expire after ~1 hour. Internal Supabase URLs are stored as-is.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getOrCreateProfile } from '@/lib/credits';
import {
  AvatarRecord,
  AvatarCreateInput,
  getAvatarLimitForTier,
  isAvatarLimitUnlimited,
  validateAvatarInput,
  parseBase64Image,
  buildAvatarPhotoPath,
  getAvatarsSupabaseClient,
  SubscriptionTier,
} from '@/lib/avatars';

export const maxDuration = 60;

// ============================================================================
// HELPERS — external URL rehosting
// ============================================================================

/**
 * Check if a URL is already hosted on our Supabase project.
 * If yes, we don't need to rehost it.
 */
function isInternalSupabaseUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;
  return url.startsWith(supabaseUrl);
}

/**
 * Map a MIME type to a file extension.
 */
function mimeToExt(mime: string): string {
  const normalized = mime.toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  return 'jpg'; // safe default
}

/**
 * Download an external image and upload it to our Supabase storage.
 * Returns the public Supabase URL for the rehosted image.
 */
async function rehostExternalImage(
  supabase: ReturnType<typeof getAvatarsSupabaseClient>,
  externalUrl: string,
  userId: string,
  avatarId: string,
  photoIndex: number
): Promise<string> {
  // Fetch the image
  const res = await fetch(externalUrl);
  if (!res.ok) {
    throw new Error(`Failed to download image from ${externalUrl} (status ${res.status})`);
  }

  // Determine MIME type — prefer Content-Type header, fall back to URL extension
  const contentType = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  const supportedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  let mimeType = supportedMimes.includes(contentType) ? contentType : '';

  // If header didn't give us a usable MIME, try the URL extension
  if (!mimeType) {
    const urlExt = externalUrl.split('?')[0].split('.').pop()?.toLowerCase() || '';
    if (urlExt === 'jpg' || urlExt === 'jpeg') mimeType = 'image/jpeg';
    else if (urlExt === 'png') mimeType = 'image/png';
    else if (urlExt === 'webp') mimeType = 'image/webp';
    else mimeType = 'image/jpeg'; // safe default
  }

  const ext = mimeToExt(mimeType);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const path = buildAvatarPhotoPath(userId, avatarId, photoIndex, ext);

  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
  });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  return pub.publicUrl;
}

// ============================================================================
// GET /api/avatars — list user's avatars
// ============================================================================
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getAvatarsSupabaseClient();

    const { data, error } = await supabase
      .from('avatars')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Avatars list error:', error);
      return NextResponse.json({ error: 'Failed to fetch avatars' }, { status: 500 });
    }

    const profile = await getOrCreateProfile(userId);
    const tier = (profile?.subscription_tier ?? 'free') as SubscriptionTier;
    const limit = getAvatarLimitForTier(tier);
    const count = (data ?? []).length;

    return NextResponse.json({
      avatars: (data ?? []) as AvatarRecord[],
      meta: {
        count,
        limit,
        unlimited: isAvatarLimitUnlimited(tier),
        tier,
        at_limit: !isAvatarLimitUnlimited(tier) && count >= limit,
      },
    });
  } catch (err) {
    console.error('GET /api/avatars error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// POST /api/avatars — create a new avatar
// ============================================================================
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let input: AvatarCreateInput;
    try {
      input = (await req.json()) as AvatarCreateInput;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const errors = validateAvatarInput(input);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Validation failed', details: errors },
        { status: 400 }
      );
    }

    const supabase = getAvatarsSupabaseClient();

    // Tier limit check
    const profile = await getOrCreateProfile(userId);
    const tier = (profile?.subscription_tier ?? 'free') as SubscriptionTier;
    const limit = getAvatarLimitForTier(tier);

    if (!isAvatarLimitUnlimited(tier)) {
      const { count, error: countError } = await supabase
        .from('avatars')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (countError) {
        console.error('Avatar count error:', countError);
        return NextResponse.json(
          { error: 'Failed to check avatar limit' },
          { status: 500 }
        );
      }

      if ((count ?? 0) >= limit) {
        return NextResponse.json(
          {
            error: 'avatar_limit_reached',
            message: `You've reached your ${tier} tier limit of ${limit} avatars. Upgrade for more.`,
            limit,
            current_count: count,
            tier,
          },
          { status: 403 }
        );
      }
    }

    // Insert avatar row FIRST so we have an ID to scope storage paths.
    const { data: createdRows, error: insertError } = await supabase
      .from('avatars')
      .insert({
        user_id: userId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        age_range: input.age_range ?? null,
        gender: input.gender ?? null,
        source: input.source ?? 'upload',
        photo_urls: [],
      })
      .select('*')
      .single();

    if (insertError || !createdRows) {
      console.error('Avatar insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to create avatar record' },
        { status: 500 }
      );
    }

    const avatar = createdRows as AvatarRecord;
    const finalPhotoUrls: { url: string; order: number }[] = [];

    try {
      // (A) base64 uploads
      if (input.photosBase64 && input.photosBase64.length > 0) {
        for (let i = 0; i < input.photosBase64.length; i++) {
          const { buffer, ext, mimeType } = parseBase64Image(input.photosBase64[i]);
          const path = buildAvatarPhotoPath(userId, avatar.id, i, ext);

          const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(path, buffer, {
              contentType: mimeType,
              upsert: true,
            });

          if (uploadError) {
            throw new Error(`Photo ${i + 1} upload failed: ${uploadError.message}`);
          }

          const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
          finalPhotoUrls.push({ url: pub.publicUrl, order: i });
        }
      }

      // (B) URL-based (used by AI generation flow — rehost external URLs to our storage)
      if (input.photoUrls && input.photoUrls.length > 0) {
        const startOrder = finalPhotoUrls.length;
        for (let i = 0; i < input.photoUrls.length; i++) {
          const url = input.photoUrls[i];
          const photoIndex = startOrder + i;

          if (isInternalSupabaseUrl(url)) {
            // Already on our storage — store as-is
            finalPhotoUrls.push({ url, order: photoIndex });
          } else {
            // External (Fal, etc.) — download and rehost
            const rehostedUrl = await rehostExternalImage(
              supabase,
              url,
              userId,
              avatar.id,
              photoIndex
            );
            finalPhotoUrls.push({ url: rehostedUrl, order: photoIndex });
          }
        }
      }
    } catch (uploadErr) {
      // Roll back: delete the avatar row + any uploaded photos
      console.error('Photo upload error, rolling back:', uploadErr);
      try {
        const { data: files } = await supabase.storage
          .from('avatars')
          .list(`${userId}/${avatar.id}`, { limit: 100 });
        if (files && files.length > 0) {
          const paths = files.map((f) => `${userId}/${avatar.id}/${f.name}`);
          await supabase.storage.from('avatars').remove(paths);
        }
      } catch {
        // best-effort
      }
      await supabase.from('avatars').delete().eq('id', avatar.id);

      return NextResponse.json(
        {
          error: 'photo_upload_failed',
          message:
            uploadErr instanceof Error
              ? uploadErr.message
              : 'One or more photos failed to upload',
        },
        { status: 500 }
      );
    }

    // Patch the avatar with the photo URLs
    const { data: updated, error: updateError } = await supabase
      .from('avatars')
      .update({ photo_urls: finalPhotoUrls })
      .eq('id', avatar.id)
      .select('*')
      .single();

    if (updateError || !updated) {
      console.error('Avatar update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to attach photos to avatar' },
        { status: 500 }
      );
    }

    return NextResponse.json({ avatar: updated as AvatarRecord }, { status: 201 });
  } catch (err) {
    console.error('POST /api/avatars error:', err);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}