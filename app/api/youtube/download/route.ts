import { NextRequest, NextResponse } from 'next/server';
import { fetchFallbackVideo } from '../../../lib/youtube-fallback';
import {
  contentDisposition,
  extractVideoId,
  humanizeYouTubeError,
  fetchYouTubeStream,
  resolveYouTubeVideo,
  safeFilename,
  type ResolvedVideo,
  type YouTubeClient,
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

  try {
    let video: ResolvedVideo = await resolveYouTubeVideo(videoId, kind);
    let upstream = await fetchYouTubeStream(video.streamUrl);

    // A URL can expire, or one YouTube client may be blocked while another works.
    // First try a fresh URL, then try the remaining clients rather than returning
    // the same cached stream repeatedly. Bound attempts to the five supported clients.
    if (!upstream.ok && [403, 404, 410].includes(upstream.status)) {
      await upstream.body?.cancel();
      try {
        video = await resolveYouTubeVideo(videoId, kind, { refresh: true });
        upstream = await fetchYouTubeStream(video.streamUrl);
      } catch {
        // Continue with other clients if refreshing the original one failed.
      }
    }

    const rejectedClients: YouTubeClient[] = [];
    while (!upstream.ok && [403, 404, 410].includes(upstream.status) && rejectedClients.length < 5) {
      rejectedClients.push(video.client);
      await upstream.body?.cancel();
      try {
        video = await resolveYouTubeVideo(videoId, kind, { refresh: true, excludeClients: rejectedClients });
      } catch {
        // No alternative could be resolved; report the last stream's HTTP error.
        break;
      }
      upstream = await fetchYouTubeStream(video.streamUrl);
    }

    if (!upstream.ok) {
      const reason =
        upstream.status === 403
          ? 'YouTube refused this download. If you host this app, set a YT_PO_TOKEN (or YT_COOKIE) environment variable.'
          : `YouTube responded with HTTP ${upstream.status}.`;
      throw new Error(reason);
    }

    if (!upstream.body) {
      throw new Error('YouTube returned an empty stream.');
    }

    const extension = video.isAudio || kind === 'audio' ? 'm4a' : 'mp4';
    const filename = `${safeFilename(video.title, 'luna-youtube')}.${extension}`;
    const headers: Record<string, string> = {
      'Content-Type': video.mimeType || 'video/mp4',
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };

    const length = upstream.headers.get('content-length');
    if (length) headers['Content-Length'] = length;

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    // Preserve the public-instance fallback for video when direct extraction or
    // streaming fails. The client expects bytes, not a JSON media URL.
    if (kind === 'video') {
      const fallback = await fetchFallbackVideo(videoId);
      if (fallback?.response.body) {
        const headers: Record<string, string> = {
          'Content-Type': 'video/mp4',
          'Content-Disposition': contentDisposition(`${safeFilename(fallback.title, 'luna-youtube')}.mp4`),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        };
        const length = fallback.response.headers.get('content-length');
        if (length) headers['Content-Length'] = length;
        return new NextResponse(fallback.response.body, { status: 200, headers });
      }
    }
    return NextResponse.json({ error: humanizeYouTubeError(error) }, { status: 502 });
  }
}
