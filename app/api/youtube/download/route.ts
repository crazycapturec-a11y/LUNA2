import { NextRequest, NextResponse } from 'next/server';

// List of public Invidious instances to try (most reliable first)
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yewtu.be",
  "https://invidious.privacydev.net"
];

// List of public Piped instances to try as a fallback
const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://piped-api.garudalinux.org",
  "https://api.piped.yt"
];

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing URL' }, { status: 400 });

  // Extract the video ID from the URL
  const videoId = url.split('v=')[1]?.split('&')[0] || url.split('youtu.be/')[1]?.split('?')[0];
  if (!videoId) return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });

  let lastError = 'Could not fetch video from any instance.';

  // 1. Try Invidious instances first
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000) // Fail fast if an instance is down
      });

      if (!res.ok) continue;

      const data = await res.json();
      // Find a format that has both video and audio
      const videoFormat = data.adaptiveFormats?.find((f: any) => f.type?.includes('video/mp4') && f.audioQuality);

      if (videoFormat?.url) {
        return NextResponse.json({ success: true, mediaUrl: videoFormat.url });
      }
      lastError = 'Found video on Invidious, but no downloadable MP4 format available.';
    } catch (e) {
      continue; // Try the next instance
    }
  }

  // 2. If Invidious fails, try Piped instances
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000)
      });

      if (!res.ok) continue;

      const data = await res.json();
      // Piped returns streams in a 'videoStreams' array
      const videoStream = data.videoStreams?.find((s: any) => s.mimeType?.includes('video/mp4'));

      if (videoStream?.url) {
        return NextResponse.json({ success: true, mediaUrl: videoStream.url });
      }
      lastError = 'Found video on Piped, but no downloadable MP4 format available.';
    } catch (e) {
      continue;
    }
  }

  // If both loops fail, return the last known error
  return NextResponse.json({ error: lastError }, { status: 500 });
}
