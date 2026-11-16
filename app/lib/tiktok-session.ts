/**
 * TikTok's media CDN answers `403 Access Denied` to anonymous video requests, but
 * the identical URL serves the file when the page's own visitor cookies
 * (`ttwid`, `tt_chain_token`, …) are replayed. Those cookies are anonymous web
 * session values for the page we just scraped — never user credentials — and they
 * are only ever attached to TikTok hosts.
 *
 * The jar lives on `globalThis` because Next.js bundles each route separately, so
 * a module-level variable would not be shared between the lookup route (which
 * seeds it) and the media proxy (which reads it).
 */

const TIKTOK_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const COOKIE_TTL_MS = 10 * 60 * 1000;
const COOKIE_MAX_CHARS = 4096;

type CookieJar = { header: string; expires: number };

const jarHolder = globalThis as typeof globalThis & { __lunaTikTokCookies?: CookieJar };

function splitCookies(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return cookies;
}

/** Merge a response's Set-Cookie pairs into the shared jar. */
export function captureTikTokCookies(response: Response): void {
  const accessor = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = typeof accessor.getSetCookie === 'function' ? accessor.getSetCookie() : [];
  const cookies = splitCookies(jarHolder.__lunaTikTokCookies?.header ?? '');
  let changed = false;

  for (const cookie of raw) {
    const pair = cookie.split(';')[0].trim();
    if (!pair || /[\r\n]/.test(pair)) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name) || !/^[^\s;]*$/.test(value)) continue;
    if (cookies.get(name) === value) continue;
    cookies.set(name, value);
    changed = true;
  }

  if (!changed) return;
  jarHolder.__lunaTikTokCookies = {
    header: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ').slice(0, COOKIE_MAX_CHARS),
    expires: Date.now() + COOKIE_TTL_MS,
  };
}

/** Current visitor cookies, or an empty string when absent or expired. */
export function getTikTokCookies(): string {
  const jar = jarHolder.__lunaTikTokCookies;
  if (!jar || jar.expires <= Date.now()) return '';
  return jar.header;
}

/**
 * Seed the jar on a cold instance (or after expiry) so a download still works
 * when the follow-up request lands on a different server instance than the lookup.
 */
export async function seedTikTokCookies(videoId: string): Promise<string> {
  const cached = getTikTokCookies();
  if (cached) return cached;
  if (!/^\d{8,25}$/.test(videoId)) return '';

  let currentUrl = `https://www.tiktok.com/@i/video/${videoId}`;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const response = await fetch(currentUrl, {
        headers: {
          'User-Agent': TIKTOK_BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      });
      captureTikTokCookies(response);

      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      await response.body?.cancel().catch(() => {});
      if (!location) break;

      const next = new URL(location, currentUrl);
      if (next.protocol !== 'https:' || !(next.hostname === 'tiktok.com' || next.hostname.endsWith('.tiktok.com'))) break;
      currentUrl = next.href;
    }
  } catch {
    // Cookies are best effort; the proxy still reports a readable error without them.
  }

  return getTikTokCookies();
}
