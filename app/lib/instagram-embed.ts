import { load } from 'cheerio';
import { instagramCookieHeader, parseInstagramPostTarget, shortcodeToMediaId, type InstagramAuthOptions } from './instagram';
import { INSTAGRAM_IFRAME_HEADERS, instagramNavigationGet } from './instagram-http';
import {
  extractStructuredInstagramMedia,
  instagramMediaUrl,
  parseInstagramSjsMedia,
  type InstagramResolvedMedia,
} from './instagram-media';

export { instagramMediaUrl };

export type InstagramEmbedMedia = InstagramResolvedMedia;

export type InstagramEmbedAttempt = {
  kind: string;
  authenticated: boolean;
  status: number | 'network_error';
  mediaFound: boolean;
};

export type FetchInstagramEmbedOptions = {
  mode?: 'public' | 'authenticated' | 'both';
  timeoutMs?: number;
  perRequestTimeoutMs?: number;
};

function parseAdditionalDataJson(script: string): unknown[] {
  const results: unknown[] = [];
  const marker = '__additionalDataLoaded(';
  let start = 0;
  while ((start = script.indexOf(marker, start)) !== -1) {
    start += marker.length;
    const braceStart = script.indexOf('{', start);
    if (braceStart === -1 || braceStart - start > 64) continue;
    // Find matching closing brace while respecting JSON strings and escapes.
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    const limit = Math.min(script.length, braceStart + 1_000_000);
    for (let i = braceStart; i < limit; i++) {
      const ch = script[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end !== -1) {
      try {
        results.push(JSON.parse(script.slice(braceStart, end)));
      } catch {
        // Ignore non-JSON segments.
      }
      start = end;
    }
  }
  return results;
}

function extractFromEmbedContext(
  context: unknown,
  shortcode: string,
  videoOnly: boolean,
  mediaId: string | null,
): InstagramEmbedMedia | null {
  if (!context || typeof context !== 'object') return null;
  const root = context as Record<string, unknown>;
  const gql =
    root.gql_data && typeof root.gql_data === 'object'
      ? (root.gql_data as Record<string, unknown>)
      : null;

  const candidates = [
    gql?.shortcode_media,
    gql?.xdt_shortcode_media,
    root.shortcode_media,
    root.xdt_shortcode_media,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const media = extractStructuredInstagramMedia(candidate, shortcode, videoOnly, mediaId);
    if (media) return media;
  }
  return null;
}

/** Parse structured embed data, or Open Graph video metadata, without guessing from arbitrary URLs. */
export function parseInstagramEmbed(
  html: string,
  shortcode: string,
  videoOnly: boolean,
): InstagramEmbedMedia | null {
  const $ = load(html);
  const mediaId = shortcodeToMediaId(shortcode);
  let found: InstagramEmbedMedia | null = null;

  $('script').each((_, element) => {
    if (found) return;
    const script = $(element).html() || '';
    if (!script) return;

    // 1. Instagram embeds contextJSON as a JSON-encoded string containing another JSON document.
    if (script.includes('contextJSON')) {
      const pattern = /"contextJSON"\s*:\s*("(?:\\.|[^"\\])*")/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(script)) && !found) {
        try {
          const decoded = JSON.parse(match[1]);
          if (typeof decoded !== 'string') continue;
          const context = JSON.parse(decoded);
          found = extractFromEmbedContext(context, shortcode, videoOnly, mediaId);
        } catch {
          // Continue checking other structured script blocks.
        }
      }
    }

    // 2. Legacy/captioned embed payload via window.__additionalDataLoaded('extra', {...}).
    if (!found && script.includes('__additionalDataLoaded(')) {
      for (const payload of parseAdditionalDataJson(script)) {
        found = extractFromEmbedContext(payload, shortcode, videoOnly, mediaId);
        if (found) break;
      }
    }
  });

  if (found) return found;

  // 3. Modern Polaris `<script type="application/json" data-sjs>` payload.
  const sjs = parseInstagramSjsMedia(html, shortcode, videoOnly, mediaId);
  if (sjs.media) return sjs.media;

  // 4. Open Graph video metadata fallback (reels / video posts).
  for (const name of ['og:video:secure_url', 'og:video:url', 'og:video']) {
    const video = instagramMediaUrl($(`meta[property="${name}"]`).attr('content'));
    if (video) {
      const thumb = instagramMediaUrl($('meta[property="og:image"]').attr('content'));
      return { type: 'video', url: video, ...(thumb ? { thumbnail: thumb } : {}) };
    }
  }
  return null;
}

type EmbedVariant = {
  baseKind: string;
  label: string;
  path: string;
  captioned: boolean;
};

function buildEmbedVariants(type: 'reel' | 'p' | 'tv', shortcode: string): EmbedVariant[] {
  const baseKinds = type === 'p' ? ['p'] : [type, 'p'];
  const variants: EmbedVariant[] = [];
  for (const baseKind of baseKinds) {
    variants.push({
      baseKind,
      label: `${baseKind}/captioned`,
      path: `/${baseKind}/${shortcode}/embed/captioned/`,
      captioned: true,
    });
    variants.push({
      baseKind,
      label: baseKind,
      path: `/${baseKind}/${shortcode}/embed/`,
      captioned: false,
    });
  }
  return variants;
}

/**
 * Try public, then (if configured) authenticated embeds, only on Instagram.
 * Uses real iframe navigation headers (`Sec-Fetch-Mode: navigate`) so Instagram
 * serves captioned embed payloads instead of rejecting Fetch's default `cors` mode.
 */
export async function fetchInstagramEmbed(
  url: string,
  auth: InstagramAuthOptions = {},
  onAttempt?: (attempt: InstagramEmbedAttempt) => void,
  options: FetchInstagramEmbedOptions = {},
): Promise<InstagramEmbedMedia | null> {
  const target = parseInstagramPostTarget(url);
  if (!target) return null;

  const cookie = instagramCookieHeader(auth);
  const mode = options.mode ?? 'both';
  const sessions: string[] = [];
  if (mode === 'public' || mode === 'both') sessions.push('');
  if ((mode === 'authenticated' || mode === 'both') && cookie) sessions.push(cookie);
  if (sessions.length === 0) return null;

  const variants = buildEmbedVariants(target.kind, target.shortcode);
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const perRequestMs = options.perRequestTimeoutMs ?? 4_000;

  // Preserve the original target.videoOnly when parsing an alternate /p/ embed:
  // it must never turn a reel into a photo even if Instagram canonicalizes its URL.
  for (const session of sessions) {
    const emptyCaptionedKinds = new Set<string>();
    for (const variant of variants) {
      if (deadline.aborted) return null;
      // If /{kind}/{code}/embed/captioned/ already returned HTTP 200 with no media,
      // the uncaptioned /{kind}/{code}/embed/ carries strictly less data — skip it.
      if (!variant.captioned && emptyCaptionedKinds.has(variant.baseKind)) continue;

      try {
        const headers: Record<string, string> = { ...INSTAGRAM_IFRAME_HEADERS };
        if (session) headers.Cookie = session;

        const response = await instagramNavigationGet(`https://www.instagram.com${variant.path}`, {
          headers,
          // Never forward the session to any redirect, including another host.
          redirect: 'error',
          signal: AbortSignal.any([deadline, AbortSignal.timeout(perRequestMs)]),
        });

        if (!response.ok) {
          onAttempt?.({
            kind: variant.label,
            authenticated: Boolean(session),
            status: response.status,
            mediaFound: false,
          });
          await response.cancel();
          if (response.status === 429) return null;
          continue;
        }

        const html = await response.readText();
        const media = html ? parseInstagramEmbed(html, target.shortcode, target.videoOnly) : null;
        onAttempt?.({
          kind: variant.label,
          authenticated: Boolean(session),
          status: response.status,
          mediaFound: Boolean(media),
        });
        if (media) return media;
        if (variant.captioned && html !== null) {
          emptyCaptionedKinds.add(variant.baseKind);
        }
      } catch {
        // Never record exception text: it may contain request details.
        onAttempt?.({
          kind: variant.label,
          authenticated: Boolean(session),
          status: 'network_error',
          mediaFound: false,
        });
      }
    }
  }

  return null;
}
