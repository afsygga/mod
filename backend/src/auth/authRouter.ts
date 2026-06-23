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
    await db.query(
      `INSERT INTO sessions (token, user_id, email, expires_at) VALUES ($1,$2,$3,$4)`,
      [token, userId, email, expiresAt]
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

// Public — returns the Google client ID so frontend doesn't need to hardcode
authRouter.get('/config', (_req: Request, res: Response) => {
  res.json({ google_client_id: process.env.GOOGLE_CLIENT_ID || null });
});
