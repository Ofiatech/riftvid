// Shared types for Riftvid video library

export type VideoStatusDB = 'queued' | 'processing' | 'completed' | 'failed';

export interface VideoRecord {
  id: string;
  user_id: string;
  base_prompt: string | null;
  refined_prompt: string;
  rift_used: boolean;
  rift_answers: unknown | null; // jsonb
  scene_type: string | null;
  scene_description: string | null;
  duration: 5 | 10;
  source_image_url: string;
  generated_video_url: string | null;
  fal_request_id: string | null;
  status: VideoStatusDB;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  title: string | null;
}

// What the client sends when starting a generation
export interface CreateVideoRequest {
  basePrompt?: string | null;
  refinedPrompt: string;
  riftUsed: boolean;
  riftAnswers?: unknown;
  sceneType?: string | null;
  sceneDescription?: string | null;
  duration: 5 | 10;
  sourceImageBase64?: string; // base64 data URL
  sourceImageUrl?: string; // OR external URL
}

// Friendly title generator from prompt
export function generateTitleFromPrompt(prompt: string): string {
  const cleaned = prompt
    .trim()
    .replace(/^[^a-zA-Z0-9]+/, '')
    .slice(0, 60);
  if (cleaned.length === 0) return 'Untitled video';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// ============================================================================
// SEQUENCER TYPES (v1 — Path C)
// ============================================================================

export type ProjectStatus = 'draft' | 'in_progress' | 'completed' | 'archived';
export type SceneStatus = 'draft' | 'completed';
export type ClipStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type ClipSourceType = 'upload' | 'last_frame' | 'library';

// PROJECT RECORD (from DB)
export interface ProjectRecord {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  total_scenes: number;
  total_clips: number;
  total_duration: number;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

// SCENE RECORD (from DB)
export interface SceneRecord {
  id: string;
  project_id: string;
  user_id: string;
  scene_order: number;
  name: string | null;
  description: string | null;
  total_clips: number;
  total_duration: number;
  cover_clip_id: string | null;
  status: SceneStatus;
  created_at: string;
  updated_at: string;
}

// CLIP RECORD (from DB)
export interface ClipRecord {
  id: string;
  scene_id: string;
  project_id: string;
  user_id: string;
  clip_order: number;
  source_image_url: string;
  source_type: ClipSourceType;
  source_clip_id: string | null;
  base_prompt: string | null;
  refined_prompt: string;
  rift_used: boolean;
  rift_answers: unknown | null;
  scene_description: string | null;
  duration: 5 | 10;
  status: ClipStatus;
  fal_request_id: string | null;
  generated_video_url: string | null;
  last_frame_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// REQUEST SHAPES (client → API)
export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  status?: ProjectStatus;
}

// RESPONSE SHAPES (API → client)
export interface ProjectWithCounts extends ProjectRecord {
  // Same as ProjectRecord — counts already in DB
}

export interface ProjectWithScenes extends ProjectRecord {
  scenes: SceneRecord[];
}

// Helper: friendly default project name
export function generateDefaultProjectName(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  return `Untitled Project · ${dateStr}`;
}