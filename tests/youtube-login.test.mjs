import test from 'node:test';
import assert from 'node:assert/strict';
import { Innertube } from 'youtubei.js';
import { resolveYouTubeVideo } from '../app/lib/youtube.ts';

test('tries all clients after sign-in responses and reports failure honestly', async (t) => {
  const clients = [];
  let allBlocked = false;
  t.mock.method(Innertube, 'create', async () => ({
    session: { player: {} },
    getBasicInfo: async (_id, options) => {
      clients.push(options?.client ?? 'default');
      if (allBlocked || options?.client !== 'ANDROID') {
        return { playability_status: { status: 'LOGIN_REQUIRED' } };
      }
      return {
        playability_status: { status: 'OK' },
        streaming_data: {},
        basic_info: { title: 'Public video', thumbnail: [] },
        chooseFormat: () => ({ url: 'https://example.com/stream', mime_type: 'video/mp4', decipher: async () => 'https://example.com/stream' }),
      };
    },
  }));

  const video = await resolveYouTubeVideo('dQw4w9WgXcQ');
  assert.equal(video.client, 'ANDROID');
  assert.deepEqual(clients, ['default', 'MWEB', 'IOS', 'TV', 'ANDROID']);

  allBlocked = true;
  clients.length = 0;
  await assert.rejects(resolveYouTubeVideo('dQw4w9WgXcQ', 'video', { refresh: true }), /requires sign-in or is blocking this server/);
  assert.deepEqual(clients, ['default', 'MWEB', 'IOS', 'TV', 'ANDROID']);
});
