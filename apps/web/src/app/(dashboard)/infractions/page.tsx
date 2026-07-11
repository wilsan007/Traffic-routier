'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { LoadingSpinner, ErrorBanner, EmptyState } from '@/components/Feedback';
import { INFRACTION_STATUS_LABELS, INFRACTION_STATUS_STYLES } from '@/lib/infraction-status';

interface InfractionRow {
  id: string;
  reference?: string;
  type: string;
  status: string;
  amountDue?: number;
  fineAmount?: number;
  occurredAt: string;
  vehicle: { id: string; plateNumber: string };
  infractionType?: { label: string; category?: string } | null;
  officer: { firstName: string; lastName: string };
  dispute?: { status: string } | null;
}

interface InfractionTypeOption {
  id: string;
  code: string;
  label: string;
  category?: string;
  baseAmount: number;
  points: number;
}

interface VehicleOption {
  id: string;
  plateNumber: string;
  make?: string;
  model?: string;
}

const FILTERS = [
  { value: '', label: 'Tous' },
  { value: 'PENDING_REVIEW', label: 'À valider' },
  { value: 'VALIDATED', label: 'Validés' },
  { value: 'NOTIFIED', label: 'Notifiés' },
  { value: 'CONTESTED', label: 'Contestés' },
  { value: 'PAID', label: 'Payés' },
  { value: 'CLOSED', label: 'Clôturés' },
];

export default function InfractionsPage() {
  const [infractions, setInfractions] = useState<InfractionRow[]>([]);
  const [types, setTypes] = useState<InfractionTypeOption[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulaire nouveau PV
  const [showForm, setShowForm] = useState(false);
  const [plateQuery, setPlateQuery] = useState('');
  const [vehicle, setVehicle] = useState<VehicleOption | null>(null);
  const [typeId, setTypeId] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<InfractionRow[]>(
        `/infractions${filter ? `?status=${filter}` : ''}`,
      );
      setInfractions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    refresh();
    api.get<InfractionTypeOption[]>('/infraction-types?activeOnly=true').then(setTypes).catch(() => undefined);
  }, [refresh]);

  async function searchVehicle() {
    if (!plateQuery.trim()) return;
    const found = await api.get<VehicleOption | null>(`/vehicles/by-plate/${encodeURIComponent(plateQuery)}`);
    setVehicle(found);
  }

  async function createInfraction(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicle || !typeId) return;
    setCreating(true);
    try {
      await api.post('/infractions', { vehicleId: vehicle.id, typeId, description });
      setShowForm(false);
      setVehicle(null);
      setPlateQuery('');
      setTypeId('');
      setDescription('');
      refresh();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="page-title">Infractions</h2>
          <p className="page-subtitle">Cycle de vie complet : verbalisation → validation → notification → paiement/contestation → clôture.</p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Fermer' : '+ Nouveau PV'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createInfraction} className="card animate-in space-y-4">
          <h3 className="font-semibold">Verbaliser un véhicule</h3>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              className="input"
              placeholder="Plaque du véhicule (ex: AB123CD)"
              value={plateQuery}
              onChange={(e) => setPlateQuery(e.target.value.toUpperCase())}
            />
            <button type="button" className="btn-secondary shrink-0" onClick={searchVehicle}>
              Vérifier
            </button>
          </div>
          {vehicle === null && plateQuery && (
            <p className="text-sm text-slate-400">Vérifiez la plaque pour identifier le véhicule.</p>
          )}
          {vehicle && (
            <p className="text-sm text-emerald-700">
              ✓ {vehicle.plateNumber} — {vehicle.make} {vehicle.model}
            </p>
          )}
          <select className="input" value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
            <option value="">— Choisir dans le barème —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                [{t.category}] {t.label} — {t.baseAmount} € / {t.points} pt(s)
              </option>
            ))}
          </select>
          <textarea
            className="input"
            rows={2}
            placeholder="Circonstances (optionnel)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button className="btn-primary" disabled={!vehicle || !typeId || creating}>
            {creating ? 'Création…' : 'Créer le PV (soumis à validation)'}
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              filter === f.value
                ? 'bg-brand-500 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} onRetry={refresh} />}
      {loading && <LoadingSpinner label="Chargement des infractions…" />}

      {!loading && !error && (
        <div className="card overflow-x-auto">
          <table className="table-modern">
            <thead>
              <tr>
                <th>Référence</th>
                <th>Date</th>
                <th>Plaque</th>
                <th>Infraction</th>
                <th>Montant dû</th>
                <th>Statut</th>
                <th>Agent</th>
              </tr>
            </thead>
            <tbody>
              {infractions.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/infractions/${i.id}`} className="font-mono text-brand-500 hover:underline">
                      {i.reference ?? i.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{i.occurredAt.slice(0, 10)}</td>
                  <td className="font-mono font-semibold">{i.vehicle.plateNumber}</td>
                  <td>{i.type}</td>
                  <td>{i.amountDue != null ? `${i.amountDue.toFixed(2)} €` : i.fineAmount ? `${i.fineAmount.toFixed(2)} €` : '—'}</td>
                  <td>
                    <span className={`badge ${INFRACTION_STATUS_STYLES[i.status] ?? ''}`}>
                      {INFRACTION_STATUS_LABELS[i.status] ?? i.status}
                    </span>
                    {i.dispute && i.dispute.status === 'PENDING' && (
                      <span className="badge ml-1 bg-orange-100 text-orange-700">Contestation</span>
                    )}
                  </td>
                  <td>{i.officer.firstName} {i.officer.lastName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {infractions.length === 0 && <EmptyState message="Aucune infraction pour ce filtre." />}
        </div>
      )}
    </div>
  );
}
