import tmi from 'tmi.js';
import { WebSocketServer } from 'ws';
import { SpamEngine, defaultSettings } from '../spam-engine/SpamEngine';
import { db } from '../database/db';
import { broadcast } from '../websocket/wsHandler';
import { logger } from '../utils/logger';
import { TelegramBot } from '../telegram/TelegramBot';
import { refreshUserToken, refreshBroadcasterToken } from './twitchToken';

interface UserConnection {
  email: string;
  username: string;          // bot username
  oauth: string;              // oauth:xxx
  client: tmi.Client | null;
  joinedChannels: Set<string>;
  connected: boolean;
}

interface ChannelState {
  name: string;
  /** Email of the user whose IRC client is currently joined to this channel. */
  primaryEmail: string | null;
  /** Legacy field for compat — kept in sync with primaryEmail */
  ownerEmail: string | null;
  engine: SpamEngine;
  status: 'connected' | 'connecting' | 'disconnected';
  autoMod: boolean;
}

export class TwitchManager {
  private connections: Map<string, UserConnection> = new Map(); // by email
  private channels: Map<string, ChannelState> = new Map();
  private wss: WebSocketServer;
  private globalSettings = { ...defaultSettings };
  // Fallback global bot from env (legacy mode)
  private globalClient: tmi.Client | null = null;

  constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.initGlobalClient();
  }

  private initGlobalClient() {
    const username = process.env.TWITCH_BOT_USERNAME;
    const oauth = process.env.TWITCH_BOT_OAUTH;
    if (!username || !oauth) {
      logger.info('No global bot credentials — per-user mode only');
      return;
    }
    this.globalClient = new tmi.Client({
      options: { debug: false },
      identity: { username, password: oauth },
      channels: [],
    });
    this.globalClient.on('message', (ch, us, msg, self) => this.handleMessage(null, ch, us, msg, self));
    this.globalClient.on('connected', () => logger.info('Global Twitch IRC connected'));
    this.globalClient.on('disconnected', (reason) => logger.warn(`Global IRC disconnected: ${reason}`));
    this.globalClient.connect().catch(err => logger.error('Global Twitch connect error', err));
  }

  /**
   * Ensure user has an IRC connection. If username/oauth changed, reconnect.
   */
  async ensureUserConnection(email: string, username: string, oauth: string): Promise<UserConnection | null> {
    const norm = oauth.startsWith('oauth:') ? oauth : `oauth:${oauth}`;
    const existing = this.connections.get(email);

    if (existing && existing.username === username.toLowerCase() && existing.oauth === norm) {
      return existing;
    }

    // Replace existing connection
    if (existing?.client) {
      try { await existing.client.disconnect(); } catch {}
    }
    // Always invalidate moderator_id cache on any credential change
    this.invalidateModeratorCache(email);

    const conn: UserConnection = {
      email,
      username: username.toLowerCase(),
      oauth: norm,
      client: null,
      joinedChannels: new Set(),
      connected: false,
    };

    try {
      const client = new tmi.Client({
        options: { debug: false },
        identity: { username: conn.username, password: conn.oauth },
        channels: [],
      });
      client.on('message', (ch, us, msg, self) => this.handleMessage(email, ch, us, msg, self));
      client.on('connected', async () => {
        conn.connected = true;
        logger.info(`User IRC connected: ${email} (${conn.username})`);
        // Auto-rejoin all channels owned by this user
        try {
          const { rows } = await db.query('SELECT channel_name AS name FROM channel_subscribers WHERE user_email=$1', [email]);
          for (const row of rows) {
            try {
              await client.join(row.name);
              conn.joinedChannels.add(row.name);
              // Ensure state exists
              if (!this.channels.has(row.name)) {
                await this.joinChannel(row.name, email);
              } else {
                const state = this.channels.get(row.name)!;
                state.ownerEmail = email;
                state.status = 'connected';
              }
              if (this.globalClient && this.globalClient !== client) {
                try { await this.globalClient.part(row.name); } catch {}
              }
              logger.info(`Auto-rejoined ${row.name} for ${email}`);
            } catch (err: any) {
              logger.error(`Auto-rejoin ${row.name} failed: ${err?.message}`);
            }
          }
        } catch (err) {
          logger.error(`Auto-rejoin query failed for ${email}`, err);
        }
      });
      client.on('disconnected', (reason) => {
        conn.connected = false;
        logger.warn(`User IRC disconnected ${email}: ${reason}`);
      });
      await client.connect();
      conn.client = client;
      this.connections.set(email, conn);
      return conn;
    } catch (err: any) {
      logger.error(`Failed to connect IRC for ${email}: ${err?.message}`);
      return null;
    }
  }

  async removeUserConnection(email: string): Promise<void> {
    const c = this.connections.get(email);
    if (!c) return;
    try { await c.client?.disconnect(); } catch {}
    this.connections.delete(email);
  }

  private async handleMessage(ownerEmail: string | null, channelRaw: string, userstate: tmi.ChatUserstate, message: string, self: boolean) {
    if (self) return;
    const channelName = channelRaw.replace('#', '');
    const username = userstate['display-name'] || userstate.username || 'unknown';
    const role = this.getRole(userstate);

    const state = this.channels.get(channelName);
    if (!state) return;

    // Strict routing — only the primary IRC connection processes messages.
    // Otherwise the same message would be analyzed twice if both global and user clients are in chat.
    if (state.primaryEmail) {
      if (ownerEmail !== state.primaryEmail) return;
    } else {
      if (ownerEmail !== null) return;
    }

    // !g <game name> — set game/category (only for broadcaster or mods with OAuth)
    const GAME_ALIASES: Record<string, string> = {
      '!j': 'Just Chatting',
      '!cs': 'Counter-Strike',
      '!dota': 'Dota 2',
    };
    const alias = GAME_ALIASES[message.trim().toLowerCase()];
    if (alias && (userstate.mod || userstate.badges?.broadcaster)) {
      const cachedForCmd = await this.getCachedSettings();
      if (!cachedForCmd.setGameEnabled) return;
      this.setGame(channelName, alias, state.primaryEmail).then(reply => {
        this.globalClient?.say(`#${channelName}`, reply).catch(() => {});
      });
      return;
    }

    if (message.trim().startsWith('!g ') && (userstate.mod || userstate.badges?.broadcaster)) {
      const cachedForCmd = await this.getCachedSettings();
      if (!cachedForCmd.setGameEnabled) return;
      const gameName = message.trim().slice(3).trim();
      if (gameName) {
        this.setGame(channelName, gameName, state.primaryEmail).then(reply => {
          this.globalClient?.say(`#${channelName}`, reply).catch(() => {});
        });
      }
      return;
    }

    const analysis = state.engine.analyze(username, message);

    const cachedSettings = await this.getCachedSettings();
    const roleIgnored = cachedSettings.ignoredRoles.includes(role);

    await db.query(
      'INSERT INTO messages (channel_name, username, message, spam_score, reasons, role) VALUES ($1,$2,$3,$4,$5,$6)',
      [channelName, username, message, analysis.score, analysis.reasons, role]
    ).catch(() => {});

    await db.query(
      `INSERT INTO user_profiles (username, channel_name, message_count, spam_score, last_seen)
       VALUES ($1,$2,1,$3,NOW())
       ON CONFLICT (username, channel_name) DO UPDATE
       SET message_count = user_profiles.message_count + 1,
           spam_score = $3, last_seen = NOW()`,
      [username, channelName, analysis.score]
    ).catch(() => {});

    broadcast(this.wss, {
      type: 'message', channel: channelName, username, message, role,
      score: analysis.score, reasons: analysis.reasons, ts: Date.now(),
    });

    const threshold = state.engine.settings.detectThreshold;
    const autoMuteThreshold = state.engine.settings.autoMuteThreshold;

    if (analysis.score >= threshold && !roleIgnored) {
      broadcast(this.wss, {
        type: 'queue_add', channel: channelName, username,
        score: analysis.score, reasons: analysis.reasons, lastMsg: message,
      });

      // Telegram notifications — sent to ALL channel subscribers with TG enabled
      const tg = TelegramBot.get();
      if (tg) {
        tg.notifyQueueAdd({
          channel: channelName,
          username,
          message,
          score: analysis.score,
          reasons: analysis.reasons,
          ownerEmail: null, // unused now
        });
      }

      if (analysis.score >= autoMuteThreshold) {
        if (cachedSettings.autoMode && state.autoMod !== false) {
          await this.muteUser(channelName, username, cachedSettings.defaultMuteDuration, 'AUTO');
        }
      }
    }
  }

  private getRole(userstate: tmi.ChatUserstate): string {
    if (userstate.badges?.broadcaster) return 'Broadcaster';
    if (userstate.mod) return 'Mod';
    if (userstate.badges?.vip) return 'VIP';
    if (userstate.subscriber) return 'Sub';
    return 'Viewer';
  }

  /** Get list of subscriber emails for a channel */
  private async getSubscribers(channelName: string): Promise<string[]> {
    const { rows } = await db.query(
      'SELECT user_email FROM channel_subscribers WHERE channel_name=$1',
      [channelName]
    );
    return rows.map((r: any) => r.user_email);
  }

  /** Pick a subscriber that has valid IRC credentials to serve as primary connection */
  private async pickPrimarySubscriber(channelName: string): Promise<string | null> {
    const subs = await this.getSubscribers(channelName);
    for (const email of subs) {
      const { rows } = await db.query(
        'SELECT twitch_username, twitch_oauth FROM users WHERE email=$1 AND enabled=true',
        [email]
      );
      if (rows.length > 0 && rows[0].twitch_username && rows[0].twitch_oauth) {
        return email;
      }
    }
    return null;
  }

  async joinChannel(channelName: string, requestedBy?: string): Promise<void> {
    const existing = this.channels.get(channelName);

    // Pick best primary (whoever has IRC creds among subscribers)
    const primary = await this.pickPrimarySubscriber(channelName);

    if (existing) {
      // Channel already in state. Maybe rebind to primary if changed.
      if (primary && existing.primaryEmail !== primary) {
        await this.rebindChannelTo(channelName, primary);
      } else if (!primary && existing.primaryEmail) {
        // No subscriber with creds — fallback to global
        await this.rebindChannelTo(channelName, null);
      }
      return;
    }

    // First-time join
    const channelSettings = { ...this.globalSettings };
    try {
      const { rows } = await db.query(
        'SELECT trigger_after_n FROM channels WHERE name=$1', [channelName]
      );
      if (rows.length > 0 && rows[0].trigger_after_n) {
        channelSettings.triggerAfterN = rows[0].trigger_after_n;
      }
      const wl = await db.query('SELECT phrase FROM channel_whitelist WHERE channel_name=$1', [channelName]);
      channelSettings.whitelistPhrases = wl.rows.map((r: any) => r.phrase);
    } catch {}

    const engine = new SpamEngine(channelSettings);
    const state: ChannelState = {
      name: channelName,
      primaryEmail: primary,
      ownerEmail: primary, // legacy alias
      engine, status: 'connecting', autoMod: true,
    };
    this.channels.set(channelName, state);

    let client: tmi.Client | null = null;
    if (primary) {
      const conn = await this.getOrLoadUserConnection(primary);
      client = conn?.client || null;
    }
    if (!client) {
      client = this.globalClient;
    }

    if (client) {
      // If the connected-event auto-rejoin already joined this channel, skip the IRC call
      const alreadyJoined = primary
        ? this.connections.get(primary)?.joinedChannels.has(channelName) ?? false
        : false;

      if (alreadyJoined) {
        state.status = 'connected';
        await this.updateChannelStatus(channelName, 'connected');
        broadcast(this.wss, { type: 'channel_status', channel: channelName, status: 'connected' });
        logger.info(`Already in channel: ${channelName} via ${primary}`);
      } else {
        try {
          await client.join(channelName);
          state.status = 'connected';
          if (primary) {
            const conn = this.connections.get(primary);
            conn?.joinedChannels.add(channelName);
            // Make sure global client doesn't double-process
            if (this.globalClient && this.globalClient !== client) {
              try { await this.globalClient.part(channelName); } catch {}
            }
          }
          await this.updateChannelStatus(channelName, 'connected');
          broadcast(this.wss, { type: 'channel_status', channel: channelName, status: 'connected' });
          logger.info(`Joined channel: ${channelName} via ${primary || 'global'}`);
        } catch (err: any) {
          // tmi.js throws if already in channel — treat that as success
          const alreadyErr = /already/i.test(err?.message || '');
          state.status = alreadyErr ? 'connected' : 'disconnected';
          await this.updateChannelStatus(channelName, state.status);
          broadcast(this.wss, { type: 'channel_status', channel: channelName, status: state.status });
          if (alreadyErr) {
            logger.info(`Already in channel (caught): ${channelName}`);
          } else {
            logger.error(`Failed to join ${channelName}: ${err?.message}`);
          }
        }
      }
    } else {
      state.status = 'disconnected';
      logger.warn(`No IRC client to join ${channelName}`);
    }
  }

  /** Switch which user's IRC client is sitting in a channel */
  private async rebindChannelTo(channelName: string, newPrimary: string | null): Promise<void> {
    const state = this.channels.get(channelName);
    if (!state) return;
    const old = state.primaryEmail;
    if (old === newPrimary) return;

    // Part old client
    if (old) {
      const oldConn = this.connections.get(old);
      if (oldConn?.client) {
        try { await oldConn.client.part(channelName); } catch {}
        oldConn.joinedChannels.delete(channelName);
      }
    } else {
      // Was on global
      if (this.globalClient) {
        try { await this.globalClient.part(channelName); } catch {}
      }
    }

    state.primaryEmail = newPrimary;
    state.ownerEmail = newPrimary;

    // Join new
    let client: tmi.Client | null = null;
    if (newPrimary) {
      const conn = await this.getOrLoadUserConnection(newPrimary);
      client = conn?.client || null;
    }
    if (!client) client = this.globalClient;
    if (client) {
      try {
        await client.join(channelName);
        if (newPrimary) {
          this.connections.get(newPrimary)?.joinedChannels.add(channelName);
        }
        state.status = 'connected';
        await this.updateChannelStatus(channelName, 'connected');
        broadcast(this.wss, { type: 'channel_status', channel: channelName, status: 'connected' });
        logger.info(`Rebound ${channelName} → ${newPrimary || 'global'}`);
      } catch (err: any) {
        state.status = 'disconnected';
        logger.error(`Rebind failed ${channelName}: ${err?.message}`);
      }
    }
  }

  /** Called when a subscriber leaves a channel — possibly need to rebind */
  async handleSubscriberLeft(channelName: string, email: string): Promise<void> {
    const state = this.channels.get(channelName);
    if (!state) return;
    if (state.primaryEmail === email) {
      const next = await this.pickPrimarySubscriber(channelName);
      await this.rebindChannelTo(channelName, next);
    }
  }

  async leaveChannel(channelName: string): Promise<void> {
    const state = this.channels.get(channelName);
    if (!state) return;
    // Leave from all clients to be safe — both owner's and global
    if (state.ownerEmail) {
      const conn = this.connections.get(state.ownerEmail);
      if (conn?.client) {
        try { await conn.client.part(channelName); } catch {}
        conn.joinedChannels.delete(channelName);
      }
    }
    if (this.globalClient) {
      try { await this.globalClient.part(channelName); } catch {}
    }
    this.channels.delete(channelName);
    await this.updateChannelStatus(channelName, 'disconnected');
    broadcast(this.wss, { type: 'channel_removed', channel: channelName });
  }

  private async getOrLoadUserConnection(email: string): Promise<UserConnection | null> {
    const existing = this.connections.get(email);
    if (existing?.connected) return existing;
    // Load credentials from DB
    const { rows } = await db.query('SELECT twitch_username, twitch_oauth FROM users WHERE email=$1', [email]);
    if (rows.length === 0 || !rows[0].twitch_username || !rows[0].twitch_oauth) return existing || null;
    return this.ensureUserConnection(email, rows[0].twitch_username, rows[0].twitch_oauth);
  }

  /**
   * Resolve which user's credentials to use for a Helix moderation action.
   * Priority: 1) actor (the person who clicked the button / wrote the TG command),
   *           2) channel's primary IRC subscriber, 3) global env bot.
   */
  private async resolveActorEmail(channelName: string, performedBy: string): Promise<string | null> {
    // Is performedBy a real user with twitch creds?
    if (performedBy && performedBy.includes('@')) {
      const { rows } = await db.query(
        'SELECT twitch_oauth FROM users WHERE email=$1 AND enabled=true',
        [performedBy]
      );
      const hasToken = rows.length > 0 && rows[0].twitch_oauth;
      logger.info(`resolveActorEmail: performedBy=${performedBy} hasToken=${!!hasToken}`);
      if (hasToken) return performedBy;
    }
    // Fallback to channel primary
    const state = this.channels.get(channelName);
    logger.info(`resolveActorEmail: fallback to primary=${state?.primaryEmail ?? 'none'}`);
    if (state?.primaryEmail) {
      const { rows } = await db.query(
        'SELECT twitch_oauth FROM users WHERE email=$1 AND enabled=true',
        [state.primaryEmail]
      );
      if (rows.length > 0 && rows[0].twitch_oauth) return state.primaryEmail;
    }
    // Fallback to global env
    logger.info(`resolveActorEmail: using global env bot`);
    return null;
  }

  /**
   * Get token for Helix API for a channel owner. Falls back to global env.
   */
  private async getHelixCredentials(ownerEmail: string | null): Promise<{ clientId: string; oauth: string }> {
    if (ownerEmail) {
      const { rows } = await db.query('SELECT twitch_oauth FROM users WHERE email=$1', [ownerEmail]);
      if (rows.length > 0 && rows[0].twitch_oauth) {
        return {
          clientId: process.env.TWITCH_CLIENT_ID || '',
          oauth: rows[0].twitch_oauth.replace('oauth:', ''),
        };
      }
    }
    return {
      clientId: process.env.TWITCH_CLIENT_ID || '',
      oauth: (process.env.TWITCH_BOT_OAUTH || '').replace('oauth:', ''),
    };
  }

  private async setGame(channelName: string, gameName: string, ownerEmail: string | null): Promise<string> {
    try {
      const clientId = process.env.TWITCH_CLIENT_ID || '';
      // Search + id lookup use a reliable moderator token (refresh on 401)
      let searchHeaders = await this.getHelixHeaders(ownerEmail);
      const searchGame = async () => {
        // Fuzzy category search (handles "Counter-Strike", "Just Chatting", etc.)
        let r = await fetch(`https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(gameName)}&first=10`, { headers: searchHeaders });
        if (r.status === 401 && ownerEmail) {
          const fresh = await refreshUserToken(ownerEmail);
          if (fresh) { searchHeaders = { 'Client-Id': clientId, 'Authorization': `Bearer ${fresh}`, 'Content-Type': 'application/json' }; r = await fetch(`https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(gameName)}&first=10`, { headers: searchHeaders }); }
        }
        if (!r.ok) return null;
        const d: any = await r.json();
        const list: any[] = d.data || [];
        // Prefer exact (case-insensitive) match, else first result
        return list.find(g => g.name.toLowerCase() === gameName.toLowerCase()) || list[0] || null;
      };
      const game = await searchGame();
      if (!game) return `Игра не найдена: ${gameName}`;

      // broadcaster_id
      const { rows } = await db.query('SELECT twitch_id FROM twitch_user_meta WHERE username=$1', [channelName]);
      let broadcasterId: string = rows[0]?.twitch_id || '';
      if (!broadcasterId) {
        const ur = await fetch(`https://api.twitch.tv/helix/users?login=${channelName}`, { headers: searchHeaders });
        const ud: any = await ur.json();
        broadcasterId = ud.data?.[0]?.id || '';
      }
      if (!broadcasterId) return 'Не удалось найти broadcaster_id';

      // Changing the category REQUIRES the broadcaster's own token
      // (channel:manage:broadcast) — a moderator token can't do it.
      const { rows: btRows } = await db.query(
        'SELECT access_token FROM broadcaster_tokens WHERE twitch_login=$1', [channelName]
      );
      if (!btRows[0]?.access_token) {
        return `Категория не изменена: требуется авторизация стримера на сайте`;
      }
      let patchHeaders = { 'Client-Id': clientId, 'Authorization': `Bearer ${btRows[0].access_token}`, 'Content-Type': 'application/json' };
      let patchRes = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, {
        method: 'PATCH', headers: patchHeaders, body: JSON.stringify({ game_id: game.id }),
      });
      if (patchRes.status === 401) {
        const fresh = await refreshBroadcasterToken(channelName);
        if (fresh) {
          patchHeaders = { 'Client-Id': clientId, 'Authorization': `Bearer ${fresh}`, 'Content-Type': 'application/json' };
          patchRes = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, {
            method: 'PATCH', headers: patchHeaders, body: JSON.stringify({ game_id: game.id }),
          });
        }
      }
      if (!patchRes.ok) {
        const err: any = await patchRes.json().catch(() => ({}));
        return `Ошибка: ${err?.message || patchRes.status}`;
      }
      return `Категория изменена: ${game.name}`;
    } catch (err: any) {
      return `Ошибка: ${err?.message}`;
    }
  }

  async getHelixHeadersPublic(ownerEmail: string | null) {
    return this.getHelixHeaders(ownerEmail);
  }

  // ── Stream tracking ──────────────────────────────────────────────────────
  private streamPollerTimer: NodeJS.Timeout | null = null;

  /**
   * Poll Helix for live streams across all monitored channels, upsert live
   * sessions and close ended ones. Returns which channels just started/ended
   * so callers can broadcast live events.
   */
  /** Collect candidate Helix header sets (client-id + bearer) to try, in order. */
  private async getHelixCandidates(): Promise<Array<Record<string, string>>> {
    const clientId = process.env.TWITCH_CLIENT_ID || '';
    const out: Array<Record<string, string>> = [];
    const seen = new Set<string>();
    const add = (tok: string) => {
      const t = (tok || '').replace(/^oauth:/, '');
      if (t && !seen.has(t)) { seen.add(t); out.push({ 'Client-Id': clientId, 'Authorization': `Bearer ${t}` }); }
    };
    // 1. Any site user with a Twitch OAuth token
    const { rows: users } = await db.query("SELECT twitch_oauth FROM users WHERE twitch_oauth IS NOT NULL");
    for (const r of users) add(r.twitch_oauth);
    // 2. Broadcaster tokens
    const { rows: bt } = await db.query('SELECT access_token FROM broadcaster_tokens');
    for (const r of bt) add(r.access_token);
    // 3. Env bot token
    add(process.env.TWITCH_BOT_OAUTH || '');
    return out;
  }

  async syncStreams(): Promise<{ started: string[]; ended: string[]; live: number }> {
    // Poll every channel in the DB (not just IRC-joined ones) so tracking works
    // even if the bot's IRC connection is down.
    const { rows: chRows } = await db.query('SELECT name FROM channels');
    const dbChannels = chRows.map((r: any) => r.name.toLowerCase());
    const channelNames = [...new Set([...dbChannels, ...this.getChannelNames().map(c => c.toLowerCase())])];
    if (channelNames.length === 0) return { started: [], ended: [], live: 0 };

    // Channels that currently have an open session (before this sync)
    const { rows: openBefore } = await db.query(
      'SELECT DISTINCT channel_name FROM stream_sessions WHERE ended_at IS NULL AND channel_name = ANY($1)',
      [channelNames]
    );
    const openBeforeSet = new Set<string>(openBefore.map((r: any) => r.channel_name));

    const q = channelNames.map((c: string) => `user_login=${encodeURIComponent(c)}`).join('&');
    const tryFetch = async (): Promise<{ live: any[] | null; err: string }> => {
      const candidates = await this.getHelixCandidates();
      let err = 'no token';
      for (const headers of candidates) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 10_000);
        try {
          const r = await fetch(`https://api.twitch.tv/helix/streams?${q}&first=100`, { headers, signal: ctrl.signal });
          if (r.ok) { const data: any = await r.json(); return { live: data.data || [], err: '' }; }
          err = `Helix ${r.status}`;
        } catch (e: any) { err = e?.message || 'fetch failed'; }
        finally { clearTimeout(to); }
      }
      return { live: null, err };
    };

    let { live: liveStreams, err: lastErr } = await tryFetch();
    // All tokens rejected → refresh every user token once and retry
    if (liveStreams === null) {
      const { rows: emails } = await db.query("SELECT email FROM users WHERE twitch_refresh IS NOT NULL");
      for (const r of emails) await refreshUserToken(r.email);
      ({ live: liveStreams, err: lastErr } = await tryFetch());
    }
    if (liveStreams === null) { logger.warn(`[streams] all Helix tokens failed: ${lastErr}`); return { started: [], ended: [], live: 0 }; }

    const liveChannels = new Set<string>(liveStreams.map((s: any) => s.user_login.toLowerCase()));

    // Upsert live streams
    for (const stream of liveStreams) {
      const ch = stream.user_login.toLowerCase();
      await db.query(`
        INSERT INTO stream_sessions (channel_name, started_at, title, game, peak_viewers, twitch_stream_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (twitch_stream_id) WHERE twitch_stream_id IS NOT NULL DO UPDATE SET
          title = EXCLUDED.title,
          game = EXCLUDED.game,
          peak_viewers = GREATEST(stream_sessions.peak_viewers, EXCLUDED.peak_viewers),
          ended_at = NULL
      `, [ch, new Date(stream.started_at), stream.title || null, stream.game_name || null, stream.viewer_count || 0, stream.id]);
    }

    // Close sessions that are no longer live
    if (liveStreams.length === 0) {
      await db.query(`
        UPDATE stream_sessions SET ended_at = NOW()
        WHERE ended_at IS NULL AND channel_name = ANY($1)
      `, [channelNames]).catch(() => {});
    } else {
      await db.query(`
        UPDATE stream_sessions SET ended_at = NOW()
        WHERE ended_at IS NULL
          AND channel_name = ANY($1)
          AND (twitch_stream_id IS NULL OR twitch_stream_id NOT IN (${liveStreams.map((_: any, i: number) => `$${i + 2}`).join(',')}))
      `, [channelNames, ...liveStreams.map((s: any) => s.id)]).catch(() => {});
    }

    const started = [...liveChannels].filter(ch => !openBeforeSet.has(ch));
    const ended = [...openBeforeSet].filter(ch => !liveChannels.has(ch));
    logger.info(`[streams] sync: channels=${channelNames.length} [${channelNames.join(',')}] live=${liveStreams.length} [${[...liveChannels].join(',')}]`);
    return { started, ended, live: liveStreams.length };
  }

  /**
   * Start the background stream poller. Uses setTimeout-recursion (never
   * overlaps) wrapped in try/catch/finally so a rejection can never become an
   * unhandled rejection and the loop always reschedules.
   */
  startStreamPoller(intervalMs = 60_000): void {
    if (this.streamPollerTimer) return;
    logger.info('[streams] poller started');
    const tick = async () => {
      try {
        const { started, ended } = await this.syncStreams();
        for (const ch of started) broadcast(this.wss, { type: 'stream_start', channel: ch, ts: Date.now() });
        for (const ch of ended) broadcast(this.wss, { type: 'stream_end', channel: ch, ts: Date.now() });
      } catch (err) {
        logger.error('stream poll error', err);
      } finally {
        this.streamPollerTimer = setTimeout(tick, intervalMs);
      }
    };
    tick();
  }

  private async getHelixHeaders(ownerEmail: string | null) {
    const { clientId, oauth } = await this.getHelixCredentials(ownerEmail);
    return {
      'Client-Id': clientId,
      'Authorization': `Bearer ${oauth}`,
      'Content-Type': 'application/json',
    };
  }

  private async getUserIds(logins: string[], ownerEmail: string | null): Promise<Record<string, string>> {
    const lowered = logins.map(l => l.toLowerCase());
    const query = lowered.map(l => `login=${l}`).join('&');
    let headers = await this.getHelixHeaders(ownerEmail);
    let res = await fetch(`https://api.twitch.tv/helix/users?${query}`, { headers });
    // Token expired → refresh and retry once
    if (res.status === 401 && ownerEmail) {
      const fresh = await refreshUserToken(ownerEmail);
      if (fresh) {
        headers = { 'Client-Id': process.env.TWITCH_CLIENT_ID || '', 'Authorization': `Bearer ${fresh}`, 'Content-Type': 'application/json' };
        res = await fetch(`https://api.twitch.tv/helix/users?${query}`, { headers });
      }
    }
    const data = await res.json() as any;
    if (!res.ok) {
      logger.error(`getUserIds failed ${res.status} for ${lowered.join(',')} owner=${ownerEmail}: ${JSON.stringify(data)}`);
    }
    const map: Record<string, string> = {};
    for (const u of (data?.data || [])) map[u.login] = u.id;
    if (Object.keys(map).length !== lowered.length) {
      logger.warn(`getUserIds: requested ${lowered.join(',')}, got ${Object.keys(map).join(',') || 'nothing'}`);
    }
    return map;
  }

  /**
   * Resolve the user_id of the OAuth token holder (i.e., the moderator).
   * Twitch /helix/users WITHOUT login params returns the user owning the token.
   * Cached per ownerEmail.
   */
  private moderatorIdCache: Map<string, string> = new Map();

  // ── Settings cache (avoids DB hit on every incoming message) ────────────
  private settingsCache = {
    ignoredRoles: [] as string[],
    autoMode: true,
    defaultMuteDuration: 60,
    setGameEnabled: false,
    lastFetched: 0,
  };
  private readonly SETTINGS_TTL = 10_000; // ms

  private async getCachedSettings() {
    if (Date.now() - this.settingsCache.lastFetched < this.SETTINGS_TTL) {
      return this.settingsCache;
    }
    try {
      const { rows } = await db.query(
        "SELECT key, value FROM settings WHERE key IN ('ignored_roles','auto_mode','default_mute_duration','set_game_enabled')"
      );
      for (const r of rows) {
        if (r.key === 'ignored_roles') {
          try { this.settingsCache.ignoredRoles = JSON.parse(r.value); } catch {}
        } else if (r.key === 'auto_mode') {
          this.settingsCache.autoMode = r.value === 'true';
        } else if (r.key === 'default_mute_duration') {
          this.settingsCache.defaultMuteDuration = parseInt(r.value) || 60;
        } else if (r.key === 'set_game_enabled') {
          this.settingsCache.setGameEnabled = r.value === 'true';
        }
      }
      this.settingsCache.lastFetched = Date.now();
    } catch {}
    return this.settingsCache;
  }

  /** Invalidate settings cache — call after saving settings */
  invalidateSettingsCache(): void {
    this.settingsCache.lastFetched = 0;
  }

  /** Clear moderator_id cache for a user (call after credential change) */
  invalidateModeratorCache(ownerEmail: string | null): void {
    const key = ownerEmail || '__global__';
    this.moderatorIdCache.delete(key);
    logger.info(`Invalidated moderator_id cache for ${key}`);
  }

  private async getModeratorId(ownerEmail: string | null): Promise<string | null> {
    const cacheKey = ownerEmail || '__global__';
    const cached = this.moderatorIdCache.get(cacheKey);
    if (cached) return cached;
    try {
      let headers = await this.getHelixHeaders(ownerEmail);
      let res = await fetch('https://api.twitch.tv/helix/users', { headers });
      if (res.status === 401 && ownerEmail) {
        const fresh = await refreshUserToken(ownerEmail);
        if (fresh) {
          headers = { 'Client-Id': process.env.TWITCH_CLIENT_ID || '', 'Authorization': `Bearer ${fresh}`, 'Content-Type': 'application/json' };
          res = await fetch('https://api.twitch.tv/helix/users', { headers });
        }
      }
      const data = await res.json() as any;
      const id = data.data?.[0]?.id;
      if (id) {
        this.moderatorIdCache.set(cacheKey, id);
        logger.info(`Resolved moderator_id=${id} for ${cacheKey}`);
        return id;
      }
      logger.error(`Could not resolve moderator_id for ${cacheKey}: ${JSON.stringify(data)}`);
      return null;
    } catch (err: any) {
      logger.error(`getModeratorId error: ${err?.message}`);
      return null;
    }
  }

  async muteUser(channelName: string, username: string, durationSeconds: number, performedBy: string, skipReason = false, customReason?: string): Promise<void> {
    const channelLower = channelName.toLowerCase();
    const userLower = username.toLowerCase();
    // Resolve which user's credentials to use — performedBy if they have creds,
    // otherwise channel primary, otherwise global env bot.
    const actorEmail = await this.resolveActorEmail(channelName, performedBy);

    let reason = '';
    if (customReason) {
      reason = customReason;
    } else if (!skipReason) {
      try {
        const { rows } = await db.query('SELECT mute_reason FROM users WHERE email=$1', [performedBy]);
        if (rows.length > 0 && rows[0].mute_reason && rows[0].mute_reason.trim()) reason = rows[0].mute_reason.trim();
      } catch {}
    }

    try {
      const ids = await this.getUserIds([channelLower, userLower], actorEmail);
      const broadcasterId = ids[channelLower];
      const targetId = ids[userLower];
      let moderatorId = await this.getModeratorId(actorEmail);

      if (broadcasterId && targetId && moderatorId) {
        const data: any = { user_id: targetId, duration: durationSeconds };
        // Only include reason if non-empty
        if (reason) data.reason = reason;
        const payload = JSON.stringify({ data });
        const headers = await this.getHelixHeaders(actorEmail);
        let res = await fetch(
          `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
          { method: 'POST', headers, body: payload }
        );
        // If 401 about moderator_id mismatch — invalidate cache and retry once
        if (res.status === 401) {
          const txt = await res.text();
          if (/moderator_id/i.test(txt)) {
            logger.warn(`Moderator ID stale for ${actorEmail}, invalidating cache and retrying...`);
            this.invalidateModeratorCache(actorEmail);
            moderatorId = await this.getModeratorId(actorEmail);
            if (moderatorId) {
              res = await fetch(
                `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
                { method: 'POST', headers, body: payload }
              );
            }
          } else {
            logger.error(`Helix timeout failed 401: ${txt}`);
          }
        }
        if (!res.ok) {
          const responseText = await res.text();
          logger.error(`Helix timeout failed ${res.status}: ${responseText}`);
        } else {
          logger.info(`Timed out ${username} in ${channelName} for ${durationSeconds}s`);
        }
      } else {
        logger.error(`Could not resolve IDs: broadcaster=${broadcasterId} target=${targetId} moderator=${moderatorId}`);
      }
    } catch (err: any) {
      logger.error(`muteUser error: ${err?.message}`);
    }

    await db.query(
      'INSERT INTO moderation_logs (channel_name, username, action, duration_seconds, performed_by) VALUES ($1,$2,$3,$4,$5)',
      [channelName, username, 'MUTED', durationSeconds, performedBy]
    ).catch(() => {});

    await db.query(
      'UPDATE user_profiles SET mute_count = mute_count + 1 WHERE username=$1 AND channel_name=$2',
      [username, channelName]
    ).catch(() => {});

    broadcast(this.wss, { type: 'user_muted', channel: channelName, username, duration: durationSeconds });
  }

  async banUser(channelName: string, username: string, performedBy: string, skipReason = false, customReason?: string): Promise<void> {
    const channelLower = channelName.toLowerCase();
    const userLower = username.toLowerCase();
    const actorEmail = await this.resolveActorEmail(channelName, performedBy);

    let reason = '';
    if (customReason) {
      reason = customReason;
    } else if (!skipReason) {
      try {
        const { rows } = await db.query('SELECT mute_reason FROM users WHERE email=$1', [performedBy]);
        if (rows.length > 0 && rows[0].mute_reason && rows[0].mute_reason.trim()) reason = rows[0].mute_reason.trim();
      } catch {}
    }

    try {
      const ids = await this.getUserIds([channelLower, userLower], actorEmail);
      const broadcasterId = ids[channelLower];
      const targetId = ids[userLower];
      let moderatorId = await this.getModeratorId(actorEmail);

      if (broadcasterId && targetId && moderatorId) {
        const data: any = { user_id: targetId };
        if (reason) data.reason = reason;
        const payload = JSON.stringify({ data });
        const headers = await this.getHelixHeaders(actorEmail);
        let res = await fetch(
          `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
          { method: 'POST', headers, body: payload }
        );
        if (res.status === 401) {
          const txt = await res.text();
          if (/moderator_id/i.test(txt)) {
            this.invalidateModeratorCache(actorEmail);
            moderatorId = await this.getModeratorId(actorEmail);
            if (moderatorId) {
              res = await fetch(
                `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
                { method: 'POST', headers, body: payload }
              );
            }
          }
        }
        if (!res.ok) logger.error(`Helix ban failed ${res.status}: ${await res.text()}`);
        else logger.info(`Banned ${username} in ${channelName}`);
      }
    } catch (err: any) {
      logger.error(`banUser error: ${err?.message}`);
    }

    await db.query(
      'INSERT INTO moderation_logs (channel_name, username, action, performed_by) VALUES ($1,$2,$3,$4)',
      [channelName, username, 'BANNED', performedBy]
    ).catch(() => {});

    broadcast(this.wss, { type: 'user_banned', channel: channelName, username });
  }

  async unbanUser(channelName: string, username: string, performedBy: string): Promise<void> {
    const channelLower = channelName.toLowerCase();
    const userLower = username.toLowerCase();
    const actorEmail = await this.resolveActorEmail(channelName, performedBy);
    try {
      const ids = await this.getUserIds([channelLower, userLower], actorEmail);
      const broadcasterId = ids[channelLower];
      const targetId = ids[userLower];
      const moderatorId = await this.getModeratorId(actorEmail);
      if (broadcasterId && targetId && moderatorId) {
        const headers = await this.getHelixHeaders(actorEmail);
        const res = await fetch(
          `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}&user_id=${targetId}`,
          { method: 'DELETE', headers }
        );
        if (!res.ok) logger.error(`Helix unban failed ${res.status}: ${await res.text()}`);
      }
    } catch (err: any) {
      logger.error(`unbanUser error: ${err?.message}`);
    }
    await db.query(
      'INSERT INTO moderation_logs (channel_name, username, action, performed_by) VALUES ($1,$2,$3,$4)',
      [channelName, username, 'UNBANNED', performedBy]
    ).catch(() => {});
  }

  async clearChat(channelName: string, performedBy: string = 'SYSTEM'): Promise<void> {
    const channelLower = channelName.toLowerCase();
    const actorEmail = await this.resolveActorEmail(channelName, performedBy);
    try {
      const ids = await this.getUserIds([channelLower], actorEmail);
      const broadcasterId = ids[channelLower];
      const moderatorId = await this.getModeratorId(actorEmail);
      if (broadcasterId && moderatorId) {
        const headers = await this.getHelixHeaders(actorEmail);
        const res = await fetch(
          `https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
          { method: 'DELETE', headers }
        );
        if (!res.ok) logger.error(`Helix clearChat failed ${res.status}: ${await res.text()}`);
      }
    } catch (err: any) {
      logger.error(`clearChat error: ${err?.message}`);
    }
  }

  async setSlowMode(channelName: string, seconds: number, performedBy: string = 'SYSTEM'): Promise<void> {
    const channelLower = channelName.toLowerCase();
    const actorEmail = await this.resolveActorEmail(channelName, performedBy);
    try {
      const ids = await this.getUserIds([channelLower], actorEmail);
      const broadcasterId = ids[channelLower];
      const moderatorId = await this.getModeratorId(actorEmail);
      if (broadcasterId && moderatorId) {
        const body = seconds > 0
          ? { slow_mode: true, slow_mode_wait_time: seconds }
          : { slow_mode: false };
        const headers = await this.getHelixHeaders(actorEmail);
        const res = await fetch(
          `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
          { method: 'PATCH', headers, body: JSON.stringify(body) }
        );
        if (!res.ok) logger.error(`Slow mode failed ${res.status}: ${await res.text()}`);
      }
    } catch (err: any) {
      logger.error(`setSlowMode error: ${err?.message}`);
    }
  }

  updateGlobalSettings(settings: Partial<typeof defaultSettings>): void {
    this.globalSettings = { ...this.globalSettings, ...settings };
    this.channels.forEach(state => state.engine.updateSettings(settings));
  }

  /** Update per-channel trigger threshold without rejoining */
  updateChannelTrigger(channelName: string, triggerAfterN: number): void {
    const state = this.channels.get(channelName);
    if (state) state.engine.updateSettings({ triggerAfterN });
  }

  /** Reload whitelist phrases for a channel from DB */
  async reloadWhitelist(channelName: string): Promise<void> {
    const state = this.channels.get(channelName);
    if (!state) return;
    try {
      const { rows } = await db.query('SELECT phrase FROM channel_whitelist WHERE channel_name=$1', [channelName]);
      state.engine.updateSettings({ whitelistPhrases: rows.map((r: any) => r.phrase) });
    } catch (err) {
      logger.error('reloadWhitelist error', err);
    }
  }

  /** Force re-join all owned channels for a user (after credentials change) */
  async forceRejoinUserChannels(email: string): Promise<void> {
    const conn = await this.getOrLoadUserConnection(email);
    if (!conn?.client) {
      logger.warn(`forceRejoinUserChannels: no client for ${email}`);
      return;
    }
    const { rows } = await db.query(
      'SELECT channel_name AS name FROM channel_subscribers WHERE user_email=$1',
      [email]
    );
    for (const row of rows) {
      const channelName = row.name;
      // Make this user the primary if channel is in state
      if (this.channels.has(channelName)) {
        await this.rebindChannelTo(channelName, email);
      } else {
        await this.joinChannel(channelName);
      }
    }
  }


  isConnected(): boolean {
    return this.globalClient?.readyState() === 'OPEN' || this.connections.size > 0;
  }

  getChannelNames(): string[] {
    return [...this.channels.keys()];
  }

  getChannelStatus(name: string): string {
    return this.channels.get(name)?.status || 'disconnected';
  }

  private async updateChannelStatus(name: string, status: string): Promise<void> {
    await db.query(
      'UPDATE channels SET status=$1, updated_at=NOW() WHERE name=$2',
      [status, name]
    ).catch(() => {});
  }
}
