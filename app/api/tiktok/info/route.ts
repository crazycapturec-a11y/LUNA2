import { NextRequest, NextResponse } from 'next/server';
import { fetchDirectTikTok, normalizeTikTokUrl } from '../../../lib/tiktok-direct';

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

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw) return NextResponse.json({ error: 'Missing URL' }, { status: 400 });

  const videoUrl = normalizeTikTokUrl(raw);
  if (!videoUrl) {
    return NextResponse.json({ error: 'That does not look like a TikTok link.' }, { status: 400 });
  }

  const endpoints = [
    `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`,
    `https://tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`,
  ];

  let lastError = 'Could not read this TikTok video.';

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
          Referer: 'https://www.tikwm.com/',
        },
      });

      if (!res.ok) {
        lastError = `TikTok lookup failed (HTTP ${res.status}).`;
        continue;
      }

      const payload = (await res.json()) as TikwmResponse;
      if (payload?.code !== 0 || !payload?.data) {
        lastError = 'Could not extract this TikTok video from the lookup service.';
        continue;
      }

      const data = payload.data;
      const hd = absolute(data.hdplay) || absolute(data.play);
      const sd = absolute(data.play) || hd;
      const music = absolute(data.music) || absolute(data.music_info?.play);

      if (!hd) {
        lastError = 'No downloadable video file was found for this TikTok link.';
        continue;
      }

      const filenameBase = `luna-tiktok-${data.id || Date.now()}`;

      return NextResponse.json({
        success: true,
        id: data.id,
        title: data.title || 'TikTok Video',
        author: data.author?.unique_id || data.author?.nickname || 'tiktok',
        thumbnail: absolute(data.origin_cover) || absolute(data.cover),
        duration: data.duration,
        // Direct media URLs (kept for compatibility) plus ready-to-use same-origin
        // download links that stream through /api/proxy with an attachment header.
        hdUrl: hd,
        sdUrl: sd,
        mp3Url: music || null,
        downloadUrls: {
          hd: `/api/proxy?url=${encodeURIComponent(hd)}&kind=video&filename=${filenameBase}-hd.mp4`,
          sd: `/api/proxy?url=${encodeURIComponent(sd)}&kind=video&filename=${filenameBase}-sd.mp4`,
          mp3: music
            ? `/api/proxy?url=${encodeURIComponent(music)}&kind=audio&filename=${filenameBase}.mp3`
            : null,
        },
        url: videoUrl,
      });
    } catch {
      lastError = 'Could not reach the TikTok lookup service.';
    }
  }

  // TikWM can reject hosting-provider IPs. Try TikTok's page directly without
  // credentials; a successful lookup does not guarantee the CDN will stream.
  const direct = await fetchDirectTikTok(videoUrl);
  if (direct) {
    const filenameBase = `luna-tiktok-${direct.id}`;
    return NextResponse.json({
      success: true,
      id: direct.id,
      title: direct.title,
      author: direct.author,
      thumbnail: direct.thumbnail,
      duration: direct.duration,
      hdUrl: direct.hd,
      sdUrl: direct.sd,
      mp3Url: direct.music || null,
      downloadUrls: {
        hd: `/api/proxy?url=${encodeURIComponent(direct.hd)}&kind=video&filename=${filenameBase}-hd.mp4`,
        sd: `/api/proxy?url=${encodeURIComponent(direct.sd)}&kind=video&filename=${filenameBase}-sd.mp4`,
        mp3: direct.music ? `/api/proxy?url=${encodeURIComponent(direct.music)}&kind=audio&filename=${filenameBase}.mp3` : null,
      },
      url: videoUrl,
    });
  }

  return NextResponse.json({ error: `${lastError} TikTok's direct lookup was also unavailable.` }, { status: 502 });
}
