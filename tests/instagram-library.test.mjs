import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ultraigdl } from 'ultra-igdl';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';

test('the upstream extractor returns immediately on a page 404 without trying its embed', async () => {
  const original = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  agent.get('https://www.instagram.com').intercept({ path: '/reel/Dfe3hqehJsE/', method: 'GET' }).reply(404, 'not found');
  try {
    const result = await new ultraigdl({ retries: 0, timeoutMs: 500 }).download('https://www.instagram.com/reel/Dfe3hqehJsE/');
    assert.equal(result.code, 404);
  } finally {
    setGlobalDispatcher(original);
    await agent.close();
  }
});

// The dependency used to create an unhandled rejected promise in its in-flight
// deduplication cleanup even when callers caught the original network failure.
// A separate strict-mode process catches regressions without a global handler.
test('Instagram network errors do not leave unhandled promise rejections', () => {
  const script = `
    import { ultraigdl } from 'ultra-igdl';
    import { MockAgent, setGlobalDispatcher } from 'undici';
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const client = new ultraigdl({ retries: 0, timeoutMs: 500 }).core.client;
    await client.fetch('https://www.instagram.com/reel/Dfe3hqehJsE/').catch(() => {});
    await client.fetchWithCookie('https://www.instagram.com/reel/Dfe3hqehJsE/', 'sessionid=fake').catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    await agent.close();
  `;
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});
