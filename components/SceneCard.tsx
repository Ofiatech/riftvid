'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Film, Clock, Trash2, MoreVertical, ChevronRight, Play,
} from 'lucide-react';

interface SceneCardData {
  id: string;
  scene_order: number;
  name: string | null;
  description: string | null;
  total_clips: number;
  total_duration: number;
  status: string;
  cover_clip_id: string | null;
}

interface SceneCardProps {
  scene: SceneCardData;
  projectId: string;
  onDelete: (sceneId: string) => void;
}

function formatTotalDuration(seconds: number): string {
  if (seconds === 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export default function SceneCard({ scene, projectId, onDelete }: SceneCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const sceneName = scene.name || `Scene ${scene.scene_order}`;
  const isCompleted = scene.status === 'completed';
  const hasClips = scene.total_clips > 0;

  return (
    <Link
  href={`/studio/${projectId}/scenes/${scene.id}`}
      className="group relative flex items-stretch gap-4 rounded-2xl border border-[#1f2937] bg-[#0a0a0b] p-4 transition-all duration-300 hover:border-[#2d3748] hover:bg-[#0d0d10]"
    >
      {/* Scene number badge */}
      <div className="shrink-0 flex flex-col items-center justify-center w-14 rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/5 border border-purple-500/20">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-300/70">
          Scene
        </div>
        <div className="text-[20px] font-bold text-purple-200 leading-none mt-0.5">
          {scene.scene_order}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-[15px] font-semibold text-white truncate group-hover:text-purple-200 transition-colors">
            {sceneName}
          </h3>
          {isCompleted && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
              ✓ Done
            </span>
          )}
        </div>

        {scene.description && (
          <p className="text-[12px] text-zinc-500 line-clamp-1 mb-2">
            {scene.description}
          </p>
        )}

        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          {hasClips ? (
            <>
              <div className="flex items-center gap-1">
                <Film className="w-3 h-3" strokeWidth={2} />
                <span>{scene.total_clips} {scene.total_clips === 1 ? 'clip' : 'clips'}</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-zinc-700" />
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" strokeWidth={2} />
                <span>{formatTotalDuration(scene.total_duration)}</span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-amber-400/80 italic">
              Empty — add your first clip
            </div>
          )}
        </div>
      </div>

      {/* Right side actions */}
      <div className="shrink-0 flex items-center gap-2">
        {hasClips && (
          <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity">
            <Play className="w-3.5 h-3.5 text-purple-300 fill-purple-300/50 ml-0.5" strokeWidth={0} />
          </div>
        )}

        <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-purple-300 group-hover:translate-x-0.5 transition-all" strokeWidth={2} />

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="p-1.5 rounded-md hover:bg-white/[0.05] transition-colors"
        >
          <MoreVertical className="w-4 h-4 text-zinc-500" strokeWidth={2} />
        </button>

        {showMenu && (
          <div
            className="absolute right-4 top-full mt-1 z-10 rounded-lg bg-[#0a0a0b] border border-[#1f2937] shadow-2xl overflow-hidden min-w-[140px]"
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
                onDelete(scene.id);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-rose-300 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
              Delete scene
            </button>
          </div>
        )}
      </div>
    </Link>
  );
}