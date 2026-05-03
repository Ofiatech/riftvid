'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUser, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import {
  Home, FolderClosed, UserSquare2, Mic, Palette, BarChart3, Settings, HelpCircle,
  Search, Bell, Sparkles, Play, Upload, Zap, X, Library, Menu, Loader2, Check,
  RefreshCw, Download, Film, Trash2, MoreVertical, ArrowLeft, Plus,
} from 'lucide-react';

const mockUser = { plan: 'Pro', credits: 847, creditsMax: 1000 };

type VideoStatus = 'queued' | 'processing' | 'completed' | 'failed';

interface VideoData {
  id: string;
  title: string | null;
  duration: number;
  status: VideoStatus;
  created_at: string;
  source_image_url: string;
  generated_video_url: string | null;
  refined_prompt: string;
  base_prompt: string | null;
  scene_type: string | null;
  rift_used: boolean;
  error_message: string | null;
}

type FilterTab = 'all' | 'completed' | 'processing' | 'failed';

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

async function downloadVideo(url: string, filename: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    window.open(url, '_blank');
  }
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useUser();
  const displayName = user?.fullName || user?.firstName || user?.username || 'Creator';

  const navItems = [
    { name: 'Home', icon: Home, href: '/' },
    { name: 'Projects', icon: FolderClosed, href: '/library' },
    { name: 'Avatars', icon: UserSquare2, href: '#' },
    { name: 'Voices', icon: Mic, href: '#' },
    { name: 'Brand Kit', icon: Palette, href: '#' },
    { name: 'Analytics', icon: BarChart3, href: '#' },
  ];
  const bottomItems = [{ name: 'Settings', icon: Settings }, { name: 'Help', icon: HelpCircle }];

  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} aria-hidden="true" />
      <aside className={`fixed left-0 top-0 h-screen w-64 border-r border-[#141821] bg-[#07070a]/95 backdrop-blur-xl z-40 flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="px-6 pt-6 pb-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Play className="w-4 h-4 text-white fill-white" strokeWidth={0} />
            </div>
            <span className="text-[17px] font-semibold tracking-tight">Riftvid</span>
          </Link>
          <button onClick={onClose} className="lg:hidden p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors" aria-label="Close sidebar">
            <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
          </button>
        </div>
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Workspace</div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.name === 'Projects'; // Library page = Projects active
            return (
              <Link key={item.name} href={item.href} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] transition-all duration-200 ${isActive ? 'bg-white/[0.06] text-white shadow-sm' : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'}`}>
                <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-purple-400' : ''}`} strokeWidth={1.75} />
                <span className="font-medium">{item.name}</span>
                {isActive && <span className="ml-auto w-1 h-1 rounded-full bg-purple-400" />}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 pb-3">
          <div className="rounded-xl border border-[#1f2937] bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.04] p-4 relative overflow-hidden">
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-medium text-zinc-300">Credits</span>
                <span className="text-[11px] text-zinc-500">{mockUser.credits}/{mockUser.creditsMax}</span>
              </div>
              <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-400 to-blue-400 rounded-full" style={{ width: `${(mockUser.credits / mockUser.creditsMax) * 100}%` }} />
              </div>
              <button className="mt-3 w-full text-[12px] py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-200 transition-colors">Upgrade plan</button>
            </div>
          </div>
        </div>
        <div className="px-3 pb-3 space-y-0.5 border-t border-[#141821] pt-3">
          {bottomItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.name} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200 transition-all">
                <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                <span className="font-medium">{item.name}</span>
              </button>
            );
          })}
        </div>
        <div className="px-3 pb-4">
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.03] transition-colors">
            <UserButton appearance={{ elements: { avatarBox: 'w-9 h-9 shadow-md shadow-purple-500/20' } }} />
            <div className="flex-1 text-left min-w-0">
              <div className="text-[13px] font-medium text-white truncate">{displayName}</div>
              <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {mockUser.plan}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  return (
    <div className="sticky top-0 z-20 border-b border-[#141821] bg-[#050505]/70 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 sm:px-10 py-4 gap-3">
        <button onClick={onToggleSidebar} className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-white/[0.04] transition-colors shrink-0" aria-label="Open sidebar">
          <Menu className="w-[20px] h-[20px] text-zinc-300" strokeWidth={2} />
        </button>
        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" strokeWidth={2} />
            <input type="text" placeholder="Search projects, avatars, templates..." className="w-full pl-10 pr-4 py-2 bg-white/[0.03] border border-[#1f2937] rounded-lg text-[13px] placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all" />
            <kbd className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-zinc-500 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded">⌘K</kbd>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="relative p-2 rounded-lg hover:bg-white/[0.04] transition-colors">
            <Bell className="w-[18px] h-[18px] text-zinc-400" strokeWidth={1.75} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-purple-400" />
          </button>
          <Link href="/" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-white/[0.08] to-white/[0.04] border border-white/[0.08] hover:from-white/[0.12] hover:to-white/[0.06] transition-all text-[13px] font-medium shadow-sm">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.25} />
            <span className="hidden sm:inline">New project</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, error }: { status: VideoStatus; error?: string | null }) {
  const config = {
    queued: { label: 'Queued', className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/20', dot: 'bg-zinc-400', pulse: false },
    processing: { label: 'Rendering', className: 'bg-purple-500/15 text-purple-200 border-purple-500/25', dot: 'bg-purple-400', pulse: true },
    completed: { label: 'Completed', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-400', pulse: false },
    failed: { label: 'Failed', className: 'bg-rose-500/15 text-rose-300 border-rose-500/20', dot: 'bg-rose-400', pulse: false },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-md border ${config.className}`} title={error || undefined}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${config.pulse ? 'pulse-dot' : ''}`} />
      {config.label}
    </span>
  );
}

function VideoCard({ video, onPlay, onDelete }: { video: VideoData; onPlay: () => void; onDelete: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  return (
    <div className="group cursor-pointer relative" onClick={onPlay}>
      <div className="relative aspect-video rounded-xl overflow-hidden border border-[#1f2937] bg-[#0a0a0b] lift">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={video.source_image_url} alt={video.title || 'Video thumbnail'} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300" />
        {video.status === 'completed' && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
            <div className="w-12 h-12 rounded-full glass-strong flex items-center justify-center shadow-xl scale-90 group-hover:scale-100 transition-transform duration-300">
              <Play className="w-4 h-4 text-white fill-white ml-0.5" strokeWidth={0} />
            </div>
          </div>
        )}
        {video.status === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-purple-300 animate-spin" strokeWidth={2} />
          </div>
        )}
        <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[11px] font-medium text-white border border-white/5">
          {formatDuration(video.duration)}
        </div>
        <div className="absolute top-2.5 left-2.5">
          <StatusBadge status={video.status} error={video.error_message} />
        </div>
        <button onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }} className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-black/40 backdrop-blur-md hover:bg-black/60 border border-white/5 transition-colors opacity-0 group-hover:opacity-100">
          <MoreVertical className="w-3.5 h-3.5 text-white" strokeWidth={2} />
        </button>
        {showMenu && (
          <div className="absolute top-10 right-2.5 z-10 rounded-lg bg-[#0a0a0b] border border-[#1f2937] shadow-2xl overflow-hidden min-w-[140px]" onClick={(e) => e.stopPropagation()}>
            <button onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete(); }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-rose-300 hover:bg-rose-500/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
              Delete
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 px-0.5">
        <h4 className="text-[12px] sm:text-[13px] font-medium text-white truncate group-hover:text-purple-200 transition-colors">{video.title || 'Untitled'}</h4>
        <p className="text-[11px] text-zinc-500 mt-0.5">{formatRelativeTime(video.created_at)}</p>
      </div>
    </div>
  );
}

function VideoPreviewModal({ video, onClose, onDownload }: { video: VideoData | null; onClose: () => void; onDownload: () => void }) {
  if (!video) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-[fade-in_0.2s_ease-out]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-3xl rounded-2xl border border-[#1f2937] bg-[#0a0a0b] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#141821]">
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-white truncate">{video.title || 'Untitled'}</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">{formatRelativeTime(video.created_at)} · {video.duration}s</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {video.generated_video_url && (
              <button onClick={onDownload} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[12px] font-medium transition-all">
                <Download className="w-3.5 h-3.5" strokeWidth={2} />
                Download
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors">
              <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
            </button>
          </div>
        </div>
        {video.generated_video_url ? (
          <video src={video.generated_video_url} controls autoPlay loop className="w-full aspect-video bg-black">Your browser does not support video playback.</video>
        ) : video.status === 'failed' ? (
          <div className="aspect-video bg-rose-500/[0.04] flex flex-col items-center justify-center gap-2 px-5 text-center">
            <div className="text-[14px] font-medium text-rose-200">Generation failed</div>
            <div className="text-[12px] text-zinc-400 max-w-md">{video.error_message || 'Unknown error'}</div>
          </div>
        ) : (
          <div className="aspect-video bg-purple-500/[0.04] flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-purple-300 animate-spin" strokeWidth={2} />
            <div className="text-[13px] text-zinc-400">Still rendering...</div>
          </div>
        )}
        <div className="px-5 py-4 border-t border-[#141821]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">Prompt</div>
          <div className="text-[13px] text-zinc-300 leading-relaxed">{video.refined_prompt}</div>
          {video.scene_type && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-[10px] font-medium text-purple-300">
              <Sparkles className="w-2.5 h-2.5" strokeWidth={2} />
              {video.scene_type}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewVideo, setPreviewVideo] = useState<VideoData | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchVideos = useCallback(async () => {
    try {
      const res = await fetch('/api/videos');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setVideos(data.videos || []);
    } catch (err) {
      console.error('Fetch videos error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVideos(); }, [fetchVideos]);

  // Auto-refresh while videos are processing
  useEffect(() => {
    const hasProcessing = videos.some((v) => v.status === 'queued' || v.status === 'processing');
    if (!hasProcessing) return;
    const interval = setInterval(fetchVideos, 5000);
    return () => clearInterval(interval);
  }, [videos, fetchVideos]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => setSidebarOpen(e.matches);
    handleChange(mediaQuery);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen && window.innerWidth < 1024) setSidebarOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sidebarOpen]);

  const handleDeleteVideo = async (id: string) => {
    if (!confirm('Delete this video? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setVideos((prev) => prev.filter((v) => v.id !== id));
      if (previewVideo?.id === id) setPreviewVideo(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleDownload = () => {
    if (previewVideo?.generated_video_url) {
      downloadVideo(previewVideo.generated_video_url, `${previewVideo.title || 'riftvid'}.mp4`);
    }
  };

  // Filter + search videos
  const filteredVideos = videos.filter((v) => {
    if (activeFilter === 'completed' && v.status !== 'completed') return false;
    if (activeFilter === 'processing' && v.status !== 'processing' && v.status !== 'queued') return false;
    if (activeFilter === 'failed' && v.status !== 'failed') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const titleMatch = (v.title || '').toLowerCase().includes(q);
      const promptMatch = v.refined_prompt.toLowerCase().includes(q);
      if (!titleMatch && !promptMatch) return false;
    }
    return true;
  });

  // Counts for filter tabs
  const counts = {
    all: videos.length,
    completed: videos.filter((v) => v.status === 'completed').length,
    processing: videos.filter((v) => v.status === 'processing' || v.status === 'queued').length,
    failed: videos.filter((v) => v.status === 'failed').length,
  };

  const filterTabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'completed', label: 'Completed', count: counts.completed },
    { id: 'processing', label: 'Rendering', count: counts.processing },
    { id: 'failed', label: 'Failed', count: counts.failed },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white relative">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="lg:ml-64 relative z-[1]">
        <Topbar onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

        <div className="px-4 sm:px-10 py-6 sm:py-8 max-w-[1400px] fade-up">
          {/* Header */}
          <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/" className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-white/[0.04] transition-colors shrink-0" aria-label="Back">
                <ArrowLeft className="w-[18px] h-[18px] text-zinc-300" strokeWidth={2} />
              </Link>
              <div>
                <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-white">My Library</h1>
                <p className="text-[13px] text-zinc-400 mt-0.5">All your AI-generated videos in one place</p>
              </div>
            </div>
            <button onClick={fetchVideos} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-colors">
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
              Refresh
            </button>
          </div>

          {/* Search bar */}
          <div className="relative mb-5">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" strokeWidth={2} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title or prompt..."
              className="w-full pl-10 pr-4 py-2.5 bg-white/[0.03] border border-[#1f2937] rounded-lg text-[14px] placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all"
            />
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-[#1f2937] mb-6 overflow-x-auto">
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md font-medium whitespace-nowrap transition-all ${
                  activeFilter === tab.id
                    ? 'bg-white/[0.08] text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.03]'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    activeFilter === tab.id ? 'bg-white/[0.1] text-white' : 'bg-white/[0.05] text-zinc-500'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Loader2 className="w-10 h-10 text-purple-400 animate-spin mb-4" strokeWidth={2} />
              <div className="text-[14px] text-zinc-400">Loading your library...</div>
            </div>
          ) : videos.length === 0 ? (
            // Truly empty (no videos at all)
            <div className="rounded-2xl border border-dashed border-[#1f2937] bg-white/[0.01] p-12 sm:p-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4 mx-auto">
                <Film className="w-7 h-7 text-purple-300" strokeWidth={1.75} />
              </div>
              <h3 className="text-[18px] font-semibold text-white mb-1">Your library is empty</h3>
              <p className="text-[13px] text-zinc-400 mb-5 max-w-md mx-auto">
                Create your first AI-generated video. Upload an image, describe the motion, and watch it come alive.
              </p>
              <Link href="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all">
                <Sparkles className="w-3.5 h-3.5" strokeWidth={2.25} />
                Create your first video
              </Link>
            </div>
          ) : filteredVideos.length === 0 ? (
            // Has videos but none match current filter/search
            <div className="rounded-2xl border border-dashed border-[#1f2937] bg-white/[0.01] p-12 text-center">
              <div className="w-12 h-12 rounded-xl bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center mb-3 mx-auto">
                <Search className="w-5 h-5 text-zinc-400" strokeWidth={2} />
              </div>
              <h3 className="text-[14px] font-semibold text-white mb-1">No videos found</h3>
              <p className="text-[12px] text-zinc-400 mb-4">
                {searchQuery.trim() ? `No videos match "${searchQuery}"` : 'No videos in this category'}
              </p>
              <button
                onClick={() => { setActiveFilter('all'); setSearchQuery(''); }}
                className="text-[12px] text-purple-300 hover:text-purple-200 transition-colors font-medium"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div className="text-[12px] text-zinc-500 mb-3">
                Showing {filteredVideos.length} of {videos.length} videos
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
                {filteredVideos.map((video) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    onPlay={() => setPreviewVideo(video)}
                    onDelete={() => handleDeleteVideo(video.id)}
                  />
                ))}
              </div>
            </>
          )}

          <div className="h-16" />
        </div>
      </main>
      <VideoPreviewModal video={previewVideo} onClose={() => setPreviewVideo(null)} onDownload={handleDownload} />
    </div>
  );
}
