import { db } from '../database/db';
import { logger } from '../utils/logger';
import { refreshFollowerToken } from './twitchToken';
import { jobStart, jobEnd } from '../utils/metrics';

/**
 * Follow dates for Chatterino usercards (aFserinno).
 *
 * Twitch hands out "when did user Y follow channel X" only to X's broadcaster
 * or moderators (Helix `channels/followers` + `moderator:read:followers`).
 * Moderators share that right once on /followers; their token lands in
 * `follower_tokens`, the channels it can answer for in `follower_channels`
 * (refreshed hourly from `moderation/channels` + the mod's own channel), and
 * every answer is cached for a day in `followage_cache`.
 *
 * Token rules are the ones from twitchToken.ts (§8 in AGENTS.md): a 401 gets
 * exactly one refresh + retry, a 403 means the token lost its rights in that
 * channel — the (channel, token) pair is dropped and the next token is tried.
 */

const CACHE_TTL_MS = 24 * 60 * 60_000;
const SYNC_INTERVAL_MS = 60 * 60_000;
const SYNC_STARTUP_DELAY_MS = 60_000;

export interface FollowageResult {
  /** a token with rights in this channel exists */
  available: boolean;
  /** ISO date, null = does not follow (only meaningful when available) */
  followedAt: string | null;
  /** when Twitch was last asked */
  checkedAt: string | null;
}

function helixHeaders(token: string): Record<string, string> {
  return { 'Client-Id': process.env.TWITCH_CLIENT_ID || '', 'Authorization': `Bearer ${token}` };
}

/**
 * Rebuild the channel list one shared token can answer for: every channel the
 * user moderates plus their own. Replaces the token's rows atomically enough
 * for our purposes (delete + insert in one transaction).
 */
export async function syncFollowerChannels(login: string, accessToken: string, twitchId: string): Promise<number> {
  const channels: { id: string; login: string }[] = [{ id: twitchId, login }];
  let cursor: string | null = null;
  do {
    const url = `https://api.twitch.tv/helix/moderation/channels?user_id=${twitchId}&first=100${cursor ? `&after=${cursor}` : ''}`;
    const r = await fetch(url, { headers: helixHeaders(accessToken) });
    if (!r.ok) {
      const body: any = await r.json().catch(() => ({}));
      throw new Error(`moderation/channels ${r.status}: ${body?.message || r.statusText}`);
    }
    const d: any = await r.json();
    for (const c of d.data || []) {
      if (c.broadcaster_id && c.broadcaster_login) channels.push({ id: String(c.broadcaster_id), login: String(c.broadcaster_login) });
    }
    cursor = d.pagination?.cursor || null;
  } while (cursor);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM follower_channels WHERE token_login=$1', [login]);
    for (const c of channels) {
      await client.query(
        `INSERT INTO follower_channels (channel_id, channel_login, token_login, checked_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (channel_id, token_login) DO UPDATE SET channel_login=$2, checked_at=NOW()`,
        [c.id, c.login, login],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return channels.length;
}

/** Channels currently answerable (distinct), for the share page + diagnostics. */
export async function listFollowerChannels(): Promise<{ id: string; login: string; tokens: number }[]> {
  const { rows } = await db.query(
    `SELECT fc.channel_id AS id, MIN(fc.channel_login) AS login, COUNT(*)::int AS tokens
       FROM follower_channels fc
       JOIN follower_tokens ft ON ft.twitch_login = fc.token_login
      WHERE COALESCE(ft.auth_status, 'active') = 'active'
      GROUP BY fc.channel_id
      ORDER BY login`,
  );
  return rows;
}

async function askHelix(
  token: { login: string; access: string },
  channelId: string,
  userId: string,
): Promise<{ status: 'ok'; followedAt: string | null } | { status: 'forbidden' } | { status: 'error'; message: string }> {
  const url = `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${encodeURIComponent(channelId)}&user_id=${encodeURIComponent(userId)}`;
  let access = token.access;
  let r = await fetch(url, { headers: helixHeaders(access) });
  if (r.status === 401) {
    // expired access → one refresh, one retry (never on 403: that's rights, not expiry)
    const fresh = await refreshFollowerToken(token.login);
    if (!fresh) return { status: 'error', message: 'token refresh failed' };
    access = fresh;
    r = await fetch(url, { headers: helixHeaders(access) });
  }
  if (r.status === 401 || r.status === 403) return { status: 'forbidden' };
  if (!r.ok) {
    const body: any = await r.json().catch(() => ({}));
    return { status: 'error', message: `Twitch ${r.status}: ${body?.message || r.statusText}` };
  }
  const d: any = await r.json();
  const entry = d.data?.[0];
  return { status: 'ok', followedAt: entry?.followed_at ? String(entry.followed_at) : null };
}

/** The answer for one (channel, user), from cache or Twitch. Never throws. */
export async function lookupFollowage(channelId: string, userId: string): Promise<FollowageResult> {
  try {
    const { rows: cached } = await db.query(
      'SELECT followed_at, checked_at FROM followage_cache WHERE channel_id=$1 AND user_id=$2',
      [channelId, userId],
    );
    if (cached[0] && Date.now() - new Date(cached[0].checked_at).getTime() < CACHE_TTL_MS) {
      return {
        available: true,
        followedAt: cached[0].followed_at ? new Date(cached[0].followed_at).toISOString() : null,
        checkedAt: new Date(cached[0].checked_at).toISOString(),
      };
    }

    const { rows: tokens } = await db.query(
      `SELECT ft.twitch_login AS login, ft.access_token AS access
         FROM follower_channels fc
         JOIN follower_tokens ft ON ft.twitch_login = fc.token_login
        WHERE fc.channel_id=$1 AND COALESCE(ft.auth_status, 'active') = 'active'
        ORDER BY ft.last_validated DESC NULLS LAST`,
      [channelId],
    );
    if (tokens.length === 0) {
      // stale cache is still better than nothing when nobody can refresh it
      if (cached[0]) {
        return {
          available: true,
          followedAt: cached[0].followed_at ? new Date(cached[0].followed_at).toISOString() : null,
          checkedAt: new Date(cached[0].checked_at).toISOString(),
        };
      }
      return { available: false, followedAt: null, checkedAt: null };
    }

    for (const t of tokens) {
      const res = await askHelix(t, channelId, userId);
      if (res.status === 'ok') {
        await db.query(
          `INSERT INTO followage_cache (channel_id, user_id, followed_at, checked_at, source_login)
           VALUES ($1, $2, $3, NOW(), $4)
           ON CONFLICT (channel_id, user_id) DO UPDATE SET followed_at=$3, checked_at=NOW(), source_login=$4`,
          [channelId, userId, res.followedAt, t.login],
        ).catch((e) => logger.warn(`[followage] cache write failed: ${e?.message || e}`));
        return { available: true, followedAt: res.followedAt, checkedAt: new Date().toISOString() };
      }
      if (res.status === 'forbidden') {
        // lost mod in this channel (or the grant died) — forget the pair, try the next token
        logger.info(`[followage] ${t.login} has no rights in channel ${channelId} any more — dropping`);
        await db.query('DELETE FROM follower_channels WHERE channel_id=$1 AND token_login=$2', [channelId, t.login]).catch(() => {});
        continue;
      }
      logger.warn(`[followage] ${t.login} for channel ${channelId}: ${res.message}`);
    }
    return { available: false, followedAt: null, checkedAt: null };
  } catch (e: any) {
    logger.error(`[followage] lookup failed: ${e?.message || e}`);
    return { available: false, followedAt: null, checkedAt: null };
  }
}

async function syncAll(): Promise<void> {
  const { rows } = await db.query(
    `SELECT twitch_login, twitch_id, access_token FROM follower_tokens
      WHERE COALESCE(auth_status, 'active') = 'active'`,
  );
  let synced = 0;
  for (const t of rows) {
    try {
      await syncFollowerChannels(t.twitch_login, t.access_token, t.twitch_id);
      synced++;
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes('401')) {
        const fresh = await refreshFollowerToken(t.twitch_login);
        if (fresh) {
          try { await syncFollowerChannels(t.twitch_login, fresh, t.twitch_id); synced++; continue; } catch { /* logged below */ }
        }
      }
      logger.warn(`[followage] channel sync for ${t.twitch_login} failed: ${msg}`);
    }
  }
  logger.info(`[followage] channel lists synced for ${synced}/${rows.length} shared token(s)`);
}

let started = false;

/** Hourly refresh of who-moderates-where for every shared token. */
export function startFollowageSync(): void {
  if (started) return;
  started = true;
  const run = async () => {
    const startedAt = jobStart('followage_sync');
    try { await syncAll(); jobEnd('followage_sync', 'success', startedAt); }
    catch (err) { logger.error('[followage] sync failed', err); jobEnd('followage_sync', 'error', startedAt); }
  };
  setTimeout(run, SYNC_STARTUP_DELAY_MS);
  setInterval(run, SYNC_INTERVAL_MS);
  logger.info('[followage] hourly channel sync scheduled');
}
