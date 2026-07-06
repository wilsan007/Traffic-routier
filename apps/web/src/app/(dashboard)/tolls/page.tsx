'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState } from '@/components/Feedback';

interface TollZoneRow {
  id: string;
  name: string;
  pricePerPassage: number;
  active: boolean;
  camera?: { name: string } | null;
  _count: { transactions: number };
}

interface TollTxRow {
  id: string;
  plateNumber: string;
  amount: number;
  status: string;
  createdAt: string;
  zone: { name: string };
  vehicle?: { fleet?: { name: string } | null } | null;
}

const TX_STATUS: Record<string, { label: string; style: string }> = {
  PENDING: { label: 'À facturer', style: 'bg-amber-50 text-amber-700' },
  INVOICED: { label: 'Facturé', style: 'bg-blue-50 text-blue-700' },
  PAID: { label: 'Payé', style: 'bg-emerald-50 text-emerald-700' },
};

export default function TollsPage() {
  const [zones, setZones] = useState<TollZoneRow[]>([]);
  const [transactions, setTransactions] = useState<TollTxRow[]>([]);
  const [invoicePlate, setInvoicePlate] = useState('');
  const [invoiceResult, setInvoiceResult] = useState<{ count: number; total: number } | null>(null);

  function refresh() {
    api.get<TollZoneRow[]>('/tolls/zones').then(setZones);
    api.get<TollTxRow[]>('/tolls/transactions').then(setTransactions);
  }
  useEffect(refresh, []);

  async function invoice(e: React.FormEvent) {
    e.preventDefault();
    const result = await api.post<{ count: number; total: number }>('/tolls/invoice', {
      plate: invoicePlate || undefined,
    });
    setInvoiceResult(result);
    refresh();
  }

  const pendingTotal = transactions.filter((t) => t.status === 'PENDING').reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Péages</h2>
        <p className="page-subtitle">Chaque passage détecté par une caméra de péage génère automatiquement une transaction.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card"><p className="text-sm text-slate-500">Zones actives</p><p className="text-2xl font-bold">{zones.filter((z) => z.active).length}</p></div>
        <div className="card"><p className="text-sm text-slate-500">Transactions</p><p className="text-2xl font-bold">{transactions.length}</p></div>
        <div className="card"><p className="text-sm text-slate-500">En attente de facturation</p><p className="text-2xl font-bold text-brand-700">{pendingTotal.toFixed(2)} €</p></div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="card">
          <h3 className="mb-3 font-semibold">Zones de péage</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {zones.map((z) => (
              <li key={z.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="font-medium">{z.name}</p>
                  <p className="text-xs text-slate-400">{z.camera?.name ?? 'Zone géographique'} · {z._count.transactions} passages</p>
                </div>
                <span className="font-semibold">{z.pricePerPassage.toFixed(2)} €</span>
              </li>
            ))}
          </ul>
          {zones.length === 0 && <EmptyState message="Aucune zone." />}

          <form onSubmit={invoice} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold uppercase text-slate-400">Facturer les passages</p>
            <input className="input" placeholder="Plaque (vide = tout facturer)" value={invoicePlate} onChange={(e) => setInvoicePlate(e.target.value.toUpperCase())} />
            <button className="btn-primary w-full">Générer la facturation</button>
            {invoiceResult && (
              <p className="text-sm text-emerald-700">✓ {invoiceResult.count} passages facturés — {invoiceResult.total.toFixed(2)} €</p>
            )}
          </form>
        </div>

        <div className="card overflow-x-auto md:col-span-2">
          <h3 className="mb-3 font-semibold">Transactions récentes</h3>
          <table className="table-modern">
            <thead>
              <tr><th>Date</th><th>Plaque</th><th>Zone</th><th>Flotte</th><th>Montant</th><th>Statut</th></tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.createdAt).toLocaleString('fr-FR')}</td>
                  <td className="font-mono font-semibold">{t.plateNumber}</td>
                  <td>{t.zone.name}</td>
                  <td>{t.vehicle?.fleet?.name ?? '—'}</td>
                  <td>{t.amount.toFixed(2)} €</td>
                  <td><span className={`badge ${TX_STATUS[t.status]?.style ?? ''}`}>{TX_STATUS[t.status]?.label ?? t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {transactions.length === 0 && <EmptyState message="Aucune transaction — les passages caméra en zone de péage apparaîtront ici." />}
        </div>
      </div>
    </div>
  );
}
