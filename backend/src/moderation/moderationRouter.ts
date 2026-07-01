import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { logger } from '../utils/logger';

export const moderationRouter = Router();

moderationRouter.post('/mute', async (req: Request, res: Response) => {
  const { channel, username, duration = 60 } = req.body;
  if (!channel || !username) return res.status(400).json({ error: 'channel and username required' });
  try {
    const tm = (global as any).twitchManager;
    if (tm) await tm.muteUser(channel, username, duration, req.user?.email || 'dashboard');
    else {
      await db.query(
        'INSERT INTO moderation_logs (channel_name, username, action, duration_seconds, performed_by) VALUES ($1,$2,$3,$4,$5)',
        [channel, username, 'MUTED', duration, 'dashboard']
      );
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('POST /moderation/mute error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

moderationRouter.post('/ban', async (req: Request, res: Response) => {
  const { channel, username } = req.body;
  if (!channel || !username) return res.status(400).json({ error: 'channel and username required' });
  try {
    const tm = (global as any).twitchManager;
    if (tm) await tm.banUser(channel, username, req.user?.email || 'dashboard');
    else {
      await db.query(
        'INSERT INTO moderation_logs (channel_name, username, action, performed_by) VALUES ($1,$2,$3,$4)',
        [channel, username, 'BANNED', 'dashboard']
      );
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('POST /moderation/ban error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unban / unmute — Twitch's unban removes both permanent bans and timeouts
moderationRouter.post('/unban', async (req: Request, res: Response) => {
  const { channel, username } = req.body;
  if (!channel || !username) return res.status(400).json({ error: 'channel and username required' });
  try {
    const tm = (global as any).twitchManager;
    if (tm) await tm.unbanUser(channel, username, req.user?.email || 'dashboard');
    res.json({ success: true });
  } catch (err) {
    logger.error('POST /moderation/unban error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// In-memory avatar cache
const avatarCache: Map<string, { data: any; ts: number }> = new Map();
const AVATAR_TTL = 30 * 60 * 1000; // 30 min

// Get Twitch user info + spam profile + activity timeline
moderationRouter.get('/user/:username', async (req: Request, res: Response) => {
  const username = req.params.username.toLowerCase();
  const cached = avatarCache.get(username);
  let twitchData: any = null;

  if (cached && Date.now() - cached.ts < AVATAR_TTL) {
    twitchData = cached.data;
  } else {
    try {
      const headers = {
        'Client-Id': process.env.TWITCH_CLIENT_ID || '',
        'Authorization': `Bearer ${(process.env.TWITCH_BOT_OAUTH || '').replace('oauth:', '')}`,
      };
      const r = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`, { headers });
      const data = await r.json() as any;
      const user = (data.data || [])[0];
      if (user) {
        twitchData = {
          exists: true,
          id: user.id,
          login: user.login,
          display_name: user.display_name,
          profile_image_url: user.profile_image_url,
          created_at: user.created_at,
          description: user.description,
        };
        avatarCache.set(username, { data: twitchData, ts: Date.now() });
        // Persist to DB for analytics
        await db.query(
          `INSERT INTO twitch_user_meta (username, twitch_id, display_name, profile_image_url, account_created_at, description, fetched_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (username) DO UPDATE SET
             twitch_id=$2, display_name=$3, profile_image_url=$4, account_created_at=$5, description=$6, fetched_at=NOW()`,
          [username, user.id, user.display_name, user.profile_image_url, user.created_at, user.description]
        ).catch(() => {});
      } else {
        twitchData = { exists: false };
      }
    } catch (err) {
      twitchData = { exists: false };
    }
  }

  // Aggregate spam profile across user's owned channels
  const isAdmin = req.user?.role === 'admin';
  const email = req.user?.email;
  let scope = '';
  const params: any[] = [username];
  if (!isAdmin) {
    const { rows } = await db.query('SELECT channel_name AS name FROM channel_subscribers WHERE user_email=$1', [email]);
    const owned = rows.map((r: any) => r.name);
    if (owned.length === 0) {
      return res.json({ twitch: twitchData, profile: null, timeline: [], message_count_total: 0 });
    }
    params.push(owned);
    scope = ' AND channel_name = ANY($2)';
  }

  try {
    const [profile, messages30d, muteHistory] = await Promise.all([
      db.query(
        `SELECT channel_name, message_count, flagged_count, mute_count, spam_score, created_at, last_seen
         FROM user_profiles WHERE username=$1${scope}`,
        params
      ),
      db.query(
        `SELECT date_trunc('day', created_at)::date AS day,
                COUNT(*)::int AS msgs,
                COUNT(*) FILTER (WHERE spam_score >= 70)::int AS spam,
                MAX(spam_score)::int AS max_score
         FROM messages WHERE username=$1${scope} AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY day ORDER BY day ASC`,
        params
      ),
      db.query(
        `SELECT created_at, action, channel_name, duration_seconds, reasons
         FROM moderation_logs WHERE username=$1${scope} AND action IN ('MUTED','BANNED','AUTO_MUTED','UNBANNED')
         ORDER BY created_at DESC LIMIT 50`,
        params
      ),
    ]);

    res.json({
      twitch: twitchData,
      profile: profile.rows,
      timeline: messages30d.rows,
      mute_history: muteHistory.rows,
    });
  } catch (err) {
    logger.error('user profile fetch error', err);
    res.json({ twitch: twitchData, profile: null, timeline: [] });
  }
});

// Bulk moderation actions
moderationRouter.post('/bulk', async (req: Request, res: Response) => {
  const { action, channel, usernames, duration } = req.body;
  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ error: 'usernames array required' });
  }
  if (!channel) return res.status(400).json({ error: 'channel required' });
  if (!['mute', 'ban', 'unban'].includes(action)) return res.status(400).json({ error: 'invalid action' });

  const tm = (global as any).twitchManager;
  if (!tm) return res.status(500).json({ error: 'twitch manager not available' });

  const results: { username: string; ok: boolean; error?: string }[] = [];
  // Sequential to avoid Helix rate limits
  for (const u of usernames.slice(0, 50)) {
    try {
      if (action === 'mute') await tm.muteUser(channel, u, duration || 600, req.user?.email || 'bulk');
      else if (action === 'ban') await tm.banUser(channel, u, req.user?.email || 'bulk');
      else if (action === 'unban') await tm.unbanUser(channel, u, req.user?.email || 'bulk');
      results.push({ username: u, ok: true });
      // Small delay between calls
      await new Promise(r => setTimeout(r, 150));
    } catch (err: any) {
      results.push({ username: u, ok: false, error: err?.message });
    }
  }
  res.json({ results, count: results.filter(r => r.ok).length });
});

// Execute raw Twitch command
moderationRouter.post('/command', async (req: Request, res: Response) => {
  const { channel, command } = req.body;
  if (!channel || !command) return res.status(400).json({ error: 'channel and command required' });
  try {
    const tm = (global as any).twitchManager;
    if (!tm) return res.json({ ok: false, message: 'Twitch not connected' });

    const cmd = String(command).trim();
    // Parse command
    if (cmd.startsWith('/timeout ')) {
      const parts = cmd.substring(9).split(/\s+/);
      const user = parts[0];
      const dur = parseInt(parts[1]) || 600;
      if (!user) return res.json({ ok: false, message: 'Usage: /timeout user seconds [reason]' });
      const customReason = parts.slice(2).join(' ').trim();
      await tm.muteUser(channel, user, dur, 'console', !customReason, customReason || undefined);
      return res.json({ ok: true, message: `Timed out ${user} for ${dur}s${customReason ? ` — "${customReason}"` : ''}` });
    }
    if (cmd.startsWith('/ban ')) {
      const parts = cmd.substring(5).split(/\s+/);
      const user = parts[0];
      if (!user) return res.json({ ok: false, message: 'Usage: /ban user [reason]' });
      const customReason = parts.slice(1).join(' ').trim();
      await tm.banUser(channel, user, 'console', !customReason, customReason || undefined);
      return res.json({ ok: true, message: `Banned ${user}${customReason ? ` — "${customReason}"` : ''}` });
    }
    if (cmd.startsWith('/unban ') || cmd.startsWith('/untimeout ')) {
      const user = cmd.split(/\s+/)[1];
      if (!user) return res.json({ ok: false, message: 'Usage: /unban user' });
      await tm.unbanUser(channel, user, 'console');
      return res.json({ ok: true, message: `Unbanned ${user}` });
    }
    if (cmd === '/clear') {
      await tm.clearChat(channel);
      return res.json({ ok: true, message: 'Chat cleared' });
    }
    if (cmd.startsWith('/slow ')) {
      const sec = parseInt(cmd.split(/\s+/)[1]) || 30;
      await tm.setSlowMode(channel, sec);
      return res.json({ ok: true, message: `Slow mode: ${sec}s` });
    }
    if (cmd === '/slowoff') {
      await tm.setSlowMode(channel, 0);
      return res.json({ ok: true, message: 'Slow mode off' });
    }
    if (cmd === '/help') {
      return res.json({ ok: true, message: 'Commands: /timeout, /ban, /unban, /clear, /slow N, /slowoff' });
    }

    return res.json({ ok: false, message: `Unknown command: ${cmd.split(' ')[0]}` });
  } catch (err: any) {
    logger.error('POST /moderation/command error', err);
    res.status(500).json({ ok: false, message: err?.message || 'Internal error' });
  }
});
