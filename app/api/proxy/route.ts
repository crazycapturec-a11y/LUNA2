import { NextRequest, NextResponse } from 'next/server';
import { contentDisposition, safeFilename } from '../../lib/youtube';
import { getTikTokCookies, seedTikTokCookies } from '../../lib/tiktok-session';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Same-origin media relay for TikTok + Instagram CDN URLs.
 *
 * Both CDNs are IP/CDN-playlist oriented and do not always send CORS headers, so a
 * browser `fetch()` followed by a Blob download can fail. Streaming the bytes back
 * from our own origin with `Content-Disposition: attachment` makes the download
 * work on every browser/device (including iOS Safari).
 *
 * TikTok publishes several URLs for one video and its web-player CDN also rejects
 * anonymous requests, so this route tries every candidate the lookup found, with
 * the visitor cookies captured from the TikTok page itself.
 */

const INSTAGRAM_HOST_SUFFIXES = ['cdninstagram.com', 'fbcdn.net', 'instagram.com'];
const TIKTOK_HOST_SUFFIXES = [
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'tiktokv.com',
  'tiktokv.us',
  'tiktok.com',
  'byteoversea.com',
  'ibytedtos.com',
  'muscdn.com',
  'musical.ly',
];
const ALLOWED_HOST_SUFFIXES = [...INSTAGRAM_HOST_SUFFIXES, ...TIKTOK_HOST_SUFFIXES, 'tikwm.com'];

/** Statuses TikTok/Instagram use when they refuse a server IP rather than the file. */
const UNUSABLE_STATUSES = [401, 403, 451];
const MAX_ALTERNATE_URLS = 6;

function matchesHost(host: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function hostFlags(target: string): { isInstagramHost: boolean; isTikwmHost: boolean; isTikTokHost: boolean } {
  const host = new URL(target).hostname.toLowerCase();
  const isInstagramHost = matchesHost(host, INSTAGRAM_HOST_SUFFIXES);
  const isTikwmHost = host === 'tikwm.com' || host.endsWith('.tikwm.com');
  const isTikTokHost = matchesHost(host, TIKTOK_HOST_SUFFIXES) && !isTikwmHost;
  return { isInstagramHost, isTikwmHost, isTikTokHost };
}

function isAllowed(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password || parsed.port) return false;
    return matchesHost(parsed.hostname.toLowerCase(), ALLOWED_HOST_SUFFIXES);
  } catch {
    return false;
  }
}

function buildHeaders(target: string, inlineImage: boolean): Record<string, string> {
  const { isInstagramHost, isTikwmHost, isTikTokHost } = hostFlags(target);
  const cookies = isTikTokHost ? getTikTokCookies() : '';

  return {
    // Use a current Chrome UA like cobalt to avoid CDN bot checks
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    Accept: inlineImage ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: isInstagramHost ? 'https://www.instagram.com/' : isTikwmHost ? 'https://www.tikwm.com/' : 'https://www.tiktok.com/',
    // The visitor cookies are what makes TikTok's media CDN serve the file at all.
    ...(cookies ? { Cookie: cookies } : {}),
    // Help TikTok CDN allowlist checks — mimic real browser navigation for video/image
    ...(isTikTokHost && !inlineImage
      ? {
          'Sec-Fetch-Dest': 'video',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'same-site',
        }
      : {}),
    ...(isTikTokHost && inlineImage
      ? {
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'same-site',
        }
      : {}),
  };
}

/**
 * Header variations tried, in order, when the first request is refused. The CDN
 * edges disagree about which combination they accept, so try the cheap ones first.
 */
function headerVariants(target: string, baseHeaders: Record<string, string>): Record<string, string>[] {
  const { isTikTokHost } = hostFlags(target);
  const attempts: Record<string, string>[] = [baseHeaders];

  if (!isTikTokHost) {
    // For Instagram / tikwm just try Range once
    attempts.push({ ...baseHeaders, Range: 'bytes=0-' });
    return attempts;
  }

  const mobileUA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  attempts.push(
    { ...baseHeaders, Range: 'bytes=0-' },
    { ...baseHeaders, 'User-Agent': mobileUA },
    { ...baseHeaders, 'User-Agent': mobileUA, Range: 'bytes=0-' },
    { ...baseHeaders, Origin: 'https://www.tiktok.com' },
    { ...baseHeaders, Origin: 'https://www.tiktok.com', Range: 'bytes=0-' },
    // Some edges want a tiktok web cookie hint
    { ...baseHeaders, Referer: 'https://m.tiktok.com/' },
    // Some tiktokcdn edges accept no-referer or tikwm referer when server IP is flagged
    { ...baseHeaders, Referer: 'https://www.tikwm.com/' },
    { ...baseHeaders, Referer: '' },
  );
  return attempts;
}

async function fetchAllowedMedia(target: string, headers: Record<string, string>): Promise<Response> {
  let current = target;
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (!isAllowed(current)) throw new Error('Unsupported media redirect');
    const response = await fetch(current, { method: 'GET', redirect: 'manual', cache: 'no-store', headers, signal: AbortSignal.timeout(30000) });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === 4) throw new Error('Invalid media redirect');
    current = new URL(location, current).href;
  }
  throw new Error('Too many media redirects');
}

function extensionFor(kind: string, contentType: string): string {
  if (kind === 'audio') return 'mp3';
  if (kind === 'image') return 'jpg';
  if (contentType.includes('audio')) return 'mp3';
  if (contentType.includes('image')) return 'jpg';
  if (contentType.includes('webm')) return 'webm';
  return 'mp4';
}

const SAFE_INLINE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

function mimeOf(response: Response): string {
  return (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
}

/**
 * A response we can hand to the browser. A rejected request is not usable even
 * when it looks like a file: TikTok answers 403 with `Content-Type: video/mp4`.
 */
function isUsable(response: Response, inlineImage: boolean): boolean {
  if (!response.ok || !response.body) return false;
  const mime = mimeOf(response);
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return false;
  if (inlineImage && !SAFE_INLINE_IMAGE_TYPES.has(mime)) return false;
  return true;
}

type MediaAttempt = { response: Response | null; status: number; rejectedPreviewType: boolean };

/** One candidate URL, tried with the base headers and then the header variations. */
async function attemptMedia(target: string, inlineImage: boolean): Promise<MediaAttempt> {
  const variants = headerVariants(target, buildHeaders(target, inlineImage));
  let status = 0;
  let rejectedPreviewType = false;

  let first: Response;
  try {
    first = await fetchAllowedMedia(target, variants[0]);
  } catch {
    return { response: null, status, rejectedPreviewType };
  }
  if (isUsable(first, inlineImage)) return { response: first, status, rejectedPreviewType };

  status = first.status;
  rejectedPreviewType = first.ok && inlineImage;
  await first.body?.cancel().catch(() => {});
  // Only a refusal is worth retrying with other headers; a real answer is final.
  if (!UNUSABLE_STATUSES.includes(first.status)) return { response: null, status, rejectedPreviewType };

  for (const headers of variants.slice(1)) {
    try {
      const response = await fetchAllowedMedia(target, headers);
      if (isUsable(response, inlineImage)) return { response, status, rejectedPreviewType };
      status = response.status || status;
      rejectedPreviewType = rejectedPreviewType || (response.ok && inlineImage);
      await response.body?.cancel().catch(() => {});
    } catch {
      // try the next header variation
    }
  }

  return { response: null, status, rejectedPreviewType };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = params.get('url');
  const kind = params.get('kind') || 'video';
  const inlineImage = kind === 'image' && params.get('disposition') === 'inline';
  const requestedName = params.get('filename');
  const videoId = params.get('vid') || '';

  if (!target) return NextResponse.json({ error: 'Missing URL' }, { status: 400 });
  if (!isAllowed(target)) {
    return NextResponse.json({ error: 'This media host is not supported.' }, { status: 400 });
  }

  // Alternates are generated by our own lookup route and re-validated here, so a
  // crafted `alt` cannot turn this into an open relay.
  const candidates = [target, ...params.getAll('alt')]
    .filter((value): value is string => typeof value === 'string' && value.length > 0 && isAllowed(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 1 + MAX_ALTERNATE_URLS);

  try {
    // A cold server instance (or a different lambda) may not have the cookies yet.
    if (candidates.some((candidate) => hostFlags(candidate).isTikTokHost) && !getTikTokCookies()) {
      await seedTikTokCookies(videoId);
    }

    let upstream: Response | null = null;
    let lastStatus = 0;
    let rejectedPreviewType = false;

    for (const candidate of candidates) {
      const attempt = await attemptMedia(candidate, inlineImage);
      if (attempt.response) {
        upstream = attempt.response;
        break;
      }
      lastStatus = attempt.status || lastStatus;
      rejectedPreviewType = rejectedPreviewType || attempt.rejectedPreviewType;
    }

    if (!upstream) {
      if (inlineImage && rejectedPreviewType) {
        return NextResponse.json({ error: 'Unsupported preview image type.' }, { status: 415 });
      }
      // Never save a rejection page: TikTok returns 403 with a video content type.
      if (lastStatus >= 400) {
        return NextResponse.json({ error: `The media source responded with HTTP ${lastStatus}.` }, { status: 502 });
      }
      return NextResponse.json(
        { error: 'The media link expired or was declined by the server. Fetch the link again.' },
        { status: 502 },
      );
    }

    const defaultType = kind === 'audio' ? 'audio/mpeg' : kind === 'image' ? 'image/jpeg' : 'video/mp4';
    const contentType = upstream.headers.get('content-type') || defaultType;
    const mime = mimeOf(upstream);

    const filename = requestedName
      ? safeFilename(requestedName, `luna-download.${extensionFor(kind, contentType)}`)
      : `luna-download.${extensionFor(kind, contentType)}`;

    const headers: Record<string, string> = {
      'Content-Type': inlineImage ? mime : contentType,
      'Content-Disposition': inlineImage
        ? 'inline'
        : contentDisposition(
            filename.includes('.') ? filename : `${filename}.${extensionFor(kind, contentType)}`,
          ),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (inlineImage) {
      headers['Content-Security-Policy'] = "default-src 'none'";
    }

    const length = upstream.headers.get('content-length');
    if (length) headers['Content-Length'] = length;
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) headers['Accept-Ranges'] = acceptRanges;

    // 206 only if the upstream really is a partial response we asked for; we always
    // relay the complete body the CDN gave us.
    const status = upstream.status === 206 ? 200 : upstream.status;

    return new NextResponse(upstream.body, { status, headers });
  } catch {
    return NextResponse.json(
      { error: 'Download failed — the media link may have expired. Fetch the video again.' },
      { status: 502 },
    );
  }
}
