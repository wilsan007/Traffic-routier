'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { LoadingSpinner, ErrorBanner } from '@/components/Feedback';
import { IconSearch, IconCar, IconUsers } from '@/components/icons';
import type { SearchType, Vehicle, Owner } from '@trafficguard/shared';

interface SearchResult {
  vehicles: (Vehicle & { id: string; ownerships?: { owner: Owner }[] })[];
  owners: Owner[];
}

const TYPE_OPTIONS: { value: SearchType; label: string }[] = [
  { value: 'PLATE', label: 'Plaque' },
  { value: 'VIN', label: 'VIN' },
  { value: 'OWNER', label: 'Propriétaire' },
];

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('PLATE');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SearchResult>(
        `/search?q=${encodeURIComponent(query)}&type=${type}`,
      );
      setResults(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de recherche');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Recherche unifiée</h2>
        <p className="page-subtitle">
          Plaque, propriétaire ou numéro VIN — chaque recherche est journalisée.
        </p>
      </div>

      <form onSubmit={handleSearch} className="card">
        <div className="mb-3 flex gap-1.5">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                type === opt.value
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-10"
              placeholder={type === 'OWNER' ? 'Nom, identifiant national, n° de permis…' : 'AB123CD…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <button className="btn-primary px-6" disabled={loading}>
            {loading ? 'Recherche…' : 'Rechercher'}
          </button>
        </div>
      </form>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingSpinner label="Recherche en cours…" />}

      {results && !loading && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card animate-in">
            <div className="mb-3 flex items-center gap-2">
              <IconCar className="h-4 w-4 text-slate-400" />
              <h3 className="text-[15px] font-semibold">Véhicules ({results.vehicles.length})</h3>
            </div>
            <ul className="divide-y divide-slate-100">
              {results.vehicles.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/vehicles/${v.id}`}
                    className="flex items-center justify-between py-3 transition-colors hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-3">
                      <span className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 font-mono text-sm font-bold tracking-wider">
                        {v.plateNumber}
                      </span>
                      <span className="text-sm text-slate-600">
                        {v.make} {v.model}
                      </span>
                    </div>
                    {v.stolen && <span className="badge bg-red-50 text-red-700">Volé</span>}
                  </Link>
                </li>
              ))}
              {results.vehicles.length === 0 && (
                <p className="py-4 text-sm text-slate-400">Aucun véhicule trouvé.</p>
              )}
            </ul>
          </div>

          <div className="card animate-in">
            <div className="mb-3 flex items-center gap-2">
              <IconUsers className="h-4 w-4 text-slate-400" />
              <h3 className="text-[15px] font-semibold">Propriétaires ({results.owners.length})</h3>
            </div>
            <ul className="divide-y divide-slate-100">
              {results.owners.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/owners/${o.id}`}
                    className="flex items-center justify-between py-3 transition-colors hover:bg-slate-50"
                  >
                    <span className="text-sm font-medium text-slate-800">
                      {o.firstName} {o.lastName}
                    </span>
                    <span className="text-xs text-slate-400">Permis : {o.licenseStatus}</span>
                  </Link>
                </li>
              ))}
              {results.owners.length === 0 && (
                <p className="py-4 text-sm text-slate-400">Aucun propriétaire trouvé.</p>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
