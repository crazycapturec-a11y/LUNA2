import http from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Jobs live in memory and local temporary storage. Run a single instance with
// bounded disk space; this is not a distributed queue or a multi-tenant service.
const secret = process.env.WORKER_SECRET || '';
if (Buffer.byteLength(secret) < 32) throw new Error('WORKER_SECRET must contain at least 32 bytes');
const base = new URL(process.env.WORKER_PUBLIC_URL || '');
const localTest = process.env.WORKER_ALLOW_INSECURE_LOCAL === '1' && base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
if ((!localTest && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
  throw new Error('WORKER_PUBLIC_URL must be an HTTPS origin without credentials or a path');
}
const port = Number(process.env.PORT || 8080);
const ttlMs = 15 * 60 * 1000;
const timeoutMs = 15 * 60 * 1000;
const maxJobs = 3;
const jobs = new Map();
let busy = false;

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function authenticated(req) {
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function signature(id, expires) {
  return createHmac('sha256', secret).update(`${id}:${expires}`).digest('hex');
}
function signedUrl(job) {
  const expires = Math.floor(job.expires / 1000);
  const url = new URL(`/files/${job.id}`, base);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signature(job.id, expires));
  return url.href;
}
function safeSignature(value, expected) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) return false;
  return timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
}
async function discard(job) {
  if (jobs.get(job.id) !== job || job.activeDownloads > 0) return;
  jobs.delete(job.id);
  await rm(job.dir, { recursive: true, force: true }).catch(() => {});
}
async function cleanup() {
  await Promise.all([...jobs.values()].filter(j => j.status !== 'running' && j.expires <= Date.now()).map(discard));
}
setInterval(() => { void cleanup(); }, 60_000).unref();

async function runJob(job, videoId) {
  // Only the canonical URL constructed from a validated ID is passed to yt-dlp.
  // No user-supplied arguments, cookies, configuration or arbitrary URL allowed.
  const args = [
    '--ignore-config', '--no-playlist', '--no-progress', '--no-warnings', '--no-cache-dir',
    '--no-simulate', '--js-runtimes', 'node', '--max-filesize', '500M',
    '--match-filter', 'duration <= 3600',
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
    '--merge-output-format', 'mp4', '-o', join(job.dir, 'video.%(ext)s'),
    '--', `https://www.youtube.com/watch?v=${videoId}`,
  ];
  let timedOut = false;
  let stderr = '';
  try {
    const child = spawn(process.env.YT_DLP_BINARY || 'yt-dlp', args, { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
    // Extractor output can contain signed URLs; classify it, but never log it.
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-16384); });
    const kill = (signal) => {
      try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); } catch { /* already exited */ }
    };
    const timer = setTimeout(() => { timedOut = true; kill('SIGKILL'); }, timeoutMs);
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }).finally(() => clearTimeout(timer));
    if (timedOut) throw new Error('timeout');
    if (code !== 0) throw new Error('extractor failed');
    const file = join(job.dir, 'video.mp4');
    const fileStat = await stat(file);
    if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > 500 * 1024 * 1024) throw new Error('invalid output');
    job.file = file;
    job.size = fileStat.size;
    job.status = 'ready';
  } catch {
    job.status = 'failed';
    job.errorCode = timedOut ? 'timeout' : /sign in|not a bot|confirm.{0,30}bot/i.test(stderr) ? 'sign_in' : /requested format is not available/i.test(stderr) ? 'format' : 'download_failed';
    console.warn('YouTube worker job failed:', job.errorCode);
  } finally {
    busy = false;
    job.expires = Date.now() + ttlMs;
  }
}

async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://worker.invalid');
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
  const fileMatch = url.pathname.match(/^\/files\/([0-9a-f-]{36})$/);
  if (req.method === 'GET' && fileMatch) {
    const job = jobs.get(fileMatch[1]);
    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('signature');
    if (!job || job.status !== 'ready' || !Number.isSafeInteger(expires) || expires * 1000 <= Date.now() || expires * 1000 > job.expires || !safeSignature(sig, signature(job.id, expires))) {
      return json(res, 404, { error: 'This download link is invalid or expired.' });
    }
    job.activeDownloads++;
    const stream = createReadStream(job.file);
    stream.once('error', () => { if (!res.headersSent) json(res, 500, { error: 'Could not read the prepared file.' }); else res.destroy(); });
    res.once('close', () => { job.activeDownloads--; stream.destroy(); if (job.expires <= Date.now()) void discard(job); });
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(job.size), 'content-disposition': `attachment; filename="luna-${job.videoId}.mp4"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    stream.pipe(res);
    return;
  }
  if (!authenticated(req)) return json(res, 401, { error: 'Unauthorized' });
  if (req.method === 'POST' && url.pathname === '/jobs') {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 1024) return json(res, 413, { error: 'Request too large.' });
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { error: 'Invalid request.' }); }
    if (typeof input?.videoId !== 'string' || !/^[\w-]{11}$/.test(input.videoId)) return json(res, 400, { error: 'Invalid video ID.' });
    await cleanup();
    if (busy || jobs.size >= maxJobs) return json(res, 429, { error: 'The download worker is busy. Please try again later.' });
    busy = true; // Reserve before awaiting filesystem operations.
    let dir;
    try { dir = await mkdtemp(join(tmpdir(), 'luna-video-')); } catch { busy = false; return json(res, 503, { error: 'The download worker is unavailable.' }); }
    const job = { id: randomUUID(), videoId: input.videoId, dir, status: 'running', expires: Infinity, activeDownloads: 0 };
    jobs.set(job.id, job);
    void runJob(job, job.videoId);
    return json(res, 202, { id: job.id, status: job.status });
  }
  const jobMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})$/);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job || (job.status !== 'running' && job.expires <= Date.now())) return json(res, 404, { error: 'Download job expired.' });
    if (job.status === 'ready') return json(res, 200, { status: 'ready', downloadUrl: signedUrl(job) });
    if (job.status === 'failed') return json(res, 200, { status: 'failed', errorCode: job.errorCode });
    return json(res, 200, { status: 'running' });
  }
  return json(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => { void handler(req, res).catch(() => { if (!res.headersSent) json(res, 500, { error: 'Worker error.' }); else res.destroy(); }); });
server.listen(port, '0.0.0.0', () => console.log(`YouTube worker listening on port ${port}`));
