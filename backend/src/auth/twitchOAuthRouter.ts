import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { authenticate } from './authMiddleware';
import { logger } from '../utils/logger';

export const twitchOAuthRouter = Router();

const SCOPES = [
  'channel:read:moderators',
  'channel:moderate',
  'chat:edit',
  'chat:read',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'user:read:email',
].join(' ');

function getRedirectUri(req: Request): string {
  return process.env.TWITCH_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/twitch-oauth/callback`;
}

function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || 'https://afsyg.gay';
}

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

    res.redirect(`${frontendUrl}?twitch_connected=1&twitch_login=${encodeURIComponent(twitchUser.login)}`);
  } catch (err) {
    logger.error('Twitch OAuth callback error', err);
    res.redirect(`${frontendUrl}?twitch_error=callback_failed`);
  }
});
