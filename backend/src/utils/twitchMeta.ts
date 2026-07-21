import { db } from '../database/db';
import { refreshUserToken, refreshBroadcasterToken } from '../twitch/twitchToken';

/**
 * Fetch a channel's moderator list from Helix ("Get Moderators" needs the
 * broadcaster's token; the channel owner's user token also works when they ARE
 * the broadcaster). Shared by admin + analytics so both get the same 401 →
 * refresh → retry-once behavior (BUG-06) instead of failing on an expired
 * access while a perfectly good refresh token sits in the same row.
 */
export async function fetchChannelModerators(
  channel: string,
  ownerEmail: string | null,
  broadcasterId: string,
): Promise<{ mods: any[]; error: string | null }> {
  const clientId = process.env.TWITCH_CLIENT_ID || '';

  // Resolve the token + remember its source so a 401 refreshes the right one.
  let token = '';
  let source: 'broadcaster' | 'user' | null = null;
  const { rows: bt } = await db.query(
    'SELECT access_token FROM broadcaster_tokens WHERE twitch_login=$1', [channel]
  );
  if (bt[0]?.access_token) {
    token = bt[0].access_token;
    source = 'broadcaster';
  } else if (ownerEmail) {
    const { rows: u } = await db.query('SELECT twitch_oauth FROM users WHERE email=$1', [ownerEmail]);
    const raw = u[0]?.twitch_oauth || '';
    if (raw) { token = String(raw).replace(/^oauth:/, ''); source = 'user'; }
  }
  if (!token || !source) return { mods: [], error: 'no token available' };

  let headers: Record<string, string> = { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` };
  const mods: any[] = [];
  let cursor: string | null = null;
  let refreshed = false;
  do {
    const url = `https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${broadcasterId}&first=100${cursor ? `&after=${cursor}` : ''}`;
    let r = await fetch(url, { headers });
    if (r.status === 401 && !refreshed) {
      // Confirmed-expired access → one refresh of the matching credentials,
      // then retry the same page exactly once. 403 (scopes) must NOT refresh.
      refreshed = true;
      const fresh = source === 'broadcaster'
        ? await refreshBroadcasterToken(channel)
        : await refreshUserToken(ownerEmail);
      if (fresh) {
        headers = { 'Client-Id': clientId, 'Authorization': `Bearer ${fresh}` };
        r = await fetch(url, { headers });
      }
    }
    if (!r.ok) {
      const errBody: any = await r.json().catch(() => ({}));
      return { mods, error: `Twitch API ${r.status}: ${errBody?.message || r.statusText}` };
    }
    const d: any = await r.json();
    mods.push(...(d.data || []));
    cursor = d.pagination?.cursor || null;
  } while (cursor);
  return { mods, error: null };
}

/**
 * Backfill missing Twitch avatars for a list of logins: looks them up on Helix
 * with any valid user token and caches into twitch_user_meta. Returns a map
 * login -> { avatar, display_name }. Never throws.
 */
export async function backfillAvatars(logins: string[]): Promise<Record<string, { avatar: string | null; display_name: string | null }>> {
  const out: Record<string, { avatar: string | null; display_name: string | null }> = {};
  const wanted = [...new Set(logins.map(l => (l || '').toLowerCase()).filter(l => l && !l.includes('@')))];
  if (wanted.length === 0) return out;
  try {
    const clientId = process.env.TWITCH_CLIENT_ID || '';
    const { rows: tokenRows } = await db.query(
      "SELECT twitch_oauth FROM users WHERE twitch_oauth IS NOT NULL LIMIT 5"
    );
    const tokens = tokenRows.map((r: any) => String(r.twitch_oauth).replace(/^oauth:/, ''));
    for (let i = 0; i < wanted.length; i += 100) {
      const batch = wanted.slice(i, i + 100);
      const q = batch.map(l => `login=${encodeURIComponent(l)}`).join('&');
      for (const tok of tokens) {
        const r = await fetch(`https://api.twitch.tv/helix/users?${q}`, {
          headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${tok}` },
        });
        if (!r.ok) continue;
        const d: any = await r.json();
        for (const u of (d.data || [])) {
          out[u.login] = { avatar: u.profile_image_url, display_name: u.display_name };
          await db.query(
            `INSERT INTO twitch_user_meta (username, twitch_id, display_name, profile_image_url, fetched_at)
             VALUES ($1,$2,$3,$4,NOW())
             ON CONFLICT (username) DO UPDATE SET twitch_id=$2, display_name=$3, profile_image_url=$4, fetched_at=NOW()`,
            [u.login, u.id, u.display_name, u.profile_image_url]
          ).catch(() => {});
        }
        break; // batch done with a working token
      }
    }
  } catch {}
  return out;
}
