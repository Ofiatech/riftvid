'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Upload, Sparkles, Loader2, Check, Trash2, UserSquare2, AlertCircle, Plus,
  Wand2, RefreshCw, Pencil, Zap, Image as ImageIcon,
} from 'lucide-react';

// ============================================================================
// CONSTANTS — keep in sync with lib/avatars.ts + /api/avatars/generate
// ============================================================================

const MAX_PHOTOS = 5;
const MIN_PHOTOS = 1;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3 MB per photo
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

const NAME_MAX = 60;
const DESCRIPTION_MAX = 500;

const PROMPT_MIN = 5;
const PROMPT_MAX = 2000;
const FREE_GENERATIONS = 3;

const AGE_RANGES: { value: string; label: string }[] = [
  { value: 'child', label: 'Child' },
  { value: 'teen', label: 'Teen' },
  { value: 'young_adult', label: 'Young adult' },
  { value: 'adult', label: 'Adult' },
  { value: 'senior', label: 'Senior' },
];

const GENDERS: { value: string; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
];

// ============================================================================
// TYPES
// ============================================================================

interface NewAvatarModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onLimitReached: () => void;
}

interface PhotoSlot {
  id: string;
  file: File;
  previewUrl: string;
}

type ModalMode = 'upload' | 'generate';
type SaveMode = 'idle' | 'uploading' | 'success' | 'error';
type GenerateState = 'idle' | 'generating' | 'preview' | 'error';

// ============================================================================
// HELPERS
// ============================================================================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function makeDraftSessionId(): string {
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function NewAvatarModal({
  open,
  onClose,
  onCreated,
  onLimitReached,
}: NewAvatarModalProps) {
  // === MODE TAB ===
  const [mode, setMode] = useState<ModalMode>('upload');

  // === UPLOAD MODE STATE ===
  const [photos, setPhotos] = useState<PhotoSlot[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // === GENERATE MODE STATE ===
  const [draftSessionId, setDraftSessionId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [genState, setGenState] = useState<GenerateState>('idle');
  const [genError, setGenError] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0); // local mirror, server is truth
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [nextCostsCredit, setNextCostsCredit] = useState(false);

  // === SHARED FORM STATE ===
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ageRange, setAgeRange] = useState<string | null>(null);
  const [gender, setGender] = useState<string | null>(null);

  // === SAVE STATE ===
  const [saveMode, setSaveMode] = useState<SaveMode>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize draft session ID on open
  useEffect(() => {
    if (open && !draftSessionId) {
      setDraftSessionId(makeDraftSessionId());
    }
  }, [open, draftSessionId]);

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      photos.forEach((p) => {
        if (p.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(p.previewUrl);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // RESET / CLOSE
  // ============================================================================

  const resetAll = useCallback(() => {
    photos.forEach((p) => {
      if (p.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(p.previewUrl);
      }
    });
    setMode('upload');
    setPhotos([]);
    setFileError(null);
    setIsDragging(false);
    setDraftSessionId('');
    setPrompt('');
    setGenState('idle');
    setGenError(null);
    setGeneratedUrl(null);
    setAttemptCount(0);
    setCreditsBalance(null);
    setNextCostsCredit(false);
    setName('');
    setDescription('');
    setAgeRange(null);
    setGender(null);
    setSaveMode('idle');
    setSaveError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [photos]);

  const handleClose = () => {
    if (saveMode === 'uploading' || genState === 'generating') return;
    resetAll();
    onClose();
  };

  // ============================================================================
  // TAB SWITCHING — resets the OTHER mode to avoid cross-contamination
  // ============================================================================

  const handleModeSwitch = (newMode: ModalMode) => {
    if (newMode === mode) return;
    if (saveMode === 'uploading' || genState === 'generating') return;

    if (newMode === 'upload') {
      // leaving generate → reset generate state
      setPrompt('');
      setGenState('idle');
      setGenError(null);
      setGeneratedUrl(null);
    } else {
      // leaving upload → reset upload state
      photos.forEach((p) => {
        if (p.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(p.previewUrl);
        }
      });
      setPhotos([]);
      setFileError(null);
      setIsDragging(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }

    setMode(newMode);
  };

  // ============================================================================
  // UPLOAD MODE — photo handling (unchanged from 4.3.3)
  // ============================================================================

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      setFileError(null);
      const files = Array.from(incoming);
      const slotsLeft = MAX_PHOTOS - photos.length;

      if (files.length > slotsLeft) {
        setFileError(
          `Only ${slotsLeft} more photo${slotsLeft === 1 ? '' : 's'} can be added (${MAX_PHOTOS} max).`
        );
      }

      const toAdd: PhotoSlot[] = [];
      for (const file of files.slice(0, slotsLeft)) {
        if (!ALLOWED_MIME.includes(file.type.toLowerCase())) {
          setFileError(`"${file.name}" isn't a supported image type. Use PNG, JPEG, or WebP.`);
          continue;
        }
        if (file.size > MAX_PHOTO_BYTES) {
          setFileError(`"${file.name}" is too large. Max ${formatFileSize(MAX_PHOTO_BYTES)} per photo.`);
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        toAdd.push({ id: makeId(), file, previewUrl });
      }

      if (toAdd.length > 0) {
        setPhotos((prev) => [...prev, ...toAdd]);
      }
    },
    [photos.length]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleRemovePhoto = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((p) => p.id !== id);
    });
    setFileError(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (saveMode === 'uploading') return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget === e.target) setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (saveMode === 'uploading') return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  // ============================================================================
  // GENERATE MODE — Fal Flux flow
  // ============================================================================

  const handleGenerate = async () => {
    if (!prompt.trim() || prompt.trim().length < PROMPT_MIN) {
      setGenError(`Prompt must be at least ${PROMPT_MIN} characters`);
      return;
    }
    if (!draftSessionId) {
      setGenError('Session error — please close and reopen the modal');
      return;
    }

    setGenState('generating');
    setGenError(null);

    try {
      const res = await fetch('/api/avatars/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          draftSessionId,
        }),
      });

      const data = await res.json();

      // Out of credits → bounce to upgrade modal
      if (res.status === 402 || data.error === 'out_of_credits') {
        setGenState('idle');
        handleClose();
        onLimitReached();
        return;
      }

      if (!res.ok || !data.falImageUrl) {
        throw new Error(data.message || data.error || 'Generation failed');
      }

      setGeneratedUrl(data.falImageUrl);
      setAttemptCount(data.attemptNumber ?? attemptCount + 1);
      setCreditsBalance(data.creditsBalance ?? null);
      setNextCostsCredit(Boolean(data.nextAttemptCostsCredit));
      setGenState('preview');
    } catch (err) {
      console.error('Generate error:', err);
      setGenState('error');
      setGenError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const handleRegenerate = () => {
    setGeneratedUrl(null);
    handleGenerate();
  };

  const handleEditPrompt = () => {
    setGenState('idle');
    // Keep generatedUrl so user can see what they had if they choose to keep
    // But moving back to idle hides the preview area, prompt stays editable
  };

  const generationsUsed = attemptCount;
  const freeRemaining = Math.max(0, FREE_GENERATIONS - generationsUsed);

  // ============================================================================
  // SAVE
  // ============================================================================

  const canSaveUpload =
    photos.length >= MIN_PHOTOS &&
    name.trim().length > 0 &&
    saveMode !== 'uploading' &&
    mode === 'upload';

  const canSaveGenerate =
    generatedUrl !== null &&
    name.trim().length > 0 &&
    saveMode !== 'uploading' &&
    mode === 'generate' &&
    genState === 'preview';

  const canSave = canSaveUpload || canSaveGenerate;

  const handleSave = async () => {
    if (!canSave) return;

    setSaveMode('uploading');
    setSaveError(null);

    try {
      const isUpload = mode === 'upload';

      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        age_range: ageRange,
        gender,
        source: isUpload ? 'upload' : 'ai_generated',
      };

      if (isUpload) {
        // Convert all photos to base64 in parallel
        const photosBase64 = await Promise.all(photos.map((p) => fileToBase64(p.file)));
        body.photosBase64 = photosBase64;
      } else {
        // Generate mode: pass the Fal URL — backend will rehost to Supabase storage
        body.photoUrls = [generatedUrl];
      }

      const res = await fetch('/api/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (res.status === 403 && data.error === 'avatar_limit_reached') {
        setSaveMode('idle');
        handleClose();
        onLimitReached();
        return;
      }

      if (!res.ok) {
        if (data.details && Array.isArray(data.details) && data.details.length > 0) {
          const messages = data.details.map((d: { message: string }) => d.message).join(', ');
          throw new Error(messages);
        }
        throw new Error(data.message || data.error || 'Failed to create avatar');
      }

      setSaveMode('success');
      setTimeout(() => {
        resetAll();
        onCreated();
        onClose();
      }, 600);
    } catch (err) {
      console.error('Avatar save error:', err);
      setSaveMode('error');
      setSaveError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  if (!open) return null;

  // ============================================================================
  // RENDER
  // ============================================================================

  const photoCount = photos.length;
  const photosFull = photoCount >= MAX_PHOTOS;
  const showFormFields =
    saveMode !== 'success' &&
    ((mode === 'upload' && photoCount > 0) ||
      (mode === 'generate' && genState === 'preview' && generatedUrl !== null));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/70 animate-backdrop-in" />
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#1f2937] bg-[#0a0a0b] shadow-2xl animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-purple-500/20 blur-[80px] opacity-50 pointer-events-none" />

        <div className="relative p-6 md:p-8">
          {/* ============ HEADER ============ */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-2">
                <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
                {saveMode === 'success' ? '🎬 Avatar Created' : 'New Avatar'}
              </div>
              <h2 className="text-[22px] font-semibold text-white tracking-tight">
                {saveMode === 'success' ? 'Your character is ready' : 'Build a new character'}
              </h2>
              <p className="text-[13px] text-zinc-400 mt-1">
                {saveMode === 'success'
                  ? 'Saved to your library. Use across any project.'
                  : mode === 'upload'
                  ? 'Upload reference photos. More angles = better consistency.'
                  : 'Describe your character and Rift will generate a portrait.'}
              </p>
            </div>
            <button
              onClick={handleClose}
              disabled={saveMode === 'uploading' || genState === 'generating'}
              className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
            </button>
          </div>

          {/* ============ TAB SWITCHER (hidden during success) ============ */}
          {saveMode !== 'success' && (
            <div className="mb-5 p-1 rounded-xl bg-white/[0.03] border border-[#1f2937] grid grid-cols-2 gap-1">
              <button
                onClick={() => handleModeSwitch('upload')}
                disabled={saveMode === 'uploading' || genState === 'generating'}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-[13px] font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === 'upload'
                    ? 'bg-gradient-to-b from-purple-500/30 to-purple-600/20 text-white shadow-sm border border-purple-500/30'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.02]'
                }`}
              >
                <Upload className="w-3.5 h-3.5" strokeWidth={2} />
                Upload photos
              </button>
              <button
                onClick={() => handleModeSwitch('generate')}
                disabled={saveMode === 'uploading' || genState === 'generating'}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-[13px] font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === 'generate'
                    ? 'bg-gradient-to-b from-purple-500/30 to-purple-600/20 text-white shadow-sm border border-purple-500/30'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.02]'
                }`}
              >
                <Wand2 className="w-3.5 h-3.5" strokeWidth={2} />
                Generate from prompt
              </button>
            </div>
          )}

          {/* ============ UPLOADING STATE ============ */}
          {saveMode === 'uploading' && (
            <div className="mb-5 rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.04] p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/20">
                  <Loader2 className="w-5 h-5 text-purple-300 animate-spin" strokeWidth={1.75} />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-white">
                    {mode === 'upload'
                      ? `Uploading ${photoCount} photo${photoCount === 1 ? '' : 's'}...`
                      : 'Saving your AI character...'}
                  </div>
                  <div className="text-[11px] text-zinc-400">Saving avatar to your library</div>
                </div>
              </div>
            </div>
          )}

          {/* ============ SUCCESS STATE ============ */}
          {saveMode === 'success' && (
            <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-5 text-center">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
                <Check className="w-6 h-6 text-emerald-300" strokeWidth={2.5} />
              </div>
              <div className="text-[14px] font-semibold text-white mb-1">Avatar created</div>
              <div className="text-[12px] text-zinc-400">Closing...</div>
            </div>
          )}

          {/* ============ UPLOAD MODE CONTENT ============ */}
          {saveMode !== 'success' && saveMode !== 'uploading' && mode === 'upload' && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[12px] font-medium text-zinc-300">
                  Photos {photoCount > 0 && <span className="text-zinc-500">({photoCount} of {MAX_PHOTOS})</span>}
                </label>
                {photoCount > 0 && !photosFull && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-[11px] font-medium text-purple-300 hover:text-purple-200 transition-colors"
                  >
                    <Plus className="w-3 h-3" strokeWidth={2.5} />
                    Add another
                  </button>
                )}
              </div>

              {photoCount === 0 ? (
                <label
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`block relative border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all group ${
                    isDragging
                      ? 'border-purple-500/60 bg-purple-500/[0.08]'
                      : 'border-[#1f2937] hover:border-purple-500/40 bg-white/[0.01] hover:bg-purple-500/[0.02]'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    multiple
                    className="hidden"
                    onChange={handleFileInput}
                  />
                  <div className="flex flex-col items-center text-center">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-all ${
                      isDragging
                        ? 'bg-purple-500/25 border border-purple-500/40 scale-110'
                        : 'bg-purple-500/10 border border-purple-500/20 group-hover:scale-110'
                    }`}>
                      <Upload className="w-5 h-5 text-purple-300" strokeWidth={2} />
                    </div>
                    <div className="text-[14px] font-semibold text-white mb-1">
                      {isDragging ? 'Drop photos here' : 'Drag & drop or click to upload'}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      Up to {MAX_PHOTOS} photos · PNG, JPEG, WebP · Max {formatFileSize(MAX_PHOTO_BYTES)} each
                    </div>
                    <div className="text-[11px] text-purple-300/70 mt-2">
                      💡 More angles = better consistency
                    </div>
                  </div>
                </label>
              ) : (
                <>
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`grid grid-cols-3 sm:grid-cols-5 gap-2 p-2 rounded-xl border transition-all ${
                      isDragging
                        ? 'border-purple-500/60 bg-purple-500/[0.08]'
                        : 'border-[#1f2937] bg-white/[0.01]'
                    }`}
                  >
                    {photos.map((p, idx) => (
                      <div
                        key={p.id}
                        className="relative aspect-[4/5] rounded-lg overflow-hidden border border-white/[0.08] bg-[#050505] group/photo"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.previewUrl}
                          alt={`Photo ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md text-[9px] font-semibold text-white border border-white/10">
                          {idx + 1}
                        </div>
                        <button
                          onClick={() => handleRemovePhoto(p.id)}
                          className="absolute top-1 right-1 p-1 rounded-md bg-black/60 backdrop-blur-md hover:bg-rose-500/80 transition-colors opacity-0 group-hover/photo:opacity-100 border border-white/10"
                          aria-label="Remove photo"
                        >
                          <Trash2 className="w-3 h-3 text-white" strokeWidth={2} />
                        </button>
                      </div>
                    ))}

                    {!photosFull && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="aspect-[4/5] rounded-lg border-2 border-dashed border-[#1f2937] hover:border-purple-500/40 bg-white/[0.01] hover:bg-purple-500/[0.02] transition-all flex flex-col items-center justify-center gap-1.5 group"
                        aria-label="Add more photos"
                      >
                        <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Plus className="w-4 h-4 text-purple-300" strokeWidth={2.5} />
                        </div>
                        <span className="text-[10px] font-medium text-zinc-500 group-hover:text-zinc-300 transition-colors">
                          Add more
                        </span>
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    multiple
                    className="hidden"
                    onChange={handleFileInput}
                  />
                  {photoCount === 1 && (
                    <div className="mt-2 text-[11px] text-purple-300/70">
                      💡 Add 2-4 more from different angles for better character consistency
                    </div>
                  )}
                </>
              )}

              {fileError && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={2} />
                  <span>{fileError}</span>
                </div>
              )}
            </div>
          )}

          {/* ============ GENERATE MODE CONTENT ============ */}
          {saveMode !== 'success' && saveMode !== 'uploading' && mode === 'generate' && (
            <div className="mb-5">
              {/* Prompt input — shown when idle or error */}
              {(genState === 'idle' || genState === 'error') && (
                <>
                  <label className="block text-[12px] font-medium text-zinc-300 mb-2">
                    Describe your character
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
                    rows={4}
                    placeholder="e.g. Nigerian woman, mid-30s, curly black hair, business attire, studio lighting, soft warm tones, portrait orientation"
                    maxLength={PROMPT_MAX}
                    className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all resize-none"
                  />
                  <div className="mt-1 flex items-center justify-between">
                    <div className="text-[10px] text-zinc-500">
                      💡 Be specific about appearance, lighting, and style
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {prompt.length} / {PROMPT_MAX}
                    </div>
                  </div>

                  {/* Counter + generate button */}
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="text-[12px] text-zinc-400 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400/40" strokeWidth={2} />
                      {generationsUsed === 0 ? (
                        <span>
                          <span className="text-emerald-300 font-medium">{FREE_GENERATIONS} free</span> attempts this session
                        </span>
                      ) : freeRemaining > 0 ? (
                        <span>
                          <span className="text-emerald-300 font-medium">{freeRemaining} free</span> attempt{freeRemaining === 1 ? '' : 's'} left
                        </span>
                      ) : (
                        <span>
                          Next attempt costs <span className="text-amber-300 font-medium">1 credit</span>
                          {creditsBalance !== null && <span className="text-zinc-500"> · {creditsBalance} available</span>}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleGenerate}
                      disabled={prompt.trim().length < PROMPT_MIN}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Wand2 className="w-3.5 h-3.5" strokeWidth={2.25} />
                      Generate
                    </button>
                  </div>

                  {genError && genState === 'error' && (
                    <div className="mt-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-300 flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={2} />
                      <span>{genError}</span>
                    </div>
                  )}
                </>
              )}

              {/* Generating state */}
              {genState === 'generating' && (
                <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.04] p-8 flex flex-col items-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mb-4 shadow-lg shadow-purple-500/20">
                    <Loader2 className="w-7 h-7 text-purple-300 animate-spin" strokeWidth={1.75} />
                  </div>
                  <div className="text-[15px] font-semibold text-white mb-1">
                    Generating your character...
                  </div>
                  <div className="text-[12px] text-zinc-400 max-w-sm">
                    Rift is painting your portrait — this takes about 10-15 seconds.
                  </div>
                </div>
              )}

              {/* Preview state */}
              {genState === 'preview' && generatedUrl && (
                <div>
                  <label className="block text-[12px] font-medium text-zinc-300 mb-2">
                    Preview · Attempt {attemptCount}
                  </label>
                  <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.04] to-blue-500/[0.02] p-3">
                    <div className="relative aspect-[4/5] max-h-[400px] mx-auto rounded-lg overflow-hidden border border-white/[0.08] bg-[#050505]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={generatedUrl}
                        alt="Generated character"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/40 backdrop-blur-md text-[10px] font-semibold text-purple-50 border border-purple-400/40">
                        <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
                        AI Generated
                      </div>
                    </div>
                  </div>

                  {/* Counter + Action buttons */}
                  <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-amber-400 fill-amber-400/40" strokeWidth={2} />
                      {freeRemaining > 0 ? (
                        <span>
                          <span className="text-emerald-300 font-medium">{freeRemaining}</span> free regen{freeRemaining === 1 ? '' : 's'} left
                        </span>
                      ) : (
                        <span>
                          Next regen costs <span className="text-amber-300 font-medium">1 credit</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleEditPrompt}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-200 text-[12px] font-medium transition-all"
                      >
                        <Pencil className="w-3 h-3" strokeWidth={2} />
                        Edit prompt
                      </button>
                      <button
                        onClick={handleRegenerate}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-200 text-[12px] font-medium transition-all"
                      >
                        <RefreshCw className="w-3 h-3" strokeWidth={2} />
                        Regenerate
                        {nextCostsCredit && (
                          <span className="text-amber-300 text-[10px]">· 1 credit</span>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 px-3 py-2 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20 text-[11px] text-emerald-200 flex items-center gap-1.5">
                    <Check className="w-3 h-3 shrink-0" strokeWidth={2.5} />
                    Keep this character? Fill in the details below and click Create avatar.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============ SHARED FORM FIELDS (only shown when ready to save) ============ */}
          {showFormFields && (
            <>
              <div className="mb-5">
                <label className="block text-[12px] font-medium text-zinc-300 mb-2">
                  Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
                  placeholder="e.g. Adaeze, Marcus, Detective Rivers"
                  maxLength={NAME_MAX}
                  className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all"
                />
                <div className="mt-1 text-[10px] text-zinc-500 text-right">
                  {name.length} / {NAME_MAX}
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-[12px] font-medium text-zinc-300 mb-2">
                  Description <span className="text-zinc-500">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
                  rows={3}
                  placeholder="A short character description: physical traits, personality, anything Rift should know when this character appears..."
                  maxLength={DESCRIPTION_MAX}
                  className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all resize-none"
                />
                <div className="mt-1 text-[10px] text-zinc-500 text-right">
                  {description.length} / {DESCRIPTION_MAX}
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-[12px] font-medium text-zinc-300 mb-2">
                  Age range <span className="text-zinc-500">(optional)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {AGE_RANGES.map((opt) => {
                    const selected = ageRange === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setAgeRange(selected ? null : opt.value)}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                          selected
                            ? 'bg-purple-500/20 border-purple-500/40 text-purple-100 shadow-sm shadow-purple-500/20'
                            : 'bg-white/[0.03] border-[#1f2937] text-zinc-400 hover:border-[#2d3748] hover:text-zinc-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-[12px] font-medium text-zinc-300 mb-2">
                  Gender <span className="text-zinc-500">(optional)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {GENDERS.map((opt) => {
                    const selected = gender === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setGender(selected ? null : opt.value)}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                          selected
                            ? 'bg-purple-500/20 border-purple-500/40 text-purple-100 shadow-sm shadow-purple-500/20'
                            : 'bg-white/[0.03] border-[#1f2937] text-zinc-400 hover:border-[#2d3748] hover:text-zinc-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ============ SAVE ERROR ============ */}
          {saveMode === 'error' && saveError && (
            <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/[0.05] p-4">
              <div className="text-[14px] font-medium text-rose-200 mb-0.5">Couldn&apos;t save avatar</div>
              <div className="text-[12px] text-zinc-400">{saveError}</div>
            </div>
          )}

          {/* ============ FOOTER ============ */}
          {saveMode !== 'success' && (
            <div className="flex items-center justify-between pt-4 border-t border-[#141821] gap-3">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                {mode === 'upload' ? (
                  <>
                    <ImageIcon className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>
                      {photoCount >= MIN_PHOTOS && name.trim().length > 0
                        ? 'Ready to save'
                        : photoCount === 0
                        ? 'Add at least 1 photo'
                        : 'Name your character'}
                    </span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>
                      {genState === 'idle' || genState === 'error'
                        ? 'Describe your character'
                        : genState === 'generating'
                        ? 'Generating...'
                        : name.trim().length > 0
                        ? 'Ready to save'
                        : 'Name your character'}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClose}
                  disabled={saveMode === 'uploading' || genState === 'generating'}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!canSave}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saveMode === 'uploading' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2.25} />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" strokeWidth={2.25} />
                      Create avatar
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// === END OF FILE — if you can see this line, the file saved completely ===
