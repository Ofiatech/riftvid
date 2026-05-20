'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Plus, RefreshCw, Loader2, Film, Search, Bell, Menu, Sparkles,
  Video, UserSquare2, Megaphone, ChevronRight, Play, Clock, Trash2,
  MoreVertical,
} from 'lucide-react';
import Sidebar, { UserProfileData } from '@/components/Sidebar';
import ProjectCard from '@/components/ProjectCard';
import { useRouter } from 'next/navigation';

interface StudioProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  total_scenes: number;
  total_clips: number;
  total_duration: number;
  cover_image_url: string | null;
  updated_at: string;
}

type VideoStatus = 'queued' | 'processing' | 'completed' | 'failed';

interface SingleClip {
  id: string;
  title: string | null;
  duration: number;
  status: VideoStatus;
  created_at: string;
  source_image_url: string;
  generated_video_url: string | null;
  refined_prompt: string;
  error_message: string | null;
}

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

function formatDuration(seconds: number): string {
  return `0:${seconds.toString().padStart(2, '0')}`;
}

// Single Clip Card component (inline, smaller version for library view)
function ClipCard({ clip, onDelete }: { clip: SingleClip; onDelete: (id: string) => void }) {
  const [showMenu, setShowMenu] = useState(false);
  return (
    <div className="group cursor-pointer relative">
      <div className="relative aspect-video rounded-xl overflow-hidden border border-[#1f2937] bg-[#0a0a0b] transition-all duration-300 hover:border-[#2d3748] hover:-translate-y-0.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={clip.source_image_url} alt={clip.title || 'Clip'} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />

        {clip.status === 'completed' && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
            <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-xl">
              <Play className="w-4 h-4 text-white fill-white ml-0.5" strokeWidth={0} />
            </div>
          </div>
        )}

        {clip.status === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-purple-300 animate-spin" strokeWidth={2} />
          </div>
        )}

        <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[11px] font-medium text-white border border-white/5">
          {formatDuration(clip.duration)}
        </div>

        {clip.status === 'processing' && (
          <div className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-500/15 text-purple-200 border border-purple-500/25 backdrop-blur-md">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            Rendering
          </div>
        )}

        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(!showMenu); }} className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-black/40 backdrop-blur-md hover:bg-black/60 border border-white/5 transition-colors opacity-0 group-hover:opacity-100">
          <MoreVertical className="w-3.5 h-3.5 text-white" strokeWidth={2} />
        </button>

        {showMenu && (
          <div className="absolute top-10 right-2.5 z-10 rounded-lg bg-[#0a0a0b] border border-[#1f2937] shadow-2xl overflow-hidden min-w-[140px]" onClick={(e) => e.stopPropagation()}>
            <button onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete(clip.id); }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-rose-300 hover:bg-rose-500/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
              Delete
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 px-0.5">
        <h4 className="text-[12px] sm:text-[13px] font-medium text-white truncate group-hover:text-purple-200 transition-colors">{clip.title || 'Untitled'}</h4>
        <p className="text-[11px] text-zinc-500 mt-0.5">{formatRelativeTime(clip.created_at)}</p>
      </div>
    </div>
  );
}

// "Coming Soon" section for placeholder content types
function ComingSoonSection({ icon: Icon, title, description, color }: {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[#1f2937] bg-white/[0.01] p-8 text-center">
      <div className={`w-12 h-12 rounded-xl ${color} border flex items-center justify-center mb-3 mx-auto`}>
        <Icon className="w-5 h-5" strokeWidth={1.75} />
      </div>
      <h4 className="text-[14px] font-semibold text-white mb-1">{title}</h4>
      <p className="text-[12px] text-zinc-500 mb-2">{description}</p>
      <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20">
        Coming Soon
      </span>
    </div>
  );
}

export default function ProjectsLibraryPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [studioProjects, setStudioProjects] = useState<StudioProject[]>([]);
  const [singleClips, setSingleClips] = useState<SingleClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [filter, setFilter] = useState<'all' | 'studio' | 'clips'>('all');

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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch both in parallel
      const [projectsRes, videosRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/videos'),
      ]);

      if (projectsRes.ok) {
        const data = await projectsRes.json();
        setStudioProjects(data.projects || []);
      }

      if (videosRes.ok) {
        const data = await videosRes.json();
        setSingleClips(data.videos || []);
      }
    } catch (err) {
      console.error('Library fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    fetchAll();
  }, [fetchProfile, fetchAll]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) =>
      setSidebarOpen(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleDeleteStudioProject = async (id: string) => {
    if (!confirm('Delete this Rift Studio project? All scenes and clips inside will be deleted. This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setStudioProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleDeleteClip = async (id: string) => {
    if (!confirm('Delete this clip? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setSingleClips((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const totalCount = studioProjects.length + singleClips.length;
  const showStudio = filter === 'all' || filter === 'studio';
  const showClips = filter === 'all' || filter === 'clips';

  return (
    <div className="min-h-screen bg-[#050505] text-white relative">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        profile={profile}
      />
      <main className="lg:ml-64 relative z-[1]">
        {/* Topbar */}
        <div className="sticky top-0 z-20 border-b border-[#141821] bg-[#050505]/70 backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 sm:px-10 py-4 gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-white/[0.04] transition-colors shrink-0"
            >
              <Menu className="w-[20px] h-[20px] text-zinc-300" strokeWidth={2} />
            </button>
            <div className="flex items-center gap-3 flex-1 max-w-xl">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search all projects..."
                  className="w-full pl-10 pr-4 py-2 bg-white/[0.03] border border-[#1f2937] rounded-lg text-[13px] placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="relative p-2 rounded-lg hover:bg-white/[0.04] transition-colors">
                <Bell className="w-[18px] h-[18px] text-zinc-400" strokeWidth={1.75} />
              </button>
              <Link
                href="/"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2.25} />
                <span className="hidden sm:inline">New</span>
              </Link>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-10 py-6 sm:py-8 max-w-[1400px]">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-white mb-2">
              Your Projects
            </h1>
            <p className="text-[14px] text-zinc-400">
              All your AI creations in one place. Studio projects, single clips, and more.
            </p>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-white/[0.02] border border-[#1f2937] rounded-lg p-1">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                  filter === 'all'
                    ? 'bg-white/[0.08] text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                All {!loading && `(${totalCount})`}
              </button>
              <button
                onClick={() => setFilter('studio')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${
                  filter === 'studio'
                    ? 'bg-purple-500/15 text-purple-200 shadow-sm border border-purple-500/30'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Film className="w-3 h-3" strokeWidth={2} />
                Rift Studio {!loading && `(${studioProjects.length})`}
              </button>
              <button
                onClick={() => setFilter('clips')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${
                  filter === 'clips'
                    ? 'bg-blue-500/15 text-blue-200 shadow-sm border border-blue-500/30'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Video className="w-3 h-3" strokeWidth={2} />
                Single Clips {!loading && `(${singleClips.length})`}
              </button>
            </div>
            <button
              onClick={fetchAll}
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
              <div className="text-[13px] text-zinc-400">Loading your library...</div>
            </div>
          ) : totalCount === 0 ? (
            // Empty state — no content at all
            <div className="rounded-2xl border border-dashed border-[#1f2937] bg-white/[0.01] p-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4 mx-auto">
                <Sparkles className="w-7 h-7 text-purple-300" strokeWidth={1.75} />
              </div>
              <h3 className="text-[18px] font-semibold text-white mb-2">
                Start creating
              </h3>
              <p className="text-[13px] text-zinc-400 mb-6 max-w-md mx-auto">
                Your library is empty. Generate your first clip or start a Rift Studio movie project.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
                >
                  <Plus className="w-4 h-4" strokeWidth={2.25} />
                  Generate a clip
                </Link>
                <Link
                  href="/studio"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-purple-500/20 hover:border-purple-500/40 text-white text-[13px] font-semibold transition-all"
                >
                  <Film className="w-4 h-4" strokeWidth={2.25} />
                  Open Rift Studio
                </Link>
              </div>
            </div>
          ) : (
            // Sectioned content
            <div className="space-y-10">
              {/* Rift Studio Projects section */}
              {showStudio && studioProjects.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Film className="w-4 h-4 text-purple-300" strokeWidth={2} />
                      <h2 className="text-[14px] font-semibold text-white uppercase tracking-wider">
                        Rift Studio Projects
                      </h2>
                      <span className="text-[11px] text-zinc-500">
                        {studioProjects.length} {studioProjects.length === 1 ? 'project' : 'projects'}
                      </span>
                    </div>
                    <Link
                      href="/studio"
                      className="flex items-center gap-1 text-[12px] text-purple-300 hover:text-purple-200 transition-colors font-medium"
                    >
                      Open Studio
                      <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                    {studioProjects.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        onDelete={handleDeleteStudioProject}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Empty Studio section (only show if filter is studio + no studio) */}
              {showStudio && studioProjects.length === 0 && filter === 'studio' && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Film className="w-4 h-4 text-purple-300" strokeWidth={2} />
                    <h2 className="text-[14px] font-semibold text-white uppercase tracking-wider">
                      Rift Studio Projects
                    </h2>
                  </div>
                  <div className="rounded-2xl border border-dashed border-purple-500/20 bg-purple-500/[0.02] p-10 text-center">
                    <Film className="w-10 h-10 text-purple-300/40 mx-auto mb-3" strokeWidth={1.5} />
                    <h4 className="text-[15px] font-semibold text-white mb-1">No Studio projects yet</h4>
                    <p className="text-[12px] text-zinc-500 mb-4">Start directing your first AI movie</p>
                    <Link
                      href="/studio"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-200 text-[12px] font-semibold transition-all"
                    >
                      Enter Rift Studio
                      <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
                    </Link>
                  </div>
                </section>
              )}

              {/* Single Clips section */}
              {showClips && singleClips.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Video className="w-4 h-4 text-blue-300" strokeWidth={2} />
                      <h2 className="text-[14px] font-semibold text-white uppercase tracking-wider">
                        Single Clips
                      </h2>
                      <span className="text-[11px] text-zinc-500">
                        {singleClips.length} {singleClips.length === 1 ? 'clip' : 'clips'}
                      </span>
                    </div>
                    <Link
                      href="/"
                      className="flex items-center gap-1 text-[12px] text-blue-300 hover:text-blue-200 transition-colors font-medium"
                    >
                      Generate new
                      <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                    {singleClips.map((clip) => (
                      <ClipCard
                        key={clip.id}
                        clip={clip}
                        onDelete={handleDeleteClip}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Empty Clips section */}
              {showClips && singleClips.length === 0 && filter === 'clips' && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Video className="w-4 h-4 text-blue-300" strokeWidth={2} />
                    <h2 className="text-[14px] font-semibold text-white uppercase tracking-wider">
                      Single Clips
                    </h2>
                  </div>
                  <div className="rounded-2xl border border-dashed border-blue-500/20 bg-blue-500/[0.02] p-10 text-center">
                    <Video className="w-10 h-10 text-blue-300/40 mx-auto mb-3" strokeWidth={1.5} />
                    <h4 className="text-[15px] font-semibold text-white mb-1">No clips yet</h4>
                    <p className="text-[12px] text-zinc-500 mb-4">Generate your first 10-second AI clip</p>
                    <Link
                      href="/"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-200 text-[12px] font-semibold transition-all"
                    >
                      Generate a clip
                      <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
                    </Link>
                  </div>
                </section>
              )}

              {/* Future content types (only show in "all" view) */}
              {filter === 'all' && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-4 h-4 text-amber-300" strokeWidth={2} />
                    <h2 className="text-[14px] font-semibold text-white uppercase tracking-wider">
                      Coming Soon
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    <ComingSoonSection
                      icon={Megaphone}
                      title="Ad Campaigns"
                      description="Photoroom-style AI ads with motion"
                      color="bg-rose-500/10 border-rose-500/20 text-rose-300"
                    />
                    <ComingSoonSection
                      icon={UserSquare2}
                      title="Digital Avatars"
                      description="Photorealistic AI personas"
                      color="bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                    />
                    <ComingSoonSection
                      icon={Clock}
                      title="Translated Videos"
                      description="40+ languages with lip-sync"
                      color="bg-blue-500/10 border-blue-500/20 text-blue-300"
                    />
                  </div>
                </section>
              )}
            </div>
          )}

          <div className="h-16" />
        </div>
      </main>
    </div>
  );
}