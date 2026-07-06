'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  IconDashboard,
  IconSearch,
  IconAlert,
  IconTicket,
  IconShield,
  IconFolder,
  IconChart,
  IconAudit,
  IconUsers,
  IconLogout,
  IconCar,
  IconCamera,
} from './icons';

const NAV_SECTIONS: { label: string; items: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[] }[] = [
  {
    label: 'Opérations',
    items: [
      { href: '/', label: 'Tableau de bord', icon: IconDashboard },
      { href: '/map', label: 'Carte', icon: IconSearch },
      { href: '/search', label: 'Recherche', icon: IconSearch },
      { href: '/alerts', label: 'Alertes', icon: IconAlert },
      { href: '/cameras', label: 'Caméras', icon: IconCamera },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { href: '/infractions', label: 'Infractions', icon: IconTicket },
      { href: '/bareme', label: 'Barème', icon: IconAudit },
      { href: '/hotlist', label: 'Surveillance', icon: IconShield },
      { href: '/patterns', label: 'Analyse comportementale', icon: IconChart },
      { href: '/cases', label: 'Dossiers', icon: IconFolder },
      { href: '/fleets', label: 'Flottes', icon: IconCar },
      { href: '/tolls', label: 'Péages', icon: IconTicket },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/analytics', label: 'Statistiques', icon: IconChart },
      { href: '/audit', label: "Journal d'audit", icon: IconAudit },
      { href: '/users', label: 'Agents', icon: IconUsers },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase();

  return (
    <aside className="sticky top-0 flex h-screen w-64 flex-col border-r border-white/5 bg-brand-900 text-white">
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/30">
          <IconShield className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-[17px] font-bold leading-tight tracking-tight">TrafficGuard</h1>
          <p className="text-[11px] font-medium uppercase tracking-widest text-brand-100/60">Police · Trafic</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4 pt-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-100/40">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all ${
                      active
                        ? 'bg-white/10 text-white shadow-sm'
                        : 'text-brand-100/70 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-500" />
                    )}
                    <Icon
                      className={`transition-colors ${active ? 'text-brand-100' : 'text-brand-100/50 group-hover:text-brand-100'}`}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/30 text-xs font-bold text-brand-100">
            {initials || '·'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[11px] text-brand-100/50">
              {user?.role === 'ADMIN' ? 'Administrateur' : user?.role === 'SUPERVISOR' ? 'Superviseur' : 'Agent'}
              {user?.badgeNumber ? ` · ${user.badgeNumber}` : ''}
            </p>
          </div>
          <button
            onClick={logout}
            title="Se déconnecter"
            className="rounded-lg p-2 text-brand-100/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconLogout className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
