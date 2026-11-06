import test from 'node:test';
import assert from 'node:assert/strict';
import { getYouTubeWorkerConfig } from '../app/lib/youtube-worker.ts';

test('worker configuration is optional and requires an HTTPS origin and a strong secret', (t) => {
  const originalUrl = process.env.YOUTUBE_WORKER_URL;
  const originalSecret = process.env.YOUTUBE_WORKER_SECRET;
  t.after(() => {
    if (originalUrl === undefined) delete process.env.YOUTUBE_WORKER_URL; else process.env.YOUTUBE_WORKER_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.YOUTUBE_WORKER_SECRET; else process.env.YOUTUBE_WORKER_SECRET = originalSecret;
  });
  delete process.env.YOUTUBE_WORKER_URL;
  delete process.env.YOUTUBE_WORKER_SECRET;
  assert.equal(getYouTubeWorkerConfig(), null);
  process.env.YOUTUBE_WORKER_URL = 'https://worker.example.com';
  assert.throws(() => getYouTubeWorkerConfig());
  process.env.YOUTUBE_WORKER_SECRET = 'x'.repeat(40);
  assert.deepEqual(getYouTubeWorkerConfig(), { origin: 'https://worker.example.com', secret: 'x'.repeat(40) });
  process.env.YOUTUBE_WORKER_URL = 'http://worker.example.com';
  assert.throws(() => getYouTubeWorkerConfig());
  process.env.YOUTUBE_WORKER_URL = 'https://worker.example.com/path';
  assert.throws(() => getYouTubeWorkerConfig());
  process.env.YOUTUBE_WORKER_URL = 'https://127.0.0.1:8080';
  assert.throws(() => getYouTubeWorkerConfig());
  process.env.YOUTUBE_WORKER_URL = 'https://localhost';
  assert.throws(() => getYouTubeWorkerConfig());
});
