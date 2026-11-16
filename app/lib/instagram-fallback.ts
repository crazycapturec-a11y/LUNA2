import { load } from 'cheerio';
import { parseInstagramPostTarget } from './instagram';
import { INSTAGRAM_BROWSER_UA, readResponseText } from './instagram-http';
import { instagramMediaUrl } from './instagram-media';

export type FallbackMedia = { url: string; type: 'video' | 'image'; thumbnail?: string };

const SNAPINSTA_MAX_BYTES = 1024 * 1024;
const UNPACK_MAX_CHARS = 512 * 1024;

function decodeBase(digits: string, alphabet: string, base: number): number {
  let value = 0;
  for (let i = 0; i < digits.length; i++) {
    const idx = alphabet.indexOf(digits[i]);
    if (idx < 0 || idx >= base) return -1;
    value = value * base + idx;
    if (value > 0x10ffff) return -1;
  }
  return value;
}

/**
 * Pure arithmetic decoder for SnapInsta's encoded HTML string wrapper.
 * Never evaluates JavaScript; only decodes numeric character codes into HTML text.
 */
function unpackSnapInstaHtml(input: string): string {
  if (input.length > UNPACK_MAX_CHARS) return '';
  const match = input.match(
    /\(\s*"([A-Za-z0-9+/=_-]+)"\s*,\s*\d+\s*,\s*"([^"]{2,95})"\s*,\s*(\d{1,5})\s*,\s*(\d{1,2})\s*,\s*\d+\s*\)/,
  );
  if (!match) return '';
  const [, encoded, charset, rawOffset, rawBase] = match;
  const offset = Number(rawOffset);
  const base = Number(rawBase);
  if (base < 2 || base >= charset.length) return '';
  const delimiter = charset[base];
  const parts = encoded.split(delimiter);
  if (parts.length > UNPACK_MAX_CHARS) return '';

  const chars: string[] = [];
  for (const token of parts) {
    if (!token) continue;
    const num = decodeBase(token, charset, base);
    const code = num - offset;
    if (num < 0 || code <= 0 || code > 0xffff) continue;
    chars.push(String.fromCharCode(code));
  }
  const decoded = chars.join('');
  // Extract the innerHTML string assignment if present, unescaping standard JS escapes.
  const htmlMatch = decoded.match(/innerHTML\s*=\s*"((?:\\.|[^"\\])*)"/);
  if (!htmlMatch) return decoded;
  try {
    const parsed = JSON.parse(`"${htmlMatch[1]}"`);
    return typeof parsed === 'string' ? parsed : decoded;
  } catch {
    return decoded.replace(/\\"/g, '"').replace(/\\\//g, '/');
  }
}

function isLikelyVideoCdnUrl(url: URL, linkText: string, linkTitle: string): boolean {
  const path = url.pathname.toLowerCase();
  if (path.endsWith('.mp4')) return true;
  if (path.includes('/o1/v/t16/') || path.includes('/o1/v/t2/')) return true;
  const hint = `${linkText} ${linkTitle}`.toLowerCase();
  return hint.includes('download video');
}

function isLikelyImageCdnUrl(url: URL, linkText: string, linkTitle: string): boolean {
  const path = url.pathname.toLowerCase();
  if (/\.(?:jpe?g|png|webp)$/.test(path)) return true;
  const hint = `${linkText} ${linkTitle}`.toLowerCase();
  return hint.includes('download photo') || hint.includes('download image');
}

function extractFallbackMedia(rawContent: string, videoOnly: boolean): FallbackMedia | null {
  const html = rawContent.includes('<a') ? rawContent : unpackSnapInstaHtml(rawContent);
  if (!html) return null;

  const $ = load(html);
  const videos: string[] = [];
  const images: string[] = [];

  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const safe = instagramMediaUrl(anchor.attr('href'));
    if (!safe) return;
    const parsed = new URL(safe);
    const text = anchor.text();
    const title = anchor.attr('title') || '';
    if (isLikelyVideoCdnUrl(parsed, text, title)) {
      videos.push(safe);
    } else if (isLikelyImageCdnUrl(parsed, text, title)) {
      images.push(safe);
    }
  });

  const thumb = instagramMediaUrl($('img[src]').first().attr('src'));

  if (videos[0]) {
    return {
      url: videos[0],
      type: 'video',
      ...(thumb ? { thumbnail: thumb } : {}),
    };
  }
  if (!videoOnly && images[0]) {
    return { url: images[0], type: 'image' };
  }
  return null;
}

/**
 * Unauthenticated fallback only. Never pass IG_COOKIES or IG_SESSION_ID here,
 * and validate every returned media URL before surfacing it to the proxy.
 */
export async function fetchSnapInsta(url: string): Promise<FallbackMedia | null> {
  const target = parseInstagramPostTarget(url);
  const videoOnly = target ? target.videoOnly : false;

  try {
    const response = await fetch('https://www.snapinsta.app/api/ajaxSearch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': INSTAGRAM_BROWSER_UA,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Origin: 'https://www.snapinsta.app',
        Referer: 'https://www.snapinsta.app/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ q: url, t: 'media', lang: 'en' }),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }

    const text = await readResponseText(response, SNAPINSTA_MAX_BYTES);
    if (!text) return null;

    let content = text;
    if (text.trimStart().startsWith('{')) {
      const payload = JSON.parse(text) as { status?: string; data?: string };
      if (payload.status !== 'ok' || typeof payload.data !== 'string') return null;
      content = payload.data;
    }
    return extractFallbackMedia(content, videoOnly);
  } catch {
    return null;
  }
}
