# AGENTS.md — afsyg.gay (Smart Twitch Moderation)

Гид для AI-агентов и разработчиков по этому репозиторию. Читать **до** внесения
изменений. Здесь — архитектура, деплой, переменные окружения, ключевые
инварианты и рантайм-грабли, на которых уже наступали.

---

## 1. Что это

Веб-система модерации Twitch-чатов. Прод: **https://afsyg.gay**.

- Ловит спам в чате (собственный движок), логирует все действия модераторов,
  показывает аналитику по стримам/модерам, умеет автомутить и менять категорию
  канала из чата (`!g`).
- Вход на сайт — по приглашению (Google-логин, только whitelisted email).
- Мониторинг чата — через IRC (tmi.js). Действия модераторов из ЛЮБОГО клиента
  (Chatterino, панель Twitch, другие боты) ловятся через Twitch EventSub.

Монорепо: `backend/` (Node + Express + TypeScript) и `frontend/` (React + Vite).

---

## 2. Технологии

**Backend** (`backend/`): Node, Express, TypeScript, `tmi.js` (IRC), `ws`
(WebSocket-сервер + EventSub-клиент), `pg` (Postgres), `winston` (логи).
Запуск: `tsx` в dev, `tsc → node dist` в проде. Тестов-фреймворка НЕТ — проверки
пишутся как одноразовые `tsx`-скрипты (см. §11).

**Frontend** (`frontend/`): React 18, Vite, TypeScript, `framer-motion`,
`lucide-react`. **Стили — инлайновые** (не CSS-модули, не Tailwind-классы кроме
пары утилит в `index.css`). Роутинг минимальный.

**БД**: PostgreSQL 15.

**Инфра**: Docker Compose (`docker-compose.yml`) — контейнеры `db`, `backend`,
`frontend`. CI: GitHub Actions → ghcr.io → Watchtower (см. §5).

---

## 3. Структура репозитория

```
backend/src/
  index.ts                 # entrypoint: express, миграции, порядок старта, монтирование роутов,
                           #   публичные /health, /ready, /metrics (ДО защищённых /api/*)
  database/db.ts           # pg Pool (db.query, poolStats)
  auth/
    authRouter.ts          # Google-логин, сессии
    authMiddleware.ts      # authenticate + requireAdmin (по users.role)
    twitchCredsRouter.ts   # ручной ввод/удаление Twitch-креденшелов (PUT/DELETE /api/twitch-creds)
    twitchOAuthRouter.ts   # OAuth-потоки: user (/connect-url,/callback) и broadcaster (/broadcaster-*),
                           #   подписанный state, проверка скоупов (§9)
  twitch/
    TwitchManager.ts       # IRC (глобальный бот + пер-юзер), Helix, стрим-поллер, setGame (!g)
    EventSubManager.ts     # channel.moderate v2 через WebSocket, по соединению на токен
    twitchToken.ts         # рефреш user/broadcaster токенов + app-токен (ЧИТАТЬ §8)
    tokenValidator.ts      # почасовая валидация всех OAuth-сессий
  spam-engine/SpamEngine.ts # движок детекта спама (чистая логика, без БД) — §14
  moderation/
    analyticsRouter.ts     # /api/analytics — модераторы, day-summary, mod-activity
    streamsRouter.ts       # /api/streams — сессии стримов, хитмапы
    logsRouter.ts          # /api/logs + /stats (реальные тоталы) + /:id/context (сообщения + co-actors)
    moderationRouter.ts    # мут/бан/разбан, bulk, консольные команды, профиль юзера
  channels/                # channelRouter, settingsRouter, whitelistRouter
  admin/adminRouter.ts     # /api/admin — только role=admin; /health (статус), /logs, /stats/*, /channels/auth
  telegram/                # TelegramBot + telegramRouter (уведомления)
  websocket/wsHandler.ts   # broadcast(wss, data), список онлайн-юзеров
  utils/
    logger.ts              # winston + кольцевой буфер последних warn/error (recentIssues) для Health
    metrics.ts             # Prometheus (prom-client): record*/job* хелперы, PIT-гейджи — §17
    modLog.ts              # ЕДИНАЯ запись в moderation_logs с дедупом primary/secondary/skipped — §18
    twitchMeta.ts          # backfillAvatars, fetchChannelModerators (401→refresh→retry)
    audit.ts               # admin_audit

frontend/src/
  components/
    Auth/LoginPage.tsx        # экран входа (Google), экран «доступ запрещён»
    Auth/TwitchSetup.tsx      # подключение Twitch-бота (OAuth + ручной токен), баннер reauth
    Admin/AdminPanel.tsx      # админка: Обзор, Здоровье, Пользователи, Whitelist, Каналы,
                              #   Баны, Все логи, Модераторы, Аудит
    Analytics/Analytics.tsx   # аналитика: модераторы (+фильтр по дню, day-summary), стримы, хитмапы
    Logs/Logs.tsx             # логи: раскрытие строки → сообщения перед действием + co-actors
    ModerationQueue/, ChatWindow/, Settings/, UserCard/, CommandConsole/, Footer/, PatchNotes/
    common/ChatterName.tsx    # ник чаттера: средний клик → Twitch viewercard popout (§19)
  pages/BroadcasterAuth.tsx   # страница /broadcaster — раздаётся стримерам для !g
  hooks/useApi.ts             # api.get/post/put/delete, BASE = VITE_API_URL, Bearer из localStorage
  hooks/useAuth.tsx, useWebSocket.ts, useIsMobile.ts

frontend/VERSION            # версия, вшивается в бандл (см. §10). БАМПАТЬ КАЖДЫЙ deploy фронта.
docker/init.sql             # схема БД для ПЕРВОЙ инициализации контейнера db
docker-compose.yml          # прод-стек (+ healthcheck бэкенда на /ready)
backend/Dockerfile          # ARG GIT_REVISION → ENV (afsyg_build_info), HEALTHCHECK /ready
.github/workflows/docker.yml # сборка образов, передаёт GIT_REVISION=github.sha
AGENTS.md                   # этот файл
.env                        # секреты (gitignored, НЕ в репо; лежит на хосте рядом с compose)
```

---

## 4. Локальная разработка

```bash
# backend
cd backend && npm install
npx tsc --noEmit          # проверка типов (быстро, без сборки)
npm run dev               # tsx watch (нужен Postgres + .env)
npm run build             # tsc → dist/

# frontend
cd frontend && npm install
npx tsc --noEmit
npm run dev               # vite, слушает http://localhost:3000
npm run build             # tsc && vite build
```

Превью фронта агентом — через `.claude/launch.json` (конфиг `frontend-dev`,
порт 3000). Локально бэкенда обычно нет → в консоли будут `[WS] error` (это
норма), а `VITE_GOOGLE_CLIENT_ID` не задан → на логине покажется предупреждение
вместо кнопки Google (в проде оно вшито при сборке).

---

## 5. Деплой (КРИТИЧНО понимать)

**Триггер — push в `main`.** Дальше автоматически:

1. GitHub Actions (`.github/workflows/docker.yml`) в ОДНОМ job собирает **оба**
   образа и пушит в ghcr.io: `ghcr.io/afsygga/afs-backend:latest` и
   `afs-frontend:latest`. Любой push пересобирает оба (даже если менялся один).
2. На хосте **Watchtower** сам подтягивает новые образы и пересоздаёт контейнеры.
   Обычно 1–3 минуты после успешной сборки.

Отдельного ручного деплоя нет. Что нужно помнить:

- **Стандартное разрешение: пушить в `main` без спроса** (см. память
  `always-push-to-main`). Силовые операции (force-push, reset --hard) — нет.
- После пуша: дождаться `conclusion: success` в Actions, затем Watchtower.
  Проверка версии фронта в проде:
  `curl -s https://afsyg.gay/$(curl -s https://afsyg.gay/ | grep -o 'assets/index-[^"]*\.js') | grep -o '"2\.[0-9]*"'`
- **Env НЕ едет из CI.** Секреты живут в `.env` на хосте рядом с
  `docker-compose.yml`. Watchtower сохраняет env, «запечённый» в контейнер при
  создании. Если контейнер пересоздали `docker compose up` без `.env` рядом —
  переменные пропадут (это уже случалось, см. §12).

Прод-роутинг (хостовый reverse-proxy, вне репо): `afsyg.gay/backend/*` и `/ws` →
контейнер backend:4000; `/` → контейнер frontend:80. Внутри фронт-контейнера
`frontend/nginx.conf` дополнительно: SPA-fallback на `index.html`, **`index.html`
= `Cache-Control: no-cache`**, **`/assets/` = immutable** (см. §12, деплой-белый-экран).

---

## 6. Переменные окружения (`.env` на хосте)

| Переменная | Назначение |
|---|---|
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | OAuth, рефреш токенов, EventSub, app-токен. **Без них ломается ВСЁ, что касается Twitch.** |
| `TWITCH_BOT_USERNAME` / `TWITCH_BOT_OAUTH` | Глобальный IRC-бот (статичный токен, БЕЗ refresh — при протухании чинится только вручную, см. §7/§8) |
| `GOOGLE_CLIENT_ID` | Вход на сайт. Во фронт вшивается при сборке как `VITE_GOOGLE_CLIENT_ID` |
| `ADMIN_EMAIL` | При старте бутстрапится в whitelist + делается role=admin |
| `POSTGRES_USER/PASSWORD/DB`, `DATABASE_URL` | БД |
| `JWT_SECRET` | Подпись сессий + подпись OAuth `state` (см. §9) |
| `CORS_ORIGIN` | Разрешённые origin (через запятую) |
| `VITE_API_URL` (`https://afsyg.gay/backend`), `VITE_WS_URL` (`wss://afsyg.gay/ws`) | Build-time для фронта |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Уведомления (опционально) |

---

## 7. Аутентификация и токены — общая модель

**Вход на сайт:** Google Identity → `authRouter` проверяет email по `whitelist`
→ выдаёт сессию (Bearer-токен в localStorage, таблица `sessions`). `role` в
`users` (`user`/`admin`); `/api/admin/*` требует admin.

**Twitch-креденшелы — три независимых источника:**
1. **Пер-юзер логин** (`users.twitch_oauth` + `users.twitch_refresh`) — обычный
   вход «Войти через Twitch» в TwitchSetup. Есть refresh, самообновляется.
   Скоуп `channel:manage:broadcast` в наборе с 30.06.2026 → покрывает `!g`.
2. **Broadcaster** (таблица `broadcaster_tokens`) — отдельный поток
   `/broadcaster` для стримеров без аккаунта на сайте. Refresh хранится с
   01.07.2026 (более ранние записи мертвы — access протух за ~4ч).
3. **Глобальный бот** (`TWITCH_BOT_OAUTH` из env) — статичный IRC-токен, БЕЗ
   refresh. При протухании — только ручная перегенерация.

**IRC-нюанс (tmi.js):** соединение живёт после протухания токена (Twitch
проверяет токен только при коннекте), но при ЛЮБОМ реконнекте с мёртвым токеном
Twitch отвечает «Login authentication failed», и tmi.js **навсегда** выключает
свой авто-реконнект. Поэтому: пер-юзер соединения самолечатся (рефреш+реконнект,
`refreshAndReconnectUser`, гард 5 мин), а глобальный бот с мёртвым env-токеном —
нет. `restoreUserConnections()` при старте валидирует токен и рефрешит только при
подтверждённом 401.

---

## 8. Жизненный цикл рефреша токенов (`twitch/twitchToken.ts`) — САМОЕ ХРУПКОЕ

Здесь были P0-баги (потеря токенов). Инварианты, которые НЕЛЬЗЯ нарушать:

- **Рефреш «успешен» только после подтверждённой записи в БД.** Twitch ротирует
  refresh_token при каждом использовании — новая пара валидна лишь когда
  записана. При ошибке БД / `rowCount != 1` новый access ВЫБРАСЫВАЕТСЯ, кулдаун
  НЕ ставится, success НЕ логируется.
- **CAS-запись:** `UPDATE ... WHERE refresh = $old`. Если пока рефреш ходил в
  Twitch, пару изменил OAuth-колбэк / ручной PUT / DELETE / другой рефреш —
  `rowCount=0`, устаревший результат отбрасывается (не перезаписывает новее).
- **Валидация ответа** до записи: `access_token` и `refresh_token` — непустые
  строки, иначе malformed → БД не трогаем.
- **Invalid refresh (400/401) = permanent:** ставит `twitch_auth_status =
  'reauthorization_required'` в БД (переживает рестарты), глушит фоновые рефреши,
  поднимает баннер в UI. Temporary (429/5xx/сеть) — пару НЕ трогаем, ретрай позже.
- **Single-flight + кулдаун 60с** на аккаунт — против reuse-detection (два
  параллельных рефреша одним refresh-токеном → Twitch может отозвать грант).
- **App-токен** (`getAppToken`, client_credentials) — запасной для публичных
  Helix-эндпоинтов (`/streams`, `/users`); чеканится из client_id+secret, не
  зависит от пользовательских токенов.
- **Почасовой валидатор** (`tokenValidator.ts`) — при старте и раз в час
  валидирует ВСЕ сессии (user + broadcaster), штампует `last_validated`,
  реактивно рефрешит подтверждённо-протухшие.

Статусы: `users.twitch_auth_status` / `broadcaster_tokens.auth_status` ∈
`active | reauthorization_required | disconnected`.

---

## 9. OAuth `state` (`twitchOAuthRouter.ts`)

`state` — **HMAC-подписан** (`JWT_SECRET`), с TTL 10 мин, привязкой к flow
(`user`/`broadcaster`) и запретом «будущего» timestamp. Оба колбэка проверяют
подпись. Колбэки отклоняют неполный обмен (нет access ИЛИ refresh) и проверяют
скоупы: user-набор (chat/moderation), broadcaster — `channel:manage:broadcast`.
При нехватке скоупов — отказ со списком недостающих, а не молчаливый «успех».

> Примечание: подпись блокирует подделку/CSRF-привязку. Одноразовость (nonce
> store) НЕ реализована — это остаточное усиление, если понадобится.

---

## 10. Frontend-конвенции

- **`frontend/VERSION`** — единственный источник версии. Вшивается в бандл через
  `vite.config.ts` (`__APP_VERSION__`), показывается внизу справа. **Бампать при
  каждом деплое фронта** (иначе не отличить, докатился ли Watchtower).
- **Дизайн-система** (память `afsyg-dashboard-design-system`): карточки
  `rgba(255,255,255,0.03)` + `border rgba(255,255,255,0.06)` + `radius 14–16px`;
  **никогда `backdrop-filter`** (артефакт на Windows/Chrome, есть `.glass-card`
  без blur); цвета: purple `#a070ff`, cyan `#00e5cc`, yellow `#ffc800`, red
  `#ff5959`, green `#00c878`, фон `#050508`; текст `rgba(255,255,255,0.9)`/`0.4`.
- **Язык UI — русский** (некоторые строки билингвальны через `T[lang]`).
- **API**: `hooks/useApi.ts` — `api.get('/api/...')`, base = `VITE_API_URL`,
  Bearer из localStorage, 401 → чистит токен.
- **Иконки** — `lucide-react`. **Иконки/картинки только self-contained.**
- **Цвет серии привязывай к сущности, а не к позиции в массиве.** В графиках
  (например «Активность модераторов») строй карту `login → цвет` один раз и
  используй её для линии, точки, тултипа и легенды. Индексация `arr[i % palette]`
  ломается, как только массив где-то фильтруется (тултип скрывает нулевые), —
  один и тот же модератор получал разные цвета в тултипе и легенде.
- Экран логина крайне чувствителен к мельканиям на первом кадре: build-time
  значения читать синхронно в `useState`-инициализаторе, GSI-кнопку показывать
  после появления её iframe, входные framer-анимации при загрузке — не вешать
  (`AnimatePresence initial={false}`).

---

## 11. Как тестировать (нет тест-раннера)

Проверки — одноразовые `tsx`-скрипты в скретчпаде, мокающие `db.query`, `fetch`,
`ws`/`tmi`. Паттерн:

```ts
const { db } = require('.../backend/src/database/db');
db.query = async (sql, params) => { /* по подстроке sql вернуть rows/rowCount */ };
(global as any).fetch = async (url, init) => { /* мок Twitch/Helix */ };
// подмена модулей до require: require.cache[breq.resolve('ws')] = { exports: FakeWS }
const { X } = require('.../backend/src/...');  // require ПОСЛЕ моков
```

Обязательный минимум перед пушем: `npx tsc --noEmit` в затронутой части +
`npm run build`. Для чистой логики (SpamEngine, twitchToken) — гонять сценарные
скрипты; при правках токенов ОБЯЗАТЕЛЬНО проверять CAS-гонку и «мёртвый грант не
долбится».

---

## 12. Runbook — типовые поломки

**«Дашборд открыт, но сообщений нет / модеры не детектятся».** Веб-слой (health,
WS) обычно жив — мертво IRC-поступление. Диагностика (память
`irc-token-expiry-ingestion-death`): `curl https://afsyg.gay/health` (200 = веб
ок) → смотреть логи бэкенда. `Global IRC auth failed ... regenerate` →
перегенерировать `TWITCH_BOT_OAUTH` в `.env` + перезапуск. `token refresh failed
— user must re-authorize` → модератору перезайти через OAuth. Код не воскрешает
отозванный грант и статичный env-токен.

**`{"error":"TWITCH_CLIENT_ID not set"}` при входе через Twitch / пусто в
аналитике / стримы не видны.** В контейнере бэкенда нет env. Проверить:
`docker exec twitchmod_backend printenv | grep TWITCH`; починить `.env` рядом с
compose и `docker compose up -d --force-recreate backend`. Одна пропавшая
переменная роняет OAuth, рефреш, EventSub и детект стримов разом.

**Белый экран после деплоя фронта.** Причина в прошлом — `index.html` кэшировался
браузером и ссылался на исчезнувшие хэш-бандлы. Уже исправлено в `nginx.conf`
(`no-cache` на html, `immutable` на `/assets/`). Если повторится — проверить
эти заголовки в проде.

**«Задеплоил, а поведения нет».** Almost always: фронт докатился, а бэкенд-образ
на контейнере старый (или наоборот). Оба образа собираются в одном CI-run;
проверить, что Watchtower пересоздал ОБА. Быстрый маркер бэкенда: probe
`curl "https://afsyg.gay/api/twitch-oauth/broadcaster-callback?code=x"` — новый
код отвечает редиректом `...?error=invalid_state` (проверка подписи state).

**Слепой рефреш убил токены (историческое).** Причина — параллельные рефреши
одним refresh-токеном → reuse-detection Twitch отозвал грант. Лечится
single-flight (уже в коде). Не откатывать §8.

**`[eventsub] could not subscribe channel.moderate for <канал> (no mod token has
scopes/rights)` + `403 subscription missing proper authorization`.** Действия
модераторов этого канала, сделанные вне дашборда, НЕ попадут в логи/аналитику.
Это не баг кода: ни один авторизованный на сайте юзер не является модератором
этого канала, либо их гранты выданы до добавления EventSub-скоупов. Лечение —
кто-то, кто реально модер канала, входит через Twitch заново. Проверять по
вкладке **Здоровье** (у канала не горит «действия») и по статусам токенов.

**`Slow query (…ms): SELECT … FROM messages …` в логах.** Таблица `messages`
растёт без ограничений — каждый чат-месседж пишется навсегда, и аналитические
агрегаты по ней со временем замедляются (уже видели >1.5с). Не поломка, но
**известный хвост**: нужна ретенция (чистить старше N дней, кроме записей со
score выше порога) либо оптимизация запроса. См. §20.

---

## 13. Команда `!g` (смена категории)

`setGame` в `TwitchManager.ts`. Требует токен САМОГО стримера с
`channel:manage:broadcast` (мод-токен не годится). Собирает кандидатов и перебирает:
живой `broadcaster_tokens` → логин-токен стримера (`users.twitch_oauth`, где
`twitch_username` = имя канала); записи `reauthorization_required` пропускаются;
на 401 — один рефреш нужного токена и повтор; на 403 (нет скоупа) — рефреша нет,
пробуется следующий кандидат. Итог: **одной любой живой авторизации стримера
достаточно, отдельная `/broadcaster` больше не обязательна.** Плюс глобальный
флаг `setGameEnabled` в настройках должен быть включён (это не про авторизацию).
Алиасы: `!j` Just Chatting, `!cs` Counter-Strike, `!dota` Dota 2.

---

## 14. Спам-движок (`spam-engine/SpamEngine.ts`)

Чистая логика без БД: `analyze(username, message) → { score, reasons,
similarityPct, whitelistedFlood? }`. Профиль на юзера с историей (обрезается по
времени и до 50 записей), деривативы (norm/aggr/counts) считаются один раз при
вставке — иначе флуд делал analyze() O(n²). Правила: burst-окна, повторы
(edit-distance + cosine), эмоут/эмодзи-флуд, ротация A→B→A, промо/ссылки,
anti-evasion (leet + latin→cyrillic). `triggerAfterN` — не реагировать до N
повторов; хард-флуд (3+/10с) обходит гейт и вайтлист, но вайтлист-флуд помечается
`whitelistedFlood` → в очередь БЕЗ автомута. Idle-профили подметаются раз в 5 мин.

---

## 15. База данных

Схема первичной инициализации — `docker/init.sql` (выполняется docker-ом только
на пустом volume). Последующие изменения — **идемпотентные миграции** в
`runMigrations()` (`index.ts`): `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
`CREATE TABLE/INDEX IF NOT EXISTS`. При добавлении колонки — писать миграцию там,
а не только в init.sql (иначе на существующем проде колонки не будет).

Ключевые таблицы: `users` (+`twitch_*`, `twitch_auth_status`,
`twitch_last_validated`), `broadcaster_tokens` (+`auth_status`, `last_validated`),
`channels`, `channel_subscribers`, `messages`, `moderation_logs`
(+`primary_id` — группировка pile-on мутов, §18), `settings`, `whitelist`,
`channel_whitelist`, `twitch_user_meta`, `stream_sessions`, `sessions`,
`admin_audit`.

---

## 16. Правила работы в этом репо (кратко)

- Пушить в `main` можно без спроса; каждый push = прод-деплой обоих контейнеров.
- Менял фронт → бампни `frontend/VERSION`.
- Трогал `twitchToken.ts` / OAuth → перечитай §8–§9 и прогони токен-сценарии.
- Пишешь действие модерации → только через `logModerationAction` (§18), никогда
  напрямую `INSERT INTO moderation_logs`.
- Показываешь ник чаттера в UI → оборачивай в `ChatterName` (§19).
- Добавляешь значимую функцию → проверь, нужна ли метрика (§17).
- Не возвращай `backdrop-filter`. Не глотай ошибки в путях сохранения токенов.
- Секреты — только в `.env` на хосте, никогда в репо/логах/бандле.

## 17. Операционные метрики (Prometheus)

Метрики отдаются на **`GET /metrics`** (Prometheus text exposition) — [`backend/src/utils/metrics.ts`](backend/src/utils/metrics.ts), `prom-client`. Эндпоинт публичный внутри контейнера (без auth, без rate limit, смонтирован ДО защищённых `/api/*`), scrape не делает SQL/Twitch. Собственные метрики с префиксом `afsyg_`, стандартные `process_*`/`nodejs_*` — из `collectDefaultMetrics`. Есть `GET /ready` (`503` до полного старта и при shutdown, `200` после) и docker healthcheck на `/ready`; `afsyg_build_info{version,revision}` — версия из `backend/package.json` + git sha из Docker build-arg `GIT_REVISION` (workflow передаёт `github.sha`).

Инструментация — через `record*`/`job*`-хелперы у реальных исходов: приём чата (received/accepted/dropped/errors), одно spam-решение на сообщение, результаты модерации success/fallback_success/error, рефреш токенов (success/invalid_grant/temporary_error/db_error/cas_conflict/malformed_response, только после CAS-записи), EventSub/IRC churn, фоновые джобы, DB pool, WebSocket, process. Point-in-time гейджи (IRC/EventSub покрытие, DB pool, WS-клиенты, OAuth-сессии, ready) заполняются провайдером `setPitProvider` на scrape; OAuth-счётчики пересчитываются off-scrape (старт + раз в 5 мин). Вкладка **Здоровье** в админке осталась для человекочитаемого статуса (бот/каналы/токены/последние ошибки), но числовые метрики теперь в Prometheus.

**Правило при добавлении новых функций, интеграций, фоновых задач и значимых изменений:** сразу оцени, нужна ли метрика. Добавляй только полезные — те, что показывают, как продукт работает прямо сейчас: доступность и покрытие подсистем, пользовательски значимые ошибки, текущую нагрузку, backlog, throughput, latency реакции. Метрика должна помогать построить понятный дашборд, диагностировать проблему или сформулировать actionable-сигнал. Не плоди метрики ради количества, не дублируй nginx/Postgres/существующую аналитику, не тащи подробную бизнес-статистику. Конкретно:

- проектируй метрику одновременно с функцией, а не после инцидента;
- считай реальные исходы (success/error), а не факт входа в функцию/лог/broadcast;
- предпочитай gauge текущего проблемного состояния и timestamp последнего успеха, если обычный counter не показывает, продолжается ли проблема сейчас;
- НИКОГДА не клади в labels/ключи channel, username, email, message, token — только фиксированные enum'ы;
- ожидаемые внутренние ветки (`ignored`, dedup, штатный fallback) — не ошибки, если не означают ухудшение продукта.

---

## 18. Логирование действий модерации (дедуп pile-on)

**Все** записи в `moderation_logs` идут через `logModerationAction`
([`backend/src/utils/modLog.ts`](backend/src/utils/modLog.ts)) — никаких прямых
`INSERT`. Функция возвращает три исхода:

| Исход | Что значит | Последствия |
|---|---|---|
| `primary` | Первое действие инцидента (или свежее после истечения предыдущего) | Строка в списке логов, инкремент `user_profiles.mute_count`, broadcast |
| `secondary` | Другой модер замутил/забанил ТОГО ЖЕ юзера в течение **5с** после primary | Строка пишется (мод получает зачёт в своей статистике), но с `primary_id` → в списке логов не показывается, видна при раскрытии primary. Без инкремента `mute_count`, без broadcast |
| `skipped` | Повтор позже 5с, пока юзер всё ещё замучен/забанен | Не считается нигде |

«Всё ещё наказан» = предыдущий таймаут не истёк (`created_at + duration`) либо
бан без последующего разбана. После истечения/разбана следующий мут — снова
`primary`. `FLAGGED` (удаления сообщений) не дедупятся вообще; `UNBANNED` —
только против собственного эха (15с).

Списки логов (`/api/logs`, общий `/api/admin/logs`) показывают **только primary**
(`primary_id IS NULL`); per-модерский вид (`/api/admin/logs?moderator=`) показывает
и secondary — это вклад конкретного мода. Агрегаты статистики считают все строки,
поэтому pile-on модеры попадают в рейтинг.

---

## 19. Ники чаттеров в UI

Любой ник чаттера оборачивается в
[`frontend/src/components/common/ChatterName.tsx`](frontend/src/components/common/ChatterName.tsx):
средний клик (и ctrl/cmd/shift-клик) открывает карточку зрителя Twitch —
`https://www.twitch.tv/popout/<канал>/viewercard/<ник>` в новой вкладке. Обычный
левый клик подавляется (`preventDefault`), но событие всплывает, поэтому
клик-обработчики строки/карточки продолжают работать. Уже применено в логах,
очереди модерации, живом чате, админских логах/банах/топе нарушителей и
per-модерском логе. Нужен канал, где написано сообщение, — не подставляй чужой.

---

## 20. Известные хвосты (сделано НЕ всё)

Не считай это реализованным — осознанно отложено:

- **Latency-гистограммы Prometheus** (`afsyg_*_duration_seconds`: chat ingestion,
  SpamEngine, moderation action, EventSub delivery/processing, token refresh,
  stream detection) — в §17 их нет, есть только counters/gauges.
- **ACK-протокол доставки очереди** (`delivery_id` в `queue_add`, ответ
  `queue_ack` от фронта, `afsyg_queue_deliveries_total`,
  `afsyg_queue_reaction_latency_seconds`) — не реализован.
- **Ретенция `messages`** — таблица растёт бесконечно, аналитика по ней уже
  тормозит (см. §12). Нужен cron-джоб чистки.
- **Кулдаун уведомлений** — во время флуда модератор получает `queue_add` +
  Telegram-пинг на каждое сообщение спамера над порогом.
- **`Auto-rejoin <канал> failed: undefined`** — баг логирования, а не джоина:
  tmi.js при неудачном `join()` реджектится строкой, а код читает `err?.message`.
  Настоящая причина теряется. Чинится тривиально (`err?.message || err`).
- **Одноразовость OAuth `state`** — подпись есть (§9), nonce-store нет, поэтому
  replay в пределах TTL теоретически возможен.
- **Кросс-юзерная детекция рейдов** — `SpamEngine.analyze()` смотрит только
  историю одного юзера, скоординированный рейд (много аккаунтов по одному
  сообщению) не ловится.
