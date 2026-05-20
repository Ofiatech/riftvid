'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Film, Loader2 } from 'lucide-react';

interface NewSceneModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  nextSceneNumber: number;
  onCreated: (sceneId: string) => void;
}

export default function NewSceneModal({
  open,
  onClose,
  projectId,
  nextSceneNumber,
  onCreated,
}: NewSceneModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setName('');
      setDescription('');
      setError(null);
      setLoading(false);
    }
  }, [open]);

  if (!open) return null;

  const handleCreate = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create scene');

      onCreated(data.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !loading) {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-[#1f2937] bg-[#0a0a0b] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-20 -left-20 w-48 h-48 rounded-full bg-purple-500/20 blur-[80px] opacity-50 pointer-events-none" />

        <div className="relative p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-2">
                <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
                Scene {nextSceneNumber}
              </div>
              <h2 className="text-[20px] font-semibold text-white tracking-tight">
                Add a New Scene
              </h2>
              <p className="text-[13px] text-zinc-400 mt-1">
                Group multiple clips into a single scene.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
            >
              <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-zinc-300 mb-2">
                Scene name
              </label>
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`e.g., Opening, The Crash, Climax`}
                maxLength={100}
                className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all"
              />
              <p className="text-[11px] text-zinc-500 mt-1.5">
                Leave empty to use &quot;Scene {nextSceneNumber}&quot;.
              </p>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-zinc-300 mb-2">
                Director&apos;s notes{' '}
                <span className="text-zinc-500 font-normal">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What happens in this scene?"
                rows={3}
                className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all resize-none"
              />
            </div>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-300">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2.25} />
                    Creating...
                  </>
                ) : (
                  <>
                    <Film className="w-3.5 h-3.5" strokeWidth={2.25} />
                    Add Scene
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}