// Keep the public instance fallback, but treat both its metadata and stream URLs
// as untrusted. A public instance may be unavailable or return a dead stream.
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.privacydev.net',
];
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.garudalinux.org',
  'https://api.piped.yt',
];
const INSTANCE_HOSTS = new Set([...INVIDIOUS_INSTANCES, ...PIPED_INSTANCES].map((url) => new URL(url).hostname));

type Stream = { url?: string; type?: string; mimeType?: string; videoOnly?: boolean };
type InstanceData = { title?: string; formatStreams?: Stream[]; videoStreams?: Stream[] };

function allowedStreamUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com') || INSTANCE_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

async function fetchStream(raw: string, deadline: number): Promise<Response | null> {
  let url = raw;
  // Validate every redirect too: instance responses are not trusted as URLs.
  for (let redirects = 0; redirects <= 3; redirects++) {
    const remaining = deadline - Date.now();
    if (!allowedStreamUrl(url) || remaining <= 0) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(10000, remaining));
    let response: Response;
    try {
      response = await fetch(url, { redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) return null;
      url = new URL(location, url).href;
      continue;
    }
    if (response.ok && response.body) return response;
    await response.body?.cancel();
    return null;
  }
  return null;
}

/** Try public instances for a muxed MP4, then relay its bytes from the server. */
export async function fetchFallbackVideo(videoId: string): Promise<{ response: Response; title: string } | null> {
  const deadline = Date.now() + 30000;
  // Alternate providers so slow Invidious instances cannot consume the entire
  // deadline before a Piped instance is ever attempted.
  const sources: { instance: string; piped: boolean }[] = [];
  for (let i = 0; i < Math.max(INVIDIOUS_INSTANCES.length, PIPED_INSTANCES.length); i++) {
    if (INVIDIOUS_INSTANCES[i]) sources.push({ instance: INVIDIOUS_INSTANCES[i], piped: false });
    if (PIPED_INSTANCES[i]) sources.push({ instance: PIPED_INSTANCES[i], piped: true });
  }
  for (const { instance, piped } of sources) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // Reserve time for the remaining instances even if this one's metadata or
    // media server is slow. This applies to the entire attempt, not each URL.
    const sourceDeadline = Date.now() + Math.min(4000, remaining);
    try {
      const path = piped ? `/streams/${videoId}` : `/api/v1/videos/${videoId}`;
      const metadata = await fetch(instance + path, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(Math.max(1, sourceDeadline - Date.now())),
        redirect: 'error',
      });
      if (!metadata.ok) continue;
      const data = await metadata.json() as InstanceData;
      // Invidious formatStreams and Piped's non-videoOnly streams include audio.
      const formats = piped ? data.videoStreams : data.formatStreams;
      if (!Array.isArray(formats)) continue;
      for (const format of formats) {
        if (Date.now() >= sourceDeadline) break;
        if (typeof format.url !== 'string' || !(piped ? format.mimeType : format.type)?.includes('video/mp4')) continue;
        if (piped && format.videoOnly !== false) continue;
        try {
          const response = await fetchStream(format.url, sourceDeadline);
          if (response) return { response, title: data.title || 'YouTube Video' };
        } catch {
          // A single dead stream should not prevent trying other formats.
        }
      }
    } catch {
      // Continue through the other public instances if this one fails.
    }
  }
  return null;
}
