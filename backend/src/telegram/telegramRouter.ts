import { Router, Request, Response } from 'express';
import { TelegramBot } from './TelegramBot';
import { db } from '../database/db';

export const telegramRouter = Router();

// Bot configured check + per-user telegram status
telegramRouter.get('/status', async (req: Request, res: Response) => {
  const tg = TelegramBot.get();
  const email = req.user?.email;
  let userStatus: any = { chat_id: null, enabled: false };
  if (email) {
    const { rows } = await db.query(
      'SELECT telegram_chat_id, telegram_enabled FROM users WHERE email=$1',
      [email]
    );
    if (rows.length > 0) {
      userStatus = {
        chat_id: rows[0].telegram_chat_id,
        enabled: rows[0].telegram_enabled,
      };
    }
  }
  res.json({
    configured: !!tg,
    user: userStatus,
  });
});

// Save your chat_id (validates by sending a test message)
telegramRouter.put('/chat-id', async (req: Request, res: Response) => {
  const tg = TelegramBot.get();
  if (!tg) return res.status(400).json({ error: 'bot not configured by admin' });
  const { chat_id } = req.body;
  if (!chat_id) return res.status(400).json({ error: 'chat_id required' });
  const clean = String(chat_id).trim();
  if (!/^-?\d+$/.test(clean)) return res.status(400).json({ error: 'invalid chat_id format (numeric only)' });

  // Validate by sending a hello message
  const v = await tg.validateChatId(clean);
  if (!v.ok) return res.status(400).json({ error: v.error || 'cannot reach this chat. Send /start to the bot first.' });

  const email = req.user!.email;
  await db.query(
    'UPDATE users SET telegram_chat_id=$1, telegram_enabled=true WHERE email=$2',
    [clean, email]
  );
  res.json({ success: true });
});

// Toggle notifications for your account
telegramRouter.post('/toggle', async (req: Request, res: Response) => {
  const email = req.user!.email;
  const { enabled } = req.body;
  await db.query('UPDATE users SET telegram_enabled=$1 WHERE email=$2', [!!enabled, email]);
  res.json({ success: true });
});

// Disconnect telegram for your account
telegramRouter.delete('/chat-id', async (req: Request, res: Response) => {
  const email = req.user!.email;
  await db.query(
    'UPDATE users SET telegram_chat_id=NULL, telegram_enabled=false WHERE email=$1',
    [email]
  );
  res.json({ success: true });
});

// Send a test message to your own chat
telegramRouter.post('/test', async (req: Request, res: Response) => {
  const tg = TelegramBot.get();
  if (!tg) return res.status(400).json({ error: 'bot not configured' });
  const email = req.user!.email;
  const { rows } = await db.query('SELECT telegram_chat_id FROM users WHERE email=$1', [email]);
  const chatId = rows[0]?.telegram_chat_id;
  if (!chatId) return res.status(400).json({ error: 'connect your chat_id first' });
  await tg.sendMessageTo(chatId, '🔔 *Тестовое уведомление от afsyg\\.gay*\nЕсли видишь это \\- всё работает\\!');
  res.json({ success: true });
});
