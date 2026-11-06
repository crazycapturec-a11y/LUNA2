import { NextRequest, NextResponse } from 'next/server';
import { Innertube } from 'youtubei.js';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing YouTube URL' }, { status: 400 });

  const videoId = new URL(url).searchParams.get('v') || url.split('youtu.be/')[1]?.split('?')[0];
  if (!videoId) return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });

  try {
    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId);
    
    const format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
    const stream = await info.download({ format: format.itag });

    const readableStream = new ReadableStream({
      start(controller) {
        const reader = stream.getReader();
        function pump() {
          reader.read().then(({ done, value }) => {
            if (done) { controller.close(); return; }
            controller.enqueue(value);
            pump();
          });
        }
        pump();
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
