import { NextRequest, NextResponse } from 'next/server';
import { Innertube } from 'youtubei.js';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing YouTube URL' }, { status: 400 });

  // Extract the video ID from the URL
  const videoId = new URL(url).searchParams.get('v') || url.split('youtu.be/')[1]?.split('?')[0];
  if (!videoId) return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });

  try {
    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId);

    return NextResponse.json({
      success: true,
      title: info.basic_info.title,
      author: info.basic_info.author,
      thumbnail: info.basic_info.thumbnail?.[0]?.url || '',
      videoId: videoId,
    });
  } catch (error: any) {
    console.error('YouTube Info Error:', error.message);
    return NextResponse.json({ error: 'Could not fetch YouTube video info using youtubei.js.' }, { status: 500 });
  }
}
