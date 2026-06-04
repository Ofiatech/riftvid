'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, RefreshCw, Loader2, Film, ArrowLeft, Menu, MoreVertical,
  Edit2, Trash2, Clock, Sparkles, Share2,
} from 'lucide-react';
import Sidebar, { UserProfileData } from '@/components/Sidebar';
import SceneCard from '@/components/SceneCard';
import NewSceneModal from '@/components/NewSceneModal';
import ExportSheet from '@/components/ExportSheet';

interface SceneItem {
  id: string;
  scene_order: number;
  name: string | null;
  description: string | null;
  total_clips: number;
  total_duration: number;
  status: string;
  cover_clip_id: string | null;
  // Merge fields — used by ExportSheet to know which scenes are ready to share.
  // The /api/projects/[id] GET already returns these from the DB.
  merge_status: string | null;
  merged_video_url: string | null;
}

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  total_scenes: number;
  total_clips: number;
  total_duration: number;
  cover_image_url: string | null;
  created_at: string;
  scenes: SceneItem[];
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [editing, setEditing] = useState(false);
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

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError('Project not found');
        } else {
          throw new Error('Failed to fetch project');
        }
        return;
      }
      const data = await res.json();
      setProject(data);
      setEditName(data.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProfile();
    fetchProject();
  }, [fetchProfile, fetchProject]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) =>
      setSidebarOpen(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleDeleteScene = async (sceneId: string) => {
    if (!confirm('Delete this scene? All clips inside will be deleted too. This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete scene');
      fetchProject();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete scene');
    }
  };

  const handleDeleteProject = async () => {
    if (!confirm('Delete this entire project? All scenes and clips will be deleted. This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete project');
      router.push('/projects');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  const handleSaveRename = async () => {
    if (!project || editName.trim() === project.name) {
      setEditing(false);
      return;
    }
    if (!editName.trim()) {
      setEditName(project.name);
      setEditing(false);
      return;
    }
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to rename');
      setEditing(false);
      fetchProject();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to rename');
      setEditName(project.name);
      setEditing(false);
    }
  };

  const handleSceneCreated = () => {
    fetchProject();
  };

  // Error states
  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" strokeWidth={2} />
          <div className="text-[13px] text-zinc-400">Loading project...</div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 mx-auto">
            <Film className="w-7 h-7 text-rose-300" strokeWidth={1.75} />
          </div>
          <h2 className="text-[20px] font-semibold text-white mb-2">
            {error || 'Project not found'}
          </h2>
          <p className="text-[13px] text-zinc-400 mb-6">
            This project may have been deleted or you don&apos;t have access.
          </p>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white text-[13px] font-semibold transition-all"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
            Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  const nextSceneNumber = project.total_scenes + 1;

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
              href="/projects"
              className="flex items-center gap-2 text-[13px] text-zinc-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={2} />
              <span className="hidden sm:inline">Projects</span>
            </Link>

            <div className="flex items-center gap-2 shrink-0 ml-auto">
              <button
                onClick={() => setExportOpen(true)}
                disabled={!project || project.scenes.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-[#1f2937] hover:border-[#2d3748] text-white text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Export project"
              >
                <Share2 className="w-3.5 h-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">Export</span>
              </button>
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2.25} />
                <span className="hidden sm:inline">Add Scene</span>
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-10 py-6 sm:py-8 max-w-[1400px]">
          {/* Project header */}
          <div className="mb-8">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1 min-w-0">
                {editing ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={handleSaveRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename();
                      if (e.key === 'Escape') {
                        setEditName(project.name);
                        setEditing(false);
                      }
                    }}
                    autoFocus
                    maxLength={100}
                    className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-white bg-white/[0.04] border border-purple-500/30 rounded-lg px-3 py-1 w-full focus:outline-none focus:border-purple-500/60"
                  />
                ) : (
                  <button
                    onClick={() => setEditing(true)}
                    className="text-left group/title"
                  >
                    <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-white mb-2 inline-flex items-center gap-2">
                      {project.name}
                      <Edit2 className="w-4 h-4 text-zinc-600 opacity-0 group-hover/title:opacity-100 transition-opacity" strokeWidth={2} />
                    </h1>
                  </button>
                )}
                {project.description && (
                  <p className="text-[14px] text-zinc-400 mb-3">{project.description}</p>
                )}
                <div className="flex items-center gap-3 text-[12px] text-zinc-500">
                  <span>{formatDate(project.created_at)}</span>
                  <div className="w-1 h-1 rounded-full bg-zinc-700" />
                  <span>{project.total_scenes} {project.total_scenes === 1 ? 'scene' : 'scenes'}</span>
                  <div className="w-1 h-1 rounded-full bg-zinc-700" />
                  <span>{project.total_clips} {project.total_clips === 1 ? 'clip' : 'clips'}</span>
                  <div className="w-1 h-1 rounded-full bg-zinc-700" />
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" strokeWidth={2} />
                    {formatDuration(project.total_duration)}
                  </span>
                </div>
              </div>

              {/* Project actions menu */}
              <div className="relative shrink-0">
                <button
                  onClick={() => setShowProjectMenu(!showProjectMenu)}
                  className="p-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                >
                  <MoreVertical className="w-5 h-5 text-zinc-400" strokeWidth={2} />
                </button>
                {showProjectMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowProjectMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-20 rounded-lg bg-[#0a0a0b] border border-[#1f2937] shadow-2xl overflow-hidden min-w-[180px]">
                      <button
                        onClick={() => {
                          setShowProjectMenu(false);
                          setEditing(true);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-zinc-300 hover:bg-white/[0.05] transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" strokeWidth={2} />
                        Rename project
                      </button>
                      <button
                        onClick={() => {
                          setShowProjectMenu(false);
                          handleDeleteProject();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-rose-300 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                        Delete project
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Scenes section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-medium text-zinc-500 uppercase tracking-wider">
                Scenes
              </h2>
              <button
                onClick={fetchProject}
                className="flex items-center gap-1 text-[12px] text-zinc-400 hover:text-white transition-colors font-medium"
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                Refresh
              </button>
            </div>

            {project.scenes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#1f2937] bg-white/[0.01] p-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4 mx-auto">
                  <Sparkles className="w-7 h-7 text-purple-300" strokeWidth={1.75} />
                </div>
                <h3 className="text-[16px] font-semibold text-white mb-2">
                  Add your first scene
                </h3>
                <p className="text-[13px] text-zinc-400 mb-5 max-w-md mx-auto">
                  Scenes group your AI-generated clips into narrative chunks. Think
                  of them like chapters in a story.
                </p>
                <button
                  onClick={() => setModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" strokeWidth={2.25} />
                  Add Scene
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {project.scenes.map((scene) => (
                  <SceneCard
                    key={scene.id}
                    scene={scene}
                    projectId={projectId}
                    onDelete={handleDeleteScene}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="h-16" />
        </div>
      </main>

      <NewSceneModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        projectId={projectId}
        nextSceneNumber={nextSceneNumber}
        onCreated={handleSceneCreated}
      />

      <ExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        mode="project"
        projectName={project.name}
        scenes={project.scenes.map((s) => ({
          id: s.id,
          name: s.name,
          sceneOrder: s.scene_order,
          totalDuration: s.total_duration,
          mergeStatus: s.merge_status ?? 'idle',
          mergedVideoUrl: s.merged_video_url,
        }))}
        tier={profile?.subscription_tier ?? 'free'}
        onUpgradeClick={() => {
          // PHASE 2 — wire to Flutterwave tier picker
          // For now, just acknowledge with a placeholder. This gets replaced
          // by the real TierPickerModal once payments are wired.
          alert(
            '🚀 Upgrade coming next — Flutterwave checkout is being built right after Export.'
          );
        }}
      />
    </div>
  );
}
