import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import {
  INSTAGRAM_DOCUMENT_HEADERS,
  INSTAGRAM_IFRAME_HEADERS,
  rawNavigationGet,
} from '../app/lib/instagram-http.ts';

function listenServer(t, handler) {
  const server = http.createServer(handler);
  t.after(() => server.close());
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

test('preserves real Sec-Fetch-Mode: navigate headers and decodes compressed responses', async (t) => {
  const seen = [];
  const baseUrl = await listenServer(t, (req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (req.url === '/embed') {
      const payload = gzipSync(Buffer.from('<html>embed-ok</html>'));
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
      res.end(payload);
      return;
    }
    if (req.url === '/home') {
      const payload = brotliCompressSync(Buffer.from('<html>home-ok</html>'));
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Encoding': 'br',
        'Set-Cookie': ['csrftoken=abc123; Path=/; Secure', 'ig_did=DID1; Path=/; Secure'],
      });
      res.end(payload);
      return;
    }
    if (req.url === '/bomb') {
      // Compresses tiny on the wire, expands past the 2 MB decompressed limit.
      const payload = gzipSync(Buffer.alloc(3 * 1024 * 1024, 'a'));
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
      res.end(payload);
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'https://evil.example/capture' });
      res.end();
      return;
    }
    res.writeHead(404).end();
  });

  const embedRes = await rawNavigationGet(`${baseUrl}/embed`, {
    headers: { ...INSTAGRAM_IFRAME_HEADERS },
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
    allowLoopbackForTest: true,
  });
  assert.equal(embedRes.status, 200);
  assert.equal(await embedRes.readText(), '<html>embed-ok</html>');
  assert.equal(seen[0].headers['sec-fetch-mode'], 'navigate');
  assert.equal(seen[0].headers['sec-fetch-dest'], 'iframe');
  assert.equal(seen[0].headers['sec-fetch-site'], 'cross-site');
  assert.equal(seen[0].headers['upgrade-insecure-requests'], '1');

  const homeRes = await rawNavigationGet(`${baseUrl}/home`, {
    headers: { ...INSTAGRAM_DOCUMENT_HEADERS },
    redirect: 'manual',
    signal: AbortSignal.timeout(3000),
    allowLoopbackForTest: true,
  });
  assert.equal(await homeRes.readText(), '<html>home-ok</html>');
  assert.equal(seen[1].headers['sec-fetch-mode'], 'navigate');
  assert.equal(seen[1].headers['sec-fetch-dest'], 'document');
  assert.equal(homeRes.setCookies.length, 2);

  // Decompression limit rejects oversized payloads safely.
  const bombRes = await rawNavigationGet(`${baseUrl}/bomb`, {
    headers: { ...INSTAGRAM_IFRAME_HEADERS },
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
    allowLoopbackForTest: true,
  });
  assert.equal(await bombRes.readText(), null);

  // redirect: 'error' refuses 3xx responses and never visits Location.
  await assert.rejects(() =>
    rawNavigationGet(`${baseUrl}/redirect`, {
      headers: { ...INSTAGRAM_IFRAME_HEADERS, Cookie: 'sessionid=secret' },
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
      allowLoopbackForTest: true,
    }),
  );

  // redirect: 'manual' returns status + Location without following.
  const manualRes = await rawNavigationGet(`${baseUrl}/redirect`, {
    headers: { ...INSTAGRAM_DOCUMENT_HEADERS },
    redirect: 'manual',
    signal: AbortSignal.timeout(3000),
    allowLoopbackForTest: true,
  });
  assert.equal(manualRes.status, 302);
  assert.equal(manualRes.location, 'https://evil.example/capture');
  await manualRes.cancel();

  // Untrusted hosts are always rejected before any socket is created.
  assert.throws(() =>
    rawNavigationGet('https://evil.example/embed', {
      headers: { ...INSTAGRAM_IFRAME_HEADERS },
      redirect: 'error',
      signal: AbortSignal.timeout(1000),
    }),
  );
});
