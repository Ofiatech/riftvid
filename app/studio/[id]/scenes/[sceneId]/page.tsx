'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, RefreshCw, Loader2, Film, ArrowLeft, Menu, MoreVertical,
  Edit2, Trash2, Clock, Sparkles, Video, AlertCircle, Play,
  Wand2, Upload, Image as ImageIcon, Link2,
} from 'lucide-react';
import Sidebar, { UserProfileData } from '@/components/Sidebar';

interface ClipItem {
  id: string;
  clip_order: number;
  source_image_url: string;
  source_type: 'upload' | 'last_frame' | 'library';
  source_clip_id: string | null;
  refined_prompt: string;
  duration: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  generated_video_url: string | null;
  last_frame_url: string | null;
  error_message: string | null;
  created_at: string;
}

interface SceneDetail {
  id: string;
  scene_order: number;
  name: string | null;
  description: string | null;
  total_clips: number;
  total_duration: number;
  status: string;
  cover_clip_id: string | null;
  project_id: string;
  clips: ClipItem[];
}

interface ParentProject {
  id: string;
  name: string;
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return new Date(iso).toLocaleDateString();
}

function StatusBadge({ status }: { status: ClipItem['status'] }) {
  const config = {
    queued: { label: 'Queued', className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/20', dot: 'bg-zinc-400', pulse: false },
    processing: { label: 'Rendering', className: 'bg-purple-500/15 text-purple-200 border-purple-500/25', dot: 'bg-purple-400', pulse: true },
    completed: { label: 'Ready', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-400', pulse: false },
    failed: { label: 'Failed', className: 'bg-rose-500/15 text-rose-300 border-rose-500/20', dot: 'bg-rose-400', pulse: false },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-md border ${config.className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${config.pulse ? 'animate-pulse' : ''}`} />
      {config.label}
    </span>
  );
}

function ClipTimelineCard({ clip, index, onDelete }: {
  clip: ClipItem;
  index: number;
  onDelete: (id: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="group relative shrink-0 w-[180px] sm:w-[220px]">
      {/* Clip number badge */}
      <div className="absolute -top-2 -left-2 z-10 w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 border-2 border-[#050505] flex items-center justify-center shadow-lg shadow-purple-500/30">
        <span className="text-[11px] font-bold text-white">{index + 1}</span>
      </div>

      <div className="relative aspect-video rounded-xl overflow-hidden border border-[#1f2937] bg-[#0a0a0b] transition-all hover:border-[#2d3748]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={clip.source_image_url} alt={`Clip ${index + 1}`} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />

        {clip.status === 'completed' && clip.generated_video_url && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
            <div className="w-10 h-10 rounded-full bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-xl">
              <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" strokeWidth={0} />
            </div>
          </div>
        )}

        {clip.status === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-purple-300 animate-spin" strokeWidth={2} />
          </div>
        )}

        <div className="absolute top-2 left-2">
          <StatusBadge status={clip.status} />
        </div>

        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md text-[10px] font-medium text-white border border-white/5">
          {clip.duration}s
        </div>

        {clip.source_type === 'last_frame' && (
          <div className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/20 backdrop-blur-md text-[9px] font-semibold text-purple-200 border border-purple-500/30">
            <Link2 className="w-2.5 h-2.5" strokeWidth={2.25} />
            Chain
          </div>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
          className="absolute top-2 right-2 p-1 rounded-md bg-black/40 backdrop-blur-md hover:bg-black/60 border border-white/5 transition-colors opacity-0 group-hover:opacity-100"
        >
          <MoreVertical className="w-3 h-3 text-white" strokeWidth={2} />
        </button>

        {showMenu && (
          <div
            className="absolute top-9 right-2 z-20 rounded-lg bg-[#0a0a0b] border border-[#1f2937] shadow-2xl overflow-hidden min-w-[120px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onDelete(clip.id);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-rose-300 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" strokeWidth={2} />
              Delete clip
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 px-0.5">
        <p className="text-[11px] text-zinc-400 line-clamp-2 leading-tight">{clip.refined_prompt}</p>
        <p className="text-[10px] text-zinc-600 mt-1">{formatRelativeTime(clip.created_at)}</p>
      </div>
    </div>
  );
}

export default function SceneEditorPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const sceneId = params.sceneId as string;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [parentProject, setParentProject] = useState<ParentProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [showSceneMenu, setShowSceneMenu] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');

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

  const fetchScene = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`);
      if (!res.ok) {
        if (res.status === 404) setError('Scene not found');
        else throw new Error('Failed to fetch scene');
        return;
      }
      const data = await res.json();
      setScene(data);
      setEditName(data.name || `Scene ${data.scene_order}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scene');
    } finally {
      setLoading(false);
    }
  }, [projectId, sceneId]);

  const fetchParentProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      setParentProject({ id: data.id, name: data.name });
    } catch (err) {
      console.error('Parent project fetch error:', err);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProfile();
    fetchScene();
    fetchParentProject();
  }, [fetchProfile, fetchScene, fetchParentProject]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) =>
      setSidebarOpen(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Auto-refresh when any clip is processing
  useEffect(() => {
    if (!scene) return;
    const hasProcessing = scene.clips.some(
      (c) => c.status === 'queued' || c.status === 'processing'
    );
    if (!hasProcessing) return;
    const interval = setInterval(fetchScene, 5000);
    return () => clearInterval(interval);
  }, [scene, fetchScene]);

  const handleDeleteClip = async (clipId: string) => {
    if (!confirm('Delete this clip? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}/clips/${clipId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      fetchScene();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleDeleteScene = async () => {
    if (!confirm('Delete this entire scene? All clips inside will be deleted. This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete scene');
      router.push(`/studio/${projectId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleSaveName = async () => {
    if (!scene) return;
    const trimmed = editName.trim();
    const original = scene.name || `Scene ${scene.scene_order}`;
    if (trimmed === original || !trimmed) {
      setEditName(original);
      setEditingName(false);
      return;
    }
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error('Failed to rename');
      setEditingName(false);
      fetchScene();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to rename');
      setEditName(original);
      setEditingName(false);
    }
  };

  const handleAddClipClick = () => {
    // BATCH 2 will implement this — for now just a friendly placeholder
    alert('🚧 Clip generation coming in Session 10 — Batch 2!\n\nYou\'ll be able to:\n• Upload an image\n• Use last-frame chaining\n• Generate AI clips with Rift Assistant\n• All right here in the timeline.');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" strokeWidth={2} />
          <div className="text-[13px] text-zinc-400">Loading scene...</div>
        </div>
      </div>
    );
  }

  if (error || !scene) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 mx-auto">
            <Film className="w-7 h-7 text-rose-300" strokeWidth={1.75} />
          </div>
          <h2 className="text-[20px] font-semibold text-white mb-2">
            {error || 'Scene not found'}
          </h2>
          <p className="text-[13px] text-zinc-400 mb-6">
            This scene may have been deleted.
          </p>
          <Link
            href={`/studio/${projectId}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white text-[13px] font-semibold transition-all"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
            Back to project
          </Link>
        </div>
      </div>
    );
  }

  const sceneName = scene.name || `Scene ${scene.scene_order}`;
  const hasClips = scene.clips.length > 0;
  const lastCompletedClip = [...scene.clips].reverse().find(
    (c) => c.status === 'completed' && c.last_frame_url
  );
  const canChain = !!lastCompletedClip;

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

            <Link
              href={`/studio/${projectId}`}
              className="flex items-center gap-2 text-[13px] text-zinc-400 hover:text-white transition-colors min-w-0"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" strokeWidth={2} />
              <span className="hidden sm:inline truncate">
                {parentProject?.name || 'Project'}
              </span>
            </Link>

            <div className="flex items-center gap-2 shrink-0 ml-auto">
              <button
                onClick={handleAddClipClick}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2.25} />
                <span className="hidden sm:inline">Add Clip</span>
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-10 py-6 sm:py-8 max-w-[1400px]">
          {/* Scene header */}
          <div className="mb-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[10px] font-semibold uppercase tracking-wider text-purple-300 mb-2">
                  <Film className="w-2.5 h-2.5" strokeWidth={2.5} />
                  Scene {scene.scene_order}
                </div>
                {editingName ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={handleSaveName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName();
                      if (e.key === 'Escape') {
                        setEditName(sceneName);
                        setEditingName(false);
                      }
                    }}
                    autoFocus
                    maxLength={100}
                    className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-white bg-white/[0.04] border border-purple-500/30 rounded-lg px-3 py-1 w-full focus:outline-none focus:border-purple-500/60"
                  />
                ) : (
                  <button
                    onClick={() => setEditingName(true)}
                    className="text-left group/title block"
                  >
                    <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-white inline-flex items-center gap-2">
                      {sceneName}
                      <Edit2 className="w-4 h-4 text-zinc-600 opacity-0 group-hover/title:opacity-100 transition-opacity" strokeWidth={2} />
                    </h1>
                  </button>
                )}
                {scene.description && (
                  <p className="text-[13px] text-zinc-400 mt-2">{scene.description}</p>
                )}
                <div className="flex items-center gap-3 text-[12px] text-zinc-500 mt-3">
                  <span className="flex items-center gap-1">
                    <Video className="w-3 h-3" strokeWidth={2} />
                    {scene.total_clips} {scene.total_clips === 1 ? 'clip' : 'clips'}
                  </span>
                  <div className="w-1 h-1 rounded-full bg-zinc-700" />
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" strokeWidth={2} />
                    {formatDuration(scene.total_duration)}
                  </span>
                </div>
              </div>

              <div className="relative shrink-0">
                <button
                  onClick={() => setShowSceneMenu(!showSceneMenu)}
                  className="p-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                >
                  <MoreVertical className="w-5 h-5 text-zinc-400" strokeWidth={2} />
                </button>
                {showSceneMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowSceneMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-20 rounded-lg bg-[#0a0a0b] border border-[#1f2937] shadow-2xl overflow-hidden min-w-[180px]">
                      <button
                        onClick={() => {
                          setShowSceneMenu(false);
                          setEditingName(true);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-zinc-300 hover:bg-white/[0.05] transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" strokeWidth={2} />
                        Rename scene
                      </button>
                      <button
                        onClick={() => {
                          setShowSceneMenu(false);
                          handleDeleteScene();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-rose-300 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                        Delete scene
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Last-frame chaining indicator */}
          {canChain && (
            <div className="mb-6 rounded-xl border border-purple-500/20 bg-gradient-to-r from-purple-500/[0.05] to-blue-500/[0.03] p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0">
                  <Link2 className="w-4 h-4 text-purple-300" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-white mb-0.5">
                    Last-frame chaining ready
                  </div>
                  <div className="text-[12px] text-zinc-400">
                    Your next clip can continue seamlessly from clip {scene.clips.findIndex((c) => c.id === lastCompletedClip?.id) + 1}.
                    The AI will use its final frame as the starting image.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Clip timeline */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-medium text-zinc-500 uppercase tracking-wider">
                Clip Timeline
              </h2>
              <button
                onClick={fetchScene}
                className="flex items-center gap-1 text-[12px] text-zinc-400 hover:text-white transition-colors font-medium"
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                Refresh
              </button>
            </div>

            {!hasClips ? (
              <div className="rounded-2xl border border-dashed border-[#1f2937] bg-gradient-to-br from-purple-500/[0.03] to-blue-500/[0.02] p-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4 mx-auto">
                  <Sparkles className="w-7 h-7 text-purple-300" strokeWidth={1.75} />
                </div>
                <h3 className="text-[16px] font-semibold text-white mb-2">
                  Add your first clip
                </h3>
                <p className="text-[13px] text-zinc-400 mb-5 max-w-md mx-auto">
                  Each clip is 5-10 seconds of AI-generated video. Chain multiple
                  clips together to build this scene.
                </p>
                <button
                  onClick={handleAddClipClick}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
                >
                  <Wand2 className="w-3.5 h-3.5" strokeWidth={2.25} />
                  Generate first clip
                </button>
              </div>
            ) : (
              <div className="relative">
                {/* Horizontal scrollable timeline */}
                <div className="overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
                  <div className="flex items-start gap-4 min-w-min">
                    {scene.clips.map((clip, idx) => (
                      <ClipTimelineCard
                        key={clip.id}
                        clip={clip}
                        index={idx}
                        onDelete={handleDeleteClip}
                      />
                    ))}

                    {/* Add clip button at end of timeline */}
                    <button
                      onClick={handleAddClipClick}
                      className="shrink-0 w-[180px] sm:w-[220px] aspect-video rounded-xl border-2 border-dashed border-purple-500/30 bg-purple-500/[0.03] hover:bg-purple-500/[0.08] hover:border-purple-500/50 flex flex-col items-center justify-center gap-2 transition-all group"
                    >
                      <div className="w-10 h-10 rounded-full bg-purple-500/15 border border-purple-500/25 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Plus className="w-5 h-5 text-purple-300" strokeWidth={2.25} />
                      </div>
                      <div className="text-[12px] font-semibold text-purple-200">
                        Add next clip
                      </div>
                      {canChain && (
                        <div className="text-[10px] text-purple-300/70 flex items-center gap-1">
                          <Link2 className="w-2.5 h-2.5" strokeWidth={2} />
                          Will chain from previous
                        </div>
                      )}
                    </button>
                  </div>
                </div>

                {/* Scroll hint */}
                {scene.clips.length > 2 && (
                  <div className="text-[10px] text-zinc-600 text-center mt-1 sm:hidden">
                    ← swipe to see all clips →
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tips section for empty timeline */}
          {!hasClips && (
            <div className="mt-8 rounded-xl border border-[#1f2937] bg-white/[0.01] p-5">
              <h3 className="text-[13px] font-semibold text-white mb-3 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-purple-300" strokeWidth={2} />
                How Rift Studio scenes work
              </h3>
              <div className="space-y-2.5 text-[12px] text-zinc-400">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0 text-[10px] font-semibold text-purple-300">1</div>
                  <div>Upload an image and describe motion to generate your first clip (5-10s).</div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0 text-[10px] font-semibold text-purple-300">2</div>
                  <div>Next clip can <span className="text-purple-300 font-medium">chain from the last frame</span> — seamless continuity.</div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0 text-[10px] font-semibold text-purple-300">3</div>
                  <div>Stack clips to build a full scene. Stack scenes to build a full movie.</div>
                </div>
              </div>
            </div>
          )}

          <div className="h-16" />
        </div>
      </main>
    </div>
  );
}