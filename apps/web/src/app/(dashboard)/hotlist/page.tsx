'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PriorityBadge } from '@/components/PriorityBadge';
import type { HotlistReason, Priority } from '@trafficguard/shared';

interface HotlistRow {
  id: string;
  plateNumber: string;
  reason: string;
  priority: string;
  notes?: string;
  active: boolean;
  createdAt: string;
  createdBy: { firstName: string; lastName: string };
}

export default function HotlistPage() {
  const [entries, setEntries] = useState<HotlistRow[]>([]);
  const [plateNumber, setPlateNumber] = useState('');
  const [reason, setReason] = useState<HotlistReason>('STOLEN_VEHICLE');
  const [priority, setPriority] = useState<Priority>('HIGH');
  const [notes, setNotes] = useState('');

  function refresh() {
    api.get<HotlistRow[]>('/hotlist').then(setEntries);
  }

  useEffect(refresh, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/hotlist', { plateNumber, reason, priority, notes });
    setPlateNumber('');
    setNotes('');
    refresh();
  }

  async function handleDeactivate(id: string) {
    await api.patch(`/hotlist/${id}/deactivate`);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Liste de surveillance</h2>
        <p className="page-subtitle">Véhicules volés, personnes recherchées, avis de recherche (BOLO)…</p>
      </div>

      <form onSubmit={handleCreate} className="card grid gap-3 md:grid-cols-5">
        <input className="input" placeholder="Plaque" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} required />
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value as HotlistReason)}>
          <option value="STOLEN_VEHICLE">Véhicule volé</option>
          <option value="WANTED_PERSON">Personne recherchée</option>
          <option value="BOLO">Avis de recherche (BOLO)</option>
          <option value="SUSPENDED_REGISTRATION">Immatriculation suspendue</option>
          <option value="AMBER_ALERT">Alerte enlèvement</option>
          <option value="OTHER">Autre</option>
        </select>
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          <option value="LOW">Faible</option>
          <option value="MEDIUM">Moyenne</option>
          <option value="HIGH">Élevée</option>
          <option value="CRITICAL">Critique</option>
        </select>
        <input className="input md:col-span-1" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className="btn-primary">Ajouter à la liste</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="table-modern">
          <thead>
            <tr>
              <th className="py-2">Plaque</th>
              <th>Motif</th>
              <th>Priorité</th>
              <th>Ajouté par</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-slate-100">
                <td className="py-2 font-medium">{e.plateNumber}</td>
                <td>{e.reason}</td>
                <td><PriorityBadge priority={e.priority} /></td>
                <td>{e.createdBy.firstName} {e.createdBy.lastName}</td>
                <td>{e.active ? 'Actif' : 'Inactif'}</td>
                <td>
                  {e.active && (
                    <button onClick={() => handleDeactivate(e.id)} className="text-xs text-red-600 underline">
                      Désactiver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
