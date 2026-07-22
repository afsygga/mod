import { WebSocketServer } from 'ws';
import { db } from '../database/db';
import { logger } from '../utils/logger';
import { broadcast } from '../websocket/wsHandler';
import { jobStart, jobEnd, recordSteamApi, recordSteamCategoryChange, setSteamLinks } from '../utils/metrics';

/*
 * Steam → Twitch: стример запускает игру в Steam, категория на канале меняется
 * сама.
 *
 * Как это устроено и почему именно так:
 *
 * - Push-уведомлений у Steam нет вообще, только опрос. GetPlayerSummaries
 *   принимает до 100 steamid за раз, поэтому все привязанные каналы
 *   опрашиваются ОДНИМ запросом раз в минуту — лимит Steam (100k/сутки) при
 *   этом не приближается даже близко.
 *
 * - Реагируем на СМЕНУ игры, а не на её наличие. Если бы категория
 *   выставлялась на каждом тике, ручная правка категории стримером
 *   откатывалась бы через минуту. При такой схеме ручная правка живёт до
 *   следующего запуска другой игры.
 *
 * - Действуем только когда канал в эфире. Оффлайн смена игры запоминается
 *   молча, чтобы выход в эфир не сопровождался сменой категории на игру,
 *   запущенную три часа назад.
 *
 * - Момент выхода в эфир — исключение: он трактуется как смена, поэтому
 *   типовой сценарий «запустил игру → пошёл стримить» ставит правильную
 *   категорию сразу на старте.
 *
 * Ограничения, которые не лечатся кодом: Steam отдаёт игру только при
 * публичном профиле («Данные об игре» = «Все»), и видит только игры из Steam —
 * ни лаунчеры, ни браузерные игры сюда не попадают.
 */

const POLL_INTERVAL_MS = 60_000;
const STEAM_API = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/';

interface SteamLink {
  channel_name: string;
  steam_id64: string;
  enabled: boolean;
  last_game: string | null;
  last_appid: string | null;
}

export interface SteamPlayerState {
  steamId: string;
  personaName: string | null;
  game: string | null;
  appId: string | null;
  /** Профиль отдал данные (иначе, скорее всего, закрыт приватностью) */
  visible: boolean;
}

export class SteamSync {
  private wss: WebSocketServer;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  /** Каналы, которые были в эфире на прошлом тике — для детекта выхода в эфир */
  private liveBefore = new Set<string>();
  /** Последний снимок Steam для админки (что мы видим прямо сейчас) */
  private lastSeen = new Map<string, SteamPlayerState>();
  private warnedNoKey = false;

  constructor(wss: WebSocketServer) {
    this.wss = wss;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    logger.info('[steam] sync started');
    const tick = async () => {
      const startedAt = jobStart('steam_sync');
      let result: 'success' | 'partial' | 'error' = 'error';
      try {
        result = await this.syncOnce();
      } catch (err: any) {
        logger.error(`[steam] sync error: ${err?.message || err}`);
      } finally {
        jobEnd('steam_sync', result, startedAt);
        this.timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    tick();
  }

  stop(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.started = false;
  }

  /** Снимок для админки: что Steam показывает по каждому привязанному каналу. */
  getSeen(): Record<string, SteamPlayerState> {
    return Object.fromEntries(this.lastSeen);
  }

  /** Разовый прогон по требованию (кнопка «Синхронизировать сейчас»). */
  async runNow(): Promise<'success' | 'partial' | 'error'> {
    try { return await this.syncOnce(); } catch { return 'error'; }
  }

  private async isGloballyEnabled(): Promise<boolean> {
    const { rows } = await db.query("SELECT value FROM settings WHERE key='steam_sync_enabled'");
    return rows[0]?.value === 'true';
  }

  /** Категория, на которую переключаться при выходе из игры ('' = не трогать). */
  private async exitCategory(): Promise<string> {
    const { rows } = await db.query("SELECT value FROM settings WHERE key='steam_exit_category'");
    return (rows[0]?.value || '').trim();
  }

  private async syncOnce(): Promise<'success' | 'partial' | 'error'> {
    const apiKey = process.env.STEAM_API_KEY || '';
    if (!apiKey) {
      if (!this.warnedNoKey) {
        logger.warn('[steam] STEAM_API_KEY not set — Steam sync disabled');
        this.warnedNoKey = true;
      }
      return 'success'; // не настроено ≠ сломано
    }
    this.warnedNoKey = false;

    const { rows: links } = await db.query<SteamLink>('SELECT * FROM steam_links');
    setSteamLinks(links.filter(l => l.enabled).length, links.filter(l => !l.enabled).length);
    if (!(await this.isGloballyEnabled())) return 'success';

    const active = links.filter(l => l.enabled && l.steam_id64);
    if (active.length === 0) return 'success';

    // Один запрос на всех (Steam принимает до 100 id).
    const ids = active.map(l => l.steam_id64).slice(0, 100);
    let players: any[];
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10_000);
      const r = await fetch(`${STEAM_API}?key=${encodeURIComponent(apiKey)}&steamids=${ids.join(',')}`,
        { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) {
        recordSteamApi('error');
        logger.warn(`[steam] API ${r.status}`);
        return 'error';
      }
      const data: any = await r.json();
      players = data?.response?.players || [];
      recordSteamApi('success');
    } catch (err: any) {
      recordSteamApi('error');
      logger.warn(`[steam] API request failed: ${err?.message || err}`);
      return 'error';
    }

    const byId = new Map<string, any>(players.map((p: any) => [String(p.steamid), p]));

    // Кто сейчас в эфире — смена категории имеет смысл только для них.
    const { rows: liveRows } = await db.query(
      'SELECT DISTINCT channel_name FROM stream_sessions WHERE ended_at IS NULL'
    );
    const liveNow = new Set<string>(liveRows.map((r: any) => String(r.channel_name).toLowerCase()));

    const exitCat = await this.exitCategory();
    const tm: any = (global as any).twitchManager;
    let hadFailure = false;

    for (const link of active) {
      const channel = link.channel_name.toLowerCase();
      const p = byId.get(link.steam_id64);
      const game: string | null = p?.gameextrainfo || null;
      const appId: string | null = p?.gameid ? String(p.gameid) : null;

      this.lastSeen.set(channel, {
        steamId: link.steam_id64,
        personaName: p?.personaname || null,
        game, appId,
        visible: !!p,
      });

      const isLive = liveNow.has(channel);
      const justWentLive = isLive && !this.liveBefore.has(channel);
      const gameChanged = game !== (link.last_game || null);

      // Оффлайн — запоминаем молча. Иначе выход в эфир сопровождался бы сменой
      // категории на игру, запущенную задолго до стрима.
      if (!isLive) {
        if (gameChanged) {
          await db.query(
            'UPDATE steam_links SET last_game=$2, last_appid=$3, last_synced_at=NOW() WHERE channel_name=$1',
            [link.channel_name, game, appId]
          ).catch(() => {});
        } else {
          await db.query('UPDATE steam_links SET last_synced_at=NOW() WHERE channel_name=$1',
            [link.channel_name]).catch(() => {});
        }
        continue;
      }

      // В эфире и ничего не поменялось — выход в эфир считаем сменой, чтобы
      // сценарий «запустил игру → пошёл стримить» отработал сразу.
      if (!gameChanged && !justWentLive) {
        await db.query('UPDATE steam_links SET last_synced_at=NOW() WHERE channel_name=$1',
          [link.channel_name]).catch(() => {});
        continue;
      }

      // Вышел из игры: трогаем категорию только если это явно настроено.
      const target = game ? await this.resolveCategory(game) : (exitCat || null);
      if (!target) {
        await db.query(
          'UPDATE steam_links SET last_game=$2, last_appid=$3, last_synced_at=NOW() WHERE channel_name=$1',
          [link.channel_name, game, appId]
        ).catch(() => {});
        continue;
      }

      const res = await tm?.setGame?.(channel, target, null)
        ?? { ok: false, message: 'TwitchManager недоступен' };
      recordSteamCategoryChange(res.ok ? 'success' : 'failed');
      if (!res.ok) hadFailure = true;

      // last_game двигаем в любом случае: иначе неудачная попытка повторялась
      // бы каждую минуту, долбя Twitch одним и тем же запросом. Причина отказа
      // сохраняется в last_result и видна в админке.
      await db.query(
        `UPDATE steam_links SET last_game=$2, last_appid=$3, last_synced_at=NOW(),
                                last_change_at=NOW(), last_result=$4
         WHERE channel_name=$1`,
        [link.channel_name, game, appId, res.message]
      ).catch(() => {});

      logger.info(`[steam] ${channel}: ${game || 'вышел из игры'} → ${target} (${res.ok ? 'ok' : res.message})`);
      broadcast(this.wss, {
        type: 'steam_category', channel, game, category: target,
        ok: res.ok, message: res.message, ts: Date.now(),
      });
    }

    this.liveBefore = liveNow;
    return hadFailure ? 'partial' : 'success';
  }

  /** Ручное соответствие важнее fuzzy-поиска Twitch внутри setGame. */
  private async resolveCategory(steamGame: string): Promise<string> {
    try {
      const { rows } = await db.query(
        'SELECT twitch_category FROM steam_category_map WHERE LOWER(steam_game)=LOWER($1)',
        [steamGame]
      );
      if (rows[0]?.twitch_category) return rows[0].twitch_category;
    } catch { /* fallback ниже */ }
    return steamGame;
  }
}
