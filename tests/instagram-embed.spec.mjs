import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { POST } from '../app/api/download/route.ts';
import { parseInstagramEmbed, fetchInstagramEmbed } from '../app/lib/instagram-embed.ts';

const { ultraigdl } = createRequire(import.meta.url)('ultra-igdl');
const shortcode = 'Dfe3hqehJsE';
const reel = `https://www.instagram.com/reel/${shortcode}/`;
const media = 'https://scontent.fbcdn.net/example.mp4?sig=one&x=two';
const image = 'https://scontent.cdninstagram.com/cover.jpg';
const embed = node => `<script type="application/json">${JSON.stringify({ contextJSON: JSON.stringify({ gql_data: { shortcode_media: node } }) })}</script>`;
const request = () => new Request('http://test.local/api/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: reel }) });

function setEnv(t, cookies) {
  const beforeCookies = process.env.IG_COOKIES;
  const beforeSession = process.env.IG_SESSION_ID;
  if (cookies) process.env.IG_COOKIES = cookies; else delete process.env.IG_COOKIES;
  delete process.env.IG_SESSION_ID;
  t.after(() => {
    if (beforeCookies === undefined) delete process.env.IG_COOKIES; else process.env.IG_COOKIES = beforeCookies;
    if (beforeSession === undefined) delete process.env.IG_SESSION_ID; else process.env.IG_SESSION_ID = beforeSession;
  });
}

test('extracts a matching video from JSON-encoded Instagram context', () => {
  assert.deepEqual(parseInstagramEmbed(embed({ shortcode, is_video: true, video_url: media, display_url: image }), shortcode, true), { type: 'video', url: media, thumbnail: image });
  assert.equal(parseInstagramEmbed(embed({ shortcode: 'OTHER', video_url: media }), shortcode, true), null);
});

test('never returns a video poster as a reel, an unsafe URL, or an unrelated page URL', () => {
  assert.equal(parseInstagramEmbed(embed({ shortcode, is_video: true, display_url: image }), shortcode, true), null);
  assert.equal(parseInstagramEmbed(embed({ shortcode, video_url: 'https://fbcdn.net.evil.example/a.mp4' }), shortcode, true), null);
  assert.equal(parseInstagramEmbed('<script>{"recommended_video":"https://scontent.fbcdn.net/other.mp4"}</script>', shortcode, true), null);
  assert.deepEqual(parseInstagramEmbed(`<meta property="og:video" content="${media.replace('&', '&amp;')}">`, shortcode, true), { type: 'video', url: media });
});

test('supports carousel media while avoiding a video poster when media is missing', () => {
  const mixed = { shortcode, edge_sidecar_to_children: { edges: [{ node: { is_video: false, display_url: image } }, { node: { is_video: true, video_url: media } }] } };
  assert.equal(parseInstagramEmbed(embed(mixed), shortcode, false).url, media);
  assert.equal(parseInstagramEmbed(embed({ shortcode, is_video: true, display_url: image }), shortcode, false), null);
});

test('uses a cookie-free Instagram embed after the configured extractor returns 404', async (t) => {
  setEnv(t, 'sessionid=fake-secret; csrftoken=fake');
  t.mock.method(ultraigdl.prototype, 'download', async () => ({ code: 404, message: 'Media not found' }));
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${reel}embed/`);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.cookie, undefined);
    assert.equal(options.redirect, 'error');
    return new Response(embed({ shortcode, is_video: true, video_url: media, display_url: image }));
  });
  const response = await POST(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mediaUrl, media);
  assert.equal(body.mediaType, 'video');
  assert.ok(body.downloadUrl.startsWith('/api/proxy?'));
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('does not claim success for an image-only reel and tries its public embed', async (t) => {
  setEnv(t, 'sessionid=fake-secret');
  t.mock.method(ultraigdl.prototype, 'download', async () => ({ code: 200, media: [{ type: 'image', url: image }] }));
  t.mock.method(globalThis, 'fetch', async () => new Response(embed({ shortcode, video_url: media })));
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mediaUrl, media);
});

test('does not retry Instagram on a 403 or 429 and never exposes details', async (t) => {
  setEnv(t, 'sessionid=fake-secret');
  let code = 429;
  t.mock.method(ultraigdl.prototype, 'download', async () => ({ code, message: 'fake-secret' }));
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('should not fetch'); });
  const limited = await POST(request());
  assert.equal(limited.status, 429);
  assert.ok(!(await limited.text()).includes('fake-secret'));
  code = 403;
  assert.equal((await POST(request())).status, 403);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('rejects redirects and oversized responses in the embed lookup', async (t) => {
  let body = new Response('x'.repeat(2 * 1024 * 1024 + 1));
  const mock = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return body;
  });
  assert.equal(await fetchInstagramEmbed(reel), null);
  body = new Response(null, { status: 302, headers: { location: 'https://example.com/' } });
  assert.equal(await fetchInstagramEmbed(reel), null);
  assert.equal(mock.mock.callCount(), 2);
});
