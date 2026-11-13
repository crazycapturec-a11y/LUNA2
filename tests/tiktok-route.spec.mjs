import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { GET as lookup } from '../app/api/tiktok/info/route.ts';
import { GET as proxy } from '../app/api/proxy/route.ts';

const link = 'https://vt.tiktok.com/ZSpC8nYxp/';
const video = 'https://www.tiktok.com/@creator/video/7707243003596836102';
const media = 'https://v16.tiktokcdn-us.com/video.mp4?token=sample';
const req = (url) => new NextRequest(`http://test.local/api/tiktok/info?url=${encodeURIComponent(url)}`);
const html = (id = '7707243003596836102', playAddr = media) => `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { id, desc: 'A test video', author: { uniqueId: 'creator' }, video: { playAddr, duration: 32 } } } } } })}</script>`;

test('falls back to the TikTok video page after TikWM returns 403 for the reported short link', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('tikwm.com')) return new Response('blocked', { status: 403 });
    assert.equal(options.redirect, 'manual');
    if (url === link) return new Response(null, { status: 302, headers: { location: video } });
    if (url === video) return new Response(html(), { headers: { 'content-type': 'text/html' } });
    throw new Error('Unexpected URL');
  });
  const response = await lookup(req(link));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, '7707243003596836102');
  assert.equal(body.hdUrl, media);
  assert.equal(body.mp3Url, null);
  assert.ok(body.downloadUrls.hd.startsWith('/api/proxy?'));
  assert.deepEqual(calls.slice(-2), [link, video]);
});

test('keeps a successful TikWM response without invoking the direct fallback', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { id: '123', play: '/video/media/test.mp4', title: 'Hello' } }));
  const response = await lookup(req(link));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).hdUrl, 'https://www.tikwm.com/video/media/test.mp4');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('does not visit an untrusted redirect from a TikTok short link', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    if (String(url).includes('tikwm.com')) return new Response('', { status: 403 });
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  });
  const response = await lookup(req(link));
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('127.0.0.1'));
  assert.equal(calls.length, 3);
});

test('rejects deceptive submitted URLs and mismatched or untrusted media', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('tikwm.com')) return new Response('', { status: 403 });
    if (url === link) return new Response(null, { status: 302, headers: { location: video } });
    return new Response(html('7707243003596836102', 'https://evil.example/video.mp4'));
  });
  assert.equal((await lookup(req('https://tiktok.com.evil.example/foo'))).status, 400);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal((await lookup(req(link))).status, 502);
});

test('the media proxy checks every redirect before fetching it', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } }));
  const request = new NextRequest(`http://test.local/api/proxy?url=${encodeURIComponent(media)}`);
  assert.equal((await proxy(request)).status, 502);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('the media proxy follows a permitted CDN redirect and relays video bytes', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === media) return new Response(null, { status: 302, headers: { location: 'https://v16.tiktokcdn.com/final.mp4' } });
    assert.equal(url, 'https://v16.tiktokcdn.com/final.mp4');
    return new Response('video bytes', { headers: { 'content-type': 'video/mp4' } });
  });
  const request = new NextRequest(`http://test.local/api/proxy?url=${encodeURIComponent(media)}`);
  const response = await proxy(request);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'video bytes');
});
