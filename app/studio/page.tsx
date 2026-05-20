'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Loader2, Film, Search, Bell, Menu, Sparkles } from 'lucide-react';
import Sidebar, { UserProfileData } from '@/components/Sidebar';
import ProjectCard from '@/components/ProjectCard';
import NewProjectModal from '@/components/NewProjectModal';
import { useRouter } from 'next/navigation';

interface ProjectListItem {
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

export default function StudioPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfileData | null>(null);

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

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (err) {
      console.error('Fetch projects error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    fetchProjects();
  }, [fetchProfile, fetchProjects]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) =>
      setSidebarOpen(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this project? All scenes and clips inside will be deleted too. This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleCreated = (projectId: string) => {
    router.push(`/studio/${projectId}`);
  };

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
                  placeholder="Search Rift Studio projects..."
                  className="w-full pl-10 pr-4 py-2 bg-white/[0.03] border border-[#1f2937] rounded-lg text-[13px] placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="relative p-2 rounded-lg hover:bg-white/[0.04] transition-colors">
                <Bell className="w-[18px] h-[18px] text-zinc-400" strokeWidth={1.75} />
              </button>
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2.25} />
                <span className="hidden sm:inline">New Project</span>
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-10 py-6 sm:py-8 max-w-[1400px]">
          {/* Header — Rift Studio branded */}
          <div className="mb-8">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/20 text-[10px] font-semibold uppercase tracking-wider text-purple-300 mb-3">
              <Sparkles className="w-3 h-3" strokeWidth={2} />
              Rift Studio
            </div>
            <h1 className="text-[28px] sm:text-[36px] font-semibold tracking-tight text-white mb-2">
              Direct Your AI Movie Production
            </h1>
            <p className="text-[14px] text-zinc-400 max-w-2xl">
              Build multi-scene cinematic stories with continuity, character memory,
              and production-ready workflows. Each project is a complete narrative
              you control scene by scene.
            </p>
          </div>

          {/* Actions row */}
          <div className="flex items-center justify-between mb-6">
            <div className="text-[13px] text-zinc-500">
              {!loading && (
                <>
                  {projects.length === 0
                    ? 'No projects yet'
                    : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}
                </>
              )}
            </div>
            <button
              onClick={fetchProjects}
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
              <div className="text-[13px] text-zinc-400">Loading your projects...</div>
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#1f2937] bg-gradient-to-br from-purple-500/[0.04] to-blue-500/[0.02] p-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4 mx-auto">
                <Film className="w-7 h-7 text-purple-300" strokeWidth={1.75} />
              </div>
              <h3 className="text-[18px] font-semibold text-white mb-2">
                Start your first production
              </h3>
              <p className="text-[13px] text-zinc-400 mb-6 max-w-md mx-auto">
                Build a multi-scene movie one clip at a time. Riftvid will guide you
                through scene creation, character continuity, and final export.
              </p>
              <button
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
              >
                <Plus className="w-4 h-4" strokeWidth={2.25} />
                Create your first project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <NewProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}