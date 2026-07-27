/*
 * Чистая математика scrub-preview v2 (без БД/сети/файлов) — общая для генерации
 * листов на сервере и оконной загрузки на клиенте. Легко тестируется отдельно.
 *
 * Модель: базовый слой — 1 кадр/сек. На любом масштабе показываем фиксированное
 * число кадров в окне (60 ПК / 30 моб), детализация меняется только шагом step
 * из лесенки. Окна каноничные: длительность = step × framesPerWindow, старт
 * кратен длительности. Кадры пакуются в листы по 15 (сетка 5×3, ячейка 640×360).
 */

export const STEP_LADDER = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600] as const;
export const SHEET_CELLS = 15;
export const GRID_COLS = 5;
export const GRID_ROWS = 3;
export const CELL_W = 640;
export const CELL_H = 360;
export const FRAMES_PER_WINDOW_DESKTOP = 60;
export const FRAMES_PER_WINDOW_MOBILE = 30;

/** Ближайшее значение лесенки ≥ raw (не меньше 1, не больше максимума). */
export function roundStepUp(raw: number): number {
  const r = Math.max(1, Math.ceil(raw));
  for (const s of STEP_LADDER) if (s >= r) return s;
  return STEP_LADDER[STEP_LADDER.length - 1];
}

/** Шаг для видимого диапазона (сек) и размера окна. */
export function pickStep(visibleDurationSec: number, framesPerWindow: number): number {
  return roundStepUp(visibleDurationSec / framesPerWindow);
}

export function windowDuration(step: number, framesPerWindow: number): number {
  return step * framesPerWindow;
}

/** Начало каноничного окна для момента time (сек от старта стрима). */
export function windowStartFor(timeSec: number, step: number, framesPerWindow: number): number {
  const wd = windowDuration(step, framesPerWindow);
  return Math.floor(Math.max(0, timeSec) / wd) * wd;
}

/** globalIndex (0..fpw-1) ближайшего кадра окна к моменту sec. */
export function globalIndexFor(sec: number, windowStart: number, step: number, framesPerWindow: number): number {
  const gi = Math.round((sec - windowStart) / step);
  return Math.max(0, Math.min(framesPerWindow - 1, gi));
}

/** Секунда кадра по его индексу в окне. */
export function frameSecondFor(windowStart: number, globalIndex: number, step: number): number {
  return windowStart + globalIndex * step;
}

/** Лист/ячейка/колонка/строка для globalIndex. */
export function address(globalIndex: number): { sheetIndex: number; cell: number; col: number; row: number } {
  const sheetIndex = Math.floor(globalIndex / SHEET_CELLS);
  const cell = globalIndex % SHEET_CELLS;
  return { sheetIndex, cell, col: cell % GRID_COLS, row: Math.floor(cell / GRID_COLS) };
}

export function sheetsPerWindow(framesPerWindow: number): number {
  return Math.ceil(framesPerWindow / SHEET_CELLS);
}

export function framesPerWindow(isMobile: boolean): number {
  return isMobile ? FRAMES_PER_WINDOW_MOBILE : FRAMES_PER_WINDOW_DESKTOP;
}
