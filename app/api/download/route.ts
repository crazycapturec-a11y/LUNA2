import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url || !url.includes('instagram.com')) {
      return NextResponse.json({ error: 'Please provide a valid Instagram link.' }, { status: 400 });
    }

    // Clean the URL to remove tracking parameters like ?srtk=...
    let cleanUrl = url.split('?')[0];
    if (!cleanUrl.endsWith('/')) {
      cleanUrl += '/';
    }

    // We use the SnapInsta API which handles Instagram's authentication behind the scenes
    const apiUrl = 'https://www.snapinsta.app/api/ajaxSearch';
    const body = new URLSearchParams({
      q: cleanUrl,
      t: 'media',
      lang: 'en'
    });

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://www.snapinsta.app',
        'Referer': 'https://www.snapinsta.app/'
      },
      body: body.toString()
    });

    const data = await res.json();

    if (data.status !== 'ok' || !data.data) {
      throw new Error('Could not extract media. The account might be private or the link is invalid.');
    }

    // The API returns HTML. We need to extract the download link from it.
    const html = data.data;
    
    // Look for an MP4 video link
    const mp4Match = html.match(/href="([^"]+\.mp4[^"]*)"/);
    if (mp4Match && mp4Match[1]) {
      return NextResponse.json({
        success: true,
        mediaUrl: mp4Match[1],
        mediaType: 'video',
      });
    }

    // If no video, look for a JPG image link (for photo posts)
    const imgMatch = html.match(/href="([^"]+\.jpg[^"]*)"/);
    if (imgMatch && imgMatch[1]) {
       return NextResponse.json({
        success: true,
        mediaUrl: imgMatch[1],
        mediaType: 'image',
      });
    }

    throw new Error('Could not find a downloadable file.');

  } catch (error: any) {
    console.error("SERVER ERROR:", error);
    return NextResponse.json({ error: error.message || 'Something went wrong on the server.' }, { status: 500 });
  }
}
