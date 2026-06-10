'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, RefreshCw, Loader2, UserSquare2, Search, Bell, Menu, Sparkles,
  Trash2, MoreVertical, Layers, AlertCircle, Zap,
} from 'lucide-react';
import Sidebar, { UserProfileData } from '@/components/Sidebar';
import TierPickerModal from '@/components/TierPickerModal';
import NewAvatarModal from '@/components/NewAvatarModal';

// ============================================================================
// TYPES (mirror lib/avatars.ts)
// ============================================================================

interface AvatarPhoto {
  url: string;
  order: number;
}

interface AvatarRecord {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  photo_urls: AvatarPhoto[];
  age_range: string | null;
  gender: string | null;
  voice_id: string | null;
  source: 'upload' | 'ai_generated';
  ai_generation_count: number;
  created_at: string;
  updated_at: string;
}

interface AvatarsMeta {
  count: number;
  limit: number;
  unlimited: boolean;
  tier: string;
  at_limit: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 172800) return 'yesterday';
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  return new Date(iso).toLocaleDateString();
}

function getPrimaryPhoto(avatar: AvatarRecord): string | null {
  if (!avatar.photo_urls || avatar.photo_urls.length === 0) return null;
  // Sort by order, take the first (lowest order number = primary)
  const sorted = [...avatar.photo_urls].sort((a, b) => a.order - b.order);
  return sorted[0]?.url ?? null;
}

function getTagLabel(tag: string): string {
  // Convert 'young_adult' → 'Young Adult', 'non_binary' → 'Non-binary'
  return tag
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ============================================================================
// AVATAR CARD
// ============================================================================

function AvatarCard({
  avatar,
  onDelete,
}: {
  avatar: AvatarRecord;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const primaryPhoto = getPrimaryPhoto(avatar);
  const extraCount = Math.max(0, (avatar.photo_urls?.length ?? 0) - 1);

  return (
    <div className="group relative card-stagger">
      {/* Portrait 4:5 thumbnail */}
      <div className="relative aspect-[4/5] rounded-xl overflow-hidden border border-[#1f2937] bg-[#0a0a0b] lift">
        {primaryPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primaryPhoto}
            alt={avatar.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-purple-500/[0.05]">
            <UserSquare2 className="w-12 h-12 text-purple-300/50" strokeWidth={1.5} />
          </div>
        )}

        {/* Bottom gradient overlay for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />

        {/* Hover overlay tint */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />

        {/* Photo count badge — top left */}
        {extraCount > 0 && (
          <div className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[10px] font-semibold text-white border border-white/10">
            <Layers className="w-3 h-3" strokeWidth={2} />
            +{extraCount}
          </div>
        )}

        {/* Source badge — bottom left */}
        {avatar.source === 'ai_generated' && (
          <div className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/30 backdrop-blur-md text-[10px] font-semibold text-purple-100 border border-purple-400/30">
            <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
            AI
          </div>
        )}

        {/* 3-dot menu — top right, appears on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-black/40 backdrop-blur-md hover:bg-black/60 border border-white/5 transition-all opacity-0 group-hover:opacity-100"
          aria-label="Avatar actions"
        >
          <MoreVertical className="w-3.5 h-3.5 text-white" strokeWidth={2} />
        </button>

        {/* Menu dropdown */}
        {showMenu && (
          <>
            {/* Click-outside catcher */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setShowMenu(false)}
            />
            <div
              className="absolute top-10 right-2.5 z-20 rounded-lg bg-[#0a0a0b] border border-[#1f2937] shadow-2xl overflow-hidden min-w-[140px]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  setShowMenu(false);
                  onDelete();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-rose-300 hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      {/* Avatar info below thumbnail */}
      <div className="mt-3 px-0.5">
        <h4 className="text-[13px] sm:text-[14px] font-semibold text-white truncate group-hover:text-purple-200 transition-colors">
          {avatar.name}
        </h4>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {avatar.age_range && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/[0.04] text-zinc-400 border border-white/[0.06]">
              {getTagLabel(avatar.age_range)}
            </span>
          )}
          {avatar.gender && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/[0.04] text-zinc-400 border border-white/[0.06]">
              {getTagLabel(avatar.gender)}
            </span>
          )}
        </div>
        <p className="text-[11px] text-zinc-500 mt-1.5">
          {formatRelativeTime(avatar.created_at)}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function AvatarsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const [avatars, setAvatars] = useState<AvatarRecord[]>([]);
  const [meta, setMeta] = useState<AvatarsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/profile');
      if (!res.ok) return;
      const data = await res.json();
      setProfile(data);
    } catch (err) {
      console.error('Profile fetch error:', err);
    }
  }, []);

  const fetchAvatars = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/avatars');
      if (!res.ok) throw new Error('Failed to fetch avatars');
      const data = await res.json();
      setAvatars(data.avatars || []);
      setMeta(data.meta || null);
    } catch (err) {
      console.error('Fetch avatars error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load avatars');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    fetchAvatars();
  }, [fetchProfile, fetchAvatars]);

  // Desktop sidebar opens by default
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) =>
      setSidebarOpen(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ESC closes mobile sidebar
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen && window.innerWidth < 1024) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sidebarOpen]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This will remove the avatar and all its photos. This cannot be undone.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/avatars/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete');
      }
      // Optimistic update + refresh meta
      setAvatars((prev) => prev.filter((a) => a.id !== id));
      // Re-fetch to get fresh meta (count, at_limit)
      fetchAvatars();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete avatar');
    }
  };

  const handleCreateAvatar = () => {
    if (atLimit) {
      setUpgradeOpen(true);
      return;
    }
    setCreateOpen(true);
  };

  const atLimit = meta?.at_limit ?? false;
  const tierLabel = meta?.tier
    ? meta.tier.charAt(0).toUpperCase() + meta.tier.slice(1)
    : 'Free';

  return (
    <div className="min-h-screen bg-[#050505] text-white relative">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        profile={profile}
        onUpgradeClick={() => setUpgradeOpen(true)}
      />
      <main className="lg:ml-64 relative z-[1]">
        {/* Topbar */}
        <div className="sticky top-0 z-20 border-b border-[#141821] bg-[#050505]/70 backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 sm:px-10 py-4 gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-white/[0.04] transition-colors shrink-0"
              aria-label="Open sidebar"
            >
              <Menu className="w-[20px] h-[20px] text-zinc-300" strokeWidth={2} />
            </button>
            <div className="flex items-center gap-3 flex-1 max-w-xl">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" strokeWidth={2} />
                <input
                  type="text"
                  placeholder="Search avatars..."
                  className="w-full pl-10 pr-4 py-2 bg-white/[0.03] border border-[#1f2937] rounded-lg text-[13px] placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="relative p-2 rounded-lg hover:bg-white/[0.04] transition-colors">
                <Bell className="w-[18px] h-[18px] text-zinc-400" strokeWidth={1.75} />
              </button>
              <button
                onClick={handleCreateAvatar}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2.25} />
                <span className="hidden sm:inline">New Avatar</span>
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-10 py-6 sm:py-8 max-w-[1400px]">
          {/* Header */}
          <div className="mb-8">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/20 text-[10px] font-semibold uppercase tracking-wider text-purple-300 mb-3">
              <UserSquare2 className="w-3 h-3" strokeWidth={2} />
              Avatars
            </div>
            <h1 className="text-[28px] sm:text-[36px] font-semibold tracking-tight text-white mb-2">
              Your Character Library
            </h1>
            <p className="text-[14px] text-zinc-400 max-w-2xl">
              Build a cast of characters you can reuse across projects.
              Upload reference photos for consistency, or generate new characters from a prompt.
            </p>
          </div>

          {/* At-limit banner */}
          {atLimit && meta && (
            <div className="mb-6 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.04] p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-300" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-white mb-0.5">
                  You&apos;ve reached your {tierLabel} tier limit
                </div>
                <div className="text-[12px] text-zinc-400">
                  {meta.count} of {meta.limit} avatars used. Upgrade your plan to create more.
                </div>
              </div>
              <button
                onClick={() => setUpgradeOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-[12px] font-semibold shadow-lg shadow-amber-500/20 transition-all shrink-0"
              >
                <Zap className="w-3 h-3" strokeWidth={2.25} />
                Upgrade
              </button>
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center justify-between mb-6 gap-3">
            <div className="text-[13px] text-zinc-500">
              {loading ? (
                'Loading...'
              ) : avatars.length === 0 ? (
                'No avatars yet'
              ) : meta?.unlimited ? (
                `${meta.count} ${meta.count === 1 ? 'avatar' : 'avatars'}`
              ) : meta ? (
                `${meta.count} of ${meta.limit} ${meta.count === 1 ? 'avatar' : 'avatars'}`
              ) : (
                `${avatars.length} ${avatars.length === 1 ? 'avatar' : 'avatars'}`
              )}
            </div>
            <button
              onClick={fetchAvatars}
              className="flex items-center gap-1 text-[12px] text-zinc-400 hover:text-white transition-colors font-medium"
            >
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
              Refresh
            </button>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-3" strokeWidth={2} />
              <div className="text-[13px] text-zinc-400">Loading your characters...</div>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.05] p-6 text-center">
              <div className="text-[14px] font-medium text-rose-200 mb-1">Couldn&apos;t load avatars</div>
              <div className="text-[12px] text-zinc-400 mb-4">{error}</div>
              <button
                onClick={fetchAvatars}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[13px] font-medium text-white transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.25} />
                Try again
              </button>
            </div>
          ) : avatars.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#1f2937] bg-gradient-to-br from-purple-500/[0.04] to-blue-500/[0.02] p-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4 mx-auto">
                <UserSquare2 className="w-7 h-7 text-purple-300" strokeWidth={1.75} />
              </div>
              <h3 className="text-[18px] font-semibold text-white mb-2">
                Build your first character
              </h3>
              <p className="text-[13px] text-zinc-400 mb-6 max-w-md mx-auto">
                Upload reference photos or generate a character from a description.
                Use them across your projects for consistent storytelling.
              </p>
              <button
                onClick={handleCreateAvatar}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
              >
                <Plus className="w-4 h-4" strokeWidth={2.25} />
                Create your first avatar
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
              {avatars.map((avatar) => (
                <AvatarCard
                  key={avatar.id}
                  avatar={avatar}
                  onDelete={() => handleDelete(avatar.id, avatar.name)}
                />
              ))}
            </div>
          )}
          <div className="h-16" />
        </div>
      </main>

      <TierPickerModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentTier={profile?.subscription_tier ?? 'free'}
      />

      <NewAvatarModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchAvatars}
        onLimitReached={() => {
          setCreateOpen(false);
          setUpgradeOpen(true);
        }}
      />
    </div>
  );
}

// === END OF FILE — if you can see this line, the file saved completely ===
