'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  badgeNumber?: string;
  role: string;
  active: boolean;
}

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', badgeNumber: '', role: 'OFFICER' });

  function refresh() {
    api.get<UserRow[]>('/users').then(setUsers).catch(() => undefined);
  }

  useEffect(refresh, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/users', form);
    setForm({ email: '', password: '', firstName: '', lastName: '', badgeNumber: '', role: 'OFFICER' });
    refresh();
  }

  async function deactivate(id: string) {
    await api.patch(`/users/${id}/deactivate`);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Agents</h2>
        <p className="page-subtitle">Gestion des comptes et des rôles (admin/superviseur/agent).</p>
      </div>

      {user?.role === 'ADMIN' && (
        <form onSubmit={handleCreate} className="card grid gap-3 md:grid-cols-6">
          <input className="input" placeholder="Prénom" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          <input className="input" placeholder="Nom" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
          <input className="input" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input className="input" placeholder="Mot de passe" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <input className="input" placeholder="Matricule" value={form.badgeNumber} onChange={(e) => setForm({ ...form, badgeNumber: e.target.value })} />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="OFFICER">Agent</option>
            <option value="SUPERVISOR">Superviseur</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button className="btn-primary md:col-span-6">Créer le compte</button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="table-modern">
          <thead>
            <tr>
              <th className="py-2">Nom</th>
              <th>Email</th>
              <th>Matricule</th>
              <th>Rôle</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100">
                <td className="py-2">{u.firstName} {u.lastName}</td>
                <td>{u.email}</td>
                <td>{u.badgeNumber}</td>
                <td>{u.role}</td>
                <td>{u.active ? 'Actif' : 'Inactif'}</td>
                <td>
                  {user?.role === 'ADMIN' && u.active && (
                    <button onClick={() => deactivate(u.id)} className="text-xs text-red-600 underline">Désactiver</button>
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
