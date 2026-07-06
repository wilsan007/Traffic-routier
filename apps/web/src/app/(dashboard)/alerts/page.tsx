'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getAlertsSocket } from '@/lib/socket';
import { PriorityBadge } from '@/components/PriorityBadge';
import { LoadingSpinner, ErrorBanner, EmptyState } from '@/components/Feedback';
import type { Alert } from '@trafficguard/shared';

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Nouvelle',
  ACKNOWLEDGED: 'Prise en compte',
  RESOLVED: 'Résolue',
  FALSE_POSITIVE: 'Faux positif',
};

const STATUS_STYLES: Record<string, string> = {
  NEW: 'bg-red-50 text-red-700',
  ACKNOWLEDGED: 'bg-amber-50 text-amber-700',
  RESOLVED: 'bg-emerald-50 text-emerald-700',
  FALSE_POSITIVE: 'bg-slate-100 text-slate-500',
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<Alert[]>('/alerts');
      setAlerts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les alertes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const socket = getAlertsSocket();
    socket.on('alert.new', refresh);
    socket.on('alert.update', refresh);
    return () => {
      socket.off('alert.new', refresh);
      socket.off('alert.update', refresh);
    };
  }, [refresh]);

  async function acknowledge(id: string) {
    await api.patch(`/alerts/${id}/acknowledge`);
    refresh();
  }

  async function resolve(id: string, status: 'RESOLVED' | 'FALSE_POSITIVE') {
    await api.patch(`/alerts/${id}/resolve`, { status });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Alertes</h2>
        <p className="page-subtitle">Correspondances en temps réel avec la liste de surveillance.</p>
      </div>

      {error && <ErrorBanner message={error} onRetry={refresh} />}
      {loading && <LoadingSpinner label="Chargement des alertes…" />}

      {!loading && !error && (
        <div className="space-y-3">
          {alerts.length === 0 && (
            <div className="card">
              <EmptyState message="Aucune alerte pour le moment." />
            </div>
          )}
          {alerts.map((alert) => (
            <div key={alert.id} className="card animate-in flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <span className="shrink-0 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-[15px] font-bold tracking-wider text-slate-900">
                  {alert.capture.plateNumberNormalized}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{alert.hotlistEntry.reason}</p>
                  <p className="truncate text-xs text-slate-400">
                    {alert.hotlistEntry.notes || '—'} · {new Date(alert.createdAt).toLocaleString('fr-FR')}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2.5">
                <PriorityBadge priority={alert.hotlistEntry.priority} />
                <span className={`badge ${STATUS_STYLES[alert.status] ?? STATUS_STYLES.NEW}`}>
                  {STATUS_LABELS[alert.status] ?? alert.status}
                </span>
                {alert.status === 'NEW' && (
                  <button onClick={() => acknowledge(alert.id)} className="btn-secondary px-3 py-1.5 text-xs">
                    Prendre en compte
                  </button>
                )}
                {alert.status !== 'RESOLVED' && alert.status !== 'FALSE_POSITIVE' && (
                  <>
                    <button onClick={() => resolve(alert.id, 'RESOLVED')} className="btn-primary px-3 py-1.5 text-xs">
                      Résoudre
                    </button>
                    <button
                      onClick={() => resolve(alert.id, 'FALSE_POSITIVE')}
                      className="btn-danger-ghost"
                    >
                      Faux positif
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
