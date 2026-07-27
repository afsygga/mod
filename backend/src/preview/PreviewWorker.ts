import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db } from '../database/db';
import { logger } from '../utils/logger';
import { getAppToken } from '../twitch/twitchToken';
import { getLiveLowResM3u8 } from './twitchGql';
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
