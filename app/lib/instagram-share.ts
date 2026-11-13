import { normalizeInstagramPostUrl } from './instagram';

/** Resolve Instagram share links without following redirects outside Instagram or sending cookies. */
export async function resolveInstagramShareUrl(url: string): Promise<string | null> {
  let current = normalizeInstagramPostUrl(url);
  if (!current || !new URL(current).pathname.toLowerCase().startsWith('/share/')) return null;
  const signal = AbortSignal.timeout(4000);
  try {
    for (let redirects = 0; redirects < 4; redirects++) {
      const response = await fetch(current, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
        redirect: 'manual',
        cache: 'no-store',
        signal,
      });
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (response.status < 300 || response.status >= 400 || !location) return null;
      current = normalizeInstagramPostUrl(new URL(location, current).href);
      if (!current) return null;
      if (/^\/(?:reel|p|tv)\/[A-Za-z0-9_-]+\/$/i.test(new URL(current).pathname)) return current;
      if (!new URL(current).pathname.toLowerCase().startsWith('/share/')) return null;
    }
  } catch { /* An unavailable or blocked share link cannot be resolved here. */ }
  return null;
}
