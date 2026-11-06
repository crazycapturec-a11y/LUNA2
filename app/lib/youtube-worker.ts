import { isIP } from 'node:net';

// The worker secret must remain server-side; only signed, short-lived download
// links are returned to the browser. An unconfigured worker leaves the existing
// YouTube flow unchanged.
export type WorkerConfig = { origin: string; secret: string };

export function getYouTubeWorkerConfig(): WorkerConfig | null {
  const raw = process.env.YOUTUBE_WORKER_URL;
  const secret = process.env.YOUTUBE_WORKER_SECRET;
  if (!raw && !secret) return null;
  if (!raw || !secret || Buffer.byteLength(secret) < 32) throw new Error('YouTube worker configuration is incomplete.');
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || isIP(host.replace(/^\[|\]$/g, '')) || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) throw new Error('invalid origin');
    return { origin: url.origin, secret };
  } catch {
    throw new Error('YouTube worker URL must be an HTTPS origin.');
  }
}
