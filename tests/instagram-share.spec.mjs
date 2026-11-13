import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolveInstagramShareUrl } from '../app/lib/instagram-share.ts';
import { POST } from '../app/api/download/route.ts';
const { ultraigdl } = createRequire(import.meta.url)('ultra-igdl');

test('resolves an Instagram share link to a normalized reel without cookies', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://www.instagram.com/share/reel/TOKEN/');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.cookie, undefined);
    return new Response(null, { status: 302, headers: { location: '/reel/ABC123/?igsh=tracking' } });
  });
  assert.equal(await resolveInstagramShareUrl('https://www.instagram.com/share/reel/TOKEN/'), 'https://www.instagram.com/reel/ABC123/');
});

test('will not follow share redirects to untrusted hosts or login', async (t) => {
  let location = 'https://instagram.com.evil.example/reel/ABC123/';
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location } }));
  assert.equal(await resolveInstagramShareUrl('https://www.instagram.com/share/reel/TOKEN/'), null);
  location = '/accounts/login/';
  assert.equal(await resolveInstagramShareUrl('https://www.instagram.com/share/reel/TOKEN/'), null);
  assert.equal(fetch.mock.callCount(), 2);
});

test('route passes the resolved link to the real extractor instead of the share URL', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: '/reels/ABC123/?igsh=tracking' } }));
  const download = t.mock.method(ultraigdl.prototype, 'download', async (url) => {
    assert.equal(url, 'https://www.instagram.com/reel/ABC123/');
    return { code: 200, media: [{ type: 'video', url: 'https://scontent.fbcdn.net/test.mp4' }] };
  });
  const request = new Request('http://test/api/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://www.instagram.com/share/reel/TOKEN/' }) });
  const response = await POST(request);
  assert.equal(response.status, 200);
  assert.equal(download.mock.callCount(), 1);
});
