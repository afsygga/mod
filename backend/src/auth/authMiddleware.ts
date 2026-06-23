import { Request, Response, NextFunction } from 'express';
import { db } from '../database/db';

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  role: 'admin' | 'user';
  enabled: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.substring(7) : ((req as any).cookies?.session || '');
  if (!token) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, u.picture, u.role, u.enabled
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );
    if (rows.length === 0) { res.status(401).json({ error: 'invalid session' }); return; }
    const user = rows[0];
    if (!user.enabled) { res.status(403).json({ error: 'account disabled' }); return; }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'auth error' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'admin required' });
    return;
  }
  next();
}
