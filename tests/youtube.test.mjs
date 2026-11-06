import test from 'node:test';
import assert from 'node:assert/strict';
import { Innertube } from 'youtubei.js';
import { extractVideoId, resolveYouTubeVideo } from '../app/lib/youtube.ts';

test('extracts the video ID from a shared YouTube URL with tracking parameters', () => {
  assert.equal(extractVideoId('https://youtu.be/cpUxjLKPkLI?si=q6C91YdGKMTtWjzH'), 'cpUxjLKPkLI');
});

test('deciphers direct URLs and refreshes a rejected cached stream', async (t) => {
  let lookups = 0;
  let deciphers = 0;
  const requestedClients = [];
  const player = {};
  t.mock.method(Innertube, 'create', async () => ({
    session: { player },
    getBasicInfo: async (_id, options) => {
      requestedClients.push(options?.client ?? 'default');
      lookups++;
      const lookup = lookups;
      return {
        playability_status: { status: 'OK' },
        streaming_data: {},
        basic_info: { title: 'Video', author: 'Creator', thumbnail: [] },
        chooseFormat: () => ({
          url: `https://example.com/raw-${lookup}`,
          mime_type: 'video/mp4',
          decipher: async (receivedPlayer) => {
            assert.equal(receivedPlayer, player);
            deciphers++;
            return `https://example.com/deciphered-${lookup}`;
          },
        }),
      };
    },
  }));

  const first = await resolveYouTubeVideo('cpUxjLKPkLI');
  assert.equal(first.streamUrl, 'https://example.com/deciphered-1');
  assert.equal((await resolveYouTubeVideo('cpUxjLKPkLI')).streamUrl, first.streamUrl);
  assert.equal(lookups, 1);

  const refreshed = await resolveYouTubeVideo('cpUxjLKPkLI', 'video', { refresh: true });
  assert.equal(refreshed.streamUrl, 'https://example.com/deciphered-2');
  assert.equal((await resolveYouTubeVideo('cpUxjLKPkLI')).streamUrl, refreshed.streamUrl);
  assert.equal(lookups, 2);
  assert.equal(deciphers, 2);

  const alternative = await resolveYouTubeVideo('cpUxjLKPkLI', 'video', {
    refresh: true,
    excludeClients: ['default'],
  });
  assert.equal(alternative.client, 'MWEB');
  assert.equal(alternative.streamUrl, 'https://example.com/deciphered-3');
  assert.deepEqual(requestedClients, ['default', 'default', 'MWEB']);

  await assert.rejects(resolveYouTubeVideo('cpUxjLKPkLI', 'video', {
    refresh: true,
    excludeClients: ['default', 'MWEB', 'IOS', 'TV', 'ANDROID'],
  }));
  const afterFailure = await resolveYouTubeVideo('cpUxjLKPkLI');
  assert.equal(afterFailure.streamUrl, 'https://example.com/deciphered-4');
});
