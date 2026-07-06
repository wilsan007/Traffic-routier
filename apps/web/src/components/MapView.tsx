'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Polyline, Popup, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '@/lib/api';
import { getAlertsSocket } from '@/lib/socket';

interface CaptureRow {
  id: string;
  plateNumberNormalized: string;
  latitude?: number | null;
  longitude?: number | null;
  capturedAt: string;
  vehicle?: { stolen: boolean } | null;
  camera?: { name: string } | null;
}

interface AgentLocation {
  userId: string;
  latitude: number;
  longitude: number;
  user: { firstName: string; lastName: string; badgeNumber?: string };
}

interface Zone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

interface CameraRow {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  lastSeenAt?: string | null;
}

const DEFAULT_CENTER: [number, number] = [48.8566, 2.3522];

export default function MapView({ tracePlate }: { tracePlate?: string }) {
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [agents, setAgents] = useState<AgentLocation[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [cameras, setCameras] = useState<CameraRow[]>([]);

  useEffect(() => {
    const load = () => {
      api.get<CaptureRow[]>(`/captures${tracePlate ? `?plate=${encodeURIComponent(tracePlate)}` : ''}`)
        .then((rows) => setCaptures(rows.filter((c) => c.latitude != null && c.longitude != null)))
        .catch(() => undefined);
      api.get<AgentLocation[]>('/ops/locations').then(setAgents).catch(() => undefined);
    };
    load();
    api.get<Zone[]>('/patterns/zones').then(setZones).catch(() => undefined);
    api.get<CameraRow[]>('/cameras')
      .then((rows) => setCameras(rows.filter((c) => c.latitude != null && c.longitude != null)))
      .catch(() => undefined);

    const interval = setInterval(load, 15_000);
    const socket = getAlertsSocket();
    socket.on('alert.new', load);
    return () => {
      clearInterval(interval);
      socket.off('alert.new', load);
    };
  }, [tracePlate]);

  const trajectory = useMemo(() => {
    if (!tracePlate) return [];
    return [...captures]
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .map((c) => [c.latitude!, c.longitude!] as [number, number]);
  }, [captures, tracePlate]);

  const center: [number, number] =
    captures.length > 0 ? [captures[0].latitude!, captures[0].longitude!] : DEFAULT_CENTER;

  return (
    <MapContainer center={center} zoom={12} className="h-full w-full rounded-2xl" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Zones sensibles */}
      {zones.map((z) => (
        <Circle
          key={z.id}
          center={[z.latitude, z.longitude]}
          radius={z.radiusMeters}
          pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.08, weight: 1.5, dashArray: '4' }}
        >
          <Tooltip>Zone sensible : {z.name}</Tooltip>
        </Circle>
      ))}

      {/* Caméras */}
      {cameras.map((c) => (
        <CircleMarker
          key={c.id}
          center={[c.latitude!, c.longitude!]}
          radius={7}
          pathOptions={{ color: '#0f1f4a', fillColor: '#0f1f4a', fillOpacity: 0.9 }}
        >
          <Popup>
            <b>📷 {c.name}</b>
            <br />
            {c.lastSeenAt
              ? `Dernière activité : ${new Date(c.lastSeenAt).toLocaleString('fr-FR')}`
              : 'Aucune activité récente'}
          </Popup>
        </CircleMarker>
      ))}

      {/* Captures */}
      {captures.map((c) => (
        <CircleMarker
          key={c.id}
          center={[c.latitude!, c.longitude!]}
          radius={6}
          pathOptions={{
            color: c.vehicle?.stolen ? '#dc2626' : '#2f5fdb',
            fillColor: c.vehicle?.stolen ? '#dc2626' : '#2f5fdb',
            fillOpacity: 0.7,
          }}
        >
          <Popup>
            <b className="font-mono">{c.plateNumberNormalized}</b>
            {c.vehicle?.stolen && <span> — ⚠️ VOLÉ</span>}
            <br />
            {new Date(c.capturedAt).toLocaleString('fr-FR')}
            {c.camera && (
              <>
                <br />
                📷 {c.camera.name}
              </>
            )}
          </Popup>
        </CircleMarker>
      ))}

      {/* Trajectoire du véhicule recherché */}
      {trajectory.length > 1 && (
        <Polyline positions={trajectory} pathOptions={{ color: '#dc2626', weight: 3, dashArray: '8 6' }} />
      )}

      {/* Agents en service */}
      {agents.map((a) => (
        <CircleMarker
          key={a.userId}
          center={[a.latitude, a.longitude]}
          radius={9}
          pathOptions={{ color: '#059669', fillColor: '#10b981', fillOpacity: 0.95, weight: 2 }}
        >
          <Tooltip permanent direction="top" offset={[0, -10]}>
            👮 {a.user.firstName} {a.user.lastName.charAt(0)}.
          </Tooltip>
          <Popup>
            Agent {a.user.firstName} {a.user.lastName}
            {a.user.badgeNumber && ` — ${a.user.badgeNumber}`}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
