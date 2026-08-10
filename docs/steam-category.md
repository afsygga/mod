# Steam → категория Twitch — как реализовано

Полное описание текущей механики (`backend/src/steam/SteamSync.ts`,
`admin/adminRouter.ts` раздел Steam, `TwitchManager.setGame`). Прод: afsyg.gay.

## Идея
Стример запускает игру в Steam → категория на его Twitch-канале меняется сама.
Push-уведомлений у Steam нет — только опрос раз в 60с. Реагируем на СМЕНУ игры,
а не на факт её наличия.

## Данные (таблицы и настройки)
- **`steam_links`** — whitelist каналов (он же список автосмены):
  `channel_name` (PK), `steam_id64`, `enabled`, `last_game`, `last_appid`,
  `last_synced_at`, `last_change_at`, `last_result`.
- **`steam_category_map`** — ручные соответствия: `steam_game` → `twitch_category`
  (когда fuzzy-поиск Twitch промахивается или для особых случаев).
- **Настройки (`settings`)**:
  - `steam_sync_enabled` — глобальный выключатель всей синхронизации.
  - `steam_offline_enabled` — менять ли категорию, когда канал НЕ в эфире (дефолт выкл).
  - `steam_exit_category` — на что переключать при выходе из игры (`''` = не трогать).
- **Env `STEAM_API_KEY`** — без него синхронизация просто спит.

## Опрос (SteamSync.syncOnce, каждые 60с; джоба `steam_sync`)
1. Нет `STEAM_API_KEY` → выходим (предупреждение один раз).
2. Читаем все `steam_links`, обновляем метрику `afsyg_steam_links{state}`.
3. `steam_sync_enabled != true` → выходим.
4. `active` = привязки с `enabled` и заполненным `steam_id64`.
5. **Один** запрос `ISteamUser/GetPlayerSummaries` на все steamid (Steam принимает
   до 100), таймаут 10с. Берём `gameextrainfo` (название игры), `gameid` (appid),
   `personaname`, признак видимости профиля.
6. **Детект «в эфире» — НЕЗАВИСИМО от дашборда**, через Helix `/streams?user_login=…`
   (батч до 100, app-токен). НЕ через `stream_sessions` → работает для каналов,
   которых нет на дашборде (без рендера стрима/модерации). Helix недоступен →
   тик пропускается (не меняем вслепую).
7. Для каждого канала:
   - `game` = название из Steam (или null), `appId` = gameid.
   - Обновляем снимок для админки (что Steam показывает сейчас).
   - `isLive` = канал в live-множестве Helix; `justWentLive` = стал live с прошлого
     тика; `gameChanged` = `game !== last_game`.
   - **Когда меняем:** `shouldApply = isLive ? (gameChanged || justWentLive)
     : (offlineEnabled && gameChanged)`.
   - Не подходит → просто запоминаем (`last_game`/`last_synced_at`), идём дальше.
   - `target` = игра ? `resolveCategory(game)` : (`exit_category` или ничего).
     Нет target → запоминаем игру, категорию не трогаем.
   - Меняем через `TwitchManager.setGame(channel, target)`; метрика
     `afsyg_steam_category_changes_total{result}`.
   - `last_game/last_appid/last_change_at/last_result` двигаем в ЛЮБОМ случае
     (даже при неудаче — чтобы провал не долбил Twitch каждую минуту; причина в
     `last_result`, видна в админке).
   - Лог + WS-событие `steam_category` (живое обновление дашборда).

## resolveCategory
Сначала ручной маппинг `steam_category_map` (без учёта регистра) — он важнее.
Иначе — само название из Steam, а Twitch внутри `setGame` матчит его fuzzy-поиском.

## setGame (TwitchManager, тот же путь, что у `!g`, §13)
Нужен токен САМОГО стримера со скоупом `channel:manage:broadcast` (мод-токен не
годится). Перебор кандидатов: живой `broadcaster_tokens` → логин-токен стримера
(`users.twitch_oauth`, где `twitch_username` = канал); записи
`reauthorization_required` пропускаются; на 401 — один рефреш и повтор; на 403
(нет скоупа) — следующий кандидат. Итог `{ ok, message, category? }`.

## Гейт «работает / не работает»
Автосмена для канала произойдёт, если ВСЁ верно:
- глобальный `steam_sync_enabled` включён;
- канал есть в `steam_links` и `enabled`;
- задан корректный `steam_id64` (17 цифр);
- стример **авторизован** (есть живой токen) — в админке бейдж `АВТОРИЗОВАН`;
- канал в эфире (по Helix) — ИЛИ включён `steam_offline_enabled`;
- игра в Steam **сменилась** (или выход в эфир);
- Steam отдаёт игру (профиль публичный).

## Инварианты (§22)
- Реагируем на СМЕНУ игры, не на наличие → ручная правка категории живёт до
  запуска следующей игры.
- По умолчанию — только когда live; оффлайн-смена запоминается молча (искл. —
  тумблер `steam_offline_enabled`).
- Выход в эфир трактуется как смена (сценарий «запустил игру → пошёл стримить»).
- `last_game` двигается даже при неудаче.
- Ошибка Steam API не трогает ничего.
- Выход из игры меняет категорию, только если задан `steam_exit_category`.

## Админка (Admin → Steam) и API
- Глобальный тумблер, тумблер оффлайна, «при выходе из игры».
- «Привязанные каналы» (whitelist): канал ↔ SteamID + вкл/выкл, бейджи
  live / `АВТОРИЗОВАН`|`НЕТ ТОКЕНА`, последняя игра и `last_result`.
- Ручные соответствия имён (`steam_category_map`).
- Кнопка разовой синхронизации.
- Эндпоинты: `GET /api/admin/steam`, `PUT /steam/settings`, `PUT /steam/links`,
  `DELETE /steam/links/:channel`, `PUT /steam/mappings`, `DELETE /steam/mappings/:game`,
  `POST /steam/sync`.

## Метрики
`afsyg_steam_api_requests_total{result}`, `afsyg_steam_category_changes_total{result}`,
`afsyg_steam_links{state}`, джоба `steam_sync` (`afsyg_background_job_*`).

## Ограничения (не лечится кодом)
- Профиль Steam должен быть публичным («Данные об игре» = «Все»), иначе игра не
  видна снаружи (в админке — «Steam не отдаёт профиль»).
- Видит только игры из Steam — не лаунчеры, не браузерные.
- **Пиратки через Steam-эмулятор репортятся как «Spacewar» (appid 480)** — Steam
  не различает реальную игру. Сейчас это НЕ игнорируется: система попытается
  выставить «Spacewar». Возможные решения: игнор appid 480 (не реализован) или
  ручной маппинг «Spacewar» → нужная категория (одна на все пиратки).
