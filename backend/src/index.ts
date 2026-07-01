import 'dotenv/config';

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { db } from './database/db';
import { channelRouter } from './channels/channelRouter';
import { whitelistRouter } from './channels/whitelistRouter';
import { moderationRouter } from './moderation/moderationRouter';
import { settingsRouter } from './channels/settingsRouter';
import { logsRouter } from './moderation/logsRouter';
import { authRouter } from './auth/authRouter';
import { twitchCredsRouter } from './auth/twitchCredsRouter';
import { twitchOAuthRouter } from './auth/twitchOAuthRouter';
import { telegramRouter } from './telegram/telegramRouter';
import { adminRouter } from './admin/adminRouter';
import { authenticate } from './auth/authMiddleware';
import { TwitchManager } from './twitch/TwitchManager';
import { EventSubManager } from './twitch/EventSubManager';
import { TelegramBot } from './telegram/TelegramBot';
import { wsHandler } from './websocket/wsHandler';
import { logger } from './utils/logger';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// ── Simple in-memory rate limiter ────────────────────────────────────────
// Limits: 10 requests per minute per IP on auth endpoints
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxPerMinute: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimitStore.get(ip);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(ip, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    entry.count++;
    if (entry.count > maxPerMinute) {
      return res.status(429).json({ error: 'Too many requests, try again in a minute.' });
    }
    next();
  };
}
// Clean up old entries every 5 minutes to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now > entry.resetAt) rateLimitStore.delete(ip);
  }
}, 300_000);

// Public
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));
app.use('/api/auth', rateLimit(10), authRouter);
app.use('/api/twitch-creds', twitchCredsRouter);
app.use('/api/twitch-oauth', twitchOAuthRouter);
app.use('/api/telegram', authenticate, telegramRouter);

// Admin (requires admin)
app.use('/api/admin', adminRouter);

// Protected — all moderation/channel routes require authentication
app.use('/api/channels', authenticate, channelRouter);
app.use('/api/whitelist', authenticate, whitelistRouter);
app.use('/api/moderation', authenticate, moderationRouter);
app.use('/api/settings', authenticate, settingsRouter);
app.use('/api/logs', authenticate, logsRouter);

wsHandler(wss);

const twitchManager = new TwitchManager(wss);
(global as any).twitchManager = twitchManager;

const eventSubManager = new EventSubManager(wss);
(global as any).eventSubManager = eventSubManager;

const PORT = parseInt(process.env.PORT || '4000');

async function runMigrations() {
  try {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_username VARCHAR(64)`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_oauth TEXT`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(32)`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_enabled BOOLEAN DEFAULT true`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mute_reason TEXT`);
    await db.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS trigger_after_n INTEGER DEFAULT 1`);
    // Channel subscribers (M:N) — many users can be moderators of the same channel
    await db.query(`
      CREATE TABLE IF NOT EXISTS channel_subscribers (
        channel_name VARCHAR(64) NOT NULL,
        user_email VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (channel_name, user_email)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_subscribers_user ON channel_subscribers(user_email)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_subscribers_channel ON channel_subscribers(channel_name)`);
    // Backfill from legacy owner_email — if a channel has owner, subscribe them
    await db.query(`
      INSERT INTO channel_subscribers (channel_name, user_email)
      SELECT name, owner_email FROM channels
      WHERE owner_email IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS channel_whitelist (
        id SERIAL PRIMARY KEY,
        channel_name VARCHAR(64) NOT NULL,
        phrase TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(channel_name, phrase)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_whitelist_channel ON channel_whitelist(channel_name)`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS twitch_user_meta (
        username VARCHAR(64) PRIMARY KEY,
        twitch_id VARCHAR(32),
        display_name VARCHAR(64),
        profile_image_url TEXT,
        account_created_at TIMESTAMPTZ,
        description TEXT,
        fetched_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_twitch_meta_created ON twitch_user_meta(account_created_at)`);
    // Migrate hard-coded default reason → empty if still set to old default
    await db.query(
      "UPDATE settings SET value='' WHERE key='mute_reason' AND value='Spam detected by TwitchMod'"
    );
    // Stream sessions — track live stream start/end per channel
    await db.query(`
      CREATE TABLE IF NOT EXISTS stream_sessions (
        id SERIAL PRIMARY KEY,
        channel_name VARCHAR(128) NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        title VARCHAR(256),
        game VARCHAR(128),
        peak_viewers INTEGER DEFAULT 0
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_streams_channel ON stream_sessions(channel_name)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_streams_started ON stream_sessions(started_at DESC)`);
    await db.query(`ALTER TABLE stream_sessions ADD COLUMN IF NOT EXISTS twitch_stream_id VARCHAR(32)`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_streams_twitch_id ON stream_sessions(twitch_stream_id) WHERE twitch_stream_id IS NOT NULL`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS broadcaster_tokens (
        twitch_login VARCHAR(64) PRIMARY KEY,
        twitch_id VARCHAR(32),
        access_token TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // One-time clean slate: wipe old stream history + chat messages so backend
    // tracking starts fresh from 2026-07-01. Guarded by a flag so it runs once.
    const { rows: resetFlag } = await db.query("SELECT 1 FROM settings WHERE key='reset_streams_2026_07_01'");
    if (resetFlag.length === 0) {
      await db.query('TRUNCATE stream_sessions RESTART IDENTITY');
      await db.query('TRUNCATE messages RESTART IDENTITY');
      await db.query("INSERT INTO settings (key, value) VALUES ('reset_streams_2026_07_01','done') ON CONFLICT (key) DO NOTHING");
      logger.info('One-time stream/messages reset applied');
    }
    logger.info('Migrations applied');
  } catch (err) {
    logger.error('Migration failed', err);
  }
}

async function bootstrapAdmin() {
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  if (!adminEmail) {
    logger.warn('ADMIN_EMAIL not set in env — first login will not get admin');
    return;
  }
  try {
    // Whitelist the admin email
    await db.query(
      `INSERT INTO whitelist (email, added_by, note) VALUES ($1, 'system', 'admin bootstrap')
       ON CONFLICT (email) DO NOTHING`,
      [adminEmail]
    );
    // Promote existing user to admin if exists
    await db.query(`UPDATE users SET role='admin', enabled=true WHERE email=$1`, [adminEmail]);
    logger.info(`Admin email bootstrapped: ${adminEmail}`);
  } catch (err) {
    logger.error('admin bootstrap failed', err);
  }
}

async function start() {
  try {
    await db.connect();
    logger.info('Database connected');

    await runMigrations();
    await bootstrapAdmin();
    TelegramBot.init();

    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (twitchManager.isConnected()) { clearInterval(check); resolve(); }
      }, 500);
      setTimeout(() => { clearInterval(check); resolve(); }, 15000);
    });

    // Reset all statuses — we attempt to join every channel on startup regardless of previous state
    await db.query("UPDATE channels SET status='disconnected'");
    const { rows } = await db.query('SELECT name FROM channels');
    for (const row of rows) {
      await twitchManager.joinChannel(row.name);
    }

    // Start background stream poller — tracks stream start/end 24/7,
    // independent of whether any browser has the dashboard open.
    twitchManager.startStreamPoller();

    // Start EventSub — captures ALL moderation actions (bans/timeouts/unbans/
    // deletes) from any client, live, and writes them to moderation_logs.
    eventSubManager.start();
  } catch (err) {
    logger.error('Startup failed', err);
    process.exit(1);
  }
}

start();
