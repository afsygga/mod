import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';

const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

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

function getCachedUser(): AuthUser | null {
  try { const s = localStorage.getItem(USER_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const cachedUser = getCachedUser();
  const hasToken = !!localStorage.getItem(TOKEN_KEY);

  // If we have a cached user + token → show UI immediately, no loading screen
  const [user, setUser] = useState<AuthUser | null>(cachedUser);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  // loading=true only when we have a token but no cached user (fresh login on new device)
  const [loading, setLoading] = useState(!cachedUser && hasToken);
  const [networkError, setNetworkError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      localStorage.removeItem(USER_KEY);
      setUser(null); setLoading(false); setNetworkError(false);
      return;
    }
    inFlightRef.current = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`${BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
        signal: ctrl.signal,
      });
      if (r.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null); setUser(null); setNetworkError(false);
      } else if (r.ok) {
        const d = await r.json();
        localStorage.setItem(USER_KEY, JSON.stringify(d.user));
        setUser(d.user); setNetworkError(false);
      } else {
        setNetworkError(true);
      }
    } catch {
      setNetworkError(true);
    } finally {
      clearTimeout(timer);
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // Initial background refresh — validates the cached session
  useEffect(() => { refresh(); }, [refresh]);

  // Retry every 4s on network error
  useEffect(() => {
    if (!networkError) return;
    const id = setInterval(() => refresh(), 4000);
    return () => clearInterval(id);
  }, [networkError, refresh]);

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
      localStorage.setItem(USER_KEY, JSON.stringify(d.user));
      setToken(d.token); setUser(d.user);
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
    localStorage.removeItem(USER_KEY);
    setToken(null); setUser(null);
    try { (window as any).google?.accounts?.id?.disableAutoSelect?.(); } catch {}
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

export function authFetch(path: string, init: RequestInit = {}) {
  const t = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(init.headers || {});
  if (t) headers.set('Authorization', `Bearer ${t}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${BASE}${path}`, { ...init, headers });
}
