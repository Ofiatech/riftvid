'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Sparkles, Upload, Link2, Loader2, Check, Wand2,
  RefreshCw, Clock, Film, Zap, Play, Eye, MessageCircle,
  ArrowLeft, Globe, UserSquare2, Smartphone, Monitor, Square as SquareIcon,
  ImageIcon,
} from 'lucide-react';
// 4.3.5c — Unknown Characters modal & avatar typing
import UnknownCharactersModal from '@/components/UnknownCharactersModal';
import type { AvatarRecord } from '@/lib/avatars';

type ChatMode = 'idle' | 'asking' | 'refining' | 'done' | 'error';
type GenerationMode = 'idle' | 'submitting' | 'queued' | 'processing' | 'completed' | 'failed';
// 'library' is removed as a source tab; we keep it in the type for backwards
// compatibility with older clips whose source_type was set to 'library' before
// this redesign. EditingClip can still carry it; it just won't have its own tab.
type SourceType = 'upload' | 'last_frame' | 'prompt' | 'url';
type AspectRatio = '9:16' | '16:9' | '1:1';

interface RiftQuestion {
  question: string;
  options: string[];
  acknowledgmentBeforeQuestion?: string;
}

interface UserProfile {
  credits_balance: number;
  credits_lifetime_used: number;
}

interface LastFrameOption {
  clipId: string;
  clipNumber: number;
  lastFrameUrl: string;
  prompt: string;
}

interface EditingClip {
  id: string;
  clip_order: number;
  // Older clips may carry 'library' here; we coerce it to 'upload' on restore.
  source_type: 'upload' | 'last_frame' | 'library' | 'url';
  source_image_url: string;
  source_clip_id: string | null;
  base_prompt: string | null;
  refined_prompt: string;
  rift_used: boolean;
  rift_answers: unknown;
  scene_description: string | null;
  duration: 5 | 10;
}

interface ClipGenerationModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  sceneId: string;
  nextClipNumber: number;
  lastFrameOptions: LastFrameOption[];
  profile: UserProfile | null;
  onClipCreated: () => void;
  onProfileUpdate: () => void;
  initialSourceType?: SourceType;
  editingClip?: EditingClip | null;
  // Scene's locked aspect ratio. null = scene hasn't picked one yet.
  sceneAspectRatio?: AspectRatio | null;
  // First existing clip's source image URL (for aspect detection when scene
  // already has clips but no aspect_ratio set). null = no clips yet.
  firstExistingClipImageUrl?: string | null;
}

// 4.3.5c — DetectedCharacter mirrors the response from /api/prompts/detect-characters
interface DetectedCharacter {
  name: string;
  portraitPrompt: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isHttpUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Aspect-aware Tailwind class for the image preview frame
function aspectClassFor(aspect: AspectRatio | null): string {
  if (aspect === '9:16') return 'aspect-[9/16]';
  if (aspect === '1:1') return 'aspect-square';
  return 'aspect-video'; // 16:9 default
}

// Detect aspect ratio from an image URL by loading it via Image() API.
// Snaps to closest of 9:16, 16:9, 1:1.
function detectAspectFromUrl(url: string): Promise<AspectRatio> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight;
      // Distance to each canonical aspect
      const candidates: Array<{ aspect: AspectRatio; ratio: number }> = [
        { aspect: '9:16', ratio: 9 / 16 },
        { aspect: '16:9', ratio: 16 / 9 },
        { aspect: '1:1', ratio: 1 },
      ];
      let best: AspectRatio = '9:16';
      let bestDist = Infinity;
      for (const c of candidates) {
        const dist = Math.abs(ratio - c.ratio);
        if (dist < bestDist) {
          bestDist = dist;
          best = c.aspect;
        }
      }
      resolve(best);
    };
    img.onerror = () => resolve('9:16'); // fallback default
    img.src = url;
  });
}

// 4.3.5c — escape a string so it's safe inside a regex
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 4.3.5c — apply { from, to } substitutions to a prompt using word boundaries
// so "Markus" → "Marcus" doesn't accidentally rewrite "Markuson".
function applyNameSubstitutions(
  prompt: string,
  subs: Array<{ from: string; to: string }>
): string {
  let result = prompt;
  for (const { from, to } of subs) {
    const regex = new RegExp(`\\b${escapeRegex(from)}\\b`, 'gi');
    result = result.replace(regex, to);
  }
  return result;
}

export default function ClipGenerationModal({
  open,
  onClose,
  projectId,
  sceneId,
  nextClipNumber,
  lastFrameOptions,
  profile,
  onClipCreated,
  onProfileUpdate,
  initialSourceType = 'upload',
  editingClip = null,
  sceneAspectRatio = null,
  firstExistingClipImageUrl = null,
}: ClipGenerationModalProps) {
  const isRegenerating = editingClip !== null;

  // Source picker state. If an old clip's source_type is 'library', coerce
  // to 'upload' so the tab UI doesn't break.
  const initialNormalizedSource: SourceType =
    initialSourceType === 'prompt' ||
    initialSourceType === 'upload' ||
    initialSourceType === 'last_frame' ||
    initialSourceType === 'url'
      ? initialSourceType
      : 'upload';

  const [sourceType, setSourceType] = useState<SourceType>(initialNormalizedSource);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedLastFrameClipId, setSelectedLastFrameClipId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // URL source state
  const [urlInput, setUrlInput] = useState('');
  const [urlPreviewUrl, setUrlPreviewUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);

  // ==========================================================================
  // PROMPT TAB STATE (4.3.5b — prompt is just another source tab now)
  // ==========================================================================
  // The text the user types to generate the image (separate from `prompt`
  // below which is the motion prompt for the video).
  const [imagePrompt, setImagePrompt] = useState('');
  // The aspect locked for this scene. null = first clip in scene & we don't
  // know yet (detection runs OR user picks).
  const [selectedAspect, setSelectedAspect] = useState<AspectRatio | null>(null);
  // True while we're async-detecting aspect from an existing clip's image.
  const [aspectDetecting, setAspectDetecting] = useState(false);
  // The AI-generated image URL after a successful generation. null = not generated yet.
  const [promptGeneratedImageUrl, setPromptGeneratedImageUrl] = useState<string | null>(null);
  // True between user clicking "Generate Image" and the API returning.
  const [promptImageGenerating, setPromptImageGenerating] = useState(false);
  // Error message from the last image gen attempt.
  const [promptImageError, setPromptImageError] = useState<string | null>(null);
  // Which Fal model generated the current image (for the badge).
  const [promptImageMode, setPromptImageMode] = useState<'avatar' | 'flux' | null>(null);
  // How many regens user has done this session (for cost awareness).
  const [promptRegenCount, setPromptRegenCount] = useState(0);
  // True once user clicks "Use This Image". The generated image becomes the
  // source image and the motion prompt section appears (same as Upload mode).
  const [promptCommitted, setPromptCommitted] = useState(false);

  // ==========================================================================
  // 4.3.5c — UNKNOWN CHARACTERS DETECTION STATE
  // ==========================================================================
  // The user's avatar library (fetched on modal open). Used to cross-reference
  // detected character names against existing avatars.
  const [avatars, setAvatars] = useState<AvatarRecord[]>([]);
  // The characters GPT-4o extracted from the current prompt. Empty until
  // detection runs.
  const [detectedCharacters, setDetectedCharacters] = useState<DetectedCharacter[]>([]);
  // Controls visibility of the UnknownCharactersModal. Opens when at least
  // one detected character isn't already an exact match in the avatar library.
  const [showUnknownsModal, setShowUnknownsModal] = useState(false);
  // True while /api/prompts/detect-characters is in flight. Brief — typically
  // a couple of seconds before either the modal opens or generation continues.
  const [isDetectingCharacters, setIsDetectingCharacters] = useState(false);
  // Remembers whether the in-flight image generation is a regen, so we can
  // restore that context after the modal closes.
  const [pendingImageGenIsRegen, setPendingImageGenIsRegen] = useState<boolean | null>(null);

  // Prompt + duration
  const [aiOptimization, setAiOptimization] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<5 | 10>(5);

  // Rift Assistant flow
  const [chatMode, setChatMode] = useState<ChatMode>('idle');
  const [basePrompt, setBasePrompt] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState<RiftQuestion | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(4);
  const [imageDescription, setImageDescription] = useState<string | null>(null);
  const [sceneAcknowledgment, setSceneAcknowledgment] = useState<string | null>(null);
  const [finalAcknowledgment, setFinalAcknowledgment] = useState<string | null>(null);
  const [customAnswer, setCustomAnswer] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generation state
  const [genMode, setGenMode] = useState<GenerationMode>('idle');
  const [genProgress, setGenProgress] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const credits = profile?.credits_balance ?? 0;
  const requiredCredits = duration === 5 ? 1 : 2;
  const canAffordGeneration = credits >= requiredCredits;

  // getCurrentImageUrl returns the active source image for the clip.
  // For prompt mode, the AI-generated image only "counts" as the source
  // once the user clicks "Use This Image" (promptCommitted=true). Until
  // then, the user is in the image-review phase and hasn't decided yet.
  const getCurrentImageUrl = useCallback((): string | null => {
    if (sourceType === 'upload') return previewUrl;
    if (sourceType === 'last_frame') {
      const opt = lastFrameOptions.find((o) => o.clipId === selectedLastFrameClipId);
      return opt?.lastFrameUrl || null;
    }
    if (sourceType === 'url') return urlPreviewUrl;
    if (sourceType === 'prompt') {
      return promptCommitted ? promptGeneratedImageUrl : null;
    }
    return null;
  }, [
    sourceType, previewUrl, selectedLastFrameClipId, lastFrameOptions,
    urlPreviewUrl, promptCommitted, promptGeneratedImageUrl,
  ]);

  const currentImageUrl = getCurrentImageUrl();

  // 4.3.5c — fetch avatars when the modal opens, so the UnknownCharactersModal
  // can cross-reference detected names without an extra round-trip.
  const fetchAvatars = useCallback(async () => {
    try {
      const res = await fetch('/api/avatars');
      if (!res.ok) return;
      const data = await res.json();
      setAvatars(data.avatars || []);
    } catch (err) {
      // Non-fatal — detection will still work, but fuzzy matching against
      // existing avatars won't have anything to compare to.
      console.warn('Avatars fetch failed (4.3.5c):', err);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchAvatars();
  }, [open, fetchAvatars]);

  // Open-time state sync
  useEffect(() => {
    if (!open) return;
    if (editingClip) {
      // Regenerate mode — restore the clip's full state. If the old clip's
      // source_type is 'library', show it under the Upload tab (we removed
      // the Library tab in 4.3.5b).
      const restoreSource: SourceType =
        editingClip.source_type === 'library' ? 'upload' : editingClip.source_type;
      setSourceType(restoreSource);
      setPrompt(editingClip.refined_prompt);
      setBasePrompt(editingClip.base_prompt || '');
      setDuration(editingClip.duration);
      setAiOptimization(editingClip.rift_used);
      setImageDescription(editingClip.scene_description);

      if (editingClip.source_type === 'last_frame' && editingClip.source_clip_id) {
        setSelectedLastFrameClipId(editingClip.source_clip_id);
      } else if (editingClip.source_type === 'url') {
        setUrlInput(editingClip.source_image_url);
        setUrlPreviewUrl(editingClip.source_image_url);
      } else {
        // upload or library (legacy) — show the existing image URL as preview
        setPreviewUrl(editingClip.source_image_url);
      }
    } else {
      setSourceType(initialNormalizedSource);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialNormalizedSource, editingClip?.id]);

  // Initialize / detect aspect ratio when prompt tab is active.
  // Priority: scene.aspect_ratio > detect from first existing clip > null (user picks)
  useEffect(() => {
    if (!open) return;
    if (sourceType !== 'prompt') return;
    if (selectedAspect) return; // already set
    if (aspectDetecting) return; // already detecting

    if (sceneAspectRatio) {
      setSelectedAspect(sceneAspectRatio);
      return;
    }

    if (firstExistingClipImageUrl) {
      setAspectDetecting(true);
      detectAspectFromUrl(firstExistingClipImageUrl)
        .then((detected) => {
          setSelectedAspect(detected);
        })
        .catch(() => {
          // Fall back to picker
        })
        .finally(() => {
          setAspectDetecting(false);
        });
    }
    // If neither scene.aspect_ratio nor firstExistingClipImageUrl is set, the
    // picker stays visible until the user chooses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceType, sceneAspectRatio, firstExistingClipImageUrl]);

  // Auto-select most recent last-frame
  useEffect(() => {
    if (sourceType === 'last_frame' && lastFrameOptions.length > 0 && !selectedLastFrameClipId) {
      setSelectedLastFrameClipId(lastFrameOptions[lastFrameOptions.length - 1].clipId);
    }
  }, [sourceType, lastFrameOptions, selectedLastFrameClipId]);

  // URL tab focus
  useEffect(() => {
    if (sourceType === 'url' && !urlPreviewUrl) {
      const t = setTimeout(() => urlInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [sourceType, urlPreviewUrl]);

  useEffect(() => {
    if (showCustomInput) customInputRef.current?.focus();
  }, [showCustomInput]);

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [previewUrl]);

  if (!open) return null;

  const handleClose = () => {
    // 4.3.5c: don't close the parent while the UnknownCharactersModal is up —
    // the user needs to resolve it explicitly (the child's X button is the
    // only way to back out).
    if (showUnknownsModal) return;

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setSourceType(initialNormalizedSource);
    setSelectedFile(null);
    if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setSelectedLastFrameClipId(null);
    setFileError(null);
    setUrlInput('');
    setUrlPreviewUrl(null);
    setUrlError(null);
    setUrlLoading(false);

    // Reset prompt tab state
    setImagePrompt('');
    setSelectedAspect(null);
    setAspectDetecting(false);
    setPromptGeneratedImageUrl(null);
    setPromptImageGenerating(false);
    setPromptImageError(null);
    setPromptImageMode(null);
    setPromptRegenCount(0);
    setPromptCommitted(false);

    // 4.3.5c: reset detection state
    setDetectedCharacters([]);
    setShowUnknownsModal(false);
    setIsDetectingCharacters(false);
    setPendingImageGenIsRegen(null);

    setPrompt('');
    setDuration(5);
    setChatMode('idle');
    setBasePrompt('');
    setCurrentQuestion(null);
    setAnswers([]);
    setStep(0);
    setTotalSteps(4);
    setImageDescription(null);
    setSceneAcknowledgment(null);
    setFinalAcknowledgment(null);
    setCustomAnswer('');
    setShowCustomInput(false);
    setError(null);
    setGenMode('idle');
    setGenProgress(0);
    setGenError(null);
    setOutOfCredits(false);

    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('Please upload PNG, JPG, or WebP only');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError(`File too large. Max ${formatFileSize(MAX_FILE_SIZE)}`);
      e.target.value = '';
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(blobUrl);
  };

  const handleRemoveFile = () => {
    if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUrlLoad = async () => {
    setUrlError(null);
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError('Please paste an image or page URL');
      return;
    }
    if (!isHttpUrl(trimmed)) {
      setUrlError('URL must start with https:// or http://');
      return;
    }
    setUrlLoading(true);
    try {
      const res = await fetch('/api/utils/resolve-image-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data?.message || "Couldn't load that image.";
        const hint = data?.hint ? ` ${data.hint}` : '';
        setUrlError(`${message}${hint}`);
        setUrlLoading(false);
        return;
      }
      const resolved = data?.imageUrl as string | undefined;
      if (!resolved) {
        setUrlError("Couldn't extract an image from that link.");
        setUrlLoading(false);
        return;
      }
      setUrlPreviewUrl(resolved);
      setUrlLoading(false);
    } catch (err) {
      console.error('URL resolve error:', err);
      setUrlError("Couldn't reach the resolver. Check your connection and try again.");
      setUrlLoading(false);
    }
  };

  const handleUrlRemove = () => {
    setUrlInput('');
    setUrlPreviewUrl(null);
    setUrlError(null);
    setUrlLoading(false);
  };

  // ==========================================================================
  // PROMPT TAB HANDLERS (4.3.5b)
  // ==========================================================================
  // Image-only generation. Calls /api/clips/generate-from-prompt which now
  // returns just an imageUrl (no clip insert). The image is stored in
  // promptGeneratedImageUrl. The user then clicks "Use This Image" to commit
  // it as the source for the clip, which feeds into the normal Upload-mode
  // flow on handleGenerate.
  //
  // 4.3.5c INSERTION:
  //   - callGenerateImage() now first runs character detection
  //   - If unknown characters are found, opens UnknownCharactersModal and pauses
  //   - When the modal completes, proceedWithImageGeneration() runs (with any
  //     name substitutions applied to the prompt)
  //   - If no unknowns OR detection fails, proceedWithImageGeneration() runs
  //     immediately — original behavior preserved

  const callGenerateImage = async (isRegen: boolean) => {
    // === EXISTING VALIDATION (unchanged) ===
    if (!projectId || !sceneId) {
      setPromptImageError('Project or scene info is missing. Please reload the page.');
      return;
    }
    const trimmed = imagePrompt.trim();
    if (!trimmed) {
      setPromptImageError('Please describe what you want to generate');
      return;
    }
    if (trimmed.length < 5) {
      setPromptImageError('Please write at least 5 characters');
      return;
    }
    if (!selectedAspect) {
      setPromptImageError('Please pick an aspect ratio first');
      return;
    }
    if (credits < 1) {
      setOutOfCredits(true);
      return;
    }

    // === 4.3.5c — CHARACTER DETECTION STEP ===
    setIsDetectingCharacters(true);
    setPromptImageError(null);

    let detected: DetectedCharacter[] = [];
    try {
      const detectRes = await fetch('/api/prompts/detect-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed }),
      });
      if (detectRes.ok) {
        const detectData = await detectRes.json();
        detected = (detectData.detectedCharacters ?? []) as DetectedCharacter[];
      } else {
        // Non-fatal — fall through to generation without character resolution
        console.warn('Character detection returned non-OK status, proceeding');
      }
    } catch (err) {
      // Non-fatal — fall through. Generation still works, just without the
      // unknown-character UX.
      console.warn('Character detection failed, proceeding:', err);
    }
    setIsDetectingCharacters(false);

    // Decide whether the modal needs to open. We only open it when at least
    // one detected character isn't already an exact match in the user's
    // avatar library — fuzzy and unknown both require user input, exact
    // matches resolve silently.
    const needsModal =
      detected.length > 0 &&
      detected.some((char) => {
        const exactExists = avatars.some(
          (a) => a.name.toLowerCase() === char.name.toLowerCase()
        );
        return !exactExists;
      });

    if (!needsModal) {
      // Common case: no characters, all exact matches, or detection failed.
      // Go straight to image generation with the user's prompt unchanged.
      proceedWithImageGeneration(isRegen, trimmed);
      return;
    }

    // Open the unknown-characters modal and pause. Image generation will
    // resume from handleUnknownsResolved() once the user finishes.
    setDetectedCharacters(detected);
    setPendingImageGenIsRegen(isRegen);
    setShowUnknownsModal(true);
  };

  // The actual image-generation fetch — extracted so we can call it either
  // directly (no unknowns) or after the UnknownCharactersModal completes
  // (with any name substitutions applied).
  const proceedWithImageGeneration = async (isRegen: boolean, finalPrompt: string) => {
    setPromptImageGenerating(true);
    setPromptImageError(null);
    setOutOfCredits(false);

    try {
      const res = await fetch(`/api/clips/generate-from-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          sceneId,
          prompt: finalPrompt,
          duration,
          aspectRatio: selectedAspect,
        }),
      });

      const data = await res.json();

      if (res.status === 402 || data.error === 'out_of_credits') {
        setPromptImageGenerating(false);
        setOutOfCredits(true);
        onProfileUpdate();
        return;
      }

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Image generation failed');
      }

      if (!data.imageUrl) {
        throw new Error('Server returned no image URL');
      }

      setPromptGeneratedImageUrl(data.imageUrl);

      const mode = data.meta?.mode_used as string | undefined;
      if (mode === 'flux_no_avatar') setPromptImageMode('flux');
      else if (mode === 'nano_banana_anchor' || mode === 'nano_banana_edit') setPromptImageMode('avatar');

      // If scene didn't have aspect before, backend set it now — refresh
      // parent so subsequent opens of this modal will know.
      if (data.meta?.aspect_was_set_now) {
        onClipCreated();
      }

      if (isRegen) {
        setPromptRegenCount((n) => n + 1);
      }

      onProfileUpdate();
      setPromptImageGenerating(false);
    } catch (err) {
      setPromptImageGenerating(false);
      setPromptImageError(err instanceof Error ? err.message : 'Image generation failed');
    }
  };

  const handlePromptGenerateImage = () => callGenerateImage(false);
  const handlePromptRegenerate = () => callGenerateImage(true);

  // Commit the AI-generated image as the clip's source. Copies the image
  // prompt to the motion prompt by default; user can edit it before
  // clicking the final Generate Clip button.
  const handlePromptUseImage = () => {
    if (!promptGeneratedImageUrl) return;
    setPromptCommitted(true);
    // Seed motion prompt with the image prompt only if motion prompt is
    // still empty (don't overwrite anything the user has typed there).
    setPrompt((current) => (current.trim() ? current : imagePrompt));
  };

  // Undo "Use This Image" — go back to the image review phase.
  const handlePromptUncommit = () => {
    setPromptCommitted(false);
  };

  // ==========================================================================
  // 4.3.5c — UNKNOWN CHARACTERS MODAL HANDLERS
  // ==========================================================================

  // User completed the modal — apply name substitutions to the prompt,
  // refresh the avatars list, then continue with image generation.
  const handleUnknownsResolved = async (result: {
    createdAvatarIds: string[];
    nameSubstitutions: Array<{ from: string; to: string }>;
  }) => {
    setShowUnknownsModal(false);

    // Refresh the avatars list — we may have created new ones during the
    // modal flow. This ensures the next generation correctly word-boundary-
    // matches them.
    if (result.createdAvatarIds.length > 0) {
      await fetchAvatars();
    }

    // Apply name substitutions (e.g. "Markus" → "Marcus" when user picked
    // the fuzzy match).
    const trimmed = imagePrompt.trim();
    const finalPrompt = applyNameSubstitutions(trimmed, result.nameSubstitutions);

    // Resume the paused image generation
    const isRegen = pendingImageGenIsRegen ?? false;
    setPendingImageGenIsRegen(null);
    setDetectedCharacters([]);
    proceedWithImageGeneration(isRegen, finalPrompt);
  };

  // User dismissed the modal without resolving (X button) — abort the
  // pending image generation. The user can re-tap Generate Image to retry.
  const handleUnknownsClose = () => {
    setShowUnknownsModal(false);
    setDetectedCharacters([]);
    setPendingImageGenIsRegen(null);
  };

  // User hit their avatar tier limit and chose to upgrade. Close everything
  // and surface the upgrade path. For now we use the same simple alert that
  // the existing out-of-credits flow uses — TierPickerModal integration here
  // is a follow-up at 4.10 brand polish.
  const handleAvatarLimitReached = () => {
    setShowUnknownsModal(false);
    setDetectedCharacters([]);
    setPendingImageGenIsRegen(null);
    alert('Upgrade your plan to add more avatars. 🚀');
    handleClose();
  };

  // ==========================================================================
  // RIFT ASSISTANT (unchanged)
  // ==========================================================================

  const callRift = async (
    currentAnswers: string[],
    currentStep: number,
    cachedImageDescription: string | null,
    cachedTotalSteps: number,
    imageBase64?: string,
    overrideBasePrompt?: string
  ) => {
    setError(null);
    try {
      const res = await fetch('/api/rift-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basePrompt: overrideBasePrompt ?? basePrompt,
          answers: currentAnswers,
          step: currentStep,
          imageBase64: currentStep === 0 ? imageBase64 : undefined,
          imageDescription: cachedImageDescription,
          totalSteps: cachedTotalSteps,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reach Rift Assistant');
      if (data.totalSteps && data.totalSteps !== cachedTotalSteps) setTotalSteps(data.totalSteps);
      if (data.imageDescription && !cachedImageDescription) setImageDescription(data.imageDescription);
      if (data.sceneAcknowledgment) setSceneAcknowledgment(data.sceneAcknowledgment);
      if (data.done && data.refinedPrompt) {
        setFinalAcknowledgment(data.acknowledgmentBeforeQuestion || null);
        setPrompt(data.refinedPrompt);
        setChatMode('done');
      } else if (data.question && data.options) {
        setCurrentQuestion({
          question: data.question,
          options: data.options,
          acknowledgmentBeforeQuestion: data.acknowledgmentBeforeQuestion,
        });
        setChatMode('asking');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setChatMode('error');
    }
  };

  const handleStartRift = async () => {
    if (!prompt.trim()) {
      setError('Please describe your clip idea first');
      return;
    }
    if (!currentImageUrl) {
      setError('Please select a source image first');
      return;
    }
    const currentPrompt = prompt;
    setBasePrompt(currentPrompt);
    setAnswers([]);
    setStep(0);
    setImageDescription(null);
    setSceneAcknowledgment(null);
    setFinalAcknowledgment(null);
    setChatMode('refining');

    let imageBase64: string | undefined;
    if (sourceType === 'upload' && selectedFile) {
      try {
        imageBase64 = await fileToBase64(selectedFile);
      } catch (err) {
        console.error(err);
      }
    } else if (currentImageUrl) {
      imageBase64 = currentImageUrl;
    }

    await callRift([], 0, null, 4, imageBase64, currentPrompt);
  };

  const handleAnswer = async (answer: string) => {
    const newAnswers = [...answers, answer];
    const newStep = step + 1;
    setAnswers(newAnswers);
    setStep(newStep);
    setShowCustomInput(false);
    setCustomAnswer('');
    setChatMode('refining');
    await callRift(newAnswers, newStep, imageDescription, totalSteps);
  };

  const handleCustomSubmit = () => {
    if (customAnswer.trim()) handleAnswer(customAnswer.trim());
  };

  const handleRiftRetry = async () => {
    setError(null);
    setChatMode('refining');
    if (answers.length === 0) {
      let imageBase64: string | undefined;
      if (sourceType === 'upload' && selectedFile) {
        try {
          imageBase64 = await fileToBase64(selectedFile);
        } catch (err) {
          console.error(err);
        }
      } else if (currentImageUrl) {
        imageBase64 = currentImageUrl;
      }
      await callRift([], 0, null, 4, imageBase64, basePrompt);
    } else {
      await callRift(answers, step, imageDescription, totalSteps);
    }
  };

  const handleRestart = () => {
    setChatMode('idle');
    setAnswers([]);
    setStep(0);
    setTotalSteps(4);
    setImageDescription(null);
    setSceneAcknowledgment(null);
    setFinalAcknowledgment(null);
    setCurrentQuestion(null);
    setBasePrompt('');
    setError(null);
  };

  // ==========================================================================
  // VIDEO RENDER (unchanged path; prompt-source clips flow through here too)
  // ==========================================================================

  const pollVideoStatus = async (reqId: string) => {
    try {
      const res = await fetch(`/api/video-status/${reqId}?tableMode=clips`);
      const data = await res.json();
      if (data.status === 'completed' && data.videoUrl) {
        setGenMode('completed');
        setGenProgress(100);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        onClipCreated();
        onProfileUpdate();
        setTimeout(() => handleClose(), 2000);
      } else if (data.status === 'processing') {
        setGenMode('processing');
        setGenProgress(data.progress || 50);
      } else if (data.status === 'queued') {
        setGenMode('queued');
        setGenProgress(data.progress || 5);
      } else if (data.status === 'failed') {
        setGenMode('failed');
        setGenError(data.error || 'Video generation failed');
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        onClipCreated();
        onProfileUpdate();
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setGenError('Please type or generate a prompt first');
      return;
    }
    if (!currentImageUrl) {
      setGenError('Please select a source image first');
      return;
    }
    if (!canAffordGeneration) {
      setOutOfCredits(true);
      return;
    }

    setGenMode('submitting');
    setGenProgress(0);
    setGenError(null);
    setOutOfCredits(false);

    try {
      // Build source payload. For prompt-sourced clips, treat the AI image
      // URL as a URL source — same as the URL tab — which routes through
      // the proven Upload-style clip-creation path.
      const sourcePayload: Record<string, unknown> = {};

      if (sourceType === 'upload') {
        sourcePayload.source_type = 'upload';
        if (selectedFile) {
          sourcePayload.source_image_base64 = await fileToBase64(selectedFile);
        } else if (previewUrl && previewUrl.startsWith('http')) {
          sourcePayload.source_image_url = previewUrl;
        }
      } else if (sourceType === 'last_frame') {
        sourcePayload.source_type = 'last_frame';
        sourcePayload.source_clip_id = selectedLastFrameClipId;
      } else if (sourceType === 'url') {
        sourcePayload.source_type = 'url';
        sourcePayload.source_image_url = urlPreviewUrl;
      } else if (sourceType === 'prompt') {
        // AI-generated image — backend's clip POST endpoint rejects
        // source_type='url' but accepts source_type='upload' with a
        // source_image_url (which is how Upload mode handles already-hosted
        // images during regenerate). Use that path.
        sourcePayload.source_type = 'upload';
        sourcePayload.source_image_url = promptGeneratedImageUrl;
      }

      const sharedPayload: Record<string, unknown> = {
        base_prompt: basePrompt || null,
        refined_prompt: prompt.trim(),
        rift_used: aiOptimization,
        rift_answers: answers.length > 0 ? answers : null,
        scene_description: imageDescription,
        duration,
        ...sourcePayload,
      };

      let createdOrUpdated: { id: string; source_image_url: string } & Record<string, unknown>;

      if (isRegenerating && editingClip) {
        const patchRes = await fetch(
          `/api/projects/${projectId}/scenes/${sceneId}/clips/${editingClip.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ regenerate: true, ...sharedPayload }),
          }
        );

        const patched = await patchRes.json();

        if (patchRes.status === 402 || patched.out_of_credits) {
          setGenMode('idle');
          setOutOfCredits(true);
          onProfileUpdate();
          return;
        }

        if (!patchRes.ok) throw new Error(patched.error || 'Failed to update clip');
        createdOrUpdated = patched;
      } else {
        const createRes = await fetch(
          `/api/projects/${projectId}/scenes/${sceneId}/clips`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sharedPayload),
          }
        );

        const created = await createRes.json();

        if (createRes.status === 402 || created.out_of_credits) {
          setGenMode('idle');
          setOutOfCredits(true);
          onProfileUpdate();
          return;
        }

        if (!createRes.ok) throw new Error(created.error || 'Failed to create clip');
        createdOrUpdated = created;
      }

      onProfileUpdate();
      onClipCreated();

      const genRes = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: createdOrUpdated.id,
          prompt: prompt.trim(),
          imageUrl: createdOrUpdated.source_image_url,
          duration,
          tableMode: 'clips',
        }),
      });

      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || 'Failed to start generation');

      setGenMode('queued');
      setGenProgress(5);

      pollIntervalRef.current = setInterval(() => {
        pollVideoStatus(genData.requestId);
      }, 2000);
    } catch (err) {
      setGenMode('failed');
      setGenError(err instanceof Error ? err.message : 'Generation failed');
    }
  };

  const isGenerating = ['submitting', 'queued', 'processing'].includes(genMode);
  const canGenerate = prompt.trim().length > 0 && currentImageUrl !== null;
  const hasLastFrameOptions = lastFrameOptions.length > 0;

  // Show the motion prompt / duration / Rift toggle / footer Generate button
  // ONLY when we have a source image ready. For prompt mode, this means after
  // the user has clicked "Use This Image" (promptCommitted=true). Until then,
  // the prompt tab's inline controls drive the flow.
  const promptNeedsImageStep = sourceType === 'prompt' && !promptCommitted;
  const showMotionSection = !promptNeedsImageStep;

  // Header label helpers
  const headerLabel = () => {
    if (genMode === 'completed') return '🎬 Clip Generated';
    if (isGenerating) return `Rendering · ${genProgress}%`;
    if (outOfCredits) return 'Out of Credits';
    if (chatMode === 'asking' || chatMode === 'refining') return 'Talking with Rift';
    if (chatMode === 'done') return 'Refined Prompt Ready';
    if (isRegenerating) return `Regenerate clip ${editingClip!.clip_order}`;
    return `Clip ${nextClipNumber}`;
  };

  const headerTitle = () => {
    if (genMode === 'completed') return 'Clip added to scene';
    if (isGenerating) return 'Creating your clip...';
    if (outOfCredits) return 'You need more credits';
    if (chatMode === 'done') return 'Review your prompt';
    if (isRegenerating) return `Edit clip ${editingClip!.clip_order}`;
    return `Generate clip ${nextClipNumber}`;
  };

  const headerSubtitle = () => {
    if (genMode === 'completed') return 'It is now in your scene timeline.';
    if (isGenerating) return 'You can close this — generation continues in background.';
    if (outOfCredits) return `You have ${credits} credit${credits === 1 ? '' : 's'} but need at least 1.`;
    if (chatMode === 'done') return 'Edit the prompt below before generating.';
    if (isRegenerating) return 'Tweak the prompt, source, or duration — then regenerate in place.';
    return 'Pick source image, describe motion, generate.';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#1f2937] bg-[#0a0a0b] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-purple-500/20 blur-[80px] opacity-50 pointer-events-none" />

        <div className="relative p-6 md:p-8">
          {/* HEADER */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-2">
                <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
                {headerLabel()}
              </div>
              <h2 className="text-[22px] font-semibold text-white tracking-tight">
                {headerTitle()}
              </h2>
              <p className="text-[13px] text-zinc-400 mt-1">
                {headerSubtitle()}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
            >
              <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
            </button>
          </div>

          {/* OUT OF CREDITS */}
          {outOfCredits && (
            <div className="mb-5 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.04] p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
                <Zap className="w-6 h-6 text-amber-300" strokeWidth={1.75} />
              </div>
              <div className="text-[15px] font-semibold text-white mb-2">Out of credits</div>
              <div className="text-[13px] text-zinc-400 mb-5 max-w-sm mx-auto">
                You used all {profile?.credits_lifetime_used ?? 0} of your free credits.
              </div>
              <div className="flex items-center justify-center gap-2">
                <button onClick={handleClose} className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors">
                  Maybe later
                </button>
                <button
                  onClick={() => alert('Payments coming soon! 🚀')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-[13px] font-semibold shadow-lg shadow-amber-500/30 transition-all"
                >
                  <Zap className="w-3.5 h-3.5" strokeWidth={2.25} />
                  Get more credits
                </button>
              </div>
            </div>
          )}

          {/* COMPLETED */}
          {genMode === 'completed' && (
            <div className="mb-5 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] to-purple-500/[0.04] p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                <Check className="w-6 h-6 text-emerald-300" strokeWidth={2.5} />
              </div>
              <div className="text-[15px] font-semibold text-white mb-2">
                {isRegenerating
                  ? `Clip ${editingClip!.clip_order} regenerated`
                  : `Clip ${nextClipNumber} is ready`}
              </div>
              <div className="text-[13px] text-zinc-400 max-w-sm mx-auto">
                Closing automatically. Your clip is now in the scene timeline.
              </div>
            </div>
          )}

          {/* RENDERING */}
          {isGenerating && (
            <div className="mb-5">
              <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.04] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/20">
                    <Film className="w-5 h-5 text-purple-300 animate-pulse" strokeWidth={1.75} />
                  </div>
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold text-white mb-0.5">
                      {genMode === 'submitting' ? 'Saving and submitting...' : genMode === 'queued' ? 'In queue...' : 'Rendering your clip...'}
                    </div>
                    <div className="text-[11px] text-zinc-400">AI is creating frame by frame</div>
                  </div>
                  <div className="text-[20px] font-bold text-purple-300 tabular-nums">{genProgress}%</div>
                </div>
                <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden mb-4">
                  <div className="h-full bg-gradient-to-r from-purple-400 to-blue-400 rounded-full transition-all duration-500" style={{ width: `${genProgress}%` }} />
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Clock className="w-3 h-3" strokeWidth={2} />
                  <span>~{duration === 5 ? '45' : '75'} seconds total. Close this — it keeps going.</span>
                </div>
              </div>
            </div>
          )}

          {/* FAILED */}
          {genMode === 'failed' && (
            <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/[0.05] p-5 text-center">
              <div className="text-[14px] font-medium text-rose-200 mb-1">Generation failed</div>
              <div className="text-[12px] text-zinc-400 mb-2">{genError}</div>
              <div className="text-[11px] text-emerald-300 mb-4 flex items-center justify-center gap-1">
                <Check className="w-3 h-3" strokeWidth={2.5} />
                Credits refunded automatically
              </div>
              <div className="flex items-center justify-center gap-2">
                <button onClick={handleGenerate} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold transition-all">
                  <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.25} />
                  Try again
                </button>
                <button onClick={handleClose} className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors">
                  Close
                </button>
              </div>
            </div>
          )}

          {/* MAIN FORM */}
          {!isGenerating && genMode !== 'completed' && genMode !== 'failed' && !outOfCredits && (
            <>
              {/* Source picker (Upload / Chain / Generate / URL) */}
              {(chatMode === 'idle' || chatMode === 'done') && (
                <div className="mb-5">
                  <label className="block text-[12px] font-medium text-zinc-300 mb-2">Source Image</label>
                  <div className="grid grid-cols-4 gap-1.5 mb-3">
                    <button
                      onClick={() => setSourceType('upload')}
                      className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all ${
                        sourceType === 'upload'
                          ? 'bg-purple-500/15 text-purple-200 border border-purple-500/30'
                          : 'bg-white/[0.02] text-zinc-400 border border-[#1f2937] hover:bg-white/[0.04]'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" strokeWidth={2} />
                      Upload
                    </button>
                    <button
                      onClick={() => setSourceType('last_frame')}
                      disabled={!hasLastFrameOptions}
                      className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all ${
                        sourceType === 'last_frame'
                          ? 'bg-purple-500/15 text-purple-200 border border-purple-500/30'
                          : 'bg-white/[0.02] text-zinc-400 border border-[#1f2937] hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <Link2 className="w-3.5 h-3.5" strokeWidth={2} />
                        {hasLastFrameOptions && (
                          <span className="text-[9px] font-bold px-1 py-0 rounded bg-purple-500/30 text-purple-100">
                            {lastFrameOptions.length}
                          </span>
                        )}
                      </div>
                      Chain
                    </button>
                    <button
                      onClick={() => setSourceType('prompt')}
                      className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all ${
                        sourceType === 'prompt'
                          ? 'bg-purple-500/15 text-purple-200 border border-purple-500/30'
                          : 'bg-white/[0.02] text-zinc-400 border border-[#1f2937] hover:bg-white/[0.04]'
                      }`}
                    >
                      <Wand2 className="w-3.5 h-3.5" strokeWidth={2} />
                      Generate
                    </button>
                    <button
                      onClick={() => setSourceType('url')}
                      className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all ${
                        sourceType === 'url'
                          ? 'bg-purple-500/15 text-purple-200 border border-purple-500/30'
                          : 'bg-white/[0.02] text-zinc-400 border border-[#1f2937] hover:bg-white/[0.04]'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5" strokeWidth={2} />
                      URL
                    </button>
                  </div>

                  {/* ====== UPLOAD TAB ====== */}
                  {sourceType === 'upload' && (
                    <>
                      {previewUrl ? (
                        <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.03] p-3">
                          <div className="flex items-center gap-3">
                            <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-white/[0.08] shrink-0 bg-[#050505]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <Check className="w-3 h-3 text-emerald-400" strokeWidth={2.5} />
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Ready</span>
                              </div>
                              <div className="text-[13px] font-medium text-white truncate">
                                {selectedFile ? selectedFile.name : 'Uploaded image'}
                              </div>
                              {selectedFile && (
                                <div className="text-[11px] text-zinc-500">
                                  {formatFileSize(selectedFile.size)} · {selectedFile.type.split('/')[1].toUpperCase()}
                                </div>
                              )}
                            </div>
                            <button onClick={handleRemoveFile} className="p-2 rounded-lg hover:bg-rose-500/10 hover:text-rose-300 text-zinc-500 transition-colors shrink-0">
                              <X className="w-4 h-4" strokeWidth={2} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="block relative border-2 border-dashed border-[#1f2937] hover:border-purple-500/40 rounded-xl p-6 cursor-pointer transition-all bg-white/[0.01] hover:bg-purple-500/[0.02] group">
                          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" className="hidden" onChange={handleFileChange} />
                          <div className="flex flex-col items-center text-center">
                            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                              <Upload className="w-4 h-4 text-purple-300" strokeWidth={2} />
                            </div>
                            <div className="text-[13px] font-semibold text-white mb-0.5">Click to upload</div>
                            <div className="text-[11px] text-zinc-500">PNG · JPG · WebP · Max 10MB</div>
                          </div>
                        </label>
                      )}
                      {fileError && (
                        <div className="mt-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-300">
                          {fileError}
                        </div>
                      )}
                    </>
                  )}

                  {/* ====== CHAIN TAB ====== */}
                  {sourceType === 'last_frame' && (
                    <>
                      {!hasLastFrameOptions ? (
                        <div className="rounded-xl border border-[#1f2937] bg-white/[0.02] p-6 text-center">
                          <Link2 className="w-8 h-8 text-zinc-600 mx-auto mb-2" strokeWidth={1.5} />
                          <div className="text-[13px] font-semibold text-zinc-400 mb-1">No clips to chain from</div>
                          <div className="text-[11px] text-zinc-500">Generate at least one clip first.</div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[11px] text-zinc-500 mb-2">Continue from the last frame of:</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[200px] overflow-y-auto">
                            {lastFrameOptions.map((opt) => (
                              <button
                                key={opt.clipId}
                                onClick={() => setSelectedLastFrameClipId(opt.clipId)}
                                className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                                  selectedLastFrameClipId === opt.clipId
                                    ? 'border-purple-400 shadow-lg shadow-purple-500/30'
                                    : 'border-[#1f2937] hover:border-[#2d3748]'
                                }`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={opt.lastFrameUrl} alt={`Clip ${opt.clipNumber}`} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                                <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md text-[9px] font-bold text-white">
                                  Clip {opt.clipNumber}
                                </div>
                                {selectedLastFrameClipId === opt.clipId && (
                                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-purple-500 border-2 border-white flex items-center justify-center">
                                    <Check className="w-2 h-2 text-white" strokeWidth={3} />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* ====== GENERATE FROM PROMPT TAB ====== */}
                  {sourceType === 'prompt' && (
                    <>
                      {/* PHASE A: Aspect detection or picker (only when not committed yet) */}
                      {!promptCommitted && !selectedAspect && (
                        <>
                          {aspectDetecting ? (
                            <div className="rounded-xl border border-[#1f2937] bg-white/[0.02] p-6 flex flex-col items-center text-center">
                              <Loader2 className="w-6 h-6 text-purple-400 animate-spin mb-2" strokeWidth={2} />
                              <div className="text-[13px] font-medium text-white mb-1">Detecting scene shape...</div>
                              <div className="text-[11px] text-zinc-500">Matching the shape of your existing clips</div>
                            </div>
                          ) : (
                            <>
                              <div className="mb-2 text-[11px] text-zinc-400">
                                Pick the shape for this scene. All clips will use it.
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                {([
                                  { key: '9:16' as const, icon: Smartphone, title: '9:16', sub: 'Vertical', use: 'Shorts · Reels · TikTok' },
                                  { key: '16:9' as const, icon: Monitor, title: '16:9', sub: 'Horizontal', use: 'YouTube · TV · Cinema' },
                                  { key: '1:1' as const, icon: SquareIcon, title: '1:1', sub: 'Square', use: 'Instagram feed' },
                                ]).map((opt) => {
                                  const Icon = opt.icon;
                                  return (
                                    <button
                                      key={opt.key}
                                      onClick={() => setSelectedAspect(opt.key)}
                                      className="relative rounded-xl border border-[#1f2937] bg-white/[0.02] hover:bg-white/[0.04] hover:border-[#2d3748] p-3 text-left transition-all"
                                    >
                                      <Icon className="w-5 h-5 mb-1.5 text-zinc-400" strokeWidth={1.75} />
                                      <div className="text-[13px] font-semibold text-white">{opt.title}</div>
                                      <div className="text-[10px] text-zinc-400">{opt.sub}</div>
                                      <div className="text-[9px] text-zinc-500 mt-0.5 line-clamp-1">{opt.use}</div>
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </>
                      )}

                      {/* PHASE B: Prompt entry (aspect picked, no image generated yet) */}
                      {!promptCommitted && selectedAspect && !promptGeneratedImageUrl && !promptImageGenerating && !isDetectingCharacters && (
                        <>
                          {/* Aspect chip */}
                          <div className="mb-3 flex items-center gap-2">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/25 text-[10px] font-semibold text-purple-200">
                              {selectedAspect === '9:16' && <Smartphone className="w-3 h-3" strokeWidth={2} />}
                              {selectedAspect === '16:9' && <Monitor className="w-3 h-3" strokeWidth={2} />}
                              {selectedAspect === '1:1' && <SquareIcon className="w-3 h-3" strokeWidth={2} />}
                              {selectedAspect}
                            </div>
                            {sceneAspectRatio || firstExistingClipImageUrl ? (
                              <span className="text-[10px] text-zinc-500">Locked — matches your scene</span>
                            ) : (
                              <button
                                onClick={() => setSelectedAspect(null)}
                                className="text-[10px] text-purple-300 hover:text-purple-200 transition-colors"
                              >
                                Change
                              </button>
                            )}
                          </div>

                          {/* Image prompt textarea */}
                          <textarea
                            value={imagePrompt}
                            onChange={(e) => {
                              setImagePrompt(e.target.value);
                              if (promptImageError) setPromptImageError(null);
                            }}
                            rows={4}
                            placeholder="A young Nigerian woman in traditional attire dancing at sunset on a Lagos beach..."
                            className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all resize-none"
                          />

                          {promptImageError && (
                            <div className="mt-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-300">
                              {promptImageError}
                            </div>
                          )}

                          {/* Inline Generate Image button (this is the active action — not the footer) */}
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                              <UserSquare2 className="w-3 h-3 text-purple-300" strokeWidth={2} />
                              <span>Mention an avatar by name for character consistency</span>
                            </div>
                            <button
                              onClick={handlePromptGenerateImage}
                              disabled={!imagePrompt.trim() || imagePrompt.trim().length < 5}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[12px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ImageIcon className="w-3.5 h-3.5" strokeWidth={2.25} />
                              Generate Image
                            </button>
                          </div>

                          {promptRegenCount > 0 && (
                            <div className="mt-2 text-[10px] text-amber-300">
                              {promptRegenCount} regeneration{promptRegenCount > 1 ? 's' : ''} this session
                            </div>
                          )}
                        </>
                      )}

                      {/* PHASE B.5 — 4.3.5c — Detecting characters (brief — covered by modal if needed) */}
                      {!promptCommitted && isDetectingCharacters && (
                        <div className="rounded-xl border border-[#1f2937] bg-white/[0.02] p-6 flex flex-col items-center text-center">
                          <Loader2 className="w-7 h-7 text-purple-400 animate-spin mb-2" strokeWidth={2} />
                          <div className="text-[13px] font-medium text-white mb-1">🔍 Recognizing your cast...</div>
                          <div className="text-[11px] text-zinc-500">A moment to spot any characters in your prompt</div>
                        </div>
                      )}

                      {/* PHASE C: Image generating (spinner) */}
                      {!promptCommitted && promptImageGenerating && (
                        <div className="rounded-xl border border-[#1f2937] bg-white/[0.02] p-8 flex flex-col items-center text-center">
                          <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-3" strokeWidth={2} />
                          <div className="text-[14px] font-medium text-white mb-1">✨ Creating your image...</div>
                          <div className="text-[12px] text-zinc-500">This usually takes 15-45 seconds</div>
                        </div>
                      )}

                      {/* PHASE D: Image ready, awaiting commit (Regenerate / Use This Image) */}
                      {!promptCommitted && !promptImageGenerating && !isDetectingCharacters && promptGeneratedImageUrl && (
                        <>
                          {/* Top chips */}
                          <div className="mb-3 flex items-center gap-2">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/25 text-[10px] font-semibold text-purple-200">
                              {selectedAspect === '9:16' && <Smartphone className="w-3 h-3" strokeWidth={2} />}
                              {selectedAspect === '16:9' && <Monitor className="w-3 h-3" strokeWidth={2} />}
                              {selectedAspect === '1:1' && <SquareIcon className="w-3 h-3" strokeWidth={2} />}
                              {selectedAspect}
                            </div>
                            {promptImageMode && (
                              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold ${
                                promptImageMode === 'avatar'
                                  ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-200'
                                  : 'bg-blue-500/15 border border-blue-500/25 text-blue-200'
                              }`}>
                                {promptImageMode === 'avatar' ? (
                                  <>
                                    <UserSquare2 className="w-2.5 h-2.5" strokeWidth={2.5} />
                                    Avatar-consistent
                                  </>
                                ) : (
                                  <>
                                    <Zap className="w-2.5 h-2.5" strokeWidth={2.5} />
                                    Text-to-image
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Image preview */}
                          <div className={`relative ${aspectClassFor(selectedAspect)} max-h-[360px] w-full rounded-xl overflow-hidden border border-purple-500/30 bg-black mb-3`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={promptGeneratedImageUrl}
                              alt="Generated starting image"
                              className="w-full h-full object-contain"
                            />
                          </div>

                          {/* Your prompt preview */}
                          <div className="mb-3 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                            <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">Your prompt</div>
                            <div className="text-[12px] text-zinc-300 leading-relaxed line-clamp-2">{imagePrompt}</div>
                          </div>

                          {/* Action buttons */}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={handlePromptRegenerate}
                              className="flex items-center justify-center gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] hover:bg-amber-500/10 active:scale-[0.98] transition-all"
                            >
                              <RefreshCw className="w-4 h-4 text-amber-300 shrink-0" strokeWidth={2} />
                              <div className="text-left">
                                <div className="text-[12px] font-semibold text-white">Regenerate</div>
                                <div className="text-[10px] text-zinc-400">New image · 1–3 credits</div>
                              </div>
                            </button>
                            <button
                              onClick={handlePromptUseImage}
                              className="flex items-center justify-center gap-2 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] hover:bg-emerald-500/10 active:scale-[0.98] transition-all"
                            >
                              <Check className="w-4 h-4 text-emerald-300 shrink-0" strokeWidth={2.5} />
                              <div className="text-left">
                                <div className="text-[12px] font-semibold text-white">Use This Image</div>
                                <div className="text-[10px] text-zinc-400">Continue to motion</div>
                              </div>
                            </button>
                          </div>

                          {promptRegenCount > 0 && (
                            <div className="mt-2 text-[10px] text-amber-300 text-center">
                              {promptRegenCount} regeneration{promptRegenCount > 1 ? 's' : ''} this session
                            </div>
                          )}
                        </>
                      )}

                      {/* PHASE E: Committed — collapsed "Ready" card (image is now the source) */}
                      {promptCommitted && promptGeneratedImageUrl && (
                        <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.03] p-3">
                          <div className="flex items-center gap-3">
                            <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-white/[0.08] shrink-0 bg-[#050505]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={promptGeneratedImageUrl} alt="Generated source" className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <Check className="w-3 h-3 text-emerald-400" strokeWidth={2.5} />
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Ready</span>
                              </div>
                              <div className="text-[13px] font-medium text-white truncate">AI-generated image</div>
                              <div className="text-[11px] text-zinc-500 truncate">
                                {selectedAspect} · {promptImageMode === 'avatar' ? 'Avatar-consistent' : 'Text-to-image'}
                              </div>
                            </div>
                            <button
                              onClick={handlePromptUncommit}
                              className="p-2 rounded-lg hover:bg-rose-500/10 hover:text-rose-300 text-zinc-500 transition-colors shrink-0"
                              title="Go back to image review"
                            >
                              <X className="w-4 h-4" strokeWidth={2} />
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* ====== URL TAB ====== */}
                  {sourceType === 'url' && (
                    <>
                      {urlPreviewUrl ? (
                        <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.03] p-3">
                          <div className="flex items-center gap-3">
                            <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-white/[0.08] shrink-0 bg-[#050505]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={urlPreviewUrl} alt="URL preview" className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <Check className="w-3 h-3 text-emerald-400" strokeWidth={2.5} />
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Loaded</span>
                              </div>
                              <div className="text-[12px] font-medium text-white truncate" title={urlPreviewUrl}>
                                {urlPreviewUrl}
                              </div>
                              <div className="text-[10px] text-zinc-500">External image URL</div>
                            </div>
                            <button onClick={handleUrlRemove} className="p-2 rounded-lg hover:bg-rose-500/10 hover:text-rose-300 text-zinc-500 transition-colors shrink-0">
                              <X className="w-4 h-4" strokeWidth={2} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="rounded-xl border-2 border-dashed border-[#1f2937] hover:border-purple-500/40 bg-white/[0.01] hover:bg-purple-500/[0.02] p-5 transition-all">
                            <div className="flex flex-col items-center text-center mb-3">
                              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-2">
                                <Globe className="w-4 h-4 text-purple-300" strokeWidth={2} />
                              </div>
                              <div className="text-[13px] font-semibold text-white mb-0.5">Paste an image or page URL</div>
                              <div className="text-[11px] text-zinc-500">
                                Direct image link, or any page — we&apos;ll find the image.
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <input
                                ref={urlInputRef}
                                type="url"
                                value={urlInput}
                                onChange={(e) => { setUrlInput(e.target.value); if (urlError) setUrlError(null); }}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !urlLoading) { e.preventDefault(); handleUrlLoad(); } }}
                                placeholder="https://example.com/photo.jpg"
                                disabled={urlLoading}
                                className="flex-1 px-3 py-2.5 bg-white/[0.04] border border-[#1f2937] rounded-lg text-[13px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.06] transition-all disabled:opacity-50"
                              />
                              <button
                                onClick={handleUrlLoad}
                                disabled={!urlInput.trim() || urlLoading}
                                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
                              >
                                {urlLoading ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2.25} />
                                ) : (
                                  <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                                )}
                                Load
                              </button>
                            </div>
                          </div>
                          {urlError && (
                            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-300">
                              {urlError}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Motion prompt section. Hidden while prompt tab is in image-pick phase. */}
              {showMotionSection && (
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[12px] font-medium text-zinc-300">
                      {chatMode === 'asking' || chatMode === 'refining' ? 'Rift Assistant' : 'Motion Prompt'}
                    </label>
                    {chatMode === 'asking' && (
                      <button onClick={handleRestart} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-purple-300 transition-colors">
                        <RefreshCw className="w-3 h-3" strokeWidth={2} />
                        Start over
                      </button>
                    )}
                  </div>

                  {(chatMode === 'idle' || chatMode === 'done') && (
                    <>
                      {chatMode === 'done' && finalAcknowledgment && (
                        <div className="mb-3 flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.04] border border-purple-500/20">
                          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                            <Sparkles className="w-3 h-3 text-white" strokeWidth={2} />
                          </div>
                          <div className="flex-1 text-[13px] text-zinc-200 leading-relaxed">
                            {finalAcknowledgment}
                          </div>
                        </div>
                      )}
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={chatMode === 'done' ? 5 : 3}
                        placeholder={aiOptimization ? 'Describe what should happen in this clip...' : 'Write your full cinematic prompt here...'}
                        className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all resize-none"
                      />
                    </>
                  )}

                  {chatMode === 'refining' && (
                    <div className="rounded-xl border border-[#1f2937] bg-white/[0.02] p-8 flex flex-col items-center text-center">
                      <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-3" strokeWidth={2} />
                      <div className="text-[14px] font-medium text-white mb-1">
                        {step === 0
                          ? '👁️ Rift is studying your scene...'
                          : step >= totalSteps
                          ? '✨ Crafting your cinematic prompt...'
                          : 'Thinking about your next question...'}
                      </div>
                      <div className="text-[12px] text-zinc-500">A real director takes a moment to look</div>
                    </div>
                  )}

                  {chatMode === 'asking' && currentQuestion && (
                    <div className="space-y-3">
                      {step === 0 && sceneAcknowledgment && (
                        <div className="flex items-start gap-3 p-4 rounded-xl bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.04] border border-purple-500/25">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/30">
                            <Eye className="w-4 h-4 text-white" strokeWidth={2} />
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-300 mb-1">Rift saw your scene</div>
                            <div className="text-[13px] text-zinc-200 leading-relaxed">{sceneAcknowledgment}</div>
                          </div>
                        </div>
                      )}
                      {step > 0 && currentQuestion.acknowledgmentBeforeQuestion && (
                        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                          <div className="w-6 h-6 rounded-md bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0 mt-0.5">
                            <Check className="w-3 h-3 text-purple-300" strokeWidth={2.5} />
                          </div>
                          <div className="text-[13px] text-zinc-300 leading-relaxed italic">{currentQuestion.acknowledgmentBeforeQuestion}</div>
                        </div>
                      )}
                      <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.03] p-5">
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/30">
                            <Sparkles className="w-4 h-4 text-white" strokeWidth={2} />
                          </div>
                          <div className="flex-1 pt-1">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-300">Rift Assistant</div>
                              <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                                <MessageCircle className="w-2.5 h-2.5" strokeWidth={2} />
                                <span>{step + 1} of {totalSteps}</span>
                              </div>
                            </div>
                            <div className="text-[15px] font-medium text-white leading-snug">{currentQuestion.question}</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          {currentQuestion.options.map((option, idx) => (
                            <button key={idx} onClick={() => handleAnswer(option)} className="text-left px-3 py-2.5 rounded-lg bg-white/[0.04] hover:bg-purple-500/15 border border-white/[0.06] hover:border-purple-500/40 text-[13px] font-medium text-zinc-200 hover:text-white transition-all hover:-translate-y-0.5">
                              {option}
                            </button>
                          ))}
                        </div>
                        {!showCustomInput ? (
                          <button onClick={() => setShowCustomInput(true)} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-dashed border-white/[0.08] hover:border-purple-500/30 text-[12px] font-medium text-zinc-400 hover:text-white transition-all">
                            <span>✏️</span> Or type your own
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <input ref={customInputRef} type="text" value={customAnswer} onChange={(e) => setCustomAnswer(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()} placeholder="Type your answer..." className="flex-1 px-3 py-2 bg-white/[0.04] border border-purple-500/30 rounded-lg text-[13px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/60 transition-all" />
                            <button onClick={handleCustomSubmit} disabled={!customAnswer.trim()} className="px-3 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                              <Check className="w-4 h-4" strokeWidth={2.5} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {chatMode === 'error' && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.05] p-5 text-center">
                      <div className="text-[14px] font-medium text-rose-200 mb-1">Rift couldn&apos;t respond</div>
                      <div className="text-[12px] text-zinc-400 mb-4">{error}</div>
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={handleRiftRetry} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold transition-all">
                          <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.25} />
                          Try again
                        </button>
                        <button onClick={handleRestart} className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors">Cancel</button>
                      </div>
                    </div>
                  )}

                  {error && chatMode !== 'error' && (
                    <div className="mt-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-300">{error}</div>
                  )}
                </div>
              )}

              {/* Duration + Rift toggle. Same hide rule as motion section. */}
              {showMotionSection && (chatMode === 'idle' || chatMode === 'done') && (
                <>
                  <div className="mb-5">
                    <label className="block text-[12px] font-medium text-zinc-300 mb-2">Clip Length</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setDuration(5)}
                        className={`relative rounded-xl border p-3 text-left transition-all ${
                          duration === 5
                            ? 'border-purple-500/40 bg-gradient-to-br from-purple-500/[0.1] to-blue-500/[0.04]'
                            : 'border-[#1f2937] bg-white/[0.02] hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <Clock className={`w-3.5 h-3.5 ${duration === 5 ? 'text-purple-300' : 'text-zinc-500'}`} strokeWidth={2} />
                            <span className="text-[13px] font-semibold text-white">5 seconds</span>
                          </div>
                          {duration === 5 && <Check className="w-3.5 h-3.5 text-purple-300" strokeWidth={2.5} />}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                          <Zap className="w-2.5 h-2.5 text-amber-400 fill-amber-400/50" />
                          <span><span className="text-zinc-300 font-medium">1 credit</span></span>
                        </div>
                      </button>
                      <button
                        onClick={() => setDuration(10)}
                        className={`relative rounded-xl border p-3 text-left transition-all ${
                          duration === 10
                            ? 'border-purple-500/40 bg-gradient-to-br from-purple-500/[0.1] to-blue-500/[0.04]'
                            : 'border-[#1f2937] bg-white/[0.02] hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <Clock className={`w-3.5 h-3.5 ${duration === 10 ? 'text-purple-300' : 'text-zinc-500'}`} strokeWidth={2} />
                            <span className="text-[13px] font-semibold text-white">10 seconds</span>
                          </div>
                          {duration === 10 && <Check className="w-3.5 h-3.5 text-purple-300" strokeWidth={2.5} />}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                          <Zap className="w-2.5 h-2.5 text-amber-400 fill-amber-400/50" />
                          <span><span className="text-zinc-300 font-medium">2 credits</span></span>
                        </div>
                      </button>
                    </div>
                  </div>

                  {chatMode === 'idle' && (
                    <div className={`relative rounded-xl border p-3 mb-5 transition-all ${
                      aiOptimization
                        ? 'border-purple-500/30 bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.03]'
                        : 'border-[#1f2937] bg-white/[0.02]'
                    }`}>
                      <div className="relative flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                          aiOptimization
                            ? 'bg-purple-500/20 border border-purple-500/30 shadow-lg shadow-purple-500/20'
                            : 'bg-white/[0.04] border border-white/[0.06]'
                        }`}>
                          <Wand2 className={`w-3.5 h-3.5 ${aiOptimization ? 'text-purple-300' : 'text-zinc-500'}`} strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-semibold text-white">Rift Assistant</div>
                          <p className="text-[10px] text-zinc-400">
                            {aiOptimization ? 'AI sees your scene & refines your prompt' : 'Skip AI — type prompt directly'}
                          </p>
                        </div>
                        <button
                          onClick={() => setAiOptimization(!aiOptimization)}
                          className={`relative w-10 h-5 rounded-full transition-all shrink-0 ${
                            aiOptimization ? 'bg-gradient-to-r from-purple-500 to-purple-400' : 'bg-white/[0.08]'
                          }`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${
                            aiOptimization ? 'translate-x-5' : ''
                          }`} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* FOOTER ACTIONS */}
          {!isGenerating && genMode !== 'completed' && genMode !== 'failed' && !outOfCredits && (
            <div className="flex items-center justify-between pt-4 border-t border-[#141821] gap-3">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400/50" />
                <span>
                  <span className="text-zinc-300 font-medium">{requiredCredits} credit{requiredCredits > 1 ? 's' : ''}</span> · {credits} available
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* When in prompt tab and image not committed yet, the inline
                    "Generate Image" / "Use This Image" buttons drive the flow.
                    Footer only shows Cancel here. */}
                {promptNeedsImageStep && (
                  <button onClick={handleClose} className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors">
                    Cancel
                  </button>
                )}

                {!promptNeedsImageStep && chatMode === 'idle' && (
                  <>
                    <button onClick={handleClose} className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={aiOptimization ? handleStartRift : handleGenerate}
                      disabled={aiOptimization ? !prompt.trim() || !currentImageUrl : !canGenerate}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Wand2 className="w-3.5 h-3.5" strokeWidth={2.25} />
                      {isRegenerating
                        ? (aiOptimization ? 'Regenerate with Rift' : 'Regenerate Clip')
                        : (aiOptimization ? 'Generate with Rift' : 'Generate Clip')}
                    </button>
                  </>
                )}

                {!promptNeedsImageStep && (chatMode === 'asking' || chatMode === 'refining') && (
                  <button onClick={handleRestart} className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors">
                    Cancel
                  </button>
                )}

                {!promptNeedsImageStep && chatMode === 'done' && (
                  <>
                    <button onClick={handleRestart} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors">
                      <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
                      Back
                    </button>
                    <button
                      onClick={handleGenerate}
                      disabled={!canGenerate}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" strokeWidth={0} />
                      {isRegenerating ? 'Regenerate Clip' : 'Generate Clip'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {isGenerating && (
            <div className="flex justify-end pt-4 border-t border-[#141821]">
              <button onClick={handleClose} className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors">
                Close (keeps rendering)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ====================================================================
          4.3.5c — UNKNOWN CHARACTERS MODAL (renders ABOVE this modal at z-60)
          ==================================================================== */}
      <UnknownCharactersModal
        open={showUnknownsModal}
        detectedCharacters={detectedCharacters}
        avatars={avatars}
        onClose={handleUnknownsClose}
        onAllResolved={handleUnknownsResolved}
        onAtLimit={handleAvatarLimitReached}
      />
    </div>
  );
}