import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { logger } from '../utils/logger';

export const whitelistRouter = Router();

async function userOwnsChannel(email: string | undefined, channel: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  if (!email) return false;
  const { rows } = await db.query(
    'SELECT 1 FROM channel_subscribers WHERE channel_name=$1 AND user_email=$2',
    [channel, email]
  );
  return rows.length > 0;
}

whitelistRouter.get('/:channel', async (req: Request, res: Response) => {
  const ok = await userOwnsChannel(req.user?.email, req.params.channel, req.user?.role === 'admin');
  if (!ok) return res.status(403).json({ error: 'not your channel' });
  const { rows } = await db.query(
    'SELECT id, phrase, created_at FROM channel_whitelist WHERE channel_name=$1 ORDER BY created_at DESC',
    [req.params.channel]
  );
  res.json(rows);
});

whitelistRouter.post('/:channel', async (req: Request, res: Response) => {
  const ok = await userOwnsChannel(req.user?.email, req.params.channel, req.user?.role === 'admin');
  if (!ok) return res.status(403).json({ error: 'not your channel' });
  const { phrase } = req.body;
  if (!phrase || typeof phrase !== 'string') return res.status(400).json({ error: 'phrase required' });
  const clean = String(phrase).trim().slice(0, 500);
  if (!clean) return res.status(400).json({ error: 'empty phrase' });
  try {
    await db.query(
      `INSERT INTO channel_whitelist (channel_name, phrase) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.params.channel, clean]
    );
    // Reload in engine
    const tm = (global as any).twitchManager;
    if (tm) await tm.reloadWhitelist(req.params.channel);
    res.json({ success: true });
  } catch (err) {
    logger.error('whitelist add error', err);
    res.status(500).json({ error: 'internal' });
  }
});

whitelistRouter.delete('/:channel/:id', async (req: Request, res: Response) => {
  const ok = await userOwnsChannel(req.user?.email, req.params.channel, req.user?.role === 'admin');
  if (!ok) return res.status(403).json({ error: 'not your channel' });
  await db.query('DELETE FROM channel_whitelist WHERE id=$1 AND channel_name=$2', [parseInt(req.params.id), req.params.channel]);
  const tm = (global as any).twitchManager;
  if (tm) await tm.reloadWhitelist(req.params.channel);
  res.json({ success: true });
});
