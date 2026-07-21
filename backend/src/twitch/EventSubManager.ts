import WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import { db } from '../database/db';
import { broadcast } from '../websocket/wsHandler';
import { logger } from '../utils/logger';
import { refreshUserToken } from './twitchToken';
import { logModerationAction } from '../utils/modLog';
import { recordEventsubReconnect, recordEventsubRevocation, jobStart, jobEnd } from '../utils/metrics';

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const WELCOME_TIMEOUT_MS = 15_000;
const RECONCILE_INTERVAL_MS = 10 * 60_000;
const WATCHDOG_INTERVAL_MS = 15_000;

interface ModToken {
  email: string;
  login: string;
  token: string;   // raw access token (no oauth: prefix)
  userId: string;  // twitch user id of the token owner
}

/**
 * One EventSub WebSocket per authorizing user. Twitch requires every
 * subscription on a WebSocket session to be authorized by the SAME user
 * token, so multi-mod setups need one connection per token — trying several
 * tokens on one session makes all but the first fail with 400.
 */
interface Conn {
  email: string;
  login: string;
  userId: string;
  token: string;
  ws: WebSocket | null;
  sessionId: string | null;
  lastMsgAt: number;
  keepaliveSec: number;
  welcomeTimer: NodeJS.Timeout | null;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectDelay: number;
  welcomeWaiters: Array<(ok: boolean) => void>;
  /** channel -> broadcaster id, channel.moderate assigned to this conn */
  moderate: Map<string, string>;
  /** channel -> broadcaster id, stream.online/offline held by this conn */
  stream: Map<string, string>;
  /** deliberately disconnected (no subs / token gone) — don't auto-reconnect */
  parked: boolean;
}

/**
 * Subscribes to Twitch EventSub `channel.moderate` (v2) so we capture EVERY
 * moderation action on monitored channels — bans, timeouts, unbans, deletes —
 * regardless of which client performed them (Chatterino, Twitch panel, other
 * mods). Each event is written to moderation_logs and pushed to the dashboard.
 *
 * Reliability model (the part that kept silently dying before):
 * - one WebSocket per user token (Twitch: one token per session);
 * - keepalive watchdog: Twitch sends session_keepalive every ~10s — if the
 *   socket goes quiet past the deadline it is a stalled half-open connection
 *   and gets terminated, which triggers a normal reconnect;
 * - on welcome the connection re-subscribes its own assignments immediately
 *   (no slow token validation first), beating Twitch's 10s "first subscription
 *   or disconnect" deadline;
 * - a periodic reconcile validates/refreshes tokens, (re)assigns channels to
 *   connections and revives anything that died.
 */
export class EventSubManager {
  private wss: WebSocketServer;
  private conns = new Map<string, Conn>(); // keyed by email
  private idCache = new Map<string, string>(); // login -> twitch user id
  private started = false;
  private reconciling = false;
  private reconcileAgain = false;
  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(wss: WebSocketServer) {
    this.wss = wss;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.reconcile().catch(err => logger.error('[eventsub] initial reconcile failed', err));
    setInterval(() => {
      this.reconcile().catch(() => {});
    }, RECONCILE_INTERVAL_MS);
    setInterval(() => this.watchdog(), WATCHDOG_INTERVAL_MS);
  }

  /** Re-subscribe (e.g. after a new channel is added or a token authorized). */
  async refresh(): Promise<void> {
    try { await this.reconcile(); } catch (err) { logger.error('[eventsub] refresh failed', err); }
  }

  /** Which channels have active EventSub coverage (for admin status view). */
  getStatus(): { moderate: string[]; stream: string[] } {
    const moderate = new Set<string>();
    const stream = new Set<string>();
    for (const c of this.conns.values()) {
      if (!c.sessionId) continue;
      for (const ch of c.moderate.keys()) moderate.add(ch);
      for (const ch of c.stream.keys()) stream.add(ch);
    }
    return { moderate: [...moderate], stream: [...stream] };
  }

  // ── connection lifecycle ────────────────────────────────────────────────

  /** Detect silently stalled sockets: no keepalive/notification past deadline. */
  private watchdog(): void {
    const now = Date.now();
    for (const conn of this.conns.values()) {
      if (!conn.ws || !conn.sessionId) continue;
      const limitMs = Math.max(conn.keepaliveSec, 10) * 2_500 + 5_000;
      if (now - conn.lastMsgAt > limitMs) {
        logger.warn(`[eventsub] ${conn.login}: silent for ${now - conn.lastMsgAt}ms — terminating stale socket`);
        recordEventsubReconnect('watchdog');
        conn.sessionId = null;
        try { conn.ws.terminate(); } catch {}
      }
    }
  }

  private connectConn(conn: Conn, url: string = EVENTSUB_URL): void {
    if (conn.reconnectTimer) { clearTimeout(conn.reconnectTimer); conn.reconnectTimer = null; }
    conn.parked = false;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      logger.error(`[eventsub] ${conn.login}: connect threw`, err);
      recordEventsubReconnect('connect_error');
      this.scheduleReconnect(conn);
      return;
    }
    conn.ws = ws;
    conn.sessionId = null;
    conn.lastMsgAt = Date.now();

    if (conn.welcomeTimer) clearTimeout(conn.welcomeTimer);
    conn.welcomeTimer = setTimeout(() => {
      if (conn.ws === ws && !conn.sessionId) {
        logger.warn(`[eventsub] ${conn.login}: no welcome in ${WELCOME_TIMEOUT_MS}ms — retrying`);
        recordEventsubReconnect('welcome_timeout');
        try { ws.terminate(); } catch {}
      }
    }, WELCOME_TIMEOUT_MS);

    ws.on('message', (raw: WebSocket.RawData) => {
      conn.lastMsgAt = Date.now();
      this.handleMessage(conn, ws, raw).catch(err => logger.error('[eventsub] handle error', err));
    });
    ws.on('close', (code) => {
      if (conn.ws !== ws) return; // superseded by session_reconnect
      conn.sessionId = null;
      this.flushWelcomeWaiters(conn, false);
      if (conn.parked) return;
      logger.warn(`[eventsub] ${conn.login}: socket closed (${code}), reconnecting`);
      recordEventsubReconnect('socket_close');
      this.scheduleReconnect(conn);
    });
    ws.on('error', (err) => {
      logger.error(`[eventsub] ${conn.login}: socket error`, (err as any)?.message || err);
      // 'close' fires after error; reconnect handled there
    });
  }

  private scheduleReconnect(conn: Conn): void {
    if (conn.reconnectTimer || conn.parked) return;
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      this.connectConn(conn);
    }, conn.reconnectDelay);
    conn.reconnectDelay = Math.min(conn.reconnectDelay * 2, 60_000);
  }

  /** Connect if needed and wait for the session welcome. */
  private ensureConnected(conn: Conn): Promise<boolean> {
    if (conn.sessionId && conn.ws?.readyState === WebSocket.OPEN) return Promise.resolve(true);
    if (!conn.ws || conn.ws.readyState === WebSocket.CLOSED || conn.ws.readyState === WebSocket.CLOSING || conn.parked) {
      this.connectConn(conn);
    }
    return new Promise<boolean>(resolve => {
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      conn.welcomeWaiters.push(done);
      setTimeout(() => done(false), WELCOME_TIMEOUT_MS + 5_000);
    });
  }

  private flushWelcomeWaiters(conn: Conn, ok: boolean): void {
    const waiters = conn.welcomeWaiters;
    conn.welcomeWaiters = [];
    for (const w of waiters) { try { w(ok); } catch {} }
  }

  /** Disconnect a connection that holds no subscriptions — Twitch closes idle
   *  sessions anyway (4003), which would otherwise cause reconnect churn. */
  private parkConn(conn: Conn): void {
    conn.parked = true;
    conn.sessionId = null;
    if (conn.reconnectTimer) { clearTimeout(conn.reconnectTimer); conn.reconnectTimer = null; }
    try { conn.ws?.close(); } catch {}
  }

  private dropConn(conn: Conn): void {
    this.parkConn(conn);
    if (conn.welcomeTimer) { clearTimeout(conn.welcomeTimer); conn.welcomeTimer = null; }
    this.conns.delete(conn.email);
  }

  // ── message handling ────────────────────────────────────────────────────

  private async handleMessage(conn: Conn, ws: WebSocket, raw: WebSocket.RawData): Promise<void> {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const type = msg?.metadata?.message_type;

    if (type === 'session_welcome') {
      if (conn.ws !== ws) { try { ws.close(); } catch {} return; }
      conn.sessionId = msg.payload?.session?.id || null;
      conn.keepaliveSec = msg.payload?.session?.keepalive_timeout_seconds || 10;
      conn.reconnectDelay = 2_000; // reset backoff on success
      if (conn.welcomeTimer) { clearTimeout(conn.welcomeTimer); conn.welcomeTimer = null; }
      logger.info(`[eventsub] ${conn.login}: session ${conn.sessionId}`);
      this.flushWelcomeWaiters(conn, true);
      // Re-subscribe this connection's own assignments right away — cached
      // ids, no token validation — so the first subscription lands well
      // inside Twitch's 10-second deadline. 409 (still subscribed after a
      // session_reconnect) is a no-op.
      await this.resubscribeAssigned(conn);
    } else if (type === 'session_reconnect') {
      const newUrl = msg.payload?.session?.reconnect_url;
      if (newUrl && conn.ws === ws) {
        logger.info(`[eventsub] ${conn.login}: session_reconnect → switching socket`);
        recordEventsubReconnect('twitch_reconnect');
        const old = ws;
        this.connectConn(conn, newUrl);
        try { old.removeAllListeners('close'); old.close(); } catch {}
      }
    } else if (type === 'notification') {
      await this.handleNotification(msg.payload);
    } else if (type === 'revocation') {
      const cond = msg.payload?.subscription?.condition || {};
      const subType = msg.payload?.subscription?.type;
      recordEventsubRevocation();
      logger.warn(`[eventsub] ${conn.login}: subscription revoked (${subType} ${JSON.stringify(cond)})`);
      // Drop the assignment so reconcile reassigns it (possibly via another mod)
      if (subType === 'channel.moderate') {
        for (const [ch, bid] of conn.moderate) {
          if (bid === cond.broadcaster_user_id) conn.moderate.delete(ch);
        }
      } else if (subType === 'stream.online' || subType === 'stream.offline') {
        for (const [ch, bid] of conn.stream) {
          if (bid === cond.broadcaster_user_id) conn.stream.delete(ch);
        }
      }
      this.scheduleReconcile(30_000);
    }
    // session_keepalive: lastMsgAt already updated by the message listener
  }

  private async resubscribeAssigned(conn: Conn): Promise<void> {
    for (const [ch, bid] of conn.moderate) {
      const ok = await this.subscribe(conn, 'channel.moderate', '2',
        { broadcaster_user_id: bid, moderator_user_id: conn.userId });
      if (!ok) {
        conn.moderate.delete(ch);
        this.scheduleReconcile(30_000);
      }
    }
    for (const [ch, bid] of conn.stream) {
      const on = await this.subscribe(conn, 'stream.online', '1', { broadcaster_user_id: bid });
      const off = await this.subscribe(conn, 'stream.offline', '1', { broadcaster_user_id: bid });
      if (!on || !off) {
        conn.stream.delete(ch);
        this.scheduleReconcile(30_000);
      }
    }
  }

  // ── reconcile: tokens → connections → subscriptions ─────────────────────

  private scheduleReconcile(delayMs: number): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      this.reconcile().catch(() => {});
    }, delayMs);
  }

  private async reconcile(): Promise<void> {
    if (this.reconciling) { this.reconcileAgain = true; return; }
    this.reconciling = true;
    const startedAt = jobStart('eventsub_reconcile');
    try {
      await this.reconcileOnce();
      jobEnd('eventsub_reconcile', 'success', startedAt);
    } catch (err) {
      logger.error('[eventsub] reconcile failed', err);
      jobEnd('eventsub_reconcile', 'error', startedAt);
    } finally {
      this.reconciling = false;
      if (this.reconcileAgain) {
        this.reconcileAgain = false;
        this.scheduleReconcile(1_000);
      }
    }
  }

  private async reconcileOnce(): Promise<void> {
    const tm: any = (global as any).twitchManager;
    const channels: string[] = (tm?.getChannelNames ? tm.getChannelNames() : []).map((c: string) => c.toLowerCase());
    if (channels.length === 0) return;

    const tokens = await this.getModeratorTokens();
    if (tokens.length === 0) {
      logger.warn('[eventsub] no moderator tokens available — nobody authorized via Twitch');
      return;
    }

    // Sync connections with the current token set
    const emails = new Set(tokens.map(t => t.email));
    for (const conn of [...this.conns.values()]) {
      if (!emails.has(conn.email)) {
        logger.info(`[eventsub] ${conn.login}: token gone — dropping connection`);
        this.dropConn(conn);
      }
    }
    for (const t of tokens) {
      const existing = this.conns.get(t.email);
      if (existing) {
        existing.token = t.token;
        existing.userId = t.userId;
        existing.login = t.login;
      } else {
        this.conns.set(t.email, {
          email: t.email, login: t.login, userId: t.userId, token: t.token,
          ws: null, sessionId: null, lastMsgAt: 0, keepaliveSec: 10,
          welcomeTimer: null, reconnectTimer: null, reconnectDelay: 2_000,
          welcomeWaiters: [], moderate: new Map(), stream: new Map(), parked: true,
        });
      }
    }

    // Connect everything and wait for welcomes
    await Promise.all([...this.conns.values()].map(c => this.ensureConnected(c)));
    const live = [...this.conns.values()].filter(c => c.sessionId && c.ws?.readyState === WebSocket.OPEN);
    if (live.length === 0) {
      logger.warn('[eventsub] no live EventSub connections');
      return;
    }

    const probeHeaders = {
      'Client-Id': process.env.TWITCH_CLIENT_ID || '',
      'Authorization': `Bearer ${live[0].token}`,
    };

    // channel.moderate: each channel is covered by exactly one connection.
    // Prefer the connection already assigned; otherwise try each until one
    // succeeds (403 = that user isn't a moderator on the channel).
    for (const ch of channels) {
      const bid = await this.resolveId(ch, probeHeaders);
      if (!bid) continue;

      const ordered = [...live].sort((a, b) => Number(b.moderate.has(ch)) - Number(a.moderate.has(ch)));
      let covered = false;
      for (const conn of ordered) {
        const ok = await this.subscribe(conn, 'channel.moderate', '2',
          { broadcaster_user_id: bid, moderator_user_id: conn.userId });
        if (ok) {
          conn.moderate.set(ch, bid);
          for (const other of live) if (other !== conn) other.moderate.delete(ch);
          covered = true;
          break;
        }
        conn.moderate.delete(ch);
      }
      if (!covered) {
        logger.warn(`[eventsub] could not subscribe channel.moderate for ${ch} (no mod token has scopes/rights)`);
      }
    }

    // stream.online/offline need no scopes — keep them all on one connection
    // (prefer the one already holding them, else the first live one).
    const holder = live.find(c => c.stream.size > 0) || live[0];
    for (const ch of channels) {
      const bid = await this.resolveId(ch, probeHeaders);
      if (!bid) continue;
      if (holder.stream.has(ch)) continue; // subscribed on this session already
      const on = await this.subscribe(holder, 'stream.online', '1', { broadcaster_user_id: bid });
      const off = await this.subscribe(holder, 'stream.offline', '1', { broadcaster_user_id: bid });
      if (on && off) holder.stream.set(ch, bid);
    }
    for (const conn of live) {
      if (conn !== holder) conn.stream.clear();
    }

    // Park connections that ended up with nothing to do — Twitch closes idle
    // sessions with 4003 and we'd churn reconnects forever otherwise.
    for (const conn of live) {
      if (conn.moderate.size === 0 && conn.stream.size === 0) {
        logger.info(`[eventsub] ${conn.login}: no subscriptions — parking connection`);
        this.parkConn(conn);
      }
    }

    const status = this.getStatus();
    logger.info(`[eventsub] reconcile done: moderate=[${status.moderate}] stream=[${status.stream}] conns=${live.length}`);
  }

  // ── tokens / helpers ────────────────────────────────────────────────────

  /**
   * Site users whose tokens were issued by OUR Twitch app (EventSub requires
   * the Client-Id header to match the token's client). Manual chatterino
   * tokens belong to a foreign client and always fail with 401 — they're
   * filtered out here via oauth2/validate; expired own tokens get refreshed.
   */
  private async getModeratorTokens(): Promise<ModToken[]> {
    const { rows } = await db.query(
      "SELECT email, twitch_username, twitch_oauth FROM users WHERE twitch_oauth IS NOT NULL AND twitch_username IS NOT NULL ORDER BY email"
    );
    const clientId = process.env.TWITCH_CLIENT_ID || '';
    const out: ModToken[] = [];
    for (const r of rows) {
      let token = String(r.twitch_oauth).replace(/^oauth:/, '');
      const login = String(r.twitch_username).toLowerCase();

      // Validate the token. BUG-10: only a CONFIRMED-invalid (401) or a
      // foreign-client token should trigger a refresh; a temporary /validate
      // failure (429/5xx/network) must not — refreshing then would churn tokens
      // toward Twitch's 50-token limit for no reason. On a temporary error we
      // skip this account this round and retry on the next reconcile.
      let v = await this.validateToken(token);
      if (v.status === 'temporary') { continue; }
      let info = v.info;
      const foreign = v.status === 'valid' && info!.client_id !== clientId;
      if (v.status === 'invalid_401' || foreign) {
        const fresh = await refreshUserToken(r.email);
        if (!fresh) {
          if (foreign) logger.info(`[eventsub] skip ${login}: token issued by foreign client (manual token)`);
          continue;
        }
        token = fresh;
        v = await this.validateToken(token);
        if (v.status !== 'valid' || v.info!.client_id !== clientId) continue;
        info = v.info;
      } else if (v.status !== 'valid') {
        continue;
      }
      if (!info) continue;

      const headers = { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` };
      const userId = info.user_id || await this.resolveId(login, headers);
      if (userId) out.push({ email: r.email, login, token, userId });
    }
    return out;
  }

  // Typed validate result so callers can tell a real invalid token apart from
  // a transient Twitch/network hiccup (BUG-10).
  private async validateToken(token: string): Promise<
    | { status: 'valid'; info: { client_id: string; user_id?: string; scopes?: string[] } }
    | { status: 'invalid_401'; info?: undefined }
    | { status: 'temporary'; info?: undefined }
  > {
    try {
      const r = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { 'Authorization': `OAuth ${token}` },
      });
      if (r.ok) return { status: 'valid', info: await r.json() as any };
      if (r.status === 401) return { status: 'invalid_401' };
      return { status: 'temporary' }; // 429/5xx/other
    } catch { return { status: 'temporary' }; }
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

  /** Create a subscription on this connection's session with ITS OWN token
   *  (Twitch: all subs on one WebSocket must use the same user token). */
  private async subscribe(conn: Conn, type: string, version: string, condition: any): Promise<boolean> {
    if (!conn.sessionId) return false;
    try {
      const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST',
        headers: {
          'Client-Id': process.env.TWITCH_CLIENT_ID || '',
          'Authorization': `Bearer ${conn.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, version, condition, transport: { method: 'websocket', session_id: conn.sessionId } }),
      });
      if (res.status === 202 || res.ok || res.status === 409) {
        if (res.status !== 409) logger.info(`[eventsub] ${conn.login}: subscribed ${type} ${JSON.stringify(condition)}`);
        return true;
      }
      const body = await res.text().catch(() => '');
      logger.warn(`[eventsub] ${conn.login}: subscribe ${type} ${res.status}: ${body}`);
      return false;
    } catch (err: any) {
      logger.error(`[eventsub] ${conn.login}: subscribe threw`, err?.message || err);
      return false;
    }
  }

  // ── notifications → moderation_logs ─────────────────────────────────────

  private async handleNotification(payload: any): Promise<void> {
    const event = payload?.event;
    const subType = payload?.subscription?.type;
    if (!event) return;

    // Instant stream start/end detection
    if (subType === 'stream.online' || subType === 'stream.offline') {
      const ch = (event.broadcaster_user_login || '').toLowerCase();
      const tm: any = (global as any).twitchManager;
      try { if (tm?.syncStreams) await tm.syncStreams(); } catch {}
      broadcast(this.wss, {
        type: subType === 'stream.online' ? 'stream_start' : 'stream_end',
        channel: ch, ts: Date.now(),
      });
      return;
    }

    if (subType !== 'channel.moderate') return;

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

    // Central dedup: echoes of a site action and repeat punitive actions within
    // 5s are collapsed (see logModerationAction). Only broadcast if it counted.
    const r = await logModerationAction({
      channel, username: target, action: logAction,
      performedBy: performedByStored, durationSeconds, message,
    });
    if (r === 'primary') {
      broadcast(this.wss, {
        type: 'mod_action', channel, username: target, action: logAction,
        performed_by: performedBy, duration: durationSeconds, ts: Date.now(),
      });
    }
  }
}
