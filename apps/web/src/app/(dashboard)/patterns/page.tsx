'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface RepeatedPassage {
  id: string;
  plateNumber: string;
  reason: string;
  priority: string;
  notes: string;
  active: boolean;
  createdAt: string;
  alerts: {
    id: string;
    capture: { capturedAt: string; cameraId: string | null; imageUrl: string };
  }[];
  createdBy: { firstName: string; lastName: string };
}

interface ConvoyPair {
  plateA: string;
  plateB: string;
  coOccurrences: number;
  cameraCount: number;
  lastSeen: string;
}

interface SuspiciousPattern {
  plateNumber: string;
  zoneCount: number;
  zones: { name: string; lastSeen: string }[];
}

interface SensitiveZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

type Tab = 'passages' | 'convoys' | 'suspicious' | 'zones';

export default function PatternsPage() {
  const [tab, setTab] = useState<Tab>('passages');
  const [passages, setPassages] = useState<RepeatedPassage[]>([]);
  const [convoys, setConvoys] = useState<ConvoyPair[]>([]);
  const [suspicious, setSuspicious] = useState<SuspiciousPattern[]>([]);
  const [zones, setZones] = useState<SensitiveZone[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    if (tab === 'passages') {
      api.get<RepeatedPassage[]>('/patterns/repeated-passages').then(setPassages).finally(() => setLoading(false));
    } else if (tab === 'convoys') {
      api.get<ConvoyPair[]>('/patterns/convoys').then(setConvoys).finally(() => setLoading(false));
    } else if (tab === 'suspicious') {
      api.get<SuspiciousPattern[]>('/patterns/suspicious').then(setSuspicious).finally(() => setLoading(false));
    } else if (tab === 'zones') {
      api.get<SensitiveZone[]>('/patterns/zones').then(setZones).finally(() => setLoading(false));
    }
  }, [tab]);

  useEffect(refresh, [refresh]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'passages', label: 'Passages répétés' },
    { key: 'convoys', label: 'Convois détectés' },
    { key: 'suspicious', label: 'Zones sensibles' },
    { key: 'zones', label: 'Configuration zones' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Analyse comportementale</h2>
        <p className="page-subtitle">
          Détection automatique de passages répétés, convois et surveillance de zones sensibles
        </p>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-slate-400">Chargement…</p>}

      {/* Passages répétés */}
      {tab === 'passages' && (
        <div className="space-y-4">
          {passages.length === 0 && !loading && (
            <div className="card text-center text-slate-400 py-8">
              Aucune alerte de passage répété actif.
              <br />
              <span className="text-xs">
                Une alerte est générée automatiquement quand une plaque passe 3+ fois sur la même caméra ou zone en 1h.
              </span>
            </div>
          )}
          {passages.map((p) => (
            <div key={p.id} className="card space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-lg font-semibold">{p.plateNumber}</span>
                  <span className="ml-3 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {p.priority}
                  </span>
                </div>
                <span className="text-xs text-slate-400">
                  {new Date(p.createdAt).toLocaleString('fr-FR')}
                </span>
              </div>
              <p className="text-sm text-slate-600">{p.notes}</p>
              {p.alerts.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {p.alerts.map((a) => (
                    <img
                      key={a.id}
                      src={a.capture.imageUrl}
                      alt="Capture"
                      className="h-16 w-24 rounded object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Convois */}
      {tab === 'convoys' && (
        <div className="card overflow-x-auto">
          {convoys.length === 0 && !loading && (
            <p className="text-center text-slate-400 py-8">
              Aucun convoi détecté.
              <br />
              <span className="text-xs">
                Un convoi est détecté quand 2 plaques sont capturées sur les mêmes caméras dans un intervalle de 10 min, au moins 3 fois sur 6h.
              </span>
            </p>
          )}
          {convoys.length > 0 && (
            <table className="table-modern">
              <thead>
                <tr>
                  <th className="py-2">Plaque A</th>
                  <th>Plaque B</th>
                  <th>Co-occurrences</th>
                  <th>Caméras distinctes</th>
                  <th>Dernière vue</th>
                </tr>
              </thead>
              <tbody>
                {convoys.map((c, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 font-medium">{c.plateA}</td>
                    <td className="font-medium">{c.plateB}</td>
                    <td>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {c.coOccurrences}
                      </span>
                    </td>
                    <td>{c.cameraCount}</td>
                    <td className="text-sm text-slate-500">
                      {new Date(c.lastSeen).toLocaleString('fr-FR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Zones sensibles - patterns suspects */}
      {tab === 'suspicious' && (
        <div className="space-y-4">
          {suspicious.length === 0 && !loading && (
            <div className="card text-center text-slate-400 py-8">
              Aucun pattern suspect détecté dans les dernières 24h.
            </div>
          )}
          {suspicious.map((s, i) => (
            <div key={i} className="card space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{s.plateNumber}</span>
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  {s.zoneCount} zones
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {s.zones.map((z, j) => (
                  <span key={j} className="rounded-lg bg-slate-100 px-3 py-1 text-xs text-slate-600">
                    {z.name} — {new Date(z.lastSeen).toLocaleTimeString('fr-FR')}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Configuration zones */}
      {tab === 'zones' && (
        <div className="space-y-4">
          <ZoneForm onCreated={refresh} />
          <div className="card overflow-x-auto">
            {zones.length === 0 && !loading && (
              <p className="text-center text-slate-400 py-8">Aucune zone sensible configurée.</p>
            )}
            {zones.length > 0 && (
              <table className="table-modern">
                <thead>
                  <tr>
                    <th className="py-2">Nom</th>
                    <th>Latitude</th>
                    <th>Longitude</th>
                    <th>Rayon (m)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {zones.map((z) => (
                    <tr key={z.id} className="border-b border-slate-100">
                      <td className="py-2 font-medium">{z.name}</td>
                      <td>{z.latitude.toFixed(4)}</td>
                      <td>{z.longitude.toFixed(4)}</td>
                      <td>{z.radiusMeters}</td>
                      <td>
                        <button
                          onClick={async () => {
                            await api.post(`/patterns/zones`, {}); // not used — delete below
                          }}
                          className="text-xs text-red-600 underline"
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('500');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/patterns/zones', {
      name,
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      radiusMeters: parseFloat(radius),
    });
    setName('');
    setLat('');
    setLng('');
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="card grid gap-3 md:grid-cols-5">
      <input className="input" placeholder="Nom de la zone" value={name} onChange={(e) => setName(e.target.value)} required />
      <input className="input" placeholder="Latitude" type="number" step="0.0001" value={lat} onChange={(e) => setLat(e.target.value)} required />
      <input className="input" placeholder="Longitude" type="number" step="0.0001" value={lng} onChange={(e) => setLng(e.target.value)} required />
      <input className="input" placeholder="Rayon (m)" type="number" value={radius} onChange={(e) => setRadius(e.target.value)} required />
      <button className="btn-primary">Créer la zone</button>
    </form>
  );
}
