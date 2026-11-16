import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url || !url.includes('tiktok.com')) {
      return NextResponse.json({ error: 'Please provide a valid TikTok link.' }, { status: 400 });
    }

    // We use the TikXedd API, which requires no keys or auth.
    const apiUrl = `https://tikxedd.vercel.app/api/resolve?url=${encodeURIComponent(url)}`;

    const res = await fetch(apiUrl);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || 'Failed to fetch from TikXedd API');
    }

    // The API returns an object with a download property.
    // We look for the no-watermark URL first.
    const downloadUrl = data.download?.noWatermark || data.download?.watermark;

    if (!downloadUrl) {
      throw new Error('Could not find a downloadable video URL.');
    }

    return NextResponse.json({
      success: true,
      mediaUrl: downloadUrl,
      mediaType: 'video',
    });

  } catch (error: any) {
    console.error("TIKTOK ERROR:", error);
    return NextResponse.json({ error: error.message || 'Something went wrong on the server.' }, { status: 500 });
  }
}
