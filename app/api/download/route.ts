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

    // ==========================================
    // 🎵 TIKTOK LOGIC (Bypasses 403 using TikWM)
    // ==========================================
    // Detect TikTok via host parsing to avoid open redirect bypass,
    // but keep substring fallback for robustness with short links.
    let isTikTok = false;
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) isTikTok = true;
    } catch {
      // fall through
    }
    if (!isTikTok && rawUrl.includes('tiktok.com')) isTikTok = true;

    if (isTikTok) {
      const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl)}`);
      const data = await res.json().catch(() => null);

      if (!data || data.code !== 0 || !data.data) {
        return NextResponse.json({ error: 'Could not extract TikTok video. It might be private.' }, { status: 502 });
      }

      let hd = data.data.hdplay || data.data.play;
      let music = data.data.music;
      const cover = data.data.cover || data.data.origin_cover || data.data.ai_dynamic_cover || '';
      const title = data.data.title || '';
      const author = data.data.author?.nickname || data.data.author?.unique_id || data.data.author || '';

      if (typeof hd === 'string' && hd.indexOf('//') === 0) hd = 'https:' + hd;
      if (typeof music === 'string' && music.indexOf('//') === 0) music = 'https:' + music;

      if (!hd) {
        return NextResponse.json({ error: 'No downloadable video found for this TikTok.' }, { status: 502 });
      }

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

    // ==========================================
    // 📸 INSTAGRAM LOGIC (Robust + Cookies)
    // ==========================================
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

    // Keep primary extractor bounded so fallbacks (embed + 2026 GraphQL/Polaris)
    // always have plenty of budget inside the 60-second serverless limit.
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
    // ultra-igdl returns `{ code: 403, message: 'Private account' }` whenever
    // Instagram serves a generic "Log in to Instagram" HTML page — including for
    // public posts accessed from cloud IPs or with an expired session. Allow
    // first-party Instagram fallbacks to verify those before giving up.
    const isGenericLoginWall = code === 403 && result?.message === 'Private account';

    const embedAttempts: InstagramEmbedAttempt[] = [];
    const directAttempts: InstagramDirectAttempt[] = [];
    let sessionInvalid = false;
    let gated = false;

    const logFailure = () => {
      // Log fixed status metadata only — never the post URL, shortcode, session, or raw errors.
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
      // 1. Public captioned/plain embeds first (cookie-free, real iframe navigation headers).
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

      // 2. Direct first-party 2026 Instagram lookup:
      //    - authenticated api/v1/media/{pk}/info/ (if configured, with current X-ASBD-ID)
      //    - anonymous web session + /api/graphql (shortcode + Polaris logged-out queries)
      //    - anonymous permalink data-sjs extraction (with dynamic queryID recovery)
      //    - anonymous mobile media info
      //    - authenticated permalink data-sjs + /api/graphql (if session configured & valid)
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

      // 3. Authenticated captioned/plain embeds only on Instagram (never following redirects),
      //    skipped if the configured session was already rejected as expired/invalid.
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

    // Do not expose raw provider/network errors or credential values.
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
      { error: 'Something went wrong while reading that link.' },
      { status: 500 },
    );
  }
}

function buildResponse(result: DownloadResult, url: string) {
  const media: MediaItem[] = (Array.isArray(result?.media) ? result.media : []).filter((item) =>
    instagramMediaUrl(item?.url),
  );

  // A reel or TV video must not silently turn into a thumbnail/photo download.
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
