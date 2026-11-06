import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing URL' }, { status: 400 });

  try {
    // We use the free Cobalt API to bypass YouTube bot detection
    const res = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: url })
    });

    const data = await res.json();
    
    if (data.status === 'error') throw new Error(data.text || 'API Error');

    return NextResponse.json({ success: true, mediaUrl: data.url });
  } catch (error: any) {
    return NextResponse.json({ error: 'Download failed. Try again.' }, { status: 500 });
  }
}
