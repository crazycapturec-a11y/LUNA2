import { load } from 'cheerio';
import { normalizeInstagramPostUrl } from './instagram';
import { readResponseText } from './instagram-http';

const SHARE_HTML_MAX_BYTES = 256 * 1024;

function isShareUrl(url: string): boolean {
  return new URL(url).pathname.toLowerCase().startsWith('/share/');
}

function canonicalFromShareHtml(html: string): string | null {
  const $ = load(html);
  const candidates = [
    $('link[rel="canonical"]').attr('href'),
    $('meta[property="og:url"]').attr('content'),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = new URL(candidate, 'https://www.instagram.com').href;
      const normalized = normalizeInstagramPostUrl(resolved);
      if (normalized && !isShareUrl(normalized)) return normalized;
    } catch {
      // Ignore invalid URL attributes.
    }
  }
  return null;
}

/** Resolve an Instagram share link to a direct post URL without sending cookies. */
export async function resolveInstagramShareUrl(url: string): Promise<string | null> {
  let current = normalizeInstagramPostUrl(url);
  if (!current || !isShareUrl(current)) return current;

  const signal = AbortSignal.timeout(5000);
  for (let hops = 0; hops < 4; hops += 1) {
    try {
      const response = await fetch(current, {
        // Non-browser user agents receive a direct 301/302 from Instagram /share/ links
        // instead of a client-side redirect splash page.
        headers: { 'User-Agent': 'curl/8.7.1', Accept: 'text/html,*/*' },
        redirect: 'manual',
        cache: 'no-store',
        signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) return null;
        const next = normalizeInstagramPostUrl(new URL(location, current).href);
        if (!next) return null;
        if (!isShareUrl(next)) return next;
        current = next;
        continue;
      }

      if (response.ok) {
        const html = await readResponseText(response, SHARE_HTML_MAX_BYTES);
        return html ? canonicalFromShareHtml(html) : null;
      }

      await response.body?.cancel().catch(() => {});
      return null;
    } catch {
      return null;
    }
  }
  return null;
}
