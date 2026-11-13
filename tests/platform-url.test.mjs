import test from 'node:test';
import assert from 'node:assert/strict';
import { findSupportedLink } from '../app/lib/platform-url.ts';

test('detects links and pulls the URL out of share text', () => {
  assert.deepEqual(findSupportedLink('Watch this! https://vt.tiktok.com/ZSpC8nYxp/ 🎬'), { platform: 'TikTok', url: 'https://vt.tiktok.com/ZSpC8nYxp/' });
  assert.deepEqual(findSupportedLink('https://www.instagram.com/reel/Dfe3hqehJsE/?srtk=abc'), { platform: 'Instagram', url: 'https://www.instagram.com/reel/Dfe3hqehJsE/?srtk=abc' });
  assert.deepEqual(findSupportedLink('Check this (https://youtu.be/cpUxjLKPkLI?si=abc).'), { platform: 'YouTube', url: 'https://youtu.be/cpUxjLKPkLI?si=abc' });
  assert.equal(findSupportedLink('https://example.org/ https://instagr.am/p/ABC/').platform, 'Instagram');
});

test('rejects deceptive hosts, credentials, custom ports and unrelated text', () => {
  for (const input of ['https://tiktok.com.evil.example/a', 'https://youtube.com@evil.example/watch?v=abc', 'https://www.instagram.com:444/p/abc', 'no link here']) {
    assert.equal(findSupportedLink(input), null);
  }
});

test('preserves API-compatible query parameters and upgrades insecure TikTok links', () => {
  assert.equal(findSupportedLink('http://vt.tiktok.com/abc/?a=1#ignored').url, 'https://vt.tiktok.com/abc/?a=1');
  assert.equal(findSupportedLink('https://www.youtube.com/watch?v=cpUxjLKPkLI&feature=share').platform, 'YouTube');
});
