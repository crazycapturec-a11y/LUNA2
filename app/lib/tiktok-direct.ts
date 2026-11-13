import { load } from 'cheerio';

const AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

export function normalizeTikTokUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !(host === 'tiktok.com' || host.endsWith('.tiktok.com'))) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function safeMediaUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    const hosts = ['tiktok.com', 'tiktokv.com', 'tiktokv.us', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'byteoversea.com', 'ibytedtos.com'];
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
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
  video?: { playAddr?: unknown; downloadAddr?: unknown; cover?: unknown; originCover?: unknown; duration?: unknown };
  music?: { playUrl?: unknown };
};

type PageData = {
  __DEFAULT_SCOPE__?: { 'webapp.video-detail'?: { itemInfo?: { itemStruct?: Item } } };
  ItemModule?: Record<string, Item>;
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

/** Last-resort, unauthenticated lookup. TikTok may block hosted servers. */
export async function fetchDirectTikTok(input: string): Promise<DirectTikTokResult | null> {
  let current = normalizeTikTokUrl(input);
  if (!current) return null;
  const signal = AbortSignal.timeout(12000);
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      const response = await fetch(current, {
        headers: { 'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
        signal,
        redirect: 'manual',
        cache: 'no-store',
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 4) return null;
        current = normalizeTikTokUrl(new URL(location, current).href);
        if (!current) return null;
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); return null; }
      // Only accept a video page, never an arbitrary redirect or login page.
      const match = new URL(current).pathname.match(/^\/@[\w.-]+\/video\/(\d+)\/?$/);
      if (!match) { await response.body?.cancel(); return null; }
      const html = await limitedText(response);
      if (!html) return null;
      const $ = load(html);
      for (const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE']) {
        const content = $(`script#${id}`).text();
        if (!content) continue;
        let page: PageData;
        try { page = JSON.parse(content) as PageData; } catch { continue; }
        const item = page.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct ?? page.ItemModule?.[match[1]];
        if (!item || String(item.id) !== match[1] || !item.video) continue;
        const sd = safeMediaUrl(item.video.playAddr) || safeMediaUrl(item.video.downloadAddr);
        if (!sd) continue;
        return {
          id: match[1],
          title: typeof item.desc === 'string' ? item.desc : 'TikTok Video',
          author: typeof item.author?.uniqueId === 'string' ? item.author.uniqueId : 'tiktok',
          thumbnail: safeMediaUrl(item.video.originCover) || safeMediaUrl(item.video.cover),
          duration: typeof item.video.duration === 'number' ? item.video.duration : undefined,
          hd: sd,
          sd,
          music: safeMediaUrl(item.music?.playUrl),
        };
      }
      return null;
    }
  } catch {
    // Never expose upstream response details to the user.
  }
  return null;
}
