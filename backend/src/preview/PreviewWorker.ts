import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db } from '../database/db';
import { logger } from '../utils/logger';
import { getAppToken } from '../twitch/twitchToken';
import { getLiveLowResM3u8, getVodLowResM3u8 } from './twitchGql';
import { recordPreviewError, setPreviewWorkers } from '../utils/metrics';
import { ensureSheet, framesDir, cleanupSheets, PREVIEW_VERSION } from './sheets';
import {
  CELL_W, CELL_H, GRID_COLS, GRID_ROWS, FRAMES_PER_WINDOW_DESKTOP,
  roundStepUp, sheetsPerWindow,
} from './previewMath';

/*
 * scrub-preview v2 — ИНГЕСТ базового слоя: 1 кадр/сек в отдельные WebP (640×360).
 * Источник для ленивой сборки листов (sheets.ts). Работает только при
 * PREVIEW_PIPELINE_ENABLED=true. Локально не проверяется — тест в проде.
 *
 * live: кадры дописываются по ходу эфира; backfill: прошлые VOD за N дней.
 * По завершении набора кадров предгенерится обзорный (самый грубый) уровень —
 * его открывают все. Остальные уровни собираются лениво по запросу.
 */

const FRAME_FPS = 1;
const MAX_WORKERS = 2;
const BACKFILL_DAYS = parseInt(process.env.PREVIEW_BACKFILL_DAYS || '14', 10);
const FRAMES_RETENTION_DAYS = parseInt(process.env.PREVIEW_FRAMES_DAYS || '30', 10);

interface Worker { sessionId: number; channel: string; dir: string; proc: ChildProcess | null; timer: NodeJS.Timeout | null; }

function storageRoot(): string { return process.env.PREVIEW_STORAGE_DIR || '/app/previews'; }
function frameCount(dir: string): number {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.webp')).length; } catch { return 0; }
}
function ffmpegFramesArgs(m3u8: string, dir: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning', '-i', m3u8,
    '-vf', `fps=${FRAME_FPS},scale=${CELL_W}:${CELL_H}`,
    '-c:v', 'libwebp', '-quality', '75', '-start_number', '0',
    path.join(dir, 'f_%06d.webp'),
  ];
}

export class PreviewWorker {
  private workers = new Map<number, Worker>();
  private backfillQueue: { sessionId: number; channel: string; vodId: string; startedAt: string }[] = [];
  private backfillRunning = false;
  private backfillProc: ChildProcess | null = null;
  private static _i: PreviewWorker | null = null;
  static get(): PreviewWorker { return (this._i ??= new PreviewWorker()); }
  static enabled(): boolean { return process.env.PREVIEW_PIPELINE_ENABLED === 'true'; }

  // ── LIVE ────────────────────────────────────────────────────────────────
  async sync(live: { id: number; channel_name: string; started_at: string }[]): Promise<void> {
    if (!PreviewWorker.enabled()) { this.stopAll(); return; }
    const liveIds = new Set(live.map(s => s.id));
    for (const id of [...this.workers.keys()]) if (!liveIds.has(id)) this.stopLive(id);
    for (const s of live) {
      if (this.workers.size >= MAX_WORKERS) break;
      if (this.workers.has(s.id)) continue;
      await this.startLive(s);
    }
    setPreviewWorkers(this.workers.size);
  }

  private async startLive(s: { id: number; channel_name: string; started_at: string }): Promise<void> {
    const channel = s.channel_name.toLowerCase();
    const dir = framesDir(s.id);
    const m3u8 = await getLiveLowResM3u8(channel);
    if (!m3u8) { recordPreviewError('m3u8'); return; }
    try { fs.mkdirSync(dir, { recursive: true }); } catch { recordPreviewError('mkdir'); return; }
    await this.upsertMeta(s.id, channel, s.started_at, await this.fetchVodId(channel).catch(() => null));
    let proc: ChildProcess;
    try { proc = spawn('ffmpeg', ffmpegFramesArgs(m3u8, dir), { stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (err: any) { recordPreviewError('spawn'); logger.error(`[preview] live spawn: ${err?.message}`); return; }
    const w: Worker = { sessionId: s.id, channel, dir, proc, timer: null };
    this.workers.set(s.id, w);
    setPreviewWorkers(this.workers.size);
    logger.info(`[preview] live ingest started: session ${s.id} (${channel})`);
    proc.stderr?.on('data', (d: Buffer) => { const l = d.toString().trim(); if (l) logger.warn(`[preview] live ffmpeg ${channel}: ${l.slice(0, 200)}`); });
    proc.on('error', () => recordPreviewError('ffmpeg'));
    proc.on('exit', () => this.stopLive(s.id));
    w.timer = setInterval(() => this.bumpFrames(s.id, dir).catch(() => {}), 15_000);
  }

  private stopLive(id: number): void {
    const w = this.workers.get(id);
    if (!w) return;
    if (w.timer) clearInterval(w.timer);
    try { w.proc?.kill('SIGKILL'); } catch {}
    this.workers.delete(id);
    setPreviewWorkers(this.workers.size);
    // Финальный подсчёт + обзорный уровень для завершившегося live-набора.
    this.bumpFrames(id, w.dir).then(() => this.precomputeOverview(id)).catch(() => {});
  }

  // ── BACKFILL ────────────────────────────────────────────────────────────
  private async listArchives(channel: string): Promise<{ id: string; created_at: string }[]> {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const token = await getAppToken();
    if (!clientId || !token) return [];
    const h = { 'Client-ID': clientId, Authorization: `Bearer ${token}` };
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

  async scanBackfill(): Promise<void> {
    if (!PreviewWorker.enabled()) return;
    try {
      const { rows: chans } = await db.query('SELECT name FROM channels');
      for (const c of chans) {
        const channel = String(c.name).toLowerCase();
        for (const vod of await this.listArchives(channel)) {
          const { rows: sess } = await db.query(
            `SELECT id, started_at FROM stream_sessions
             WHERE channel_name=$1 AND ABS(EXTRACT(EPOCH FROM (started_at - $2::timestamptz))) < 900
             ORDER BY ABS(EXTRACT(EPOCH FROM (started_at - $2::timestamptz))) ASC LIMIT 1`,
            [channel, vod.created_at]
          );
          const s = sess[0];
          if (!s) continue;
          if (this.workers.has(s.id)) continue;
          if (this.backfillQueue.some(q => q.sessionId === s.id)) continue;
          // «готово» = есть базовые кадры на диске (эфемерный том мог стереть → перегенерим)
          if (frameCount(framesDir(s.id)) > 0) continue;
          this.backfillQueue.push({ sessionId: s.id, channel, vodId: vod.id, startedAt: s.started_at });
        }
      }
      if (this.backfillQueue.length > 0) {
        logger.info(`[preview] backfill queued: ${this.backfillQueue.length}`);
        this.processBackfillQueue();
      }
    } catch (err: any) { logger.warn(`[preview] scanBackfill failed: ${err?.message || err}`); }
  }

  private dirSizeBytes(dir: string): number {
    let total = 0; let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { return 0; }
    for (const e of entries) {
      const p = path.join(dir, e);
      try { const st = fs.statSync(p); total += st.isDirectory() ? this.dirSizeBytes(p) : st.size; } catch {}
    }
    return total;
  }

  private async processBackfillQueue(): Promise<void> {
    if (this.backfillRunning) return;
    this.backfillRunning = true;
    try {
      while (this.backfillQueue.length > 0 && PreviewWorker.enabled()) {
        const item = this.backfillQueue.shift()!;
        await this.runBackfill(item);
      }
    } finally { this.backfillRunning = false; }
  }

  private runBackfill(item: { sessionId: number; channel: string; vodId: string; startedAt: string }): Promise<void> {
    return new Promise(async (resolve) => {
      const dir = framesDir(item.sessionId);
      const m3u8 = await getVodLowResM3u8(item.vodId);
      if (!m3u8) { recordPreviewError('vod_m3u8'); return resolve(); }
      try { fs.mkdirSync(dir, { recursive: true }); } catch { recordPreviewError('mkdir'); return resolve(); }
      await this.upsertMeta(item.sessionId, item.channel, item.startedAt, item.vodId);
      let proc: ChildProcess;
      try { proc = spawn('ffmpeg', ffmpegFramesArgs(m3u8, dir), { stdio: ['ignore', 'ignore', 'pipe'] }); }
      catch (err: any) { recordPreviewError('spawn'); logger.error(`[preview] bf spawn: ${err?.message}`); return resolve(); }
      this.backfillProc = proc;
      logger.info(`[preview] backfill start: session ${item.sessionId} vod ${item.vodId}`);
      const progress = setInterval(() => { this.bumpFrames(item.sessionId, dir).catch(() => {}); }, 15_000);
      proc.stderr?.on('data', (d: Buffer) => { const l = d.toString().trim(); if (l) logger.warn(`[preview] bf ffmpeg: ${l.slice(0, 200)}`); });
      proc.on('error', () => recordPreviewError('ffmpeg'));
      proc.on('exit', async (code) => {
        clearInterval(progress);
        this.backfillProc = null;
        await this.bumpFrames(item.sessionId, dir);
        await this.precomputeOverview(item.sessionId);
        logger.info(`[preview] backfill done: session ${item.sessionId} frames=${frameCount(dir)} code=${code}`);
        resolve();
      });
    });
  }

  // ── shared ────────────────────────────────────────────────────────────────
  private async bumpFrames(sessionId: number, dir: string): Promise<void> {
    const n = frameCount(dir);
    if (n === 0) return;
    await db.query(
      `UPDATE stream_previews SET frame_count=$2, duration_sec=$2, updated_at=NOW() WHERE session_id=$1`,
      [sessionId, n]
    ).catch(() => {});
  }

  /** Обзорный (самый грубый) уровень для всего стрима — его видят все при открытии. */
  private async precomputeOverview(sessionId: number): Promise<void> {
    const n = frameCount(framesDir(sessionId));
    if (n === 0) return;
    const fpw = FRAMES_PER_WINDOW_DESKTOP;
    const step = roundStepUp(n / fpw);
    const sheets = sheetsPerWindow(fpw);
    for (let si = 0; si < sheets; si++) {
      await ensureSheet(sessionId, step, si * 15 * step).catch(() => null);
    }
  }

  private async upsertMeta(sessionId: number, channel: string, startedAt: string, vodId: string | null): Promise<void> {
    await db.query(
      `INSERT INTO stream_previews
         (session_id, channel_name, vod_id, fps, cell_w, cell_h, cols, rows, sheet_count, seconds_covered,
          frame_count, duration_sec, preview_version, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,0,0,$9,$10)
       ON CONFLICT (session_id) DO UPDATE SET
         vod_id=COALESCE(EXCLUDED.vod_id, stream_previews.vod_id),
         preview_version=EXCLUDED.preview_version, updated_at=NOW()`,
      [sessionId, channel, vodId, FRAME_FPS, CELL_W, CELL_H, GRID_COLS, GRID_ROWS, PREVIEW_VERSION, startedAt]
    ).catch((err) => logger.warn(`[preview] meta upsert failed: ${err?.message || err}`));
  }

  private async fetchVodId(channel: string): Promise<string | null> {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const token = await getAppToken();
    if (!clientId || !token) return null;
    const h = { 'Client-ID': clientId, Authorization: `Bearer ${token}` };
    const u = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`, { headers: h });
    if (!u.ok) return null;
    const userId = (await u.json() as any)?.data?.[0]?.id;
    if (!userId) return null;
    const v = await fetch(`https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=1`, { headers: h });
    if (!v.ok) return null;
    return (await v.json() as any)?.data?.[0]?.id || null;
  }

  stopAll(): void {
    for (const id of [...this.workers.keys()]) this.stopLive(id);
    this.backfillQueue = [];
    try { this.backfillProc?.kill('SIGKILL'); } catch {}
    this.backfillProc = null;
  }

  /** Ретенция: базовые кадры старше N дней + чистка кэша листов (24ч/лимит). */
  async cleanup(): Promise<void> {
    try {
      const { rows } = await db.query(
        `SELECT session_id FROM stream_previews WHERE started_at < NOW() - ($1 * INTERVAL '1 day')`,
        [FRAMES_RETENTION_DAYS]
      );
      for (const r of rows) {
        try { fs.rmSync(framesDir(r.session_id), { recursive: true, force: true }); } catch {}
        try { fs.rmSync(path.join(storageRoot(), 'sheets', String(r.session_id)), { recursive: true, force: true }); } catch {}
        await db.query('DELETE FROM stream_previews WHERE session_id=$1', [r.session_id]).catch(() => {});
      }
      if (rows.length > 0) logger.info(`[preview] cleanup removed ${rows.length} old sets`);
    } catch (err: any) { logger.warn(`[preview] cleanup failed: ${err?.message || err}`); }
    await cleanupSheets().catch(() => {});
  }
}
