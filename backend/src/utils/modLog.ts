import { db } from '../database/db';
import { logger } from './logger';

const PUNITIVE = new Set(['MUTED', 'AUTO_MUTED', 'BANNED']);

export interface ModLogEntry {
  channel: string;
  username: string;       // target
  action: string;         // MUTED | AUTO_MUTED | BANNED | UNBANNED | FLAGGED
  performedBy: string;
  durationSeconds?: number | null;
  message?: string | null;
}

/**
 * Insert a moderation action into moderation_logs with deduplication.
 * Returns true if the row was inserted, false if skipped as a duplicate — so
 * callers know whether to also bump counters / broadcast (skipped = not counted
 * anywhere, per product rule).
 *
 * Rule: a mute/ban of a user who is ALREADY under an active punishment doesn't
 * count. "Already punished" means the previous timeout hasn't expired yet
 * (created_at + its duration is still in the future) or the user is banned and
 * hasn't been unbanned since. So if one mod mutes someone and another mod
 * mutes/bans the same person 5 seconds — or a minute — later while the first
 * timeout is still running, only the first counts. Once the timeout expires (or
 * an unban happens), a fresh mute counts again. This also absorbs the EventSub
 * echo of a site action. UNBANNED is de-duped only against its own echo (15s);
 * FLAGGED (message deletes) is never de-duped — each delete is a distinct event.
 */
export async function logModerationAction(e: ModLogEntry): Promise<boolean> {
  try {
    if (PUNITIVE.has(e.action)) {
      const { rows } = await db.query(
        `SELECT action, duration_seconds,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS age_sec
         FROM moderation_logs
         WHERE channel_name=$1 AND LOWER(username)=LOWER($2)
           AND action IN ('MUTED','AUTO_MUTED','BANNED','UNBANNED')
         ORDER BY created_at DESC LIMIT 1`,
        [e.channel, e.username]
      );
      const last = rows[0];
      if (last && last.action !== 'UNBANNED') {
        let active: boolean;
        if (last.action === 'BANNED') {
          active = true; // banned until an explicit unban
        } else {
          // timeout still running? fall back to 60s if duration is unknown
          const dur = Number(last.duration_seconds) || 60;
          active = Number(last.age_sec) < dur;
        }
        if (active) return false; // already punished — this repeat doesn't count
      }
    } else if (e.action === 'UNBANNED') {
      // echo of a site unban (site action + EventSub notification of the same)
      const { rows } = await db.query(
        `SELECT 1 FROM moderation_logs
         WHERE channel_name=$1 AND LOWER(username)=LOWER($2) AND action='UNBANNED'
           AND created_at > NOW() - INTERVAL '15 seconds' LIMIT 1`,
        [e.channel, e.username]
      );
      if (rows.length > 0) return false;
    }
  } catch (err: any) {
    // On a dedup-check failure, prefer logging the action over losing it.
    logger.warn(`[modlog] dedup check failed: ${err?.message || err}`);
  }

  try {
    await db.query(
      'INSERT INTO moderation_logs (channel_name, username, action, performed_by, duration_seconds, message) VALUES ($1,$2,$3,$4,$5,$6)',
      [e.channel, e.username, e.action, e.performedBy, e.durationSeconds ?? null, e.message ?? null]
    );
    return true;
  } catch (err: any) {
    logger.error(`[modlog] insert failed: ${err?.message || err}`);
    return false;
  }
}
