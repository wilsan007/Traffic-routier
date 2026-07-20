import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import type { AuthUser } from '@trafficguard/shared';
import { api, getToken, setToken, setRefreshToken } from './api';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// L'API tourne sur le palier gratuit Render, qui met l'instance en veille apres
// inactivite : le premier appel doit attendre un demarrage a froid de 30-60s.
// Ajoute a cela le reseau mobile terrain, un timeout court rendait la connexion
// tout simplement impossible ("Serveur injoignable") au premier lancement.
const LOGIN_TIMEOUT_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const stored = await AsyncStorage.getItem('tg_user');
      if (token && stored) setUser(JSON.parse(stored));
      setLoading(false);
    })();
  }, []);

  async function login(email: string, password: string) {
    const res = await Promise.race([
      api.post<{ accessToken: string; refreshToken: string; user: AuthUser }>('/auth/login', {
        email,
        password,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('ABORT_TIMEOUT')), LOGIN_TIMEOUT_MS),
      ),
    ]);
    await setToken(res.accessToken);
    await setRefreshToken(res.refreshToken);
    await AsyncStorage.setItem('tg_user', JSON.stringify(res.user));
    setUser(res.user);
    router.replace('/(tabs)');
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore errors on logout
    }
    await setToken(null);
    await setRefreshToken(null);
    await AsyncStorage.removeItem('tg_user');
    setUser(null);
    router.replace('/login');
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
