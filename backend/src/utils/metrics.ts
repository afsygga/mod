import client from 'prom-client';

/*
 * Prometheus metrics on GET /metrics. Custom app metrics are prefixed afsyg_;
 * default process_ and nodejs_ series come from collectDefaultMetrics. The
 * record-/job- helpers keep the same signatures the rest of the backend already
 * calls, so instrumentation callsites don't change.
 *
 * Rules (see feature request / AGENTS.md): count real outcomes, never key by
 * channel/user/email/message — only fixed enum labels; point-in-time gauges are
 * filled via a provider on scrape (no SQL/Twitch calls on the scrape path).
 */

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

const C = (name: string, help: string, labelNames: string[] = []) =>
  new client.Counter({ name, help, labelNames, registers: [register] });
const G = (name: string, help: string, labelNames: string[] = [], collect?: () => void) =>
  new client.Gauge({ name, help, labelNames, registers: [register], collect });

// ── counters (cumulative outcomes) ───────────────────────────────────────────
const chatReceived   = C('afsyg_chat_messages_received_total', 'IRC message callbacks (incl. later dropped)');
const chatAccepted   = C('afsyg_chat_messages_accepted_total', 'Messages that passed routing + dedup');
const chatDropped    = C('afsyg_chat_messages_dropped_total', 'Dropped before spam decision', ['reason']);
const chatErrors     = C('afsyg_chat_processing_errors_total', 'Chat pipeline errors', ['stage']);
const spamDecisions  = C('afsyg_spam_decisions_total', 'One terminal SpamEngine decision per analyzed message', ['decision']);
const moderationCmds = C('afsyg_moderation_commands_total', 'Moderation actions at the Twitch boundary', ['action', 'result']);
const automodActions = C('afsyg_automod_actions_total', 'Automod Twitch actions', ['action', 'result']);
const tokenRefresh   = C('afsyg_twitch_token_refresh_total', 'OAuth token refresh attempts', ['kind', 'result']);
const ircReconnects  = C('afsyg_irc_reconnects_total', 'IRC reconnect churn', ['result']);
const esReconnects   = C('afsyg_eventsub_reconnects_total', 'EventSub reconnect churn', ['reason']);
const esRevocations  = C('afsyg_eventsub_revocations_total', 'EventSub subscription revocations');
const wsBroadcast    = C('afsyg_websocket_broadcast_attempts_total', 'ws.send to an open client');
const wsSendErrors   = C('afsyg_websocket_send_errors_total', 'ws.send throws');
const wsConnections  = C('afsyg_websocket_connections_total', 'WebSocket client churn', ['event']);
const dbPoolErrors   = C('afsyg_db_pool_errors_total', 'pg.Pool error events');
const processErrors  = C('afsyg_process_unhandled_errors_total', 'Unhandled process errors', ['kind']);
const jobRuns        = C('afsyg_background_job_runs_total', 'Completed background job runs', ['job', 'result']);
const suspicionEvents = C('afsyg_suspicious_user_events_total', 'Twitch suspicious-user EventSub notifications', ['source']);
const suspicionBonus  = C('afsyg_suspicion_score_bonus_applied_total', 'Messages whose spam score was raised by the Twitch suspicion signal');

// ── event-driven gauges ──────────────────────────────────────────────────────
const chatLastMessage = G('afsyg_chat_last_message_timestamp_seconds', 'Last message past routing/dedup');
const jobLastSuccess  = G('afsyg_background_job_last_success_timestamp_seconds', 'Last successful run', ['job']);
const jobLastComplete = G('afsyg_background_job_last_completion_timestamp_seconds', 'Last completed run', ['job']);
const jobLastDuration = G('afsyg_background_job_last_duration_seconds', 'Duration of last completed run', ['job']);
const jobInProgress   = G('afsyg_background_job_in_progress', 'Job currently running (0|1)', ['job']);
const oauthSessions   = G('afsyg_twitch_oauth_sessions', 'OAuth sessions by status', ['kind', 'status']);
const buildInfo       = G('afsyg_build_info', 'Build version + revision', ['version', 'revision']);
const suspiciousUsers = G('afsyg_suspicious_users_tracked', 'Users carrying a Twitch suspicion mark', ['state']);

// Zero-init known series so alert expressions have a baseline.
(['self', 'unknown_channel', 'non_primary', 'duplicate', 'command'] as const).forEach(r => chatDropped.labels(r).inc(0));
(['clean', 'queued', 'automod', 'whitelist_suppressed', 'role_ignored'] as const).forEach(d => spamDecisions.labels(d).inc(0));
(['timeout', 'ban', 'unban'] as const).forEach(a => (['success', 'fallback_success', 'error'] as const).forEach(r => moderationCmds.labels(a, r).inc(0)));
(['success', 'fallback_success', 'error'] as const).forEach(r => automodActions.labels('timeout', r).inc(0));
(['message', 'update'] as const).forEach(s => suspicionEvents.labels(s).inc(0));
(['flagged', 'cleared'] as const).forEach(s => suspiciousUsers.labels(s).set(0));

// ── point-in-time gauges (filled by a provider on scrape) ────────────────────
export interface Pit {
  ircGlobal: 'connected' | 'disconnected' | 'none';
  ircUser: { connected: number; disconnected: number };
  ircChannels: { connected: number; connecting: number; disconnected: number };
  eventsub: {
    requiredModerate: number; activeModerate: number;
    requiredStream: number; activeStream: number;
    connected: number; connecting: number; disconnected: number;
  };
  dbPool: { active: number; idle: number; waiting: number };
  wsClients: number;
  ready: boolean;
  subsystem: { globalIrc: boolean; twitchApi: boolean };
}
let pitProvider: (() => Pit) | null = null;
export function setPitProvider(fn: () => Pit): void { pitProvider = fn; }

const ircConnections = G('afsyg_irc_connections', 'IRC client state', ['kind', 'state']);
const ircChannels    = G('afsyg_irc_channels', 'Configured channel IRC coverage', ['state']);
const esConnections  = G('afsyg_eventsub_connections', 'EventSub WebSocket connection state', ['state']);
const esRequired     = G('afsyg_eventsub_subscriptions_required', 'Required EventSub subscriptions', ['type']);
const esActive       = G('afsyg_eventsub_subscriptions_active', 'Locally-active EventSub subscriptions', ['type']);
const dbPool         = G('afsyg_db_pool_connections', 'pg pool connections', ['state']);
const dbPoolWaiting  = G('afsyg_db_pool_waiting_requests', 'pg pool waiting requests');
const wsClients      = G('afsyg_websocket_clients', 'Open dashboard WebSocket clients');
const subsystemCfg   = G('afsyg_subsystem_configured', 'Subsystem configured (0|1)', ['subsystem']);
// backend_ready carries the point-in-time collect() that refreshes every PIT gauge.
const backendReady   = G('afsyg_backend_ready', 'Backend fully started (0|1)', [], () => {
  if (!pitProvider) return;
  const p = pitProvider();
  ircConnections.labels('global', 'connected').set(p.ircGlobal === 'connected' ? 1 : 0);
  ircConnections.labels('global', 'disconnected').set(p.ircGlobal === 'connected' ? 0 : 1);
  ircConnections.labels('user', 'connected').set(p.ircUser.connected);
  ircConnections.labels('user', 'disconnected').set(p.ircUser.disconnected);
  ircChannels.labels('connected').set(p.ircChannels.connected);
  ircChannels.labels('connecting').set(p.ircChannels.connecting);
  ircChannels.labels('disconnected').set(p.ircChannels.disconnected);
  esConnections.labels('connected').set(p.eventsub.connected);
  esConnections.labels('connecting').set(p.eventsub.connecting);
  esConnections.labels('disconnected').set(p.eventsub.disconnected);
  esRequired.labels('channel_moderate').set(p.eventsub.requiredModerate);
  esRequired.labels('stream_online').set(p.eventsub.requiredStream);
  esRequired.labels('stream_offline').set(p.eventsub.requiredStream);
  esActive.labels('channel_moderate').set(p.eventsub.activeModerate);
  esActive.labels('stream_online').set(p.eventsub.activeStream);
  esActive.labels('stream_offline').set(p.eventsub.activeStream);
  dbPool.labels('active').set(p.dbPool.active);
  dbPool.labels('idle').set(p.dbPool.idle);
  dbPoolWaiting.set(p.dbPool.waiting);
  wsClients.set(p.wsClients);
  subsystemCfg.labels('global_irc').set(p.subsystem.globalIrc ? 1 : 0);
  subsystemCfg.labels('twitch_api').set(p.subsystem.twitchApi ? 1 : 0);
  backendReady.set(p.ready ? 1 : 0);
});

// ── event-driven setters used outside the scrape path ────────────────────────
export function setOauthSessions(rows: { kind: string; status: string; count: number }[]): void {
  oauthSessions.reset();
  for (const r of rows) oauthSessions.labels(r.kind, r.status).set(r.count);
}
export function setBuildInfo(version: string, revision: string): void {
  buildInfo.labels(version || 'unknown', revision || 'unknown').set(1);
}

// ── record helpers (unchanged signatures) ────────────────────────────────────
export const recordChatReceived = () => chatReceived.inc();
export const recordChatAccepted = () => { chatAccepted.inc(); chatLastMessage.set(Date.now() / 1000); };
export const recordChatDropped = (reason: string) => chatDropped.labels(reason).inc();
export const recordChatError = () => chatErrors.labels('spam_engine').inc();
export const recordSpamDecision = (d: string) => spamDecisions.labels(d).inc();
export const recordModeration = (action: string, result: string) => moderationCmds.labels(action, result).inc();
export const recordAutomod = (action: string, result: string) => automodActions.labels(action, result).inc();
export const recordTokenRefresh = (kind: string, result: string) => tokenRefresh.labels(kind, result).inc();
export const recordIrcReconnect = (result: string) => ircReconnects.labels(result).inc();
export const recordEventsubReconnect = (reason: string) => esReconnects.labels(reason).inc();
export const recordEventsubRevocation = () => esRevocations.inc();
export const recordWsBroadcastAttempts = (n = 1) => wsBroadcast.inc(n);
export const recordWsSendError = () => wsSendErrors.inc();
export const recordWsOpen = () => wsConnections.labels('opened').inc();
export const recordWsClose = () => wsConnections.labels('closed').inc();
export const recordUnhandled = (kind: 'unhandled_rejection' | 'uncaught_exception') => processErrors.labels(kind).inc();
export const recordDbPoolError = () => dbPoolErrors.inc();
export const recordSuspicionEvent = (source: 'message' | 'update') => suspicionEvents.labels(source).inc();
export const recordSuspicionBonus = () => suspicionBonus.inc();
export function setSuspiciousTracked(flagged: number, cleared: number): void {
  suspiciousUsers.labels('flagged').set(flagged);
  suspiciousUsers.labels('cleared').set(cleared);
}

export function jobStart(name: string): number { jobInProgress.labels(name).set(1); return Date.now(); }
export function jobEnd(name: string, result: 'success' | 'partial' | 'error', startedAt: number): void {
  const now = Date.now();
  jobInProgress.labels(name).set(0);
  jobRuns.labels(name, result).inc();
  jobLastComplete.labels(name).set(now / 1000);
  jobLastDuration.labels(name).set((now - startedAt) / 1000);
  if (result !== 'error') jobLastSuccess.labels(name).set(now / 1000);
}
