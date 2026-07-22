import { db } from '../database/db';
import { logger } from './logger';
import { SuspicionSignal } from '../spam-engine/SpamEngine';
import { recordSuspicionEvent, setSuspiciousTracked } from './metrics';

/*
 * Внешний сигнал Twitch о подозрительных аккаунтах (EventSub
 * channel.suspicious_user.message / .update, скоуп moderator:read:suspicious_users).
 *
 * Зачем: SpamEngine судит только по тексту сообщения и истории этого юзера в
 * этом канале. Признак «аккаунт обходит бан» или «забанен в связанных каналах»
 * из текста не выводится в принципе — его знает только Twitch. Поэтому сигнал
 * подмешивается снаружи, а движок остаётся чистой логикой (§14).
 *
 * Метка НЕ триггер, а модификатор: очки добавляются только к уже ненулевому
 * спам-скору (см. SpamEngine.analyze). Подозрительный юзер, который пишет
 * нормально, в очередь не попадает.
 *
 * Ручное снятие (cleared_at): данные Twitch остаются в таблице и продолжают
 * обновляться, но бонус не применяется. Повторные события Twitch НЕ снимают
 * ручное решение модератора — иначе кнопка «снять» была бы бесполезной.
 */

export interface SuspicionRecord {
  channel: string;
  username: string;
  lowTrustStatus: string | null;
  types: string[];
  banEvasion: string | null;
  sharedBanChannels: number;
  cleared: boolean;
}

/**
 * Очки за каждый признак. Берётся максимум применимого, не сумма.
 *
 * Величины намеренно меньше разрыва между порогами детекта и автомута
 * (по умолчанию 70 и 90, разрыв 20). Свойство, которое это даёт: сообщение,
 * не дотянувшее до порога детекта по тексту, НЕ может из-за одной метки
 * оказаться сразу в автомуте — максимум доедет до очереди, где решение примет
 * человек. Метка ускоряет реакцию, но не подменяет собой детект.
 *
 * ВНИМАНИЕ: свойство держится, пока разрыв между detect_threshold и
 * auto_mute_threshold больше максимальных очков. Если сузить пороги в
 * настройках (или поднять очки через suspicion_points_*), оно ломается.
 */
const DEFAULT_POINTS = {
  restricted: 18,
  active_monitoring: 10,
  ban_evader: 18,
  banned_in_shared_channel: 15,
};
type PointsKey = keyof typeof DEFAULT_POINTS;
let points = { ...DEFAULT_POINTS };

/** channel|username → запись. Читается на каждом сообщении, поэтому в памяти. */
const cache = new Map<string, SuspicionRecord>();
const key = (channel: string, username: string) => `${channel.toLowerCase()}|${username.toLowerCase()}`;

function publishGauges(): void {
  let flagged = 0, cleared = 0;
  for (const r of cache.values()) (r.cleared ? cleared++ : flagged++);
  setSuspiciousTracked(flagged, cleared);
}

function rowToRecord(r: any): SuspicionRecord {
  return {
    channel: r.channel_name,
    username: r.username,
    lowTrustStatus: r.low_trust_status ?? null,
    types: Array.isArray(r.types) ? r.types : [],
    banEvasion: r.ban_evasion ?? null,
    sharedBanChannels: Number(r.shared_ban_channels) || 0,
    cleared: !!r.cleared_at,
  };
}

/** Загрузка кэша и настроек при старте. Безопасна к повторному вызову. */
export async function loadSuspicion(): Promise<void> {
  try {
    const { rows } = await db.query('SELECT * FROM suspicious_users');
    cache.clear();
    for (const r of rows) cache.set(key(r.channel_name, r.username), rowToRecord(r));
    publishGauges();
    logger.info(`[suspicion] loaded ${cache.size} records`);
  } catch (err: any) {
    logger.error(`[suspicion] load failed: ${err?.message || err}`);
  }
  await loadPoints();
}

/** Очки настраиваются через settings (suspicion_points_<признак>). */
export async function loadPoints(): Promise<void> {
  try {
    const { rows } = await db.query("SELECT key, value FROM settings WHERE key LIKE 'suspicion_points_%'");
    const next = { ...DEFAULT_POINTS };
    for (const r of rows) {
      const k = String(r.key).replace('suspicion_points_', '') as PointsKey;
      const v = parseInt(String(r.value));
      if (k in next && Number.isFinite(v)) next[k] = Math.max(0, Math.min(100, v));
    }
    points = next;
  } catch { /* остаются дефолты */ }
}

/**
 * Сигнал для SpamEngine. undefined = метки нет, снята вручную, или статус
 * сброшен Twitch в 'none'. Вызывается на каждом сообщении — только память.
 */
export function getSuspicionSignal(channel: string, username: string): SuspicionSignal | undefined {
  const rec = cache.get(key(channel, username));
  if (!rec || rec.cleared) return undefined;

  const applicable: { pts: number; label: string }[] = [];
  if (rec.banEvasion === 'likely' || rec.types.includes('ban_evader')) {
    applicable.push({ pts: points.ban_evader, label: 'Twitch: обход бана' });
  }
  if (rec.types.includes('banned_in_shared_channel')) {
    applicable.push({ pts: points.banned_in_shared_channel, label: 'Twitch: бан в связанных каналах' });
  }
  if (rec.lowTrustStatus === 'restricted') {
    applicable.push({ pts: points.restricted, label: 'Twitch: ограничен' });
  } else if (rec.lowTrustStatus === 'active_monitoring') {
    applicable.push({ pts: points.active_monitoring, label: 'Twitch: под наблюдением' });
  }
  if (applicable.length === 0) return undefined;

  // Максимум, а не сумма: признаки сильно коррелируют между собой и
  // складывать их — значит наказывать дважды за одно и то же.
  const best = applicable.reduce((a, b) => (b.pts > a.pts ? b : a));
  if (best.pts <= 0) return undefined;
  // Метрика применения бонуса инкрементится НЕ здесь: сигнал может вернуться и
  // не быть применён (чистое сообщение от помеченного юзера — score 0, бонус не
  // добавляется). Считаем реальный исход у вызывающего, по suspicionBonus (§17).
  return { points: best.pts, label: best.label };
}

/** Текущая метка для UI (в т.ч. снятая — её надо показывать как снятую). */
export function getSuspicionRecord(channel: string, username: string): SuspicionRecord | undefined {
  return cache.get(key(channel, username));
}

export interface SuspicionEvent {
  channel: string;
  username: string;
  lowTrustStatus: string | null;
  types: string[];
  banEvasion: string | null;
  sharedBanChannels: number;
  source: 'message' | 'update';
}

/**
 * Запись события Twitch. Ручное снятие сохраняется: cleared_at не сбрасывается,
 * данные обновляются. Статус 'none' (модератор снял метку в самом Twitch)
 * убирает запись из кэша — сигнала больше нет.
 */
export async function applySuspicionEvent(e: SuspicionEvent): Promise<SuspicionRecord | null> {
  const channel = e.channel.toLowerCase();
  const username = e.username.toLowerCase();
  recordSuspicionEvent(e.source);
  try {
    if (!e.lowTrustStatus || e.lowTrustStatus === 'none') {
      await db.query('DELETE FROM suspicious_users WHERE channel_name=$1 AND username=$2', [channel, username]);
      cache.delete(key(channel, username));
      publishGauges();
      return null;
    }
    const { rows } = await db.query(
      `INSERT INTO suspicious_users
         (channel_name, username, low_trust_status, types, ban_evasion, shared_ban_channels, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (channel_name, username) DO UPDATE SET
         low_trust_status = EXCLUDED.low_trust_status,
         types = EXCLUDED.types,
         ban_evasion = EXCLUDED.ban_evasion,
         shared_ban_channels = EXCLUDED.shared_ban_channels,
         updated_at = NOW()
       RETURNING *`,
      [channel, username, e.lowTrustStatus, e.types, e.banEvasion, e.sharedBanChannels]
    );
    if (!rows[0]) return null;
    const rec = rowToRecord(rows[0]);
    cache.set(key(channel, username), rec);
    publishGauges();
    return rec;
  } catch (err: any) {
    logger.error(`[suspicion] apply failed: ${err?.message || err}`);
    return null;
  }
}

/** Снять метку (ложное срабатывание) либо вернуть её. */
export async function setCleared(
  channel: string, username: string, cleared: boolean, by: string
): Promise<SuspicionRecord | null> {
  const ch = channel.toLowerCase();
  const un = username.toLowerCase();
  try {
    const { rows } = await db.query(
      `UPDATE suspicious_users
         SET cleared_at = ${cleared ? 'NOW()' : 'NULL'}, cleared_by = $3
       WHERE channel_name=$1 AND username=$2
       RETURNING *`,
      [ch, un, cleared ? by : null]
    );
    if (!rows[0]) return null;
    const rec = rowToRecord(rows[0]);
    cache.set(key(ch, un), rec);
    publishGauges();
    return rec;
  } catch (err: any) {
    logger.error(`[suspicion] setCleared failed: ${err?.message || err}`);
    return null;
  }
}
