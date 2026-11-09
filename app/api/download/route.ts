import { NextResponse } from 'next/server';
import { ultraigdl } from 'ultra-igdl';
import { instagramAuthOptions, normalizeInstagramPostUrl } from '../../lib/instagram';
import { fetchSnapInsta } from '../../lib/instagram-fallback';
import { withInstagramDeadline } from '../../lib/instagram-deadline';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type MediaItem = {
  url?: string;
  type?: string;
  thumbnail?: string;
};

type DownloadResult = {
  code?: number;
  message?: string;
  retryAfterMs?: number;
  media?: MediaItem[];
  caption?: string;
  username?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const url: string = typeof body?.url === 'string' ? body.url : '';

    const cleanUrl = normalizeInstagramPostUrl(url);
    if (!cleanUrl) {
      return NextResponse.json(
        { error: 'Please provide a valid Instagram reel or post link.' },
        { status: 400 },
      );
    }

    let auth;
    try {
      auth = instagramAuthOptions();
    } catch {
      return NextResponse.json({ error: 'Instagram session configuration is invalid. Please contact the site administrator.' }, { status: 503 });
    }
    const ig = new ultraigdl({
      cache: true,
      retries: 2,
      timeoutMs: 20000,
      ...auth,
    });

    let result: DownloadResult;
    try {
      // Leave time for the fallback within the 60-second function limit, even
      // when the extractor makes several network requests or retries.
      result = await withInstagramDeadline((async () => {
        let extracted = (await ig.download(cleanUrl)) as DownloadResult;
        // A cold/uncached post can answer 503 + retryAfterMs while extraction continues.
        if (extracted?.code !== 200 && Number(extracted?.retryAfterMs) > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(Number(extracted.retryAfterMs), 8000)));
          extracted = (await ig.download(cleanUrl)) as DownloadResult;
        }
        return extracted;
      })(), 42000);
    } catch {
      result = { code: 502 };
    }
    if (result?.code !== 200) {
      // Keep the existing SnapInsta integration only for unauthenticated requests.
      // Never transmit an Instagram session to the third-party service.
      if (!auth.cookies && !auth.sessionId && ![403, 429].includes(Number(result?.code))) {
        const fallback = await fetchSnapInsta(cleanUrl);
        if (fallback) return buildResponse({ code: 200, media: [fallback] }, cleanUrl);
      }
      // The extractor can include network errors or request details in its message.
      // Return only fixed messages; session cookies must never reach the browser.
      const code = Number(result?.code);
      if (code === 429) return NextResponse.json({ error: 'Instagram is rate-limiting requests. Please try again later.' }, { status: 429 });
      if (code === 403) return NextResponse.json({ error: 'This Instagram post is private or unavailable.' }, { status: 403 });
      if (code === 404) return NextResponse.json({ error: 'Instagram media was not found. The post may be unavailable or the server session may have expired.' }, { status: 404 });
      return NextResponse.json({ error: 'Could not read this Instagram post. Please try again later.' }, { status: 502 });
    }

    return buildResponse(result, cleanUrl);
  } catch {
    return NextResponse.json(
      { error: 'Something went wrong while reading that Instagram link.' },
      { status: 502 },
    );
  }
}

function buildResponse(result: DownloadResult, url: string) {
  const media: MediaItem[] = Array.isArray(result?.media) ? result.media : [];

  // Prefer a video entry (reels), otherwise fall back to whatever exists (photo post).
  const video = media.find((item) => item?.type === 'video' && item?.url) ||
    media.find((item) => typeof item?.url === 'string' && /\.mp4/i.test(item.url));
  const chosen = video || media.find((item) => item?.url);

  if (!chosen?.url) {
    return NextResponse.json(
      { error: 'No downloadable media was found for this Instagram link.' },
      { status: 404 },
    );
  }

  const type = chosen.type || (video ? 'video' : 'image');
  const thumbnail =
    chosen.thumbnail || (chosen.type === 'image' ? chosen.url : '') || '';

  return NextResponse.json({
    success: true,
    mediaUrl: chosen.url,
    mediaType: type,
    thumbnail,
    title: result?.caption?.slice(0, 120) || 'Instagram Video',
    author: result?.username || 'Instagram Creator',
    extension: type === 'video' ? 'mp4' : 'jpg',
    // Everything is streamed via our own proxy so the browser always receives a file.
    downloadUrl: `/api/proxy?url=${encodeURIComponent(chosen.url)}&kind=${type === 'video' ? 'video' : 'image'}`,
    url,
  });
}
