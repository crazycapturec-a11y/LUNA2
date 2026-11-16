type InstagramEnvironment = {
  IG_COOKIES?: string;
  IG_SESSION_ID?: string;
};

type InstagramDocIdEnvironment = {
  IG_GRAPHQL_DOC_ID?: string;
  IG_POLARIS_DOC_ID?: string;
};

export type InstagramAuthOptions = { cookies?: string; sessionId?: string };

export type InstagramPostTarget = {
  kind: 'reel' | 'p' | 'tv';
  shortcode: string;
  url: string;
  videoOnly: boolean;
};

const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'instagr.am',
  'www.instagr.am',
]);

const RESERVED_USERNAMES = new Set([
  'about',
  'accounts',
  'api',
  'audio',
  'challenge',
  'developer',
  'direct',
  'explore',
  'graphql',
  'legal',
  'p',
  'reel',
  'reels',
  's',
  'share',
  'static',
  'stories',
  'tv',
  'web',
]);

const RESERVED_SHORTCODES = new Set(['audio', 'embed', 'captioned']);

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Built-in GraphQL persisted query IDs (2026 Instagram web app). */
export const DEFAULT_SHORTCODE_DOC_IDS = ['27128499623469141', '24368985919464652'] as const;
export const DEFAULT_POLARIS_DOC_ID = '27130156389949648';

/** Read credentials only on the server. Never include their values in errors. */
export function instagramAuthOptions(
  env: InstagramEnvironment = { IG_COOKIES: process.env.IG_COOKIES, IG_SESSION_ID: process.env.IG_SESSION_ID },
): InstagramAuthOptions {
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

export function instagramCookieHeader(auth: InstagramAuthOptions = {}): string {
  if (auth.cookies) return auth.cookies;
  if (auth.sessionId) return `sessionid=${auth.sessionId}`;
  return '';
}

export function extractInstagramCookie(cookieHeader: string, name: string): string {
  if (!cookieHeader || /[\r\n]/.test(cookieHeader)) return '';
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      const value = part.slice(eq + 1).trim();
      return /^[^\s;]+$/.test(value) ? value : '';
    }
  }
  return '';
}

function isValidUsername(segment: string): boolean {
  if (!/^[A-Za-z0-9._]{1,30}$/.test(segment)) return false;
  if (segment.startsWith('.') || segment.endsWith('.') || segment.includes('..')) return false;
  return !RESERVED_USERNAMES.has(segment.toLowerCase());
}

function isValidShortcode(segment: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(segment) && !RESERVED_SHORTCODES.has(segment.toLowerCase());
}

function normalizePostKind(segment: string): 'reel' | 'p' | 'tv' | null {
  const lower = segment.toLowerCase();
  if (lower === 'reel' || lower === 'reels') return 'reel';
  if (lower === 'p') return 'p';
  if (lower === 'tv') return 'tv';
  return null;
}

function allowsTrailingSegments(rest: string[]): boolean {
  if (rest.length === 0) return true;
  if (rest.length === 1 && rest[0].toLowerCase() === 'embed') return true;
  if (rest.length === 2 && rest[0].toLowerCase() === 'embed' && rest[1].toLowerCase() === 'captioned') return true;
  if (rest.length === 2 && rest[0].toLowerCase() === 'c' && /^\d+$/.test(rest[1])) return true;
  return false;
}

/** Only send authenticated extraction requests for actual Instagram hosts. */
export function normalizeInstagramPostUrl(input: string): string | null {
  try {
    const parsed = new URL(input.trim());
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !INSTAGRAM_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      return null;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;

    // Share URLs: /share/<token>/ or /share/(reel|reels|p|tv|s)/<token>/
    if (segments[0].toLowerCase() === 'share') {
      if (segments.length === 2 && isValidShortcode(segments[1])) {
        return `https://www.instagram.com/share/${segments[1]}/`;
      }
      if (
        segments.length === 3 &&
        /^(?:reel|reels|p|tv|s)$/i.test(segments[1]) &&
        isValidShortcode(segments[2])
      ) {
        return `https://www.instagram.com/share/${segments[1].toLowerCase()}/${segments[2]}/`;
      }
      return null;
    }

    // Direct URLs: /(reel|reels|p|tv)/<shortcode>/ (with optional /embed, /embed/captioned, /c/<id>)
    const directKind = normalizePostKind(segments[0]);
    if (directKind) {
      const shortcode = segments[1];
      if (!isValidShortcode(shortcode) || !allowsTrailingSegments(segments.slice(2))) return null;
      return `https://www.instagram.com/${directKind}/${shortcode}/`;
    }

    // Profile-prefixed URLs: /<username>/(reel|reels|p|tv)/<shortcode>/
    if (segments.length >= 3 && isValidUsername(segments[0])) {
      const userPostKind = normalizePostKind(segments[1]);
      const shortcode = segments[2];
      if (userPostKind && isValidShortcode(shortcode) && allowsTrailingSegments(segments.slice(3))) {
        return `https://www.instagram.com/${userPostKind}/${shortcode}/`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function parseInstagramPostTarget(url: string): InstagramPostTarget | null {
  const normalized = normalizeInstagramPostUrl(url);
  if (!normalized) return null;
  const match = new URL(normalized).pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]+)\/$/);
  if (!match) return null;
  const kind = match[1] as 'reel' | 'p' | 'tv';
  const shortcode = match[2];
  return {
    kind,
    shortcode,
    url: normalized,
    videoOnly: kind === 'reel' || kind === 'tv',
  };
}

/**
 * Convert an Instagram shortcode to its numeric media ID (`pk`).
 * Long (>28 char) follower/share shortcodes append a 28-char token after the media ID.
 */
export function shortcodeToMediaId(shortcode: string): string | null {
  const trimmed = shortcode.trim();
  if (!trimmed) return null;
  const code = trimmed.length > 28 ? trimmed.slice(0, -28) : trimmed;
  if (!code || code.length > 16) return null;
  let id = BigInt(0);
  const radix = BigInt(64);
  for (const ch of code) {
    const idx = SHORTCODE_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    id = id * radix + BigInt(idx);
  }
  return id > BigInt(0) ? id.toString() : null;
}

export function instagramDocIds(
  env: InstagramDocIdEnvironment = {
    IG_GRAPHQL_DOC_ID: process.env.IG_GRAPHQL_DOC_ID,
    IG_POLARIS_DOC_ID: process.env.IG_POLARIS_DOC_ID,
  },
): { shortcodeDocIds: string[]; polarisDocId: string } {
  const customShortcode = (env.IG_GRAPHQL_DOC_ID || '').trim();
  const customPolaris = (env.IG_POLARIS_DOC_ID || '').trim();
  const shortcodeDocIds: string[] = [];
  if (/^\d{10,25}$/.test(customShortcode)) shortcodeDocIds.push(customShortcode);
  for (const id of DEFAULT_SHORTCODE_DOC_IDS) {
    if (!shortcodeDocIds.includes(id)) shortcodeDocIds.push(id);
  }
  const polarisDocId = /^\d{10,25}$/.test(customPolaris) ? customPolaris : DEFAULT_POLARIS_DOC_ID;
  return { shortcodeDocIds, polarisDocId };
}
