import { useEffect, useRef, useCallback } from 'react';

type Handler = (data: any) => void;

export function useWebSocket(onMessage: Handler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  const connect = useCallback(() => {
    const wsUrl = (import.meta.env.VITE_WS_URL || 'ws://localhost:4000').replace(/^http/, 'ws');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => console.log('[WS] connected');
    ws.onmessage = (e) => {
      try { handlerRef.current(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = () => {
      console.log('[WS] disconnected, reconnecting in 3s...');
      reconnectRef.current = setTimeout(connect, 3000);
    };
    ws.onerror = (e) => console.error('[WS] error', e);
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send };
}
