'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from './Sidebar';

export function ProtectedShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Chargement…</div>;
  }

  return (
    <div className="flex">
      <Sidebar />
      <main className="min-h-screen flex-1 overflow-y-auto bg-slate-50 p-8">{children}</main>
    </div>
  );
}
