import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../database/db';
import { logger } from '../utils/logger';
import { authenticate } from './authMiddleware';

export const authRouter = Router();

const SESSION_TTL_DAYS = 30;

function newToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

// Verify Google ID token and create session
authRouter.post('/google', async (req: Request, res: Response) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'credential required' });

  try {
    // Verify Google ID token via tokeninfo
    const tiRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!tiRes.ok) return res.status(401).json({ error: 'invalid token' });
    const ti = await tiRes.json() as any;

    // Verify audience
    const expectedClientId = process.env.GOOGLE_CLIENT_ID;
    if (expectedClientId && ti.aud !== expectedClientId) {
      return res.status(401).json({ error: 'token audience mismatch' });
    }

    const email = String(ti.email || '').toLowerCase();
    if (!email || ti.email_verified !== 'true' && ti.email_verified !== true) {
      return res.status(401).json({ error: 'unverified email' });
    }

    // Check whitelist or admin bootstrap
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const isAdmin = adminEmail && email === adminEmail;

    if (!isAdmin) {
      const { rows: wl } = await db.query('SELECT 1 FROM whitelist WHERE email=$1', [email]);
      if (wl.length === 0) {
        return res.status(403).json({ error: 'not whitelisted', email });
      }
    }

    // Upsert user
    const { rows: existing } = await db.query('SELECT id, role, enabled FROM users WHERE email=$1', [email]);
    let userId: number;
    let role: 'admin' | 'user' = isAdmin ? 'admin' : 'user';
    if (existing.length > 0) {
      // If account is explicitly disabled by admin, block login
      if (!existing[0].enabled) {
        return res.status(403).json({ error: 'account disabled' });
      }
      userId = existing[0].id;
      // Don't downgrade an admin
      if (existing[0].role === 'admin') role = 'admin';
      await db.query(
        `UPDATE users SET name=$1, picture=$2, google_id=$3, role=$4, enabled=true, last_login=NOW() WHERE id=$5`,
        [ti.name || null, ti.picture || null, ti.sub || null, role, userId]
      );
    } else {
      const ins = await db.query(
        `INSERT INTO users (email, name, picture, google_id, role, enabled, last_login)
         VALUES ($1,$2,$3,$4,$5,true,NOW()) RETURNING id`,
        [email, ti.name || null, ti.picture || null, ti.sub || null, role]
      );
      userId = ins.rows[0].id;
    }

    // Ensure admin email is also in whitelist
    if (isAdmin) {
      await db.query(
        `INSERT INTO whitelist (email, added_by, note) VALUES ($1,$2,'admin bootstrap') ON CONFLICT (email) DO NOTHING`,
        [email, 'system']
      );
    }

    // Create session
    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 400);
    await db.query(
      `INSERT INTO sessions (token, user_id, email, expires_at, user_agent) VALUES ($1,$2,$3,$4,$5)`,
      [token, userId, email, expiresAt, userAgent]
    );

    res.json({
      token,
      user: { email, name: ti.name, picture: ti.picture, role },
    });
  } catch (err) {
    logger.error('google auth error', err);
    res.status(500).json({ error: 'auth failed' });
  }
});

authRouter.post('/logout', authenticate, async (req: Request, res: Response) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.substring(7) : '';
  if (token) await db.query('DELETE FROM sessions WHERE token=$1', [token]).catch(() => {});
  res.json({ success: true });
});

authRouter.get('/me', authenticate, async (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// Публичный идентификатор сессии — префикс sha256(token). Реальный токен никогда
// не уходит клиенту, поэтому список сессий нельзя использовать для их угона.
function sessionId(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function bearerToken(req: Request): string {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.substring(7) : '';
}

// Список СВОИХ активных сессий (устройство + когда вошёл + текущая ли она).
authRouter.get('/sessions', authenticate, async (req: Request, res: Response) => {
  const current = bearerToken(req);
  const { rows } = await db.query(
    `SELECT token, created_at, expires_at, user_agent
       FROM sessions WHERE user_id=$1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
    [req.user!.id]
  );
  res.json(rows.map((r: any) => ({
    id: sessionId(r.token),
    created_at: r.created_at,
    expires_at: r.expires_at,
    user_agent: r.user_agent || null,
    current: r.token === current,
  })));
});

// Отозвать конкретную СВОЮ сессию по её публичному id. Совпадение считается в
// Node по хэшу, сам токен из БД наружу не отдаётся.
authRouter.delete('/sessions/:id', authenticate, async (req: Request, res: Response) => {
  const targetId = req.params.id;
  const { rows } = await db.query(
    `SELECT token FROM sessions WHERE user_id=$1`,
    [req.user!.id]
  );
  const match = rows.find((r: any) => sessionId(r.token) === targetId);
  if (!match) return res.status(404).json({ error: 'session not found' });
  await db.query('DELETE FROM sessions WHERE token=$1', [match.token]).catch(() => {});
  res.json({ success: true });
});

// Public — returns the Google client ID so frontend doesn't need to hardcode
authRouter.get('/config', (_req: Request, res: Response) => {
  res.json({ google_client_id: process.env.GOOGLE_CLIENT_ID || null });
});
