import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db } from '../database/db';
import { logger } from '../utils/logger';
import { getAppToken } from '../twitch/twitchToken';
import { getLiveLowResM3u8, getVodLowResM3u8 } from './twitchGql';
import { recordPreviewSheet, recordPreviewError, setPreviewWorkers } from '../utils/metrics';

/*
 * Feature B — посекундная раскадровка живого стрима (scrub-preview).
 *
 * На каждый идущий канал (лимит 2) запускаем ffmpeg, который тянет самый низкий
 * HLS-вариант и раз в секунду берёт FPS кадров, упаковывая их в спрайт-листы
 * COLS×ROWS прямо фильтром `tile` (без доп. библиотек). Один лист = COLS*ROWS/FPS
 * секунд. Прогресс (сколько листов готово) периодически пишем в stream_previews —
 * фронт по мете вычисляет, какой лист и какая ячейка соответствуют секунде.
 *
 * Запускается только при PREVIEW_PIPELINE_ENABLED=true. Локально не проверяется —
 * тестировать в проде на живом канале (см. spec).
 */

const FPS = 3;
const COLS = 6;
const ROWS = 5;
const CELLS = COLS * ROWS;            // 30 кадров на лист
const SECONDS_PER_SHEET = CELLS / FPS; // 10с
const CELL_W = 640;
const CELL_H = 360;                    // предполагаем 16:9; scale=640:-2 даст ~360
const MAX_WORKERS = 2;
// Бэкфилл прошлых VOD: сколько дней назад брать и потолок диска под все спрайты.
const BACKFILL_DAYS = parseInt(process.env.PREVIEW_BACKFILL_DAYS || '14', 10);
const MAX_GB = parseFloat(process.env.PREVIEW_MAX_GB || '5');

interface Worker {
  sessionId: number;
  channel: string;
  dir: string;
  proc: ChildProcess | null;
  timer: NodeJS.Timeout | null;
  lastSheets: number;
  starting: boolean;
}

function storageRoot(): string {
  return process.env.PREVIEW_STORAGE_DIR || '/app/previews';
}

export class PreviewWorker {
  private workers = new Map<number, Worker>(); // by session id
  private backfillQueue: { sessionId: number; channel: string; vodId: string; startedAt: string }[] = [];
  private backfillRunning = false;
  private backfillProc: ChildProcess | null = null;
  private static _i: PreviewWorker | null = null;
  static get(): PreviewWorker { return (this._i ??= new PreviewWorker()); }

  static enabled(): boolean {
    return process.env.PREVIEW_PIPELINE_ENABLED === 'true';
  }

  /** Синхронизация с текущими live-сессиями: старт новых (до лимита), стоп ушедших. */
  async sync(live: { id: number; channel_name: string; started_at: string }[]): Promise<void> {
    if (!PreviewWorker.enabled()) { this.stopAll(); return; }
    const liveIds = new Set(live.map(s => s.id));
    // стоп тех, кто больше не в эфире
    for (const [id, w] of this.workers) {
      if (!liveIds.has(id)) this.stop(id);
      void w;
    }
    // старт новых до лимита
    for (const s of live) {
      if (this.workers.size >= MAX_WORKERS) break;
      if (this.workers.has(s.id)) continue;
      await this.start(s);
    }
    setPreviewWorkers(this.workers.size);
  }

  private async start(s: { id: number; channel_name: string; started_at: string }): Promise<void> {
    const channel = s.channel_name.toLowerCase();
    const dir = path.join(storageRoot(), String(s.id));
    const w: Worker = { sessionId: s.id, channel, dir, proc: null, timer: null, lastSheets: 0, starting: true };
    this.workers.set(s.id, w);
    setPreviewWorkers(this.workers.size);

    const m3u8 = await getLiveLowResM3u8(channel);
    if (!m3u8) {
      recordPreviewError('m3u8');
      this.workers.delete(s.id);        // ретрай на следующем sync
      setPreviewWorkers(this.workers.size);
      return;
    }

    try { fs.mkdirSync(dir, { recursive: true }); } catch (err: any) {
      recordPreviewError('mkdir');
      logger.warn(`[preview] mkdir failed ${dir}: ${err?.message || err}`);
      this.workers.delete(s.id);
      setPreviewWorkers(this.workers.size);
      return;
    }

    await this.upsertMeta(s.id, channel, s.started_at);

    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-i', m3u8,
      '-vf', `fps=${FPS},scale=${CELL_W}:-2,tile=${COLS}x${ROWS}`,
      '-q:v', '5', '-start_number', '0',
      path.join(dir, 'sheet_%05d.jpg'),
    ];
    let proc: ChildProcess;
    try {
      proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err: any) {
      recordPreviewError('spawn');
      logger.error(`[preview] ffmpeg spawn failed: ${err?.message || err}`);
      this.workers.delete(s.id);
      setPreviewWorkers(this.workers.size);
      return;
    }
    w.proc = proc;
    w.starting = false;
    logger.info(`[preview] ingest started: session ${s.id} (${channel})`);

    proc.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line) logger.warn(`[preview] ffmpeg ${channel}: ${line.slice(0, 200)}`);
    });
    proc.on('error', (err) => { recordPreviewError('ffmpeg'); logger.error(`[preview] ffmpeg error ${channel}: ${err?.message}`); });
    proc.on('exit', (code) => {
      logger.info(`[preview] ingest ended: session ${s.id} (${channel}) code=${code}`);
      this.stop(s.id);
    });

    // прогресс: считаем листы, обновляем мету
    w.timer = setInterval(() => this.pollProgress(s.id).catch(() => {}), 15_000);
  }

  private async pollProgress(sessionId: number): Promise<void> {
    const w = this.workers.get(sessionId);
    if (!w) return;
    let files: string[] = [];
    try { files = fs.readdirSync(w.dir).filter(f => f.endsWith('.jpg')); } catch { return; }
    const sheets = files.length;
    if (sheets === w.lastSheets) return;
    for (let i = w.lastSheets; i < sheets; i++) recordPreviewSheet('ok');
    w.lastSheets = sheets;
    const seconds = sheets * SECONDS_PER_SHEET;
    await db.query(
      `UPDATE stream_previews SET sheet_count=$2, seconds_covered=$3, updated_at=NOW() WHERE session_id=$1`,
      [sessionId, sheets, seconds]
    ).catch(() => {});
  }

  private async upsertMeta(sessionId: number, channel: string, startedAt: string): Promise<void> {
    const vodId = await this.fetchVodId(channel).catch(() => null);
    await db.query(
      `INSERT INTO stream_previews
         (session_id, channel_name, vod_id, fps, cell_w, cell_h, cols, rows, sheet_count, seconds_covered, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9)
       ON CONFLICT (session_id) DO UPDATE SET vod_id=COALESCE(EXCLUDED.vod_id, stream_previews.vod_id), updated_at=NOW()`,
      [sessionId, channel, vodId, FPS, CELL_W, CELL_H, COLS, ROWS, startedAt]
    ).catch((err) => logger.warn(`[preview] meta upsert failed: ${err?.message || err}`));
  }

  /** VOD-id текущего архива канала через Helix (для клика в VOD, B3). Best-effort. */
  private async fetchVodId(channel: string): Promise<string | null> {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const token = await getAppToken();
    if (!clientId || !token) return null;
    const h = { 'Client-ID': clientId, Authorization: `Bearer ${token}` };
    const u = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`, { headers: h });
    if (!u.ok) return null;
    const uj: any = await u.json();
    const userId = uj?.data?.[0]?.id;
    if (!userId) return null;
    const v = await fetch(`https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=1`, { headers: h });
    if (!v.ok) return null;
    const vj: any = await v.json();
    return vj?.data?.[0]?.id || null;
  }

  stop(sessionId: number): void {
    const w = this.workers.get(sessionId);
    if (!w) return;
    if (w.timer) clearInterval(w.timer);
    try { w.proc?.kill('SIGKILL'); } catch {}
    this.workers.delete(sessionId);
    setPreviewWorkers(this.workers.size);
  }

  stopAll(): void {
    for (const id of [...this.workers.keys()]) this.stop(id);
    this.backfillQueue = [];
    try { this.backfillProc?.kill('SIGKILL'); } catch {}
    this.backfillProc = null;
  }

  // ── VOD-backfill: раскадровка прошлых записей за последние N дней ──────────
  private helixHeaders(): Promise<Record<string, string> | null> {
    const clientId = process.env.TWITCH_CLIENT_ID;
    return getAppToken().then(token =>
      clientId && token ? { 'Client-ID': clientId, Authorization: `Bearer ${token}` } : null);
  }

  /** Архивные VOD канала за последние BACKFILL_DAYS: [{id, created_at}]. */
  private async listArchives(channel: string): Promise<{ id: string; created_at: string }[]> {
    const h = await this.helixHeaders();
    if (!h) return [];
    const u = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`, { headers: h });
    if (!u.ok) return [];
    const userId = (await u.json() as any)?.data?.[0]?.id;
    if (!userId) return [];
    const v = await fetch(`https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=100`, { headers: h });
    if (!v.ok) return [];
    const cutoff = Date.now() - BACKFILL_DAYS * 86400_000;
    return ((await v.json() as any)?.data || [])
      .filter((x: any) => new Date(x.created_at).getTime() >= cutoff)
      .map((x: any) => ({ id: x.id, created_at: x.created_at }));
  }

  /** Ищем прошлые VOD (за N дней), матчим к сессиям по времени, ставим в очередь. */
  async scanBackfill(): Promise<void> {
    if (!PreviewWorker.enabled()) return;
    try {
      const { rows: chans } = await db.query('SELECT name FROM channels');
      for (const c of chans) {
        const channel = String(c.name).toLowerCase();
        const vods = await this.listArchives(channel);
        for (const vod of vods) {
          // Матч VOD → сессия по близости старта (VOD created_at = начало эфира).
          const { rows: sess } = await db.query(
            `SELECT id, started_at FROM stream_sessions
             WHERE channel_name=$1
               AND ABS(EXTRACT(EPOCH FROM (started_at - $2::timestamptz))) < 900
             ORDER BY ABS(EXTRACT(EPOCH FROM (started_at - $2::timestamptz))) ASC LIMIT 1`,
            [channel, vod.created_at]
          );
          const s = sess[0];
          if (!s) continue;
          if (this.workers.has(s.id)) continue;                         // сейчас идёт live-ингест
          if (this.backfillQueue.some(q => q.sessionId === s.id)) continue;
          const { rows: prev } = await db.query('SELECT sheet_count FROM stream_previews WHERE session_id=$1', [s.id]);
          if (prev[0]?.sheet_count > 0) continue;                       // уже раскадрован
          this.backfillQueue.push({ sessionId: s.id, channel, vodId: vod.id, startedAt: s.started_at });
        }
      }
      if (this.backfillQueue.length > 0) {
        logger.info(`[preview] backfill queued: ${this.backfillQueue.length}`);
        this.processBackfillQueue();
      }
    } catch (err: any) {
      logger.warn(`[preview] scanBackfill failed: ${err?.message || err}`);
    }
  }

  private dirSizeBytes(dir: string): number {
    let total = 0;
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { return 0; }
    for (const e of entries) {
      const p = path.join(dir, e);
      try {
        const st = fs.statSync(p);
        total += st.isDirectory() ? this.dirSizeBytes(p) : st.size;
      } catch {}
    }
    return total;
  }

  private async processBackfillQueue(): Promise<void> {
    if (this.backfillRunning) return;
    this.backfillRunning = true;
    try {
      while (this.backfillQueue.length > 0 && PreviewWorker.enabled()) {
        // Потолок диска — иначе бэкфилл может забить хост спрайтами.
        if (this.dirSizeBytes(storageRoot()) > MAX_GB * 1e9) {
          logger.warn(`[preview] backfill stopped: disk cap ${MAX_GB}GB reached`);
          this.backfillQueue = [];
          break;
        }
        const item = this.backfillQueue.shift()!;
        await this.runBackfill(item);
      }
    } finally {
      this.backfillRunning = false;
    }
  }

  private runBackfill(item: { sessionId: number; channel: string; vodId: string; startedAt: string }): Promise<void> {
    return new Promise(async (resolve) => {
      const dir = path.join(storageRoot(), String(item.sessionId));
      const m3u8 = await getVodLowResM3u8(item.vodId);
      if (!m3u8) { recordPreviewError('vod_m3u8'); return resolve(); }
      try { fs.mkdirSync(dir, { recursive: true }); } catch { recordPreviewError('mkdir'); return resolve(); }
      await this.upsertMetaVod(item.sessionId, item.channel, item.vodId, item.startedAt);
      const args = [
        '-hide_banner', '-loglevel', 'warning', '-i', m3u8,
        '-vf', `fps=${FPS},scale=${CELL_W}:-2,tile=${COLS}x${ROWS}`,
        '-q:v', '5', '-start_number', '0', path.join(dir, 'sheet_%05d.jpg'),
      ];
      let proc: ChildProcess;
      try { proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] }); }
      catch (err: any) { recordPreviewError('spawn'); logger.error(`[preview] backfill spawn: ${err?.message}`); return resolve(); }
      this.backfillProc = proc;
      logger.info(`[preview] backfill start: session ${item.sessionId} vod ${item.vodId}`);
      proc.stderr?.on('data', (d: Buffer) => { const l = d.toString().trim(); if (l) logger.warn(`[preview] bf ffmpeg: ${l.slice(0, 200)}`); });
      proc.on('error', () => { recordPreviewError('ffmpeg'); });
      proc.on('exit', async (code) => {
        this.backfillProc = null;
        let sheets = 0;
        try { sheets = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).length; } catch {}
        for (let i = 0; i < sheets; i++) recordPreviewSheet('ok');
        await db.query(
          `UPDATE stream_previews SET sheet_count=$2, seconds_covered=$3, updated_at=NOW() WHERE session_id=$1`,
          [item.sessionId, sheets, sheets * SECONDS_PER_SHEET]
        ).catch(() => {});
        logger.info(`[preview] backfill done: session ${item.sessionId} sheets=${sheets} code=${code}`);
        resolve();
      });
    });
  }

  private async upsertMetaVod(sessionId: number, channel: string, vodId: string, startedAt: string): Promise<void> {
    await db.query(
      `INSERT INTO stream_previews
         (session_id, channel_name, vod_id, fps, cell_w, cell_h, cols, rows, sheet_count, seconds_covered, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9)
       ON CONFLICT (session_id) DO UPDATE SET vod_id=EXCLUDED.vod_id, updated_at=NOW()`,
      [sessionId, channel, vodId, FPS, CELL_W, CELL_H, COLS, ROWS, startedAt]
    ).catch(() => {});
  }

  /** Ретенция: удаляем спрайты и мету старше maxDays (прокси «пока жив VOD»). */
  async cleanup(maxDays = 30): Promise<void> {
    try {
      const { rows } = await db.query(
        `SELECT session_id FROM stream_previews WHERE started_at < NOW() - ($1 * INTERVAL '1 day')`,
        [maxDays]
      );
      for (const r of rows) {
        const dir = path.join(storageRoot(), String(r.session_id));
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        await db.query('DELETE FROM stream_previews WHERE session_id=$1', [r.session_id]).catch(() => {});
      }
      if (rows.length > 0) logger.info(`[preview] cleanup removed ${rows.length} old preview sets`);
    } catch (err: any) {
      logger.warn(`[preview] cleanup failed: ${err?.message || err}`);
    }
  }
}
