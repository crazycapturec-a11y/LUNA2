import { NextRequest, NextResponse } from 'next/server';
import {
  contentDisposition,
  extractVideoId,
  humanizeYouTubeError,
  fetchYouTubeStream,
  resolveYouTubeVideo,
  safeFilename,
  type ResolvedVideo,
} from '../../../lib/youtube';

export const runtime = 'nodejs';
export const maxDuration = 300; // streaming a file can take a while (Hobby max: 300s)
export const dynamic = 'force-dynamic';

/**
 * GET /api/youtube/download?url=<watch url>[&kind=audio]
 *
 * Streams the video straight to the browser with `Content-Disposition: attachment`
 * so the user's device saves a real file. The googlevideo URL never leaves the
 * server for the browser to fetch on its own (it is IP-bound and sends no CORS
 * headers, which is exactly why the old "open in a new tab" flow saved nothing).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawUrl = params.get('url');
  const kind = params.get('kind') === 'audio' ? 'audio' : 'video';

  const videoId = rawUrl ? extractVideoId(rawUrl) : null;
  if (!videoId) {
    return NextResponse.json({ error: 'Missing or invalid YouTube URL' }, { status: 400 });
  }

  let video: ResolvedVideo;
  try {
    video = await resolveYouTubeVideo(videoId, kind);
  } catch (error) {
    return NextResponse.json({ error: humanizeYouTubeError(error) }, { status: 502 });
  }

  const extension = video.isAudio || kind === 'audio' ? 'm4a' : 'mp4';
  const filename = `${safeFilename(video.title, 'luna-youtube')}.${extension}`;

  try {
    let upstream = await fetchYouTubeStream(video.streamUrl);

    // The resolved URL might have rotated/expired: re-resolve once and retry.
    if (!upstream.ok && [403, 404, 410].includes(upstream.status)) {
      const fresh = await resolveYouTubeVideo(videoId, kind);
      video = fresh;
      upstream = await fetchYouTubeStream(fresh.streamUrl);
    }

    if (!upstream.ok) {
      const reason =
        upstream.status === 403
          ? 'YouTube refused this download. If you host this app, set a YT_PO_TOKEN (or YT_COOKIE) environment variable.'
          : `YouTube responded with HTTP ${upstream.status}.`;
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    if (!upstream.body) {
      return NextResponse.json({ error: 'YouTube returned an empty stream.' }, { status: 502 });
    }

    const headers: Record<string, string> = {
      'Content-Type': video.mimeType || 'video/mp4',
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };

    const length = upstream.headers.get('content-length');
    if (length) headers['Content-Length'] = length;
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) headers['Accept-Ranges'] = acceptRanges;

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    return NextResponse.json({ error: humanizeYouTubeError(error) }, { status: 502 });
  }
}
