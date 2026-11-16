import { NextRequest, NextResponse } from 'next/server';
import { fetchDirectTikTok, normalizeTikTokUrl, type DirectTikTokResult } from '../../../lib/tiktok-direct';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * TikTok metadata + direct media URLs.
 *
 * The lookup happens server-side on purpose: tikwm's public API does not guarantee
 * CORS headers, so calling it from the browser used to fail silently and left the
 * preview working while every download button did nothing.
 */

type TikwmResponse = {
  code: number;
  msg?: string;
  data?: {
    id?: string;
    title?: string;
    cover?: string;
    origin_cover?: string;
    play?: string;
    hdplay?: string;
    wmplay?: string;
    music?: string;
    duration?: number;
    author?: { unique_id?: string; nickname?: string };
    music_info?: { title?: string; author?: string; play?: string };
  };
};

function absolute(url?: string): string {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `https://www.tikwm.com${url}`;
  return url;
}

/**
 * Build a media-proxy link that carries every candidate URL for the same file.
 * TikTok serves one video from several hosts and can refuse any single one, so the
 * proxy tries the alternates before reporting a failure.
 */
function proxyDownloadUrl(
  primary: string,
  alternates: string[],
  kind: 'video' | 'audio',
  filename: string,
  videoId?: string,
): string {
  const params = new URLSearchParams({ url: primary, kind, filename });
  let added = 0;
  for (const alternate of alternates) {
    if (!alternate || alternate === primary || added >= 6) continue;
    params.append('alt', alternate);
    added += 1;
  }
  if (videoId) params.set('vid', videoId);
  return `/api/proxy?${params.toString()}`;
}

const TIKWM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

/** Total time TikWM gets before we stop waiting for it. */
const TIKWM_BUDGET_MS = 2500;
/** If TikWM has not answered by now, the TikTok page scrape starts in parallel. */
const TIKWM_HEDGE_MS = 1000;

/**
 * One TikWM endpoint, one short budget, no POST retry.
 *
 * The old version tried two hostnames (8 s each) plus an 8 s POST fallback on
 * 403/429, so a rate-limited TikWM cost ~17 s before the TikTok page was ever
 * fetched — and the page scrape is the path that actually works from a server IP.
 * A healthy TikWM answers in well under a second; anything slower is not worth
 * blocking the preview for.
 */
async function fetchTikwm(videoUrl: string): Promise<TikwmResponse | null> {
  try {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIKWM_BUDGET_MS),
      redirect: 'manual',
      headers: {
        'User-Agent': TIKWM_UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.tikwm.com/',
        Origin: 'https://www.tikwm.com',
      },
    });

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }

    const payload = (await res.json().catch(() => null)) as TikwmResponse | null;
    if (payload?.code !== 0 || !payload?.data) return null;
    return payload;
  } catch {
    // Timeout, DNS failure or rate limit — the page scrape takes over.
    return null;
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw) return NextResponse.json({ error: 'Missing URL' }, { status: 400 });

  const videoUrl = normalizeTikTokUrl(raw);
  if (!videoUrl) {
    return NextResponse.json({ error: 'That does not look like a TikTok link.' }, { status: 400 });
  }

  let lastError = 'Could not read this TikTok video.';

  // Hedge the two lookups instead of stacking their timeouts. TikWM keeps the fast
  // path, but as soon as it looks slow the TikTok page starts loading too, and the
  // first real answer wins. A dead TikWM now costs one hedge delay instead of its
  // whole budget before the preview can render.
  let directPromise: Promise<DirectTikTokResult | null> | null = null;
  const startDirect = () => {
    directPromise ??= fetchDirectTikTok(videoUrl);
    return directPromise;
  };
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  const hedgedDirect = new Promise<DirectTikTokResult | null>((resolve) => {
    hedgeTimer = setTimeout(() => resolve(startDirect()), TIKWM_HEDGE_MS);
  });

  const winner = await Promise.race([
    fetchTikwm(videoUrl).then((data) => ({ tikwm: data })),
    hedgedDirect.then((data) => ({ direct: data })),
  ]);
  const tikwm = 'tikwm' in winner ? winner.tikwm : null;

  if (tikwm?.data) {
    if (hedgeTimer) clearTimeout(hedgeTimer);
    const data = tikwm.data;
    const hd = absolute(data.hdplay) || absolute(data.play);
    const sd = absolute(data.play) || hd;
    const music = absolute(data.music) || absolute(data.music_info?.play);

    if (hd) {
      const filenameBase = `luna-tiktok-${data.id || Date.now()}`;
      return NextResponse.json({
        success: true,
        id: data.id,
        title: data.title || 'TikTok Video',
        author: data.author?.unique_id || data.author?.nickname || 'tiktok',
        thumbnail: absolute(data.origin_cover) || absolute(data.cover),
        duration: data.duration,
        hdUrl: hd,
        sdUrl: sd,
        mp3Url: music || null,
        downloadUrls: {
          hd: `/api/proxy?url=${encodeURIComponent(hd)}&kind=video&filename=${filenameBase}-hd.mp4`,
          sd: `/api/proxy?url=${encodeURIComponent(sd)}&kind=video&filename=${filenameBase}-sd.mp4`,
          mp3: music ? `/api/proxy?url=${encodeURIComponent(music)}&kind=audio&filename=${filenameBase}.mp3` : null,
        },
        url: videoUrl,
      });
    }
    lastError = 'No downloadable video file was found for this TikTok link.';
  } else {
    lastError = 'TikTok lookup failed. The lookup service may be rate-limited from this server.';
  }

  // The page scrape is already running when it won the race; if TikWM failed fast
  // it has not started yet, so start it now.
  if (hedgeTimer) clearTimeout(hedgeTimer);

  // TikWM can reject hosting-provider IPs. Try TikTok's page directly without
  // credentials; a successful lookup does not guarantee the CDN will stream.
  const direct = 'direct' in winner ? winner.direct : await startDirect();
  if (direct) {
    const filenameBase = `luna-tiktok-${direct.id}`;
    const candidates = direct.videoCandidates.length > 0 ? direct.videoCandidates : [direct.hd];
    const primary = candidates[0];
    const alternates = candidates.slice(1);
    const sdPrimary = direct.sd || primary;
    return NextResponse.json({
      success: true,
      id: direct.id,
      title: direct.title,
      author: direct.author,
      thumbnail: direct.thumbnail,
      duration: direct.duration,
      hdUrl: primary,
      sdUrl: sdPrimary,
      mp3Url: direct.music || null,
      downloadUrls: {
        hd: proxyDownloadUrl(primary, alternates, 'video', `${filenameBase}-hd.mp4`, direct.id),
        sd: proxyDownloadUrl(sdPrimary, alternates.filter((url) => url !== sdPrimary), 'video', `${filenameBase}-sd.mp4`, direct.id),
        mp3: direct.music
          ? `/api/proxy?url=${encodeURIComponent(direct.music)}&kind=audio&filename=${filenameBase}.mp3`
          : null,
      },
      url: videoUrl,
    });
  }

  return NextResponse.json({ error: `${lastError} TikTok's direct lookup was also unavailable.` }, { status: 502 });
}
