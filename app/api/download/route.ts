import { NextResponse } from 'next/server';
const { ultraigdl } = require('ultra-igdl');

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url || !url.includes('instagram.com')) {
      return NextResponse.json({ error: 'Please provide a valid Instagram link.' }, { status: 400 });
    }
    let cleanUrl = url.split('?')[0]; 
    if (!cleanUrl.endsWith('/')) cleanUrl += '/';

    const ig = new ultraigdl();
    const result = await ig.download(cleanUrl);

    if (result.code !== 200) {
      return NextResponse.json({ error: `Instagram Error: ${result.message}` }, { status: 400 });
    }
    return NextResponse.json({ success: true, mediaUrl: result.media[0].url, mediaType: result.media[0].type || 'video' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Something went wrong.' }, { status: 500 });
  }
}
