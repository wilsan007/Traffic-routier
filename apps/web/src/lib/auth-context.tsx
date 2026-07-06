'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthUser } from '@trafficguard/shared';
import { api, getToken, setToken } from './api';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('tg_user') : null;
    if (stored && getToken()) {
      setUser(JSON.parse(stored));
    }
    setLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ accessToken: string; user: AuthUser }>('/auth/login', {
      email,
      password,
    });
    setToken(res.accessToken);
    document.cookie = `tg_token=${res.accessToken}; path=/; max-age=${60 * 60 * 8}; SameSite=Lax`;
    localStorage.setItem('tg_user', JSON.stringify(res.user));
    setUser(res.user);
    router.push('/');
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore errors on logout
    }
    setToken(null);
    document.cookie = 'tg_token=; path=/; max-age=0';
    localStorage.removeItem('tg_user');
    setUser(null);
    router.push('/login');
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
