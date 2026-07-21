import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { backfillAvatars, fetchChannelModerators } from '../utils/twitchMeta';

// Analytics endpoints available to any authenticated user (mounted with
// `authenticate` only in index.ts). Mirrors the admin analytics handlers.
export const analyticsRouter = Router();

// Twitch channel moderators — fetches real mod list from Helix, then joins with action logs
analyticsRouter.get('/channels/:channel/moderators', async (req: Request, res: Response) => {
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
analyticsRouter.get('/stats/moderators', async (req: Request, res: Response) => {
  try {
    const channel = req.query.channel as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const params: any[] = [];
    const channelFilter = channel
      ? `AND ml.channel_name = $${params.push(channel)}`
      : '';
    // Optional day/range filter — from inclusive, to exclusive (ISO timestamps)
    let dateFilter = '';
    if (from) dateFilter += ` AND ml.created_at >= $${params.push(from)}`;
    if (to) dateFilter += ` AND ml.created_at < $${params.push(to)}`;

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
      WHERE ml.performed_by NOT IN ('AUTO', 'console', 'bulk', 'dashboard') ${channelFilter}${dateFilter}
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

// Day (or range) summary — totals for a specific window.
// ?from=<ISO>&to=<ISO>[&channel=<name>]  (from inclusive, to exclusive)
analyticsRouter.get('/day-summary', async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string;
    const to = req.query.to as string;
    const channel = req.query.channel as string | undefined;
    if (!from || !to) return res.status(400).json({ error: 'from/to required' });

    const mp: any[] = [from, to];
    const chMsg = channel ? `AND channel_name = $${mp.push(channel)}` : '';
    const ap: any[] = [from, to];
    const chLog = channel ? `AND channel_name = $${ap.push(channel)}` : '';

    const [msgs, acts] = await Promise.all([
      db.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE spam_score >= 70)::int AS spam,
               COUNT(DISTINCT username)::int AS chatters
        FROM messages
        WHERE created_at >= $1 AND created_at < $2 ${chMsg}
      `, mp),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE action IN ('MUTED','AUTO_MUTED'))::int AS mutes,
          COUNT(*) FILTER (WHERE action='BANNED')::int AS bans,
          COUNT(*) FILTER (WHERE action='UNBANNED')::int AS unbans,
          COUNT(*) FILTER (WHERE action='FLAGGED')::int AS deletes,
          COUNT(*)::int AS total_actions,
          COUNT(DISTINCT performed_by) FILTER (WHERE performed_by NOT IN ('AUTO','console','bulk','dashboard'))::int AS active_mods
        FROM moderation_logs
        WHERE created_at >= $1 AND created_at < $2 ${chLog}
      `, ap),
    ]);

    res.json({ messages: msgs.rows[0], actions: acts.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'day summary failed' });
  }
});

// Moderator activity over time — bucketed series per moderator
// ?channel=<name>&period=<stream|7d|14d|30d>
analyticsRouter.get('/stats/mod-activity', async (req: Request, res: Response) => {
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

// Moderator profile — full stats for a specific moderator
analyticsRouter.get('/moderators/:username/profile', async (req: Request, res: Response) => {
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
