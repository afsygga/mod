import { db } from '../database/db';
import { logger } from './logger';

const PUNITIVE = new Set(['MUTED', 'AUTO_MUTED', 'BANNED']);
// Пул действий, которые пилят одного юзера в течение одного инцидента
const PILE_ON_WINDOW_SEC = 5;

export interface ModLogEntry {
  channel: string;
  username: string;       // target
  action: string;         // MUTED | AUTO_MUTED | BANNED | UNBANNED | FLAGGED
  performedBy: string;
  durationSeconds?: number | null;
  message?: string | null;
}

/**
 * primary   — a normal, standalone log row (first action of an incident, or a
 *             fresh action after the previous one expired). Counts everywhere,
 *             shown in the log list, bumps the user's mute_count, broadcasts.
 * secondary — another mod piling on the SAME user within 5s of the primary. The
 *             row IS inserted (so the mod gets credit in per-moderator stats),
 *             but linked to the primary (primary_id) so it doesn't show as its
 *             own log line — it appears under the primary when expanded. No
 *             mute_count bump, no live broadcast.
 * skipped   — not counted at all: a repeat past the 5s window while the user is
 *             still muted/banned, or the echo of an unban.
 */
export type ModLogResult = 'primary' | 'secondary' | 'skipped';

async function insertRow(e: ModLogEntry, primaryId: number | null): Promise<number | null> {
  try {
    const { rows } = await db.query(
      `INSERT INTO moderation_logs (channel_name, username, action, performed_by, duration_seconds, message, primary_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [e.channel, e.username, e.action, e.performedBy, e.durationSeconds ?? null, e.message ?? null, primaryId]
    );
    return rows[0]?.id ?? null;
  } catch (err: any) {
    logger.error(`[modlog] insert failed: ${err?.message || err}`);
    return null;
  }
}

// Один и тот же нарушитель не должен считаться дважды у одного мода: сколько бы
// раз мод ни замутил того же юзера в рамках сессии, в статистике остаётся ОДНА
// строка — последняя. Повторный мут тем же модом обновляет её (время/длительность),
// а не плодит дубль. Pile-on разных модов при этом сохраняется (проверка по
// performed_by), см. §18.
const SAME_MOD_DEDUP_WINDOW = '6 hours';

export async function logModerationAction(e: ModLogEntry): Promise<ModLogResult> {
  if (e.action === 'MUTED' || e.action === 'AUTO_MUTED') {
    try {
      const { rows } = await db.query(
        `SELECT id FROM moderation_logs
         WHERE channel_name=$1 AND LOWER(username)=LOWER($2) AND performed_by=$3
           AND action IN ('MUTED','AUTO_MUTED')
           AND created_at > NOW() - INTERVAL '${SAME_MOD_DEDUP_WINDOW}'
         ORDER BY created_at DESC LIMIT 1`,
        [e.channel, e.username, e.performedBy]
      );
      if (rows[0]) {
        // Тот же мод уже мутил этого юзера — обновляем прошлую строку на последний
        // мут (без нового ряда, без инкремента mute_count) → нет дубликата.
        await db.query(
          `UPDATE moderation_logs
           SET action=$2, duration_seconds=$3, message=$4, created_at=NOW()
           WHERE id=$1`,
          [rows[0].id, e.action, e.durationSeconds ?? null, e.message ?? null]
        );
        return 'skipped';
      }
    } catch (err: any) {
      logger.warn(`[modlog] same-mod dedup failed: ${err?.message || err}`);
    }
  }

  if (PUNITIVE.has(e.action)) {
    try {
      // Anchor on the most recent PRIMARY punitive/unban row for this user.
      const { rows } = await db.query(
        `SELECT id, action, duration_seconds,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS age_sec
         FROM moderation_logs
         WHERE channel_name=$1 AND LOWER(username)=LOWER($2)
           AND action IN ('MUTED','AUTO_MUTED','BANNED','UNBANNED')
           AND primary_id IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [e.channel, e.username]
      );
      const last = rows[0];
      if (last && last.action !== 'UNBANNED') {
        const age = Number(last.age_sec);
        if (age <= PILE_ON_WINDOW_SEC) {
          // Pile-on within 5s → secondary (counts in per-mod stats, grouped).
          await insertRow(e, last.id);
          return 'secondary';
        }
        // Past the 5s window: if the user is still punished, this repeat is
        // redundant and not counted; if the previous timeout already expired,
        // fall through and start a new primary incident.
        let active: boolean;
        if (last.action === 'BANNED') active = true;
        else { const dur = Number(last.duration_seconds) || 60; active = age < dur; }
        if (active) return 'skipped';
      }
    } catch (err: any) {
      logger.warn(`[modlog] dedup check failed: ${err?.message || err}`);
    }
    await insertRow(e, null);
    return 'primary';
  }

  if (e.action === 'UNBANNED') {
    try {
      const { rows } = await db.query(
        `SELECT 1 FROM moderation_logs
         WHERE channel_name=$1 AND LOWER(username)=LOWER($2) AND action='UNBANNED'
           AND created_at > NOW() - INTERVAL '15 seconds' LIMIT 1`,
        [e.channel, e.username]
      );
      if (rows.length > 0) return 'skipped';
    } catch { /* fall through and insert */ }
  }

  await insertRow(e, null);
  return 'primary';
}
