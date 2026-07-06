import { db } from '../database/db';
import { logger } from '../utils/logger';

/**
 * Twitch user access tokens expire (~4h). We store the refresh_token and use it
 * to mint a fresh access token when a Helix call returns 401. These helpers
 * refresh + persist the new tokens and return the raw access token.
 *
 * Refreshes are single-flight per account: EventSub reconcile, the stream
 * poller and mute/ban 401-retries all hit the refresh at the same moment the
 * token expires. Twitch rotates the refresh token on every use, and a
 * concurrent second request with the already-used refresh token trips reuse
 * detection — Twitch may revoke the whole grant, killing the account's tokens
 * until the user re-authorizes. Serializing the calls eliminates that race.
 */

const inFlight = new Map<string, Promise<string | null>>();
const lastRefreshAt = new Map<string, number>();
const REFRESH_COOLDOWN_MS = 60_000;

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

function singleFlight(key: string, refresh: () => Promise<string | null>): Promise<string | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = refresh().finally(() => { inFlight.delete(key); });
  inFlight.set(key, p);
  return p;
}

/** Refresh a site user's Twitch token by email. Returns the new raw access token. */
export async function refreshUserToken(email: string | null): Promise<string | null> {
  if (!email) return null;
  return singleFlight(`u:${email}`, async () => {
    // A concurrent caller refreshed moments ago (its 401 was with the old
    // token) — hand back the already-stored fresh token instead of burning
    // another refresh.
    if (Date.now() - (lastRefreshAt.get(`u:${email}`) || 0) < REFRESH_COOLDOWN_MS) {
      const { rows } = await db.query('SELECT twitch_oauth FROM users WHERE email=$1', [email]);
      const t = rows[0]?.twitch_oauth;
      return t ? String(t).replace(/^oauth:/, '') : null;
    }
    const { rows } = await db.query('SELECT twitch_refresh FROM users WHERE email=$1', [email]);
    const refresh = rows[0]?.twitch_refresh;
    if (!refresh) return null;
    const r = await doRefresh(refresh);
    if (!r) return null;
    await db.query('UPDATE users SET twitch_oauth=$1, twitch_refresh=$2 WHERE email=$3',
      [`oauth:${r.access}`, r.refresh, email]).catch(() => {});
    lastRefreshAt.set(`u:${email}`, Date.now());
    logger.info(`[token] refreshed user token for ${email}`);
    return r.access;
  });
}

/** Refresh a broadcaster token by twitch login. Returns the new raw access token. */
export async function refreshBroadcasterToken(login: string): Promise<string | null> {
  return singleFlight(`b:${login}`, async () => {
    if (Date.now() - (lastRefreshAt.get(`b:${login}`) || 0) < REFRESH_COOLDOWN_MS) {
      const { rows } = await db.query('SELECT access_token FROM broadcaster_tokens WHERE twitch_login=$1', [login]);
      return rows[0]?.access_token || null;
    }
    const { rows } = await db.query('SELECT refresh_token FROM broadcaster_tokens WHERE twitch_login=$1', [login]);
    const refresh = rows[0]?.refresh_token;
    if (!refresh) return null;
    const r = await doRefresh(refresh);
    if (!r) return null;
    await db.query('UPDATE broadcaster_tokens SET access_token=$1, refresh_token=$2, updated_at=NOW() WHERE twitch_login=$3',
      [r.access, r.refresh, login]).catch(() => {});
    lastRefreshAt.set(`b:${login}`, Date.now());
    logger.info(`[token] refreshed broadcaster token for ${login}`);
    return r.access;
  });
}

/**
 * App access token (client credentials). Works for public Helix endpoints
 * like /streams and /users, is mintable at any time from client id+secret and
 * can never be permanently lost — the last-resort candidate that keeps stream
 * tracking alive even when every user token is dead.
 */
let appToken: { token: string; expiresAt: number } | null = null;

export async function getAppToken(): Promise<string | null> {
  if (appToken && Date.now() < appToken.expiresAt - 60_000) return appToken.token;
  return singleFlight('app', async () => {
    if (appToken && Date.now() < appToken.expiresAt - 60_000) return appToken.token;
    const clientId = process.env.TWITCH_CLIENT_ID || '';
    const clientSecret = process.env.TWITCH_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) return null;
    try {
      const res = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials',
        }),
      });
      if (!res.ok) {
        logger.warn(`[token] app token failed ${res.status}: ${await res.text().catch(() => '')}`);
        return null;
      }
      const d: any = await res.json();
      appToken = { token: d.access_token, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 };
      logger.info('[token] app access token minted');
      return appToken.token;
    } catch (err: any) {
      logger.error('[token] app token threw', err?.message || err);
      return null;
    }
  });
}
