import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../database/db';
import { authenticate } from './authMiddleware';
import { logger } from '../utils/logger';
import { clearUserReauth, clearBroadcasterReauth } from '../twitch/twitchToken';

export const twitchOAuthRouter = Router();

const STATE_TTL_MS = 10 * 60 * 1000;
function stateSecret(): string { return process.env.JWT_SECRET || process.env.TWITCH_CLIENT_SECRET || 'dev-secret'; }

// BUG-09: OAuth state must be tamper-proof. We HMAC-sign the payload so the
// email/flow can't be edited, bind it to a flow, and enforce a TTL (and reject
// future timestamps). Signing is stateless (no store) — it blocks tampering and
// CSRF-binding; one-time-use would additionally need a server-side nonce store.
function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyState(state: string, expectedFlow: 'user' | 'broadcaster'): any | null {
  const parts = String(state).split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data: any;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (data.flow !== expectedFlow) return null;
  const ts = Number(data.ts);
  if (!Number.isFinite(ts) || ts > Date.now() + 60_000 || Date.now() - ts > STATE_TTL_MS) return null;
  return data;
}

const SCOPES = [
  'moderator:read:moderators',
  'channel:manage:moderators',
  'moderation:read',
  'channel:moderate',
  'channel:manage:broadcast',
  'chat:edit',
  'chat:read',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'user:read:email',
  // Required for EventSub channel.moderate (v2) — live capture of all mod actions
  'moderator:read:blocked_terms',
  'moderator:read:chat_settings',
  'moderator:read:unban_requests',
  'moderator:read:warnings',
  'moderator:read:vips',
  'moderator:read:suspicious_users',
].join(' ');

function getRedirectUri(req: Request): string {
  return process.env.TWITCH_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/twitch-oauth/callback`;
}

function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || 'https://afsyg.gay';
}

function getBroadcasterRedirectUri(req: Request): string {
  return process.env.TWITCH_BROADCASTER_REDIRECT_URI ||
    (process.env.TWITCH_REDIRECT_URI || '').replace('/callback', '/broadcaster-callback') ||
    `${req.protocol}://${req.get('host')}/api/twitch-oauth/broadcaster-callback`;
}

const BROADCASTER_SCOPES = [
  'channel:manage:broadcast',
  'moderation:read',
  'moderator:read:moderators',
  'user:read:email',
].join(' ');

// Step 1: return OAuth URL as JSON (called via fetch with Bearer token, then redirect from JS)
twitchOAuthRouter.get('/connect-url', authenticate, (req: Request, res: Response) => {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'TWITCH_CLIENT_ID not set' });

  const state = signState({ flow: 'user', email: req.user!.email });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(req),
    response_type: 'code',
    scope: SCOPES,
    state,
    force_verify: 'true',
  });
  res.json({ url: `https://id.twitch.tv/oauth2/authorize?${params}` });
});

// Step 2: Twitch redirects back with ?code=...
twitchOAuthRouter.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;
  const frontendUrl = getFrontendUrl();

  if (error) return res.redirect(`${frontendUrl}?twitch_error=${encodeURIComponent(String(error))}`);
  if (!code || !state) return res.redirect(`${frontendUrl}?twitch_error=missing_params`);

  try {
    // BUG-09: verify the HMAC-signed state — rejects tampered/forged/expired
    // state and a broadcaster-flow state replayed here.
    const stateData = verifyState(String(state), 'user');
    if (!stateData) return res.redirect(`${frontendUrl}?twitch_error=invalid_state`);
    const email: string = stateData.email;
    if (!email) return res.redirect(`${frontendUrl}?twitch_error=invalid_state`);

    const clientId = process.env.TWITCH_CLIENT_ID || '';
    const clientSecret = process.env.TWITCH_CLIENT_SECRET || '';
    if (!clientSecret) return res.redirect(`${frontendUrl}?twitch_error=client_secret_not_configured`);

    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: String(code),
        grant_type: 'authorization_code',
        redirect_uri: getRedirectUri(req),
      }),
    });

    if (!tokenRes.ok) {
      logger.error('Twitch token exchange failed', await tokenRes.text());
      return res.redirect(`${frontendUrl}?twitch_error=token_exchange_failed`);
    }

    const tokenData: any = await tokenRes.json();
    const accessToken: string = tokenData.access_token;
    const refreshToken: string = tokenData.refresh_token;
    // BUG-07: a valid authorization_code response MUST carry both tokens. A
    // missing/empty refresh is a malformed exchange — do NOT overwrite the
    // stored pair with a half-set (NULL refresh) state.
    if (typeof accessToken !== 'string' || !accessToken || typeof refreshToken !== 'string' || !refreshToken) {
      logger.error('Twitch token exchange returned incomplete tokens');
      return res.redirect(`${frontendUrl}?twitch_error=incomplete_tokens`);
    }

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return res.redirect(`${frontendUrl}?twitch_error=user_fetch_failed`);

    const userData: any = await userRes.json();
    const twitchUser = userData.data?.[0];
    if (!twitchUser) return res.redirect(`${frontendUrl}?twitch_error=no_user_data`);

    const oauthToken = `oauth:${accessToken}`;
    // BUG-08: require exactly one row updated — 0 means the account vanished
    // between exchange and write; treat as failure rather than silent success.
    const upd = await db.query('UPDATE users SET twitch_username=$1, twitch_oauth=$2, twitch_refresh=$3 WHERE email=$4',
      [twitchUser.login, oauthToken, refreshToken, email]);
    if (upd.rowCount !== 1) {
      logger.error(`Twitch OAuth: user row not updated (rowCount=${upd.rowCount}) for ${email}`);
      return res.redirect(`${frontendUrl}?twitch_error=account_not_found`);
    }
    clearUserReauth(email);

    logger.info(`Twitch OAuth connected: ${twitchUser.login} for ${email}`);

    const tm = (global as any).twitchManager;
    if (tm) {
      await tm.ensureUserConnection(email, twitchUser.login, oauthToken).catch(() => {});
      await tm.forceRejoinUserChannels(email).catch(() => {});
    }
    // Re-subscribe EventSub now that a (possibly newly-scoped) token exists
    const es = (global as any).eventSubManager;
    if (es) es.refresh().catch(() => {});

    res.redirect(`${frontendUrl}?twitch_connected=1&twitch_login=${encodeURIComponent(twitchUser.login)}`);
  } catch (err) {
    logger.error('Twitch OAuth callback error', err);
    res.redirect(`${frontendUrl}?twitch_error=callback_failed`);
  }
});

// ── Broadcaster connect (no site account required) ───────────────────────────

twitchOAuthRouter.get('/broadcaster-connect', (req: Request, res: Response) => {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'TWITCH_CLIENT_ID not set' });

  const state = signState({ flow: 'broadcaster' });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getBroadcasterRedirectUri(req),
    response_type: 'code',
    scope: BROADCASTER_SCOPES,
    state,
    force_verify: 'true',
  });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

twitchOAuthRouter.get('/broadcaster-callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;
  const frontendUrl = getFrontendUrl();

  if (error) return res.redirect(`${frontendUrl}/broadcaster?error=${encodeURIComponent(String(error))}`);
  if (!code) return res.redirect(`${frontendUrl}/broadcaster?error=missing_code`);
  // BUG-09: the broadcaster callback previously ignored state entirely.
  if (!state || !verifyState(String(state), 'broadcaster')) {
    return res.redirect(`${frontendUrl}/broadcaster?error=invalid_state`);
  }

  try {
    const clientId = process.env.TWITCH_CLIENT_ID || '';
    const clientSecret = process.env.TWITCH_CLIENT_SECRET || '';
    if (!clientSecret) return res.redirect(`${frontendUrl}/broadcaster?error=not_configured`);

    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: String(code),
        grant_type: 'authorization_code',
        redirect_uri: getBroadcasterRedirectUri(req),
      }),
    });

    if (!tokenRes.ok) {
      logger.error('Broadcaster token exchange failed', await tokenRes.text());
      return res.redirect(`${frontendUrl}/broadcaster?error=token_exchange_failed`);
    }

    const tokenData: any = await tokenRes.json();
    const accessToken: string = tokenData.access_token;
    const refreshToken: string = tokenData.refresh_token;
    // BUG-07: both tokens required; don't persist a NULL-refresh broadcaster row.
    if (typeof accessToken !== 'string' || !accessToken || typeof refreshToken !== 'string' || !refreshToken) {
      logger.error('Broadcaster token exchange returned incomplete tokens');
      return res.redirect(`${frontendUrl}/broadcaster?error=incomplete_tokens`);
    }

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return res.redirect(`${frontendUrl}/broadcaster?error=user_fetch_failed`);

    const userData: any = await userRes.json();
    const twitchUser = userData.data?.[0];
    if (!twitchUser) return res.redirect(`${frontendUrl}/broadcaster?error=no_user_data`);

    // BUG-08: confirm the upsert actually wrote a row via RETURNING.
    const up = await db.query(`
      INSERT INTO broadcaster_tokens (twitch_login, twitch_id, access_token, refresh_token, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (twitch_login) DO UPDATE SET access_token=$3, refresh_token=$4, twitch_id=$2, updated_at=NOW()
      RETURNING twitch_login
    `, [twitchUser.login, twitchUser.id, accessToken, refreshToken]);
    if (up.rowCount !== 1) {
      logger.error(`Broadcaster OAuth: upsert wrote ${up.rowCount} rows for ${twitchUser.login}`);
      return res.redirect(`${frontendUrl}/broadcaster?error=persist_failed`);
    }
    clearBroadcasterReauth(twitchUser.login);

    logger.info(`Broadcaster OAuth connected: ${twitchUser.login}`);
    res.redirect(`${frontendUrl}/broadcaster?success=1&login=${encodeURIComponent(twitchUser.login)}`);
  } catch (err) {
    logger.error('Broadcaster OAuth callback error', err);
    res.redirect(`${frontendUrl}/broadcaster?error=callback_failed`);
  }
});
