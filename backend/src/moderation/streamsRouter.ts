import { Router, Request, Response } from 'express';
import { db } from '../database/db';

export const streamsRouter = Router();

// Stream sessions list
streamsRouter.get('/', async (req: Request, res: Response) => {
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

// Activity heatmap — daily message counts for last 112 days
streamsRouter.get('/heatmap', async (req: Request, res: Response) => {
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
streamsRouter.get('/heatmap-detail', async (req: Request, res: Response) => {
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

// Moderation activity during a specific stream session
streamsRouter.get('/:id/stats', async (req: Request, res: Response) => {
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

// Per-minute message data for a stream session (for zoomed chart)
streamsRouter.get('/:id/messages-by-minute', async (req: Request, res: Response) => {
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
