import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('worker protects jobs, creates a bounded job, and serves only signed downloads', { timeout: 15000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'luna-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fake = join(dir, 'fake-yt-dlp');
  const trace = join(dir, 'args.json');
  await writeFile(fake, `#!/usr/bin/env node\nconst fs = require('fs');\nconst args = process.argv.slice(2);\nfs.writeFileSync(process.env.FAKE_TRACE, JSON.stringify(args));\nsetTimeout(() => { if (args.at(-1).includes('dQw4w9WgXcQ')) { console.error('Sign in to confirm you are not a bot'); process.exit(1); } fs.writeFileSync(args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4'), 'fake video bytes'); }, 400);\n`);
  await chmod(fake, 0o755);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const secret = 'a'.repeat(40);
  const worker = spawn(process.execPath, ['services/youtube-worker/server.mjs'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port), WORKER_PUBLIC_URL: origin, WORKER_ALLOW_INSECURE_LOCAL: '1', WORKER_SECRET: secret, YT_DLP_BINARY: fake, FAKE_TRACE: trace }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => worker.kill());
  await Promise.race([once(worker.stdout, 'data'), once(worker, 'exit').then(() => { throw new Error('worker exited early'); })]);
  const auth = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
  const request = (videoId, headers = auth) => fetch(`${origin}/jobs`, { method: 'POST', headers, body: JSON.stringify({ videoId }) });
  assert.equal((await request('cpUxjLKPkLI', { 'content-type': 'application/json' })).status, 401);
  assert.equal((await request('bad')).status, 400);
  const created = await request('cpUxjLKPkLI');
  assert.equal(created.status, 202);
  const job = await created.json();
  assert.equal((await request('dQw4w9WgXcQ')).status, 429);
  let data;
  for (let i = 0; i < 30; i++) {
    data = await (await fetch(`${origin}/jobs/${job.id}`, { headers: auth })).json();
    if (data.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(data.status, 'ready');
  const args = JSON.parse(await readFile(trace, 'utf8'));
  assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=cpUxjLKPkLI');
  assert.ok(args.includes('--ignore-config'));
  assert.ok(args.includes('--no-playlist'));
  const invalid = new URL(data.downloadUrl);
  invalid.searchParams.set('signature', '0'.repeat(64));
  assert.equal((await fetch(invalid)).status, 404);
  const download = await fetch(data.downloadUrl);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  assert.equal(await download.text(), 'fake video bytes');
  const expired = new URL(data.downloadUrl);
  expired.searchParams.set('expires', '1');
  assert.equal((await fetch(expired)).status, 404);

  const failedJob = await (await request('dQw4w9WgXcQ')).json();
  let failed;
  for (let i = 0; i < 30; i++) {
    failed = await (await fetch(`${origin}/jobs/${failedJob.id}`, { headers: auth })).json();
    if (failed.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'sign_in');
  assert.equal(failed.downloadUrl, undefined);
});
