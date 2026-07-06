'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface OwnerDetail {
  id: string;
  firstName: string;
  lastName: string;
  licenseStatus: string;
  licenseNumber?: string;
  nationalId?: string;
  address?: string;
  phone?: string;
  ownerships: { id: string; startDate: string; endDate?: string; vehicle: { id: string; plateNumber: string; make?: string; model?: string } }[];
  infractions: { id: string; type: string; severity: string; occurredAt: string }[];
  cases: { id: string; title: string; status: string }[];
}

const LICENSE_COLORS: Record<string, string> = {
  VALID: 'bg-green-100 text-green-800',
  SUSPENDED: 'bg-orange-100 text-orange-800',
  REVOKED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-red-100 text-red-800',
  UNKNOWN: 'bg-slate-100 text-slate-700',
};

export default function OwnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [owner, setOwner] = useState<OwnerDetail | null>(null);

  useEffect(() => {
    api.get<OwnerDetail>(`/owners/${id}`).then(setOwner);
  }, [id]);

  if (!owner) return <p className="text-slate-400">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="page-title">{owner.firstName} {owner.lastName}</h2>
        <span className={`badge ${LICENSE_COLORS[owner.licenseStatus]}`}>Permis : {owner.licenseStatus}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <h3 className="mb-2 font-semibold">Informations</h3>
          <dl className="space-y-1 text-sm">
            <div><dt className="inline text-slate-500">Identifiant national : </dt><dd className="inline">{owner.nationalId}</dd></div>
            <div><dt className="inline text-slate-500">N° de permis : </dt><dd className="inline">{owner.licenseNumber}</dd></div>
            <div><dt className="inline text-slate-500">Adresse : </dt><dd className="inline">{owner.address}</dd></div>
            <div><dt className="inline text-slate-500">Téléphone : </dt><dd className="inline">{owner.phone}</dd></div>
          </dl>
        </div>

        <div className="card">
          <h3 className="mb-2 font-semibold">Véhicules possédés</h3>
          <ul className="space-y-1 text-sm">
            {owner.ownerships.map((o) => (
              <li key={o.id}>
                <Link href={`/vehicles/${o.vehicle.id}`} className="text-brand-500 hover:underline">
                  {o.vehicle.plateNumber}
                </Link>{' '}
                <span className="text-slate-400">
                  {o.vehicle.make} {o.vehicle.model} — {o.endDate ? 'ancien' : 'actuel'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3 className="mb-2 font-semibold">Infractions & dossiers</h3>
          <ul className="space-y-1 text-sm">
            {owner.infractions.map((i) => (
              <li key={i.id}>{i.type} — {i.occurredAt.slice(0, 10)}</li>
            ))}
            {owner.cases.map((c) => (
              <li key={c.id}>
                <Link href={`/cases/${c.id}`} className="text-brand-500 hover:underline">Dossier : {c.title}</Link> ({c.status})
              </li>
            ))}
            {owner.infractions.length === 0 && owner.cases.length === 0 && (
              <p className="text-slate-400">Aucun antécédent.</p>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
