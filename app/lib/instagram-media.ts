import { load } from 'cheerio';
import { shortcodeToMediaId } from './instagram';

export type InstagramResolvedMedia = {
  url: string;
  type: 'video' | 'image';
  thumbnail?: string;
  caption?: string;
  username?: string;
};

export type GraphqlExtractionResult = {
  media: InstagramResolvedMedia | null;
  gated: boolean;
  loginRequired: boolean;
  docIdFailed: boolean;
};

export type PageTokens = {
  lsd: string;
  queryIds: Record<string, string>;
};

type JsonRecord = Record<string, unknown>;

const MEDIA_HOST_SUFFIXES = ['cdninstagram.com', 'fbcdn.net'];
const BLOCKED_MEDIA_HOSTS = new Set(['static.cdninstagram.com']);

/** Only return real media URLs accepted by the same-origin proxy. */
export function instagramMediaUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      BLOCKED_MEDIA_HOSTS.has(host) ||
      !MEDIA_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)) ||
      /\.js$/i.test(url.pathname) ||
      /\/rsrc\.php/i.test(url.pathname)
    ) {
      return '';
    }
    return url.href;
  } catch {
    return '';
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function matchesShortcode(candidate: unknown, shortcode: string): boolean {
  if (typeof candidate !== 'string' || !candidate) return false;
  if (candidate === shortcode) return true;
  // Long follower-share shortcodes (>28 chars) embed the base shortcode prefix.
  if (shortcode.length > 28 && shortcode.startsWith(candidate)) return true;
  return false;
}

function matchesPostIdentity(
  obj: JsonRecord,
  shortcode: string,
  expectedMediaId: string | null,
): boolean {
  const code = obj.shortcode ?? obj.code;
  if (code != null) {
    return matchesShortcode(code, shortcode);
  }
  const rawId = obj.pk ?? obj.id;
  if (rawId != null && expectedMediaId) {
    const numericId = String(rawId).split('_')[0];
    if (/^\d+$/.test(numericId)) return numericId === expectedMediaId;
  }
  return true;
}

function pickBestCandidateUrl(list: unknown, widthKey = 'width', heightKey = 'height'): string {
  if (!Array.isArray(list)) return '';
  let bestUrl = '';
  let bestScore = -1;
  for (const entry of list) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const candidate = instagramMediaUrl(rec.url ?? rec.src);
    if (!candidate) continue;
    const width = Number(rec[widthKey]);
    const height = Number(rec[heightKey]);
    const score =
      Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
        ? width * height
        : 0;
    if (score > bestScore) {
      bestScore = score;
      bestUrl = candidate;
    }
  }
  return bestUrl;
}

function slideVideoUrl(slide: JsonRecord): string {
  return pickBestCandidateUrl(slide.video_versions) || instagramMediaUrl(slide.video_url);
}

function slideImageUrl(slide: JsonRecord): string {
  const imageVersions = asRecord(slide.image_versions2);
  return (
    pickBestCandidateUrl(imageVersions?.candidates) ||
    pickBestCandidateUrl(slide.display_resources, 'config_width', 'config_height') ||
    instagramMediaUrl(slide.display_url) ||
    instagramMediaUrl(slide.thumbnail_src)
  );
}

function isVideoSlide(slide: JsonRecord): boolean {
  if (slide.is_video === true) return true;
  if (Number(slide.media_type) === 2) return true;
  const typename = typeof slide.__typename === 'string' ? slide.__typename : '';
  if (typename === 'GraphVideo' || typename === 'XDTGraphVideo') return true;
  if (Array.isArray(slide.video_versions) && slide.video_versions.length > 0) return true;
  if (typeof slide.video_dash_manifest === 'string' && slide.video_dash_manifest.length > 0) return true;
  return false;
}

function extractCaption(obj: JsonRecord): string {
  const captionObj = asRecord(obj.caption);
  const directText = nonEmptyString(captionObj?.text);
  if (directText) return directText;

  const captionEdges = asRecord(obj.edge_media_to_caption)?.edges;
  if (Array.isArray(captionEdges)) {
    for (const edge of captionEdges) {
      const node = asRecord(asRecord(edge)?.node);
      const text = nonEmptyString(node?.text);
      if (text) return text;
    }
  }
  return '';
}

function extractUsername(obj: JsonRecord): string {
  const user = asRecord(obj.user);
  const owner = asRecord(obj.owner);
  return nonEmptyString(user?.username) || nonEmptyString(owner?.username);
}

function attachMetadata(
  base: InstagramResolvedMedia,
  root: JsonRecord,
): InstagramResolvedMedia {
  const caption = extractCaption(root);
  const username = extractUsername(root);
  return {
    ...base,
    ...(caption ? { caption } : {}),
    ...(username ? { username } : {}),
  };
}

/**
 * Extract downloadable media from any structured Instagram post object:
 * - REST `/api/v1/media/{pk}/info/` item (`items[0]`)
 * - GraphQL `xdt_api__v1__media__shortcode__web_info.items[0]`
 * - Polaris `xig_polaris_media.if_not_gated_logged_out`
 * - GraphQL / embed `shortcode_media` and `xdt_shortcode_media`
 */
export function extractStructuredInstagramMedia(
  raw: unknown,
  shortcode: string,
  videoOnly: boolean,
  expectedMediaId: string | null = shortcodeToMediaId(shortcode),
): InstagramResolvedMedia | null {
  const root = asRecord(raw);
  if (!root) return null;
  if (!matchesPostIdentity(root, shortcode, expectedMediaId)) return null;

  let slides: JsonRecord[] = [];
  if (Array.isArray(root.carousel_media) && root.carousel_media.length > 0) {
    slides = root.carousel_media.flatMap((entry) => {
      const rec = asRecord(entry);
      return rec ? [rec] : [];
    });
  } else {
    const sidecarEdges = asRecord(root.edge_sidecar_to_children)?.edges;
    if (Array.isArray(sidecarEdges) && sidecarEdges.length > 0) {
      slides = sidecarEdges.flatMap((edge) => {
        const node = asRecord(asRecord(edge)?.node);
        return node ? [node] : [];
      });
    }
  }
  if (slides.length === 0) slides = [root];

  const rootThumb = slideImageUrl(root);

  // Prefer video slides first (for reels, video posts, and mixed carousels).
  for (const slide of slides) {
    const video = slideVideoUrl(slide);
    if (!video) continue;
    const thumb = slideImageUrl(slide) || rootThumb;
    return attachMetadata(
      {
        type: 'video',
        url: video,
        ...(thumb ? { thumbnail: thumb } : {}),
      },
      root,
    );
  }

  // Never turn a reel/tv link or a video post's cover image into a photo download.
  if (videoOnly) return null;

  for (const slide of slides) {
    if (isVideoSlide(slide)) continue;
    const image = slideImageUrl(slide);
    if (image) {
      return attachMetadata({ type: 'image', url: image }, root);
    }
  }

  return null;
}

export function extractFromGraphqlPayload(
  raw: unknown,
  shortcode: string,
  videoOnly: boolean,
  expectedMediaId: string | null = shortcodeToMediaId(shortcode),
): GraphqlExtractionResult {
  const root = asRecord(raw);
  if (!root) {
    return { media: null, gated: false, loginRequired: false, docIdFailed: true };
  }

  const message = typeof root.message === 'string' ? root.message.toLowerCase() : '';
  const loginRequired =
    root.require_login === true ||
    message.includes('login_required') ||
    message.includes('checkpoint_required') ||
    message.includes('cookie');

  let gated = false;
  let errorCount = 0;
  if (Array.isArray(root.errors)) {
    errorCount = root.errors.length;
    for (const err of root.errors) {
      const rec = asRecord(err);
      const text = `${typeof rec?.message === 'string' ? rec.message : ''} ${typeof rec?.description === 'string' ? rec.description : ''}`.toLowerCase();
      if (
        text.includes('restricted') ||
        text.includes('login') ||
        text.includes('private') ||
        text.includes('not authorized') ||
        text.includes('age')
      ) {
        gated = true;
      }
    }
  }

  // Direct v1 REST shape: { items: [ ... ] }
  if (Array.isArray(root.items) && root.items.length > 0) {
    const media = extractStructuredInstagramMedia(root.items[0], shortcode, videoOnly, expectedMediaId);
    if (media) return { media, gated: false, loginRequired: false, docIdFailed: false };
  }

  const data = asRecord(root.data);
  if (!data) {
    return { media: null, gated, loginRequired, docIdFailed: true };
  }

  // 1. xdt_api__v1__media__shortcode__web_info.items[0]
  const webInfo = asRecord(data.xdt_api__v1__media__shortcode__web_info);
  if (webInfo && Array.isArray(webInfo.items) && webInfo.items.length > 0) {
    const media = extractStructuredInstagramMedia(webInfo.items[0], shortcode, videoOnly, expectedMediaId);
    if (media) return { media, gated: false, loginRequired: false, docIdFailed: false };
  }

  // 2. xig_polaris_media.if_not_gated_logged_out
  const polaris = asRecord(data.xig_polaris_media);
  if (polaris) {
    if (polaris.gating_ruling != null) gated = true;
    const ungated = asRecord(polaris.if_not_gated_logged_out);
    if (ungated) {
      const media = extractStructuredInstagramMedia(ungated, shortcode, videoOnly, expectedMediaId);
      if (media) return { media, gated: false, loginRequired: false, docIdFailed: false };
    } else if ('if_not_gated_logged_out' in polaris && polaris.if_not_gated_logged_out === null) {
      gated = true;
    }
  }

  // 3. xdt_shortcode_media / shortcode_media
  for (const candidate of [data.xdt_shortcode_media, data.shortcode_media]) {
    if (!candidate) continue;
    const media = extractStructuredInstagramMedia(candidate, shortcode, videoOnly, expectedMediaId);
    if (media) return { media, gated: false, loginRequired: false, docIdFailed: false };
  }

  const hasKnownRootKey =
    'xdt_api__v1__media__shortcode__web_info' in data ||
    'xig_polaris_media' in data ||
    'xdt_shortcode_media' in data ||
    'shortcode_media' in data;

  return {
    media: null,
    gated,
    loginRequired,
    docIdFailed: !hasKnownRootKey || (errorCount > 0 && !gated),
  };
}

/** Extract anonymous LSD token and preloader GraphQL query IDs from an Instagram HTML page. */
export function parseInstagramPageTokens(html: string): PageTokens {
  let lsd = '';
  const queryIds: Record<string, string> = {};

  // 1. `<script id="__eqmc">{"l":"..."}</script>` (used by Instagram's modern desktop shell)
  const eqmcMatch = html.match(/<script[^>]*\bid=["']__eqmc["'][^>]*>([\s\S]*?)<\/script>/i);
  if (eqmcMatch) {
    try {
      const parsed = asRecord(JSON.parse(eqmcMatch[1]));
      if (parsed && typeof parsed.l === 'string' && /^[\w-]{4,128}$/.test(parsed.l)) {
        lsd = parsed.l;
      }
    } catch {
      // Fall through to regex patterns.
    }
  }

  // 2. Relay module definition: ["LSD",[],{"token":"..."}] or "lsd":{"token":"..."}
  if (!lsd) {
    const tokenMatch =
      html.match(/\["LSD"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([\w-]{4,128})"/i) ||
      html.match(/"lsd"\s*:\s*\{\s*"token"\s*:\s*"([\w-]{4,128})"/i) ||
      html.match(/name=["']lsd["']\s+value=["']([\w-]{4,128})["']/i);
    if (tokenMatch) lsd = tokenMatch[1];
  }

  // 3. Preloader query definitions (allows automatic recovery when doc_ids rotate).
  const queryPattern =
    /"queryID"\s*:\s*"(\d{10,25})"\s*,\s*"variables"\s*:\s*\{[^{}]{0,600}\}\s*,\s*"queryName"\s*:\s*"([A-Za-z0-9_]{3,120})"/g;
  let match: RegExpExecArray | null;
  while ((match = queryPattern.exec(html))) {
    const [, id, name] = match;
    if (!queryIds[name]) queryIds[name] = id;
  }

  return { lsd, queryIds };
}

/**
 * Search Instagram `<script type="application/json">` (`data-sjs`) payloads for
 * structured media matching `shortcode` / `expectedMediaId`. Bounded in depth and
 * node count so arbitrary HTML can never block the server.
 */
export function parseInstagramSjsMedia(
  html: string,
  shortcode: string,
  videoOnly: boolean,
  expectedMediaId: string | null = shortcodeToMediaId(shortcode),
): { media: InstagramResolvedMedia | null; gated: boolean } {
  const $ = load(html);
  let found: InstagramResolvedMedia | null = null;
  let gated = false;
  let visits = 0;
  const MAX_VISITS = 30000;
  const MAX_DEPTH = 24;

  const visit = (value: unknown, depth: number): void => {
    if (found || depth > MAX_DEPTH || ++visits > MAX_VISITS || !value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
        if (found || visits > MAX_VISITS) return;
      }
      return;
    }

    const rec = value as JsonRecord;

    const webInfo = asRecord(rec.xdt_api__v1__media__shortcode__web_info);
    if (webInfo && Array.isArray(webInfo.items)) {
      for (const item of webInfo.items) {
        const itemRec = asRecord(item);
        if (!itemRec || (itemRec.code == null && itemRec.shortcode == null && itemRec.pk == null && itemRec.id == null)) {
          continue;
        }
        const media = extractStructuredInstagramMedia(itemRec, shortcode, videoOnly, expectedMediaId);
        if (media) {
          found = media;
          return;
        }
      }
    }

    const polaris = asRecord(rec.xig_polaris_media);
    if (polaris) {
      if (polaris.gating_ruling != null) gated = true;
      const ungated = asRecord(polaris.if_not_gated_logged_out);
      if (ungated) {
        // Require explicit code or pk match inside broad page scripts.
        if (ungated.code != null || ungated.shortcode != null || (expectedMediaId && (ungated.pk != null || ungated.id != null))) {
          const media = extractStructuredInstagramMedia(ungated, shortcode, videoOnly, expectedMediaId);
          if (media) {
            found = media;
            return;
          }
        }
      } else if ('if_not_gated_logged_out' in polaris && polaris.if_not_gated_logged_out === null) {
        gated = true;
      }
    }

    for (const candidate of [rec.xdt_shortcode_media, rec.shortcode_media]) {
      const node = asRecord(candidate);
      if (!node) continue;
      if (node.shortcode == null && node.code == null && !(expectedMediaId && (node.id != null || node.pk != null))) {
        continue;
      }
      const media = extractStructuredInstagramMedia(node, shortcode, videoOnly, expectedMediaId);
      if (media) {
        found = media;
        return;
      }
    }

    for (const child of Object.values(rec)) {
      if (child && typeof child === 'object') {
        visit(child, depth + 1);
        if (found || visits > MAX_VISITS) return;
      }
    }
  };

  $('script[type="application/json"]').each((_, element) => {
    if (found || visits > MAX_VISITS) return;
    const text = $(element).html() || '';
    if (
      !text ||
      text.length > 1_500_000 ||
      (!text.includes('xig_polaris_media') &&
        !text.includes('shortcode__web_info') &&
        !text.includes('shortcode_media'))
    ) {
      return;
    }
    try {
      visit(JSON.parse(text), 0);
    } catch {
      // Ignore unrelated or malformed script tags.
    }
  });

  return { media: found, gated };
}
