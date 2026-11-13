import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { fetchDirectTikTok } from '../app/lib/tiktok-direct.ts';
import { GET as proxy } from '../app/api/proxy/route.ts';

const page = 'https://www.tiktok.com/@creator/video/123456789';

test('supports SIGI_STATE data for the requested video', async (t) => {
  const data = { ItemModule: { '123456789': { id: '123456789', desc: 'caption', video: { downloadAddr: 'https://v.tiktokcdn.com/v.mp4' } } } };
  t.mock.method(globalThis, 'fetch', async () => new Response(`<script id="SIGI_STATE">${JSON.stringify(data)}</script>`));
  assert.equal((await fetchDirectTikTok(page)).sd, 'https://v.tiktokcdn.com/v.mp4');
});

test('rejects page data for a different video', async (t) => {
  const data = { __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { id: '111111111', video: { playAddr: 'https://v.tiktokcdn.com/v.mp4' } } } } } };
  t.mock.method(globalThis, 'fetch', async () => new Response(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(data)}</script>`));
  assert.equal(await fetchDirectTikTok(page), null);
});

test('uses the TikWM referer for TikWM-hosted files', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('bytes'));
  const response = await proxy(new NextRequest(`http://test.local/api/proxy?url=${encodeURIComponent('https://www.tikwm.com/video/example.mp4')}`));
  assert.equal(response.status, 200);
  assert.equal(mock.mock.calls[0].arguments[1].headers.Referer, 'https://www.tikwm.com/');
});
