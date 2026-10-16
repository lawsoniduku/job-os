import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, dedupe } from './core/dedup.js';
import { rowToRaw, fastReject, parseRemoteFlag, recoverWorldwideJob, JOBHIVE_KEEP_REGIONS } from './core/jobhive.js';
import { createJobhiveWriter } from './core/jobhiveWriter.js';
import { normalizeJob } from './core/normalize.js';
import { tagJob } from './core/tag.js';
import { checkEligibility } from '../api/roleIntelligence.js';

// Matches JobHive upstream's YC fixture: identity is INSIDE continue=.
const yc = (id) => 'https://account.ycombinator.com/authenticate?continue=' +
  encodeURIComponent(`https://www.workatastartup.com/application?signup_job_id=${id}`);

test('distinct YC application redirects must not collapse', () => {
  assert.notEqual(canonicalUrl(yc(93354)), canonicalUrl(yc(93355)));
  const rows = Array.from({ length: 103 }, (_,i) => ({ company: `Company ${i}`, title: 'Engineer', location: 'Remote', apply_url: yc(93354 + i) }));
  assert.equal(dedupe(rows).length, 103);
});

test('tracking noise still deduplicates the same YC job', () => {
  assert.equal(canonicalUrl(yc(1)), canonicalUrl(yc(1) + '&utm_source=jobhive&fbclid=abc'));
});

test('unknown query parameters and case-sensitive IDs are preserved', () => {
  assert.notEqual(canonicalUrl('https://jobs.example/apply?requisition=1'), canonicalUrl('https://jobs.example/apply?requisition=2'));
  assert.notEqual(canonicalUrl('https://jobs.example/AbC'), canonicalUrl('https://jobs.example/abc'));
  assert.notEqual(canonicalUrl('https://jobs.example/apply?id=AbC'), canonicalUrl('https://jobs.example/apply?id=abc'));
  assert.equal(new URL(canonicalUrl('https://jobs.example/apply?continue=https://other.example/')).searchParams.get('continue'), 'https://other.example/');
});

test('parameter ordering, host casing and trailing slash normalize', () => {
  assert.equal(canonicalUrl('https://JOBS.EXAMPLE/role/?b=2&a=1'), canonicalUrl('https://jobs.example/role?a=1&b=2'));
});

test('an exact duplicate is still removed', () => {
  const row = { company: 'Acme', title: 'Engineer', location: 'Remote', apply_url: yc(1) };
  assert.equal(dedupe([row, { ...row }]).length, 1);
});

for (const flag of ['', 'unknown', 'null', undefined]) {
  test(`remote flag ${String(flag)} is unknown, not false`, () => {
    assert.equal(parseRemoteFlag(flag), undefined);
    const raw = rowToRaw({ title: 'Engineer', url: yc(1), country_iso: 'US', is_remote: flag });
    assert.equal(fastReject(raw), false);
  });
}

test('explicit non-remote foreign jobs retain the fast exclusion', () => {
  for (const flag of ['false', '0', 'no']) {
    assert.equal(fastReject(rowToRaw({ country_iso: 'US', is_remote: flag })), true);
  }
});

test('remote and African candidates are evaluated', () => {
  assert.equal(fastReject(rowToRaw({ country_iso: 'US', is_remote: 'true' })), false);
  assert.equal(fastReject(rowToRaw({ country_iso: 'NG', is_remote: 'false' })), false);
});

test('EMEA survives import and is eligible for a Nigerian target', () => {
  const raw = rowToRaw({ title: 'Data Analyst', company: 'Acme', location: 'EMEA', description: 'Work with our distributed team.', url: 'https://jobs.example/1', is_remote: 'true' });
  const tagged = tagJob(normalizeJob(raw, { source: 'jobhive', countryIso: raw._country_iso }));
  assert.equal(tagged.eligibility_region, 'EMEA');
  assert.equal(JOBHIVE_KEEP_REGIONS.has(tagged.eligibility_region), true);
  assert.equal(checkEligibility(tagged, 'nigeria').eligible, true);
});

test('adding EMEA does not admit US-only regions', () => {
  assert.equal(JOBHIVE_KEEP_REGIONS.has('US Only'), false);
  assert.equal(JOBHIVE_KEEP_REGIONS.has('UK Only'), false);
});

const noDelay = async () => {};
function dbFor(handler) { return { from: () => ({ upsert: handler }) }; }

test('partial malformed batch reports each failed row accurately', async () => {
  const good = { title: 'Good', apply_url: 'https://jobs.example/good' };
  const bad = { title: 'Bad', apply_url: 'https://jobs.example/bad' };
  const write = createJobhiveWriter(dbFor(async (rows) => ({ error: rows.includes(bad) ? { message: 'invalid input syntax for type numeric' } : null })), { sleep: noDelay });
  assert.deepEqual(await write([good, bad]), { accepted: 1, failedRows: [bad] });
});

test('transient write failures retry then recover', async () => {
  let calls = 0;
  const rows = [{ title: 'Engineer' }];
  const write = createJobhiveWriter(dbFor(async () => ({ error: ++calls < 3 ? { message: 'network unavailable' } : null })), { sleep: noDelay });
  assert.deepEqual(await write(rows), { accepted: 1, failedRows: [] });
  assert.equal(calls, 3);
});

test('exhausted retries retain failed rows', async () => {
  let calls = 0;
  const rows = [{ title: 'Engineer' }];
  const write = createJobhiveWriter(dbFor(async () => { calls++; return { error: { message: 'network unavailable' } }; }), { sleep: noDelay });
  assert.deepEqual(await write(rows), { accepted: 0, failedRows: rows });
  assert.equal(calls, 5);
});

test('normal mode preserves existing records, repair mode is explicit', async () => {
  const modes = [];
  const db = dbFor(async (_rows, options) => { modes.push(options.ignoreDuplicates); return { error: null }; });
  await createJobhiveWriter(db)([{}]);
  await createJobhiveWriter(db, { repairMode: true })([{}]);
  assert.deepEqual(modes, [true, false]);
});

test('dry run never writes', async () => {
  const write = createJobhiveWriter(null, { dryRun: true });
  assert.deepEqual(await write([{}]), { accepted: 1, failedRows: [] });
});


test('missing publication dates are not replaced with ingestion time', () => {
  const row = normalizeJob({ title: 'Virtual Assistant', apply_url: 'https://example.com/unknown' });
  assert.equal(row.posted_at, null);
  assert.ok(Number.isFinite(Date.parse(row.created_at)));
});

test('source publication dates and source creation dates remain usable', () => {
  const raw = { title: 'Virtual Assistant', apply_url: 'https://example.com/dated', posted_at: '2026-10-14', created_at: '2026-09-01' };
  assert.equal(normalizeJob(raw).posted_at, '2026-10-14T00:00:00.000Z');
  assert.equal(normalizeJob({ ...raw, posted_at: null }).posted_at, '2026-09-01T00:00:00.000Z');
  assert.equal(normalizeJob({ ...raw, posted_at: 'invalid', created_at: 'invalid' }).posted_at, null);
});

function worldwideFixture(description, location = 'Worldwide') {
  const raw = {title: 'Software Engineer', company: 'Example', location, description, apply_url: 'https://example.com/job'};
  const tagged = tagJob(normalizeJob(raw, {source: 'jobhive'}));
  return {before: tagged, after: recoverWorldwideJob(tagged, raw)};
}

test('worldwide role survives incidental customer geography without storing a longer description', () => {
  const {before, after} = worldwideFixture('We serve customers in Kenya. Open to applicants worldwide.');
  assert.equal(before.eligibility_region, 'Regional');
  assert.equal(after.eligibility_region, 'Global');
  assert.equal(after.description, before.description);
  assert.equal(checkEligibility(after, 'nigeria').eligible, true);
});

test('worldwide recovery does not admit explicit foreign hiring requirements', () => {
  for (const description of [
    'We serve customers in Kenya. Applicants must be based in Kenya.',
    'We serve customers in Kenya. Candidates must reside in the United States.',
    'We serve customers in Kenya. ' + 'Build useful software. '.repeat(200) + ' Applicants must be based in Kenya.',
  ]) {
    const {before, after} = worldwideFixture(description);
    assert.equal(after, before);
  }
});

test('recovery does not widen generic remote, unknown or country-specific imports', () => {
  for (const location of ['Remote', '', 'Kenya', 'United States', 'Remote, US']) {
    const {before, after} = worldwideFixture('We serve customers in Kenya.', location);
    assert.equal(after, before);
  }
});
