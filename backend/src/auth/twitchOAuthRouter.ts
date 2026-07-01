import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { authenticate } from './authMiddleware';
import { logger } from '../utils/logger';

export const twitchOAuthRouter = Router();

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

  const state = Buffer.from(JSON.stringify({ email: req.user!.email, ts: Date.now() })).toString('base64url');
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
    const stateData = JSON.parse(Buffer.from(String(state), 'base64url').toString());
    const email: string = stateData.email;
    if (!email || Date.now() - stateData.ts > 10 * 60 * 1000) {
      return res.redirect(`${frontendUrl}?twitch_error=state_expired`);
    }

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

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return res.redirect(`${frontendUrl}?twitch_error=user_fetch_failed`);

    const userData: any = await userRes.json();
    const twitchUser = userData.data?.[0];
    if (!twitchUser) return res.redirect(`${frontendUrl}?twitch_error=no_user_data`);

    const oauthToken = `oauth:${accessToken}`;
    await db.query('UPDATE users SET twitch_username=$1, twitch_oauth=$2 WHERE email=$3',
      [twitchUser.login, oauthToken, email]);

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

  const state = Buffer.from(JSON.stringify({ broadcaster: true, ts: Date.now() })).toString('base64url');
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
  const { code, error } = req.query;
  const frontendUrl = getFrontendUrl();

  if (error) return res.redirect(`${frontendUrl}/broadcaster?error=${encodeURIComponent(String(error))}`);
  if (!code) return res.redirect(`${frontendUrl}/broadcaster?error=missing_code`);

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

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return res.redirect(`${frontendUrl}/broadcaster?error=user_fetch_failed`);

    const userData: any = await userRes.json();
    const twitchUser = userData.data?.[0];
    if (!twitchUser) return res.redirect(`${frontendUrl}/broadcaster?error=no_user_data`);

    await db.query(`
      INSERT INTO broadcaster_tokens (twitch_login, twitch_id, access_token, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (twitch_login) DO UPDATE SET access_token=$3, twitch_id=$2, updated_at=NOW()
    `, [twitchUser.login, twitchUser.id, accessToken]);

    logger.info(`Broadcaster OAuth connected: ${twitchUser.login}`);
    res.redirect(`${frontendUrl}/broadcaster?success=1&login=${encodeURIComponent(twitchUser.login)}`);
  } catch (err) {
    logger.error('Broadcaster OAuth callback error', err);
    res.redirect(`${frontendUrl}/broadcaster?error=callback_failed`);
  }
});
