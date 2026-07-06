'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import { api } from '@/lib/api';

export default function AnalyticsPage() {
  const [byType, setByType] = useState<{ type: string; _count: { _all: number } }[]>([]);
  const [bySeverity, setBySeverity] = useState<{ severity: string; _count: { _all: number } }[]>([]);
  const [volume, setVolume] = useState<{ day: string; count: number }[]>([]);

  useEffect(() => {
    api.get('/analytics/infractions-by-type').then(setByType as any);
    api.get('/analytics/infractions-by-severity').then(setBySeverity as any);
    api.get('/analytics/capture-volume').then(setVolume as any);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Statistiques</h2>
        <p className="page-subtitle">Analyse des infractions et du volume de captures ALPR.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="card">
          <h3 className="mb-4 font-semibold">Infractions par type</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byType.map((d) => ({ name: d.type, count: d._count._all }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#2f5fdb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="mb-4 font-semibold">Infractions par gravité</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={bySeverity.map((d) => ({ name: d.severity, count: d._count._all }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card md:col-span-2">
          <h3 className="mb-4 font-semibold">Volume de captures (30 derniers jours)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={volume}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" fontSize={11} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#2f5fdb" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
