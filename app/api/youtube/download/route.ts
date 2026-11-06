import { NextRequest, NextResponse } from 'next/server';

// A list of public Invidious instances to try in order.
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yewtu.be",
  "https://invidious.privacydev.net"
];

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing URL' }, { status: 400 });

  // Extract the video ID from the URL
  const videoId = url.split('v=')[1]?.split('&')[0] || url.split('youtu.be/')[1]?.split('?')[0];
  if (!videoId) return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });

  let lastError = 'Could not fetch video from any instance.';

  // Loop through the instances to find one that works
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        // Add a timeout to fail fast if an instance is down
        signal: AbortSignal.timeout(8000) 
      });

      if (!res.ok) continue; // Try the next instance if this one fails

      const data = await res.json();
      
      // Look for a format that has both video and audio
      const videoFormat = data.adaptiveFormats?.find((f: any) => f.type?.includes('video/mp4') && f.audioQuality);

      if (videoFormat?.url) {
        // Success! We found a working direct link.
        return NextResponse.json({ success: true, mediaUrl: videoFormat.url });
      }
      
      lastError = 'Found video, but no downloadable MP4 format available.';
    } catch (e) {
      // Ignore errors and try the next instance
      continue;
    }
  }

  // If the loop finishes and we have no link, return an error
  return NextResponse.json({ error: lastError }, { status: 500 });
}
