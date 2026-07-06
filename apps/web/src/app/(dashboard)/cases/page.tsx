'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface CaseRow {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  createdBy: { firstName: string; lastName: string };
  vehicle?: { plateNumber: string };
}

export default function CasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  function refresh() {
    api.get<CaseRow[]>('/cases').then(setCases);
  }

  useEffect(refresh, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/cases', { title, description });
    setTitle('');
    setDescription('');
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Dossiers</h2>
        <p className="page-subtitle">Rapports d'incident et suivi des dossiers en cours.</p>
      </div>

      <form onSubmit={handleCreate} className="card flex gap-3">
        <input className="input" placeholder="Titre du dossier" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input className="input" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button className="btn-primary">Créer</button>
      </form>

      <div className="grid gap-3">
        {cases.map((c) => (
          <Link key={c.id} href={`/cases/${c.id}`} className="card flex items-center justify-between hover:border-brand-500">
            <div>
              <p className="font-semibold">{c.title}</p>
              <p className="text-xs text-slate-400">
                {c.createdBy.firstName} {c.createdBy.lastName} · {c.createdAt.slice(0, 10)}
              </p>
            </div>
            <span className="badge bg-slate-100 text-slate-700">{c.status}</span>
          </Link>
        ))}
        {cases.length === 0 && <p className="text-slate-400">Aucun dossier.</p>}
      </div>
    </div>
  );
}
