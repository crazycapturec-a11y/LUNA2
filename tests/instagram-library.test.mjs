import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

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
