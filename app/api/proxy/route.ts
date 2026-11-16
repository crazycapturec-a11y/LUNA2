import { NextRequest, NextResponse } from 'next/server';
import { contentDisposition, safeFilename } from '../../lib/youtube';

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
 */

const ALLOWED_HOST_SUFFIXES = [
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'tiktokv.com',
  'tiktokv.us',
  'tiktok.com',
  'tikwm.com',
  'byteoversea.com',
  'ibytedtos.com',
  'cdninstagram.com',
  'fbcdn.net',
  'instagram.com',
];

function isAllowed(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password || parsed.port) return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

async function fetchAllowedMedia(target: string, headers: Record<string, string>): Promise<Response> {
  let current = target;
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (!isAllowed(current)) throw new Error('Unsupported media redirect');
    const response = await fetch(current, { method: 'GET', redirect: 'manual', cache: 'no-store', headers });
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

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = params.get('url');
  const kind = params.get('kind') || 'video';
  const inlineImage = kind === 'image' && params.get('disposition') === 'inline';
  const requestedName = params.get('filename');

  if (!target) return NextResponse.json({ error: 'Missing URL' }, { status: 400 });
  if (!isAllowed(target)) {
    return NextResponse.json({ error: 'This media host is not supported.' }, { status: 400 });
  }

  const targetHost = new URL(target).hostname.toLowerCase();
  const isInstagramHost = ['cdninstagram.com', 'fbcdn.net', 'instagram.com'].some(
    (suffix) => targetHost === suffix || targetHost.endsWith(`.${suffix}`),
  );
  const isTikwmHost = targetHost === 'tikwm.com' || targetHost.endsWith('.tikwm.com');
  const baseHeaders: Record<string, string> = {
    // Bare minimum headers: CDNs reject requests that impersonate the app too hard.
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: inlineImage ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: isInstagramHost ? 'https://www.instagram.com/' : isTikwmHost ? 'https://www.tikwm.com/' : 'https://www.tiktok.com/',
  };

  try {
    let upstream = await fetchAllowedMedia(target, baseHeaders);

    // Some CDN edges answer 403 unless a byte range is requested.
    if ([401, 403, 451].includes(upstream.status)) {
      await upstream.body?.cancel();
      upstream = await fetchAllowedMedia(target, { ...baseHeaders, Range: 'bytes=0-' });
    }

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `The media source responded with HTTP ${upstream.status}.` },
        { status: 502 },
      );
    }

    const defaultType = kind === 'audio' ? 'audio/mpeg' : kind === 'image' ? 'image/jpeg' : 'video/mp4';
    const contentType = upstream.headers.get('content-type') || defaultType;
    const mime = contentType.split(';', 1)[0].trim().toLowerCase();

    // Never save an upstream HTML error page disguised as a media download.
    if (mime === 'text/html' || mime === 'application/xhtml+xml') {
      await upstream.body.cancel().catch(() => {});
      return NextResponse.json(
        { error: 'The media link expired or was declined by the server. Fetch the link again.' },
        { status: 502 },
      );
    }

    if (inlineImage && !SAFE_INLINE_IMAGE_TYPES.has(mime)) {
      await upstream.body.cancel().catch(() => {});
      return NextResponse.json({ error: 'Unsupported preview image type.' }, { status: 415 });
    }

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
