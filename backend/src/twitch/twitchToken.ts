import { db } from '../database/db';
import { logger } from '../utils/logger';

/**
 * Twitch user access tokens expire (~4h). We store the refresh_token and use it
 * to mint a fresh access token when a Helix/IRC call returns 401. These helpers
 * refresh + persist the new pair and return the raw access token.
 *
 * Correctness rules (see TWITCH_OAUTH_BUG_REPORT):
 *  - Twitch rotates the refresh_token on every use; the NEW pair is only valid
 *    once it is durably written. A refresh is "successful" ONLY after an
 *    UPDATE that affected exactly one row — otherwise we discard the access,
 *    do NOT set the cooldown and do NOT log success (BUG-03/04/08).
 *  - The persist is a compare-and-swap: `WHERE ... AND refresh = $old`. If an
 *    OAuth callback, manual PUT, DELETE or another refresh changed the pair
 *    while our HTTP call was in flight, rowCount is 0 and the stale result is
 *    discarded instead of overwriting the newer authorization (BUG-05).
 *  - The token response is validated before we touch the DB: access_token and
 *    refresh_token must both be non-empty strings (BUG-14).
 *  - A confirmed invalid refresh (400/401) is permanent — it marks the row
 *    `reauthorization_required` in the DB (survives restarts, powers the UI
 *    "reconnect Twitch" signal) and stops background refresh spam until the
 *    user re-authorizes; temporary failures (429/5xx/network) keep the pair
 *    intact and allow a later retry (BUG-13).
 *  - Refreshes are single-flight per account with a 60s cooldown to avoid
 *    concurrent reuse of an already-rotated refresh token (reuse detection).
 */

const inFlight = new Map<string, Promise<string | null>>();
const lastRefreshAt = new Map<string, number>();
const REFRESH_COOLDOWN_MS = 60_000;

type RefreshResult =
  | { ok: true; access: string; refresh: string }
  | { ok: false; kind: 'invalid' | 'temporary' };

/** Validate a raw access token, distinguishing invalid from transient errors. */
export async function validateAccessToken(rawToken: string): Promise<'valid' | 'invalid_401' | 'temporary'> {
  try {
    const r = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${rawToken}` },
    });
    if (r.ok) return 'valid';
    if (r.status === 401) return 'invalid_401';
    return 'temporary';
  } catch { return 'temporary'; }
}

async function doRefresh(refreshToken: string): Promise<RefreshResult> {
  const clientId = process.env.TWITCH_CLIENT_ID || '';
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || '';
  if (!clientId || !clientSecret || !refreshToken) return { ok: false, kind: 'temporary' };
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
      // 400/401 = the refresh token itself is bad → permanent, needs re-auth.
      // 429/5xx = Twitch transient → keep the pair, retry later.
      const kind: 'invalid' | 'temporary' = (res.status === 400 || res.status === 401) ? 'invalid' : 'temporary';
      logger.warn(`[token] refresh failed ${res.status} (${kind})`);
      return { ok: false, kind };
    }
    const d: any = await res.json().catch(() => null);
    // BUG-14: validate the response before trusting it. Twitch always returns a
    // (rotated) refresh_token on the refresh grant; its absence is malformed.
    if (!d || typeof d.access_token !== 'string' || d.access_token.length === 0 ||
        typeof d.refresh_token !== 'string' || d.refresh_token.length === 0) {
      logger.error('[token] refresh response malformed (missing/empty tokens)');
      return { ok: false, kind: 'temporary' };
    }
    return { ok: true, access: d.access_token, refresh: d.refresh_token };
  } catch (err: any) {
    logger.error('[token] refresh threw', err?.message || err);
    return { ok: false, kind: 'temporary' };
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
  const key = `u:${email}`;
  return singleFlight(key, async () => {
    // A concurrent caller refreshed successfully moments ago — hand back the
    // already-stored fresh token instead of burning another refresh. The
    // cooldown is only ever set after a CONFIRMED persist (below), so this
    // can never serve an unsaved token.
    if (Date.now() - (lastRefreshAt.get(key) || 0) < REFRESH_COOLDOWN_MS) {
      const { rows } = await db.query('SELECT twitch_oauth FROM users WHERE email=$1', [email]);
      const t = rows[0]?.twitch_oauth;
      return t ? String(t).replace(/^oauth:/, '') : null;
    }

    const { rows } = await db.query(
      'SELECT twitch_refresh, twitch_auth_status FROM users WHERE email=$1', [email]
    );
    const refresh = rows[0]?.twitch_refresh;
    if (!refresh) return null;
    // Don't hammer a grant we already know is dead — wait for re-auth (BUG-13).
    if (rows[0]?.twitch_auth_status === 'reauthorization_required') return null;

    const r = await doRefresh(refresh);
    if (!r.ok) {
      if (r.kind === 'invalid') {
        await db.query(
          "UPDATE users SET twitch_auth_status='reauthorization_required' WHERE email=$1", [email]
        ).catch(() => {});
        logger.warn(`[token] user ${email}: refresh token invalid — reauthorization required`);
      }
      return null; // temporary: no cooldown, caller may retry later
    }

    // Persist the NEW pair via CAS on the old refresh token (BUG-05): a newer
    // OAuth callback / manual PUT / DELETE that changed the pair mid-flight
    // makes rowCount 0 and this stale result is discarded.
    let rowCount: number | null = null;
    try {
      const upd = await db.query(
        `UPDATE users SET twitch_oauth=$1, twitch_refresh=$2,
                          twitch_auth_status='active', twitch_last_validated=NOW()
         WHERE email=$3 AND twitch_refresh=$4`,
        [`oauth:${r.access}`, r.refresh, email, refresh]
      );
      rowCount = upd.rowCount;
    } catch (e: any) {
      logger.error(`[token] user ${email}: refresh persist FAILED (${e?.message || e}) — discarding new token`);
      return null;
    }
    if (rowCount !== 1) {
      logger.warn(`[token] user ${email}: credentials changed concurrently (rowCount=${rowCount}) — discarding stale refresh result`);
      return null;
    }
    lastRefreshAt.set(key, Date.now());
    logger.info(`[token] refreshed user token for ${email}`);
    return r.access;
  });
}

/** Refresh a broadcaster token by twitch login. Returns the new raw access token. */
export async function refreshBroadcasterToken(login: string): Promise<string | null> {
  const key = `b:${login.toLowerCase()}`;
  return singleFlight(key, async () => {
    if (Date.now() - (lastRefreshAt.get(key) || 0) < REFRESH_COOLDOWN_MS) {
      const { rows } = await db.query('SELECT access_token FROM broadcaster_tokens WHERE twitch_login=$1', [login]);
      return rows[0]?.access_token || null;
    }

    const { rows } = await db.query(
      'SELECT refresh_token, auth_status FROM broadcaster_tokens WHERE twitch_login=$1', [login]
    );
    const refresh = rows[0]?.refresh_token;
    if (!refresh) return null;
    if (rows[0]?.auth_status === 'reauthorization_required') return null;

    const r = await doRefresh(refresh);
    if (!r.ok) {
      if (r.kind === 'invalid') {
        await db.query(
          "UPDATE broadcaster_tokens SET auth_status='reauthorization_required' WHERE twitch_login=$1", [login]
        ).catch(() => {});
        logger.warn(`[token] broadcaster ${login}: refresh token invalid — reauthorization required`);
      }
      return null;
    }

    let rowCount: number | null = null;
    try {
      const upd = await db.query(
        `UPDATE broadcaster_tokens SET access_token=$1, refresh_token=$2,
                                       auth_status='active', last_validated=NOW(), updated_at=NOW()
         WHERE twitch_login=$3 AND refresh_token=$4`,
        [r.access, r.refresh, login, refresh]
      );
      rowCount = upd.rowCount;
    } catch (e: any) {
      logger.error(`[token] broadcaster ${login}: refresh persist FAILED (${e?.message || e}) — discarding new token`);
      return null;
    }
    if (rowCount !== 1) {
      logger.warn(`[token] broadcaster ${login}: credentials changed concurrently (rowCount=${rowCount}) — discarding stale refresh result`);
      return null;
    }
    lastRefreshAt.set(key, Date.now());
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
