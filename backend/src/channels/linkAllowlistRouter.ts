import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { logger } from '../utils/logger';

export const linkAllowlistRouter = Router();

async function userOwnsChannel(email: string | undefined, channel: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  if (!email) return false;
  const { rows } = await db.query(
    'SELECT 1 FROM channel_subscribers WHERE channel_name=$1 AND user_email=$2',
    [channel, email]
  );
  return rows.length > 0;
}

/** Приводим ввод к голому домену: без протокола, www и пути. "https://www.Twitch.TV/x" → "twitch.tv" */
function normalizeDomain(input: string): string {
  return String(input).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\s+/g, '')
    .slice(0, 190);
}

linkAllowlistRouter.get('/:channel', async (req: Request, res: Response) => {
  const ok = await userOwnsChannel(req.user?.email, req.params.channel, req.user?.role === 'admin');
  if (!ok) return res.status(403).json({ error: 'not your channel' });
  const { rows } = await db.query(
    'SELECT id, domain, created_at FROM channel_link_allowlist WHERE channel_name=$1 ORDER BY created_at DESC',
    [req.params.channel]
  );
  res.json(rows);
});

linkAllowlistRouter.post('/:channel', async (req: Request, res: Response) => {
  const ok = await userOwnsChannel(req.user?.email, req.params.channel, req.user?.role === 'admin');
  if (!ok) return res.status(403).json({ error: 'not your channel' });
  const domain = normalizeDomain(req.body?.domain || '');
  // Минимальная валидация: хотя бы одна точка и допустимые символы домена.
  if (!domain || !/^[a-zа-я0-9-]+(\.[a-zа-я0-9-]+)+$/i.test(domain)) {
    return res.status(400).json({ error: 'invalid domain' });
  }
  try {
    await db.query(
      `INSERT INTO channel_link_allowlist (channel_name, domain) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.params.channel, domain]
    );
    const tm = (global as any).twitchManager;
    if (tm) await tm.reloadLinkAllowlist(req.params.channel);
    res.json({ success: true });
  } catch (err) {
    logger.error('link-allowlist add error', err);
    res.status(500).json({ error: 'internal' });
  }
});

linkAllowlistRouter.delete('/:channel/:id', async (req: Request, res: Response) => {
  const ok = await userOwnsChannel(req.user?.email, req.params.channel, req.user?.role === 'admin');
  if (!ok) return res.status(403).json({ error: 'not your channel' });
  await db.query('DELETE FROM channel_link_allowlist WHERE id=$1 AND channel_name=$2', [parseInt(req.params.id), req.params.channel]);
  const tm = (global as any).twitchManager;
  if (tm) await tm.reloadLinkAllowlist(req.params.channel);
  res.json({ success: true });
});
