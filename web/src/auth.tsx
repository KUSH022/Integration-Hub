import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, get, onUnauthorized, post } from './api/client';
import type { Role, User } from './api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (role: Role) => boolean;
}

const Ctx = createContext<AuthState | null>(null);
const RANK: Record<Role, number> = { VIEWER: 1, OPERATOR: 2, ADMIN: 3 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<{ user: User }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch((e) => {
        if (!(e instanceof ApiError) || e.status !== 401) console.warn('Session check failed', e);
        setUser(null);
      })
      .finally(() => setLoading(false));
    return onUnauthorized(() => setUser(null));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await post<{ user: User }>('/api/auth/login', { email, password });
    setUser(r.user);
  }, []);
  const logout = useCallback(async () => {
    try {
      await post('/api/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);
  const can = useCallback((role: Role) => Boolean(user && RANK[user.role] >= RANK[role]), [user]);

  return <Ctx.Provider value={{ user, loading, login, logout, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
