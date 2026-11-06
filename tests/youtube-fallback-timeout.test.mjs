import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFallbackVideo } from '../app/lib/youtube-fallback.ts';

test('a slow Invidious instance does not prevent trying Piped for the reported video', async (t) => {
  let now = 1000;
  const requested = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(String(url));
    if (String(url).includes('/api/v1/videos/')) {
      now += 4000; // The first provider consumed its entire allotted time.
      return Response.json({ formatStreams: [
        { url: 'https://r1.googlevideo.com/too-late', type: 'video/mp4' },
      ] });
    }
    if (String(url).startsWith('https://pipedapi.kavin.rocks/streams/')) {
      return Response.json({ title: 'Public video', videoStreams: [
        { url: 'https://r1.googlevideo.com/muxed', mimeType: 'video/mp4', videoOnly: false },
      ] });
    }
    if (String(url) === 'https://r1.googlevideo.com/muxed') return new Response('video bytes');
    return new Response(null, { status: 503 });
  });

  const result = await fetchFallbackVideo('dQw4w9WgXcQ');
  assert.equal(await result?.response.text(), 'video bytes');
  assert.equal(requested[1], 'https://pipedapi.kavin.rocks/streams/dQw4w9WgXcQ');
  assert.ok(!requested.includes('https://r1.googlevideo.com/too-late'));
});

test('the budget reserves time to reach each configured instance', async (t) => {
  let now = 1000;
  const requested = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(String(url));
    now += 4000;
    return new Response(null, { status: 503 });
  });

  assert.equal(await fetchFallbackVideo('dQw4w9WgXcQ'), null);
  assert.equal(requested.length, 7);
  assert.ok(requested.some((url) => url.startsWith('https://api.piped.yt/streams/')));
});
