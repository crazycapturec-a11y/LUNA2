import { load } from 'cheerio';

export type FallbackMedia = { url: string; type: 'video' | 'image' };

/**
 * Unauthenticated fallback. The normalized post URL is sent to SnapInsta;
 * Instagram cookies must never be passed to this service.
 */
export async function fetchSnapInsta(url: string): Promise<FallbackMedia | null> {
  try {
    const response = await fetch('https://www.snapinsta.app/api/ajaxSearch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Origin: 'https://www.snapinsta.app',
        Referer: 'https://www.snapinsta.app/',
      },
      body: new URLSearchParams({ q: url, t: 'media', lang: 'en' }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.status !== 'ok' || typeof data.data !== 'string') return null;
    const $ = load(data.data);
    const candidates: FallbackMedia[] = [];
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      try {
        const media = new URL(href);
        const host = media.hostname.toLowerCase();
        const trustedHost = ['cdninstagram.com', 'fbcdn.net', 'instagram.com'].some(suffix => host === suffix || host.endsWith(`.${suffix}`));
        if (media.protocol !== 'https:' || media.username || media.password || media.port || !trustedHost) return;
        const path = media.pathname.toLowerCase();
        if (/\.mp4$/.test(path)) candidates.push({ url: media.href, type: 'video' });
        else if (/\.(?:jpg|jpeg)$/.test(path)) candidates.push({ url: media.href, type: 'image' });
      } catch { /* Ignore invalid third-party URLs. */ }
    });
    return candidates.find(item => item.type === 'video') || candidates[0] || null;
  } catch {
    return null;
  }
}
