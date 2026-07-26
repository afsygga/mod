# API-референс

База в проде: `https://afsyg.gay/backend` (значение `VITE_API_URL`). Локально —
`http://localhost:4000`. Клиент — [`frontend/src/hooks/useApi.ts`](../frontend/src/hooks/useApi.ts)
(Bearer из localStorage, `401` чистит токен).

**Auth-уровни:** 🌐 публичный · 🔑 сессия (Bearer) · 🛡️ только `role=admin`.
Пути ниже — реальные роуты; точные параметры и тела смотри в исходниках роутеров
(`backend/src/**/`), чтобы не было расхождений при правках.

## Публичные (смонтированы до защищённых `/api/*`)

| Метод | Путь | Назначение |
|---|---|---|
| 🌐 GET | `/health` | Живость веб-слоя (`200` = ок) |
| 🌐 GET | `/ready` | Готовность (`503` до старта и при shutdown, иначе `200`); docker healthcheck |
| 🌐 GET | `/metrics` | Prometheus text exposition ([§17](../AGENTS.md)) |

## Аутентификация — `/api/auth` (rate-limit 10)

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| POST | `/api/auth/google` | 🌐 | Google-логин, проверка по whitelist → сессия |
| POST | `/api/auth/logout` | 🔑 | Завершить сессию |
| GET | `/api/auth/me` | 🔑 | Текущий пользователь |
| GET | `/api/auth/config` | 🌐 | Публичный конфиг фронта (GSI client id и т.п.) |

## Twitch-креденшелы и OAuth

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| GET/PUT/DELETE | `/api/twitch-creds` | 🔑 | Ручной ввод/чтение/удаление Twitch-токена |
| GET | `/api/twitch-creds/debug` | 🔑 | Диагностика состояния креденшелов |
| GET | `/api/twitch-oauth/connect-url` | 🔑 | Ссылка на OAuth-поток пользователя |
| GET | `/api/twitch-oauth/callback` | 🌐 | Колбэк user-потока (проверка подписи `state`, [§9](../AGENTS.md)) |
| GET | `/api/twitch-oauth/broadcaster-connect` | 🌐 | Старт broadcaster-потока (страница `/broadcaster`) |
| GET | `/api/twitch-oauth/broadcaster-callback` | 🌐 | Колбэк broadcaster-потока |

## Каналы, настройки, whitelist

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| GET/POST | `/api/channels` | 🔑 | Список / добавить канал |
| DELETE | `/api/channels/:name` | 🔑 | Удалить канал |
| PATCH | `/api/channels/:name/automod` | 🔑 | Вкл/выкл автомод на канале |
| PATCH | `/api/channels/:name/trigger` | 🔑 | `trigger_after_n` (реагировать после N повторов) |
| GET/PUT | `/api/settings` | 🔑 | Глобальные настройки движка (пороги, режимы) |
| GET/POST | `/api/whitelist/:channel` | 🔑 | Фразы-исключения канала |
| DELETE | `/api/whitelist/:channel/:id` | 🔑 | Удалить фразу |

## Модерация — `/api/moderation`

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| POST | `/api/moderation/mute` | 🔑 | Мут (таймаут) юзера |
| POST | `/api/moderation/ban` | 🔑 | Бан юзера |
| POST | `/api/moderation/unban` | 🔑 | Разбан |
| POST | `/api/moderation/bulk` | 🔑 | Массовое действие по выбранным |
| POST | `/api/moderation/command` | 🔑 | Консольная команда |
| GET | `/api/moderation/suspicious` | 🔑 | Метки подозрительности ([§20](../AGENTS.md)) |
| POST | `/api/moderation/suspicious/clear` | 🔑 | Снять метку вручную |
| GET | `/api/moderation/user/:username` | 🔑 | Профиль/история юзера |
| GET | `/api/moderation/avatar/:username` | 🔑 | Аватар (кэш `twitch_user_meta`) |

## Логи — `/api/logs`

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| GET | `/api/logs` | 🔑 | Список действий (только primary, [§18](../AGENTS.md)) |
| GET | `/api/logs/stats` | 🔑 | Реальные тоталы |
| GET | `/api/logs/:id/context` | 🔑 | Сообщения перед действием + co-actors |
| GET | `/api/logs/messages` | 🔑 | Сообщения канала |
| GET | `/api/logs/users` | 🔑 | Список юзеров |
| DELETE | `/api/logs/:id`, `/api/logs` | 🔑 | Удалить строку / очистить |

## Стримы и аналитика

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| GET | `/api/streams` | 🔑 | Сессии стримов |
| GET | `/api/streams/heatmap`, `/hourly-heatmap`, `/heatmap-detail` | 🔑 | Хитмапы активности |
| GET | `/api/streams/:id/stats` | 🔑 | Метрики одной сессии |
| GET | `/api/streams/:id/minute-detail` | 🔑 | Поминутная детализация |
| GET | `/api/streams/:id/games` | 🔑 | Смены категории внутри стрима ([§21](../AGENTS.md)) |
| GET | `/api/streams/:id/messages-by-minute` | 🔑 | Сообщения по минутам |
| GET | `/api/analytics/channels/:channel/moderators` | 🔑 | Модераторы канала |
| GET | `/api/analytics/stats/moderators` | 🔑 | Рейтинг модераторов |
| GET | `/api/analytics/day-summary` | 🔑 | Сводка за день |
| GET | `/api/analytics/stats/mod-activity` | 🔑 | Активность модераторов по времени |
| GET | `/api/analytics/moderators/:username/profile` | 🔑 | Профиль модератора |

## Telegram — `/api/telegram`

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| GET | `/api/telegram/status` | 🔑 | Статус привязки |
| PUT/DELETE | `/api/telegram/chat-id` | 🔑 | Привязать/отвязать chat_id |
| POST | `/api/telegram/toggle` | 🔑 | Вкл/выкл уведомления |
| POST | `/api/telegram/test` | 🔑 | Тестовый пинг |

## Админка — `/api/admin` 🛡️ (всё требует `role=admin`)

| Область | Пути |
|---|---|
| Здоровье/статус | `GET /health`, `GET /online`, `GET /channels/auth` |
| Пользователи | `GET /users`, `PATCH /users/:id`, `DELETE /users/:id` |
| Whitelist | `GET /whitelist`, `POST /whitelist`, `DELETE /whitelist/:id` |
| Каналы | `GET /channels`, `DELETE /channels/:name`, `GET /channels/:channel/moderators` |
| Логи/баны | `GET /logs`, `GET /bans` |
| Статистика | `GET /stats`, `/stats/timeline`, `/stats/moderators`, `/stats/mod-activity`, `/stats/live`, `/stats/channels-activity`, `/stats/efficiency`, `/stats/heatmap`, `/stats/heatmap-detail`, `/stats/hourly-heatmap` |
| Стримы | `GET /streams`, `GET /streams/:id/stats`, `GET /streams/:id/messages-by-minute`, `POST /streams/sync`, `DELETE /streams` |
| Модераторы | `GET /moderators/:username/profile` |
| Steam | `GET /steam`, `PUT /steam/settings`, `PUT /steam/links`, `DELETE /steam/links/:channel`, `PUT /steam/mappings`, `DELETE /steam/mappings/:game`, `POST /steam/sync` ([§22](../AGENTS.md)) |
| Аудит | `GET /audit` |

## WebSocket-события

Сервер рассылает всем клиентам дашборда через
[`websocket/wsHandler.broadcast`](../backend/src/websocket/wsHandler.ts). Каждое
сообщение — JSON с полем `type`:

| `type` | Когда | Основные поля |
|---|---|---|
| `message` | Каждое сообщение чата после анализа | `channel, username, message, role, score, reasons, ts` |
| `queue_add` | Score ≥ порога детекта | `channel, username, score, reasons, lastMsg, suspicion` |
| `mod_action` | Действие модерации (в т.ч. из EventSub) | действие, канал, цель, модератор |
| `user_muted` / `user_banned` | Мут / бан применён | `channel, username` |
| `channel_status` | Смена статуса коннекта канала | `channel, status` |
| `channel_removed` | Канал удалён | `channel` |
| `connected` | Установлен IRC-коннект | — |
| `stream_start` / `stream_end` | Старт/энд сессии стрима | `channel`, данные сессии |
| `game_change` | Смена категории внутри стрима ([§21](../AGENTS.md)) | `channel, game` |
| `steam_category` | Категория сменена из Steam ([§22](../AGENTS.md)) | `channel, category` |
| `suspicious_user` | Метка подозрительности изменена/снята ([§20](../AGENTS.md)) | `channel, username, ...` |
