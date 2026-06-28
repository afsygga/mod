import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { authenticate, requireAdmin } from '../auth/authMiddleware';

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

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
