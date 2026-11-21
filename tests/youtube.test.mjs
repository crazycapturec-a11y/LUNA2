import test from 'node:test';
import assert from 'node:assert/strict';
import { Innertube } from 'youtubei.js';
import { extractVideoId, getInnertube, resolveYouTubeVideo } from '../app/lib/youtube.ts';

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

test('evicts the least recently used cached stream, not merely the oldest', async () => {
  // getInnertube() memoizes its client, so instrument the cached instance instead
  // of `Innertube.create` (which the first test already stubbed).
  const yt = await getInnertube();
  const realGetBasicInfo = yt.getBasicInfo;
  const lookups = [];
  yt.getBasicInfo = async (videoId) => {
    lookups.push(videoId);
    return {
      playability_status: { status: 'OK' },
      streaming_data: {},
      basic_info: { title: 'Video', author: 'Creator', thumbnail: [] },
      chooseFormat: () => ({
        url: `https://example.com/${videoId}`,
        mime_type: 'video/mp4',
        decipher: async () => `https://example.com/${videoId}`,
      }),
    };
  };

  try {
    for (let index = 0; index < 50; index++) await resolveYouTubeVideo(`lru-${index}`);
    // Touch the first entry so it becomes the most recently used one.
    await resolveYouTubeVideo('lru-0');
    assert.equal(lookups.length, 50);

    // This insert overflows the cache; the untouched lru-1 must be the one dropped.
    await resolveYouTubeVideo('lru-50');
    assert.equal(lookups.length, 51);
    await resolveYouTubeVideo('lru-0');
    assert.equal(lookups.length, 51, 'the refreshed entry must stay cached');
    await resolveYouTubeVideo('lru-1');
    assert.equal(lookups.length, 52, 'the least recently used entry must be evicted');
    assert.equal(lookups.at(-1), 'lru-1');
  } finally {
    yt.getBasicInfo = realGetBasicInfo;
  }
});
