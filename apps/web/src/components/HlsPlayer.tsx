'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

const HLS_BASE = process.env.NEXT_PUBLIC_HLS_URL ?? 'http://localhost:8888';

// Lecteur vidéo live HLS (flux caméra proxifié par MediaMTX)
export function HlsPlayer({ cameraId }: { cameraId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const src = `${HLS_BASE}/${cameraId}/index.m3u8`;
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, liveDurationInfinity: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) setError('Flux indisponible — vérifiez que la caméra publie bien son flux RTSP.');
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else {
      setError('Lecture HLS non supportée par ce navigateur.');
    }

    return () => {
      hls?.destroy();
    };
  }, [cameraId]);

  return (
    <div className="relative overflow-hidden rounded-xl bg-slate-900">
      <video ref={videoRef} autoPlay muted playsInline controls className="aspect-video w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-slate-300">
          {error}
        </div>
      )}
    </div>
  );
}
