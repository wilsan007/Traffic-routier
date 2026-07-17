'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api';
import { IconShield } from '@/components/icons';

interface PublicInfraction {
  reference: string;
  status: string;
  type: string;
  description?: string;
  occurredAt: string;
  plate: string;
  vehicle: string;
  fineAmount?: number;
  amountDue?: number;
  dueDate?: string;
  payments: { amount: number; receiptNumber: string; createdAt: string }[];
  dispute?: { status: string; decision?: string } | null;
}

const STATUS_FR: Record<string, string> = {
  NOTIFIED: 'À régler',
  PAID: 'Payée',
  CONTESTED: 'Contestation en cours',
  CANCELLED: 'Annulée',
  CLOSED: 'Clôturée',
  VALIDATED: 'En cours de traitement',
};

export default function PortailPage() {
  const [reference, setReference] = useState('');
  const [plate, setPlate] = useState('');
  const [pv, setPv] = useState<PublicInfraction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Paiement
  const [showPay, setShowPay] = useState(false);
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [receipt, setReceipt] = useState<{ receiptNumber: string; amount: number } | null>(null);

  // Contestation
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDetails, setDisputeDetails] = useState('');
  const [disputeEmail, setDisputeEmail] = useState('');
  const [disputeSent, setDisputeSent] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPv(null);
    setReceipt(null);
    setDisputeSent(false);
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/public/infractions/${encodeURIComponent(reference.trim())}?plate=${encodeURIComponent(plate.trim())}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'Introuvable');
      setPv(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recherche impossible');
    } finally {
      setLoading(false);
    }
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`${API_URL}/public/infractions/${pv!.reference}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plate: pv!.plate, cardNumber, cardHolder }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.message ?? 'Paiement refusé');
      return;
    }
    setReceipt(body);
    setShowPay(false);
    setPv((prev) =>
      prev
        ? {
            ...prev,
            status: 'PAID',
            payments: [{ amount: body.amount, receiptNumber: body.receiptNumber, createdAt: body.paidAt }, ...prev.payments],
          }
        : prev,
    );
  }

  async function dispute(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`${API_URL}/public/infractions/${pv!.reference}/dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plate: pv!.plate,
        reason: disputeReason,
        details: disputeDetails,
        contactEmail: disputeEmail || undefined,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.message ?? 'Contestation impossible');
      return;
    }
    setDisputeSent(true);
    setShowDispute(false);
    setPv((prev) =>
      prev ? { ...prev, status: 'CONTESTED', dispute: { status: body.status } } : prev,
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-5 sm:px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700">
            <IconShield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-brand-900 sm:text-lg">Portail citoyen — Contraventions</h1>
            <p className="text-xs text-slate-500">Consultez, payez ou contestez votre contravention en ligne</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <form onSubmit={lookup} className="card space-y-4">
          <h2 className="font-semibold">Retrouver ma contravention</h2>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[13px] font-semibold text-slate-700">Référence du PV</label>
              <input className="input font-mono" placeholder="PV-2026-000001" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} required />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-semibold text-slate-700">Plaque d'immatriculation</label>
              <input className="input font-mono" placeholder="123 D 45" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} required />
            </div>
          </div>
          <button className="btn-primary" disabled={loading}>{loading ? 'Recherche…' : 'Consulter'}</button>
          <p className="text-xs text-slate-400">La référence figure sur l'avis de contravention que vous avez reçu.</p>
        </form>

        {error && <div className="animate-in rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {receipt && (
          <div className="card animate-in border-emerald-200 bg-emerald-50/50">
            <h3 className="font-semibold text-emerald-800">✓ Paiement accepté</h3>
            <p className="mt-1 text-sm text-emerald-700">
              Montant : <b>{receipt.amount.toFixed(2)} €</b> — Reçu n° <span className="font-mono">{receipt.receiptNumber}</span>. Conservez ce numéro.
            </p>
          </div>
        )}

        {disputeSent && (
          <div className="card animate-in border-blue-200 bg-blue-50/50">
            <h3 className="font-semibold text-blue-800">Contestation enregistrée</h3>
            <p className="mt-1 text-sm text-blue-700">Votre dossier sera examiné par un superviseur. Vous serez informé de la décision.</p>
          </div>
        )}

        {pv && (
          <div className="card animate-in space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-lg font-bold text-brand-900">{pv.reference}</p>
                <p className="text-sm text-slate-500">{pv.type} — {new Date(pv.occurredAt).toLocaleString('fr-FR')}</p>
                <p className="text-sm text-slate-500">Véhicule : <span className="font-mono font-semibold">{pv.plate}</span> {pv.vehicle}</p>
              </div>
              <span className="badge bg-slate-100 text-slate-700 self-start">{STATUS_FR[pv.status] ?? pv.status}</span>
            </div>

            {pv.amountDue != null && pv.amountDue > 0 && pv.status === 'NOTIFIED' && (
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Montant à régler</p>
                <p className="text-3xl font-bold text-brand-900">{pv.amountDue.toFixed(2)} €</p>
                {pv.dueDate && <p className="mt-1 text-xs text-slate-400">Avant le {new Date(pv.dueDate).toLocaleDateString('fr-FR')} (majoration au-delà)</p>}
              </div>
            )}

            {pv.payments.length > 0 && (
              <div className="text-sm text-emerald-700">
                ✓ Payée le {new Date(pv.payments[0].createdAt).toLocaleDateString('fr-FR')} — reçu <span className="font-mono">{pv.payments[0].receiptNumber}</span>
              </div>
            )}
            {pv.dispute && <p className="text-sm text-orange-700">Contestation : {pv.dispute.status === 'PENDING' ? 'en cours d’examen' : pv.dispute.decision}</p>}

            <div className="flex flex-wrap gap-3">
              <a
                className="btn-secondary"
                href={`${API_URL}/public/infractions/${pv.reference}/pdf?plate=${encodeURIComponent(pv.plate)}`}
                target="_blank"
                rel="noreferrer"
              >
                📄 Télécharger le PV
              </a>
              {pv.status === 'NOTIFIED' && (
                <>
                  <button className="btn-primary" onClick={() => { setShowPay((v) => !v); setShowDispute(false); }}>
                    💳 Payer en ligne
                  </button>
                  <button className="btn-secondary" onClick={() => { setShowDispute((v) => !v); setShowPay(false); }}>
                    ✍️ Contester
                  </button>
                </>
              )}
            </div>

            {showPay && (
              <form onSubmit={pay} className="animate-in space-y-3 rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-semibold">Paiement par carte (simulation — aucune donnée bancaire réelle)</p>
                <input className="input font-mono" placeholder="Numéro de carte (16 chiffres)" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} required />
                <input className="input" placeholder="Titulaire de la carte" value={cardHolder} onChange={(e) => setCardHolder(e.target.value)} required />
                <button className="btn-primary w-full">Payer {pv.amountDue?.toFixed(2)} €</button>
                <p className="text-xs text-slate-400">Astuce démo : un numéro finissant par 0 simule un refus bancaire.</p>
              </form>
            )}

            {showDispute && (
              <form onSubmit={dispute} className="animate-in space-y-3 rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-semibold">Contester cette contravention</p>
                <input className="input" placeholder="Motif (ex: véhicule vendu, usurpation de plaque…)" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} required />
                <textarea className="input" rows={3} placeholder="Explications détaillées" value={disputeDetails} onChange={(e) => setDisputeDetails(e.target.value)} />
                <input className="input" type="email" placeholder="Email de contact (optionnel)" value={disputeEmail} onChange={(e) => setDisputeEmail(e.target.value)} />
                <button className="btn-primary w-full">Envoyer la contestation</button>
              </form>
            )}
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-3xl px-4 pb-10 text-center text-xs text-slate-400 sm:px-6">
        Démonstrateur TrafficGuard — les paiements sont simulés, aucune donnée bancaire n'est traitée ni conservée.
      </footer>
    </div>
  );
}
