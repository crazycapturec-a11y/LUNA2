import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/download/route.ts';
import { GET as PROXY_GET } from '../app/api/proxy/route.ts';
import { DEFAULT_POLARIS_DOC_ID, DEFAULT_SHORTCODE_DOC_IDS, shortcodeToMediaId } from '../app/lib/instagram.ts';
import { resetInstagramWebSessionCache } from '../app/lib/instagram-direct.ts';
import { fetchSnapInsta } from '../app/lib/instagram-fallback.ts';
import { resolveInstagramShareUrl } from '../app/lib/instagram-share.ts';

const { ultraigdl } = createRequire(import.meta.url)('ultra-igdl');

const shortcode = 'DeWOVfHJREZ';
const pk = shortcodeToMediaId(shortcode);
const hdVideo = 'https://scontent.cdninstagram.com/o1/v/t16/f2/m86/reel-hd.mp4?efg=1&oh=abc';
const sdVideo = 'https://scontent.cdninstagram.com/o1/v/t16/f2/m86/reel-sd.mp4?efg=1&oh=def';
const photoUrl = 'https://scontent.cdninstagram.com/v/t51.29350-15/photo-1080.jpg?oh=xyz';
const coverUrl = 'https://scontent.fbcdn.net/v/t51.2885-15/cover.jpg?oh=123';

function setSessionEnv(t, cookies = '') {
  const prevCookies = process.env.IG_COOKIES;
  const prevSession = process.env.IG_SESSION_ID;
  if (cookies) process.env.IG_COOKIES = cookies;
  else delete process.env.IG_COOKIES;
  delete process.env.IG_SESSION_ID;
  resetInstagramWebSessionCache();
  t.after(() => {
    resetInstagramWebSessionCache();
    if (prevCookies === undefined) delete process.env.IG_COOKIES;
    else process.env.IG_COOKIES = prevCookies;
    if (prevSession === undefined) delete process.env.IG_SESSION_ID;
    else process.env.IG_SESSION_ID = prevSession;
  });
}

const makePost = (url) =>
  new Request('http://test.local/api/download', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });

test('resolves a public reel without credentials via 2026 /api/graphql after a login-wall 403', async (t) => {
  setSessionEnv(t, '');
  // Simulate ultra-igdl misclassifying Instagram's generic login wall as 403 "Private account".
  t.mock.method(ultraigdl.prototype, 'download', async () => ({ code: 403, message: 'Private account' }));

  let graphqlSeen = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    // Public embeds return 200 HTML with contextJSON: null (Oct 2026 anonymous embed wall).
    if (String(url).includes('/embed/')) {
      return new Response('<script>{"contextJSON":null}</script>', { status: 200 });
    }
    if (url === 'https://www.instagram.com/') {
      return new Response('<script id="__eqmc">{"l":"anon_lsd_token_1"}</script>', {
        status: 200,
        headers: { 'set-cookie': 'csrftoken=anon_csrf_1; Path=/; Secure' },
      });
    }
    if (url === 'https://www.instagram.com/api/graphql') {
      graphqlSeen = true;
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['X-FB-LSD'], 'anon_lsd_token_1');
      assert.equal(options.headers['X-CSRFToken'], 'anon_csrf_1');
      assert.equal(options.headers['X-ASBD-ID'], '359341');
      assert.equal(options.headers['X-IG-App-ID'], '936619743392459');
      assert.equal(options.headers.Cookie, 'csrftoken=anon_csrf_1');
      assert.equal(options.body.get('doc_id'), DEFAULT_SHORTCODE_DOC_IDS[0]);
      const vars = JSON.parse(options.body.get('variables'));
      assert.equal(vars.shortcode, shortcode);
      return Response.json({
        data: {
          xdt_api__v1__media__shortcode__web_info: {
            items: [
              {
                code: shortcode,
                pk,
                media_type: 2,
                caption: { text: 'Sunset reel' },
                user: { username: 'luna_creator' },
                image_versions2: { candidates: [{ url: coverUrl, width: 720, height: 1280 }] },
                video_versions: [
                  { url: sdVideo, width: 480, height: 854 },
                  { url: hdVideo, width: 1080, height: 1920 },
                ],
              },
            ],
          },
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  // Also test a profile-prefixed /<username>/reel/<code>/ URL.
  const res = await POST(makePost(`https://www.instagram.com/luna_creator/reel/${shortcode}/?igsh=xyz`));
  assert.equal(res.status, 200);
  assert.ok(graphqlSeen);
  const body = await res.json();
  assert.equal(body.mediaUrl, hdVideo);
  assert.equal(body.thumbnail, coverUrl);
  assert.equal(body.mediaType, 'video');
  assert.equal(body.caption, 'Sunset reel');
  assert.equal(body.username, 'luna_creator');
});

test('resolves public photo posts via Polaris media_id query when shortcode query and embed return empty', async (t) => {
  setSessionEnv(t, '');
  t.mock.method(ultraigdl.prototype, 'download', async () => ({ code: 404 }));

  let rulingCalled = false;
  let polarisCalled = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('/embed/')) {
      return new Response('<script>{"contextJSON":null}</script>', { status: 200 });
    }
    if (url === 'https://www.instagram.com/') {
      return new Response('<html>["LSD",[],{"token":"lsd_photo_99"}]</html>', { status: 200 });
    }
    if (String(url).startsWith('https://www.instagram.com/api/v1/web/get_ruling_for_content/')) {
      rulingCalled = true;
      return new Response('{"status":"ok"}', {
        status: 200,
        headers: { 'set-cookie': 'csrftoken=ruling_csrf; Path=/; Secure' },
      });
    }
    if (url === 'https://www.instagram.com/api/graphql') {
      const docId = options.body.get('doc_id');
      if (docId === DEFAULT_SHORTCODE_DOC_IDS[0]) {
        return Response.json({ data: { xdt_api__v1__media__shortcode__web_info: { items: [] } } });
      }
      assert.equal(docId, DEFAULT_POLARIS_DOC_ID);
      assert.equal(options.headers['X-CSRFToken'], 'ruling_csrf');
      assert.deepEqual(JSON.parse(options.body.get('variables')), { media_id: pk });
      polarisCalled = true;
      return Response.json({
        data: {
          xig_polaris_media: {
            if_not_gated_logged_out: {
              code: shortcode,
              pk,
              media_type: 1,
              image_versions2: { candidates: [{ url: photoUrl, width: 1080, height: 1350 }] },
              user: { username: 'photographer' },
            },
          },
        },
      });
    }
    return new Response('', { status: 404 });
  });

  const res = await POST(makePost(`https://www.instagram.com/p/${shortcode}/`));
  assert.equal(res.status, 200);
  assert.ok(rulingCalled);
  assert.ok(polarisCalled);
  const body = await res.json();
  assert.equal(body.mediaUrl, photoUrl);
  assert.equal(body.mediaType, 'image');
  assert.equal(body.extension, 'jpg');
});

test('extracts Polaris data-sjs from post HTML and auto-recovers from rotated GraphQL queryIDs', async (t) => {
  setSessionEnv(t, '');
  t.mock.method(ultraigdl.prototype, 'download', async () => ({ code: 404 }));

  // Case A: post HTML embeds xig_polaris_media directly inside <script type="application/json" data-sjs>.
  const sjsPayload = {
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            __bbox: {
              result: {
                data: {
                  xig_polaris_media: {
                    if_not_gated_logged_out: {
                      code: shortcode,
                      pk,
                      media_type: 2,
                      video_versions: [{ url: hdVideo, width: 1080, height: 1920 }],
                      image_versions2: { candidates: [{ url: coverUrl, width: 720, height: 1280 }] },
                    },
                  },
                },
              },
            },
          },
        ],
      ],
    ],
  };

  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === `https://www.instagram.com/reel/${shortcode}/`) {
      return new Response(`<script type="application/json" data-sjs>${JSON.stringify(sjsPayload)}</script>`, {
        status: 200,
      });
    }
    // Simulate /api/graphql rejecting TLS fingerprint with HTML.
    return new Response('<!doctype html><html>blocked</html>', { status: 200 });
  });

  const resA = await POST(makePost(`https://www.instagram.com/reel/${shortcode}/`));
  assert.equal(resA.status, 200);
  assert.equal((await resA.json()).mediaUrl, hdVideo);

  // Case B: post HTML exposes a newly rotated Polaris queryID, which LUNA learns and queries.
  const rotatedId = '33333333333333333';
  const preloaderHtml = `<script id="__eqmc">{"l":"fresh_lsd"}</script><script>{"queryID":"${rotatedId}","variables":{"media_id":"${pk}"},"queryName":"PolarisLoggedOutDesktopWWWPostRootContentQuery"}</script>`;
  globalThis.fetch.mock.mockImplementation(async (url, options) => {
    if (url === `https://www.instagram.com/reel/${shortcode}/`) {
      return new Response(preloaderHtml, { status: 200 });
    }
    if (url === 'https://www.instagram.com/api/graphql' && options.body.get('doc_id') === rotatedId) {
      return Response.json({
        data: {
          xig_polaris_media: {
            if_not_gated_logged_out: {
              code: shortcode,
              pk,
              media_type: 2,
              video_versions: [{ url: hdVideo, width: 1080, height: 1920 }],
            },
          },
        },
      });
    }
    return new Response('', { status: 404 });
  });

  const resB = await POST(makePost(`https://www.instagram.com/reel/${shortcode}/`));
  assert.equal(resB.status, 200);
  assert.equal((await resB.json()).mediaUrl, hdVideo);
});

test('detects an expired IG_COOKIES login redirect without leaking credentials and still resolves public reels', async (t) => {
  const expiredCookie = 'sessionid=expired-secret-token; csrftoken=old-csrf';
  setSessionEnv(t, expiredCookie);
  t.mock.method(ultraigdl.prototype, 'download', async () => ({ code: 404 }));

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === `https://www.instagram.com/api/v1/media/${pk}/info/`) {
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.Cookie, expiredCookie);
      assert.equal(options.headers['X-ASBD-ID'], '359341');
      return new Response(null, { status: 302, headers: { location: 'https://www.instagram.com/accounts/login/' } });
    }
    // Anonymous Android fallback succeeds without any user cookie.
    if (url === `https://i.instagram.com/api/v1/media/${pk}/info/`) {
      assert.equal(options.headers.Cookie, undefined);
      return Response.json({
        items: [{ code: shortcode, pk, media_type: 2, video_versions: [{ url: hdVideo, width: 720, height: 1280 }] }],
      });
    }
    return new Response('', { status: 404 });
  });

  const okRes = await POST(makePost(`https://www.instagram.com/reel/${shortcode}/`));
  assert.equal(okRes.status, 200);
  assert.equal((await okRes.json()).mediaUrl, hdVideo);
  // Only the single api/v1/media/{pk}/info/ request carried the expired cookie.
  const authedCalls = fetchMock.mock.calls.filter((c) => c.arguments[1]?.headers?.Cookie === expiredCookie);
  assert.equal(authedCalls.length, 1);

  // When public endpoints are also blocked, logs sessionInvalid: true with zero secrets or URLs.
  const infoMock = t.mock.method(console, 'info', () => {});
  fetchMock.mock.mockImplementation(async (url) => {
    if (url === `https://www.instagram.com/api/v1/media/${pk}/info/`) {
      return new Response(null, { status: 302, headers: { location: '/accounts/login/' } });
    }
    return new Response('', { status: 404 });
  });

  const failRes = await POST(makePost(`https://www.instagram.com/reel/${shortcode}/`));
  assert.equal(failRes.status, 502);
  const failBody = await failRes.json();
  assert.match(failBody.error, /expired/i);
  assert.ok(!JSON.stringify(failBody).includes('expired-secret-token'));
  const logged = JSON.stringify(infoMock.mock.calls.at(-1).arguments);
  assert.ok(logged.includes('"sessionInvalid":true'));
  assert.ok(!logged.includes('expired-secret-token'));
  assert.ok(!logged.includes(shortcode));
  // Never contacts SnapInsta when server cookies were configured.
  assert.ok(fetchMock.mock.calls.every((c) => !String(c.arguments[0]).includes('snapinsta')));
});

test('resolves share links that return canonical HTML and unpacks encoded SnapInsta fallback safely', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(
      '<html><head><link rel="canonical" href="https://www.instagram.com/creator_1/reel/ABC123/?igsh=1"></head></html>',
      { status: 200 },
    ),
  );
  assert.equal(
    await resolveInstagramShareUrl('https://www.instagram.com/share/reel/TOK99/'),
    'https://www.instagram.com/reel/ABC123/',
  );

  // Encode a small innerHTML snippet using SnapInsta's base-charset format.
  const snippet = `document.getElementById("download-section").innerHTML = "<a href=\\"https://scontent.cdninstagram.com/video.mp4?sig=1\\" title=\\"Download Video\\">Download Video</a>";`;
  const charset = '0123456789abcdefg';
  const base = 16;
  const offset = 7;
  const delimiter = charset[base];
  const encoded = Array.from(snippet)
    .map((ch) => (ch.charCodeAt(0) + offset).toString(base))
    .join(delimiter);
  const packed = `eval(function(h,u,n,t,e,r){return h}("${encoded}",99,"${charset}",${offset},${base},42))`;

  globalThis.fetch.mock.mockImplementation(async () => new Response(packed, { status: 200 }));
  const unpacked = await fetchSnapInsta('https://www.instagram.com/reel/ABC123/');
  assert.deepEqual(unpacked, {
    type: 'video',
    url: 'https://scontent.cdninstagram.com/video.mp4?sig=1',
  });
});

test('proxy serves inline raster previews safely and blocks SVG/HTML responses', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('cover.jpg')) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg; charset=binary' },
      });
    }
    if (String(url).includes('evil.svg')) {
      return new Response('<svg onload="alert(1)"/>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      });
    }
    return new Response('<html>expired</html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });

  const okImg = await PROXY_GET(
    new NextRequest('http://test.local/api/proxy?url=https%3A%2F%2Fscontent.cdninstagram.com%2Fcover.jpg&kind=image&disposition=inline'),
  );
  assert.equal(okImg.status, 200);
  assert.equal(okImg.headers.get('content-disposition'), 'inline');
  assert.equal(okImg.headers.get('content-type'), 'image/jpeg');
  assert.equal(okImg.headers.get('content-security-policy'), "default-src 'none'");

  const blockedSvg = await PROXY_GET(
    new NextRequest('http://test.local/api/proxy?url=https%3A%2F%2Fscontent.cdninstagram.com%2Fevil.svg&kind=image&disposition=inline'),
  );
  assert.equal(blockedSvg.status, 415);

  const blockedHtml = await PROXY_GET(
    new NextRequest('http://test.local/api/proxy?url=https%3A%2F%2Fscontent.cdninstagram.com%2Fexpired.mp4&kind=video'),
  );
  assert.equal(blockedHtml.status, 502);
});
