# Feature B — посекундная раскадровка стрима (scrub-preview)

Дата: 2026-07-27. Статус: спека на утверждение.

## Цель
На графике стрима: наведение на тайминг → **плавное посекундное превью-кадр**
(лучше storyboards Twitch, которые раз в 5–10с), клик → открыть VOD ровно на
этом моменте. Реализуется своей раскадровкой из HLS через ffmpeg.

## Зафиксированные решения
- Частота/качество: **3 к/с, ~360p** (ширина 640, высота auto).
- Одновременных стримов: **1–2** → лимит параллельных воркеров = 2, без сложной очереди.
- Ретенция: **пока жив VOD** (прокси: чистка спрайтов старше 30 дней + удаление,
  если Helix по `vod_id` вернул 404).
- **Фиче-флаг `preview_pipeline_enabled` (по умолчанию OFF).** Ничего не
  ингестится, пока не включён в админке. Это и изоляция риска (ToS/ресурсы).

## Архитектура
```
stream poller (есть) --live--> PreviewWorker.ensure(channel)
PreviewWorker:
  1. GQL PlaybackAccessToken(login) -> usher m3u8 (lowest video variant, ~360p)
  2. ffmpeg -i <m3u8> -vf fps=3,scale=640:-2 -> кадры JPEG в tmp
  3. пакуем кадры в спрайт-листы (N×M ячеек) на диск-том + мета
  4. пишем/обновляем stream_previews (session_id, vod_id, fps, cell w/h,
     cols, rows, sheets[], seconds_covered, updated_at)
offline (ended_at) -> воркер останавливается, спрайты остаются до ретенции
cleanup job (6ч) -> удаляет наборы старше 30д или с мёртвым vod_id
static route /previews/<session>/<sheet>.jpg -> отдаёт спрайты
API GET /api/streams/:id/previews -> мета + vod_id (для скраба и клика)
frontend StreamAreaChart -> hover: ячейка спрайта в анимированном поповере;
                            click: открыть twitch.tv/videos/<vod_id>?t=<offset>
```

## Внешние вызовы Twitch (приватный GQL — «серая зона», изолировано флагом)
- `POST https://gql.twitch.tv/gql` c web Client-ID (server-side, не в бандле):
  - `PlaybackAccessToken` для live (`isLive`, `login`) → `{signature, value}`.
  - usher: `https://usher.ttvnw.net/api/channel/hls/<login>.m3u8?sig=…&token=…&…`
    → master playlist → берём вариант с наименьшим разрешением, где есть видео.
  - `vod_id`: Helix `GET /videos?user_id&type=archive` (официально) — для клика в VOD.

## Файлы
Backend:
- `backend/src/preview/twitchGql.ts` — GQL playback token + usher m3u8 (изолирует «серую зону»).
- `backend/src/preview/PreviewWorker.ts` — per-channel ffmpeg + упаковка спрайтов, лимит 2, метрики.
- `backend/src/preview/previewRouter.ts` — `GET /api/streams/:id/previews` (мета) — монтируется в streamsRouter или отдельно.
- `backend/src/index.ts` — статик-раздача тома `/previews`, миграция `stream_previews`, cleanup-джоба, старт воркера по live-сигналу, флаг.
- `backend/Dockerfile` — установить `ffmpeg`; ENV `PREVIEW_STORAGE_DIR` (том).
- `docker-compose.yml` — том под кадры для backend.
Frontend:
- `Analytics.tsx` / `StreamAreaChart` — слой скраб-превью (hover → ячейка спрайта) + клик → VOD.
- Admin Steam-подобный тумблер «Скраб-превью стрима» → флаг `preview_pipeline_enabled`.

## Схема БД (миграция, идемпотентно)
```
CREATE TABLE IF NOT EXISTS stream_previews (
  session_id INTEGER PRIMARY KEY,
  channel_name VARCHAR(64) NOT NULL,
  vod_id VARCHAR(32),
  fps INTEGER NOT NULL,
  cell_w INTEGER NOT NULL, cell_h INTEGER NOT NULL,
  cols INTEGER NOT NULL, rows INTEGER NOT NULL,
  sheet_count INTEGER NOT NULL DEFAULT 0,
  seconds_covered INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
Секунда S → sheet = floor(S*fps / (cols*rows)); индекс ячейки внутри листа =
(S*fps) mod (cols*rows). Фронт по мете считает URL листа и позицию ячейки.

## Метрики (§17)
- job `preview_ingest` (jobStart/jobEnd), `afsyg_preview_workers_active` gauge,
  `afsyg_preview_frames_total{result}`, `afsyg_preview_ingest_errors_total{stage}`.

## Фазы (каждая = деплой + твоя проверка в проде на 1 канале)
- **B1 — ингест (флаг OFF):** Dockerfile ffmpeg + том; `twitchGql` + `PreviewWorker`
  + таблица + флаг + хук на live + метрики + cleanup. Проверка: включить флаг на
  канале в эфире → в томе появляются спрайты, растёт `seconds_covered`, метрики зелёные.
- **B2 — API + раздача:** статик-роут + `GET /api/streams/:id/previews`. Проверка:
  дёрнуть эндпоинт, увидеть мету; открыть картинку спрайта по URL.
- **B3 — фронт:** скраб-превью на графике (hover → ячейка, анимация) + клик → VOD.
  Проверка: на телефоне/десктопе навести на график открытого стрима.

## Риски и границы (явно)
- **Не проверяется локально** — только в проде на живом стриме, потому фазы+флаг.
- **ToS «серая зона»** (тянем HLS по приватному токену). Флаг OFF по умолчанию.
- **Live-край отстаёт** ~10с (кадр надо скачать+декод) — превью «прямо сейчас» неполное.
- **Ресурсы**: ffmpeg 3fps@360p из низкого HLS — умеренно; лимит 2 воркера.
- **VOD выключен у канала** → нет `vod_id`, клик-в-VOD не работает; скраб (свои кадры) всё равно работает, пока идёт ингест.
- **GQL может измениться** — вся «серая зона» в одном файле `twitchGql.ts`, чинится точечно.
