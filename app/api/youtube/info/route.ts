import { NextRequest, NextResponse } from 'next/server';
import { fetchFallbackVideo } from '../../../lib/youtube-fallback';
import { getYouTubeWorkerConfig } from '../../../lib/youtube-worker';
import { extractVideoId, humanizeYouTubeError, resolveYouTubeVideo } from '../../../lib/youtube';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type OEmbed = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

/**
 * Returns metadata for the preview card. Resolution is attempted first because it
 * proves the video can actually be downloaded — no more "thumbnail previews, but
 * the download button fails" dead end.
 */
export async function GET(request: NextRequest) {
  const urlParam = request.nextUrl.searchParams.get('url');
  if (!urlParam) return NextResponse.json({ error: 'Missing URL' }, { status: 400 });

  const videoId = extractVideoId(urlParam);
  if (!videoId) {
    return NextResponse.json({ error: 'That does not look like a YouTube video link.' }, { status: 400 });
  }

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // oEmbed is cheap and always available for public videos: good fallback metadata.
  let fallback: OEmbed | null = null;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      { cache: 'no-store', signal: AbortSignal.timeout(6000) },
    );
    if (res.ok) fallback = (await res.json()) as OEmbed;
  } catch {
    /* non-fatal */
  }

  try {
    if (getYouTubeWorkerConfig()) {
      // The worker verifies availability when a download is started; oEmbed is
      // metadata only, so a preview must not be treated as a successful download.
      return NextResponse.json({
        success: true,
        videoId,
        title: fallback?.title || 'YouTube Video',
        author: fallback?.author_name || 'YouTube Creator',
        thumbnail: fallback?.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: watchUrl,
        worker: true,
      });
    }
  } catch {
    return NextResponse.json({ error: 'The YouTube worker is not configured correctly.' }, { status: 503 });
  }

  try {
    const video = await resolveYouTubeVideo(videoId, 'video');
    return NextResponse.json({
      success: true,
      videoId,
      title: video.title || fallback?.title || 'YouTube Video',
      author: video.author || fallback?.author_name || 'YouTube Creator',
      thumbnail: video.thumbnail || fallback?.thumbnail_url || '',
      mimeType: video.mimeType,
      url: watchUrl,
    });
  } catch (error) {
    const reason = humanizeYouTubeError(error);
    if (fallback) {
      return NextResponse.json({
        success: true,
        videoId,
        title: fallback.title || 'YouTube Video',
        author: fallback.author_name || 'YouTube Creator',
        thumbnail: fallback.thumbnail_url || '',
        url: watchUrl,
        warning: reason,
      });
    }
    // If oEmbed and direct extraction both fail, still allow the preview when a
    // public instance can actually supply a stream. Close it; download resolves
    // a fresh URL when the user clicks the button.
    const instance = await fetchFallbackVideo(videoId);
    if (instance) {
      await instance.response.body?.cancel();
      return NextResponse.json({
        success: true,
        videoId,
        title: instance.title,
        author: 'YouTube Creator',
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: watchUrl,
        warning: reason,
      });
    }
    return NextResponse.json({ error: reason }, { status: 502 });
  }
}
