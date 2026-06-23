import React, { useEffect, useState, useRef } from 'react';
import { getInitials } from '../../utils/colors';

// Module-level cache so we don't refetch the same user repeatedly
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

async function fetchAvatar(username: string): Promise<string | null> {
  const key = username.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  if (inflight.has(key)) return inflight.get(key)!;

  const p = (async () => {
    try {
      const base = import.meta.env.VITE_API_URL || '';
      const token = localStorage.getItem('auth_token');
      const r = await fetch(`${base}/api/moderation/user/${encodeURIComponent(key)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error('failed');
      const data = await r.json();
      // Endpoint shape evolved: previously { profile_image_url, ... },
      // now { twitch: { profile_image_url, ... }, profile, timeline, ... }
      const url = data?.twitch?.profile_image_url || data?.profile_image_url || null;
      cache.set(key, url);
      return url;
    } catch {
      cache.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

interface Props {
  username: string;
  color: string;
  size?: number;
  fontSize?: number;
  borderRadius?: number | string;
}

export function Avatar({ username, color, size = 32, fontSize = 11, borderRadius = '50%' }: Props) {
  const [url, setUrl] = useState<string | null>(() => {
    const k = username.toLowerCase();
    return cache.get(k) ?? null;
  });
  const [errored, setErrored] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const k = username.toLowerCase();
    if (cache.has(k)) {
      setUrl(cache.get(k)!);
      return;
    }
    fetchAvatar(username).then(u => {
      if (mountedRef.current) setUrl(u);
    });
    return () => { mountedRef.current = false; };
  }, [username]);

  const showImg = url && !errored;

  return (
    <div style={{
      width: `${size}px`, height: `${size}px`, borderRadius,
      flexShrink: 0, overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: color + '20', color,
      border: `1px solid ${color}30`,
      fontSize: `${fontSize}px`, fontWeight: 700,
      position: 'relative',
    }}>
      {showImg ? (
        <img src={url!} alt={username}
          onError={() => setErrored(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        getInitials(username)
      )}
    </div>
  );
}
