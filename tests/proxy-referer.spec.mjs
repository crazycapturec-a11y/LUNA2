import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { GET } from '../app/api/proxy/route.ts';

test('uses Instagram referer for fbcdn video downloads', async (t) => {
  let headers;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    headers = options.headers;
    return new Response('video bytes', { headers: { 'content-type': 'video/mp4' } });
  });
  const request = new NextRequest(`http://test.local/api/proxy?url=${encodeURIComponent('https://scontent.fbcdn.net/video.mp4')}&kind=video`);
  const response = await GET(request);
  assert.equal(response.status, 200);
  assert.equal(headers.Referer, 'https://www.instagram.com/');
  assert.equal(await response.text(), 'video bytes');
});

test('uses TikTok referer for TikTok images', async (t) => {
  let headers;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    headers = options.headers;
    return new Response('image bytes', { headers: { 'content-type': 'image/jpeg' } });
  });
  const request = new NextRequest(`http://test.local/api/proxy?url=${encodeURIComponent('https://example.tiktokcdn.com/image.jpg')}&kind=image`);
  const response = await GET(request);
  assert.equal(response.status, 200);
  assert.equal(headers.Referer, 'https://www.tiktok.com/');
});

test('relays media hosts only, never site pages', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('bytes', { headers: { 'content-type': 'video/mp4' } }));

  for (const blocked of [
    'https://www.instagram.com/reel/Cx1y2z/',
    'https://www.tiktok.com/@creator/video/123',
    'https://m.tiktok.com/share/video/123',
    'https://example.com/video.mp4',
  ]) {
    const response = await GET(new NextRequest(`http://test.local/api/proxy?url=${encodeURIComponent(blocked)}`));
    assert.equal(response.status, 400, `${blocked} must not be relayed`);
  }

  for (const allowed of [
    'https://scontent.cdninstagram.com/v/t50/video.mp4',
    'https://scontent-lax3-1.fbcdn.net/video.mp4',
    'https://v16-webapp-prime.us.tiktok.com/video/tos/example.mp4',
    'https://v19-webapp-prime.tiktok.com/video/tos/example.mp4',
    'https://p16-sign-va.tiktokcdn-us.com/obj/cover.jpg',
    'https://www.tikwm.com/video/example.mp4',
  ]) {
    const response = await GET(new NextRequest(`http://test.local/api/proxy?url=${encodeURIComponent(allowed)}`));
    assert.equal(response.status, 200, `${allowed} should still download`);
  }
});
