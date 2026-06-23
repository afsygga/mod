const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'auth_token';

function withAuth(init: RequestInit = {}): RequestInit {
  const t = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(init.headers || {});
  if (t) headers.set('Authorization', `Bearer ${t}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return { ...init, headers };
}

export const api = {
  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, withAuth());
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      throw new Error('unauthorized');
    }
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async post<T>(path: string, body: object): Promise<T> {
    const res = await fetch(`${BASE}${path}`, withAuth({ method: 'POST', body: JSON.stringify(body) }));
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async put<T>(path: string, body: object): Promise<T> {
    const res = await fetch(`${BASE}${path}`, withAuth({ method: 'PUT', body: JSON.stringify(body) }));
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async delete<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, withAuth({ method: 'DELETE' }));
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async patch<T>(path: string, body: object): Promise<T> {
    const res = await fetch(`${BASE}${path}`, withAuth({ method: 'PATCH', body: JSON.stringify(body) }));
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};
