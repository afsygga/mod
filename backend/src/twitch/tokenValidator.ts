import { db } from '../database/db';
import { logger } from '../utils/logger';
import { refreshUserToken, refreshBroadcasterToken, validateAccessToken } from './twitchToken';

/**
 * Hourly OAuth session validator (BUG-12). Twitch requires third-party apps to
 * validate their tokens on startup and at least hourly. This sweep covers ALL
 * stored sessions — user tokens (even those not used by EventSub/IRC right
 * now) and broadcaster tokens (which previously had no validation at all):
 *
 *  - valid        → stamp last_validated
 *  - confirmed 401 → one reactive refresh (the refresh path itself marks the
 *                    row reauthorization_required if the grant is dead)
 *  - temporary    → leave the pair untouched, retry next sweep
 *
 * Rows already flagged reauthorization_required/disconnected are skipped —
 * only a fresh OAuth callback can revive them.
 */

const INTERVAL_MS = 60 * 60_000;
const STARTUP_DELAY_MS = 45_000;

async function validateAll(): Promise<void> {
  let usersChecked = 0;
  let broadcastersChecked = 0;

  const { rows: users } = await db.query(
    `SELECT email, twitch_oauth FROM users
     WHERE twitch_oauth IS NOT NULL
       AND COALESCE(twitch_auth_status, 'active') = 'active'`
  );
  for (const u of users) {
    const raw = String(u.twitch_oauth).replace(/^oauth:/, '');
    const v = await validateAccessToken(raw);
    usersChecked++;
    if (v === 'valid') {
      await db.query('UPDATE users SET twitch_last_validated=NOW() WHERE email=$1', [u.email]).catch(() => {});
    } else if (v === 'invalid_401') {
      await refreshUserToken(u.email); // handles reauth marking on dead grants
    }
    // temporary → nothing; next sweep retries
  }

  const { rows: bts } = await db.query(
    `SELECT twitch_login, access_token FROM broadcaster_tokens
     WHERE access_token IS NOT NULL
       AND COALESCE(auth_status, 'active') = 'active'`
  );
  for (const b of bts) {
    const v = await validateAccessToken(b.access_token);
    broadcastersChecked++;
    if (v === 'valid') {
      await db.query('UPDATE broadcaster_tokens SET last_validated=NOW() WHERE twitch_login=$1', [b.twitch_login]).catch(() => {});
    } else if (v === 'invalid_401') {
      await refreshBroadcasterToken(b.twitch_login);
    }
  }

  logger.info(`[validator] hourly sweep: ${usersChecked} user + ${broadcastersChecked} broadcaster session(s) checked`);
}

let started = false;

export function startTokenValidator(): void {
  if (started) return;
  started = true;
  const run = () => validateAll().catch(err => logger.error('[validator] sweep failed', err));
  // Startup validation (delayed past migrations/connection restore), then hourly.
  setTimeout(run, STARTUP_DELAY_MS);
  setInterval(run, INTERVAL_MS);
  logger.info('[validator] hourly token validator scheduled');
}
