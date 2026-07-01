import { db } from '../database/db';
import { logger } from '../utils/logger';

/**
 * Twitch user access tokens expire (~4h). We store the refresh_token and use it
 * to mint a fresh access token when a Helix call returns 401. These helpers
 * refresh + persist the new tokens and return the raw access token.
 */

async function doRefresh(refreshToken: string): Promise<{ access: string; refresh: string } | null> {
  const clientId = process.env.TWITCH_CLIENT_ID || '';
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || '';
  if (!clientId || !clientSecret || !refreshToken) return null;
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      logger.warn(`[token] refresh failed ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }
    const d: any = await res.json();
    return { access: d.access_token, refresh: d.refresh_token || refreshToken };
  } catch (err: any) {
    logger.error('[token] refresh threw', err?.message || err);
    return null;
  }
}

/** Refresh a site user's Twitch token by email. Returns the new raw access token. */
export async function refreshUserToken(email: string | null): Promise<string | null> {
  if (!email) return null;
  const { rows } = await db.query('SELECT twitch_refresh FROM users WHERE email=$1', [email]);
  const refresh = rows[0]?.twitch_refresh;
  if (!refresh) return null;
  const r = await doRefresh(refresh);
  if (!r) return null;
  await db.query('UPDATE users SET twitch_oauth=$1, twitch_refresh=$2 WHERE email=$3',
    [`oauth:${r.access}`, r.refresh, email]).catch(() => {});
  logger.info(`[token] refreshed user token for ${email}`);
  return r.access;
}

/** Refresh a broadcaster token by twitch login. Returns the new raw access token. */
export async function refreshBroadcasterToken(login: string): Promise<string | null> {
  const { rows } = await db.query('SELECT refresh_token FROM broadcaster_tokens WHERE twitch_login=$1', [login]);
  const refresh = rows[0]?.refresh_token;
  if (!refresh) return null;
  const r = await doRefresh(refresh);
  if (!r) return null;
  await db.query('UPDATE broadcaster_tokens SET access_token=$1, refresh_token=$2, updated_at=NOW() WHERE twitch_login=$3',
    [r.access, r.refresh, login]).catch(() => {});
  logger.info(`[token] refreshed broadcaster token for ${login}`);
  return r.access;
}
