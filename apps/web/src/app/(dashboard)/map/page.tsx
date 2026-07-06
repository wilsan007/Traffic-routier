'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { LoadingSpinner } from '@/components/Feedback';

// Leaflet manipule window : chargement client uniquement
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => <LoadingSpinner label="Chargement de la carte…" />,
});

export default function MapPage() {
  const [plateInput, setPlateInput] = useState('');
  const [tracePlate, setTracePlate] = useState<string | undefined>(undefined);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="page-title">Carte opérationnelle</h2>
          <p className="page-subtitle">
            Captures en temps réel, agents en service, caméras, zones sensibles — et trajectoire d'un véhicule recherché.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setTracePlate(plateInput.trim() || undefined);
          }}
        >
          <input
            className="input w-56 font-mono"
            placeholder="Tracer une plaque…"
            value={plateInput}
            onChange={(e) => setPlateInput(e.target.value.toUpperCase())}
          />
          <button className="btn-primary">Tracer</button>
          {tracePlate && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setTracePlate(undefined);
                setPlateInput('');
              }}
            >
              Tout afficher
            </button>
          )}
        </form>
      </div>

      <div className="card flex-1 overflow-hidden p-1.5">
        <MapView tracePlate={tracePlate} />
      </div>

      <div className="flex gap-5 text-xs text-slate-500">
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-brand-500" />Capture</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-red-600" />Véhicule volé / trajectoire</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />Agent en service</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-brand-900" />Caméra</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed border-orange-400" />Zone sensible</span>
      </div>
    </div>
  );
}
