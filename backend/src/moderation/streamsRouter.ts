import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../database/db';

export const streamsRouter = Router();

function previewDirHasFrames(id: number): boolean {
  try {
    const dir = path.join(process.env.PREVIEW_STORAGE_DIR || '/app/previews', String(id));
    return fs.readdirSync(dir).some(f => f.endsWith('.jpg'));
  } catch { return false; }
}

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

// Сравнение категорий: сколько эфира, зрителей, спама и модерации приносит
// каждая категория. Атрибуция по СЕГМЕНТАМ (stream_game_changes), а не по
// stream_sessions.game (там только текущая категория, §21), поэтому смены внутри
// стрима учитываются корректно. Сегменты одного канала не пересекаются во
// времени (один лайв за раз) → сообщение попадает максимум в один сегмент.
streamsRouter.get('/category-stats', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(parseInt((req.query.days as string) || '30'), 1), 365);
    const channel = (req.query.channel as string) || null;
    const { rows } = await db.query(`
      WITH segbound AS (
        SELECT
          g.channel_name,
          COALESCE(g.game, '—') AS game,
          g.session_id,
          s.peak_viewers,
          g.changed_at AS seg_start,
          COALESCE(
            LEAD(g.changed_at) OVER (PARTITION BY g.session_id ORDER BY g.changed_at),
            s.ended_at, NOW()
          ) AS seg_end
        FROM stream_game_changes g
        JOIN stream_sessions s ON s.id = g.session_id
        WHERE g.changed_at > NOW() - ($1 * INTERVAL '1 day')
          AND ($2::text IS NULL OR g.channel_name = $2)
      ),
      air AS (
        SELECT game,
          COUNT(*)::int AS segments,
          COUNT(DISTINCT session_id)::int AS sessions,
          SUM(EXTRACT(EPOCH FROM (seg_end - seg_start)))::bigint AS airtime_sec,
          ROUND(AVG(peak_viewers))::int AS avg_peak_viewers,
          MAX(peak_viewers)::int AS max_peak_viewers
        FROM segbound GROUP BY game
      ),
      msg AS (
        SELECT sb.game,
          COUNT(m.id)::bigint AS msgs,
          COUNT(m.id) FILTER (WHERE m.spam_score >= 70)::bigint AS spam
        FROM segbound sb
        JOIN messages m ON m.channel_name = sb.channel_name
          AND m.created_at >= sb.seg_start AND m.created_at < sb.seg_end
        GROUP BY sb.game
      ),
      mod AS (
        SELECT sb.game,
          COUNT(ml.id) FILTER (WHERE ml.action IN ('MUTED','AUTO_MUTED'))::bigint AS mutes,
          COUNT(ml.id) FILTER (WHERE ml.action = 'BANNED')::bigint AS bans
        FROM segbound sb
        JOIN moderation_logs ml ON ml.channel_name = sb.channel_name
          AND ml.created_at >= sb.seg_start AND ml.created_at < sb.seg_end
        GROUP BY sb.game
      )
      SELECT a.game, a.segments, a.sessions, a.airtime_sec,
        a.avg_peak_viewers, a.max_peak_viewers,
        COALESCE(mg.msgs, 0)::int AS msgs,
        COALESCE(mg.spam, 0)::int AS spam,
        COALESCE(md.mutes, 0)::int AS mutes,
        COALESCE(md.bans, 0)::int AS bans
      FROM air a
      LEFT JOIN msg mg ON mg.game = a.game
      LEFT JOIN mod md ON md.game = a.game
      ORDER BY a.airtime_sec DESC NULLS LAST
    `, [days, channel]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'category stats failed' });
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

// Hour × day-of-week activity heatmap (MSK), last 30 days
streamsRouter.get('/hourly-heatmap', async (req: Request, res: Response) => {
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
      `SELECT *, EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at))::int AS duration_seconds
       FROM stream_sessions WHERE id=$1`, [id]
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

// Minute drill-down: what happened in a specific minute of a stream
streamsRouter.get('/:id/minute-detail', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const minuteStr = req.query.minute as string;
    if (!minuteStr) return res.status(400).json({ error: 'minute required' });
    const minuteDate = new Date(minuteStr);
    if (isNaN(minuteDate.getTime())) return res.status(400).json({ error: 'invalid minute' });

    const { rows: [session] } = await db.query('SELECT * FROM stream_sessions WHERE id=$1', [id]);
    if (!session) return res.status(404).json({ error: 'not found' });

    const from = minuteDate.toISOString();
    const to = new Date(minuteDate.getTime() + 60_000).toISOString();
    const ch = session.channel_name;

    const [phrases, spammers, modActions, totals] = await Promise.all([
      db.query(`
        SELECT message, COUNT(*)::int AS c, MAX(spam_score)::int AS max_score
        FROM messages
        WHERE channel_name=$1 AND created_at >= $2 AND created_at < $3 AND spam_score >= 70
        GROUP BY message ORDER BY c DESC, max_score DESC LIMIT 8
      `, [ch, from, to]),
      db.query(`
        SELECT username, COUNT(*)::int AS c, MAX(spam_score)::int AS max_score
        FROM messages
        WHERE channel_name=$1 AND created_at >= $2 AND created_at < $3 AND spam_score >= 70
        GROUP BY username ORDER BY c DESC LIMIT 8
      `, [ch, from, to]),
      db.query(`
        SELECT ml.action, ml.username AS target, ml.created_at,
               COALESCE(u.twitch_username, ml.performed_by) AS moderator
        FROM moderation_logs ml
        LEFT JOIN users u ON u.email = ml.performed_by
        WHERE ml.channel_name=$1 AND ml.created_at >= $2 AND ml.created_at < ($3::timestamptz + INTERVAL '2 minutes')
        ORDER BY ml.created_at LIMIT 20
      `, [ch, from, to]),
      db.query(`
        SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE spam_score >= 70)::int AS spam,
               COUNT(DISTINCT username)::int AS chatters
        FROM messages WHERE channel_name=$1 AND created_at >= $2 AND created_at < $3
      `, [ch, from, to]),
    ]);

    res.json({
      minute: from,
      totals: totals.rows[0],
      top_phrases: phrases.rows,
      top_spammers: spammers.rows,
      mod_actions: modActions.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'minute detail failed' });
  }
});

// Таймлайн смен категории внутри трансляции (для оверлея на графике стрима).
// Первая точка — стартовая категория, дальше каждая смена. Отдаётся вместе с
// границами сессии, чтобы фронт мог посчитать длительность последнего отрезка.
streamsRouter.get('/:id/games', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const { rows: [session] } = await db.query(
      'SELECT started_at, ended_at FROM stream_sessions WHERE id=$1', [id]
    );
    if (!session) return res.status(404).json({ error: 'not found' });
    const { rows } = await db.query(
      `SELECT game, changed_at FROM stream_game_changes WHERE session_id=$1 ORDER BY changed_at ASC`,
      [id]
    );
    res.json({
      started_at: session.started_at,
      ended_at: session.ended_at,
      changes: rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'stream games failed' });
  }
});

// Scrub-preview мета для сессии (feature B): как маппить секунду в спрайт/ячейку.
// Фронт по этим полям вычисляет URL листа и позицию кадра при наведении.
streamsRouter.get('/:id/previews', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const { rows } = await db.query(
      `SELECT vod_id, fps, cell_w, cell_h, cols, rows, sheet_count, seconds_covered
       FROM stream_previews WHERE session_id=$1`,
      [id]
    );
    if (rows.length === 0 || (rows[0].sheet_count ?? 0) === 0 || !previewDirHasFrames(id)) {
      // Нет строки / не раскадрован / файлы пропали (эфемерный том после рестарта)
      // → не отдаём available, чтобы график не показывал чёрные битые кадры.
      return res.json({ available: false });
    }
    const p = rows[0];
    res.json({
      available: true,
      base: `/previews/${id}`,          // <base>/sheet_00000.jpg
      vod_id: p.vod_id || null,
      fps: p.fps,
      cell_w: p.cell_w, cell_h: p.cell_h,
      cols: p.cols, rows: p.rows,
      sheet_count: p.sheet_count,
      seconds_covered: p.seconds_covered,
    });
  } catch (err) {
    res.status(500).json({ error: 'previews failed' });
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
