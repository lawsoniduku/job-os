import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parsePruneOptions, pruneStaleJobs} from './prune_stale.js';

const silent = () => {};
const db = handler => ({rpc: handler, from() {throw new Error('Raw table access must not be used');}});

test('retention defaults to a read-only 180-day preview and one bounded batch', () => {
  assert.deepEqual(parsePruneOptions(), {execute: false, days: 180, batchSize: 500, maxBatches: 1});
  assert.equal(parsePruneOptions(['--execute', '--days', '365', '--batch-size', '20', '--max-batches', '3']).execute, true);
});

test('adversarial retention options reject ambiguity, partial numbers and unsafe limits', () => {
  for (const args of [['--days', '45'], ['--days', '180abc'], ['--days'], ['--days', 'Infinity'], ['--batch-size', '0'], ['--batch-size', '5001'], ['--max-batches', '101'], ['--execute', '--dry-run'], ['--unknown']]) {
    assert.throws(() => parsePruneOptions(args));
  }
});

test('default preview never invokes a mutation and preserves source/sample diagnostics', async () => {
  const calls = [];
  const result = await pruneStaleJobs(db(async (name, params) => {
    calls.push([name, params]);
    return {data: {selected: 253, by_source: {jobhive: 253}, sample: [{title: 'Old role'}]}};
  }), {}, silent);
  assert.deepEqual(calls, [['preview_stale_job_retention', {p_days: 180}]]);
  assert.deepEqual(result, {selected: 253, archivedAndDeleted: 0, batches: 0, dryRun: true});
});

test('execute uses only the atomic archive/prune RPC and honors the batch bound', async () => {
  const calls = [];
  const result = await pruneStaleJobs(db(async (name, params) => {
    calls.push([name, params]);
    return {data: name.startsWith('preview') ? {selected: 2500} : 500};
  }), {execute: true, maxBatches: 2}, silent);
  assert.equal(result.archivedAndDeleted, 1000);
  assert.equal(result.batches, 2);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1], ['archive_prune_stale_jobs', {p_days: 180, p_limit: 500}]);
});

test('short batch stops without a second mutation', async () => {
  let calls = 0;
  const result = await pruneStaleJobs(db(async name => {
    calls++;
    return {data: name.startsWith('preview') ? {selected: 1} : 1};
  }), {execute: true, maxBatches: 5}, silent);
  assert.equal(calls, 2);
  assert.equal(result.archivedAndDeleted, 1);
});

test('failed or invalid preview stops before any deletion', async () => {
  for (const response of [{error: {message: 'missing migration'}}, {data: null}, {data: {selected: -1}}]) {
    let calls = 0;
    await assert.rejects(pruneStaleJobs(db(async () => {calls++; return response;}), {execute: true}, silent));
    assert.equal(calls, 1);
  }
});

test('an uncertain mutation is not automatically retried or counted as success', async () => {
  for (const failure of [{error: {message: 'timeout'}}, {data: '500'}, {data: 501}]) {
    let mutations = 0;
    await assert.rejects(pruneStaleJobs(db(async name => {
      if (name.startsWith('preview')) return {data: {selected: 2000}};
      mutations++;
      return failure;
    }), {execute: true, maxBatches: 5}, silent));
    assert.equal(mutations, 1);
  }
});

test('migration static contracts require atomic archive, safe policy, least privilege and explicit cron installation', async () => {
  const sql = await readFile(new URL('../supabase/migrations/018_archive_prune.sql', import.meta.url), 'utf8');
  assert.match(sql, /create trigger archive_job_before_delete before delete on public\.jobs/i);
  assert.match(sql, /to_jsonb\(old\), refs/i);
  assert.match(sql, /p_days integer default 180/i);
  assert.match(sql, /limit p_limit for update of j skip locked/i);
  const policy = /and coalesce\(j\.posted_at, j\.created_at\) < now\(\) - make_interval\(days => p_days\)[\s\S]*?and not exists \(select 1 from public\.saved_jobs s where s\.job_id = j\.id\)/g;
  const matches = [...sql.matchAll(policy)].map(m => m[0]);
  assert.equal(matches.length, 2, 'preview and mutation must use the same protected retention policy');
  assert.equal(matches[0], matches[1]);
  assert.match(matches[0], /retention_has_recent_open_evidence/);
  assert.match(matches[0], /source is distinct from 'employer'/);
  assert.match(matches[0], /public\.job_postings/);
  assert.match(sql, /perform public\.assert_job_retention_ready\(\)/);
  assert.match(sql, /alter table public\.jobs_archive enable row level security/i);
  assert.match(sql, /revoke all on function public\.archive_prune_stale_jobs\(integer, integer\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.archive_prune_stale_jobs\(integer, integer\) to service_role/i);
  assert.match(sql, /actual_inventory is distinct from p_reviewed_inventory/);
  assert.match(sql, /old_command is distinct from p_expected_command/);
  assert.match(sql, /select public\.archive_prune_stale_jobs\(180, 500\);/);
  assert.doesNotMatch(sql, /select public\.install_job_retention_cron\(/i, 'migration must not activate cron');
});

test('FK migration static contracts audit actual orphans and validate SET NULL without deleting history', async () => {
  const sql = await readFile(new URL('../supabase/migrations/019_application_job_fk.sql', import.meta.url), 'utf8');
  assert.match(sql, /insert into public\.application_job_reference_repairs[\s\S]*?not exists \(select 1 from public\.jobs j where j\.id = a\.job_id\)/i);
  assert.match(sql, /update public\.applications a set job_id = null[\s\S]*?not exists/i);
  assert.match(sql, /foreign key \(job_id\) references public\.jobs\(id\) on delete set null not valid/i);
  assert.match(sql, /validate constraint applications_job_id_fkey/i);
  assert.match(sql, /Unexpected application job FK/);
  assert.match(sql, /c\.confkey is distinct from array/);
  assert.doesNotMatch(sql, /delete from public\.(applications|saved_jobs)/i);
  assert.doesNotMatch(sql, /limit 253|where.*253/i);
});
