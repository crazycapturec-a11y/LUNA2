import { NextRequest, NextResponse } from 'next/server';
import ytdl from '@distube/ytdl-core';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing YouTube URL' }, { status: 400 });

  try {
    const cookies = JSON.parse(process.env.YOUTUBE_COOKIES || '[]');
    const agent = ytdl.createAgent(cookies);
    const info = await ytdl.getInfo(url, { agent });
    const videoDetails = info.videoDetails;

    return NextResponse.json({
      success: true,
      title: videoDetails.title,
      author: videoDetails.author.name,
      thumbnail: videoDetails.thumbnails[videoDetails.thumbnails.length - 1].url,
      videoId: videoDetails.videoId,
    });
  } catch (error: any) {
    console.error('YouTube Info Error:', error.message);
    return NextResponse.json({ error: 'Could not fetch YouTube video info. Cookies might be expired.' }, { status: 500 });
  }
}
