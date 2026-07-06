'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getAlertsSocket } from '@/lib/socket';
import { StatCard } from '@/components/StatCard';
import { PriorityBadge } from '@/components/PriorityBadge';
import { LoadingSpinner, ErrorBanner, EmptyState } from '@/components/Feedback';
import { IconCar, IconUsers, IconShield, IconFolder, IconAlert, IconCamera } from '@/components/icons';
import type { Alert } from '@trafficguard/shared';

interface Overview {
  vehicles: number;
  owners: number;
  activeHotlist: number;
  openCases: number;
  newAlerts: number;
  capturesToday: number;
}

export default function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [liveAlerts, setLiveAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, alerts] = await Promise.all([
        api.get<Overview>('/analytics/overview'),
        api.get<Alert[]>('/alerts?status=NEW'),
      ]);
      setOverview(ov);
      setLiveAlerts(alerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les données');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    const socket = getAlertsSocket();
    const onNewAlert = (alert: Alert) => setLiveAlerts((prev) => [alert, ...prev].slice(0, 20));
    socket.on('alert.new', onNewAlert);
    return () => {
      socket.off('alert.new', onNewAlert);
    };
  }, [loadData]);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="page-title">Tableau de bord</h2>
          <p className="page-subtitle">Vue d'ensemble de l'activité en temps réel</p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          En direct
        </span>
      </div>

      {error && <ErrorBanner message={error} onRetry={loadData} />}
      {loading && <LoadingSpinner label="Chargement du tableau de bord…" />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Véhicules" value={overview?.vehicles ?? '—'} icon={<IconCar />} accent="blue" />
            <StatCard label="Propriétaires" value={overview?.owners ?? '—'} icon={<IconUsers />} accent="slate" />
            <StatCard label="Surveillance active" value={overview?.activeHotlist ?? '—'} icon={<IconShield />} accent="amber" />
            <StatCard label="Dossiers ouverts" value={overview?.openCases ?? '—'} icon={<IconFolder />} accent="green" />
            <StatCard label="Nouvelles alertes" value={overview?.newAlerts ?? '—'} icon={<IconAlert />} accent="red" />
            <StatCard label="Captures du jour" value={overview?.capturesToday ?? '—'} icon={<IconCamera />} accent="blue" />
          </div>

          <div className="card">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-slate-900">Alertes en temps réel</h3>
              <Link href="/alerts" className="text-sm font-medium text-brand-500 hover:text-brand-600">
                Tout voir →
              </Link>
            </div>
            {liveAlerts.length === 0 ? (
              <EmptyState message="Aucune alerte active — la situation est calme." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {liveAlerts.map((alert) => (
                  <li key={alert.id} className="animate-in flex items-center justify-between py-3.5">
                    <div className="flex items-center gap-4">
                      <span className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 font-mono text-sm font-bold tracking-wider text-slate-900">
                        {alert.capture.plateNumberNormalized}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-slate-700">{alert.hotlistEntry.reason}</p>
                        <p className="text-xs text-slate-400">
                          {new Date(alert.createdAt).toLocaleString('fr-FR')}
                        </p>
                      </div>
                    </div>
                    <PriorityBadge priority={alert.hotlistEntry.priority} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
