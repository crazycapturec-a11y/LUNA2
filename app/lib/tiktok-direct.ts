import { load } from 'cheerio';

const GENERIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
// Short links like vt.tiktok.com return an HTML <a href> when the UA looks like a
// browser without the Chrome token (see cobalt's tiktok.js).
const SHORT_UA = GENERIC_UA.split(' Chrome/1')[0];
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

export function normalizeTikTokUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !(host === 'tiktok.com' || host.endsWith('.tiktok.com'))
    )
      return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function isShortTikTokHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'vt.tiktok.com' || h === 'vm.tiktok.com' || h === 'vt-tiktok.com' || h.endsWith('.vt.tiktok.com') || h.endsWith('.vm.tiktok.com');
}

function safeMediaUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    const hosts = [
      'tiktok.com',
      'tiktokv.com',
      'tiktokv.us',
      'tiktokcdn.com',
      'tiktokcdn-us.com',
      'tiktokcdn-eu.com',
      'byteoversea.com',
      'ibytedtos.com',
      'muscdn.com',
      'musical.ly',
    ];
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    )
      return '';
    return url.href;
  } catch {
    return '';
  }
}

async function limitedText(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_PAGE_BYTES) return null;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

type Item = {
  id?: unknown;
  desc?: unknown;
  author?: { uniqueId?: unknown; nickname?: unknown };
  video?: {
    playAddr?: unknown;
    downloadAddr?: unknown;
    cover?: unknown;
    originCover?: unknown;
    duration?: unknown;
    bitrateInfo?: Array<{ CodecType?: unknown; PlayAddr?: { UrlList?: unknown } }>;
  };
  imagePost?: { images?: Array<{ imageURL?: { urlList?: unknown[] } }> };
  music?: { playUrl?: unknown };
};

type PageData = {
  __DEFAULT_SCOPE__?: { 'webapp.video-detail'?: { itemInfo?: { itemStruct?: Item }; statusMsg?: unknown } };
  ItemModule?: Record<string, Item>;
  // Some pages expose data differently
  Scope?: { 'webapp.video-detail'?: { itemInfo?: { itemStruct?: Item } } };
};

export type DirectTikTokResult = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration?: number;
  hd: string;
  sd: string;
  music: string;
};

function extractPostIdFromUrl(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    const path = url.pathname;
    let m = path.match(/^\/@[\w.-]+\/video\/(\d+)\/?$/);
    if (m) return m[1];
    m = path.match(/^\/i18n\/share\/video\/(\d+)\/?$/);
    if (m) return m[1];
    m = path.match(/\/video\/(\d+)\/?$/);
    if (m) return m[1];
    // fallback: any 18-20 digit id
    m = url.href.match(/(\d{18,21})/);
    if (m) return m[1];
    return null;
  } catch {
    return null;
  }
}

function parseItemFromHtml(html: string, expectedId: string): Item | null {
  // Try both string-split like cobalt and cheerio for robustness
  const tryParse = (jsonText: string): Item | null => {
    try {
      const data = JSON.parse(jsonText) as PageData;
      const item =
        data.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct ??
        (data as unknown as { Scope?: PageData['__DEFAULT_SCOPE__'] })?.Scope?.['webapp.video-detail']?.itemInfo?.itemStruct ??
        data.ItemModule?.[expectedId];
      if (!item) return null;
      if (String(item.id) !== expectedId) return null;
      if (!item.video && !item.imagePost) return null;
      return item;
    } catch {
      return null;
    }
  };

  // 1) Direct split like cobalt (faster, avoids cheerio entity decoding)
  const marker = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">';
  if (html.includes(marker)) {
    try {
      const json = html.split(marker)[1].split('</script>')[0];
      const item = tryParse(json);
      if (item) return item;
    } catch {}
  }
  const sigiMarker = '<script id="SIGI_STATE"';
  if (html.includes(sigiMarker)) {
    try {
      const json = html.split(sigiMarker)[1].split('>')[1].split('</script>')[0];
      const item = tryParse(json);
      if (item) return item;
    } catch {}
  }

  // 2) Cheerio fallback for mocked tests and variations
  try {
    const $ = load(html);
    for (const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE']) {
      const content = $(`script#${id}`).text();
      if (!content) continue;
      const item = tryParse(content);
      if (item) return item;
    }
  } catch {}

  return null;
}

/** Last-resort, unauthenticated lookup. TikTok may block hosted servers. */
export async function fetchDirectTikTok(input: string): Promise<DirectTikTokResult | null> {
  let current = normalizeTikTokUrl(input);
  if (!current) return null;
  const signal = AbortSignal.timeout(12000);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const isShort = isShortTikTokHost(new URL(current).hostname);
      const headers: Record<string, string> = isShort
        ? { 'User-Agent': SHORT_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }
        : { 'User-Agent': GENERIC_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' };

      const response = await fetch(current, {
        headers,
        signal,
        redirect: 'manual',
        cache: 'no-store',
      });

      // Handle redirect via Location header
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) return null;
        if (redirects === 5) return null;
        const next = normalizeTikTokUrl(new URL(location, current).href);
        if (!next) return null;
        current = next;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return null;
      }

      // Short link without redirect but with HTML anchor (vt.tiktok.com behaviour)
      if (isShort) {
        const html = await limitedText(response);
        if (!html) return null;
        // Anchor like <a href="https://www.tiktok.com/@user/video/123?...">
        const anchorMatch = html.match(/<a\s+href="([^"]+)"/i);
        if (anchorMatch?.[1]) {
          const href = anchorMatch[1].split('?')[0];
          try {
            const next = normalizeTikTokUrl(new URL(href, current).href);
            if (next) {
              current = next;
              continue;
            }
          } catch {}
        }
        // If anchor not found but page is already a video page (unlikely for short host), fall through
        // Try to see if this short HTML itself contains video data (should not happen)
        // So if we are still on short host and no anchor, fail
        return null;
      }

      // Only accept a video page, never an arbitrary redirect or login page.
      const postId = extractPostIdFromUrl(current);
      if (!postId) {
        await response.body?.cancel().catch(() => {});
        return null;
      }

      const html = await limitedText(response);
      if (!html) return null;

      const item = parseItemFromHtml(html, postId);
      if (!item) return null;

      // Prefer playAddr, fallback to downloadAddr, then bitrateInfo
      let sd = safeMediaUrl(item.video?.playAddr) || safeMediaUrl(item.video?.downloadAddr);
      if (!sd && Array.isArray(item.video?.bitrateInfo)) {
        for (const b of item.video.bitrateInfo) {
          const list = (b as { PlayAddr?: { UrlList?: unknown[] } })?.PlayAddr?.UrlList;
          if (Array.isArray(list)) {
            for (const u of list) {
              const cand = safeMediaUrl(u);
              if (cand) {
                sd = cand;
                break;
              }
            }
            if (sd) break;
          }
        }
      }
      if (!sd) return null;

      // For image posts, we still return video url as hd/sd if available, but handle missing
      return {
        id: postId,
        title: typeof item.desc === 'string' ? item.desc : 'TikTok Video',
        author: typeof item.author?.uniqueId === 'string' ? item.author.uniqueId : typeof item.author?.nickname === 'string' ? item.author.nickname : 'tiktok',
        thumbnail: safeMediaUrl(item.video?.originCover) || safeMediaUrl(item.video?.cover),
        duration: typeof item.video?.duration === 'number' ? item.video.duration : undefined,
        hd: sd,
        sd,
        music: safeMediaUrl(item.music?.playUrl),
      };
    }
  } catch {
    // Never expose upstream response details to the user.
  }
  return null;
}
