import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../utils/logger';

export function broadcast(wss: WebSocketServer, data: object): void {
  const json = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}

interface OnlineUser {
  email: string;
  name: string | null;
  picture: string | null;
  connectedAt: number;
}

const onlineUsers = new Map<WebSocket, OnlineUser>();

export function getOnlineUsers(): OnlineUser[] {
  return [...onlineUsers.values()];
}

export function wsHandler(wss: WebSocketServer): void {
  wss.on('connection', (ws) => {
    logger.info('WebSocket client connected');
    ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'identify' && msg.email) {
          onlineUsers.set(ws, {
            email: msg.email,
            name: msg.name || null,
            picture: msg.picture || null,
            connectedAt: Date.now(),
          });
        }
        logger.debug('WS message received', msg);
      } catch {}
    });

    ws.on('close', () => {
      onlineUsers.delete(ws);
      logger.info('WebSocket client disconnected');
    });
    ws.on('error', (err) => logger.error('WebSocket error', err));
  });
}
