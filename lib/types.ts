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