import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { authenticate } from './authMiddleware';
import { logger } from '../utils/logger';

export const twitchCredsRouter = Router();

/** Best-effort revoke of an access token at Twitch. Never throws. */
async function revokeAccessToken(rawToken: string): Promise<void> {
  const clientId = process.env.TWITCH_CLIENT_ID || '';
  if (!clientId || !rawToken) return;
  try {
    await fetch('https://id.twitch.tv/oauth2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, token: rawToken }),
    });
  } catch (err: any) {
    logger.warn(`[creds] token revoke failed: ${err?.message || err}`);
  }
}

twitchCredsRouter.use(authenticate);

// Get current twitch creds (oauth masked)
twitchCredsRouter.get('/', async (req: Request, res: Response) => {
  const email = req.user!.email;
  const { rows } = await db.query(
    'SELECT twitch_username, twitch_oauth, twitch_auth_status FROM users WHERE email=$1',
    [email]
  );
  if (rows.length === 0) return res.json({ twitch_username: null, has_oauth: false, auth_status: null });
  const row = rows[0];
  res.json({
    twitch_username: row.twitch_username,
    has_oauth: !!row.twitch_oauth,
    // BUG-13: UI signal — 'reauthorization_required' means the refresh chain is
    // dead and the user must re-run the Twitch OAuth flow.
    auth_status: row.twitch_oauth ? (row.twitch_auth_status || 'active') : null,
    // mask: oauth:****
    oauth_preview: row.twitch_oauth ? row.twitch_oauth.slice(0, 8) + '…' + row.twitch_oauth.slice(-4) : null,
  });
});

// Save (or update) twitch creds
twitchCredsRouter.put('/', async (req: Request, res: Response) => {
  const { username, oauth } = req.body;
  if (!username || !oauth) return res.status(400).json({ error: 'username and oauth required' });

  const cleanUsername = String(username).toLowerCase().trim().replace(/[^a-z0-9_]/g, '').slice(0, 64);
  let cleanOauth = String(oauth).trim();
  if (!cleanOauth.startsWith('oauth:')) cleanOauth = 'oauth:' + cleanOauth;

  // Validate by hitting Twitch API
  try {
    const clientId = process.env.TWITCH_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'server twitch client_id not configured' });
    const r = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${cleanOauth.replace('oauth:', '')}` },
    });
    if (!r.ok) return res.status(400).json({ error: 'invalid twitch oauth token' });
    const info = await r.json() as any;
    if (info.login && info.login.toLowerCase() !== cleanUsername) {
      return res.status(400).json({
        error: `token belongs to ${info.login}, not ${cleanUsername}`,
        suggested_username: info.login,
      });
    }
  } catch (err) {
    logger.error('twitch token validate error', err);
    return res.status(500).json({ error: 'validation failed' });
  }

  const email = req.user!.email;
  // BUG-01: a manually-supplied access token is a NEW authorization — the old
  // refresh token belongs to a different grant and must not survive, or a
  // background refresh would overwrite the manual access with the old pair.
  await db.query(
    `UPDATE users SET twitch_username=$1, twitch_oauth=$2, twitch_refresh=NULL,
                      twitch_auth_status='active', twitch_last_validated=NOW()
     WHERE email=$3`,
    [cleanUsername, cleanOauth, email]
  );

  // Connect IRC for this user
  try {
    const tm = (global as any).twitchManager;
    if (tm) {
      await tm.ensureUserConnection(email, cleanUsername, cleanOauth);
      // Force re-join all their channels under new credentials
      await tm.forceRejoinUserChannels(email);
    }
  } catch (err) {
    logger.error('Error connecting user IRC after save', err);
  }

  res.json({ success: true });
});

// Debug: show what Twitch sees with current credentials
twitchCredsRouter.get('/debug', async (req: Request, res: Response) => {
  const email = req.user!.email;
  const { rows } = await db.query(
    'SELECT twitch_username, twitch_oauth FROM users WHERE email=$1',
    [email]
  );
  if (rows.length === 0 || !rows[0].twitch_oauth) {
    return res.json({ ok: false, error: 'no credentials saved' });
  }
  const oauth = rows[0].twitch_oauth.replace('oauth:', '');
  try {
    const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${oauth}` },
    });
    const validateData: any = await validateRes.json();
    const usersRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID || '',
        'Authorization': `Bearer ${oauth}`,
      },
    });
    const usersData: any = await usersRes.json();
    res.json({
      saved_username: rows[0].twitch_username,
      validate: {
        status: validateRes.status,
        login: validateData?.login,
        user_id: validateData?.user_id,
        scopes: validateData?.scopes,
        expires_in: validateData?.expires_in,
        client_id: validateData?.client_id,
        error: validateData?.error,
        message: validateData?.message,
      },
      helix_users: {
        status: usersRes.status,
        data: usersData?.data?.[0]
          ? { id: usersData.data[0].id, login: usersData.data[0].login }
          : null,
        error: usersData?.error,
        message: usersData?.message,
      },
    });
  } catch (err: any) {
    res.json({ ok: false, error: err?.message });
  }
});
twitchCredsRouter.delete('/', async (req: Request, res: Response) => {
  const email = req.user!.email;
  // Grab the current access to revoke it at Twitch before we drop it locally.
  const { rows } = await db.query('SELECT twitch_oauth FROM users WHERE email=$1', [email]);
  const rawToken = rows[0]?.twitch_oauth ? String(rows[0].twitch_oauth).replace(/^oauth:/, '') : '';
  if (rawToken) await revokeAccessToken(rawToken);

  // BUG-02: clear the WHOLE pair (refresh included) so no background task can
  // resurrect the disconnected integration. Idempotent — a second DELETE is a
  // no-op that still returns success.
  await db.query(
    `UPDATE users SET twitch_username=NULL, twitch_oauth=NULL, twitch_refresh=NULL,
                      twitch_auth_status='disconnected'
     WHERE email=$1`,
    [email]
  );

  const tm = (global as any).twitchManager;
  if (tm) await tm.removeUserConnection(email).catch(() => {});
  res.json({ success: true });
});
