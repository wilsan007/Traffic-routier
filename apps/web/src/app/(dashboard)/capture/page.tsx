'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { API_URL } from '@/lib/api';
import { getToken } from '@/lib/api';
import { LoadingSpinner, ErrorBanner, EmptyState } from '@/components/Feedback';

interface ScanResult {
  capture: { id: string; plateNumberNormalized: string; confidence: number; imageUrl: string } | null;
  plateNumberNormalized: string;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  vehicleMatch: { id: string; plateNumber: string; make?: string; model?: string; stolen: boolean } | null;
  hotlistAlerts: { id: string; hotlistEntry: { reason: string; priority: string } }[];
  persisted: boolean;
}

export default function WebCapturePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [livePlate, setLivePlate] = useState<string | null>(null);
  const [liveConfidence, setLiveConfidence] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [continuous, setContinuous] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const continuousRef = useRef(false);
  const scanningRef = useRef(false);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
    } catch {
      setError('Impossible d\'accéder à la caméra. Vérifiez les permissions du navigateur.');
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setActive(false);
    setContinuous(false);
    continuousRef.current = false;
  }

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    scanningRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8),
      );
      if (!blob) return;

      const form = new FormData();
      form.append('image', blob, 'capture.jpg');

      const token = getToken();
      const res = await fetch(`${API_URL}/captures/scan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error('Échec de l\'analyse');
      const data: ScanResult = await res.json();
      setResult(data);
      setScanCount((c) => c + 1);

      if (data.plateNumberNormalized) {
        setLivePlate(data.plateNumberNormalized);
        setLiveConfidence(data.confidence);
      } else {
        setLivePlate(null);
      }

      if (data.hotlistAlerts.length > 0 && continuousRef.current) {
        continuousRef.current = false;
        setContinuous(false);
      }
    } catch (err) {
      if (!continuousRef.current) {
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      }
    } finally {
      setLoading(false);
      scanningRef.current = false;
    }
  }, []);

  useEffect(() => {
    continuousRef.current = continuous;
    if (!continuous) return;
    const interval = setInterval(() => {
      if (!scanningRef.current) captureAndAnalyze();
    }, 1000);
    return () => clearInterval(interval);
  }, [continuous, captureAndAnalyze]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="page-title">Capture terrain</h2>
          <p className="page-subtitle">
            Utilisez la caméra du laptop pour scanner une plaque, vérifier la hotlist et verbaliser.
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="card overflow-hidden">
        <div className="relative aspect-video bg-slate-900">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
          />
          <canvas ref={canvasRef} className="hidden" />
          {!active && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <p className="text-sm text-slate-300">Caméra inactive</p>
              <button className="btn-primary" onClick={startCamera}>
                Activer la caméra
              </button>
            </div>
          )}
          {active && loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <LoadingSpinner label="Analyse…" />
            </div>
          )}
          {livePlate && (
            <div className="absolute left-3 top-3 rounded-lg bg-slate-900/85 px-3 py-2 text-center">
              <p className="font-mono text-xl font-bold tracking-wider text-white">{livePlate}</p>
              <p className="text-xs text-slate-400">
                {(liveConfidence * 100).toFixed(0)}% · {continuous ? 'scan live 1 fps' : 'capture manuelle'}
              </p>
            </div>
          )}
          {continuous && (
            <div className="absolute left-3 bottom-3 rounded-lg bg-brand-500/90 px-3 py-1.5 text-xs font-semibold text-white">
              🔍 Scan live — {scanCount} vérification(s) · éphémère
            </div>
          )}
        </div>

        {active && (
          <div className="flex flex-wrap items-center gap-3 p-4">
            <button
              className="btn-primary"
              onClick={captureAndAnalyze}
              disabled={loading || continuous}
            >
              📷 Capturer et analyser
            </button>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={continuous}
                onChange={(e) => {
                  setContinuous(e.target.checked);
                  if (e.target.checked) setScanCount(0);
                }}
                disabled={loading}
              />
              Scan live (1 fps)
            </label>
            <button className="btn-secondary ml-auto" onClick={stopCamera}>
              Arrêter la caméra
            </button>
          </div>
        )}
      </div>

      {result && (
        <div className="card animate-in space-y-3">
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-lg font-bold tracking-wider text-slate-900">
              {result.plateNumberNormalized || 'Aucune plaque'}
            </span>
            <span className="text-sm text-slate-500">
              Confiance : {(result.confidence * 100).toFixed(0)}%
              {result.persisted ? ' · ⚠️ Sauvegardée (alerte)' : ' · Éphémère'}
            </span>
          </div>
          {result.vehicleMatch ? (
            <p className="text-sm font-medium text-slate-700">
              {result.vehicleMatch.make} {result.vehicleMatch.model}
              {result.vehicleMatch.stolen && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                  SIGNALÉ VOLÉ
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm text-slate-400">Aucun véhicule correspondant en base.</p>
          )}
          {result.hotlistAlerts.length > 0 && (
            <div className="rounded-xl bg-red-50 p-3">
              <p className="text-sm font-bold text-red-700">⚠️ Correspondance liste de surveillance</p>
              {result.hotlistAlerts.map((a) => (
                <p key={a.id} className="text-sm text-red-600">
                  {a.hotlistEntry.reason} — priorité {a.hotlistEntry.priority}
                </p>
              ))}
            </div>
          )}
          {result.capture && (
            <img
              src={result.capture.imageUrl}
              alt="capture"
              className="h-32 w-full rounded-lg object-cover"
            />
          )}
        </div>
      )}

      {!active && !result && !error && (
        <div className="card">
          <EmptyState message="Activez la caméra pour commencer à scanner les plaques." />
        </div>
      )}
    </div>
  );
}
