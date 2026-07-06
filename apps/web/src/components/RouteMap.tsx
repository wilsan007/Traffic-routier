'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface RoutePoint {
  captureId: string;
  lat: number;
  lng: number;
  capturedAt: string;
  cameraName: string | null;
  imageUrl: string;
}

interface RouteMapProps {
  points: RoutePoint[];
  totalDistanceKm: number;
}

export default function RouteMap({ points, totalDistanceKm }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current).setView(
      points.length > 0 ? [points[0].lat, points[0].lng] : [48.8566, 2.3522],
      12,
    );

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || points.length === 0) return;

    const latlngs: L.LatLngExpression[] = points.map((p) => [p.lat, p.lng]);

    // Polyline entre les points
    L.polyline(latlngs, { color: '#2563eb', weight: 3, opacity: 0.7 }).addTo(map);

    // Marqueurs pour chaque point
    points.forEach((p, i) => {
      const isStart = i === 0;
      const isEnd = i === points.length - 1;
      const color = isStart ? '#16a34a' : isEnd ? '#dc2626' : '#64748b';

      const marker = L.circleMarker([p.lat, p.lng], {
        radius: isStart || isEnd ? 8 : 5,
        fillColor: color,
        color: '#fff',
        weight: 2,
        fillOpacity: 1,
      }).addTo(map);

      marker.bindPopup(
        `<div style="min-width:180px">
          <img src="${p.imageUrl}" style="width:100%;border-radius:4px;margin-bottom:4px" />
          <strong>${isStart ? 'Départ' : isEnd ? 'Arrivée' : `Point ${i + 1}`}</strong><br/>
          ${p.cameraName ? `Caméra: ${p.cameraName}<br/>` : ''}
          ${new Date(p.capturedAt).toLocaleString('fr-FR')}
        </div>`,
      );
    });

    // Ajuster la vue pour englober tous les points
    if (latlngs.length > 1) {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.1));
    } else if (latlngs.length === 1) {
      map.setView(latlngs[0], 14);
    }
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-400">
        Aucune donnée de position GPS pour cette période.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-sm text-slate-600">
        <span><strong>{points.length}</strong> points</span>
        <span><strong>{totalDistanceKm}</strong> km parcourus</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-green-600" /> Départ
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-red-600" /> Arrivée
        </span>
      </div>
      <div ref={mapRef} style={{ height: '400px', borderRadius: '12px', overflow: 'hidden' }} />
    </div>
  );
}
