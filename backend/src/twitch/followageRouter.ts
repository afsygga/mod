import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { lookupFollowage, listFollowerChannels } from './followage';
import { logger } from '../utils/logger';

/**
 * /api/followage — follow dates for Chatterino usercards (aFserinno).
 *
 * Auth: the client presents its own Twitch OAuth token (the one it got from
 * afsyg.gay/client_login). It is validated against id.twitch.tv and must
 * belong to OUR Twitch application (client_id match), so only our clients
 * get answers and no site account is needed. Nothing is stored: validations
 * are cached in memory for an hour, keyed by a hash of the token.
 */

export const followageRouter = Router();

const VALIDATION_TTL_MS = 60 * 60_000;
const validated = new Map<string, { login: string; userId: string; expiresAt: number }>();

function tokenHash(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function requireClientToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = String(req.headers.authorization || '');
  const m = /^(?:OAuth|Bearer)\s+([A-Za-z0-9]+)$/.exec(header);
  if (!m) { res.status(401).json({ error: 'missing token' }); return; }
  const raw = m[1];
  const key = tokenHash(raw);
  const now = Date.now();
  const hit = validated.get(key);
  if (hit && hit.expiresAt > now) {
    (req as any).twitchUser = { login: hit.login, userId: hit.userId };
    next();
    return;
  }
  try {
    const r = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { 'Authorization': `OAuth ${raw}` } });
    if (r.status === 401) { validated.delete(key); res.status(401).json({ error: 'invalid token' }); return; }
    if (!r.ok) { res.status(503).json({ error: 'twitch unavailable' }); return; }
    const d: any = await r.json();
    const ourClient = process.env.TWITCH_CLIENT_ID || '';
    if (!ourClient || d.client_id !== ourClient) { res.status(403).json({ error: 'foreign client' }); return; }
    if (!d.login || !d.user_id) { res.status(403).json({ error: 'not a user token' }); return; }
    const entry = { login: String(d.login), userId: String(d.user_id), expiresAt: now + VALIDATION_TTL_MS };
    validated.set(key, entry);
    if (validated.size > 5000) {
      for (const [k, v] of validated) { if (v.expiresAt <= now) validated.delete(k); }
    }
    (req as any).twitchUser = { login: entry.login, userId: entry.userId };
    next();
  } catch (e: any) {
    logger.warn(`[followage] token validation failed: ${e?.message || e}`);
    res.status(503).json({ error: 'twitch unavailable' });
  }
}

const ID_RE = /^\d{1,20}$/;

// GET /api/followage?channel=<broadcaster id>&user=<user id>
followageRouter.get('/', requireClientToken, async (req: Request, res: Response) => {
  const channel = String(req.query.channel || '');
  const user = String(req.query.user || '');
  if (!ID_RE.test(channel) || !ID_RE.test(user)) {
    res.status(400).json({ error: 'channel and user must be Twitch ids' });
    return;
  }
  const result = await lookupFollowage(channel, user);
  res.set('Cache-Control', 'private, max-age=300');
  res.json({
    available: result.available,
    followed_at: result.followedAt,
    checked_at: result.checkedAt,
  });
});

// GET /api/followage/channels — which channels the service can answer for
followageRouter.get('/channels', requireClientToken, async (_req: Request, res: Response) => {
  const channels = await listFollowerChannels().catch(() => []);
  res.json({ channels: channels.map(c => ({ id: c.id, login: c.login })) });
});
