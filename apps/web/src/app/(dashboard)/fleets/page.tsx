'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState } from '@/components/Feedback';

interface FleetRow {
  id: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
  _count: { vehicles: number };
}

interface FleetDetail extends FleetRow {
  vehicles: {
    id: string;
    plateNumber: string;
    make?: string;
    model?: string;
    infractions: { id: string; reference?: string; type: string; status: string; amountDue?: number }[];
  }[];
  summary: { vehicleCount: number; infractionCount: number; totalDue: number };
}

export default function FleetsPage() {
  const [fleets, setFleets] = useState<FleetRow[]>([]);
  const [selected, setSelected] = useState<FleetDetail | null>(null);
  const [name, setName] = useState('');
  const [plate, setPlate] = useState('');

  function refresh() {
    api.get<FleetRow[]>('/fleets').then(setFleets);
  }
  useEffect(refresh, []);

  async function openFleet(id: string) {
    setSelected(await api.get<FleetDetail>(`/fleets/${id}`));
  }

  async function createFleet(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/fleets', { name });
    setName('');
    refresh();
  }

  async function addVehicle(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const vehicle = await api.get<{ id: string } | null>(`/vehicles/by-plate/${encodeURIComponent(plate)}`);
    if (vehicle) {
      await api.post(`/fleets/${selected.id}/vehicles`, { vehicleId: vehicle.id });
      setPlate('');
      openFleet(selected.id);
      refresh();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Flottes</h2>
        <p className="page-subtitle">Vue consolidée des véhicules et infractions par flotte (taxis, entreprises, administrations).</p>
      </div>

      <form onSubmit={createFleet} className="card flex gap-3">
        <input className="input" placeholder="Nom de la flotte" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="btn-primary shrink-0">Créer la flotte</button>
      </form>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="card md:col-span-1">
          <h3 className="mb-3 font-semibold">Flottes ({fleets.length})</h3>
          <ul className="divide-y divide-slate-100">
            {fleets.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => openFleet(f.id)}
                  className={`flex w-full items-center justify-between py-3 text-left transition-colors hover:bg-slate-50 ${selected?.id === f.id ? 'text-brand-600' : ''}`}
                >
                  <span className="font-medium">{f.name}</span>
                  <span className="text-xs text-slate-400">{f._count.vehicles} véh.</span>
                </button>
              </li>
            ))}
          </ul>
          {fleets.length === 0 && <EmptyState message="Aucune flotte." />}
        </div>

        <div className="md:col-span-2">
          {selected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="card"><p className="text-sm text-slate-500">Véhicules</p><p className="text-2xl font-bold">{selected.summary.vehicleCount}</p></div>
                <div className="card"><p className="text-sm text-slate-500">Infractions</p><p className="text-2xl font-bold">{selected.summary.infractionCount}</p></div>
                <div className="card"><p className="text-sm text-slate-500">Montant dû</p><p className="text-2xl font-bold text-brand-700">{selected.summary.totalDue.toFixed(2)} €</p></div>
              </div>

              <form onSubmit={addVehicle} className="card flex gap-3">
                <input className="input" placeholder="Rattacher un véhicule (plaque)" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
                <button className="btn-secondary shrink-0">Rattacher</button>
              </form>

              <div className="card overflow-x-auto">
                <table className="table-modern">
                  <thead>
                    <tr><th>Plaque</th><th>Véhicule</th><th>Infractions</th><th>Dû</th></tr>
                  </thead>
                  <tbody>
                    {selected.vehicles.map((v) => (
                      <tr key={v.id}>
                        <td className="font-mono font-semibold">{v.plateNumber}</td>
                        <td>{v.make} {v.model}</td>
                        <td>{v.infractions.length}</td>
                        <td>
                          {v.infractions
                            .filter((i) => !['PAID', 'CANCELLED', 'CLOSED', 'REJECTED'].includes(i.status))
                            .reduce((s, i) => s + (i.amountDue ?? 0), 0)
                            .toFixed(2)} €
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card"><EmptyState message="Sélectionnez une flotte pour voir le détail." /></div>
          )}
        </div>
      </div>
    </div>
  );
}
