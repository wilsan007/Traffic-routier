'use client';

import { useEffect, useState, use } from 'react';
import { api } from '@/lib/api';

interface CaseDetail {
  id: string;
  title: string;
  description?: string;
  status: string;
  createdBy: { firstName: string; lastName: string };
  vehicle?: { plateNumber: string };
  owner?: { firstName: string; lastName: string };
  notes: { id: string; content: string; createdAt: string; author: { firstName: string; lastName: string } }[];
  attachments: { id: string; url: string; type?: string }[];
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [item, setItem] = useState<CaseDetail | null>(null);
  const [note, setNote] = useState('');

  function refresh() {
    api.get<CaseDetail>(`/cases/${id}`).then(setItem);
  }

  useEffect(refresh, [id]);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    await api.post(`/cases/${id}/notes`, { content: note });
    setNote('');
    refresh();
  }

  async function updateStatus(status: string) {
    await api.patch(`/cases/${id}`, { status });
    refresh();
  }

  if (!item) return <p className="text-slate-400">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="page-title">{item.title}</h2>
          <p className="page-subtitle">{item.description}</p>
        </div>
        <select className="input w-full sm:w-40" value={item.status} onChange={(e) => updateStatus(e.target.value)}>
          <option value="OPEN">Ouvert</option>
          <option value="IN_PROGRESS">En cours</option>
          <option value="CLOSED">Clôturé</option>
        </select>
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">Notes</h3>
        <ul className="mb-4 space-y-3 text-sm">
          {item.notes.map((n) => (
            <li key={n.id} className="border-b border-slate-100 pb-2">
              <p>{n.content}</p>
              <p className="text-xs text-slate-400">
                {n.author.firstName} {n.author.lastName} · {n.createdAt.slice(0, 19).replace('T', ' ')}
              </p>
            </li>
          ))}
          {item.notes.length === 0 && <p className="text-slate-400">Aucune note.</p>}
        </ul>
        <form onSubmit={addNote} className="flex flex-col gap-3 sm:flex-row">
          <input className="input" placeholder="Ajouter une note…" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary">Ajouter</button>
        </form>
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">Pièces jointes</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {item.attachments.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="text-xs text-brand-500 underline">
              Pièce jointe
            </a>
          ))}
          {item.attachments.length === 0 && <p className="text-sm text-slate-400">Aucune pièce jointe.</p>}
        </div>
      </div>
    </div>
  );
}
