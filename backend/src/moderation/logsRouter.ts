import { Router, Request, Response } from 'express';
import { db } from '../database/db';

export const logsRouter = Router();

async function getOwnedChannels(email: string | undefined): Promise<string[]> {
  if (!email) return [];
  const { rows } = await db.query('SELECT channel_name AS name FROM channel_subscribers WHERE user_email=$1', [email]);
  return rows.map((r: any) => r.name);
}

logsRouter.get('/', async (req: Request, res: Response) => {
  const { channel, limit = '500', offset = '0' } = req.query;
  const isAdmin = req.user?.role === 'admin';
  try {
    let sql = `
      SELECT ml.id, ml.channel_name, ml.username, ml.message, ml.spam_score,
             ml.reasons, ml.action, ml.duration_seconds, ml.performed_by, ml.created_at,
             COALESCE(u.twitch_username, u.name, ml.performed_by) AS performed_by_display
      FROM moderation_logs ml
      LEFT JOIN users u ON u.email = ml.performed_by
      WHERE 1=1`;
    const params: any[] = [];
    if (!isAdmin) {
      const owned = await getOwnedChannels(req.user?.email);
      if (owned.length === 0) return res.json([]);
      params.push(owned);
      sql += ` AND ml.channel_name = ANY($${params.length})`;
    }
    if (channel) { params.push(channel); sql += ` AND ml.channel_name=$${params.length}`; }
    const safeLimit = Math.min(10000, Math.max(1, parseInt(limit as string) || 500));
    const safeOffset = Math.max(0, parseInt(offset as string) || 0);
    params.push(safeLimit);
    params.push(safeOffset);
    sql += ` ORDER BY ml.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

logsRouter.delete('/:id', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin required' });
  try {
    await db.query('DELETE FROM moderation_logs WHERE id=$1', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

logsRouter.delete('/', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin required' });
  try {
    await db.query('TRUNCATE moderation_logs RESTART IDENTITY');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

logsRouter.get('/messages', async (req: Request, res: Response) => {
  const { channel, limit = '200', offset = '0' } = req.query;
  const isAdmin = req.user?.role === 'admin';
  try {
    let sql = 'SELECT * FROM messages WHERE 1=1';
    const params: any[] = [];
    if (!isAdmin) {
      const owned = await getOwnedChannels(req.user?.email);
      if (owned.length === 0) return res.json([]);
      params.push(owned);
      sql += ` AND channel_name = ANY($${params.length})`;
    }
    if (channel) { params.push(channel); sql += ` AND channel_name=$${params.length}`; }
    params.push(parseInt(limit as string));
    params.push(parseInt(offset as string));
    sql += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

logsRouter.get('/users', async (req: Request, res: Response) => {
  const { channel } = req.query;
  try {
    let sql = 'SELECT * FROM user_profiles';
    const params: any[] = [];
    if (channel) { sql += ' WHERE channel_name=$1'; params.push(channel); }
    sql += ' ORDER BY spam_score DESC, flagged_count DESC LIMIT 100';
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});
