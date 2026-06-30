import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { authenticate, requireAdmin } from '../auth/authMiddleware';
import { getOnlineUsers } from '../websocket/wsHandler';

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

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
  res.json({ success: true });
});

adminRouter.delete('/whitelist/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await db.query('DELETE FROM whitelist WHERE id=$1', [id]);
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
  const { rows } = await db.query(
    `SELECT * FROM moderation_logs ORDER BY created_at DESC LIMIT $1`,
    [limit]
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

    // 2. Fetch moderator list from Helix using stored OAuth token
    const { rows: userRows } = await db.query(
      'SELECT twitch_oauth FROM users WHERE email=$1', [ownerEmail]
    );
    const rawOauth: string = userRows[0]?.twitch_oauth || '';
    const accessToken = rawOauth.startsWith('oauth:') ? rawOauth.slice(6) : rawOauth;
    const clientId = process.env.TWITCH_CLIENT_ID || '';
    const oauthHeaders: Record<string, string> = accessToken
      ? { 'Client-Id': clientId, 'Authorization': `Bearer ${accessToken}` }
      : await tm.getHelixHeadersPublic(ownerEmail);

    let mods: any[] = [];
    let cursor: string | null = null;
    let helixError: string | null = null;
    do {
      const url = `https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${broadcasterId}&first=100${cursor ? `&after=${cursor}` : ''}`;
      const r = await fetch(url, { headers: oauthHeaders });
      if (!r.ok) {
        const errBody: any = await r.json().catch(() => ({}));
        console.error('[moderators] Twitch API error:', r.status, JSON.stringify(errBody), 'url:', url, 'hasToken:', !!accessToken);
        helixError = `Twitch API ${r.status}: ${errBody?.message || r.statusText}`;
        break;
      }
      const d: any = await r.json();
      mods = mods.concat(d.data || []);
      cursor = d.pagination?.cursor || null;
    } while (cursor);

    if (helixError && mods.length === 0) {
      return res.status(403).json({ error: helixError, hint: 'Переподключи Twitch аккаунт через OAuth.' });
    }

    // 3. Fetch Twitch avatars for all mods (from cache, then Helix for missing ones)
    const logins = mods.map((m: any) => m.user_login.toLowerCase());
    const { rows: cachedMeta } = await db.query(
      `SELECT username, profile_image_url, display_name FROM twitch_user_meta WHERE username = ANY($1)`,
      [logins]
    );
    const metaMap: Record<string, { avatar: string | null; displayName: string }> = {};
    for (const r of cachedMeta) metaMap[r.username] = { avatar: r.profile_image_url, displayName: r.display_name || r.username };

    const missing = logins.filter(l => !metaMap[l]);
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

    // 4. Get action counts per twitch_username for this channel
    const { rows: actionRows } = await db.query(`
      SELECT
        LOWER(u.twitch_username) AS twitch_login,
        COUNT(*) FILTER (WHERE ml.action='MUTED')::int AS mutes,
        COUNT(*) FILTER (WHERE ml.action='AUTO_MUTED')::int AS auto_mutes,
        COUNT(*) FILTER (WHERE ml.action='BANNED')::int AS bans,
        COUNT(*) FILTER (WHERE ml.action='UNBANNED')::int AS unbans,
        COUNT(*)::int AS total,
        MAX(ml.created_at) AS last_action
      FROM moderation_logs ml
      JOIN users u ON u.email = ml.performed_by
      WHERE ml.channel_name = $1 AND u.twitch_username IS NOT NULL
      GROUP BY LOWER(u.twitch_username)
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

    const { rows } = await db.query(`
      SELECT
        ml.performed_by,
        u.name AS display_name,
        u.twitch_username,
        tm.profile_image_url AS twitch_avatar,
        tm.display_name AS twitch_display_name,
        COUNT(*) FILTER (WHERE ml.action='MUTED')::int AS mutes,
        COUNT(*) FILTER (WHERE ml.action='AUTO_MUTED')::int AS auto_mutes,
        COUNT(*) FILTER (WHERE ml.action='BANNED')::int AS bans,
        COUNT(*) FILTER (WHERE ml.action='UNBANNED')::int AS unbans,
        COUNT(*)::int AS total,
        MAX(ml.created_at) AS last_action
      FROM moderation_logs ml
      LEFT JOIN users u ON u.email = ml.performed_by
      LEFT JOIN twitch_user_meta tm ON tm.username = LOWER(u.twitch_username)
      WHERE ml.performed_by NOT IN ('AUTO', 'console') ${channelFilter}
      GROUP BY ml.performed_by, u.name, u.twitch_username, tm.profile_image_url, tm.display_name
      ORDER BY total DESC
      LIMIT 50
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'moderator stats failed' });
  }
});

// Sync stream sessions — called by frontend Analytics tab, not background
adminRouter.post('/streams/sync', async (_req: Request, res: Response) => {
  try {
    const tm: any = (global as any).twitchManager;
    if (!tm) return res.json({ synced: 0 });

    const channelNames: string[] = tm.getChannelNames ? tm.getChannelNames() : [];
    if (channelNames.length === 0) return res.json({ synced: 0 });

    // Get any connected owner email for Helix creds
    const { rows: ownerRows } = await db.query(
      'SELECT owner_email FROM channels WHERE name = ANY($1) AND owner_email IS NOT NULL LIMIT 1',
      [channelNames]
    );
    const ownerEmail = ownerRows[0]?.owner_email || null;
    const headers = await tm.getHelixHeadersPublic(ownerEmail);

    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10_000);
    const q = channelNames.map((c: string) => `user_login=${encodeURIComponent(c)}`).join('&');
    const helixRes = await fetch(`https://api.twitch.tv/helix/streams?${q}&first=100`, { headers, signal: ctrl.signal });
    if (!helixRes.ok) return res.json({ synced: 0, error: `Helix ${helixRes.status}` });

    const data: any = await helixRes.json();
    const liveStreams: any[] = data.data || [];
    const liveIds = new Set(liveStreams.map((s: any) => s.id));

    // Upsert live streams
    for (const stream of liveStreams) {
      const ch = stream.user_login.toLowerCase();
      await db.query(`
        INSERT INTO stream_sessions (channel_name, started_at, title, game, peak_viewers, twitch_stream_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (twitch_stream_id) DO UPDATE SET
          title = EXCLUDED.title,
          game = EXCLUDED.game,
          peak_viewers = GREATEST(stream_sessions.peak_viewers, EXCLUDED.peak_viewers)
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

    res.json({ synced: liveStreams.length });
  } catch (err: any) {
    res.json({ synced: 0, error: err?.message });
  }
});

// Clear all stream sessions
adminRouter.delete('/streams', async (_req: Request, res: Response) => {
  try {
    await db.query('TRUNCATE stream_sessions RESTART IDENTITY');
    // Also reset in-memory poller state
    const tm = (global as any).twitchManager;
    if (tm?.liveStreamIds) tm.liveStreamIds.clear();
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
    const [actions, timeline, topSpammers] = await Promise.all([
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
        SELECT username, COUNT(*)::int AS actions
        FROM moderation_logs
        WHERE channel_name=$1 AND created_at BETWEEN $2 AND $3
        GROUP BY username ORDER BY actions DESC LIMIT 10
      `, [session.channel_name, session.started_at, endAt]),
    ]);

    res.json({
      session,
      actions: actions.rows,
      timeline: timeline.rows,
      top_spammers: topSpammers.rows,
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
      db.query(`SELECT action, performed_by, channel_name, target_username, created_at
                FROM moderation_logs ORDER BY created_at DESC LIMIT 15`),
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
