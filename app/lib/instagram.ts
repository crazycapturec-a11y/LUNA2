type InstagramEnvironment = { IG_COOKIES?: string; IG_SESSION_ID?: string };
type InstagramAuthOptions = { cookies?: string; sessionId?: string };

/** Read credentials only on the server. Never include their values in errors. */
export function instagramAuthOptions(env: InstagramEnvironment = { IG_COOKIES: process.env.IG_COOKIES, IG_SESSION_ID: process.env.IG_SESSION_ID }): InstagramAuthOptions {
  const fullCookie = env.IG_COOKIES || '';
  const sessionId = env.IG_SESSION_ID || '';
  const cookies = fullCookie.trim();
  const session = sessionId.trim();
  if (/[\r\n]/.test(cookies ? fullCookie : sessionId)) {
    throw new Error('Instagram session configuration is invalid.');
  }
  // IG_COOKIES takes precedence. Also accept a cookie header accidentally placed
  // in the older IG_SESSION_ID setting rather than nesting it inside sessionid=.
  const header = cookies || (/(?:^|;)\s*sessionid\s*=/.test(session) ? session : '');
  if (header) {
    if (!/(?:^|;)\s*sessionid\s*=\s*[^;\s]+(?:\s*;|\s*$)/.test(header)) {
      throw new Error('Instagram session configuration is invalid.');
    }
    return { cookies: header };
  }
  if (session) {
    if (/[;\s]/.test(session)) throw new Error('Instagram session configuration is invalid.');
    return { sessionId: session };
  }
  return {};
}

/** Only send authenticated extraction requests for actual Instagram hosts. */
export function normalizeInstagramPostUrl(input: string): string | null {
  try {
    const parsed = new URL(input.trim());
    const hosts = ['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am'];
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port || !hosts.includes(parsed.hostname.toLowerCase())) return null;
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!/^\/(?:reel|reels|p|tv|share)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/i.test(path)) return null;
    return `https://www.instagram.com${path}/`;
  } catch {
    return null;
  }
}
