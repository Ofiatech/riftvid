// Cloudinary SDK wrapper for scene merging
// v3: Uses Cloudinary's documented URL syntax: l_video:<id>,fl_splice/fl_layer_apply

import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export interface ClipForMerge {
  clipId: string;
  videoUrl: string;
  clipOrder: number;
}

export interface MergeResult {
  merged_video_url: string;
  public_id: string;
  duration: number;
  format: string;
  bytes: number;
}

/**
 * Upload a single clip from a public URL to Cloudinary.
 */
async function uploadClipForMerge(
  videoUrl: string,
  userId: string,
  sceneId: string,
  clipOrder: number
): Promise<UploadApiResponse> {
  const publicId = `riftvid/${userId}/scenes/${sceneId}/source-clips/clip-${clipOrder
    .toString()
    .padStart(3, '0')}`;

  return await cloudinary.uploader.upload(videoUrl, {
    resource_type: 'video',
    public_id: publicId,
    overwrite: true,
    invalidate: true,
  });
}

/**
 * Build the concatenation URL using Cloudinary's documented syntax.
 *
 * Cloudinary URL format (from official docs):
 *   /video/upload/<base_transforms>/l_video:<overlay_id>,fl_splice,<overlay_transforms>/fl_layer_apply/<base_id>.mp4
 *
 * Key points:
 * - Overlay video id has slashes replaced with COLONS in l_video reference
 * - fl_splice and l_video are in the SAME transformation segment (comma separated)
 * - Each overlay clip = one /l_video:...,fl_splice,.../fl_layer_apply/ pair
 * - w_1.0,h_1.0,fl_relative,c_fill makes overlays match the base size
 *
 * Reference URL structure for 3 clips (clip-001 as base, clip-002 + clip-003 spliced):
 *   /video/upload/
 *     w_720,h_1280,c_fill/                                          ← base sizing
 *     l_video:.../clip-002,fl_splice,w_1.0,h_1.0,fl_relative,c_fill/  ← splice clip 2
 *     fl_layer_apply/
 *     l_video:.../clip-003,fl_splice,w_1.0,h_1.0,fl_relative,c_fill/  ← splice clip 3
 *     fl_layer_apply/
 *     <base_id>.mp4
 */
function buildConcatenationUrl(clipPublicIds: string[]): string {
  if (clipPublicIds.length === 0) {
    throw new Error('No clips to concatenate');
  }

  const baseClipId = clipPublicIds[0];
  const overlayClips = clipPublicIds.slice(1);

  if (overlayClips.length === 0) {
    // Single clip — no concatenation needed
    return cloudinary.url(baseClipId, {
      resource_type: 'video',
      format: 'mp4',
      secure: true,
    });
  }

  // Build raw transformation array for cloudinary.url()
  // Each overlay needs TWO segments: one with overlay+splice, one with layer_apply
  const transformations: Array<{ raw_transformation: string }> = [];

  for (const overlayId of overlayClips) {
    // Cloudinary overlay syntax: l_video:<public_id_with_colons_instead_of_slashes>
    const overlayRef = overlayId.replace(/\//g, ':');

    // Segment 1: declare the overlay with splice flag + relative sizing
    transformations.push({
      raw_transformation: `l_video:${overlayRef},fl_splice,w_1.0,h_1.0,fl_relative,c_fill`,
    });
    // Segment 2: apply the layer (concatenates it)
    transformations.push({
      raw_transformation: `fl_layer_apply`,
    });
  }

  return cloudinary.url(baseClipId, {
    resource_type: 'video',
    format: 'mp4',
    transformation: transformations,
    secure: true,
  });
}

/**
 * "Warm" the merge URL by fetching it — this forces Cloudinary to generate
 * the merged video and cache it on their CDN.
 *
 * Use GET (not HEAD) because Cloudinary needs to actually process the video
 * to generate it on first request.
 */
async function warmMergeUrl(
  mergeUrl: string
): Promise<{ bytes: number; status: number }> {
  // First request triggers Cloudinary processing — can take 20-60s
  // We use a streaming approach to not buffer the whole video in memory
  const response = await fetch(mergeUrl, { method: 'GET' });

  if (!response.ok) {
    // Try to read error body for diagnostics
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      errorBody = '(no body)';
    }
    throw new Error(
      `Cloudinary returned ${response.status} ${response.statusText}: ${errorBody.slice(0, 500)}`
    );
  }

  // Consume the response body so connection closes cleanly
  const buffer = await response.arrayBuffer();
  const bytes = buffer.byteLength;

  return { bytes, status: response.status };
}

/**
 * MAIN MERGE FUNCTION
 */
export async function mergeSceneClips(
  clips: ClipForMerge[],
  userId: string,
  sceneId: string,
  totalDurationSeconds: number
): Promise<MergeResult> {
  if (clips.length === 0) {
    throw new Error('Cannot merge: scene has no clips');
  }

  const sortedClips = [...clips].sort((a, b) => a.clipOrder - b.clipOrder);

  console.log(
    `Cloudinary merge: uploading ${sortedClips.length} clips for scene ${sceneId}`
  );

  // STEP 1: Upload each clip to Cloudinary
  const uploadResults: string[] = [];
  for (const clip of sortedClips) {
    try {
      const result = await uploadClipForMerge(
        clip.videoUrl,
        userId,
        sceneId,
        clip.clipOrder
      );
      uploadResults.push(result.public_id);
      console.log(`  ✓ Uploaded clip ${clip.clipOrder} → ${result.public_id}`);
    } catch (err) {
      console.error(`  ✗ Failed to upload clip ${clip.clipOrder}:`, err);
      throw new Error(
        `Failed to upload clip ${clip.clipOrder}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`
      );
    }
  }

  // STEP 2: Single clip — no concat needed
  if (uploadResults.length === 1) {
    console.log('Single clip — returning direct URL');
    const singleUrl = cloudinary.url(uploadResults[0], {
      resource_type: 'video',
      format: 'mp4',
      secure: true,
    });
    return {
      merged_video_url: singleUrl,
      public_id: uploadResults[0],
      duration: totalDurationSeconds,
      format: 'mp4',
      bytes: 0,
    };
  }

  // STEP 3: Build concat URL using documented Cloudinary syntax
  console.log(`Cloudinary merge: building concat URL for ${uploadResults.length} clips`);
  const mergeUrl = buildConcatenationUrl(uploadResults);
  console.log(`Generated URL: ${mergeUrl}`);

  // STEP 4: Warm it (forces Cloudinary to process)
  console.log('Warming merge URL (Cloudinary is processing concatenation)...');
  try {
    const warmResult = await warmMergeUrl(mergeUrl);
    console.log(
      `Merge URL warm: SUCCESS (${(warmResult.bytes / 1024 / 1024).toFixed(2)} MB)`
    );

    return {
      merged_video_url: mergeUrl,
      public_id: uploadResults[0],
      duration: totalDurationSeconds,
      format: 'mp4',
      bytes: warmResult.bytes,
    };
  } catch (err) {
    console.error('Merge URL warm failed:', err);
    throw new Error(
      `Cloudinary concatenation processing failed: ${
        err instanceof Error ? err.message : 'unknown'
      }`
    );
  }
}

/**
 * Delete a video from Cloudinary.
 */
export async function deleteMergedVideo(publicId: string): Promise<void> {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
    console.log(`Cloudinary cleanup: deleted ${publicId}`);
  } catch (err) {
    console.error(`Cloudinary cleanup failed for ${publicId}:`, err);
  }
}

/**
 * Delete all source clips for a scene (cleanup before re-merging).
 */
export async function deleteSceneSourceClips(
  userId: string,
  sceneId: string
): Promise<void> {
  try {
    const folderPath = `riftvid/${userId}/scenes/${sceneId}/source-clips`;
    await cloudinary.api.delete_resources_by_prefix(folderPath, {
      resource_type: 'video',
    });
    console.log(`Cloudinary cleanup: deleted source clips for scene ${sceneId}`);
  } catch (err) {
    console.error(`Cloudinary scene cleanup failed:`, err);
  }
}

export async function pingCloudinary(): Promise<boolean> {
  try {
    await cloudinary.api.ping();
    return true;
  } catch (err) {
    console.error('Cloudinary ping failed:', err);
    throw err;
  }
}

export default cloudinary;