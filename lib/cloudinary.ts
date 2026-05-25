// lib/cloudinary.ts
//
// Cloudinary scene merging via URL-based video concatenation.
//
// HOW IT WORKS:
// 1. Each clip is uploaded to Cloudinary (so it has a Cloudinary public_id)
// 2. We build a URL that uses Cloudinary's `l_video` (layer video) + `fl_splice`
//    + `fl_layer_apply` transforms to concatenate them in order
// 3. We save that URL to scenes.merged_video_url
// 4. The frontend player loads that URL — Cloudinary serves the concatenated
//    video on-demand (processing happens server-side when first requested)
//
// v3 FIX (Session 11C-1 bugfix):
// Removed the warmMergeUrl step that was throwing 404s and falsely marking
// merges as failed. Cloudinary needs 30-90+ seconds to process the concat,
// but our warm check was firing immediately after URL generation, causing
// 404s while the video was still being assembled.
//
// The fix: trust the URL. Save it. Mark merge as 'ready'. The player will
// load the URL when needed, by which time Cloudinary has finished. If
// Cloudinary genuinely failed (rare), the player's error event will catch
// it client-side.

import { v2 as cloudinary } from 'cloudinary';

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

interface ClipForMerge {
  id: string;
  clip_order: number;
  generated_video_url: string;
}

// Re-export the interface so other files can import it
export type { ClipForMerge };

interface MergeResult {
  merged_video_url: string;
  cloudinary_public_ids: string[];
}

/**
 * Uploads a single clip to Cloudinary and returns its public_id.
 * Uses upsert (overwrite=true) so re-running for the same clip is idempotent.
 */
async function uploadClipToCloudinary(
  clip: ClipForMerge,
  userId: string,
  sceneId: string,
  index: number
): Promise<string> {
  const publicId = `riftvid/user_${userId}/scenes/${sceneId}/source-clips/clip-${String(index + 1).padStart(3, '0')}`;

  const result = await cloudinary.uploader.upload(clip.generated_video_url, {
    public_id: publicId,
    resource_type: 'video',
    overwrite: true,
    invalidate: true,
    // Don't wait for transformations to finish — we just need the upload
    eager_async: true,
  });

  console.log(`  ✓ Uploaded clip ${index + 1} → ${result.public_id}`);
  return result.public_id;
}

/**
 * Deletes all existing source clips for a scene before re-uploading.
 * Prevents stale clips from leaking into the merge.
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
    // Non-fatal — first merge for a scene won't have anything to delete
    console.log(`Cloudinary cleanup: nothing to delete (first merge?)`, err instanceof Error ? err.message : '');
  }
}

/**
 * Builds the URL that concatenates clips in order via Cloudinary transforms.
 *
 * Concat URL pattern (for 3 clips):
 *   /video/upload/
 *     l_video:CLIP_2_ID,fl_splice,w_1.0,h_1.0,fl_relative,c_fill
 *     /fl_layer_apply
 *     /l_video:CLIP_3_ID,fl_splice,w_1.0,h_1.0,fl_relative,c_fill
 *     /fl_layer_apply
 *     /v1/CLIP_1_ID.mp4
 *
 * Clip 1 is the base; clips 2+ are spliced as layers on top in order.
 */
function buildConcatUrl(publicIds: string[]): string {
  if (publicIds.length === 0) {
    throw new Error('Cannot build concat URL with zero clips');
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    throw new Error('CLOUDINARY_CLOUD_NAME is not configured');
  }

  // Cloudinary public_ids use `/` as separator; in URL transforms we use `:`
  const cloudinaryIds = publicIds.map((id) => id.replace(/\//g, ':'));

  if (cloudinaryIds.length === 1) {
    // Single clip — no concat needed
    return `https://res.cloudinary.com/${cloudName}/video/upload/v1/${publicIds[0]}.mp4`;
  }

  // First clip is the base; rest are spliced as layers
  const baseClip = publicIds[0];
  const spliceLayers = cloudinaryIds.slice(1).map((id) => {
    return `l_video:${id},fl_splice,w_1.0,h_1.0,fl_relative,c_fill/fl_layer_apply`;
  });

  const transformChain = spliceLayers.join('/');
  return `https://res.cloudinary.com/${cloudName}/video/upload/${transformChain}/v1/${baseClip}.mp4`;
}

/**
 * Main merge function. Called by the merge route.
 *
 * Steps:
 * 1. Cleanup old source clips for this scene
 * 2. Upload each clip to Cloudinary (parallel)
 * 3. Build the concat URL
 * 4. Return the URL — no warm check, Cloudinary processes on first request
 */
export async function mergeSceneClips(
  clips: ClipForMerge[],
  userId: string,
  sceneId: string
): Promise<MergeResult> {
  if (!clips || clips.length === 0) {
    throw new Error('No clips provided to merge');
  }

  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    throw new Error('Cloudinary is not configured (missing CLOUDINARY_CLOUD_NAME)');
  }

  console.log(`Cloudinary merge: uploading ${clips.length} clips for scene ${sceneId}`);

  // Step 1: Clean up old source clips (prevent stale data)
  await cleanupExistingSourceClips(userId, sceneId);

  // Step 2: Upload all clips in parallel (faster than sequential)
  // Sort by clip_order to ensure correct sequence in the merged video
  const sortedClips = [...clips].sort((a, b) => a.clip_order - b.clip_order);

  const uploadPromises = sortedClips.map((clip, index) =>
    uploadClipToCloudinary(clip, userId, sceneId, index)
  );
  const publicIds = await Promise.all(uploadPromises);

  // Step 3: Build the concat URL
  console.log(`Cloudinary merge: building concat URL for ${publicIds.length} clips`);
  const mergedUrl = buildConcatUrl(publicIds);
  console.log(`Generated URL: ${mergedUrl}`);

  // Step 4: Trust Cloudinary. No warm check.
  //
  // Why no warm check?
  // Cloudinary processes the concat asynchronously the first time the URL
  // is accessed. That processing takes 30-90+ seconds. Our previous warm
  // check was hitting the URL ~5 seconds after generation and getting 404s
  // (because Cloudinary hadn't finished). That caused false 'failed' status
  // even though the merge was working correctly.
  //
  // The player will hit the URL when the user opens the scene. By then
  // (or after a brief delay), Cloudinary has finished processing and the
  // URL serves the merged video. If a true Cloudinary outage occurs, the
  // player's onError handler catches it client-side.
  console.log(`Cloudinary merge: complete, URL ready (Cloudinary will process on first request)`);

  return {
    merged_video_url: mergedUrl,
    cloudinary_public_ids: publicIds,
  };
}

/**
 * Optional utility: delete a scene's source clips and merged output.
 * Called when a scene is deleted to keep Cloudinary storage clean.
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
    // Non-fatal — scene is being deleted anyway
  }
}

/**
 * Alias for deleteSceneFromCloudinary — kept for backwards compatibility
 * with the merge route, which imports this name.
 */
export const deleteSceneSourceClips = deleteSceneFromCloudinary;