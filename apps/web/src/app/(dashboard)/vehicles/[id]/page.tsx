'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });

interface VehicleDetail {
  id: string;
  plateNumber: string;
  make?: string;
  model?: string;
  color?: string;
  year?: number;
  vin?: string;
  stolen: boolean;
  insuranceStatus: string;
  technicalControlExpiresAt?: string;
  region: { name: string };
  ownerships: { id: string; startDate: string; endDate?: string; owner: { id: string; firstName: string; lastName: string } }[];
  infractions: { id: string; type: string; severity: string; occurredAt: string; status: string }[];
  captures: { id: string; imageUrl: string; capturedAt: string; confidence: number }[];
}

interface RoutePoint {
  captureId: string;
  lat: number;
  lng: number;
  capturedAt: string;
  cameraName: string | null;
  imageUrl: string;
}

interface RouteData {
  vehicleId: string;
  windowHours: number;
  pointCount: number;
  totalDistanceKm: number;
  points: RoutePoint[];
}

export default function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [showRoute, setShowRoute] = useState(false);

  useEffect(() => {
    api.get<VehicleDetail>(`/vehicles/${id}`).then(setVehicle);
  }, [id]);

  async function loadRoute() {
    const data = await api.get<RouteData>(`/vehicles/${id}/route?hours=24`);
    setRoute(data);
    setShowRoute(true);
  }

  if (!vehicle) return <p className="text-slate-400">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="page-title">{vehicle.plateNumber}</h2>
        {vehicle.stolen && <span className="badge bg-red-100 text-red-800">SIGNALÉ VOLÉ</span>}
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <div className="card">
          <h3 className="mb-2 font-semibold">Informations véhicule</h3>
          <dl className="space-y-1 text-sm">
            <div><dt className="inline text-slate-500">Marque/Modèle : </dt><dd className="inline">{vehicle.make} {vehicle.model}</dd></div>
            <div><dt className="inline text-slate-500">Couleur : </dt><dd className="inline">{vehicle.color}</dd></div>
            <div><dt className="inline text-slate-500">Année : </dt><dd className="inline">{vehicle.year}</dd></div>
            <div><dt className="inline text-slate-500">VIN : </dt><dd className="inline">{vehicle.vin}</dd></div>
            <div><dt className="inline text-slate-500">Région : </dt><dd className="inline">{vehicle.region?.name}</dd></div>
            <div><dt className="inline text-slate-500">Assurance : </dt><dd className="inline">{vehicle.insuranceStatus}</dd></div>
            <div><dt className="inline text-slate-500">Contrôle technique : </dt><dd className="inline">{vehicle.technicalControlExpiresAt?.slice(0, 10) ?? '—'}</dd></div>
          </dl>
        </div>

        <div className="card">
          <h3 className="mb-2 font-semibold">Historique des propriétaires</h3>
          <ul className="space-y-2 text-sm">
            {vehicle.ownerships.map((o) => (
              <li key={o.id}>
                <Link href={`/owners/${o.owner.id}`} className="text-brand-500 hover:underline">
                  {o.owner.firstName} {o.owner.lastName}
                </Link>
                <span className="text-slate-400"> — depuis {o.startDate.slice(0, 10)}{o.endDate ? ` jusqu'au ${o.endDate.slice(0, 10)}` : ' (actuel)'}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3 className="mb-2 font-semibold">Infractions</h3>
          <ul className="space-y-2 text-sm">
            {vehicle.infractions.map((i) => (
              <li key={i.id}>
                {i.type} — <span className="text-slate-400">{i.occurredAt.slice(0, 10)}</span> — {i.status}
              </li>
            ))}
            {vehicle.infractions.length === 0 && <p className="text-slate-400">Aucune infraction.</p>}
          </ul>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">Captures récentes</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {vehicle.captures.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-200 p-2 text-xs">
              <img src={c.imageUrl} alt="capture" className="mb-1 h-24 w-full rounded object-cover bg-slate-100" />
              <p>{c.capturedAt.slice(0, 19).replace('T', ' ')}</p>
              <p className="text-slate-400">Confiance : {(c.confidence * 100).toFixed(0)}%</p>
            </div>
          ))}
          {vehicle.captures.length === 0 && <p className="text-sm text-slate-400">Aucune capture.</p>}
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Reconstruction d'itinéraire (24h)</h3>
          {!showRoute && (
            <button onClick={loadRoute} className="btn-primary text-sm">
              Afficher l'itinéraire
            </button>
          )}
        </div>
        {showRoute && route && (
          <RouteMap points={route.points} totalDistanceKm={route.totalDistanceKm} />
        )}
        {showRoute && !route && <p className="text-slate-400">Chargement de l'itinéraire…</p>}
      </div>
    </div>
  );
}
