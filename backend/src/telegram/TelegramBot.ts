import { db } from '../database/db';
import { logger } from '../utils/logger';

interface QueueNotification {
  channel: string;
  username: string;
  message: string;
  score: number;
  reasons: string[];
  ownerEmail: string | null;
}

interface TgUser {
  email: string;
  name: string | null;
  role: 'admin' | 'user';
  enabled: boolean;
  telegram_chat_id: string | null;
  telegram_enabled: boolean;
}

export class TelegramBot {
  private token: string;
  private adminChatId: string;
  private lastUpdateId = 0;
  // Per-chat throttling: each chat has its own pending queue
  private pendingByChatId: Map<string, QueueNotification[]> = new Map();
  private flushTimers: Map<string, NodeJS.Timeout> = new Map();
  // Chat IDs we've already told "not registered" — silent after that
  private warnedUnauth: Set<string> = new Set();
  private static instance: TelegramBot | null = null;

  static get(): TelegramBot | null {
    return TelegramBot.instance;
  }

  static init(): TelegramBot | null {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const adminChatId = process.env.TELEGRAM_CHAT_ID || '';
    if (!token) {
      logger.info('Telegram bot: TELEGRAM_BOT_TOKEN not set, disabled');
      return null;
    }
    TelegramBot.instance = new TelegramBot(token, adminChatId);
    return TelegramBot.instance;
  }

  constructor(token: string, adminChatId: string) {
    this.token = token;
    this.adminChatId = String(adminChatId || '');
    this.startPolling();
  }

  /** Send admin chat_id by env (legacy) — for backward compat */
  getAdminChatId(): string { return this.adminChatId; }

  private async api(method: string, payload: Record<string, any>): Promise<any> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json: any = await res.json();
      if (!res.ok || !json?.ok) {
        logger.error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
      }
      return json;
    } catch (err: any) {
      logger.error(`Telegram api ${method} failed: ${err?.message}`);
      return null;
    }
  }

  private escapeMd(text: string): string {
    return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  /** Look up subscriber by chat_id. Returns null if not registered or disabled. */
  private async getSubscriberByChatId(chatId: string): Promise<TgUser | null> {
    const { rows } = await db.query(
      `SELECT email, name, role, enabled, telegram_chat_id, telegram_enabled
       FROM users WHERE telegram_chat_id=$1`,
      [String(chatId)]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /** Find target chat_ids for a channel — all subscribers with notifications enabled */
  private async getChannelSubscriberChats(channelName: string): Promise<string[]> {
    const { rows } = await db.query(
      `SELECT DISTINCT u.telegram_chat_id
       FROM channel_subscribers s
       JOIN users u ON u.email = s.user_email
       WHERE s.channel_name = $1
         AND u.telegram_chat_id IS NOT NULL
         AND u.telegram_enabled = true
         AND u.enabled = true`,
      [channelName]
    );
    const chats = rows.map((r: any) => r.telegram_chat_id).filter(Boolean);
    if (chats.length > 0) return chats;

    // No subscriber has TG. Only fallback to env adminChatId if there are NO
    // subscribers at all (orphan channel). If subscribers exist but turned off
    // notifications — respect their choice and send nothing.
    const subsCheck = await db.query(
      'SELECT COUNT(*)::int AS c FROM channel_subscribers WHERE channel_name=$1',
      [channelName]
    );
    if (subsCheck.rows[0].c === 0 && this.adminChatId) {
      // Orphan channel (no subscribers) — fallback to admin if env-configured
      // AND admin (env chat_id) hasn't turned off their own notifications
      const adm = await db.query(
        'SELECT telegram_enabled FROM users WHERE telegram_chat_id=$1',
        [this.adminChatId]
      );
      if (adm.rows.length === 0 || adm.rows[0].telegram_enabled !== false) {
        return [this.adminChatId];
      }
    }
    return [];
  }

  /** Schedule queue notification — routed to ALL channel subscribers */
  notifyQueueAdd(n: QueueNotification): void {
    (async () => {
      const chats = await this.getChannelSubscriberChats(n.channel);
      if (chats.length === 0) {
        logger.info(`Telegram: no subscribers with TG for channel=${n.channel}`);
        return;
      }
      for (const chatId of chats) {
        const queue = this.pendingByChatId.get(chatId) || [];
        queue.push(n);
        this.pendingByChatId.set(chatId, queue);
        if (!this.flushTimers.has(chatId)) {
          const timer = setTimeout(() => this.flush(chatId), 3000);
          this.flushTimers.set(chatId, timer);
        }
      }
      logger.info(`Telegram: queued notification for ${n.username} → ${chats.length} chats`);
    })().catch(err => logger.error('notifyQueueAdd error', err));
  }

  private async flush(chatId: string): Promise<void> {
    this.flushTimers.delete(chatId);
    const batch = this.pendingByChatId.get(chatId) || [];
    this.pendingByChatId.delete(chatId);
    if (batch.length === 0) return;

    let text: string;
    if (batch.length === 1) {
      const n = batch[0];
      text =
        `🚨 Спам в очереди\n` +
        `Канал: ${n.channel}\n` +
        `Юзер: ${n.username}\n` +
        `Score: ${n.score}\n` +
        `Причины: ${n.reasons.slice(0, 3).join(', ')}\n` +
        `\n${n.message.slice(0, 200)}`;
    } else {
      const byChannel = new Map<string, QueueNotification[]>();
      for (const n of batch) {
        if (!byChannel.has(n.channel)) byChannel.set(n.channel, []);
        byChannel.get(n.channel)!.push(n);
      }
      const parts: string[] = [`🚨 Spam wave — ${batch.length} в очереди`];
      for (const [channel, items] of byChannel) {
        parts.push(`\n${channel}:`);
        for (const i of items.slice(0, 5)) {
          parts.push(`• ${i.username} (${i.score})`);
        }
        if (items.length > 5) parts.push(`• ... и ещё ${items.length - 5}`);
      }
      text = parts.join('\n');
    }

    const first = batch[0];
    const inline_keyboard = batch.length === 1 ? [[
      { text: '🔇 Mute 10m', callback_data: `mute:${first.channel}:${first.username}:600` },
      { text: '⏰ 1h',       callback_data: `mute:${first.channel}:${first.username}:3600` },
      { text: '🔨 Ban',      callback_data: `ban:${first.channel}:${first.username}` },
    ], [
      { text: '✅ Пропустить', callback_data: `skip:${first.channel}:${first.username}` },
      { text: '🔕 Выключить уведомления', callback_data: 'notif:off' },
    ]] : [[
      { text: '📊 Открыть панель', url: process.env.CORS_ORIGIN || 'https://afsyg.gay' },
      { text: '🔕 Выключить', callback_data: 'notif:off' },
    ]];

    await this.api('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard },
    });
  }

  async sendMessageTo(chatId: string, text: string, opts: any = {}): Promise<void> {
    await this.api('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'MarkdownV2',
      ...opts,
    });
  }

  /** Validate chat_id by sending a hello message. Returns true on success. */
  async validateChatId(chatId: string): Promise<{ ok: boolean; error?: string }> {
    const r = await this.api('sendMessage', {
      chat_id: chatId,
      text: '✅ *afsyg\\.gay* подключён\\!\nТеперь ты будешь получать уведомления о спаме на твоих каналах\\.',
      parse_mode: 'MarkdownV2',
    });
    if (!r || !r.ok) {
      return { ok: false, error: r?.description || 'cannot reach this chat_id' };
    }
    // Successful registration — clear previous unauth warning state if any
    this.warnedUnauth.delete(String(chatId));
    return { ok: true };
  }

  /** Long-poll for commands & button callbacks */
  private startPolling() {
    const loop = async () => {
      try {
        const res = await this.api('getUpdates', {
          offset: this.lastUpdateId + 1,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        });
        if (res?.ok) {
          for (const update of res.result || []) {
            this.lastUpdateId = update.update_id;
            try {
              if (update.message) await this.handleMessage(update.message);
              if (update.callback_query) await this.handleCallback(update.callback_query);
            } catch (err) {
              logger.error('Telegram update handler error', err);
            }
          }
        }
      } catch (err) {
        logger.error('Telegram poll error', err);
      }
      setTimeout(loop, 100);
    };
    loop();
    logger.info('Telegram bot polling started');
  }

  private async handleMessage(msg: any): Promise<void> {
    const chatId = String(msg.chat?.id || '');
    const text = String(msg.text || '').trim();
    if (!text) return;

    // Look up subscriber
    const sub = await this.getSubscriberByChatId(chatId);
    const isAdmin = sub?.role === 'admin' || chatId === this.adminChatId;

    // If unregistered AND not admin — send ONE warning, then silent forever
    if (!sub && chatId !== this.adminChatId) {
      if (!this.warnedUnauth.has(chatId)) {
        this.warnedUnauth.add(chatId);
        await this.sendMessageTo(chatId, '🚫 Вы не зарегистрированы\\.');
      }
      // Silent ignore on every subsequent message
      return;
    }

    if (sub && !sub.enabled) {
      await this.sendMessageTo(chatId, '🚫 Твой аккаунт отключён администратором\\.');
      return;
    }

    if (text === '/start' || text === '/help') {
      const baseCommands = `*afsyg\\.gay Bot*\n\n` +
        `Команды:\n` +
        `/stats \\- статистика модерации\n` +
        `/recent \\- последние 5 действий\n` +
        `/on \\- включить уведомления\n` +
        `/off \\- выключить уведомления\n` +
        `/mute @user 10m \\[channel\\]\n` +
        `/ban @user \\[channel\\]\n` +
        `/whoami \\- мой статус`;
      const adminCommands = `\n\n*Админ команды:*\n` +
        `/users \\- список подписчиков\n` +
        `/enable email \\- включить юзера\n` +
        `/disable email \\- выключить юзера\n` +
        `/revoke email \\- отключить TG\n` +
        `/broadcast text \\- рассылка всем`;
      await this.sendMessageTo(chatId, baseCommands + (isAdmin ? adminCommands : ''));
      return;
    }

    const [cmd, ...args] = text.split(/\s+/);
    const baseCmd = cmd.split('@')[0];

    switch (baseCmd) {
      case '/whoami':
        await this.sendMessageTo(chatId,
          `Email: \`${this.escapeMd(sub?.email || 'admin')}\`\n` +
          `Роль: *${sub?.role || 'admin'}*\n` +
          `Уведомления: ${sub?.telegram_enabled === false ? '🔕 OFF' : '✅ ON'}`
        );
        break;
      case '/on':
        await this.setUserNotifications(sub?.email || null, true);
        await this.sendMessageTo(chatId, '✅ Уведомления *включены*');
        break;
      case '/off':
        await this.setUserNotifications(sub?.email || null, false);
        await this.sendMessageTo(chatId, '🔕 Уведомления *выключены*');
        break;
      case '/stats':
        await this.sendStats(chatId, sub, isAdmin);
        break;
      case '/recent':
        await this.sendRecent(chatId, sub, isAdmin);
        break;
      case '/mute':
        await this.handleMuteCmd(chatId, sub, isAdmin, args);
        break;
      case '/ban':
        await this.handleBanCmd(chatId, sub, isAdmin, args);
        break;
      case '/users':
        if (isAdmin) await this.sendUsersList(chatId);
        else await this.sendMessageTo(chatId, 'Только для админа');
        break;
      case '/enable':
      case '/disable':
        if (isAdmin) await this.handleEnableDisable(chatId, args, baseCmd === '/enable');
        else await this.sendMessageTo(chatId, 'Только для админа');
        break;
      case '/revoke':
        if (isAdmin) await this.handleRevoke(chatId, args);
        else await this.sendMessageTo(chatId, 'Только для админа');
        break;
      case '/broadcast':
        if (isAdmin) await this.handleBroadcast(chatId, args.join(' '));
        else await this.sendMessageTo(chatId, 'Только для админа');
        break;
      default:
        await this.sendMessageTo(chatId, 'Неизвестная команда\\. /help для списка');
    }
  }

  private async setUserNotifications(email: string | null, enabled: boolean): Promise<void> {
    if (!email) return;
    await db.query('UPDATE users SET telegram_enabled=$1 WHERE email=$2', [enabled, email]);
  }

  private async getOwnedChannels(email: string): Promise<string[]> {
    const { rows } = await db.query(
      'SELECT channel_name AS name FROM channel_subscribers WHERE user_email=$1',
      [email]
    );
    return rows.map((r: any) => r.name);
  }

  private async sendStats(chatId: string, sub: TgUser | null, isAdmin: boolean): Promise<void> {
    try {
      let scope = '';
      const params: any[] = [];
      if (!isAdmin && sub) {
        const owned = await this.getOwnedChannels(sub.email);
        if (owned.length === 0) {
          await this.sendMessageTo(chatId, 'У тебя нет добавленных каналов');
          return;
        }
        params.push(owned);
        scope = ` AND channel_name = ANY($${params.length})`;
      }
      const [t24, queue, channels] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS c FROM moderation_logs WHERE action IN ('MUTED','AUTO_MUTED','BANNED') AND created_at > NOW() - INTERVAL '24 hours'${scope}`, params),
        db.query(`SELECT COUNT(*)::int AS c FROM messages WHERE spam_score >= 70 AND created_at > NOW() - INTERVAL '1 hour'${scope}`, params),
        isAdmin
          ? db.query(`SELECT name, status FROM channels`)
          : db.query(`SELECT c.name, c.status FROM channels c JOIN channel_subscribers s ON s.channel_name = c.name WHERE s.user_email=$1`, [sub!.email]),
      ]);
      const text = `📊 *Статистика*\n\n` +
        `За 24ч мутов/банов: *${t24.rows[0].c}*\n` +
        `Спам за последний час: *${queue.rows[0].c}*\n` +
        `Каналов: ${channels.rows.length} \\(${channels.rows.filter((c: any) => c.status === 'connected').length} активно\\)`;
      await this.sendMessageTo(chatId, text);
    } catch (err) {
      await this.sendMessageTo(chatId, 'Ошибка получения статистики');
    }
  }

  private async sendRecent(chatId: string, sub: TgUser | null, isAdmin: boolean): Promise<void> {
    try {
      let sql = `SELECT username, action, channel_name, created_at, duration_seconds FROM moderation_logs`;
      const params: any[] = [];
      if (!isAdmin && sub) {
        const owned = await this.getOwnedChannels(sub.email);
        if (owned.length === 0) {
          await this.sendMessageTo(chatId, 'У тебя нет добавленных каналов');
          return;
        }
        params.push(owned);
        sql += ` WHERE channel_name = ANY($1)`;
      }
      sql += ` ORDER BY created_at DESC LIMIT 5`;
      const { rows } = await db.query(sql, params);
      if (rows.length === 0) {
        await this.sendMessageTo(chatId, 'Истории пока нет');
        return;
      }
      const parts = ['*Последние 5 действий*\n'];
      for (const r of rows) {
        const time = new Date(r.created_at).toLocaleTimeString();
        const action = r.action === 'BANNED' ? '🔨' : '🔇';
        parts.push(`${action} \`${this.escapeMd(r.username)}\` \\| ${this.escapeMd(r.channel_name)} \\| ${this.escapeMd(time)}`);
      }
      await this.sendMessageTo(chatId, parts.join('\n'));
    } catch (err) {
      await this.sendMessageTo(chatId, 'Ошибка получения истории');
    }
  }

  private async assertChannelAccess(chatId: string, sub: TgUser | null, isAdmin: boolean, channel: string): Promise<boolean> {
    if (isAdmin) return true;
    if (!sub) return false;
    const { rows } = await db.query(
      'SELECT 1 FROM channel_subscribers WHERE channel_name=$1 AND user_email=$2',
      [channel, sub.email]
    );
    if (rows.length === 0) {
      await this.sendMessageTo(chatId, '🚫 Ты не подписан на этот канал');
      return false;
    }
    return true;
  }

  private async handleMuteCmd(chatId: string, sub: TgUser | null, isAdmin: boolean, args: string[]): Promise<void> {
    if (args.length < 1) return this.sendMessageTo(chatId, 'Использование: /mute username \\[duration\\] \\[channel\\]');
    const username = args[0].replace(/^@/, '').toLowerCase();
    const duration = args[1] ? this.parseDuration(args[1]) : 600;
    let channel = args[2];
    if (!channel) {
      const ownedQuery = (isAdmin || !sub)
        ? db.query(`SELECT name FROM channels WHERE status='connected' LIMIT 1`)
        : db.query(`SELECT c.name FROM channels c JOIN channel_subscribers s ON s.channel_name = c.name WHERE s.user_email=$1 AND c.status='connected' LIMIT 1`, [sub.email]);
      const { rows } = await ownedQuery;
      if (rows.length === 0) return this.sendMessageTo(chatId, 'Не указан канал, и нет активных');
      channel = rows[0].name;
    }
    if (!(await this.assertChannelAccess(chatId, sub, isAdmin, channel))) return;
    const tm = (global as any).twitchManager;
    if (tm) await tm.muteUser(channel, username, duration, sub?.email || 'telegram');
    await this.sendMessageTo(chatId, `🔇 \`${this.escapeMd(username)}\` mute ${this.escapeMd(this.formatDuration(duration))} в \`${this.escapeMd(channel)}\``);
  }

  private async handleBanCmd(chatId: string, sub: TgUser | null, isAdmin: boolean, args: string[]): Promise<void> {
    if (args.length < 1) return this.sendMessageTo(chatId, 'Использование: /ban username \\[channel\\]');
    const username = args[0].replace(/^@/, '').toLowerCase();
    let channel = args[1];
    if (!channel) {
      const ownedQuery = (isAdmin || !sub)
        ? db.query(`SELECT name FROM channels WHERE status='connected' LIMIT 1`)
        : db.query(`SELECT c.name FROM channels c JOIN channel_subscribers s ON s.channel_name = c.name WHERE s.user_email=$1 AND c.status='connected' LIMIT 1`, [sub.email]);
      const { rows } = await ownedQuery;
      if (rows.length === 0) return this.sendMessageTo(chatId, 'Не указан канал, и нет активных');
      channel = rows[0].name;
    }
    if (!(await this.assertChannelAccess(chatId, sub, isAdmin, channel))) return;
    const tm = (global as any).twitchManager;
    if (tm) await tm.banUser(channel, username, sub?.email || 'telegram');
    await this.sendMessageTo(chatId, `🔨 \`${this.escapeMd(username)}\` забанен в \`${this.escapeMd(channel)}\``);
  }

  /** Admin: list all telegram-registered users */
  private async sendUsersList(chatId: string): Promise<void> {
    const { rows } = await db.query(`
      SELECT u.email, u.name, u.role, u.enabled, u.telegram_enabled, u.last_login,
             (SELECT COUNT(*)::int FROM channel_subscribers WHERE user_email = u.email) AS channels
      FROM users u
      WHERE u.telegram_chat_id IS NOT NULL
      ORDER BY u.last_login DESC NULLS LAST
    `);
    if (rows.length === 0) {
      await this.sendMessageTo(chatId, 'Никто не подключил Telegram');
      return;
    }
    const parts: string[] = [`*Подписчики через Telegram* \\(${rows.length}\\)\n`];
    for (const u of rows) {
      const status = !u.enabled ? '🚫' : u.telegram_enabled === false ? '🔕' : '✅';
      const rolePrefix = u.role === 'admin' ? '👑 ' : '';
      const last = u.last_login ? new Date(u.last_login).toLocaleDateString() : '—';
      parts.push(`${status} ${rolePrefix}\`${this.escapeMd(u.email)}\``);
      parts.push(`   ${u.channels} канал, последний вход: ${this.escapeMd(last)}\n`);
    }
    parts.push(`\n_${this.escapeMd('/enable email — включить юзера')}_`);
    parts.push(`_${this.escapeMd('/disable email — выключить юзера')}_`);
    parts.push(`_${this.escapeMd('/revoke email — отключить TG юзера')}_`);
    await this.sendMessageTo(chatId, parts.join('\n'));
  }

  private async handleEnableDisable(chatId: string, args: string[], enable: boolean): Promise<void> {
    if (args.length < 1) return this.sendMessageTo(chatId, `Использование: /${enable ? 'enable' : 'disable'} email`);
    const email = args[0].toLowerCase();
    const { rowCount } = await db.query('UPDATE users SET enabled=$1 WHERE email=$2', [enable, email]);
    if (rowCount === 0) {
      await this.sendMessageTo(chatId, `Юзер \`${this.escapeMd(email)}\` не найден`);
      return;
    }
    await this.sendMessageTo(chatId, `${enable ? '✅' : '🚫'} \`${this.escapeMd(email)}\` ${enable ? 'включён' : 'выключен'}`);
  }

  private async handleRevoke(chatId: string, args: string[]): Promise<void> {
    if (args.length < 1) return this.sendMessageTo(chatId, 'Использование: /revoke email');
    const email = args[0].toLowerCase();
    const { rowCount } = await db.query(
      'UPDATE users SET telegram_chat_id=NULL, telegram_enabled=false WHERE email=$1',
      [email]
    );
    if (rowCount === 0) {
      await this.sendMessageTo(chatId, `Юзер \`${this.escapeMd(email)}\` не найден`);
      return;
    }
    await this.sendMessageTo(chatId, `🔕 \`${this.escapeMd(email)}\` отключён от Telegram`);
  }

  private async handleBroadcast(chatId: string, text: string): Promise<void> {
    if (!text.trim()) return this.sendMessageTo(chatId, 'Использование: /broadcast текст сообщения');
    const { rows } = await db.query(
      `SELECT telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND enabled=true AND telegram_enabled=true`
    );
    let sent = 0;
    for (const r of rows) {
      try {
        await this.api('sendMessage', {
          chat_id: r.telegram_chat_id,
          text: `📢 *Объявление от админа*\n\n${this.escapeMd(text)}`,
          parse_mode: 'MarkdownV2',
        });
        sent++;
      } catch {}
    }
    await this.sendMessageTo(chatId, `Отправлено: *${sent}* подписчикам`);
  }

  private parseDuration(s: string): number {
    const m = /^(\d+)([smhdw]?)$/i.exec(s);
    if (!m) return 600;
    const n = parseInt(m[1]);
    const u = (m[2] || 's').toLowerCase();
    return n * (u === 'm' ? 60 : u === 'h' ? 3600 : u === 'd' ? 86400 : u === 'w' ? 604800 : 1);
  }

  private formatDuration(s: number): string {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
  }

  private async handleCallback(cb: any): Promise<void> {
    const chatId = String(cb.message?.chat?.id || '');
    const sub = await this.getSubscriberByChatId(chatId);
    const isAdmin = sub?.role === 'admin' || chatId === this.adminChatId;
    if (!sub && chatId !== this.adminChatId) {
      await this.api('answerCallbackQuery', { callback_query_id: cb.id, text: 'Не зарегистрирован' });
      return;
    }
    const data = String(cb.data || '');
    const [action, ...rest] = data.split(':');
    try {
      if (action === 'mute' || action === 'ban') {
        const channel = rest[0];
        const username = rest[1];
        if (!(await this.assertChannelAccess(chatId, sub, isAdmin, channel))) {
          await this.api('answerCallbackQuery', { callback_query_id: cb.id, text: 'Не твой канал' });
          return;
        }
        const tm = (global as any).twitchManager;
        if (action === 'mute') {
          const dur = parseInt(rest[2]) || 600;
          if (tm) await tm.muteUser(channel, username, dur, sub?.email || 'telegram');
          await this.api('answerCallbackQuery', { callback_query_id: cb.id, text: `🔇 ${username} muted` });
        } else {
          if (tm) await tm.banUser(channel, username, sub?.email || 'telegram');
          await this.api('answerCallbackQuery', { callback_query_id: cb.id, text: `🔨 ${username} banned` });
        }
      } else if (action === 'skip') {
        await this.api('answerCallbackQuery', { callback_query_id: cb.id, text: 'Пропущено' });
      } else if (action === 'notif' && rest[0] === 'off') {
        if (sub?.email) await this.setUserNotifications(sub.email, false);
        await this.api('answerCallbackQuery', { callback_query_id: cb.id, text: '🔕 Уведомления выключены' });
      }
    } catch (err: any) {
      await this.api('answerCallbackQuery', { callback_query_id: cb.id, text: `Ошибка: ${err?.message}` });
    }
  }
}
