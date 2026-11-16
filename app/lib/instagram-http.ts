import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

export const INSTAGRAM_MAX_BYTES = 2 * 1024 * 1024;

export const INSTAGRAM_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const INSTAGRAM_ANDROID_UA =
  'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; en_US; 458229237)';

export const INSTAGRAM_WEB_APP_ID = '936619743392459';
export const INSTAGRAM_ANDROID_APP_ID = '567067343352427';
export const INSTAGRAM_ASBD_ID = '359341';

export const INSTAGRAM_DOCUMENT_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': INSTAGRAM_BROWSER_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

export const INSTAGRAM_IFRAME_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': INSTAGRAM_BROWSER_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.instagram.com/',
  'Sec-Fetch-Dest': 'iframe',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Upgrade-Insecure-Requests': '1',
};

export type InstagramHttpResponse = {
  status: number;
  ok: boolean;
  location: string;
  contentType: string;
  setCookies: string[];
  readText: (maxBytes?: number) => Promise<string | null>;
  cancel: () => Promise<void>;
};

const ALLOWED_INSTAGRAM_API_HOSTS = new Set(['www.instagram.com', 'i.instagram.com']);

function assertAllowedUrl(rawUrl: string, allowLoopbackForTest: boolean): URL {
  const parsed = new URL(rawUrl);
  if (parsed.username || parsed.password) {
    throw new Error('Blocked credentialed URL');
  }
  if (
    parsed.protocol === 'https:' &&
    !parsed.port &&
    ALLOWED_INSTAGRAM_API_HOSTS.has(parsed.hostname.toLowerCase())
  ) {
    return parsed;
  }
  if (allowLoopbackForTest && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1') {
    return parsed;
  }
  throw new Error('Blocked non-Instagram URL');
}

function isMockedGlobalFetch(): boolean {
  return (
    typeof globalThis.fetch === 'function' &&
    typeof (globalThis.fetch as unknown as { mock?: unknown }).mock === 'object' &&
    (globalThis.fetch as unknown as { mock?: unknown }).mock !== null
  );
}

/** Read a Fetch Response body as UTF-8, rejecting bodies larger than maxBytes. */
export async function readResponseText(
  response: Response,
  maxBytes = INSTAGRAM_MAX_BYTES,
): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }
}

function readNodeStreamLimited(
  res: IncomingMessage,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string | null> {
  const declared = Number(res.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.destroy();
    return Promise.resolve(null);
  }
  if (signal.aborted) {
    res.destroy();
    return Promise.resolve(null);
  }

  const encoding = String(res.headers['content-encoding'] || 'identity')
    .trim()
    .toLowerCase();

  let decoder: ReturnType<typeof createGunzip> | ReturnType<typeof createInflate> | ReturnType<typeof createBrotliDecompress> | null = null;
  if (encoding === '' || encoding === 'identity') {
    decoder = null;
  } else if (encoding === 'gzip' || encoding === 'x-gzip') {
    decoder = createGunzip();
  } else if (encoding === 'br') {
    decoder = createBrotliDecompress();
  } else if (encoding === 'deflate') {
    decoder = createInflate();
  } else {
    res.destroy();
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let rawBytes = 0;
    let decodedBytes = 0;
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };

    const abortAll = () => {
      if (decoder && !decoder.destroyed) decoder.destroy();
      if (!res.destroyed) res.destroy();
      finish(null);
    };

    const onAbort = () => abortAll();
    signal.addEventListener('abort', onAbort, { once: true });

    res.on('error', abortAll);

    if (!decoder) {
      res.on('data', (chunk: Buffer) => {
        decodedBytes += chunk.byteLength;
        if (decodedBytes > maxBytes) {
          abortAll();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(Buffer.concat(chunks, decodedBytes).toString('utf8')));
      res.on('close', () => {
        if (!res.complete) finish(null);
      });
      return;
    }

    decoder.on('error', abortAll);
    decoder.on('drain', () => {
      if (!res.destroyed && !settled) res.resume();
    });
    res.on('data', (chunk: Buffer) => {
      rawBytes += chunk.byteLength;
      if (rawBytes > maxBytes) {
        abortAll();
        return;
      }
      if (!decoder.destroyed && !decoder.write(chunk)) {
        res.pause();
      }
    });
    res.on('end', () => {
      if (!decoder.destroyed) decoder.end();
    });
    res.on('close', () => {
      if (!res.complete) abortAll();
    });

    decoder.on('data', (chunk: Buffer) => {
      decodedBytes += chunk.byteLength;
      if (decodedBytes > maxBytes) {
        abortAll();
        return;
      }
      chunks.push(chunk);
    });
    decoder.on('end', () => finish(Buffer.concat(chunks, decodedBytes).toString('utf8')));
  });
}

/**
 * Low-level GET using node:https so browser navigation Sec-Fetch-* headers
 * (especially `Sec-Fetch-Mode: navigate`) reach Instagram verbatim instead of
 * being rewritten to `cors` by Fetch/undici. Never follows redirects.
 */
export function rawNavigationGet(
  url: string,
  options: {
    headers: Record<string, string>;
    redirect: 'error' | 'manual';
    signal: AbortSignal;
    allowLoopbackForTest?: boolean;
  },
): Promise<InstagramHttpResponse> {
  const parsed = assertAllowedUrl(url, Boolean(options.allowLoopbackForTest));
  const transport = parsed.protocol === 'https:' ? https : http;
  const requestHeaders: Record<string, string> = {
    'Accept-Encoding': 'gzip, br',
    ...options.headers,
  };

  // Validate header values contain no CR/LF.
  for (const value of Object.values(requestHeaders)) {
    if (/[\r\n]/.test(value)) {
      return Promise.reject(new Error('Invalid header value'));
    }
  }

  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new Error('Request aborted'));
      return;
    }

    let settled = false;
    const req = transport.request(
      parsed,
      {
        method: 'GET',
        headers: requestHeaders,
        signal: options.signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const isRedirect = status >= 300 && status < 400;
        if (isRedirect && options.redirect === 'error') {
          res.resume();
          if (!settled) {
            settled = true;
            reject(new Error('Unexpected redirect'));
          }
          return;
        }

        const rawCookies = res.headers['set-cookie'];
        const setCookies = Array.isArray(rawCookies)
          ? rawCookies
          : typeof rawCookies === 'string'
            ? [rawCookies]
            : [];
        const location = typeof res.headers.location === 'string' ? res.headers.location : '';
        const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : '';

        let consumed = false;
        settled = true;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          location,
          contentType,
          setCookies,
          readText: async (maxBytes = INSTAGRAM_MAX_BYTES) => {
            if (consumed) return null;
            consumed = true;
            return readNodeStreamLimited(res, maxBytes, options.signal);
          },
          cancel: async () => {
            if (consumed) return;
            consumed = true;
            res.resume();
            res.destroy();
          },
        });
      },
    );

    req.on('error', () => {
      if (!settled) {
        settled = true;
        // Avoid propagating raw network errors that could carry URLs/headers.
        reject(new Error('Navigation request failed'));
      }
    });

    req.end();
  });
}

function getResponseSetCookies(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === 'function') {
    const cookies = extended.getSetCookie();
    if (cookies.length > 0) return cookies;
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

/**
 * Send a navigation GET to Instagram without following redirects.
 * Uses rawNavigationGet in production to preserve `Sec-Fetch-Mode: navigate`,
 * and seamlessly respects `globalThis.fetch` mocks during unit tests.
 */
export async function instagramNavigationGet(
  url: string,
  options: {
    headers: Record<string, string>;
    redirect: 'error' | 'manual';
    signal: AbortSignal;
  },
): Promise<InstagramHttpResponse> {
  assertAllowedUrl(url, false);

  if (isMockedGlobalFetch()) {
    const response = await fetch(url, {
      headers: options.headers,
      redirect: options.redirect,
      cache: 'no-store',
      signal: options.signal,
    });
    if (options.redirect === 'error' && response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Unexpected redirect');
    }
    return {
      status: response.status,
      ok: response.ok,
      location: response.headers.get('location') || '',
      contentType: response.headers.get('content-type') || '',
      setCookies: getResponseSetCookies(response.headers),
      readText: (maxBytes = INSTAGRAM_MAX_BYTES) => readResponseText(response, maxBytes),
      cancel: async () => {
        await response.body?.cancel().catch(() => {});
      },
    };
  }

  return rawNavigationGet(url, options);
}
