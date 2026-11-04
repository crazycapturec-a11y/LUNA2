import { NextRequest, NextResponse } from 'next/server';
import ytdl from '@distube/ytdl-core';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing YouTube URL' }, { status: 400 });

  try {
    const cookies = JSON.parse(process.env.YOUTUBE_COOKIES || '[]');
    const agent = ytdl.createAgent(cookies);
    const info = await ytdl.getInfo(url, { agent });
    const format = ytdl.chooseFormat(ytdl.filterFormats(info.formats, 'audioandvideo'), { quality: 'highestvideo' });
    const stream = ytdl(url, { format, agent });

    const readableStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => controller.enqueue(chunk));
        stream.on('end', () => controller.close());
        stream.on('error', (err) => controller.error(err));
      },
    });

    return new NextResponse(readableStream, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="youtube-video.mp4"`,
      },
    });
  } catch (error: any) {
    console.error('YouTube Download Error:', error.message);
    return NextResponse.json({ error: 'Download failed.' }, { status: 500 });
  }
}
