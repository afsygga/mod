import { logger } from '../utils/logger';

/*
 * Приватный GraphQL Twitch (gql.twitch.tv) — «серая зона», изолирована здесь.
 * Нужна только фиче-B (scrub-preview): получить HLS-плейлист живой трансляции,
 * чтобы ffmpeg насэмплил кадры. Официальный Helix HLS live не отдаёт.
 *
 * Client-ID — публичный web-клиент Twitch (тот же, что использует браузерный
 * плеер и streamlink/yt-dlp). Держим на сервере, в бандл фронта не попадает.
 * Если Twitch сломает эндпоинт — чинить точечно тут.
 */

const GQL = 'https://gql.twitch.tv/gql';
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
// Персистентный запрос PlaybackAccessToken (стабильный хэш, что и у web-плеера).
const PAT_HASH = '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712';

interface PlaybackToken { value: string; signature: string; }

async function getLivePlaybackToken(login: string): Promise<PlaybackToken | null> {
  try {
    const r = await fetch(GQL, {
      method: 'POST',
      headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'PlaybackAccessToken',
        extensions: { persistedQuery: { version: 1, sha256Hash: PAT_HASH } },
        variables: { isLive: true, login, isVod: false, vodID: '', playerType: 'embed' },
      }),
    });
    if (!r.ok) { logger.warn(`[preview] gql token ${r.status} for ${login}`); return null; }
    const j: any = await r.json();
    const t = j?.data?.streamPlaybackAccessToken;
    if (!t?.value || !t?.signature) return null;
    return { value: t.value, signature: t.signature };
  } catch (err: any) {
    logger.warn(`[preview] gql token failed for ${login}: ${err?.message || err}`);
    return null;
  }
}

/** Парсит master m3u8, возвращает URL варианта с НАИМЕНЬШИМ разрешением (не audio_only). */
function pickLowestVideoVariant(master: string): string | null {
  const lines = master.split('\n');
  let best: { h: number; url: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    // audio_only не имеет RESOLUTION — пропускаем
    const resM = line.match(/RESOLUTION=(\d+)x(\d+)/);
    const url = (lines[i + 1] || '').trim();
    if (!resM || !url.startsWith('http')) continue;
    const h = parseInt(resM[2], 10);
    if (!best || h < best.h) best = { h, url };
  }
  return best?.url || null;
}

/**
 * URL HLS-варианта самого низкого качества для живого канала (для превью-кадров),
 * либо null (оффлайн / приватно / эндпоинт сломан).
 */
export async function getLiveLowResM3u8(login: string): Promise<string | null> {
  const tok = await getLivePlaybackToken(login);
  if (!tok) return null;
  const params = new URLSearchParams({
    client_id: WEB_CLIENT_ID,
    token: tok.value,
    sig: tok.signature,
    allow_source: 'true',
    allow_audio_only: 'true',
    fast_bread: 'true',
    player_backend: 'mediaplayer',
    playlist_include_framerate: 'true',
    reassignments_supported: 'true',
  });
  const usher = `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(login)}.m3u8?${params}`;
  try {
    const r = await fetch(usher);
    if (!r.ok) { logger.warn(`[preview] usher ${r.status} for ${login}`); return null; }
    const master = await r.text();
    const variant = pickLowestVideoVariant(master);
    if (!variant) logger.warn(`[preview] no video variant for ${login}`);
    return variant;
  } catch (err: any) {
    logger.warn(`[preview] usher failed for ${login}: ${err?.message || err}`);
    return null;
  }
}
