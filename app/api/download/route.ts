import { NextResponse } from 'next/server';
import { ultraigdl } from 'ultra-igdl';
import { instagramAuthOptions, normalizeInstagramPostUrl, parseInstagramPostTarget } from '../../lib/instagram';
import { fetchInstagramDirect, type InstagramDirectAttempt } from '../../lib/instagram-direct';
import { withInstagramDeadline } from '../../lib/instagram-deadline';
import { fetchInstagramEmbed, instagramMediaUrl, type InstagramEmbedAttempt } from '../../lib/instagram-embed';
import { fetchSnapInsta } from '../../lib/instagram-fallback';
import { resolveInstagramShareUrl } from '../../lib/instagram-share';

export const runtime = 'nodejs';
export const maxDuration = 60;

type MediaItem = {
  url?: string;
  type?: 'video' | 'image';
  thumbnail?: string;
};

type TikwmPayload = {
  code?: number;
  data?: {
    id?: string;
    title?: string;
    cover?: string;
    origin_cover?: string;
    play?: string;
    hdplay?: string;
    music?: string;
    author?: { unique_id?: string; nickname?: string };
  };
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
    const rawUrl: string = typeof body?.url === 'string' ? body.url : '';

    if (!rawUrl) {
      return NextResponse.json({ error: 'Please provide a valid link.' }, { status: 400 });
    }

    // TikTok branch — keep Instagram untouched but allow direct TikTok via same endpoint
    let isTikTok = false;
    try {
      const u = new URL(rawUrl);
      const h = u.hostname.toLowerCase();
      if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) isTikTok = true;
    } catch {}
    if (!isTikTok && rawUrl.includes('tiktok.com')) isTikTok = true;

    if (isTikTok) {
      try {
        const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl)}&hd=1`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            Accept: 'application/json',
            Referer: 'https://www.tikwm.com/',
          },
        });
        const data = (await res.json().catch(() => null)) as TikwmPayload | null;
        if (data?.code === 0 && data?.data) {
          let hd = data.data.hdplay || data.data.play;
          let music = data.data.music;
          const cover = data.data.cover || data.data.origin_cover || '';
          const title = data.data.title || '';
          const author = data.data.author?.nickname || data.data.author?.unique_id || data.data.author || '';
          if (typeof hd === 'string' && hd.startsWith('//')) hd = 'https:' + hd;
          if (typeof music === 'string' && music.startsWith('//')) music = 'https:' + music;
          if (hd) {
            return NextResponse.json({
              success: true,
              mediaUrl: hd,
              mp3Url: typeof music === 'string' ? music : null,
              mediaType: 'video',
              title: typeof title === 'string' ? title : '',
              author: typeof author === 'string' ? author : '',
              thumbnail: typeof cover === 'string' ? cover : '',
            });
          }
        }
      } catch {}
      // fall through to Instagram error handling if TikWM fails — let tiktok/info handle it, but return helpful error
      return NextResponse.json({ error: 'Could not extract TikTok video. Try via TikTok button or check link.' }, { status: 502 });
    }

    let cleanUrl = normalizeInstagramPostUrl(rawUrl);
    if (!cleanUrl) {
      return NextResponse.json(
        { error: 'Please provide a valid Instagram reel or post link.' },
        { status: 400 },
      );
    }

    if (new URL(cleanUrl).pathname.toLowerCase().startsWith('/share/')) {
      const resolved = await resolveInstagramShareUrl(cleanUrl);
      if (!resolved) {
        return NextResponse.json(
          { error: 'Could not open this Instagram share link. Try copying the direct post or reel link.' },
          { status: 502 },
        );
      }
      cleanUrl = resolved;
    }

    let auth;
    try {
      auth = instagramAuthOptions();
    } catch {
      return NextResponse.json(
        { error: 'Instagram session configuration is invalid. Check IG_COOKIES or IG_SESSION_ID.' },
        { status: 503 },
      );
    }
    const hasSession = Boolean(auth.cookies || auth.sessionId);

    // Keep primary extractor bounded so fallbacks always have budget
    const ig = new ultraigdl({
      cache: false,
      retries: 1,
      timeoutMs: 8000,
      ...auth,
    });

    let result: DownloadResult;
    let extractorFailed = false;
    try {
      result = await withInstagramDeadline(
        (async () => {
          let extracted: DownloadResult = await ig.download(cleanUrl);
          if (extracted?.code === 503 && extracted.retryAfterMs) {
            await new Promise((r) => setTimeout(r, Math.min(extracted.retryAfterMs!, 2500)));
            extracted = await ig.download(cleanUrl);
          }
          return extracted;
        })(),
        15000,
      );
    } catch {
      extractorFailed = true;
      result = { code: 502 };
    }

    const primary = result?.code === 200 ? buildResponse(result, cleanUrl) : null;
    if (primary?.status === 200) return primary;

    const code = Number(result?.code);
    const isGenericLoginWall = code === 403 && result?.message === 'Private account';

    const embedAttempts: InstagramEmbedAttempt[] = [];
    const directAttempts: InstagramDirectAttempt[] = [];
    let sessionInvalid = false;
    let gated = false;

    const logFailure = () => {
      console.info('[instagram] lookup failed', {
        primary: Number.isInteger(code) ? code : 'unknown',
        extractorFailed,
        sessionConfigured: hasSession,
        sessionInvalid,
        gated,
        embedAttempts,
        directAttempts,
      });
    };

    if (code !== 429 && (code !== 403 || isGenericLoginWall)) {
      // 1. Public embeds (cookie-free)
      const publicEmbed = await fetchInstagramEmbed(
        cleanUrl,
        {},
        (attempt) => embedAttempts.push(attempt),
        { mode: 'public' },
      );
      if (publicEmbed) {
        const res = buildResponse(
          {
            code: 200,
            media: [publicEmbed],
            caption: publicEmbed.caption,
            username: publicEmbed.username,
          },
          cleanUrl,
        );
        if (res.status === 200) return res;
      }
      if (embedAttempts.some((attempt) => attempt.status === 429)) {
        logFailure();
        return NextResponse.json(
          { error: 'Instagram is rate-limiting requests. Please try again later.' },
          { status: 429 },
        );
      }

      // 2. Direct 2026 lookup
      const direct = await fetchInstagramDirect(cleanUrl, auth, (attempt) => directAttempts.push(attempt));
      sessionInvalid = direct.sessionInvalid;
      gated = direct.gated;
      if (direct.media) {
        const res = buildResponse(
          {
            code: 200,
            media: [direct.media],
            caption: direct.media.caption,
            username: direct.media.username,
          },
          cleanUrl,
        );
        if (res.status === 200) return res;
      }
      if (direct.rateLimited) {
        logFailure();
        return NextResponse.json(
          { error: 'Instagram is rate-limiting requests. Please try again later.' },
          { status: 429 },
        );
      }

      // 3. Authenticated embeds (skip if session already invalid)
      if (hasSession && !sessionInvalid) {
        const authEmbed = await fetchInstagramEmbed(
          cleanUrl,
          auth,
          (attempt) => embedAttempts.push(attempt),
          { mode: 'authenticated' },
        );
        if (authEmbed) {
          const res = buildResponse(
            {
              code: 200,
              media: [authEmbed],
              caption: authEmbed.caption,
              username: authEmbed.username,
            },
            cleanUrl,
          );
          if (res.status === 200) return res;
        }
        if (embedAttempts.some((attempt) => attempt.status === 429)) {
          logFailure();
          return NextResponse.json(
            { error: 'Instagram is rate-limiting requests. Please try again later.' },
            { status: 429 },
          );
        }
      }

      // 4. Never transmit an Instagram session to the third-party service, or send
      //    the post link there when the server has a shared Instagram session.
      if (!hasSession) {
        const fallback = await fetchSnapInsta(cleanUrl);
        if (fallback) {
          const response = buildResponse({ code: 200, media: [fallback] }, cleanUrl);
          if (response.status === 200) return response;
        }
      }
    }

    logFailure();

    if (code === 429) {
      return NextResponse.json(
        { error: 'Instagram is rate-limiting requests. Please try again later.' },
        { status: 429 },
      );
    }
    if (sessionInvalid) {
      return NextResponse.json(
        {
          error:
            'Instagram did not provide a downloadable file. The configured Instagram session appears to have expired or been logged out.',
        },
        { status: 502 },
      );
    }
    if (code === 403 || (gated && !hasSession)) {
      return NextResponse.json(
        { error: 'This Instagram post is private, restricted, or unavailable.' },
        { status: 403 },
      );
    }
    if (code === 404 || primary || gated) {
      return NextResponse.json(
        {
          error:
            'Instagram did not provide a downloadable file. The post may be unavailable, the server session may have expired, or Instagram may be blocking the request.',
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: 'Could not read this Instagram post. Please try again later.' },
      { status: 502 },
    );
  } catch {
    return NextResponse.json(
      { error: 'Something went wrong while reading that Instagram link.' },
      { status: 500 },
    );
  }
}

function buildResponse(result: DownloadResult, url: string) {
  const media: MediaItem[] = (Array.isArray(result?.media) ? result.media : []).filter((item) =>
    instagramMediaUrl(item?.url),
  );

  const target = parseInstagramPostTarget(url);
  const videoOnly = target ? target.videoOnly : /^\/(?:reel|tv)\//i.test(new URL(url).pathname);

  const video =
    media.find((item) => item?.type === 'video' && item?.url) ||
    media.find(
      (item) => item?.type !== 'image' && typeof item?.url === 'string' && /\.mp4(?:[?#]|$)/i.test(item.url),
    );
  const chosen = video || (!videoOnly ? media.find((item) => item?.type === 'image' && item?.url) : undefined);

  if (!chosen?.url) {
    return NextResponse.json(
      { error: 'No downloadable video was found for this post.' },
      { status: 404 },
    );
  }

  const safeUrl = instagramMediaUrl(chosen.url);
  if (!safeUrl) {
    return NextResponse.json(
      { error: 'No downloadable video was found for this post.' },
      { status: 404 },
    );
  }

  const type = chosen.type || (video ? 'video' : 'image');
  const thumbnail = instagramMediaUrl(chosen.thumbnail) || (type === 'image' ? safeUrl : '') || '';
  const extension = type === 'image' ? 'jpg' : 'mp4';

  return NextResponse.json({
    success: true,
    mediaUrl: safeUrl,
    downloadUrl: `/api/proxy?url=${encodeURIComponent(safeUrl)}&kind=${type}&filename=luna-instagram.${extension}`,
    mediaType: type,
    extension,
    thumbnail,
    caption: typeof result?.caption === 'string' ? result.caption : '',
    username: typeof result?.username === 'string' ? result.username : '',
  });
}
