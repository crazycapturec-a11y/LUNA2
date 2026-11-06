import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFallbackVideo } from '../app/lib/youtube-fallback.ts';

test('falls back to a Piped muxed stream and relays the bytes', async (t) => {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(String(url));
    if (String(url).startsWith('https://pipedapi.kavin.rocks/streams/')) {
      return Response.json({ title: 'Test video', videoStreams: [
        { url: 'https://r1.googlevideo.com/video-only', mimeType: 'video/mp4', videoOnly: true },
        { url: 'https://r1.googlevideo.com/muxed', mimeType: 'video/mp4', videoOnly: false },
      ] });
    }
    if (String(url) === 'https://r1.googlevideo.com/muxed') return new Response('video bytes');
    return new Response(null, { status: 503 });
  });
  const result = await fetchFallbackVideo('cpUxjLKPkLI');
  assert.equal(result?.title, 'Test video');
  assert.equal(await result?.response.text(), 'video bytes');
  assert.ok(!requested.includes('https://r1.googlevideo.com/video-only'));
});

test('does not follow instance-supplied URLs or redirects to untrusted hosts', async (t) => {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(String(url));
    if (String(url).includes('/api/v1/videos/')) {
      return Response.json({ formatStreams: [
        { url: 'http://127.0.0.1/secret', type: 'video/mp4' },
        { url: 'https://r1.googlevideo.com/redirect', type: 'video/mp4' },
      ] });
    }
    if (String(url) === 'https://r1.googlevideo.com/redirect') {
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/secret' } });
    }
    return new Response(null, { status: 503 });
  });
  assert.equal(await fetchFallbackVideo('cpUxjLKPkLI'), null);
  assert.ok(!requested.some((url) => url.includes('127.0.0.1') || url.includes('evil.example')));
});
