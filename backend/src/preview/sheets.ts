import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { logger } from '../utils/logger';
import { recordPreviewSheet, recordPreviewError } from '../utils/metrics';
import { CELL_W, CELL_H, GRID_COLS, GRID_ROWS, SHEET_CELLS } from './previewMath';

/*
 * scrub-preview v2 — ленивая сборка листов (спрайтов) из базовых 1fps WebP-кадров.
 * Лист = 5×3 = 15 кадров, ячейка 640×360, полотно 3200×1080, WebP.
 * Идентичность листа = (step, startSec), где startSec кратен 15×step — поэтому
 * ПК и мобилка переиспользуют один кэш. Генерится по запросу, кэшируется на диске.
 */

// Версия параметров генерации: fps/res/quality/сетка/лесенка. Меняй при правке —
// инвалидирует URL и immutable-кэш.
export const PREVIEW_VERSION = 'v2a';

const SHEET_W = GRID_COLS * CELL_W; // 3200
const SHEET_H = GRID_ROWS * CELL_H; // 1080
const WEBP_QUALITY = 75;
const SHEET_TTL_MS = 24 * 60 * 60 * 1000;
const SHEET_CACHE_LIMIT = parseFloat(process.env.PREVIEW_SHEET_CACHE_GB || '2') * 1e9;

function root(): string { return process.env.PREVIEW_STORAGE_DIR || '/app/previews'; }
export function framesDir(session: number): string { return path.join(root(), 'frames', String(session)); }
function sheetsDir(session: number): string { return path.join(root(), 'sheets', String(session)); }
function sheetPath(session: number, step: number, startSec: number): string {
  return path.join(sheetsDir(session), `${PREVIEW_VERSION}_s${step}_a${startSec}.webp`);
}
function frameFile(session: number, sec: number): string {
  return path.join(framesDir(session), `f_${String(sec).padStart(6, '0')}.webp`);
}

// Семафор параллельной генерации — на весь сервер (не на юзера).
const MAX_CONCURRENT = Math.max(1, Math.min(4, os.cpus().length - 1));
let active = 0;
const waiters: (() => void)[] = [];
async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) { active++; return; }
  await new Promise<void>(r => waiters.push(r));
  active++;
}
function release(): void { active--; const w = waiters.shift(); if (w) w(); }

// Singleflight: один лист (step+startSec) генерит только одна задача.
const inflight = new Map<string, Promise<string | null>>();

/** Путь к готовому листу (генерит при промахе) либо null, если кадров нет вовсе. */
export async function ensureSheet(session: number, step: number, startSec: number): Promise<string | null> {
  const p = sheetPath(session, step, startSec);
  try { await fs.promises.access(p); return p; } catch { /* miss */ }
  const existing = inflight.get(p);
  if (existing) return existing;

  const job = (async (): Promise<string | null> => {
    await acquire();
    try {
      const composites: sharp.OverlayOptions[] = [];
      let any = false;
      for (let k = 0; k < SHEET_CELLS; k++) {
        const sec = startSec + k * step;
        try {
          const buf = await fs.promises.readFile(frameFile(session, sec));
          const col = k % GRID_COLS, row = Math.floor(k / GRID_COLS);
          composites.push({ input: buf, left: col * CELL_W, top: row * CELL_H });
          any = true;
        } catch { /* кадра нет (край live / дыра) — оставляем чёрным */ }
      }
      if (!any) return null;
      await fs.promises.mkdir(sheetsDir(session), { recursive: true });
      const tmp = `${p}.tmp${process.pid}`;
      await sharp({ create: { width: SHEET_W, height: SHEET_H, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .composite(composites)
        .webp({ quality: WEBP_QUALITY })
        .toFile(tmp);
      await fs.promises.rename(tmp, p); // атомарно
      recordPreviewSheet('ok');
      return p;
    } catch (err: any) {
      recordPreviewError('sheet_gen');
      logger.warn(`[preview] sheet gen failed s=${step} a=${startSec}: ${err?.message || err}`);
      return null;
    } finally {
      release();
      inflight.delete(p);
    }
  })();

  inflight.set(p, job);
  return job;
}

/** Разовая чистка кэша листов: просроченные + при переполнении LRU до 75%. */
export async function cleanupSheets(): Promise<void> {
  const base = path.join(root(), 'sheets');
  let files: { p: string; size: number; atime: number }[] = [];
  const walk = (dir: string) => {
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const fp = path.join(dir, e);
      try {
        const st = fs.statSync(fp);
        if (st.isDirectory()) walk(fp);
        else if (e.endsWith('.webp')) files.push({ p: fp, size: st.size, atime: st.atimeMs });
        else if (e.includes('.tmp')) { try { fs.rmSync(fp, { force: true }); } catch {} } // недописанные
      } catch {}
    }
  };
  walk(base);
  const now = Date.now();
  let total = 0;
  for (const f of files) {
    if (now - f.atime > SHEET_TTL_MS) { try { fs.rmSync(f.p, { force: true }); } catch {} f.size = -1; }
    else total += f.size;
  }
  files = files.filter(f => f.size >= 0);
  if (total > SHEET_CACHE_LIMIT * 0.9) {
    files.sort((a, b) => a.atime - b.atime); // старые сначала
    const target = SHEET_CACHE_LIMIT * 0.75;
    for (const f of files) {
      if (total <= target) break;
      try { fs.rmSync(f.p, { force: true }); total -= f.size; } catch {}
    }
  }
}
