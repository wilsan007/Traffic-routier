'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { HlsPlayer } from '@/components/HlsPlayer';
import { EmptyState, LoadingSpinner } from '@/components/Feedback';

interface CameraDiag {
  id: string;
  name: string;
  type: string;
  latitude?: number | null;
  longitude?: number | null;
  streamUrl?: string | null;
  recordingEnabled: boolean;
  lastSeenAt?: string | null;
  active: boolean;
  online: boolean;
  region: { name: string };
  stream: { configured: boolean; ready?: boolean; readers?: number };
}

export default function CamerasPage() {
  const { user } = useAuth();
  const [cameras, setCameras] = useState<CameraDiag[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);
  const [editStream, setEditStream] = useState<{ id: string; url: string } | null>(null);
  const canEdit = ['ADMIN', 'SUPERVISOR', 'TECHNICIAN'].includes(user?.role ?? '');

  const refresh = useCallback(async () => {
    try {
      setCameras(await api.get<CameraDiag[]>('/cameras/diagnostics'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 20_000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function saveStreamUrl() {
    if (!editStream) return;
    await api.patch(`/cameras/${editStream.id}`, { streamUrl: editStream.url || undefined });
    setEditStream(null);
    refresh();
  }

  async function toggleRecording(camera: CameraDiag) {
    await api.patch(`/cameras/${camera.id}`, { recordingEnabled: !camera.recordingEnabled });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Caméras & appareils</h2>
        <p className="page-subtitle">
          Configuration des flux, surveillance vidéo en direct, enregistrement et diagnostics.
        </p>
      </div>

      {loading && <LoadingSpinner label="Chargement des caméras…" />}
      {!loading && cameras.length === 0 && (
        <div className="card"><EmptyState message="Aucune caméra enregistrée." /></div>
      )}

      <div className="grid gap-5 grid-cols-1 md:grid-cols-2">
        {cameras.map((camera) => (
          <div key={camera.id} className="card animate-in space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold">{camera.name}</h3>
                <p className="text-xs text-slate-400">
                  {camera.type === 'FIXED' ? 'Fixe' : 'Mobile'} · {camera.region.name}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${camera.online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${camera.online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  {camera.online ? 'En ligne' : 'Hors ligne'}
                </span>
                {camera.stream.configured && (
                  <span className={`badge ${camera.stream.ready ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                    Flux {camera.stream.ready ? 'prêt' : 'en attente'}
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Dernière activité :{' '}
              {camera.lastSeenAt ? new Date(camera.lastSeenAt).toLocaleString('fr-FR') : 'jamais'}
              {camera.stream.readers ? ` · ${camera.stream.readers} spectateur(s)` : ''}
            </p>

            {playing === camera.id && camera.stream.configured ? (
              <HlsPlayer cameraId={camera.id} />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-400">
                {camera.stream.configured ? 'Flux vidéo disponible' : 'Aucun flux configuré'}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {camera.stream.configured && (
                <button
                  className="btn-primary px-3 py-1.5 text-xs"
                  onClick={() => setPlaying(playing === camera.id ? null : camera.id)}
                >
                  {playing === camera.id ? '⏹ Arrêter' : '▶ Regarder en direct'}
                </button>
              )}
              {canEdit && (
                <>
                  <button
                    className="btn-secondary px-3 py-1.5 text-xs"
                    onClick={() => setEditStream({ id: camera.id, url: camera.streamUrl ?? '' })}
                  >
                    ⚙️ Flux RTSP
                  </button>
                  <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => toggleRecording(camera)}>
                    {camera.recordingEnabled ? '🔴 Enregistrement ON' : '⚪ Enregistrement OFF'}
                  </button>
                </>
              )}
            </div>

            {editStream?.id === camera.id && (
              <div className="animate-in flex flex-col gap-2 sm:flex-row">
                <input
                  className="input font-mono text-xs"
                  placeholder="rtsp://utilisateur:mdp@ip:554/stream"
                  value={editStream.url}
                  onChange={(e) => setEditStream({ ...editStream, url: e.target.value })}
                />
                <button className="btn-primary shrink-0 px-3 text-xs" onClick={saveStreamUrl}>
                  Enregistrer
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
