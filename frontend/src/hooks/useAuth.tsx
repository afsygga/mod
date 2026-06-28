import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'auth_token';

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  role: 'admin' | 'user';
  enabled: boolean;
}

interface Ctx {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  networkError: boolean;
  error: string | null;
  loginWithGoogle: (credential: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setUser(null); setLoading(false); setNetworkError(false); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const r = await fetch(`${BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
        signal: controller.signal,
      });
      if (r.status === 401) {
        // Token explicitly rejected — log out
        localStorage.removeItem(TOKEN_KEY);
        setToken(null); setUser(null); setNetworkError(false);
      } else if (!r.ok) {
        // Server error — keep token, show reconnecting
        setNetworkError(true);
      } else {
        const d = await r.json();
        setUser(d.user);
        setNetworkError(false);
      }
    } catch {
      // Network error or timeout — keep token, retry later
      setNetworkError(true);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  // Retry every 5s when network error
  useEffect(() => {
    if (!networkError) return;
    const id = setInterval(() => refresh(), 5000);
    return () => clearInterval(id);
  }, [networkError, refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  const loginWithGoogle = useCallback(async (credential: string) => {
    setError(null);
    try {
      const r = await fetch(`${BASE}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || 'login failed');
        return { ok: false, error: d.error };
      }
      localStorage.setItem(TOKEN_KEY, d.token);
      setToken(d.token);
      setUser(d.user);
      return { ok: true };
    } catch (err: any) {
      setError(err?.message || 'network error');
      return { ok: false, error: err?.message };
    }
  }, []);

  const logout = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) {
      await fetch(`${BASE}/api/auth/logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${t}` },
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    // Force Google to show account picker next time, not auto-select
    try {
      (window as any).google?.accounts?.id?.disableAutoSelect?.();
    } catch {}
  }, []);

  return (
    <AuthCtx.Provider value={{ user, token, loading, networkError, error, loginWithGoogle, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}

// Helper to make authenticated fetch
export function authFetch(path: string, init: RequestInit = {}) {
  const t = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(init.headers || {});
  if (t) headers.set('Authorization', `Bearer ${t}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${BASE}${path}`, { ...init, headers });
}
