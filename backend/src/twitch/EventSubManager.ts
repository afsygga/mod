import WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import { db } from '../database/db';
import { broadcast } from '../websocket/wsHandler';
import { logger } from '../utils/logger';

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

interface ModToken {
  email: string;
  login: string;
  token: string;   // raw access token (no oauth: prefix)
  userId: string;  // twitch user id of the token owner
}

/**
 * Subscribes to Twitch EventSub `channel.moderate` (v2) over a WebSocket so we
 * capture EVERY moderation action on monitored channels — bans, timeouts,
 * unbans, deletes — regardless of which client performed them (Chatterino,
 * Twitch panel, other mods). Each event is written to moderation_logs and
 * pushed to the dashboard live.
 *
 * Designed defensively: all async work is wrapped so a failure can never
 * crash the process; the socket auto-reconnects with backoff.
 */
export class EventSubManager {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private wss: WebSocketServer;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 2_000;
  private idCache = new Map<string, string>(); // login -> twitch user id
  private started = false;

  constructor(wss: WebSocketServer) {
    this.wss = wss;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect(EVENTSUB_URL);
  }

  private connect(url: string): void {
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      logger.error('[eventsub] connect threw', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('message', (raw: WebSocket.RawData) => {
      this.handleMessage(raw).catch(err => logger.error('[eventsub] handle error', err));
    });
    this.ws.on('close', () => {
      logger.warn('[eventsub] socket closed, reconnecting');
      this.scheduleReconnect();
    });
    this.ws.on('error', (err) => {
      logger.error('[eventsub] socket error', err?.message || err);
      // 'close' will fire after error; reconnect handled there
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.sessionId = null;
      this.connect(EVENTSUB_URL);
    }, this.reconnectDelay);
  }

  private async handleMessage(raw: WebSocket.RawData): Promise<void> {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const type = msg?.metadata?.message_type;

    if (type === 'session_welcome') {
      this.sessionId = msg.payload?.session?.id || null;
      this.reconnectDelay = 2_000; // reset backoff on success
      logger.info(`[eventsub] session ${this.sessionId}`);
      await this.subscribeAll();
    } else if (type === 'session_reconnect') {
      const newUrl = msg.payload?.session?.reconnect_url;
      if (newUrl) {
        logger.info('[eventsub] session_reconnect → switching socket');
        const old = this.ws;
        this.connect(newUrl);
        try { old?.removeAllListeners('close'); old?.close(); } catch {}
      }
    } else if (type === 'notification') {
      await this.handleNotification(msg.payload);
    }
    // session_keepalive / revocation: nothing to do
  }

  /** Resolve a Twitch user id from login (cached → twitch_user_meta → Helix). */
  private async resolveId(login: string, headers: Record<string, string>): Promise<string | null> {
    const key = login.toLowerCase();
    if (this.idCache.has(key)) return this.idCache.get(key)!;
    const { rows } = await db.query('SELECT twitch_id FROM twitch_user_meta WHERE username=$1', [key]);
    if (rows[0]?.twitch_id) { this.idCache.set(key, rows[0].twitch_id); return rows[0].twitch_id; }
    try {
      const r = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(key)}`, { headers });
      if (r.ok) {
        const d: any = await r.json();
        const id = d.data?.[0]?.id || null;
        if (id) {
          this.idCache.set(key, id);
          await db.query(
            `INSERT INTO twitch_user_meta (username, twitch_id, display_name, profile_image_url, fetched_at)
             VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (username) DO UPDATE SET twitch_id=$2, fetched_at=NOW()`,
            [key, id, d.data[0].display_name, d.data[0].profile_image_url]
          ).catch(() => {});
        }
        return id;
      }
    } catch {}
    return null;
  }

  /** All site users with a Twitch OAuth token, usable as moderators. */
  private async getModeratorTokens(): Promise<ModToken[]> {
    const { rows } = await db.query(
      "SELECT email, twitch_username, twitch_oauth FROM users WHERE twitch_oauth IS NOT NULL AND twitch_username IS NOT NULL"
    );
    const clientId = process.env.TWITCH_CLIENT_ID || '';
    const out: ModToken[] = [];
    for (const r of rows) {
      const token = String(r.twitch_oauth).replace(/^oauth:/, '');
      const login = String(r.twitch_username).toLowerCase();
      const headers = { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` };
      const userId = await this.resolveId(login, headers);
      if (userId) out.push({ email: r.email, login, token, userId });
    }
    return out;
  }

  private async subscribeAll(): Promise<void> {
    if (!this.sessionId) return;
    const tm: any = (global as any).twitchManager;
    const channels: string[] = tm?.getChannelNames ? tm.getChannelNames() : [];
    if (channels.length === 0) return;

    const mods = await this.getModeratorTokens();
    if (mods.length === 0) {
      logger.warn('[eventsub] no moderator tokens available — nobody authorized via Twitch');
      return;
    }
    const clientId = process.env.TWITCH_CLIENT_ID || '';

    for (const channel of channels) {
      const ch = channel.toLowerCase();
      // Use the first mod's headers just to resolve the broadcaster id
      const probeHeaders = { 'Client-Id': clientId, 'Authorization': `Bearer ${mods[0].token}` };
      const broadcasterId = await this.resolveId(ch, probeHeaders);
      if (!broadcasterId) continue;

      // Try each moderator token until one subscription succeeds
      let ok = false;
      for (const mod of mods) {
        const success = await this.subscribeChannel(broadcasterId, mod, clientId);
        if (success) { ok = true; break; }
      }
      if (!ok) logger.warn(`[eventsub] could not subscribe channel.moderate for ${ch} (no mod token has scopes/rights)`);
    }
  }

  private async subscribeChannel(broadcasterId: string, mod: ModToken, clientId: string): Promise<boolean> {
    try {
      const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST',
        headers: {
          'Client-Id': clientId,
          'Authorization': `Bearer ${mod.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'channel.moderate',
          version: '2',
          condition: { broadcaster_user_id: broadcasterId, moderator_user_id: mod.userId },
          transport: { method: 'websocket', session_id: this.sessionId },
        }),
      });
      if (res.status === 202 || res.ok) {
        logger.info(`[eventsub] subscribed channel.moderate broadcaster=${broadcasterId} via ${mod.login}`);
        return true;
      }
      const body = await res.text().catch(() => '');
      // 409 = already subscribed (treat as success); 403 = missing scope/not a mod (try next)
      if (res.status === 409) return true;
      logger.warn(`[eventsub] subscribe ${res.status} broadcaster=${broadcasterId} via ${mod.login}: ${body}`);
      return false;
    } catch (err: any) {
      logger.error('[eventsub] subscribe threw', err?.message || err);
      return false;
    }
  }

  private async handleNotification(payload: any): Promise<void> {
    const event = payload?.event;
    const subType = payload?.subscription?.type;
    if (!event || subType !== 'channel.moderate') return;

    const channel = (event.broadcaster_user_login || '').toLowerCase();
    const performedBy = event.moderator_user_login || 'unknown';
    const action: string = event.action;

    let logAction: string | null = null;
    let target: string | null = null;
    let message: string | null = null;
    let durationSeconds: number | null = null;

    switch (action) {
      case 'ban':
        logAction = 'BANNED';
        target = event.ban?.user_login || null;
        break;
      case 'timeout':
        logAction = 'MUTED';
        target = event.timeout?.user_login || null;
        if (event.timeout?.expires_at) {
          durationSeconds = Math.max(0, Math.round((new Date(event.timeout.expires_at).getTime() - Date.now()) / 1000));
        }
        break;
      case 'unban':
        logAction = 'UNBANNED';
        target = event.unban?.user_login || null;
        break;
      case 'untimeout':
        logAction = 'UNBANNED';
        target = event.untimeout?.user_login || null;
        break;
      case 'delete':
        logAction = 'FLAGGED';
        target = event.delete?.user_login || null;
        message = event.delete?.message_body || null;
        break;
      default:
        return; // ignore clear, mod, vip, settings changes, etc.
    }

    if (!logAction || !target) return;

    // Normalize performed_by to the site email when the moderator is a known
    // site user, so it joins with users.email everywhere (stats, logs display).
    // External mods (not on the site) keep their Twitch login.
    let performedByStored = performedBy;
    try {
      const { rows } = await db.query('SELECT email FROM users WHERE LOWER(twitch_username)=LOWER($1)', [performedBy]);
      if (rows[0]?.email) performedByStored = rows[0].email;
    } catch {}

    // Dedup: skip if the site already logged this exact action moments ago
    const { rows: dup } = await db.query(
      `SELECT 1 FROM moderation_logs
       WHERE channel_name=$1 AND username=$2 AND action=$3 AND created_at > NOW() - INTERVAL '20 seconds'
       LIMIT 1`,
      [channel, target, logAction]
    );
    if (dup.length > 0) return;

    await db.query(
      'INSERT INTO moderation_logs (channel_name, username, action, performed_by, duration_seconds, message) VALUES ($1,$2,$3,$4,$5,$6)',
      [channel, target, logAction, performedByStored, durationSeconds, message]
    ).catch(err => logger.error('[eventsub] insert log failed', err));

    broadcast(this.wss, {
      type: 'mod_action', channel, username: target, action: logAction,
      performed_by: performedBy, duration: durationSeconds, ts: Date.now(),
    });
  }

  /** Re-subscribe (e.g. after a new channel is added or a token authorized). */
  async refresh(): Promise<void> {
    try { await this.subscribeAll(); } catch (err) { logger.error('[eventsub] refresh failed', err); }
  }
}
