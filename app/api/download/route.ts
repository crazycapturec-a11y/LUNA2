import { NextResponse } from 'next/server';
import { ultraigdl } from 'ultra-igdl';
import { instagramAuthOptions, normalizeInstagramPostUrl } from '../../lib/instagram';

/**
 * ultra-igdl can leave a floating rejected promise behind when Instagram resets a
 * socket. Without a handler Node treats that as an unhandled rejection, which kills
 * the request (and can take the serverless instance down with it) even though our
 * own try/catch already produced a clean error response.
 */
let rejectionGuardInstalled = false;
function installRejectionGuard() {
  if (rejectionGuardInstalled) return;
  rejectionGuardInstalled = true;
  const handler = (reason: unknown) => {
    const code = (reason as { code?: string } | null)?.code;
    if (code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return;
    // The rejected error can contain request headers; never print it verbatim.
    console.error('[instagram] An asynchronous extraction request failed.');
  };
  if (typeof process.on === 'function') process.on('unhandledRejection', handler);
}

installRejectionGuard();

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

    let result = (await ig.download(cleanUrl)) as DownloadResult;

    // A cold/uncached post can answer 503 + retryAfterMs while extraction continues.
    if (result?.code !== 200 && Number(result?.retryAfterMs) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(Number(result.retryAfterMs), 8000)));
      result = (await ig.download(cleanUrl)) as DownloadResult;
    }
    if (result?.code !== 200) {
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
