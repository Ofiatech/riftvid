// lib/avatars.ts
// Server-side helpers for the Avatars feature (Phase 4.3).
// Includes: types, tier-based limits, validation, storage path helpers.

import { createClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES (mirror the avatars table)
// ============================================================================

export type AvatarSource = 'upload' | 'ai_generated';
export type AvatarAgeRange = 'child' | 'teen' | 'young_adult' | 'adult' | 'senior';
export type AvatarGender = 'female' | 'male' | 'non_binary' | 'other';

export interface AvatarPhoto {
  url: string;
  order: number;
}

export interface AvatarRecord {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  photo_urls: AvatarPhoto[];
  age_range: AvatarAgeRange | null;
  gender: AvatarGender | null;
  voice_id: string | null;
  source: AvatarSource;
  ai_generation_count: number;
  created_at: string;
  updated_at: string;
}

// Subscription tier — must match what's in lib/credits.ts
export type SubscriptionTier = 'free' | 'creator' | 'pro' | 'studio' | 'team';

// ============================================================================
// TIER LIMITS — locked per ROADMAP 4.3 decision
// ============================================================================

/**
 * Maximum number of avatars per tier.
 * Returns -1 for unlimited.
 *
 * NOTE: 'team' is a legacy alias for 'studio' — both treated as unlimited.
 */
export function getAvatarLimitForTier(tier: SubscriptionTier): number {
  switch (tier) {
    case 'free':    return 3;
    case 'creator': return 25;
    case 'pro':     return 100;
    case 'studio':  return -1; // unlimited
    case 'team':    return -1; // legacy alias for studio
    default:        return 3;  // safe default = free tier
  }
}

export function isAvatarLimitUnlimited(tier: SubscriptionTier): boolean {
  return getAvatarLimitForTier(tier) === -1;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const AVATAR_MAX_PHOTOS = 5;
export const AVATAR_MIN_PHOTOS = 1;
export const AVATAR_MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3 MB per photo
export const AVATAR_ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

export const AVATAR_NAME_MIN = 1;
export const AVATAR_NAME_MAX = 60;
export const AVATAR_DESCRIPTION_MAX = 500;

export const AI_GENERATION_FREE_LIMIT = 3; // first 3 attempts free; 4th+ = 1 credit each

// ============================================================================
// VALIDATION
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
}

export interface AvatarCreateInput {
  name: string;
  description?: string | null;
  age_range?: AvatarAgeRange | null;
  gender?: AvatarGender | null;
  // Photos can come as base64 (data URLs) — uploaded server-side to storage
  photosBase64?: string[];
  // OR as already-uploaded URLs (used for AI-generated path in 4.3.4)
  photoUrls?: string[];
  source?: AvatarSource;
}

export function validateAvatarInput(input: AvatarCreateInput): ValidationError[] {
  const errors: ValidationError[] = [];

  // Name: required, length
  if (!input.name || typeof input.name !== 'string') {
    errors.push({ field: 'name', message: 'Name is required' });
  } else {
    const trimmed = input.name.trim();
    if (trimmed.length < AVATAR_NAME_MIN) {
      errors.push({ field: 'name', message: 'Name cannot be empty' });
    }
    if (trimmed.length > AVATAR_NAME_MAX) {
      errors.push({ field: 'name', message: `Name must be ${AVATAR_NAME_MAX} characters or fewer` });
    }
  }

  // Description: optional, length
  if (input.description != null) {
    if (typeof input.description !== 'string') {
      errors.push({ field: 'description', message: 'Description must be a string' });
    } else if (input.description.length > AVATAR_DESCRIPTION_MAX) {
      errors.push({
        field: 'description',
        message: `Description must be ${AVATAR_DESCRIPTION_MAX} characters or fewer`,
      });
    }
  }

  // Photos: must have at least 1, at most 5
  const photoCount =
    (input.photosBase64?.length ?? 0) + (input.photoUrls?.length ?? 0);

  if (photoCount < AVATAR_MIN_PHOTOS) {
    errors.push({ field: 'photos', message: 'At least 1 photo is required' });
  }
  if (photoCount > AVATAR_MAX_PHOTOS) {
    errors.push({
      field: 'photos',
      message: `Maximum ${AVATAR_MAX_PHOTOS} photos per avatar`,
    });
  }

  // Tag validation
  if (input.age_range != null) {
    const valid: AvatarAgeRange[] = ['child', 'teen', 'young_adult', 'adult', 'senior'];
    if (!valid.includes(input.age_range)) {
      errors.push({ field: 'age_range', message: 'Invalid age range' });
    }
  }
  if (input.gender != null) {
    const valid: AvatarGender[] = ['female', 'male', 'non_binary', 'other'];
    if (!valid.includes(input.gender)) {
      errors.push({ field: 'gender', message: 'Invalid gender value' });
    }
  }

  return errors;
}

// ============================================================================
// BASE64 + STORAGE HELPERS
// ============================================================================

/**
 * Parse a base64 data URL and return its MIME type + raw byte length + buffer.
 * Throws if the data URL is malformed or the MIME type isn't allowed.
 */
export function parseBase64Image(dataUrl: string): {
  mimeType: string;
  ext: string;
  buffer: Buffer;
  byteSize: number;
} {
  const match = dataUrl.match(/^data:([\w/+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid image data URL');
  }
  const mimeType = match[1].toLowerCase();
  if (!AVATAR_ALLOWED_MIME.includes(mimeType)) {
    throw new Error(`Unsupported image type: ${mimeType}. Allowed: PNG, JPEG, WebP.`);
  }
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > AVATAR_MAX_PHOTO_BYTES) {
    throw new Error(
      `Photo exceeds ${Math.round(AVATAR_MAX_PHOTO_BYTES / 1024 / 1024)}MB limit`
    );
  }

  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];

  return { mimeType, ext, buffer, byteSize: buffer.length };
}

/**
 * Build the canonical storage path for an avatar photo.
 * Pattern: {user_id}/{avatar_id}/{index}.{ext}
 */
export function buildAvatarPhotoPath(
  userId: string,
  avatarId: string,
  index: number,
  ext: string
): string {
  return `${userId}/${avatarId}/${index}.${ext}`;
}

// ============================================================================
// SUPABASE SERVICE-ROLE CLIENT
// (lives here so Avatars routes don't all re-implement this)
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export function getAvatarsSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase credentials not configured');
  }
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}