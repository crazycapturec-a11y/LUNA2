import { Innertube } from 'youtubei.js';
import type { Types } from 'youtubei.js';

type FormatOptions = Types.FormatOptions;
type InnerTubeClient = Types.InnerTubeClient;

/**
 * Shared YouTube helpers for LUNA.
 *
 * Why this file exists:
 * The previous flow asked an external service (cobalt) for a stream URL and then
 * handed that raw `googlevideo.com` URL to the browser. Those URLs are bound to
 * the IP + session that requested them, send no CORS headers and expire after a
 * few hours — so `window.open(...)` / `<a download>` could never save a file.
 *
 * Extraction therefore has to happen where the bytes are actually fetched, on the
 * server. The API routes resolve the media here and stream the bytes back to the
 * browser through a same-origin endpoint that sets
 * `Content-Disposition: attachment`.
 */

const VIDEO_ID_RE =
  /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*?&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/;

export function extractVideoId(input: string): string | null {
  if (!input) return null;
  const match = input.trim().match(VIDEO_ID_RE);
  if (match) return match[1];
  // Bare IDs are handy for debugging / direct use.
  if (/^[\w-]{11}$/.test(input.trim())) return input.trim();
  return null;
}

/**
 * Progressive (video+audio) MP4 first, so users get a single playable file
 * without server-side muxing. Adaptive (video only) formats are only a fallback.
 */
const FORMAT_OPTIONS: FormatOptions[] = [
  { type: 'video+audio', quality: 'best', format: 'mp4' },
  { type: 'video+audio', quality: 'best' },
  { type: 'video', quality: 'best', format: 'mp4' },
  { type: 'video', quality: 'best' },
];

const AUDIO_FORMAT_OPTIONS: FormatOptions[] = [
  { type: 'audio', quality: 'best', format: 'mp4' },
  { type: 'audio', quality: 'best' },
];

/** Clients tried in order. Some IP ranges get bot-checked on one but not another. */
const CLIENTS: (InnerTubeClient | undefined)[] = [
  undefined, // library default (WEB)
  'MWEB',
  'IOS',
  'TV',
  'ANDROID',
];

let clientPromise: Promise<Innertube> | null = null;

/** One shared Innertube client per server instance (session + player are expensive). */
export function getInnertube(): Promise<Innertube> {
  if (!clientPromise) {
    clientPromise = Innertube.create({
      // Optional: cloud/datacenter IPs increasingly need a PO token for video data.
      // Set YT_PO_TOKEN in the environment if YouTube starts returning 403s.
      ...(process.env.YT_PO_TOKEN ? { po_token: process.env.YT_PO_TOKEN } : {}),
      ...(process.env.YT_VISITOR_DATA ? { visitor_data: process.env.YT_VISITOR_DATA } : {}),
      ...(process.env.YT_COOKIE ? { cookie: process.env.YT_COOKIE } : {}),
      lang: 'en',
      location: 'US',
      retrieve_player: true,
    }).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export type YouTubeClient = InnerTubeClient | 'default';

export type ResolvedVideo = {
  videoId: string;
  /** Client that produced this URL, so a rejected stream can try another one. */
  client: YouTubeClient;
  title: string;
  author: string;
  thumbnail: string;
  duration?: number;
  /** Direct, deciphered stream URL. Only usable from the machine that resolved it. */
  streamUrl: string;
  mimeType: string;
  contentLength?: number;
  isAudio: boolean;
};

type CacheEntry = { value: ResolvedVideo; expires: number };
const CACHE_TTL_MS = 20 * 60 * 1000; // googlevideo URLs expire; keep this short
const CACHE_MAX = 50;
const cache = new Map<string, CacheEntry>();

function readCache(key: string): ResolvedVideo | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key: string, value: ResolvedVideo) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

export async function resolveYouTubeVideo(
  videoId: string,
  kind: 'video' | 'audio' = 'video',
  options: { refresh?: boolean; excludeClients?: YouTubeClient[] } = {},
): Promise<ResolvedVideo> {
  const cacheKey = `${kind}:${videoId}`;
  const cached = options.refresh ? null : readCache(cacheKey);
  if (cached && !options.excludeClients?.includes(cached.client)) return cached;
  // Do not allow a previously rejected URL to be reused if refresh fails.
  if (options.refresh || cached) cache.delete(cacheKey);

  let yt: Awaited<ReturnType<typeof getInnertube>>;
  try {
    yt = await getInnertube();
  } catch (error) {
    throw new Error(humanizeYouTubeError(error));
  }

  const formats = kind === 'audio' ? AUDIO_FORMAT_OPTIONS : FORMAT_OPTIONS;

  let lastError: Error | null = null;

  for (const client of CLIENTS) {
    if (options.excludeClients?.includes(client ?? 'default')) continue;
    try {
      const info = await yt.getBasicInfo(videoId, client ? { client } : undefined);

      const status = info.playability_status;
      if (status?.status === 'LOGIN_REQUIRED') {
        lastError = new Error(
          'YouTube is asking for a sign-in for this video (age-restricted or bot-checked). Try another video.',
        );
        continue;
      }
      if (status?.status === 'UNPLAYABLE' || status?.status === 'ERROR') {
        lastError = new Error(status.reason || 'This video is not available.');
        continue;
      }
      if (!info.streaming_data) {
        lastError = new Error('This video has no downloadable stream (is it live?).');
        continue;
      }

      let format = null;
      for (const options of formats) {
        try {
          const candidate = info.chooseFormat(options);
          if (candidate?.url || candidate?.signature_cipher || candidate?.cipher) {
            format = candidate;
            break;
          }
        } catch {
          /* try the next format preference */
        }
      }
      if (!format) {
        lastError = new Error('No downloadable format was found for this video.');
        continue;
      }

      // Even a direct URL can contain YouTube's throttling parameter (n), which
      // youtubei.js must transform. Skipping decipher for format.url can make an
      // otherwise valid stream fail or download extremely slowly.
      const streamUrl = await format.decipher(yt.session.player);
      if (!streamUrl) {
        lastError = new Error('Could not resolve the video stream.');
        continue;
      }

      const thumbnails = info.basic_info.thumbnail || [];
      const resolved: ResolvedVideo = {
        videoId,
        client: client ?? 'default',
        title: info.basic_info.title || 'YouTube Video',
        author: info.basic_info.author || 'YouTube Creator',
        thumbnail:
          thumbnails[thumbnails.length - 1]?.url ||
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        duration: info.basic_info.duration,
        streamUrl,
        mimeType: format.mime_type?.startsWith('audio') ? 'audio/mp4' : 'video/mp4',
        contentLength: format.content_length,
        isAudio: !!format.mime_type?.startsWith('audio'),
      };

      writeCache(cacheKey, resolved);
      return resolved;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('YouTube extraction failed.');
    }
  }

  throw lastError || new Error('Could not reach YouTube. Please try again.');
}

/**
 * Fetch the media from YouTube. `Range` lets us cap how much we pull per request
 * and YouTube honours it (`accept-ranges: bytes`).
 */
export async function fetchYouTubeStream(streamUrl: string, range?: string | null) {
  return fetch(streamUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      accept: '*/*',
      origin: 'https://www.youtube.com',
      referer: 'https://www.youtube.com/',
      ...(range ? { range } : {}),
    },
  });
}

/** Turns low-level network failures into something a visitor can understand. */
export function humanizeYouTubeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/fetch failed|network|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i.test(message)) {
    return 'Could not reach YouTube from the server. Please try again in a moment.';
  }
  return message || 'Could not read this YouTube video.';
}

/** Filename safe for a Content-Disposition header (no CR/LF, quotes or slashes). */
export function safeFilename(name: string | null | undefined, fallback: string): string {
  const raw = (name || '').replace(/[\r\n"\\/]+/g, ' ').trim() || fallback;
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80)
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || fallback;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_') || 'luna-download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
