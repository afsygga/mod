import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { authenticate, requireAdmin } from '../auth/authMiddleware';
import { getOnlineUsers } from '../websocket/wsHandler';
import { recordAudit } from '../utils/audit';
import { backfillAvatars, fetchChannelModerators } from '../utils/twitchMeta';
import { recentIssues } from '../utils/logger';
import { M } from '../utils/metrics';

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

// ============================================================================
// SYSTEM HEALTH — single "is everything alive" view
// ============================================================================
adminRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const tm: any = (global as any).twitchManager;
    const es: any = (global as any).eventSubManager;
    const tmHealth = tm?.getHealth ? tm.getHealth() : null;
    const esStatus = es?.getStatus ? es.getStatus() : { moderate: [], stream: [] };
    const moderateSet = new Set<string>((esStatus.moderate || []).map((s: string) => s.toLowerCase()));
    const streamSet = new Set<string>((esStatus.stream || []).map((s: string) => s.toLowerCase()));

    const [{ rows: chRows }, { rows: users }, { rows: bts }] = await Promise.all([
      db.query('SELECT name, status FROM channels ORDER BY name'),
      db.query(`SELECT email, twitch_username, twitch_auth_status, twitch_last_validated
                FROM users WHERE twitch_oauth IS NOT NULL ORDER BY twitch_username`),
      db.query('SELECT twitch_login, auth_status, last_validated FROM broadcaster_tokens ORDER BY twitch_login'),
    ]);

    const channels = chRows.map((c: any) => ({
      name: c.name,
      irc: c.status,
      eventsub_actions: moderateSet.has(c.name.toLowerCase()),
      eventsub_stream: streamSet.has(c.name.toLowerCase()),
    }));

    const clientIdSet = !!process.env.TWITCH_CLIENT_ID && !!process.env.TWITCH_CLIENT_SECRET;

    res.json({
      env: { twitch_client_configured: clientIdSet, bot_configured: !!process.env.TWITCH_BOT_OAUTH },
      bot: tmHealth?.globalBot || { configured: false, state: 'none' },
      user_connections: tmHealth?.userConnections || [],
      channels,
      tokens: {
        users: users.map((u: any) => ({
          id: u.twitch_username || u.email,
          status: u.twitch_auth_status || 'active',
          last_validated: u.twitch_last_validated,
        })),
        broadcasters: bts.map((b: any) => ({
          id: b.twitch_login,
          status: b.auth_status || 'active',
          last_validated: b.last_validated,
        })),
      },
      recent_issues: recentIssues.slice(0, 30),
      metrics: {
        uptime_sec: Math.round((Date.now() - M.startTs) / 1000),
        memory_rss: process.memoryUsage().rss,
        memory_heap_used: process.memoryUsage().heapUsed,
        chat: M.chat,
        chat_dropped: M.chatDropped,
        spam_decisions: M.spamDecisions,
        moderation: M.moderation,
        automod: M.automod,
        token_refresh: M.tokenRefresh,
        irc_reconnects: M.ircReconnects,
        eventsub: {
          required_moderate: channels.length,
          active_moderate: moderateSet.size,
          required_stream: channels.length,
          active_stream: streamSet.size,
          reconnects: M.eventsubReconnects,
          revocations: M.eventsubRevocations,
        },
        jobs: M.jobs,
        db_pool: db.poolStats(),
        db_pool_errors: M.dbPoolErrors,
        ws: { ...M.ws, clients: (global as any).wss?.clients?.size ?? 0 },
        process_unhandled_errors: M.process.unhandledErrors,
      },
      ts: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: 'health failed' });
  }
});

// ============================================================================
// ONLINE USERS
// ============================================================================
adminRouter.get('/online', async (_req: Request, res: Response) => {
  const online = getOnlineUsers();
  // De-dupe by email (same user can have multiple tabs open)
  const byEmail = new Map<string, typeof online[0]>();
  for (const u of online) {
    const existing = byEmail.get(u.email);
    if (!existing || u.connectedAt < existing.connectedAt) byEmail.set(u.email, u);
  }
  res.json({ count: byEmail.size, users: [...byEmail.values()] });
});

// Per-channel authorization + EventSub coverage status
adminRouter.get('/channels/auth', async (_req: Request, res: Response) => {
  try {
    const tm: any = (global as any).twitchManager;
    const es: any = (global as any).eventSubManager;
    const channels: string[] = tm?.getChannelNames ? tm.getChannelNames() : [];
    const { rows: bt } = await db.query('SELECT twitch_login FROM broadcaster_tokens');
    const broadcasterSet = new Set<string>(bt.map((r: any) => r.twitch_login.toLowerCase()));
    const status = es?.getStatus ? es.getStatus() : { moderate: [], stream: [] };
    const moderateSet = new Set<string>(status.moderate);
    const streamSet = new Set<string>(status.stream);
    const result = channels.map((c: string) => ({
      channel: c,
      broadcaster_auth: broadcasterSet.has(c.toLowerCase()), // authorized via Twitch (/broadcaster)
      eventsub_actions: moderateSet.has(c.toLowerCase()),     // full action tracking live
      eventsub_stream: streamSet.has(c.toLowerCase()),        // stream start/end live
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'channel auth status failed' });
  }
});

// ============================================================================
// USERS
// ============================================================================
adminRouter.get('/users', async (_req: Request, res: Response) => {
  const { rows } = await db.query(`
    SELECT u.id, u.email, u.name, u.picture, u.role, u.enabled, u.last_login, u.created_at,
           (SELECT COUNT(*) FROM channel_subscribers WHERE user_email = u.email) AS channel_count
    FROM users u ORDER BY u.created_at DESC
  `);
  res.json(rows);
});

adminRouter.patch('/users/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { role, enabled } = req.body;
  const sets: string[] = [];
  const params: any[] = [];
  if (role === 'admin' || role === 'user') { params.push(role); sets.push(`role=$${params.length}`); }
  if (typeof enabled === 'boolean') { params.push(enabled); sets.push(`enabled=$${params.length}`); }
  if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' });
  params.push(id);
  await db.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${params.length}`, params);
  recordAudit(req.user?.email || 'unknown', 'user_update', `id=${id} ${JSON.stringify({ role, enabled })}`);
  res.json({ success: true });
});

adminRouter.delete('/users/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (req.user?.id === id) return res.status(400).json({ error: "can't delete yourself" });
  await db.query('DELETE FROM users WHERE id=$1', [id]);
  res.json({ success: true });
});

// ============================================================================
// WHITELIST
// ============================================================================
adminRouter.get('/whitelist', async (_req: Request, res: Response) => {
  const { rows } = await db.query('SELECT * FROM whitelist ORDER BY created_at DESC');
  res.json(rows);
});

adminRouter.post('/whitelist', async (req: Request, res: Response) => {
  const { email, note } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  const clean = String(email).toLowerCase().trim();
  await db.query(
    `INSERT INTO whitelist (email, added_by, note) VALUES ($1,$2,$3) ON CONFLICT (email) DO UPDATE SET note=$3`,
    [clean, req.user?.email || 'admin', note || null]
  );
  recordAudit(req.user?.email || 'unknown', 'whitelist_add', clean);
  res.json({ success: true });
});

adminRouter.delete('/whitelist/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await db.query('DELETE FROM whitelist WHERE id=$1', [id]);
  recordAudit(req.user?.email || 'unknown', 'whitelist_remove', `id=${id}`);
  res.json({ success: true });
});

// ============================================================================
// CHANNELS — all channels across all users
// ============================================================================
adminRouter.get('/channels', async (_req: Request, res: Response) => {
  const { rows } = await db.query(`
    SELECT c.*, u.name AS owner_name, u.picture AS owner_picture
    FROM channels c LEFT JOIN users u ON u.email = c.owner_email
    ORDER BY c.created_at DESC
  `);
  res.json(rows);
});

adminRouter.delete('/channels/:name', async (req: Request, res: Response) => {
  const tm = (global as any).twitchManager;
  if (tm) await tm.leaveChannel(req.params.name).catch(() => {});
  await db.query('DELETE FROM channels WHERE name=$1', [req.params.name]);
  recordAudit(req.user?.email || 'unknown', 'channel_remove', req.params.name);
  res.json({ success: true });
});

// ============================================================================
// BANS — banned users list
// ============================================================================
adminRouter.get('/bans', async (req: Request, res: Response) => {
  try {
    const channel = req.query.channel as string | undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || '200'), 1000);
    const params: any[] = [limit];
    const channelFilter = channel ? `AND ml.channel_name = $${params.push(channel)}` : '';

    const { rows } = await db.query(`
      SELECT
        ml.id, ml.username, ml.channel_name, ml.performed_by,
        ml.created_at,
        u.name AS performer_name,
        u.picture AS performer_picture,
        u.twitch_username AS performer_twitch,
        tm.profile_image_url AS performer_avatar,
        tm.display_name AS performer_display_name
      FROM moderation_logs ml
      LEFT JOIN users u ON u.email = ml.performed_by
      LEFT JOIN twitch_user_meta tm ON tm.username = LOWER(u.twitch_username)
      WHERE ml.action = 'BANNED' ${channelFilter}
      ORDER BY ml.created_at DESC
      LIMIT $1
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'bans failed' });
  }
});

// ============================================================================
// LOGS — all logs across all channels
// ============================================================================
adminRouter.get('/logs', async (req: Request, res: Response) => {
  const limit = parseInt((req.query.limit as string) || '500');
  const moderator = ((req.query.moderator as string) || '').trim();
  const params: any[] = [];
  let where = '';
  if (moderator) {
    // Per-moderator view: show ALL of their actions incl. secondary pile-ons.
    // performed_by is a site email or a Twitch login; match either the login
    // directly or the email of the user whose twitch_username is that login.
    const p = params.push(moderator);
    where = `WHERE (ml.performed_by = $${p}
             OR ml.performed_by IN (SELECT email FROM users WHERE LOWER(twitch_username)=LOWER($${p})))`;
  } else {
    // General list: only primary rows (secondary pile-ons are grouped away).
    where = 'WHERE ml.primary_id IS NULL';
  }
  const limitP = params.push(limit);
  const { rows } = await db.query(
    `SELECT ml.*, COALESCE(u.twitch_username, u.name, ml.performed_by) AS performed_by_display
     FROM moderation_logs ml
     LEFT JOIN users u ON u.email = ml.performed_by
     ${where}
     ORDER BY ml.created_at DESC LIMIT $${limitP}`,
    params
  );
  res.json(rows);
});

// ============================================================================
// STATS / ANALYTICS
// ============================================================================
adminRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [users, whitelist, channels, messages, logs, mutes24h, msg24h, topUsers, topChannels, actionsBreakdown] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS c, COUNT(*) FILTER (WHERE enabled=true)::int AS active, COUNT(*) FILTER (WHERE role=\'admin\')::int AS admins FROM users'),
      db.query('SELECT COUNT(*)::int AS c FROM whitelist'),
      db.query("SELECT COUNT(*)::int AS c, COUNT(*) FILTER (WHERE status='connected')::int AS connected FROM channels"),
      db.query('SELECT COUNT(*)::int AS c FROM messages'),
      db.query('SELECT COUNT(*)::int AS c FROM moderation_logs'),
      db.query("SELECT COUNT(*)::int AS c FROM moderation_logs WHERE action IN ('MUTED','AUTO_MUTED','BANNED') AND created_at > NOW() - INTERVAL '24 hours'"),
      db.query("SELECT COUNT(*)::int AS c FROM messages WHERE created_at > NOW() - INTERVAL '24 hours'"),
      db.query(`SELECT username, channel_name, message_count, flagged_count, mute_count
                FROM user_profiles ORDER BY mute_count DESC, flagged_count DESC LIMIT 10`),
      db.query(`SELECT channel_name, COUNT(*)::int AS msg_count,
                  COUNT(*) FILTER (WHERE spam_score >= 70)::int AS spam_count
                FROM messages WHERE created_at > NOW() - INTERVAL '7 days'
                GROUP BY channel_name ORDER BY spam_count DESC LIMIT 10`),
      db.query(`SELECT action, COUNT(*)::int AS c FROM moderation_logs GROUP BY action ORDER BY c DESC`),
    ]);

    res.json({
      users: users.rows[0],
      whitelist_count: whitelist.rows[0].c,
      channels: channels.rows[0],
      total_messages: messages.rows[0].c,
      total_logs: logs.rows[0].c,
      mutes_24h: mutes24h.rows[0].c,
      messages_24h: msg24h.rows[0].c,
      top_users: topUsers.rows,
      top_channels: topChannels.rows,
      actions: actionsBreakdown.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'stats failed' });
  }
});

// Daily activity for last 14 days
adminRouter.get('/stats/timeline', async (_req: Request, res: Response) => {
  const { rows } = await db.query(`
    SELECT
      date_trunc('day', created_at)::date AS day,
      COUNT(*) FILTER (WHERE spam_score >= 70)::int AS spam,
      COUNT(*)::int AS total
    FROM messages
    WHERE created_at > NOW() - INTERVAL '14 days'
    GROUP BY day ORDER BY day ASC
  `);
  res.json(rows);
});

// Twitch channel moderators — fetches real mod list from Helix, then joins with action logs
adminRouter.get('/channels/:channel/moderators', async (req: Request, res: Response) => {
  try {
    const channel = req.params.channel.toLowerCase();
    const tm: any = (global as any).twitchManager;

    // 1. Get broadcaster_id (from cache or Helix)
    const { rows: ownerRows } = await db.query(
      'SELECT owner_email FROM channels WHERE name=$1', [channel]
    );
    const ownerEmail = ownerRows[0]?.owner_email || null;

    // Get broadcaster id from twitch_user_meta or fetch it
    let broadcasterId: string | null = null;
    const { rows: metaRows } = await db.query(
      'SELECT twitch_id FROM twitch_user_meta WHERE username=$1', [channel]
    );
    if (metaRows[0]?.twitch_id) {
      broadcasterId = metaRows[0].twitch_id;
    } else if (tm) {
      // Fetch via Helix
      const headers = await tm.getHelixHeadersPublic(ownerEmail);
      const r = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, { headers });
      if (r.ok) {
        const d: any = await r.json();
        broadcasterId = d.data?.[0]?.id || null;
        if (broadcasterId) {
          await db.query(
            `INSERT INTO twitch_user_meta (username, twitch_id, display_name, profile_image_url, fetched_at)
             VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (username) DO UPDATE SET twitch_id=$2, fetched_at=NOW()`,
            [channel, broadcasterId, d.data[0].display_name, d.data[0].profile_image_url]
          );
        }
      }
    }

    if (!broadcasterId) return res.status(404).json({ error: 'broadcaster not found' });

    // 2. Fetch moderator list from Helix via the shared helper (401 → one
    // refresh of the right credentials → retry, BUG-06).
    const { mods, error: helixError } = await fetchChannelModerators(channel, ownerEmail, broadcasterId);
    if (helixError && mods.length === 0) {
      return res.status(403).json({ error: helixError, hint: 'Переподключи Twitch аккаунт через OAuth.' });
    }
    const oauthHeaders: Record<string, string> = await tm.getHelixHeadersPublic(ownerEmail);

    // 3. Fetch Twitch avatars for all mods (from cache, then Helix for missing ones)
    const logins = mods.map((m: any) => m.user_login.toLowerCase());
    const { rows: cachedMeta } = await db.query(
      `SELECT username, profile_image_url, display_name FROM twitch_user_meta WHERE username = ANY($1)`,
      [logins]
    );
    const metaMap: Record<string, { avatar: string | null; displayName: string }> = {};
    for (const r of cachedMeta) metaMap[r.username] = { avatar: r.profile_image_url, displayName: r.display_name || r.username };

    // Re-fetch entries cached without an avatar (e.g. rows inserted with only twitch_id)
    const missing = logins.filter(l => !metaMap[l] || !metaMap[l].avatar);
    if (missing.length > 0 && tm) {
      // Fetch in batches of 100
      for (let i = 0; i < missing.length; i += 100) {
        const batch = missing.slice(i, i + 100);
        const q = batch.map(l => `login=${l}`).join('&');
        const hr = await fetch(`https://api.twitch.tv/helix/users?${q}`, { headers: oauthHeaders });
        if (hr.ok) {
          const hd: any = await hr.json();
          for (const u of (hd.data || [])) {
            metaMap[u.login] = { avatar: u.profile_image_url, displayName: u.display_name };
            await db.query(
              `INSERT INTO twitch_user_meta (username, twitch_id, display_name, profile_image_url, fetched_at)
               VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (username) DO UPDATE SET twitch_id=$2, display_name=$3, profile_image_url=$4, fetched_at=NOW()`,
              [u.login, u.id, u.display_name, u.profile_image_url]
            ).catch(() => {});
          }
        }
      }
    }

    // 4. Get action counts per twitch login for this channel.
    // performed_by is either a site email (→ resolve to u.twitch_username) or,
    // for EventSub-captured external mods, already a Twitch login.
    const { rows: actionRows } = await db.query(`
      SELECT
        LOWER(COALESCE(u.twitch_username, ml.performed_by)) AS twitch_login,
        COUNT(*) FILTER (WHERE ml.action='MUTED')::int AS mutes,
        COUNT(*) FILTER (WHERE ml.action='AUTO_MUTED')::int AS auto_mutes,
        COUNT(*) FILTER (WHERE ml.action='BANNED')::int AS bans,
        COUNT(*) FILTER (WHERE ml.action='UNBANNED')::int AS unbans,
        COUNT(*)::int AS total,
        MAX(ml.created_at) AS last_action
      FROM moderation_logs ml
      LEFT JOIN users u ON u.email = ml.performed_by
      WHERE ml.channel_name = $1 AND ml.performed_by NOT IN ('AUTO','console','bulk','dashboard')
      GROUP BY LOWER(COALESCE(u.twitch_username, ml.performed_by))
    `, [channel]);

    const actionMap: Record<string, any> = {};
    for (const r of actionRows) actionMap[r.twitch_login] = r;

    // 5. Combine: all Twitch mods + their stats (0 if not in logs)
    const result = mods.map((m: any) => {
      const login = m.user_login.toLowerCase();
      const stats = actionMap[login] || { mutes: 0, auto_mutes: 0, bans: 0, unbans: 0, total: 0, last_action: null };
      const meta = metaMap[login] || { avatar: null, displayName: m.user_name };
      return {
        twitch_login: login,
        twitch_display_name: meta.displayName || m.user_name,
        twitch_avatar: meta.avatar,
        mutes: stats.mutes,
        auto_mutes: stats.auto_mutes,
        bans: stats.bans,
        unbans: stats.unbans,
        total: stats.total,
        last_action: stats.last_action,
      };
    }).sort((a: any, b: any) => b.total - a.total);

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'channel moderators failed' });
  }
});

// Moderator leaderboard — who muted/banned/dismissed how many
// ?channel=channelname to filter by channel
adminRouter.get('/stats/moderators', async (req: Request, res: Response) => {
  try {
    const channel = req.query.channel as string | undefined;
    const params: any[] = [];
    const channelFilter = channel
      ? `AND ml.channel_name = $${params.push(channel)}`
      : '';

    // performed_by is a site email (site actions) or a Twitch login (EventSub).
    // Group by the RESOLVED twitch login so the same person logged under both an
    // email and a Twitch login is merged into one row (no duplicates).
    const { rows } = await db.query(`
      SELECT
        LOWER(COALESCE(u.twitch_username, ml.performed_by)) AS twitch_username,
        MAX(u.name) AS display_name,
        MAX(tm.profile_image_url) AS twitch_avatar,
        MAX(tm.display_name) AS twitch_display_name,
        COUNT(*) FILTER (WHERE ml.action='MUTED')::int AS mutes,
        COUNT(*) FILTER (WHERE ml.action='AUTO_MUTED')::int AS auto_mutes,
        COUNT(*) FILTER (WHERE ml.action='BANNED')::int AS bans,
        COUNT(*) FILTER (WHERE ml.action='UNBANNED')::int AS unbans,
        COUNT(*)::int AS total,
        MAX(ml.created_at) AS last_action
      FROM moderation_logs ml
      LEFT JOIN users u ON u.email = ml.performed_by
      LEFT JOIN twitch_user_meta tm ON tm.username = LOWER(COALESCE(u.twitch_username, ml.performed_by))
      WHERE ml.performed_by NOT IN ('AUTO', 'console', 'bulk', 'dashboard') ${channelFilter}
      GROUP BY LOWER(COALESCE(u.twitch_username, ml.performed_by))
      ORDER BY total DESC
      LIMIT 50
    `, params);
    // Backfill avatars missing from the cache
    const noAvatar = rows.filter((r: any) => !r.twitch_avatar).map((r: any) => r.twitch_username);
    if (noAvatar.length > 0) {
      const filled = await backfillAvatars(noAvatar);
      for (const r of rows) {
        const f = filled[r.twitch_username];
        if (f) {
          if (!r.twitch_avatar) r.twitch_avatar = f.avatar;
          if (!r.twitch_display_name) r.twitch_display_name = f.display_name;
        }
      }
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'moderator stats failed' });
  }
});

// Moderator activity over time — bucketed series per moderator
// ?channel=<name>&period=<stream|7d|14d|30d>
adminRouter.get('/stats/mod-activity', async (req: Request, res: Response) => {
  try {
    const channel = req.query.channel as string;
    const period = (req.query.period as string) || '7d';
    if (!channel) return res.status(400).json({ error: 'channel required' });

    let from: Date;
    let to: Date = new Date();
    let bucket: '10min' | 'day' = 'day';

    if (period === 'stream') {
      bucket = '10min';
      const { rows: [sess] } = await db.query(
        `SELECT started_at, COALESCE(ended_at, NOW()) AS ended_at
         FROM stream_sessions WHERE channel_name=$1
         ORDER BY started_at DESC LIMIT 1`, [channel]);
      if (sess) {
        from = new Date(sess.started_at);
        to = new Date(sess.ended_at);
      } else {
        from = new Date(Date.now() - 24 * 3600 * 1000);
      }
    } else {
      const days = period === '30d' ? 30 : period === '14d' ? 14 : 7;
      from = new Date(Date.now() - days * 24 * 3600 * 1000);
    }

    const bucketExpr = bucket === '10min'
      ? `date_trunc('minute', ml.created_at) - (EXTRACT(minute FROM ml.created_at)::int % 10) * INTERVAL '1 minute'`
      : `date_trunc('day', ml.created_at)`;

    const { rows: series } = await db.query(`
      SELECT ${bucketExpr} AS bucket,
        LOWER(COALESCE(u.twitch_username, ml.performed_by)) AS mod_login,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ml.action IN ('MUTED','AUTO_MUTED'))::int AS mutes,
        COUNT(*) FILTER (WHERE ml.action='BANNED')::int AS bans,
        COUNT(*) FILTER (WHERE ml.action='UNBANNED')::int AS unbans,
        COUNT(*) FILTER (WHERE ml.action='FLAGGED')::int AS deletes
      FROM moderation_logs ml
      LEFT JOIN users u ON u.email = ml.performed_by
      WHERE ml.channel_name=$1 AND ml.created_at BETWEEN $2 AND $3
        AND ml.performed_by NOT IN ('AUTO','console','bulk','dashboard')
      GROUP BY bucket, mod_login
      ORDER BY bucket
    `, [channel, from, to]);

    const { rows: modRows } = await db.query(`
      SELECT
        LOWER(COALESCE(u.twitch_username, ml.performed_by)) AS login,
        MAX(tm.display_name) AS display_name,
        MAX(tm.profile_image_url) AS avatar,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ml.action IN ('MUTED','AUTO_MUTED'))::int AS mutes,
        COUNT(*) FILTER (WHERE ml.action='BANNED')::int AS bans,
        COUNT(*) FILTER (WHERE ml.action='UNBANNED')::int AS unbans,
        COUNT(*) FILTER (WHERE ml.action='FLAGGED')::int AS deletes
      FROM moderation_logs ml
      LEFT JOIN users u ON u.email = ml.performed_by
      LEFT JOIN twitch_user_meta tm ON tm.username = LOWER(COALESCE(u.twitch_username, ml.performed_by))
      WHERE ml.channel_name=$1 AND ml.created_at BETWEEN $2 AND $3
        AND ml.performed_by NOT IN ('AUTO','console','bulk','dashboard')
      GROUP BY LOWER(COALESCE(u.twitch_username, ml.performed_by))
      ORDER BY total DESC
    `, [channel, from, to]);

    // Backfill avatars missing from the cache
    const noAvatar = modRows.filter((m: any) => !m.avatar).map((m: any) => m.login);
    if (noAvatar.length > 0) {
      const filled = await backfillAvatars(noAvatar);
      for (const m of modRows) {
        const f = filled[m.login];
        if (f) {
          if (!m.avatar) m.avatar = f.avatar;
          if (!m.display_name) m.display_name = f.display_name;
        }
      }
    }

    res.json({
      range: { from: from.toISOString(), to: to.toISOString(), bucket },
      mods: modRows.map((m: any) => ({
        login: m.login,
        display_name: m.display_name || m.login,
        avatar: m.avatar || null,
        total: m.total, mutes: m.mutes, bans: m.bans, unbans: m.unbans, deletes: m.deletes,
      })),
      series,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'mod activity failed' });
  }
});

// Sync stream sessions — called by frontend Analytics tab, not background
adminRouter.post('/streams/sync', async (_req: Request, res: Response) => {
  try {
    const tm: any = (global as any).twitchManager;
    if (!tm?.syncStreams) return res.json({ synced: 0 });
    const { live } = await tm.syncStreams();
    res.json({ synced: live });
  } catch (err: any) {
    res.json({ synced: 0, error: err?.message });
  }
});

// Clear all stream sessions
adminRouter.delete('/streams', async (req: Request, res: Response) => {
  try {
    await db.query('TRUNCATE stream_sessions RESTART IDENTITY');
    // Also reset in-memory poller state
    const tm = (global as any).twitchManager;
    if (tm?.liveStreamIds) tm.liveStreamIds.clear();
    recordAudit(req.user?.email || 'unknown', 'streams_clear');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'clear failed' });
  }
});

// Stream sessions list
adminRouter.get('/streams', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || '100'), 500);
    const channel = req.query.channel as string | undefined;
    const params: any[] = [limit];
    const where = channel ? `WHERE channel_name=$2` : '';
    if (channel) params.push(channel);
    const { rows } = await db.query(`
      SELECT id, channel_name, started_at, ended_at, title, game, peak_viewers,
        EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at))::int AS duration_seconds
      FROM stream_sessions
      ${where}
      ORDER BY started_at DESC
      LIMIT $1
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'streams failed' });
  }
});

// Moderation activity during a specific stream session
adminRouter.get('/streams/:id/stats', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { rows: [session] } = await db.query(
      'SELECT * FROM stream_sessions WHERE id=$1', [id]
    );
    if (!session) return res.status(404).json({ error: 'not found' });

    const endAt = session.ended_at || new Date().toISOString();
    const [actions, timeline, topSpammers, buckets] = await Promise.all([
      db.query(`
        SELECT action, COUNT(*)::int AS c
        FROM moderation_logs
        WHERE channel_name=$1 AND created_at BETWEEN $2 AND $3
        GROUP BY action
      `, [session.channel_name, session.started_at, endAt]),
      db.query(`
        SELECT
          date_trunc('hour', created_at) AS hour,
          COUNT(*) FILTER (WHERE spam_score >= 70)::int AS spam,
          COUNT(*)::int AS total
        FROM messages
        WHERE channel_name=$1 AND created_at BETWEEN $2 AND $3
        GROUP BY hour ORDER BY hour
      `, [session.channel_name, session.started_at, endAt]),
      db.query(`
        SELECT username, COUNT(*)::int AS mute_count
        FROM moderation_logs
        WHERE channel_name=$1 AND created_at BETWEEN $2 AND $3
          AND action IN ('MUTED', 'AUTO_MUTED')
        GROUP BY username ORDER BY mute_count DESC LIMIT 5
      `, [session.channel_name, session.started_at, endAt]),
      db.query(`
        SELECT
          date_trunc('minute', created_at) -
            (EXTRACT(minute FROM created_at)::int % 10) * INTERVAL '1 minute' AS bucket,
          COUNT(*)::int AS msgs,
          COUNT(*) FILTER (WHERE spam_score >= 70)::int AS spam
        FROM messages
        WHERE channel_name=$1 AND created_at BETWEEN $2 AND $3
        GROUP BY bucket ORDER BY bucket
      `, [session.channel_name, session.started_at, endAt]),
    ]);

    res.json({
      session,
      actions: actions.rows,
      timeline: timeline.rows,
      top_spammers: topSpammers.rows,
      buckets: buckets.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'stream stats failed' });
  }
});

// Chat speed — messages in last 5 minutes
adminRouter.get('/stats/live', async (_req: Request, res: Response) => {
  try {
    const [msgRate, recentActions, channelStatus, autoVsManual] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS c FROM messages WHERE created_at > NOW() - INTERVAL '5 minutes'`),
      db.query(`SELECT ml.action, COALESCE(u.twitch_username, u.name, ml.performed_by) AS performed_by,
                       ml.channel_name, ml.username AS target_username, ml.created_at
                FROM moderation_logs ml
                LEFT JOIN users u ON u.email = ml.performed_by
                ORDER BY ml.created_at DESC LIMIT 15`),
      db.query(`SELECT name, status FROM channels ORDER BY name`),
      db.query(`SELECT
                  COUNT(*) FILTER (WHERE action='AUTO_MUTED')::int AS auto_mutes,
                  COUNT(*) FILTER (WHERE action='MUTED')::int AS manual_mutes
                FROM moderation_logs WHERE created_at > NOW() - INTERVAL '7 days'`),
    ]);
    res.json({
      msg_per_5min: msgRate.rows[0].c,
      recent_actions: recentActions.rows,
      channel_status: channelStatus.rows,
      auto_vs_manual: autoVsManual.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'live stats failed' });
  }
});

// Top channels by total messages (not just spam)
adminRouter.get('/stats/channels-activity', async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(`
      SELECT channel_name,
        COUNT(*)::int AS total_msgs,
        COUNT(*) FILTER (WHERE spam_score >= 70)::int AS spam_msgs,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS msgs_24h
      FROM messages
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY channel_name ORDER BY total_msgs DESC LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'channels activity failed' });
  }
});

// Moderation efficiency: per-channel mute rate (mutes per 100 messages)
adminRouter.get('/stats/efficiency', async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(`
      SELECT
        m.channel_name,
        COUNT(*)::int AS total_messages,
        COALESCE((SELECT COUNT(*) FROM moderation_logs ml
                  WHERE ml.channel_name = m.channel_name
                    AND ml.action IN ('MUTED','AUTO_MUTED','BANNED')
                    AND ml.created_at > NOW() - INTERVAL '7 days'), 0)::int AS mutes,
        ROUND(
          COALESCE((SELECT COUNT(*) FROM moderation_logs ml
                    WHERE ml.channel_name = m.channel_name
                      AND ml.action IN ('MUTED','AUTO_MUTED','BANNED')
                      AND ml.created_at > NOW() - INTERVAL '7 days'), 0)::numeric * 100.0
          / NULLIF(COUNT(*), 0), 2
        ) AS mute_rate_per_100
      FROM messages m
      WHERE m.created_at > NOW() - INTERVAL '7 days'
      GROUP BY m.channel_name
      ORDER BY mute_rate_per_100 DESC NULLS LAST
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'efficiency failed' });
  }
});

// Activity heatmap — daily message counts for last 112 days
adminRouter.get('/stats/heatmap', async (req: Request, res: Response) => {
  try {
    const channel = (req.query.channel as string) || null;
    const { rows } = await db.query(`
      SELECT
        date_trunc('day', created_at)::date AS day,
        COUNT(*)::int AS count
      FROM messages
      WHERE created_at > NOW() - INTERVAL '112 days'
        AND ($1::text IS NULL OR channel_name = $1)
      GROUP BY day ORDER BY day
    `, [channel]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'heatmap failed' });
  }
});

// Heatmap detail — stream info for a specific day
adminRouter.get('/stats/heatmap-detail', async (req: Request, res: Response) => {
  try {
    const date = req.query.date as string;
    const channel = (req.query.channel as string) || null;
    if (!date) return res.status(400).json({ error: 'date required' });
    const { rows } = await db.query(`
      SELECT s.title, s.game, s.peak_viewers,
        EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at))::int AS duration_sec,
        COUNT(m.id)::int AS msg_count
      FROM stream_sessions s
      LEFT JOIN messages m ON m.channel_name = s.channel_name
        AND m.created_at BETWEEN s.started_at AND COALESCE(s.ended_at, NOW())
      WHERE date_trunc('day', s.started_at AT TIME ZONE 'Europe/Moscow')::date = $1::date
        AND ($2::text IS NULL OR s.channel_name = $2)
      GROUP BY s.id, s.title, s.game, s.peak_viewers, s.started_at, s.ended_at
      ORDER BY s.started_at DESC LIMIT 1
    `, [date, channel]);
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'heatmap detail failed' });
  }
});

// Moderator profile — full stats for a specific moderator
adminRouter.get('/moderators/:username/profile', async (req: Request, res: Response) => {
  try {
    const username = req.params.username;
    const channel = (req.query.channel as string) || null;

    // performed_by may be a Twitch login (EventSub / external) or a site email.
    // Match logs where performed_by is the given login OR the email of the user
    // whose twitch_username is that login.
    const actorClause = `(ml.performed_by=$1 OR ml.performed_by IN (SELECT email FROM users WHERE LOWER(twitch_username)=LOWER($1)))`;

    const [actionBreakdown, dailyActivity, recentActions, avgRespRow, metaRow, dailyMsgRow] = await Promise.all([
      db.query(`
        SELECT action, COUNT(*)::int AS c FROM moderation_logs ml
        WHERE ${actorClause} AND ($2::text IS NULL OR channel_name=$2)
        GROUP BY action ORDER BY c DESC
      `, [username, channel]),
      db.query(`
        SELECT date_trunc('day', created_at)::date AS day,
          COUNT(*)::int AS c,
          COUNT(*) FILTER (WHERE action='MUTED')::int AS mutes,
          COUNT(*) FILTER (WHERE action='AUTO_MUTED')::int AS auto_mutes,
          COUNT(*) FILTER (WHERE action='BANNED')::int AS bans,
          COUNT(*) FILTER (WHERE action='UNBANNED')::int AS unbans,
          COUNT(*) FILTER (WHERE action='FLAGGED')::int AS deletes
        FROM moderation_logs ml
        WHERE ${actorClause} AND ($2::text IS NULL OR channel_name=$2)
          AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY day ORDER BY day
      `, [username, channel]),
      db.query(`
        SELECT action, username AS target_username, channel_name, created_at FROM moderation_logs ml
        WHERE ${actorClause} AND ($2::text IS NULL OR channel_name=$2)
        ORDER BY created_at DESC LIMIT 20
      `, [username, channel]),
      // Real mute reaction time: seconds from the muted user's last message to the mute
      db.query(`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (ml.created_at - m.msg_time)))::numeric, 1) AS avg_response_sec
        FROM moderation_logs ml
        JOIN LATERAL (
          SELECT created_at AS msg_time FROM messages
          WHERE channel_name = ml.channel_name AND LOWER(username) = LOWER(ml.username)
            AND created_at <= ml.created_at
          ORDER BY created_at DESC LIMIT 1
        ) m ON true
        WHERE ${actorClause} AND ml.action IN ('MUTED','AUTO_MUTED')
          AND ($2::text IS NULL OR ml.channel_name=$2)
          AND ml.created_at - m.msg_time < INTERVAL '10 minutes'
      `, [username, channel]),
      db.query(`
        SELECT tm.profile_image_url, tm.display_name
        FROM users u
        LEFT JOIN twitch_user_meta tm ON tm.username = LOWER(u.twitch_username)
        WHERE u.email=$1 OR LOWER(u.twitch_username)=$1
        LIMIT 1
      `, [username]),
      // Channel chat volume per day (context line) — needs a channel
      channel ? db.query(`
        SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS c
        FROM messages
        WHERE channel_name=$1 AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY day ORDER BY day
      `, [channel]) : Promise.resolve({ rows: [] as any[] }),
    ]);

    res.json({
      action_breakdown: actionBreakdown.rows,
      daily_activity: dailyActivity.rows,
      recent_actions: recentActions.rows,
      avg_response_sec: avgRespRow.rows[0]?.avg_response_sec || null,
      profile_image_url: metaRow.rows[0]?.profile_image_url || null,
      display_name: metaRow.rows[0]?.display_name || null,
      daily_messages: dailyMsgRow.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'moderator profile failed' });
  }
});

// Admin audit log — recent admin/settings mutations
adminRouter.get('/audit', async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT 200'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'audit failed' });
  }
});

// Hour × day-of-week activity heatmap (MSK), last 30 days
adminRouter.get('/stats/hourly-heatmap', async (req: Request, res: Response) => {
  try {
    const channel = (req.query.channel as string) || null;
    const { rows } = await db.query(`
      SELECT
        EXTRACT(DOW FROM created_at AT TIME ZONE 'Europe/Moscow')::int AS dow,
        EXTRACT(HOUR FROM created_at AT TIME ZONE 'Europe/Moscow')::int AS hour,
        COUNT(*)::int AS c
      FROM messages
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND ($1::text IS NULL OR channel_name = $1)
      GROUP BY dow, hour
    `, [channel]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'hourly heatmap failed' });
  }
});

// Per-minute message data for a stream session (for zoomed chart)
adminRouter.get('/streams/:id/messages-by-minute', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { rows: [session] } = await db.query('SELECT * FROM stream_sessions WHERE id=$1', [id]);
    if (!session) return res.status(404).json({ error: 'not found' });
    const endAt = session.ended_at || new Date().toISOString();
    const { rows } = await db.query(`
      SELECT
        date_trunc('minute', created_at) AS minute,
        COUNT(*)::int AS msgs,
        COUNT(*) FILTER (WHERE spam_score >= 70)::int AS spam,
        COUNT(DISTINCT username) FILTER (WHERE spam_score >= 70)::int AS spam_users
      FROM messages
      WHERE channel_name=$1 AND created_at BETWEEN $2 AND $3
      GROUP BY minute ORDER BY minute
    `, [session.channel_name, session.started_at, endAt]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'messages by minute failed' });
  }
});
