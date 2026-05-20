'use client';

import Link from 'next/link';
import { Film, Clock, Trash2, MoreVertical } from 'lucide-react';
import { useState } from 'react';

interface ProjectCardData {
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

interface ProjectCardProps {
  project: ProjectCardData;
  onDelete: (id: string) => void;
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

function formatTotalDuration(seconds: number): string {
  if (seconds === 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function getStatusBadge(status: string) {
  const config: Record<string, { label: string; className: string }> = {
    draft: { label: 'Draft', className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/20' },
    in_progress: { label: 'In Progress', className: 'bg-purple-500/15 text-purple-200 border-purple-500/25' },
    completed: { label: 'Completed', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20' },
    archived: { label: 'Archived', className: 'bg-amber-500/15 text-amber-300 border-amber-500/20' },
  };
  return config[status] || config.draft;
}

export default function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const statusConfig = getStatusBadge(project.status);

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group relative block rounded-2xl border border-[#1f2937] bg-[#0a0a0b] overflow-hidden transition-all duration-300 hover:border-[#2d3748] hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-purple-500/10"
    >
      {/* Cover image area */}
      <div className="relative aspect-video bg-gradient-to-br from-purple-500/10 via-[#0a0a0b] to-blue-500/10 overflow-hidden">
        {project.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.cover_image_url}
            alt={project.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Film className="w-12 h-12 text-purple-300/30" strokeWidth={1.5} />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

        {/* Status badge */}
        <div className="absolute top-2.5 left-2.5">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-md border ${statusConfig.className}`}
          >
            {statusConfig.label}
          </span>
        </div>

        {/* Menu button */}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-black/40 backdrop-blur-md hover:bg-black/60 border border-white/5 transition-colors opacity-0 group-hover:opacity-100"
        >
          <MoreVertical className="w-3.5 h-3.5 text-white" strokeWidth={2} />
        </button>

        {showMenu && (
          <div
            className="absolute top-10 right-2.5 z-10 rounded-lg bg-[#0a0a0b] border border-[#1f2937] shadow-2xl overflow-hidden min-w-[140px]"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowMenu(false);
                onDelete(project.id);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-rose-300 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
              Delete project
            </button>
          </div>
        )}

        {/* Stats overlay at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-3 flex items-center gap-3 text-[11px] text-white/90">
          <div className="flex items-center gap-1">
            <Film className="w-3 h-3" strokeWidth={2} />
            <span>{project.total_scenes} scenes</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-white/30" />
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" strokeWidth={2} />
            <span>{formatTotalDuration(project.total_duration)}</span>
          </div>
        </div>
      </div>

      {/* Bottom info */}
      <div className="p-4">
        <h3 className="text-[14px] font-semibold text-white truncate group-hover:text-purple-200 transition-colors mb-1">
          {project.name}
        </h3>
        {project.description && (
          <p className="text-[12px] text-zinc-500 line-clamp-2 mb-2">{project.description}</p>
        )}
        <p className="text-[11px] text-zinc-600">{formatRelativeTime(project.updated_at)}</p>
      </div>
    </Link>
  );
}