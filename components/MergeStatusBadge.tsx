'use client';

// MergeStatusBadge — small pill that shows scene merge state
// Drops into the scene editor topbar or near the preview

import { Loader2, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import type { MergeStatus } from '@/lib/useSceneMerge';

interface MergeStatusBadgeProps {
  status: MergeStatus;
  errorMessage?: string | null;
  onRetry?: () => void;
  compact?: boolean; // smaller version for tight spaces
}

export default function MergeStatusBadge({
  status,
  errorMessage,
  onRetry,
  compact = false,
}: MergeStatusBadgeProps) {
  // Don't render anything for these states
  if (status === 'idle' || status === 'pending') return null;

  const config = {
    triggering: {
      label: compact ? 'Preparing' : 'Preparing seamless preview',
      icon: <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2.5} />,
      classes:
        'bg-purple-500/15 border-purple-500/30 text-purple-200',
      title: 'Starting Cloudinary merge...',
    },
    processing: {
      label: compact ? 'Merging' : 'Merging clips into one scene',
      icon: <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2.5} />,
      classes:
        'bg-purple-500/15 border-purple-500/30 text-purple-200',
      title: 'Cloudinary is processing your scene...',
    },
    ready: {
      label: compact ? 'Seamless' : 'Seamless preview ready',
      icon: <Sparkles className="w-3 h-3" strokeWidth={2.5} />,
      classes:
        'bg-emerald-500/15 border-emerald-500/30 text-emerald-200',
      title: 'Scene plays as one seamless video',
    },
    stale: {
      label: compact ? 'Updating' : 'Re-merging...',
      icon: <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2.5} />,
      classes:
        'bg-amber-500/15 border-amber-500/30 text-amber-200',
      title: 'Clips changed — re-merging scene',
    },
    failed: {
      label: compact ? 'Failed' : 'Merge failed',
      icon: <AlertCircle className="w-3 h-3" strokeWidth={2.5} />,
      classes:
        'bg-rose-500/15 border-rose-500/30 text-rose-200 hover:bg-rose-500/25',
      title: errorMessage || 'Merge failed — using clip-by-clip preview',
    },
  } as const;

  // TypeScript guard
  if (!(status in config)) return null;
  const c = config[status as keyof typeof config];

  // Failed state is clickable to retry
  if (status === 'failed' && onRetry) {
    return (
      <button
        onClick={onRetry}
        title={c.title}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold transition-all active:scale-95 ${c.classes}`}
      >
        {c.icon}
        <span>{c.label}</span>
        <RefreshCw className="w-2.5 h-2.5 ml-0.5" strokeWidth={2.5} />
      </button>
    );
  }

  return (
    <span
      title={c.title}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${c.classes}`}
    >
      {c.icon}
      <span>{c.label}</span>
    </span>
  );
}
