import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLARIS_DOC_ID,
  DEFAULT_SHORTCODE_DOC_IDS,
  instagramAuthOptions,
  instagramDocIds,
  normalizeInstagramPostUrl,
  shortcodeToMediaId,
} from '../app/lib/instagram.ts';

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
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/nasa/reel/ABC123/?igsh=1'), 'https://www.instagram.com/reel/ABC123/');
  assert.equal(normalizeInstagramPostUrl('https://m.instagram.com/creator.name_1/p/XYZ_789/'), 'https://www.instagram.com/p/XYZ_789/');
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/some_user/reels/ABC123/'), 'https://www.instagram.com/reel/ABC123/');
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/reel/ABC123/embed/captioned/'), 'https://www.instagram.com/reel/ABC123/');
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/share/reel/TOKEN_1/'), 'https://www.instagram.com/share/reel/TOKEN_1/');
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/share/BAxyz_9/'), 'https://www.instagram.com/share/BAxyz_9/');
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/reels/audio/123456789/'), null);
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/accounts/p/ABC123/'), null);
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/stories/nasa/123456/'), null);
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/reel/ABC123/unexpected/'), null);
  assert.equal(normalizeInstagramPostUrl('https://evil.example/instagram.com/reel/ABC/'), null);
  assert.equal(normalizeInstagramPostUrl('https://instagram.com.evil.example/reel/ABC/'), null);
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com@evil.example/reel/ABC/'), null);
  assert.equal(normalizeInstagramPostUrl('https://www.instagram.com:444/reel/ABC/'), null);
});

test('decodes standard and long follower-share shortcodes into numeric media IDs', () => {
  assert.equal(shortcodeToMediaId('aye83DjauH'), '482584233761418119');
  assert.equal(shortcodeToMediaId('CeMLlWpK-55numXXvgqWQ-cVZ_7ccajlQJ8scI0'), '2849703609664007801');
  assert.equal(shortcodeToMediaId('invalid!code'), null);
  assert.equal(shortcodeToMediaId(''), null);
});

test('supports validated GraphQL doc_id environment overrides with safe defaults', () => {
  assert.deepEqual(instagramDocIds({}), {
    shortcodeDocIds: [...DEFAULT_SHORTCODE_DOC_IDS],
    polarisDocId: DEFAULT_POLARIS_DOC_ID,
  });
  assert.deepEqual(instagramDocIds({ IG_GRAPHQL_DOC_ID: '99999999999999999', IG_POLARIS_DOC_ID: '88888888888888888' }), {
    shortcodeDocIds: ['99999999999999999', ...DEFAULT_SHORTCODE_DOC_IDS],
    polarisDocId: '88888888888888888',
  });
  assert.deepEqual(instagramDocIds({ IG_GRAPHQL_DOC_ID: 'not-a-doc-id', IG_POLARIS_DOC_ID: '123' }), {
    shortcodeDocIds: [...DEFAULT_SHORTCODE_DOC_IDS],
    polarisDocId: DEFAULT_POLARIS_DOC_ID,
  });
});
