import test from 'node:test';
import assert from 'node:assert/strict';
import { persistVerifications } from './core/verificationWriter.js';

const row = id => ({id, status: 'unknown', elig_signals: {version: 3}, verification: {status: 'unknown', last_known: {status: 'ok'}}});
const db = handler => ({from: () => ({update: payload => ({eq: (_key, id) => handler(id, payload)})})});
const options = {sleep: async () => {}, now: () => '2026-10-16T09:00:00Z'};

test('returned and thrown network failures retry before saving all evidence together', async () => {
  const writes = [];
  let calls = 0;
  const result = await persistVerifications(db(async (_id, payload) => {
    if (++calls === 1) return {error: {message: 'TypeError: fetch failed'}};
    if (calls === 2) throw new TypeError('fetch failed');
    writes.push(payload);
    return {error: null};
  }), [row('a')], options);
  assert.deepEqual(result, {saved: 1, failedIds: []});
  assert.equal(calls, 3);
  assert.deepEqual(writes, [{elig_signals: {version: 3, verification: row('a').verification}, link_status: 'unknown', link_checked_at: options.now()}]);
});

test('exhausted writes do not advance failed rows or inflate saved count', async () => {
  const stored = new Map(), attempts = new Map();
  const result = await persistVerifications(db(async (id, payload) => {
    attempts.set(id, (attempts.get(id) || 0) + 1);
    if (id === 'bad') return {error: {message: 'unavailable'}};
    stored.set(id, payload);
    return {error: null};
  }), [row('good'), row('bad')], options);
  assert.deepEqual(result, {saved: 1, failedIds: ['bad']});
  assert.equal(attempts.get('bad'), 4);
  assert.equal(stored.has('bad'), false);
});

test('database writes have bounded concurrency independent of verification workers', async () => {
  let active = 0, peak = 0;
  const result = await persistVerifications(db(async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return {error: null};
  }), Array.from({length: 24}, (_, i) => row(String(i))), options);
  assert.equal(result.saved, 24);
  assert.equal(peak, 4);
});
