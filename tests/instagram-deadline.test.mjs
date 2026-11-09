import test from 'node:test';
import assert from 'node:assert/strict';
import { withInstagramDeadline } from '../app/lib/instagram-deadline.ts';

test('bounds an extractor that does not return and handles late rejection', async () => {
  let rejectWork;
  const work = new Promise((_, reject) => { rejectWork = reject; });
  await assert.rejects(withInstagramDeadline(work, 10), /timed out/);
  rejectWork(new Error('late network failure'));
  await new Promise(resolve => setImmediate(resolve));
});

test('returns an extractor result before its deadline', async () => {
  assert.equal(await withInstagramDeadline(Promise.resolve('ok'), 1000), 'ok');
});
