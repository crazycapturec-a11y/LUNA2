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
