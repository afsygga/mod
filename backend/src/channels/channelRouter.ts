import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { logger } from '../utils/logger';
import { recordAudit } from '../utils/audit';

export const channelRouter = Router();

channelRouter.get('/', async (req: Request, res: Response) => {
  try {
    const email = req.user?.email;
    const isAdmin = req.user?.role === 'admin';
    const { rows } = isAdmin
      ? await db.query('SELECT * FROM channels ORDER BY created_at ASC')
      : await db.query(
          `SELECT c.* FROM channels c
           JOIN channel_subscribers s ON s.channel_name = c.name
           WHERE s.user_email = $1
           ORDER BY c.created_at ASC`,
          [email]
        );
    const tm = (global as any).twitchManager;
    const enriched = rows.map((ch: any) => ({
      ...ch,
      status: tm ? tm.getChannelStatus(ch.name) : ch.status,
    }));
    res.json(enriched);
  } catch (err) {
    logger.error('GET /channels error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

channelRouter.post('/', async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Channel name required' });
  }
  const cleanName = name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 64);
  const email = req.user?.email;
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  try {
    // Create channel if doesn't exist (owner_email kept for legacy compat — first subscriber)
    await db.query(
      `INSERT INTO channels (name, status, owner_email) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING`,
      [cleanName, 'connecting', email]
    );
    // Add this user as a subscriber
    await db.query(
      `INSERT INTO channel_subscribers (channel_name, user_email) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [cleanName, email]
    );
    const tm = (global as any).twitchManager;
    if (tm) await tm.joinChannel(cleanName, email);
    const { rows } = await db.query('SELECT * FROM channels WHERE name=$1', [cleanName]);
    recordAudit(email, 'channel_add', cleanName);
    res.json(rows[0]);
  } catch (err) {
    logger.error('POST /channels error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

channelRouter.delete('/:name', async (req: Request, res: Response) => {
  const { name } = req.params;
  const email = req.user?.email;
  const isAdmin = req.user?.role === 'admin';
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  try {
    if (isAdmin) {
      // Admin: forcefully remove entire channel
      const tm = (global as any).twitchManager;
      if (tm) await tm.leaveChannel(name);
      await db.query('DELETE FROM channel_subscribers WHERE channel_name=$1', [name]);
      await db.query('DELETE FROM channels WHERE name=$1', [name]);
      recordAudit(email, 'channel_remove', name);
      return res.json({ success: true, deleted: true });
    }
    // User: just unsubscribe themselves
    await db.query(
      'DELETE FROM channel_subscribers WHERE channel_name=$1 AND user_email=$2',
      [name, email]
    );
    // If no more subscribers — delete channel completely
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS c FROM channel_subscribers WHERE channel_name=$1',
      [name]
    );
    if (rows[0].c === 0) {
      const tm = (global as any).twitchManager;
      if (tm) await tm.leaveChannel(name);
      await db.query('DELETE FROM channels WHERE name=$1', [name]);
      return res.json({ success: true, deleted: true });
    }
    // Otherwise reassign primary owner if needed (for IRC connection failover)
    const tm = (global as any).twitchManager;
    if (tm) await tm.handleSubscriberLeft(name, email);
    res.json({ success: true, deleted: false, subscribers_left: rows[0].c });
  } catch (err) {
    logger.error('DELETE /channels error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

channelRouter.patch('/:name/automod', async (req: Request, res: Response) => {
  const { name } = req.params;
  const { enabled } = req.body;
  try {
    await db.query('UPDATE channels SET auto_mod=$1, updated_at=NOW() WHERE name=$2', [enabled, name]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update per-channel trigger_after_n
channelRouter.patch('/:name/trigger', async (req: Request, res: Response) => {
  const { name } = req.params;
  const value = Math.max(1, Math.min(20, parseInt(req.body.trigger_after_n) || 1));
  const email = req.user?.email;
  const isAdmin = req.user?.role === 'admin';
  try {
    if (!isAdmin) {
      const { rows } = await db.query(
        'SELECT 1 FROM channel_subscribers WHERE channel_name=$1 AND user_email=$2',
        [name, email]
      );
      if (rows.length === 0) {
        return res.status(403).json({ error: 'not your channel' });
      }
    }
    await db.query('UPDATE channels SET trigger_after_n=$1, updated_at=NOW() WHERE name=$2', [value, name]);
    const tm = (global as any).twitchManager;
    if (tm) tm.updateChannelTrigger(name, value);
    res.json({ success: true, trigger_after_n: value });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
