'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { IconShield, IconCamera, IconAlert, IconAudit } from '@/components/icons';

const FEATURES = [
  { icon: IconCamera, title: 'Reconnaissance de plaques', text: "Lecture automatique par IA depuis caméras fixes et mobiles" },
  { icon: IconAlert, title: 'Alertes temps réel', text: 'Véhicules volés et personnes recherchées signalés instantanément' },
  { icon: IconAudit, title: 'Traçabilité complète', text: 'Chaque consultation est journalisée, conformité RGPD' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('agent@trafficguard.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Panneau marque */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-brand-900 p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 10%, rgb(47 95 219 / 0.5) 0%, transparent 70%), radial-gradient(50% 40% at 90% 90%, rgb(47 95 219 / 0.35) 0%, transparent 70%)',
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/40">
            <IconShield className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xl font-bold tracking-tight">TrafficGuard</p>
            <p className="text-[11px] font-medium uppercase tracking-widest text-brand-100/60">
              Gestion du trafic routier
            </p>
          </div>
        </div>

        <div className="relative max-w-md space-y-8">
          <h2 className="text-3xl font-bold leading-snug tracking-tight">
            La plateforme des forces de l'ordre pour la circulation routière
          </h2>
          <div className="space-y-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <f.icon className="h-4.5 w-4.5 text-brand-100" />
                </div>
                <div>
                  <p className="font-semibold">{f.title}</p>
                  <p className="text-sm text-brand-100/70">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-brand-100/40">
          Accès réservé au personnel autorisé. Toutes les actions sont journalisées.
        </p>
      </div>

      {/* Formulaire */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        <div className="animate-in w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700">
              <IconShield className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-brand-900">TrafficGuard</h1>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Connexion</h2>
          <p className="mb-8 mt-1 text-sm text-slate-500">Identifiez-vous avec votre compte agent.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">Email professionnel</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">Mot de passe</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <div className="animate-in rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}
            <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>

          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-400">
            <p className="mb-1 font-semibold text-slate-500">Comptes de démonstration</p>
            agent@trafficguard.local / Officer123!
            <br />
            superviseur@trafficguard.local / Supervisor123!
            <br />
            admin@trafficguard.local / Admin123!
          </div>
        </div>
      </div>
    </div>
  );
}
