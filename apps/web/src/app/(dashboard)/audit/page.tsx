'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  ipAddress?: string;
  createdAt: string;
  user?: { firstName: string; lastName: string; badgeNumber?: string };
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditRow[]>([]);

  useEffect(() => {
    api.get<AuditRow[]>('/audit-logs').then(setLogs);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Journal d'audit</h2>
        <p className="page-subtitle">Traçabilité complète des actions effectuées par les agents (réservé admin/superviseur).</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-modern">
          <thead>
            <tr>
              <th className="py-2">Date</th>
              <th>Agent</th>
              <th>Action</th>
              <th>Entité</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className="py-2">{l.createdAt.slice(0, 19).replace('T', ' ')}</td>
                <td>{l.user ? `${l.user.firstName} ${l.user.lastName}` : '—'}</td>
                <td>{l.action}</td>
                <td>{l.entityType}</td>
                <td>{l.ipAddress}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && <p className="py-4 text-center text-slate-400">Aucune entrée.</p>}
      </div>
    </div>
  );
}
