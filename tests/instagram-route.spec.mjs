import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { POST } from '../app/api/download/route.ts';

const { ultraigdl } = createRequire(import.meta.url)('ultra-igdl');

const request = (url) => new Request('http://test.local/api/download', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
});

test('passes configured cookies to the extractor and does not expose errors or send credentials to other hosts', async (t) => {
  const oldCookies = process.env.IG_COOKIES;
  const oldSession = process.env.IG_SESSION_ID;
  t.after(() => {
    if (oldCookies === undefined) delete process.env.IG_COOKIES; else process.env.IG_COOKIES = oldCookies;
    if (oldSession === undefined) delete process.env.IG_SESSION_ID; else process.env.IG_SESSION_ID = oldSession;
  });
  process.env.IG_COOKIES = 'sessionid=fake-secret; csrftoken=fake-csrf';
  process.env.IG_SESSION_ID = 'older-session';
  let seenOptions;
  let seenUrl;
  let response = { code: 200, media: [{ type: 'video', url: 'https://cdninstagram.com/example.mp4' }], caption: 'Test', username: 'creator' };
  const mock = t.mock.method(ultraigdl.prototype, 'download', async function (url) {
    seenOptions = this.core.options;
    seenUrl = url;
    return response;
  });

  const success = await POST(request('https://www.instagram.com/reel/ABC_123/?igsh=tracking'));
  assert.equal(success.status, 200);
  assert.equal(seenOptions.cookies, process.env.IG_COOKIES);
  assert.equal(seenOptions.sessionId, undefined);
  assert.equal(seenUrl, 'https://www.instagram.com/reel/ABC_123/');
  assert.equal((await success.json()).mediaType, 'video');

  const calls = mock.mock.callCount();
  assert.equal((await POST(request('https://evil.example/instagram.com/reel/ABC_123/'))).status, 400);
  assert.equal(mock.mock.callCount(), calls);

  response = { code: 500, message: `failed with ${process.env.IG_COOKIES}` };
  const failed = await POST(request('https://www.instagram.com/reel/ABC_123/'));
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes('fake-secret'));

  process.env.IG_COOKIES = 'no-sessionid=unsafe';
  const invalid = await POST(request('https://www.instagram.com/reel/ABC_123/'));
  assert.equal(invalid.status, 503);
  assert.ok(!(await invalid.text()).includes('unsafe'));
});
