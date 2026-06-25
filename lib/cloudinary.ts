// lib/cloudinary.ts
//
// Cloudinary scene merging via URL-based video concatenation.
//
// CONTRACT (matches what app/api/projects/[id]/scenes/[sceneId]/merge/route.ts expects):
//
// ClipForMerge:
//   { clipId: string, videoUrl: string, clipOrder: number }
//
// mergeSceneClips(clips, userId, sceneId, totalDurationSeconds) → {
//   merged_video_url: string,
//   public_id: string,        // base clip's public_id
//   duration: number,         // pass-through from input
//   bytes: number,            // best-effort estimate
// }
//
// deleteSceneSourceClips(userId, sceneId) → void
//
// v4 FIX (Session 11C-1):
// Removed the warmMergeUrl step that was throwing 404s and marking merges
// as failed. Cloudinary URL-based concat is async; the URL serves the
// merged video once Cloudinary finishes processing (30-90s after first
// request). We now trust the URL and let the player surface real errors
// client-side via the video element's onError event.

import { v2 as cloudinary } from 'cloudinary';

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// =============================================================================
// TYPES — match the merge route's existing contract
// =============================================================================
export interface ClipForMerge {
  clipId: string;
  videoUrl: string;
  clipOrder: number;
}

export interface MergeResult {
  merged_video_url: string;
  public_id: string;       // public_id of the base clip (clip 1)
  duration: number;        // total scene duration in seconds
  bytes: number;           // best-effort byte estimate
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Uploads a single clip to Cloudinary, returns its public_id.
 *
 * v5 FIX (4.3.5b regenerate-bug, June 2026):
 * The public_id now includes a per-merge token (passed in by the caller).
 * Previously it was purely positional ("clip-001"), which meant every
 * regenerate-and-remerge produced the IDENTICAL stitched URL. Cloudinary's
 * CDN caches derived/transformed URLs by URL string, so the old stitched
 * video kept being served even after the source bytes were replaced. The
 * `invalidate: true` flag clears the source URL's cache, but Cloudinary's
 * docs confirm it does NOT automatically clear the cache for derived
 * (transformed) URLs that include the source as an overlay, and propagation
 * can take up to an hour anyway.
 *
 * With per-merge tokens, every merge produces a brand-new URL string. The
 * CDN has never seen it, so there's nothing to serve stale. Fresh fetch,
 * fresh bytes, every time.
 *
 * The cleanup step (cleanupExistingSourceClips, in mergeSceneClips) deletes
 * everything under the scene's source-clips/ prefix before each new merge,
 * so old-token files don't accumulate.
 */
async function uploadClipToCloudinary(
  clip: ClipForMerge,
  userId: string,
  sceneId: string,
  index: number,
  mergeToken: string
): Promise<string> {
  const publicId = `riftvid/user_${userId}/scenes/${sceneId}/source-clips/clip-${String(
    index + 1
  ).padStart(3, '0')}-m${mergeToken}`;

  try {
    const result = await cloudinary.uploader.upload(clip.videoUrl, {
      public_id: publicId,
      resource_type: 'video',
      overwrite: true,
      invalidate: true,
      eager_async: true,
    });

    console.log(`  ✓ Uploaded clip ${index + 1} → ${result.public_id}`);
    return result.public_id;
  } catch (err) {
    // Cloudinary upload errors are usually PLAIN OBJECTS, not Error instances
    // (e.g. { message, http_code, name }). The merge route only kept the
    // message when `err instanceof Error`, so every real failure was being
    // swallowed and stored as the useless "Unknown merge error".
    //
    // We convert it here into a proper Error carrying the real reason PLUS
    // which clip and which source URL failed — so merge_error finally tells
    // us the truth (expired URL, 404 fetch, size limit, bad format, etc.).
    const reason = extractCloudinaryError(err);
    const shortUrl =
      clip.videoUrl.length > 90 ? clip.videoUrl.slice(0, 90) + '…' : clip.videoUrl;
    console.error(`  ✗ Clip ${index + 1} upload FAILED:`, reason, '| url:', shortUrl);
    throw new Error(
      `Clip ${index + 1} (order ${clip.clipOrder}) failed to upload to Cloudinary. ` +
        `Source: ${shortUrl} — Reason: ${reason}`
    );
  }
}

/**
 * Normalizes the many shapes a Cloudinary error can take into a readable
 * string. Cloudinary may throw:
 *   - a real Error instance
 *   - { message: string, http_code: number }
 *   - { error: { message: string } }
 *   - a bare string
 */
function extractCloudinaryError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (e.error && typeof e.error === 'object') {
      const inner = e.error as Record<string, unknown>;
      if (typeof inner.message === 'string') return inner.message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unserializable Cloudinary error';
    }
  }
  return 'Unknown Cloudinary error';
}

/**
 * Removes prior source clips for this scene before re-uploading.
 * Prevents stale clips from leaking into a fresh merge.
 * Non-fatal — first merge has nothing to delete.
 */
async function cleanupExistingSourceClips(
  userId: string,
  sceneId: string
): Promise<void> {
  try {
    const prefix = `riftvid/user_${userId}/scenes/${sceneId}/source-clips/`;
    await cloudinary.api.delete_resources_by_prefix(prefix, {
      resource_type: 'video',
    });
    console.log(`Cloudinary cleanup: deleted source clips for scene ${sceneId}`);
  } catch (err) {
    console.log(
      `Cloudinary cleanup: nothing to delete (first merge?)`,
      err instanceof Error ? err.message : ''
    );
  }
}

/**
 * Builds the Cloudinary concat URL.
 *
 * Pattern for N clips:
 *   /video/upload/
 *     l_video:CLIP_2_ID,fl_splice,w_1.0,h_1.0,fl_relative,c_fill
 *     /fl_layer_apply
 *     /l_video:CLIP_3_ID,fl_splice,w_1.0,h_1.0,fl_relative,c_fill
 *     /fl_layer_apply
 *     /v1/CLIP_1_ID.mp4
 *
 * Clip 1 is the base. Clips 2+ are layered onto it in order via fl_splice.
 */
function buildConcatUrl(publicIds: string[]): string {
  if (publicIds.length === 0) {
    throw new Error('Cannot build concat URL with zero clips');
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    throw new Error('CLOUDINARY_CLOUD_NAME is not configured');
  }

  // Cloudinary public_ids use `/` as path separator; in URL transforms
  // (l_video:...), we use `:` instead.
  const cloudinaryIds = publicIds.map((id) => id.replace(/\//g, ':'));

  if (cloudinaryIds.length === 1) {
    // Single clip — no concat needed, just return the base URL
    return `https://res.cloudinary.com/${cloudName}/video/upload/v1/${publicIds[0]}.mp4`;
  }

  const baseClipPath = publicIds[0];
  const spliceLayers = cloudinaryIds
    .slice(1)
    .map((id) => `l_video:${id},fl_splice,w_1.0,h_1.0,fl_relative,c_fill/fl_layer_apply`);

  const transformChain = spliceLayers.join('/');
  return `https://res.cloudinary.com/${cloudName}/video/upload/${transformChain}/v1/${baseClipPath}.mp4`;
}

// =============================================================================
// PUBLIC API — these are what app/api/.../merge/route.ts imports
// =============================================================================

/**
 * Main merge function — uploads clips, builds concat URL, returns result.
 * Trusts Cloudinary to process the URL on first access (no warm check).
 *
 * @param clips - array of clips to merge (ordered by clipOrder)
 * @param userId - Clerk user ID (for path namespacing)
 * @param sceneId - scene UUID (for path namespacing)
 * @param totalDurationSeconds - sum of all clip durations (pass-through)
 */
export async function mergeSceneClips(
  clips: ClipForMerge[],
  userId: string,
  sceneId: string,
  totalDurationSeconds: number
): Promise<MergeResult> {
  if (!clips || clips.length === 0) {
    throw new Error('No clips provided to merge');
  }

  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    throw new Error('Cloudinary is not configured (missing CLOUDINARY_CLOUD_NAME)');
  }

  console.log(`Cloudinary merge: uploading ${clips.length} clips for scene ${sceneId}`);

  // v5 FIX: generate a single per-merge token used for ALL clips in this
  // merge. Each merge gets a fresh token, so the resulting concat URL is
  // guaranteed unique per merge — even if the same clip files were uploaded
  // again with no changes. This sidesteps Cloudinary's CDN derived-URL cache
  // entirely (different URL = no cache to serve). See uploadClipToCloudinary
  // for the full reasoning.
  const mergeToken = Date.now().toString();

  // Step 1: Clean up any prior source clips for this scene
  await cleanupExistingSourceClips(userId, sceneId);

  // Step 2: Sort by clipOrder to guarantee correct sequence, then upload in parallel
  const sortedClips = [...clips].sort((a, b) => a.clipOrder - b.clipOrder);

  const publicIds = await Promise.all(
    sortedClips.map((clip, index) =>
      uploadClipToCloudinary(clip, userId, sceneId, index, mergeToken)
    )
  );

  // Step 3: Build the concat URL
  console.log(`Cloudinary merge: building concat URL for ${publicIds.length} clips`);
  const mergedUrl = buildConcatUrl(publicIds);
  console.log(`Generated URL: ${mergedUrl}`);

  // Step 4: Return without warm check (v4 fix — see file header for rationale)
  console.log(
    `Cloudinary merge: complete, URL ready (Cloudinary will process on first request)`
  );

  // Best-effort byte estimate: ~1 MB per second of video (rough average for
  // Grok Imagine output). Not stored anywhere critical; just informational.
  const estimatedBytes = totalDurationSeconds * 1024 * 1024;

  return {
    merged_video_url: mergedUrl,
    public_id: publicIds[0], // base clip is the public_id of record
    duration: totalDurationSeconds,
    bytes: estimatedBytes,
  };
}

/**
 * Deletes all source clips for a scene from Cloudinary.
 * Called before a re-merge (to prevent stale data) and when a scene is deleted.
 */
export async function deleteSceneSourceClips(
  userId: string,
  sceneId: string
): Promise<void> {
  if (!process.env.CLOUDINARY_CLOUD_NAME) return;

  try {
    const prefix = `riftvid/user_${userId}/scenes/${sceneId}/source-clips/`;
    await cloudinary.api.delete_resources_by_prefix(prefix, {
      resource_type: 'video',
    });
    console.log(`Cloudinary: deleted source clips for scene ${sceneId}`);
  } catch (err) {
    console.error('Cloudinary cleanup error:', err);
  }
}

/**
 * Deletes ALL assets for a scene (source clips + any merged outputs).
 * Use when a scene itself is being deleted from the database.
 */
export async function deleteSceneFromCloudinary(
  userId: string,
  sceneId: string
): Promise<void> {
  if (!process.env.CLOUDINARY_CLOUD_NAME) return;

  try {
    const prefix = `riftvid/user_${userId}/scenes/${sceneId}/`;
    await cloudinary.api.delete_resources_by_prefix(prefix, {
      resource_type: 'video',
    });
    console.log(`Cloudinary: deleted all assets for scene ${sceneId}`);
  } catch (err) {
    console.error('Cloudinary cleanup error:', err);
  }
}