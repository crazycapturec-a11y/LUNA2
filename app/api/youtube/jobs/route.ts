import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '../../../lib/youtube';
import { getYouTubeWorkerConfig } from '../../../lib/youtube-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function workerRequest(path: string, method: 'GET' | 'POST', body?: object) {
  const config = getYouTubeWorkerConfig();
  if (!config) return NextResponse.json({ error: 'The YouTube worker is not configured.' }, { status: 503 });
  const response = await fetch(`${config.origin}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.secret}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  // Do not pass untrusted worker error bodies to browsers.
  if (!response.ok) {
    const message = response.status === 429 ? 'The download worker is busy. Please try again later.' : 'The download worker is unavailable. Please try again later.';
    return NextResponse.json({ error: message }, { status: response.status === 429 ? 429 : 502 });
  }
  const data = await response.json();
  if (method === 'POST') {
    if (typeof data.id !== 'string' || !jobIdPattern.test(data.id)) throw new Error('Invalid worker response');
    return NextResponse.json({ id: data.id, status: 'running' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  }
  if (data.status === 'ready') {
    const download = new URL(data.downloadUrl);
    if (download.origin !== config.origin || download.pathname !== `/files/${path.split('/').pop()}` || download.username || download.password) throw new Error('Invalid download URL');
    return NextResponse.json({ status: 'ready', downloadUrl: download.href }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (data.status === 'running') return NextResponse.json({ status: 'running' }, { headers: { 'Cache-Control': 'no-store' } });
  if (data.status === 'failed') {
    const messages: Record<string, string> = {
      sign_in: 'YouTube requires sign-in or is blocking the download worker.',
      timeout: 'Preparing the video took too long. Please try a shorter video.',
      format: 'A compatible video with audio is not available.',
    };
    const error = typeof data.errorCode === 'string' && Object.hasOwn(messages, data.errorCode)
      ? messages[data.errorCode]
      : 'The worker could not download this video. It may be unavailable or exceed the worker limits.';
    return NextResponse.json({ status: 'failed', error }, { headers: { 'Cache-Control': 'no-store' } });
  }
  throw new Error('Invalid worker response');
}

export async function POST(request: NextRequest) {
  let data: { url?: unknown };
  try { data = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const videoId = typeof data?.url === 'string' ? extractVideoId(data.url) : null;
  if (!videoId) return NextResponse.json({ error: 'Invalid YouTube URL.' }, { status: 400 });
  try { return await workerRequest('/jobs', 'POST', { videoId }); }
  catch { return NextResponse.json({ error: 'The download worker is unavailable. Please try again later.' }, { status: 502 }); }
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !jobIdPattern.test(id)) return NextResponse.json({ error: 'Invalid download job.' }, { status: 400 });
  try { return await workerRequest(`/jobs/${id}`, 'GET'); }
  catch { return NextResponse.json({ error: 'The download worker is unavailable. Please try again later.' }, { status: 502 }); }
}
