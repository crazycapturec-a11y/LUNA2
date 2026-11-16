import { load } from 'cheerio';
import type { InstagramAuthOptions } from './instagram';

export type InstagramEmbedMedia = { url: string; type: 'video' | 'image'; thumbnail?: string };
export type InstagramEmbedAttempt = { kind: string; authenticated: boolean; status: number | 'network_error'; mediaFound: boolean };

/** Only return media URLs accepted by the same-origin proxy. */
export function instagramMediaUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    const hosts = ['cdninstagram.com', 'fbcdn.net'];
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
    return url.href;
  } catch {
    return '';
  }
}

type EmbedNode = {
  shortcode?: unknown;
  is_video?: unknown;
  video_url?: unknown;
  display_url?: unknown;
  edge_sidecar_to_children?: { edges?: { node?: EmbedNode }[] };
};

function mediaFromNode(node: EmbedNode, shortcode: string, videoOnly: boolean): InstagramEmbedMedia | null {
  if (node.shortcode != null && node.shortcode !== shortcode) return null;
  const children = Array.isArray(node.edge_sidecar_to_children?.edges)
    ? node.edge_sidecar_to_children.edges.flatMap(edge => edge?.node ? [edge.node] : []) : [node];
  for (const child of children) {
    const video = instagramMediaUrl(child.video_url);
    const image = instagramMediaUrl(child.display_url);
    if (video) return { type: 'video', url: video, ...(image ? { thumbnail: image } : {}) };
  }
  if (videoOnly) return null;
  for (const child of children) {
    const image = instagramMediaUrl(child.display_url);
    if (image && child.is_video !== true) return { type: 'image', url: image };
  }
  return null;
}

/** Parse structured embed data, or Open Graph video metadata, without guessing from arbitrary URLs. */
export function parseInstagramEmbed(html: string, shortcode: string, videoOnly: boolean): InstagramEmbedMedia | null {
  const $ = load(html);
  let found: InstagramEmbedMedia | null = null;
  $('script').each((_, element) => {
    if (found) return;
    const script = $(element).html() || '';
    // Instagram embeds contextJSON as a JSON-encoded string containing another JSON document.
    const pattern = /"contextJSON"\s*:\s*("(?:\\.|[^"\\])*")/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(script)) && !found) {
      try {
        const context = JSON.parse(JSON.parse(match[1]));
        const media = context?.gql_data?.shortcode_media ?? context?.shortcode_media;
        if (media && typeof media === 'object') found = mediaFromNode(media, shortcode, videoOnly);
      } catch { /* Ignore malformed embed data. */ }
    }
  });
  if (found) return found;
  const video = instagramMediaUrl($('meta[property="og:video:secure_url"]').attr('content')) ||
    instagramMediaUrl($('meta[property="og:video:url"]').attr('content')) ||
    instagramMediaUrl($('meta[property="og:video"]').attr('content'));
  if (video) return { type: 'video', url: video };
  // Do not turn an unavailable reel or a video poster into a photo download.
  return null;
}

async function readLimited(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) return null;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Try public, then (if configured) authenticated embeds, only on Instagram. */
export async function fetchInstagramEmbed(
  url: string,
  auth: InstagramAuthOptions = {},
  onAttempt?: (attempt: InstagramEmbedAttempt) => void,
): Promise<InstagramEmbedMedia | null> {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]+)\/$/i);
  if (!match) return null;
  const [, rawType, shortcode] = match;
  const type = rawType.toLowerCase();
  const cookie = auth.cookies || (auth.sessionId ? `sessionid=${auth.sessionId}` : '');
  const kinds = type === 'p' ? ['p'] : [type, 'p'];
  const deadline = AbortSignal.timeout(5000);
  // Preserve the original type when parsing an alternate /p/ embed: it must
  // not turn a reel into a photo even if Instagram canonicalizes its URL.
  for (const session of cookie ? ['', cookie] : ['']) {
    for (const kind of kinds) {
      if (deadline.aborted) return null;
      try {
        const headers: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
          Accept: 'text/html,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        };
        if (session) headers.Cookie = session;
        const response = await fetch(`https://www.instagram.com/${kind}/${shortcode}/embed/`, {
          headers,
          // Never forward the session to any redirect, including another host.
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.any([deadline, AbortSignal.timeout(1800)]),
        });
        if (!response.ok) {
          onAttempt?.({ kind, authenticated: Boolean(session), status: response.status, mediaFound: false });
          await response.body?.cancel();
          if (response.status === 429) return null;
          continue;
        }
        const html = await readLimited(response);
        const media = html ? parseInstagramEmbed(html, shortcode, type !== 'p') : null;
        onAttempt?.({ kind, authenticated: Boolean(session), status: response.status, mediaFound: Boolean(media) });
        if (media) return media;
      } catch {
        // Never record exception text: it may contain request details.
        onAttempt?.({ kind, authenticated: Boolean(session), status: 'network_error', mediaFound: false });
      }
    }
  }
  return null;
}
