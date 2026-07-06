'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { EmptyState } from '@/components/Feedback';

interface InfractionTypeRow {
  id: string;
  code: string;
  label: string;
  category?: string;
  baseAmount: number;
  reducedAmount?: number;
  increasedAmount?: number;
  points: number;
  reducedDays: number;
  dueDays: number;
  active: boolean;
}

export default function BaremePage() {
  const { user } = useAuth();
  const [types, setTypes] = useState<InfractionTypeRow[]>([]);
  const [form, setForm] = useState({ code: '', label: '', category: '', baseAmount: '', reducedAmount: '', increasedAmount: '', points: '0' });
  const canEdit = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';

  function refresh() {
    api.get<InfractionTypeRow[]>('/infraction-types').then(setTypes);
  }
  useEffect(refresh, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/infraction-types', {
      code: form.code,
      label: form.label,
      category: form.category || undefined,
      baseAmount: parseFloat(form.baseAmount),
      reducedAmount: form.reducedAmount ? parseFloat(form.reducedAmount) : undefined,
      increasedAmount: form.increasedAmount ? parseFloat(form.increasedAmount) : undefined,
      points: parseInt(form.points, 10) || 0,
    });
    setForm({ code: '', label: '', category: '', baseAmount: '', reducedAmount: '', increasedAmount: '', points: '0' });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Barème des infractions</h2>
        <p className="page-subtitle">Catalogue paramétrable : montants forfaitaire, minoré, majoré, points et délais.</p>
      </div>

      {canEdit && (
        <form onSubmit={create} className="card grid gap-3 md:grid-cols-7">
          <input className="input" placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required />
          <input className="input md:col-span-2" placeholder="Libellé" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
          <input className="input" placeholder="Catégorie" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className="input" type="number" step="0.01" placeholder="Montant €" value={form.baseAmount} onChange={(e) => setForm({ ...form, baseAmount: e.target.value })} required />
          <input className="input" type="number" step="0.01" placeholder="Minoré €" value={form.reducedAmount} onChange={(e) => setForm({ ...form, reducedAmount: e.target.value })} />
          <input className="input" type="number" step="0.01" placeholder="Majoré €" value={form.increasedAmount} onChange={(e) => setForm({ ...form, increasedAmount: e.target.value })} />
          <button className="btn-primary md:col-span-7">Ajouter au barème</button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="table-modern">
          <thead>
            <tr>
              <th>Code</th>
              <th>Infraction</th>
              <th>Catégorie</th>
              <th>Minoré</th>
              <th>Forfaitaire</th>
              <th>Majoré</th>
              <th>Points</th>
              <th>Statut</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} className={t.active ? '' : 'opacity-40'}>
                <td className="font-mono text-xs">{t.code}</td>
                <td className="font-medium">{t.label}</td>
                <td>{t.category ?? '—'}</td>
                <td>{t.reducedAmount != null ? `${t.reducedAmount} €` : '—'}</td>
                <td className="font-semibold">{t.baseAmount} €</td>
                <td>{t.increasedAmount != null ? `${t.increasedAmount} €` : '—'}</td>
                <td>{t.points || '—'}</td>
                <td>{t.active ? 'Actif' : 'Inactif'}</td>
                {canEdit && (
                  <td>
                    {t.active && (
                      <button
                        className="btn-danger-ghost"
                        onClick={async () => {
                          await api.patch(`/infraction-types/${t.id}/deactivate`);
                          refresh();
                        }}
                      >
                        Désactiver
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {types.length === 0 && <EmptyState message="Barème vide." />}
      </div>
    </div>
  );
}
