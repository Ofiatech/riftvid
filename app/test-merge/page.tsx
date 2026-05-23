'use client';

import { useState, useEffect } from 'react';

interface Project {
  id: string;
  name: string;
  scenes: Scene[];
}

interface Scene {
  id: string;
  scene_order: number;
  name: string | null;
  total_clips: number;
  merge_status?: string;
  merged_video_url?: string | null;
}

interface MergeResult {
  status: 'idle' | 'running' | 'success' | 'error';
  message?: string;
  mergedUrl?: string;
  duration?: number;
  clipsMerged?: number;
}

export default function TestMergePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<string, MergeResult>>({});

  // Fetch all projects + their scenes
  useEffect(() => {
    async function loadProjects() {
      try {
        const projectsRes = await fetch('/api/projects');
        const projectsData = await projectsRes.json();

        const projectsWithScenes: Project[] = [];

        for (const proj of projectsData.projects || []) {
          const detailRes = await fetch(`/api/projects/${proj.id}`);
          if (detailRes.ok) {
            const detail = await detailRes.json();
            projectsWithScenes.push({
              id: detail.id,
              name: detail.name,
              scenes: detail.scenes || [],
            });
          }
        }

        setProjects(projectsWithScenes);
      } catch (err) {
        console.error('Load error:', err);
      } finally {
        setLoading(false);
      }
    }
    loadProjects();
  }, []);

  const handleTestMerge = async (projectId: string, sceneId: string) => {
    const key = `${projectId}:${sceneId}`;
    setResults((prev) => ({
      ...prev,
      [key]: { status: 'running', message: 'Calling Cloudinary... this can take 30-60 seconds' },
    }));

    try {
      const res = await fetch(
        `/api/projects/${projectId}/scenes/${sceneId}/merge`,
        { method: 'POST' }
      );
      const data = await res.json();

      if (!res.ok) {
        setResults((prev) => ({
          ...prev,
          [key]: {
            status: 'error',
            message: data.error || `HTTP ${res.status}`,
          },
        }));
        return;
      }

      setResults((prev) => ({
        ...prev,
        [key]: {
          status: 'success',
          message: 'Merge complete!',
          mergedUrl: data.merged_video_url,
          duration: data.duration,
          clipsMerged: data.clips_merged,
        },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      }));
    }
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.center}>
          <div style={styles.spinner} />
          <p style={styles.muted}>Loading your projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.badge}>🧪 CLOUDINARY MERGE TEST</div>
          <h1 style={styles.title}>Test Scene Merging</h1>
          <p style={styles.subtitle}>
            Pick a scene with 2+ completed clips. Click &quot;Test Merge&quot;.
            We&apos;ll send the clips to Cloudinary and merge them into one video.
          </p>
          <p style={styles.muted}>
            ⏱️ Each merge takes 20–60 seconds. Be patient.
          </p>
        </div>

        {projects.length === 0 ? (
          <div style={styles.emptyBox}>
            <p style={styles.muted}>No projects found. Create a project and scene first.</p>
          </div>
        ) : (
          projects.map((proj) => (
            <div key={proj.id} style={styles.projectCard}>
              <div style={styles.projectName}>📁 {proj.name}</div>

              {proj.scenes.length === 0 ? (
                <div style={styles.muted}>No scenes in this project.</div>
              ) : (
                proj.scenes.map((scene) => {
                  const key = `${proj.id}:${scene.id}`;
                  const result = results[key];
                  const canMerge = scene.total_clips >= 1;

                  return (
                    <div key={scene.id} style={styles.sceneRow}>
                      <div style={styles.sceneInfo}>
                        <div style={styles.sceneName}>
                          🎬 Scene {scene.scene_order}
                          {scene.name && `: ${scene.name}`}
                        </div>
                        <div style={styles.sceneStats}>
                          {scene.total_clips} clip{scene.total_clips !== 1 ? 's' : ''}
                          {scene.merge_status && scene.merge_status !== 'pending' && (
                            <span style={styles.statusPill}>
                              · Merge status: {scene.merge_status}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleTestMerge(proj.id, scene.id)}
                        disabled={!canMerge || result?.status === 'running'}
                        style={{
                          ...styles.button,
                          ...(canMerge && result?.status !== 'running'
                            ? {}
                            : styles.buttonDisabled),
                        }}
                      >
                        {result?.status === 'running'
                          ? '⏳ Merging...'
                          : '🧪 Test Merge'}
                      </button>

                      {result && (
                        <div
                          style={{
                            ...styles.resultBox,
                            ...(result.status === 'success'
                              ? styles.resultSuccess
                              : result.status === 'error'
                              ? styles.resultError
                              : styles.resultRunning),
                          }}
                        >
                          {result.status === 'running' && (
                            <>
                              <div style={styles.smallSpinner} />
                              <span>{result.message}</span>
                            </>
                          )}
                          {result.status === 'success' && (
                            <div>
                              <div style={styles.resultTitle}>✅ Success!</div>
                              <div style={styles.resultDetail}>
                                Merged {result.clipsMerged} clip
                                {result.clipsMerged !== 1 ? 's' : ''} ·{' '}
                                {result.duration?.toFixed(1)}s total
                              </div>
                              {result.mergedUrl && (
                                <div style={{ marginTop: '12px' }}>
                                  <video
                                    src={result.mergedUrl}
                                    controls
                                    style={styles.video}
                                  />
                                  <div style={{ marginTop: '8px' }}>
                                    <a
                                      href={result.mergedUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={styles.link}
                                    >
                                      🔗 Open merged video URL
                                    </a>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {result.status === 'error' && (
                            <div>
                              <div style={styles.resultTitle}>❌ Failed</div>
                              <div style={styles.resultDetail}>
                                {result.message}
                              </div>
                              <div style={styles.muted}>
                                Check your terminal for full error details.
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ))
        )}

        <div style={styles.footer}>
          <p style={styles.muted}>
            💡 This is a temporary test page. Delete{' '}
            <code style={styles.code}>app/test-merge/page.tsx</code> when done.
          </p>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#050505',
    color: '#fff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '24px',
  },
  container: {
    maxWidth: '720px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '32px',
  },
  badge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '20px',
    background: 'rgba(168, 85, 247, 0.15)',
    border: '1px solid rgba(168, 85, 247, 0.3)',
    color: '#c4b5fd',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.1em',
    marginBottom: '12px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 600,
    margin: '0 0 8px 0',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: '14px',
    color: '#a1a1aa',
    lineHeight: 1.6,
    margin: '0 0 8px 0',
  },
  muted: {
    fontSize: '12px',
    color: '#71717a',
    margin: '0',
  },
  emptyBox: {
    padding: '32px',
    borderRadius: '12px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid #1f2937',
    textAlign: 'center',
  },
  projectCard: {
    marginBottom: '24px',
    padding: '20px',
    borderRadius: '16px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid #1f2937',
  },
  projectName: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '16px',
    color: '#fff',
  },
  sceneRow: {
    padding: '14px',
    marginBottom: '8px',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid #1f2937',
  },
  sceneInfo: {
    marginBottom: '10px',
  },
  sceneName: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#fff',
    marginBottom: '4px',
  },
  sceneStats: {
    fontSize: '12px',
    color: '#a1a1aa',
  },
  statusPill: {
    marginLeft: '8px',
    padding: '2px 6px',
    borderRadius: '4px',
    background: 'rgba(168, 85, 247, 0.15)',
    color: '#c4b5fd',
    fontSize: '10px',
    fontWeight: 600,
  },
  button: {
    padding: '10px 16px',
    borderRadius: '10px',
    background: 'linear-gradient(180deg, #a855f7 0%, #9333ea 100%)',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(168, 85, 247, 0.3)',
    transition: 'all 0.15s',
  },
  buttonDisabled: {
    background: 'rgba(255,255,255,0.05)',
    color: '#71717a',
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  resultBox: {
    marginTop: '14px',
    padding: '14px',
    borderRadius: '10px',
    border: '1px solid',
    fontSize: '13px',
  },
  resultRunning: {
    background: 'rgba(168, 85, 247, 0.05)',
    borderColor: 'rgba(168, 85, 247, 0.3)',
    color: '#c4b5fd',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  resultSuccess: {
    background: 'rgba(16, 185, 129, 0.05)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    color: '#a7f3d0',
  },
  resultError: {
    background: 'rgba(244, 63, 94, 0.05)',
    borderColor: 'rgba(244, 63, 94, 0.3)',
    color: '#fda4af',
  },
  resultTitle: {
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '4px',
  },
  resultDetail: {
    fontSize: '12px',
    marginBottom: '4px',
  },
  video: {
    width: '100%',
    maxHeight: '300px',
    borderRadius: '8px',
    background: '#000',
  },
  link: {
    fontSize: '11px',
    color: '#a78bfa',
    textDecoration: 'none',
  },
  code: {
    background: 'rgba(255,255,255,0.05)',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: 'monospace',
  },
  spinner: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: '3px solid rgba(168, 85, 247, 0.2)',
    borderTopColor: '#a855f7',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 12px',
  },
  smallSpinner: {
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    border: '2px solid rgba(168, 85, 247, 0.2)',
    borderTopColor: '#a855f7',
    animation: 'spin 1s linear infinite',
  },
  center: {
    textAlign: 'center',
    padding: '60px 24px',
  },
  footer: {
    marginTop: '40px',
    padding: '20px',
    borderRadius: '12px',
    background: 'rgba(168, 85, 247, 0.05)',
    border: '1px dashed rgba(168, 85, 247, 0.2)',
    textAlign: 'center',
  },
};