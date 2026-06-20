'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Sparkles, Upload, Link2, Library, Loader2, Check, Wand2,
  RefreshCw, Clock, Film, Zap, Play, Eye, MessageCircle,
  ArrowLeft, Globe,
} from 'lucide-react';

type ChatMode = 'idle' | 'asking' | 'refining' | 'done' | 'error';
type GenerationMode = 'idle' | 'submitting' | 'queued' | 'processing' | 'completed' | 'failed';
// CHUNK 1 (Bug 2): added 'url' as a source type. Was: 'upload' | 'last_frame' | 'library'.
type SourceType = 'upload' | 'last_frame' | 'library' | 'url';

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

interface LibraryItem {
  id: string;
  source_image_url: string;
  title: string | null;
  created_at: string;
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
  // When parent opens the modal via the action sheet, it tells us
  // which tab to pre-select. Default = 'upload' for backwards compat.
  initialSourceType?: SourceType;
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

// CHUNK 1.5: lightweight client-side URL syntax check before we even hit the
// proxy. Anything more (gallery page resolution, image verification) is now
// handled server-side in /api/utils/resolve-image-url.
function isHttpUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
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
}: ClipGenerationModalProps) {
  // Source picker state — seeded from initialSourceType so the modal opens
  // on the tab matching the user's action sheet pick.
  const [sourceType, setSourceType] = useState<SourceType>(initialSourceType);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedLastFrameClipId, setSelectedLastFrameClipId] = useState<string | null>(null);
  const [selectedLibraryItem, setSelectedLibraryItem] = useState<LibraryItem | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // CHUNK 1 (Bug 2): URL source state.
  // - urlInput: what's typed in the input field
  // - urlPreviewUrl: the URL successfully loaded as preview (null = not loaded yet)
  // - urlError: validation or load-failure message
  // - urlLoading: spinner state while we verify the URL by attempting to load it as an image
  const [urlInput, setUrlInput] = useState('');
  const [urlPreviewUrl, setUrlPreviewUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);

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

  // CHUNK 1 (Bug 2): getCurrentImageUrl now also handles 'url' source type.
  const getCurrentImageUrl = useCallback((): string | null => {
    if (sourceType === 'upload') return previewUrl;
    if (sourceType === 'last_frame') {
      const opt = lastFrameOptions.find((o) => o.clipId === selectedLastFrameClipId);
      return opt?.lastFrameUrl || null;
    }
    if (sourceType === 'library') return selectedLibraryItem?.source_image_url || null;
    if (sourceType === 'url') return urlPreviewUrl;
    return null;
  }, [sourceType, previewUrl, selectedLastFrameClipId, lastFrameOptions, selectedLibraryItem, urlPreviewUrl]);

  const currentImageUrl = getCurrentImageUrl();

  // Sync sourceType to initialSourceType whenever the modal opens.
  useEffect(() => {
    if (open) {
      setSourceType(initialSourceType);
    }
  }, [open, initialSourceType]);

  // Fetch library items when library tab is selected
  useEffect(() => {
    if (sourceType === 'library' && libraryItems.length === 0) {
      setLibraryLoading(true);
      fetch('/api/videos')
        .then((r) => r.json())
        .then((data) => {
          const items: LibraryItem[] = (data.videos || [])
            .filter((v: { source_image_url?: string }) => v.source_image_url)
            .slice(0, 30)
            .map((v: { id: string; source_image_url: string; title: string | null; created_at: string }) => ({
              id: v.id,
              source_image_url: v.source_image_url,
              title: v.title,
              created_at: v.created_at,
            }));
          setLibraryItems(items);
        })
        .catch(console.error)
        .finally(() => setLibraryLoading(false));
    }
  }, [sourceType, libraryItems.length]);

  // Auto-select most recent last-frame if available (when on Chain tab)
  useEffect(() => {
    if (sourceType === 'last_frame' && lastFrameOptions.length > 0 && !selectedLastFrameClipId) {
      setSelectedLastFrameClipId(lastFrameOptions[lastFrameOptions.length - 1].clipId);
    }
  }, [sourceType, lastFrameOptions, selectedLastFrameClipId]);

  // CHUNK 1 (Bug 2): auto-focus URL input when switching to URL tab
  useEffect(() => {
    if (sourceType === 'url' && !urlPreviewUrl) {
      // Slight delay so the input is mounted before focus call
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
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setSourceType(initialSourceType);
    setSelectedFile(null);
    if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setSelectedLastFrameClipId(null);
    setSelectedLibraryItem(null);
    setFileError(null);
    // CHUNK 1 (Bug 2): reset URL state on close
    setUrlInput('');
    setUrlPreviewUrl(null);
    setUrlError(null);
    setUrlLoading(false);
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

  // CHUNK 1.5: URL handlers now go through the server-side proxy at
  // /api/utils/resolve-image-url. The proxy:
  //   - HEAD-checks direct image URLs (fast path)
  //   - Fetches HTML pages and extracts og:image / twitter:image / first img tag
  //   - Returns a verified direct image URL we can pass straight to the clip endpoint
  //   - Returns rich error messages with hints when resolution fails
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
      // Success — proxy returned a verified direct image URL.
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
      const payload: Record<string, unknown> = {
        base_prompt: basePrompt || null,
        refined_prompt: prompt.trim(),
        rift_used: aiOptimization,
        rift_answers: answers.length > 0 ? answers : null,
        scene_description: imageDescription,
        duration,
        source_type: sourceType,
      };

      if (sourceType === 'upload') {
        if (selectedFile) {
          payload.source_image_base64 = await fileToBase64(selectedFile);
        } else if (previewUrl && previewUrl.startsWith('http')) {
          payload.source_image_url = previewUrl;
        }
      } else if (sourceType === 'last_frame') {
        payload.source_clip_id = selectedLastFrameClipId;
      } else if (sourceType === 'library') {
        payload.source_image_url = selectedLibraryItem?.source_image_url;
      } else if (sourceType === 'url') {
        // CHUNK 1 (Bug 2): URL flow sends source_image_url directly.
        // Backend already accepts this field for the upload-with-URL path —
        // we're reusing the same downstream contract.
        payload.source_image_url = urlPreviewUrl;
      }

      const createRes = await fetch(
        `/api/projects/${projectId}/scenes/${sceneId}/clips`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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

      onProfileUpdate();
      onClipCreated();

      const genRes = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: created.id,
          prompt: prompt.trim(),
          imageUrl: created.source_image_url,
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
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-2">
                <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
                {genMode === 'completed'
                  ? '🎬 Clip Generated'
                  : isGenerating
                  ? `Rendering · ${genProgress}%`
                  : outOfCredits
                  ? 'Out of Credits'
                  : chatMode === 'asking' || chatMode === 'refining'
                  ? 'Talking with Rift'
                  : chatMode === 'done'
                  ? 'Refined Prompt Ready'
                  : `Clip ${nextClipNumber}`}
              </div>
              <h2 className="text-[22px] font-semibold text-white tracking-tight">
                {genMode === 'completed'
                  ? 'Clip added to scene'
                  : isGenerating
                  ? 'Creating your clip...'
                  : outOfCredits
                  ? 'You need more credits'
                  : chatMode === 'done'
                  ? 'Review your prompt'
                  : `Generate clip ${nextClipNumber}`}
              </h2>
              <p className="text-[13px] text-zinc-400 mt-1">
                {genMode === 'completed'
                  ? 'It is now in your scene timeline.'
                  : isGenerating
                  ? 'You can close this — generation continues in background.'
                  : outOfCredits
                  ? `You have ${credits} credit${credits === 1 ? '' : 's'} but need ${requiredCredits}.`
                  : chatMode === 'done'
                  ? 'Edit the prompt below before generating.'
                  : 'Pick source image, describe motion, generate.'}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
            >
              <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
            </button>
          </div>

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

          {genMode === 'completed' && (
            <div className="mb-5 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] to-purple-500/[0.04] p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                <Check className="w-6 h-6 text-emerald-300" strokeWidth={2.5} />
              </div>
              <div className="text-[15px] font-semibold text-white mb-2">Clip {nextClipNumber} is ready</div>
              <div className="text-[13px] text-zinc-400 max-w-sm mx-auto">
                Closing automatically. Your clip is now in the scene timeline.
              </div>
            </div>
          )}

          {isGenerating && (
            <div className="mb-5">
              <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.04] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/20">
                    <Film className="w-5 h-5 text-purple-300 animate-pulse" strokeWidth={1.75} />
                  </div>
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold text-white mb-0.5">
                      {genMode === 'submitting'
                        ? 'Saving and submitting...'
                        : genMode === 'queued'
                        ? 'In queue...'
                        : 'Rendering your clip...'}
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      AI is creating frame by frame
                    </div>
                  </div>
                  <div className="text-[20px] font-bold text-purple-300 tabular-nums">
                    {genProgress}%
                  </div>
                </div>
                <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden mb-4">
                  <div
                    className="h-full bg-gradient-to-r from-purple-400 to-blue-400 rounded-full transition-all duration-500"
                    style={{ width: `${genProgress}%` }}
                  />
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Clock className="w-3 h-3" strokeWidth={2} />
                  <span>~{duration === 5 ? '45' : '75'} seconds total. Close this — it keeps going.</span>
                </div>
              </div>
            </div>
          )}

          {genMode === 'failed' && (
            <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/[0.05] p-5 text-center">
              <div className="text-[14px] font-medium text-rose-200 mb-1">Generation failed</div>
              <div className="text-[12px] text-zinc-400 mb-2">{genError}</div>
              <div className="text-[11px] text-emerald-300 mb-4 flex items-center justify-center gap-1">
                <Check className="w-3 h-3" strokeWidth={2.5} />
                Credits refunded automatically
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={handleGenerate}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.25} />
                  Try again
                </button>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {!isGenerating && genMode !== 'completed' && genMode !== 'failed' && !outOfCredits && (
            <>
              {(chatMode === 'idle' || chatMode === 'done') && (
                <div className="mb-5">
                  <label className="block text-[12px] font-medium text-zinc-300 mb-2">Source Image</label>
                  {/* CHUNK 1 (Bug 2): grid expanded from 3 → 4 columns to fit the URL tab */}
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
                      onClick={() => setSourceType('library')}
                      className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all ${
                        sourceType === 'library'
                          ? 'bg-purple-500/15 text-purple-200 border border-purple-500/30'
                          : 'bg-white/[0.02] text-zinc-400 border border-[#1f2937] hover:bg-white/[0.04]'
                      }`}
                    >
                      <Library className="w-3.5 h-3.5" strokeWidth={2} />
                      Library
                    </button>
                    {/* CHUNK 1 (Bug 2): NEW URL tab. Opens URL input UI. */}
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
                            <button
                              onClick={handleRemoveFile}
                              className="p-2 rounded-lg hover:bg-rose-500/10 hover:text-rose-300 text-zinc-500 transition-colors shrink-0"
                            >
                              <X className="w-4 h-4" strokeWidth={2} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="block relative border-2 border-dashed border-[#1f2937] hover:border-purple-500/40 rounded-xl p-6 cursor-pointer transition-all bg-white/[0.01] hover:bg-purple-500/[0.02] group">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp"
                            className="hidden"
                            onChange={handleFileChange}
                          />
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

                  {sourceType === 'last_frame' && (
                    <>
                      {!hasLastFrameOptions ? (
                        <div className="rounded-xl border border-[#1f2937] bg-white/[0.02] p-6 text-center">
                          <Link2 className="w-8 h-8 text-zinc-600 mx-auto mb-2" strokeWidth={1.5} />
                          <div className="text-[13px] font-semibold text-zinc-400 mb-1">
                            No clips to chain from
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            Generate at least one clip first.
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[11px] text-zinc-500 mb-2">
                            Continue from the last frame of:
                          </p>
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
                                <img
                                  src={opt.lastFrameUrl}
                                  alt={`Clip ${opt.clipNumber}`}
                                  className="w-full h-full object-cover"
                                />
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

                  {sourceType === 'library' && (
                    <>
                      {libraryLoading ? (
                        <div className="rounded-xl border border-[#1f2937] bg-white/[0.02] p-6 text-center">
                          <Loader2 className="w-6 h-6 text-purple-400 animate-spin mx-auto mb-2" />
                          <div className="text-[12px] text-zinc-400">Loading library...</div>
                        </div>
                      ) : libraryItems.length === 0 ? (
                        <div className="rounded-xl border border-[#1f2937] bg-white/[0.02] p-6 text-center">
                          <Library className="w-8 h-8 text-zinc-600 mx-auto mb-2" strokeWidth={1.5} />
                          <div className="text-[13px] font-semibold text-zinc-400">No library items yet</div>
                          <div className="text-[11px] text-zinc-500 mt-1">
                            Generate clips elsewhere to reuse their source images.
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[11px] text-zinc-500 mb-2">Reuse source from existing clips:</p>
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[200px] overflow-y-auto">
                            {libraryItems.map((item) => (
                              <button
                                key={item.id}
                                onClick={() => setSelectedLibraryItem(item)}
                                className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                                  selectedLibraryItem?.id === item.id
                                    ? 'border-purple-400 shadow-lg shadow-purple-500/30'
                                    : 'border-[#1f2937] hover:border-[#2d3748]'
                                }`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={item.source_image_url}
                                  alt={item.title || 'Library item'}
                                  className="w-full h-full object-cover"
                                />
                                {selectedLibraryItem?.id === item.id && (
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

                  {/* CHUNK 1 (Bug 2): URL source UI. Two states: input-empty (paste field + Load button) vs preview-loaded (image card + Remove). */}
                  {sourceType === 'url' && (
                    <>
                      {urlPreviewUrl ? (
                        // PREVIEW STATE: URL successfully loaded, show image card with Remove button
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
                            <button
                              onClick={handleUrlRemove}
                              className="p-2 rounded-lg hover:bg-rose-500/10 hover:text-rose-300 text-zinc-500 transition-colors shrink-0"
                              aria-label="Remove URL"
                            >
                              <X className="w-4 h-4" strokeWidth={2} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        // INPUT STATE: paste URL, Load button, errors below
                        <div className="space-y-2">
                          <div className="rounded-xl border-2 border-dashed border-[#1f2937] hover:border-purple-500/40 bg-white/[0.01] hover:bg-purple-500/[0.02] p-5 transition-all">
                            <div className="flex flex-col items-center text-center mb-3">
                              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-2">
                                <Globe className="w-4 h-4 text-purple-300" strokeWidth={2} />
                              </div>
                              <div className="text-[13px] font-semibold text-white mb-0.5">Paste an image or page URL</div>
                              <div className="text-[11px] text-zinc-500">
                                Direct image link, or any page (Pexels, Unsplash, etc.) — we&apos;ll find the image.
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <input
                                ref={urlInputRef}
                                type="url"
                                value={urlInput}
                                onChange={(e) => {
                                  setUrlInput(e.target.value);
                                  if (urlError) setUrlError(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !urlLoading) {
                                    e.preventDefault();
                                    handleUrlLoad();
                                  }
                                }}
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

              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[12px] font-medium text-zinc-300">
                    {chatMode === 'asking' || chatMode === 'refining' ? 'Rift Assistant' : 'Motion Prompt'}
                  </label>
                  {chatMode === 'asking' && (
                    <button
                      onClick={handleRestart}
                      className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-purple-300 transition-colors"
                    >
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
                      placeholder={
                        aiOptimization
                          ? 'Describe what should happen in this clip...'
                          : 'Write your full cinematic prompt here...'
                      }
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
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-300 mb-1">
                            Rift saw your scene
                          </div>
                          <div className="text-[13px] text-zinc-200 leading-relaxed">
                            {sceneAcknowledgment}
                          </div>
                        </div>
                      </div>
                    )}
                    {step > 0 && currentQuestion.acknowledgmentBeforeQuestion && (
                      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                        <div className="w-6 h-6 rounded-md bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0 mt-0.5">
                          <Check className="w-3 h-3 text-purple-300" strokeWidth={2.5} />
                        </div>
                        <div className="text-[13px] text-zinc-300 leading-relaxed italic">
                          {currentQuestion.acknowledgmentBeforeQuestion}
                        </div>
                      </div>
                    )}
                    <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.03] p-5">
                      <div className="flex items-start gap-3 mb-4">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/30">
                          <Sparkles className="w-4 h-4 text-white" strokeWidth={2} />
                        </div>
                        <div className="flex-1 pt-1">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-300">
                              Rift Assistant
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                              <MessageCircle className="w-2.5 h-2.5" strokeWidth={2} />
                              <span>
                                {step + 1} of {totalSteps}
                              </span>
                            </div>
                          </div>
                          <div className="text-[15px] font-medium text-white leading-snug">
                            {currentQuestion.question}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {currentQuestion.options.map((option, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleAnswer(option)}
                            className="text-left px-3 py-2.5 rounded-lg bg-white/[0.04] hover:bg-purple-500/15 border border-white/[0.06] hover:border-purple-500/40 text-[13px] font-medium text-zinc-200 hover:text-white transition-all hover:-translate-y-0.5"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                      {!showCustomInput ? (
                        <button
                          onClick={() => setShowCustomInput(true)}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-dashed border-white/[0.08] hover:border-purple-500/30 text-[12px] font-medium text-zinc-400 hover:text-white transition-all"
                        >
                          <span>✏️</span> Or type your own
                        </button>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            ref={customInputRef}
                            type="text"
                            value={customAnswer}
                            onChange={(e) => setCustomAnswer(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
                            placeholder="Type your answer..."
                            className="flex-1 px-3 py-2 bg-white/[0.04] border border-purple-500/30 rounded-lg text-[13px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/60 transition-all"
                          />
                          <button
                            onClick={handleCustomSubmit}
                            disabled={!customAnswer.trim()}
                            className="px-3 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                          >
                            <Check className="w-4 h-4" strokeWidth={2.5} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {chatMode === 'error' && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.05] p-5 text-center">
                    <div className="text-[14px] font-medium text-rose-200 mb-1">
                      Rift couldn&apos;t respond
                    </div>
                    <div className="text-[12px] text-zinc-400 mb-4">{error}</div>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={handleRiftRetry}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold transition-all"
                      >
                        <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.25} />
                        Try again
                      </button>
                      <button
                        onClick={handleRestart}
                        className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {error && chatMode !== 'error' && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-300">
                    {error}
                  </div>
                )}
              </div>

              {(chatMode === 'idle' || chatMode === 'done') && (
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

          {!isGenerating && genMode !== 'completed' && genMode !== 'failed' && !outOfCredits && (
            <div className="flex items-center justify-between pt-4 border-t border-[#141821] gap-3">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400/50" />
                <span>
                  <span className="text-zinc-300 font-medium">{requiredCredits} credit{requiredCredits > 1 ? 's' : ''}</span> · {credits} available
                </span>
              </div>
              <div className="flex items-center gap-2">
                {chatMode === 'idle' && (
                  <>
                    <button
                      onClick={handleClose}
                      className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={aiOptimization ? handleStartRift : handleGenerate}
                      disabled={aiOptimization ? !prompt.trim() || !currentImageUrl : !canGenerate}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Wand2 className="w-3.5 h-3.5" strokeWidth={2.25} />
                      {aiOptimization ? 'Generate with Rift' : 'Generate Clip'}
                    </button>
                  </>
                )}
                {(chatMode === 'asking' || chatMode === 'refining') && (
                  <button
                    onClick={handleRestart}
                    className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors"
                  >
                    Cancel
                  </button>
                )}
                {chatMode === 'done' && (
                  <>
                    <button
                      onClick={handleRestart}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
                      Back
                    </button>
                    <button
                      onClick={handleGenerate}
                      disabled={!canGenerate}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" strokeWidth={0} />
                      Generate Clip
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {isGenerating && (
            <div className="flex justify-end pt-4 border-t border-[#141821]">
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors"
              >
                Close (keeps rendering)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}