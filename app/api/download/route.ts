import { NextResponse } from 'next/server';
import { ultraigdl } from 'ultra-igdl';

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
    console.error('[instagram] unhandled rejection:', reason);
  };
  if (typeof process.on === 'function') process.on('unhandledRejection', handler);
}

installRejectionGuard();

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const IG_URL_RE =
  /(?:instagram\.com|instagr\.am)\/(?:reel|reels|p|tv|share)\/([A-Za-z0-9_-]+)/i;

function normalizeUrl(input: string): string | null {
  if (!IG_URL_RE.test(input)) return null;
  try {
    const parsed = new URL(input.trim());
    parsed.search = '';
    parsed.hash = '';
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${path}/`;
  } catch {
    return null;
  }
}

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

    const cleanUrl = normalizeUrl(url);
    if (!cleanUrl) {
      return NextResponse.json(
        { error: 'Please provide a valid Instagram reel or post link.' },
        { status: 400 },
      );
    }

    const ig = new ultraigdl({
      cache: true,
      retries: 2,
      timeoutMs: 20000,
      // Reels are served with a "session recommended" hint when logged out; the
      // library still returns the media array, we just prefer the video entry.
      ...(process.env.IG_SESSION_ID ? { sessionId: process.env.IG_SESSION_ID } : {}),
    });

    const result = (await ig.download(cleanUrl)) as DownloadResult;

    // A cold/uncached post can answer 503 + retryAfterMs while extraction continues.
    if (result?.code !== 200) {
      const retryAfterMs = Number(result?.retryAfterMs) || 0;
      if (retryAfterMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfterMs, 8000)));
        const retried = (await ig.download(cleanUrl)) as DownloadResult;
        if (retried?.code === 200) {
          return buildResponse(retried, cleanUrl);
        }
      }
      return NextResponse.json(
        { error: `Instagram error: ${result?.message || 'could not read this post.'}` },
        { status: 400 },
      );
    }

    return buildResponse(result, cleanUrl);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Something went wrong while reading that Instagram link.',
      },
      { status: 500 },
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
