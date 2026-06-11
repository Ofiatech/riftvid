'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Upload, Sparkles, Loader2, Check, Trash2, UserSquare2, AlertCircle, Plus,
} from 'lucide-react';

// ============================================================================
// CONSTANTS — keep in sync with lib/avatars.ts
// ============================================================================

const MAX_PHOTOS = 5;
const MIN_PHOTOS = 1;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3 MB per photo
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

const NAME_MAX = 60;
const DESCRIPTION_MAX = 500;

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
  onCreated: () => void;          // called when avatar is created successfully
  onLimitReached: () => void;     // called when API returns avatar_limit_reached
}

interface PhotoSlot {
  id: string;          // local UUID for keying / removal
  file: File;          // the actual File object
  previewUrl: string;  // blob: URL for instant rendering
}

type SaveMode = 'idle' | 'uploading' | 'success' | 'error';

// ============================================================================
// HELPERS
// ============================================================================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeId(): string {
  // Simple unique-enough ID for local state keys
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

// ============================================================================
// COMPONENT
// ============================================================================

export default function NewAvatarModal({
  open,
  onClose,
  onCreated,
  onLimitReached,
}: NewAvatarModalProps) {
  // Photos
  const [photos, setPhotos] = useState<PhotoSlot[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ageRange, setAgeRange] = useState<string | null>(null);
  const [gender, setGender] = useState<string | null>(null);

  // Save state
  const [saveMode, setSaveMode] = useState<SaveMode>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up blob URLs when component unmounts or photos change
  useEffect(() => {
    return () => {
      // Cleanup ALL blob URLs on unmount
      photos.forEach((p) => {
        if (p.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(p.previewUrl);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset everything when modal closes
  const resetState = useCallback(() => {
    photos.forEach((p) => {
      if (p.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(p.previewUrl);
      }
    });
    setPhotos([]);
    setFileError(null);
    setIsDragging(false);
    setName('');
    setDescription('');
    setAgeRange(null);
    setGender(null);
    setSaveMode('idle');
    setSaveError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [photos]);

  const handleClose = () => {
    if (saveMode === 'uploading') return; // don't allow close during upload
    resetState();
    onClose();
  };

  // ============================================================================
  // PHOTO HANDLING
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
        // Validate type
        if (!ALLOWED_MIME.includes(file.type.toLowerCase())) {
          setFileError(`"${file.name}" isn't a supported image type. Use PNG, JPEG, or WebP.`);
          continue;
        }
        // Validate size
        if (file.size > MAX_PHOTO_BYTES) {
          setFileError(`"${file.name}" is too large. Max ${formatFileSize(MAX_PHOTO_BYTES)} per photo.`);
          continue;
        }
        // Create blob URL for instant preview
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
      // Reset input so selecting the same file again triggers change
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

  // ============================================================================
  // DRAG AND DROP
  // ============================================================================

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (saveMode === 'uploading') return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only set false if we're actually leaving the drop zone (not entering a child)
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
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
  // SAVE
  // ============================================================================

  const canSave =
    photos.length >= MIN_PHOTOS &&
    name.trim().length > 0 &&
    saveMode !== 'uploading';

  const handleSave = async () => {
    if (!canSave) return;

    setSaveMode('uploading');
    setSaveError(null);

    try {
      // Convert all photos to base64 in parallel
      const photosBase64 = await Promise.all(
        photos.map((p) => fileToBase64(p.file))
      );

      const res = await fetch('/api/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          age_range: ageRange,
          gender,
          photosBase64,
          source: 'upload',
        }),
      });

      const data = await res.json();

      // Handle tier-limit specifically
      if (res.status === 403 && data.error === 'avatar_limit_reached') {
        setSaveMode('idle');
        handleClose();
        onLimitReached();
        return;
      }

      if (!res.ok) {
        // Show validation errors nicely if present
        if (data.details && Array.isArray(data.details) && data.details.length > 0) {
          const messages = data.details.map((d: { message: string }) => d.message).join(', ');
          throw new Error(messages);
        }
        throw new Error(data.message || data.error || 'Failed to create avatar');
      }

      // Success
      setSaveMode('success');
      // Short success pause, then close + refresh
      setTimeout(() => {
        resetState();
        onCreated();
        onClose();
      }, 600);
    } catch (err) {
      console.error('Avatar create error:', err);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/70 animate-backdrop-in" />
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#1f2937] bg-[#0a0a0b] shadow-2xl animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-purple-500/20 blur-[80px] opacity-50 pointer-events-none" />

        <div className="relative p-6 md:p-8">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
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
                  : 'Upload reference photos and add a description. More angles = better consistency.'}
              </p>
            </div>
            <button
              onClick={handleClose}
              disabled={saveMode === 'uploading'}
              className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
            </button>
          </div>

          {/* Uploading overlay state */}
          {saveMode === 'uploading' && (
            <div className="mb-5 rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.04] p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/20">
                  <Loader2 className="w-5 h-5 text-purple-300 animate-spin" strokeWidth={1.75} />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-white">
                    Uploading {photoCount} photo{photoCount === 1 ? '' : 's'}...
                  </div>
                  <div className="text-[11px] text-zinc-400">Saving avatar to your library</div>
                </div>
              </div>
            </div>
          )}

          {/* Success state */}
          {saveMode === 'success' && (
            <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-5 text-center">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
                <Check className="w-6 h-6 text-emerald-300" strokeWidth={2.5} />
              </div>
              <div className="text-[14px] font-semibold text-white mb-1">Avatar created</div>
              <div className="text-[12px] text-zinc-400">Closing...</div>
            </div>
          )}

          {/* MAIN FORM — hidden during success */}
          {saveMode !== 'success' && (
            <>
              {/* ============ PHOTOS SECTION ============ */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[12px] font-medium text-zinc-300">
                    Photos {photoCount > 0 && <span className="text-zinc-500">({photoCount} of {MAX_PHOTOS})</span>}
                  </label>
                  {photoCount > 0 && !photosFull && saveMode !== 'uploading' && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1 text-[11px] font-medium text-purple-300 hover:text-purple-200 transition-colors"
                    >
                      <Plus className="w-3 h-3" strokeWidth={2.5} />
                      Add another
                    </button>
                  )}
                </div>

                {/* Photo grid OR empty dropzone */}
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
                      disabled={saveMode === 'uploading'}
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
                    {/* Photo thumbnail grid */}
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
                          {/* Order indicator */}
                          <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md text-[9px] font-semibold text-white border border-white/10">
                            {idx + 1}
                          </div>
                          {/* Remove button */}
                          {saveMode !== 'uploading' && (
                            <button
                              onClick={() => handleRemovePhoto(p.id)}
                              className="absolute top-1 right-1 p-1 rounded-md bg-black/60 backdrop-blur-md hover:bg-rose-500/80 transition-colors opacity-0 group-hover/photo:opacity-100 border border-white/10"
                              aria-label="Remove photo"
                            >
                              <Trash2 className="w-3 h-3 text-white" strokeWidth={2} />
                            </button>
                          )}
                        </div>
                      ))}

                      {/* Add-more tile (only if room left) */}
                      {!photosFull && saveMode !== 'uploading' && (
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
                    {/* Hidden file input (shared with Add buttons) */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      multiple
                      className="hidden"
                      onChange={handleFileInput}
                      disabled={saveMode === 'uploading'}
                    />
                    {/* Helper text below grid */}
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

              {/* ============ NAME ============ */}
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
                  disabled={saveMode === 'uploading'}
                  className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all disabled:opacity-50"
                />
                <div className="mt-1 text-[10px] text-zinc-500 text-right">
                  {name.length} / {NAME_MAX}
                </div>
              </div>

              {/* ============ DESCRIPTION ============ */}
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
                  disabled={saveMode === 'uploading'}
                  className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all resize-none disabled:opacity-50"
                />
                <div className="mt-1 text-[10px] text-zinc-500 text-right">
                  {description.length} / {DESCRIPTION_MAX}
                </div>
              </div>

              {/* ============ AGE RANGE ============ */}
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
                        disabled={saveMode === 'uploading'}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all disabled:opacity-50 ${
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

              {/* ============ GENDER ============ */}
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
                        disabled={saveMode === 'uploading'}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all disabled:opacity-50 ${
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

              {/* ============ ERROR ============ */}
              {saveMode === 'error' && saveError && (
                <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/[0.05] p-4">
                  <div className="text-[14px] font-medium text-rose-200 mb-0.5">
                    Couldn&apos;t save avatar
                  </div>
                  <div className="text-[12px] text-zinc-400">{saveError}</div>
                </div>
              )}
            </>
          )}

          {/* ============ FOOTER ============ */}
          {saveMode !== 'success' && (
            <div className="flex items-center justify-between pt-4 border-t border-[#141821] gap-3">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <UserSquare2 className="w-3.5 h-3.5" strokeWidth={2} />
                <span>
                  {photoCount >= MIN_PHOTOS && name.trim().length > 0
                    ? 'Ready to save'
                    : photoCount === 0
                    ? 'Add at least 1 photo'
                    : 'Name your character'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClose}
                  disabled={saveMode === 'uploading'}
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
