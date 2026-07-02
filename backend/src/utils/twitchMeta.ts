import { db } from '../database/db';

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
