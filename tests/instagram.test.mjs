import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramAuthOptions, normalizeInstagramPostUrl } from '../app/lib/instagram.ts';

test('uses a full cookie header when configured, retaining legacy session ID support', () => {
  assert.deepEqual(instagramAuthOptions({}), {});
  assert.deepEqual(instagramAuthOptions({ IG_SESSION_ID: '  sample-session  ' }), { sessionId: 'sample-session' });
  const cookie = 'sessionid=test-session; csrftoken=test-csrf; ds_user_id=123';
  assert.deepEqual(instagramAuthOptions({ IG_COOKIES: cookie, IG_SESSION_ID: 'old-session' }), { cookies: cookie });
  assert.deepEqual(instagramAuthOptions({ IG_SESSION_ID: cookie }), { cookies: cookie });
  assert.deepEqual(instagramAuthOptions({ IG_SESSION_ID: 'sessionid=test-session' }), { cookies: 'sessionid=test-session' });
  assert.deepEqual(instagramAuthOptions({ IG_COOKIES: cookie, IG_SESSION_ID: 'old\nsession' }), { cookies: cookie });
});

test('rejects malformed credentials without exposing their values', () => {
  for (const env of [
    { IG_COOKIES: 'csrftoken=secret' },
    { IG_COOKIES: 'sessionid=secret\nInjected: test' },
    { IG_SESSION_ID: 'secret;csrftoken=value' },
    { IG_SESSION_ID: 'secret\nvalue' },
  ]) {
    assert.throws(() => instagramAuthOptions(env), (error) => error.message === 'Instagram session configuration is invalid.');
  }
});

test('normalizes real Instagram hosts and rejects deceptive hosts or userinfo', () => {
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/reel/ABC_def/?igsh=123'), 'https://www.instagram.com/reel/ABC_def/');
  assert.equal(normalizeInstagramPostUrl('https://instagr.am/p/ABC123/?utm_source=ig'), 'https://www.instagram.com/p/ABC123/');
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/reels/ABC123/?igsh=tracking'), 'https://www.instagram.com/reel/ABC123/');
  assert.equal(normalizeInstagramPostUrl('https://evil.example/instagram.com/reel/ABC/'), null);
  assert.equal(normalizeInstagramPostUrl('https://instagram.com.evil.example/reel/ABC/'), null);
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com@evil.example/reel/ABC/'), null);
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com:444/reel/ABC/'), null);
});
