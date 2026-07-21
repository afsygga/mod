import { db } from '../database/db';
import { logger } from './logger';

const PUNITIVE = new Set(['MUTED', 'AUTO_MUTED', 'BANNED']);
// Actions that can be logged twice (site action + EventSub echo of the same event)
const ECHO_DEDUP = new Set(['MUTED', 'AUTO_MUTED', 'BANNED', 'UNBANNED']);

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
 * Dedup rules:
 *  - Punitive double-action: a MUTED/AUTO_MUTED/BANNED on a target that already
 *    got a punitive action within the last 5s counts ONCE. Covers "a mod muted
 *    someone, then the same person is muted/banned again seconds later" (another
 *    mod, escalation, or the EventSub echo).
 *  - Echo: the exact same mute/ban/unban logged within 15s (site action + its
 *    EventSub echo of the same event). FLAGGED (message deletes) is never
 *    deduped — each deleted message is a distinct event.
 */
export async function logModerationAction(e: ModLogEntry): Promise<boolean> {
  try {
    if (PUNITIVE.has(e.action)) {
      const { rows } = await db.query(
        `SELECT 1 FROM moderation_logs
         WHERE channel_name=$1 AND LOWER(username)=LOWER($2)
           AND action IN ('MUTED','AUTO_MUTED','BANNED')
           AND created_at > NOW() - INTERVAL '5 seconds' LIMIT 1`,
        [e.channel, e.username]
      );
      if (rows.length > 0) return false;
    }
    if (ECHO_DEDUP.has(e.action)) {
      const { rows } = await db.query(
        `SELECT 1 FROM moderation_logs
         WHERE channel_name=$1 AND LOWER(username)=LOWER($2) AND action=$3
           AND created_at > NOW() - INTERVAL '15 seconds' LIMIT 1`,
        [e.channel, e.username, e.action]
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
