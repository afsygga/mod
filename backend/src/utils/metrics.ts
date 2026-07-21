/**
 * Lightweight in-memory operational metrics for the admin System Health page.
 * Not Prometheus — a small structured snapshot rendered as live numbers in the
 * UI. Counters are cumulative since process start; timestamps are ms epoch.
 *
 * Rule of thumb (see AGENTS.md): count real outcomes (success/error), not
 * function entry; never key by channel/user/email/message — only fixed enums.
 */

type Counter = Record<string, number>;
const inc = (o: Counter, k: string, by = 1) => { o[k] = (o[k] || 0) + by; };

export interface JobMetric {
  success: number; partial: number; error: number;
  lastSuccessTs: number; lastCompletionTs: number; lastDurationMs: number; inProgress: boolean;
}

export const M = {
  startTs: Date.now(),
  chat: { received: 0, accepted: 0, processingErrors: 0, lastMessageTs: 0 },
  chatDropped: {} as Counter,          // reason: self|unknown_channel|non_primary|duplicate|command
  spamDecisions: {} as Counter,        // clean|queued|automod|whitelist_suppressed|role_ignored
  moderation: {} as Counter,           // "timeout:success" | "ban:error" | ...
  automod: {} as Counter,              // "timeout:success" | ...
  tokenRefresh: {} as Counter,         // "user:success" | "broadcaster:invalid_grant" | ...
  ircReconnects: {} as Counter,        // success|auth_error|error
  eventsubReconnects: {} as Counter,   // twitch_reconnect|socket_close|welcome_timeout|watchdog|connect_error
  eventsubRevocations: 0,
  ws: { broadcastAttempts: 0, sendErrors: 0, opened: 0, closed: 0 },
  dbPoolErrors: 0,
  process: { unhandledErrors: 0 },
  jobs: {} as Record<string, JobMetric>,
};

// ── chat pipeline ────────────────────────────────────────────────────────────
export const recordChatReceived = () => { M.chat.received++; };
export const recordChatAccepted = () => { M.chat.accepted++; M.chat.lastMessageTs = Date.now(); };
export const recordChatDropped = (reason: string) => inc(M.chatDropped, reason);
export const recordChatError = () => { M.chat.processingErrors++; };
export const recordSpamDecision = (d: string) => inc(M.spamDecisions, d);

// ── moderation ───────────────────────────────────────────────────────────────
export const recordModeration = (action: string, result: string) => inc(M.moderation, `${action}:${result}`);
export const recordAutomod = (action: string, result: string) => inc(M.automod, `${action}:${result}`);

// ── tokens ───────────────────────────────────────────────────────────────────
export const recordTokenRefresh = (kind: string, result: string) => inc(M.tokenRefresh, `${kind}:${result}`);

// ── IRC / EventSub ───────────────────────────────────────────────────────────
export const recordIrcReconnect = (result: string) => inc(M.ircReconnects, result);
export const recordEventsubReconnect = (reason: string) => inc(M.eventsubReconnects, reason);
export const recordEventsubRevocation = () => { M.eventsubRevocations++; };

// ── websocket ────────────────────────────────────────────────────────────────
export const recordWsBroadcastAttempts = (n = 1) => { M.ws.broadcastAttempts += n; };
export const recordWsSendError = () => { M.ws.sendErrors++; };
export const recordWsOpen = () => { M.ws.opened++; };
export const recordWsClose = () => { M.ws.closed++; };

// ── process / db ─────────────────────────────────────────────────────────────
export const recordUnhandled = () => { M.process.unhandledErrors++; };
export const recordDbPoolError = () => { M.dbPoolErrors++; };

// ── background jobs ──────────────────────────────────────────────────────────
function jobOf(name: string): JobMetric {
  if (!M.jobs[name]) M.jobs[name] = { success: 0, partial: 0, error: 0, lastSuccessTs: 0, lastCompletionTs: 0, lastDurationMs: 0, inProgress: false };
  return M.jobs[name];
}
export function jobStart(name: string): number { jobOf(name).inProgress = true; return Date.now(); }
export function jobEnd(name: string, result: 'success' | 'partial' | 'error', startedAt: number): void {
  const j = jobOf(name);
  j.inProgress = false;
  j.lastDurationMs = Date.now() - startedAt;
  j.lastCompletionTs = Date.now();
  if (result === 'success') { j.success++; j.lastSuccessTs = Date.now(); }
  else if (result === 'partial') { j.partial++; j.lastSuccessTs = Date.now(); }
  else j.error++;
}
