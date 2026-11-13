import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { POST } from '../app/api/download/route.ts';

const { ultraigdl } = createRequire(import.meta.url)('ultra-igdl');
const reel = 'https://www.instagram.com/reel/Dfe3hqehJsE/?srtk=emVscXE5d2N3NnZt';
const request = () => new Request('http://test.local/api/download', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: reel }),
});

test('uses SnapInsta only as an unauthenticated fallback and parses safe media URLs', async (t) => {
  const oldCookies = process.env.IG_COOKIES;
  const oldSession = process.env.IG_SESSION_ID;
  t.after(() => {
    if (oldCookies === undefined) delete process.env.IG_COOKIES; else process.env.IG_COOKIES = oldCookies;
    if (oldSession === undefined) delete process.env.IG_SESSION_ID; else process.env.IG_SESSION_ID = oldSession;
  });
  delete process.env.IG_COOKIES;
  delete process.env.IG_SESSION_ID;
  t.mock.method(ultraigdl.prototype, 'download', async () => ({ code: 404, message: 'not found' }));
  const snap = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://www.instagram.com/reel/Dfe3hqehJsE/embed/') return new Response('', { status: 404 });
    assert.equal(url, 'https://www.snapinsta.app/api/ajaxSearch');
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.cookie, undefined);
    assert.equal(options.body.get('q'), 'https://www.instagram.com/reel/Dfe3hqehJsE/');
    return Response.json({ status: 'ok', data: '<a href="https://evil.example/steal.mp4">bad</a><a href="https://cdninstagram.com/reel.mp4?a=1&amp;b=2">video</a>' });
  });
  const res = await POST(request());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mediaUrl, 'https://cdninstagram.com/reel.mp4?a=1&b=2');
  assert.equal(body.mediaType, 'video');
  assert.equal(body.extension, 'mp4');
  assert.equal(snap.mock.callCount(), 2);
});

test('returns a safe error when both providers fail', async (t) => {
  const oldCookies = process.env.IG_COOKIES;
  const oldSession = process.env.IG_SESSION_ID;
  t.after(() => {
    if (oldCookies === undefined) delete process.env.IG_COOKIES; else process.env.IG_COOKIES = oldCookies;
    if (oldSession === undefined) delete process.env.IG_SESSION_ID; else process.env.IG_SESSION_ID = oldSession;
  });
  delete process.env.IG_COOKIES;
  delete process.env.IG_SESSION_ID;
  t.mock.method(ultraigdl.prototype, 'download', async () => { throw new Error('sensitive network detail'); });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('fetch failed'); });
  const res = await POST(request());
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'Could not read this Instagram post. Please try again later.');
});
