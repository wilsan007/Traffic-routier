'use client';

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { api, API_URL, getToken } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { LoadingSpinner, ErrorBanner } from '@/components/Feedback';
import { INFRACTION_STATUS_LABELS, INFRACTION_STATUS_STYLES } from '@/lib/infraction-status';

interface InfractionDetail {
  id: string;
  reference?: string;
  type: string;
  description?: string;
  status: string;
  fineAmount?: number;
  amountDue?: number;
  points?: number;
  occurredAt: string;
  createdAt: string;
  validatedAt?: string;
  notifiedAt?: string;
  dueDate?: string;
  closedAt?: string;
  rejectionReason?: string;
  vehicle: { id: string; plateNumber: string; make?: string; model?: string; ownerships?: { owner: { id: string; firstName: string; lastName: string } }[] };
  owner?: { id: string; firstName: string; lastName: string } | null;
  officer: { firstName: string; lastName: string; badgeNumber?: string };
  validatedBy?: { firstName: string; lastName: string } | null;
  infractionType?: { label: string; reducedAmount?: number; increasedAmount?: number } | null;
  payments: { id: string; amount: number; method: string; receiptNumber: string; createdAt: string; payerName?: string }[];
  dispute?: { status: string; reason: string; details?: string; decision?: string; createdAt: string } | null;
  notifications: { channel: string; recipient: string; subject: string; sentAt: string }[];
  capture?: { imageUrl: string; confidence: number } | null;
}

const METHOD_LABELS: Record<string, string> = {
  CARD_ONLINE: 'Carte (en ligne)',
  COUNTER_CARD: 'Carte (guichet)',
  CASH: 'Espèces',
  TRANSFER: 'Virement',
};

export default function InfractionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const [item, setItem] = useState<InfractionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [payMethod, setPayMethod] = useState('COUNTER_CARD');
  const [payerName, setPayerName] = useState('');
  const [disputeDecision, setDisputeDecision] = useState('');

  const refresh = useCallback(() => {
    api.get<InfractionDetail>(`/infractions/${id}`).then(setItem).catch((e) => setError(e.message));
  }, [id]);

  useEffect(refresh, [refresh]);

  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action impossible');
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!item) return <LoadingSpinner label="Chargement du PV…" />;

  const canSupervise = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';
  const canCashier = canSupervise || user?.role === 'CASHIER';
  const owner = item.owner ?? item.vehicle.ownerships?.[0]?.owner ?? null;

  const timeline = [
    { label: 'PV créé', date: item.createdAt, done: true },
    { label: 'Validé', date: item.validatedAt, done: !!item.validatedAt },
    { label: 'Notifié au titulaire', date: item.notifiedAt, done: !!item.notifiedAt },
    {
      label:
        item.status === 'PAID' || item.payments.length > 0
          ? 'Payé'
          : item.dispute
            ? 'Contesté'
            : 'Paiement / contestation',
      date: item.payments[0]?.createdAt ?? item.dispute?.createdAt,
      done: item.payments.length > 0 || !!item.dispute,
    },
    { label: 'Clôturé', date: item.closedAt, done: !!item.closedAt },
  ];

  async function downloadPdf() {
    const res = await fetch(`${API_URL}/infractions/${item!.id}/pdf`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="page-title font-mono">{item.reference ?? item.id.slice(0, 8)}</h2>
            <span className={`badge ${INFRACTION_STATUS_STYLES[item.status] ?? ''}`}>
              {INFRACTION_STATUS_LABELS[item.status] ?? item.status}
            </span>
          </div>
          <p className="page-subtitle">{item.type} — {new Date(item.occurredAt).toLocaleString('fr-FR')}</p>
        </div>
        <button className="btn-secondary" onClick={downloadPdf}>
          📄 Procès-verbal PDF
        </button>
      </div>

      {actionError && <ErrorBanner message={actionError} />}

      {/* Chronologie */}
      <div className="card">
        <div className="flex items-center justify-between">
          {timeline.map((step, idx) => (
            <div key={step.label} className="flex flex-1 items-center">
              <div className="flex flex-col items-center text-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                    step.done ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {idx + 1}
                </div>
                <p className={`mt-1.5 max-w-[110px] text-[11px] font-medium ${step.done ? 'text-slate-800' : 'text-slate-400'}`}>
                  {step.label}
                </p>
                {step.date && <p className="text-[10px] text-slate-400">{new Date(step.date).toLocaleDateString('fr-FR')}</p>}
              </div>
              {idx < timeline.length - 1 && (
                <div className={`mx-2 h-0.5 flex-1 ${step.done ? 'bg-brand-500' : 'bg-slate-200'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <h3 className="mb-2 font-semibold">Détails</h3>
          <dl className="space-y-1 text-sm">
            <div><dt className="inline text-slate-500">Véhicule : </dt><dd className="inline"><Link className="text-brand-500 hover:underline" href={`/vehicles/${item.vehicle.id}`}>{item.vehicle.plateNumber}</Link> {item.vehicle.make} {item.vehicle.model}</dd></div>
            {owner && <div><dt className="inline text-slate-500">Titulaire : </dt><dd className="inline"><Link className="text-brand-500 hover:underline" href={`/owners/${owner.id}`}>{owner.firstName} {owner.lastName}</Link></dd></div>}
            <div><dt className="inline text-slate-500">Agent : </dt><dd className="inline">{item.officer.firstName} {item.officer.lastName}</dd></div>
            {item.validatedBy && <div><dt className="inline text-slate-500">Validé par : </dt><dd className="inline">{item.validatedBy.firstName} {item.validatedBy.lastName}</dd></div>}
            {item.description && <div><dt className="inline text-slate-500">Circonstances : </dt><dd className="inline">{item.description}</dd></div>}
            {item.rejectionReason && <div><dt className="inline text-red-500">Motif rejet/annulation : </dt><dd className="inline">{item.rejectionReason}</dd></div>}
          </dl>
        </div>

        <div className="card">
          <h3 className="mb-2 font-semibold">Montants</h3>
          <dl className="space-y-1 text-sm">
            <div><dt className="inline text-slate-500">Amende forfaitaire : </dt><dd className="inline font-semibold">{item.fineAmount?.toFixed(2) ?? '—'} €</dd></div>
            <div><dt className="inline text-slate-500">Montant exigible : </dt><dd className="inline font-semibold text-brand-700">{item.amountDue?.toFixed(2) ?? '—'} €</dd></div>
            {item.points ? <div><dt className="inline text-slate-500">Points : </dt><dd className="inline">{item.points}</dd></div> : null}
            {item.dueDate && <div><dt className="inline text-slate-500">Échéance : </dt><dd className="inline">{new Date(item.dueDate).toLocaleDateString('fr-FR')}</dd></div>}
          </dl>
          {item.payments.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-2">
              <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Paiements</p>
              {item.payments.map((p) => (
                <p key={p.id} className="text-sm">
                  {p.amount.toFixed(2)} € — {METHOD_LABELS[p.method] ?? p.method} — reçu <span className="font-mono">{p.receiptNumber}</span>
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="mb-3 font-semibold">Actions</h3>
          <div className="space-y-2">
            {item.status === 'DRAFT' && (
              <button className="btn-primary w-full" onClick={() => act(() => api.patch(`/infractions/${item.id}/submit`))}>
                Soumettre à validation
              </button>
            )}
            {(item.status === 'PENDING_REVIEW' || item.status === 'PENDING') && canSupervise && (
              <>
                <button className="btn-primary w-full" onClick={() => act(() => api.patch(`/infractions/${item.id}/validate`))}>
                  ✓ Valider le PV
                </button>
                <div className="flex gap-2">
                  <input className="input" placeholder="Motif de rejet" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                  <button
                    className="btn-danger-ghost shrink-0"
                    onClick={() => rejectReason && act(() => api.patch(`/infractions/${item.id}/reject`, { reason: rejectReason }))}
                  >
                    Rejeter
                  </button>
                </div>
              </>
            )}
            {item.status === 'VALIDATED' && canCashier && (
              <button className="btn-primary w-full" onClick={() => act(() => api.patch(`/infractions/${item.id}/notify`))}>
                ✉️ Notifier le titulaire
              </button>
            )}
            {item.status === 'NOTIFIED' && canCashier && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase text-slate-400">Encaisser au guichet</p>
                <select className="input" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="COUNTER_CARD">Carte (guichet)</option>
                  <option value="CASH">Espèces</option>
                  <option value="TRANSFER">Virement</option>
                </select>
                <input className="input" placeholder="Nom du payeur" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
                <button
                  className="btn-primary w-full"
                  onClick={() => act(() => api.post(`/infractions/${item.id}/payments`, { method: payMethod, payerName }))}
                >
                  Encaisser {item.amountDue?.toFixed(2)} €
                </button>
              </div>
            )}
            {item.dispute && (item.dispute.status === 'PENDING' || item.dispute.status === 'UNDER_REVIEW') && canSupervise && (
              <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50/50 p-3">
                <p className="text-xs font-semibold uppercase text-orange-600">Contestation à traiter</p>
                <p className="text-sm">{item.dispute.reason}</p>
                {item.dispute.details && <p className="text-xs text-slate-500">{item.dispute.details}</p>}
                <textarea className="input" rows={2} placeholder="Décision motivée" value={disputeDecision} onChange={(e) => setDisputeDecision(e.target.value)} />
                <div className="flex gap-2">
                  <button
                    className="btn-primary flex-1"
                    onClick={() => disputeDecision && act(() => api.patch(`/infractions/${item.id}/dispute/decide`, { accept: true, decision: disputeDecision }))}
                  >
                    Accepter (annule le PV)
                  </button>
                  <button
                    className="btn-secondary flex-1"
                    onClick={() => disputeDecision && act(() => api.patch(`/infractions/${item.id}/dispute/decide`, { accept: false, decision: disputeDecision }))}
                  >
                    Rejeter (PV maintenu)
                  </button>
                </div>
              </div>
            )}
            {item.status === 'PAID' && canCashier && (
              <button className="btn-primary w-full" onClick={() => act(() => api.patch(`/infractions/${item.id}/close`))}>
                Clôturer le dossier
              </button>
            )}
            {['DRAFT', 'PENDING_REVIEW', 'PENDING', 'VALIDATED', 'NOTIFIED'].includes(item.status) && canSupervise && (
              <button
                className="btn-danger-ghost w-full"
                onClick={() => act(() => api.patch(`/infractions/${item.id}/cancel`, { reason: 'Annulation administrative' }))}
              >
                Annuler le PV
              </button>
            )}
          </div>
        </div>
      </div>

      {item.dispute && (
        <div className="card">
          <h3 className="mb-2 font-semibold">Contestation</h3>
          <p className="text-sm"><span className="text-slate-500">Statut :</span> {item.dispute.status} — <span className="text-slate-500">Motif :</span> {item.dispute.reason}</p>
          {item.dispute.decision && <p className="mt-1 text-sm"><span className="text-slate-500">Décision :</span> {item.dispute.decision}</p>}
        </div>
      )}

      {item.notifications.length > 0 && (
        <div className="card">
          <h3 className="mb-2 font-semibold">Notifications envoyées</h3>
          {item.notifications.map((n, i) => (
            <p key={i} className="text-sm text-slate-600">
              [{n.channel}] {n.subject} → {n.recipient} — {new Date(n.sentAt).toLocaleString('fr-FR')}
            </p>
          ))}
        </div>
      )}

      {item.capture && (
        <div className="card">
          <h3 className="mb-2 font-semibold">Preuve photographique</h3>
          <img src={item.capture.imageUrl} alt="preuve" className="h-48 rounded-lg object-cover" />
        </div>
      )}
    </div>
  );
}
