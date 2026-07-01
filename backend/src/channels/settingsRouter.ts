import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { logger } from '../utils/logger';
import { recordAudit } from '../utils/audit';

export const settingsRouter = Router();

settingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { rows } = await db.query('SELECT key, value FROM settings');
    const result: Record<string, string> = {};
    rows.forEach((r: any) => { result[r.key] = r.value; });
    // mute_reason is personal per-user, not global
    if (req.user?.email) {
      const { rows: userRows } = await db.query('SELECT mute_reason FROM users WHERE email=$1', [req.user.email]);
      result.mute_reason = userRows[0]?.mute_reason || '';
    }
    res.json(result);
  } catch (err) {
    logger.error('GET /settings error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

settingsRouter.put('/', async (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>;
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'mute_reason') {
        // Personal per-user setting — never written to the shared settings table
        if (req.user?.email) {
          await db.query('UPDATE users SET mute_reason=$1 WHERE email=$2', [String(value), req.user.email]);
        }
        continue;
      }
      await db.query(
        'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
        [key, String(value)]
      );
    }
    const tm = (global as any).twitchManager;
    if (tm) {
      const engineSettings: any = {};
      if (updates.detect_threshold) engineSettings.detectThreshold = parseInt(updates.detect_threshold);
      if (updates.auto_mute_threshold) engineSettings.autoMuteThreshold = parseInt(updates.auto_mute_threshold);
      if (updates.similarity_threshold) engineSettings.similarityThreshold = parseInt(updates.similarity_threshold);
      if (updates.burst_limit) engineSettings.burstLimit = parseInt(updates.burst_limit);
      if (updates.mem_window_seconds) engineSettings.memWindowSeconds = parseInt(updates.mem_window_seconds);
      if (updates.link_detection !== undefined) engineSettings.linkDetection = updates.link_detection === 'true';
      if (Object.keys(engineSettings).length) tm.updateGlobalSettings(engineSettings);
      // Invalidate cached settings so next message reads fresh values
      tm.invalidateSettingsCache?.();
    }
    recordAudit(req.user?.email || 'unknown', 'settings_update', JSON.stringify(Object.keys(updates)));
    res.json({ success: true });
  } catch (err) {
    logger.error('PUT /settings error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
