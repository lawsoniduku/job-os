import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobhiveRefreshWriter } from './core/jobhiveRefreshWriter.js';
import { sourceObservation, rowToRaw, createRejectionLedger } from './core/jobhive.js';
import { loadJobhiveObservationIndex, persistRejectedJobhiveObservations } from './core/jobhiveObservations.js';
const now = Date.parse('2026-10-18T12:00:00Z');
const observation = values => sourceObservation(rowToRaw(values), now);

test('supplied upstream collection and deadline dates are authoritative', () => {
  assert.equal(observation({ fetched_at: '2026-09-01' }).rejection, 'upstream_stale');
  assert.equal(observation({ application_deadline: '2026-10-17' }).rejection, 'deadline_expired');
  assert.equal(observation({ application_deadline: '2026-10-18' }).rejection, null);
  assert.equal(observation({ fetched_at: '2026-10-20' }).rejection, 'upstream_future');
  assert.equal(observation({ fetched_at: '2026-10-18 08:00:00' }).source.fetched_at, '2026-10-18T08:00:00.000Z');
});

test('missing and malformed upstream dates stay unknown', () => {
  for (const value of ['', 'unknown', '2026-02-30', '01/02/26', '42']) {
    const result = observation({ fetched_at: value, application_deadline: value });
    assert.equal(result.rejection, null);
    assert.equal(result.source.fetched_at, null);
    assert.equal(result.source.application_deadline, null);
  }
});

test('source hash notices changed full description including its tail', () => {
  const description = 'Build things. '.repeat(500);
  assert.notEqual(observation({ description }).source.hash, observation({ description: description + 'Must reside in Kenya.' }).source.hash);
});

test('rejection ledger caps samples while retaining complete reason counts', () => {
  const ledger = createRejectionLedger(2);
  for (let i = 0; i < 20; i++) ledger.record('region', { title: `Role ${i}` });
  assert.equal(ledger.counts.region, 20);
  assert.equal(ledger.samples.region.length, 2);
});

const clone = value => structuredClone(value);
function fakeDb(initial = [], { onUpdate, failWrites = false, onInsert } = {}) {
  const rows = new Map(initial.map(row => [row.apply_url, clone(row)]));
  let writes = 0;
  return { rows, get writes() { return writes; }, from() {
    let filters = [], patch, batch;
    const q = {
      eq(key, value) { filters.push([key, value]); return q; },
      is(key, value) { filters.push([key, value]); return q; },
      filter(key, operator, value) { assert.equal(operator, 'eq'); filters.push([key, value]); return q; },
      update(value) { patch = value; return q; },
      upsert(value) { batch = value; return q; },
      async maybeSingle() {
        const row = [...rows.values()].find(row => filters.every(([key, value]) => row[key] === value));
        return { data: row ? clone(row) : null, error: null };
      },
      select() {
        if (!patch && !batch) return q;
        writes++;
        if (failWrites) return Promise.resolve({ error: { message: 'network failed' } });
        if (batch) {
          onInsert?.(rows, batch[0]);
          if (rows.has(batch[0].apply_url)) return Promise.resolve({ data: [], error: null });
          const row = { ...clone(batch[0]), id: `new-${rows.size}` };
          rows.set(row.apply_url, row);
          return Promise.resolve({ data: [{ id: row.id }], error: null });
        }
        onUpdate?.(rows);
        const row = [...rows.values()].find(row => filters.every(([key, value]) => key === 'elig_signals' && value !== null ? JSON.stringify(row[key]) === value : (row[key] ?? null) === value));
        if (!row) return Promise.resolve({ data: [], error: null });
        Object.assign(row, clone(patch));
        return Promise.resolve({ data: [{ id: row.id }], error: null });
      },
    };
    return q;
  } };
}
const role = { title: 'Engineer', location: 'Remote', description: 'Work worldwide', country_iso: null, eligibility_region: 'Global', apply_url: 'https://example.com/1', source: 'jobhive', ats_source: 'recruitee', created_at: '2026-01-01', last_seen_at: '2026-10-18', elig_signals: { v: 3, worldwideDesc: true, source: { fetched_at: null } } };
const writer = (db, options) => createJobhiveRefreshWriter(db, { sleep: async () => {}, ...options });

test('counts real inserts and refreshes without replacing row identity or user links', async () => {
  const db = fakeDb();
  assert.equal((await writer(db)([role])).inserted, 1);
  const id = db.rows.get(role.apply_url).id;
  const result = await writer(db)([{ ...role, title: 'Senior Engineer', created_at: '2026-10-18' }]);
  assert.equal(result.updated, 1);
  assert.equal(result.inserted, 0);
  assert.equal(db.rows.get(role.apply_url).id, id);
  assert.equal(db.rows.get(role.apply_url).created_at, '2026-01-01');
});

test('native, employer and different-ATS owners are collisions and never touched', async () => {
  for (const owner of [{ source: 'greenhouse' }, { source: 'employer' }, { ats_source: 'icims' }]) {
    const existing = { ...role, id: 'protected', ...owner };
    const db = fakeDb([existing]);
    const result = await writer(db)([role]);
    assert.equal(result.collisions, 1);
    assert.equal(db.writes, 0);
    assert.deepEqual(db.rows.get(role.apply_url), existing);
  }
});

test('changed source invalidates inference but preserves employer verification', async () => {
  const verification = { status: 'live', checked_at: '2026-10-18' };
  const existing = { ...role, id: 'old', elig_signals: { ...role.elig_signals, infer: { country: 'nigeria' }, verification } };
  const db = fakeDb([existing]);
  await writer(db)([{ ...role, description: 'Changed applicant requirements' }]);
  const saved = db.rows.get(role.apply_url);
  assert.deepEqual(saved.elig_signals.verification, verification);
  assert.equal(saved.elig_signals.infer, undefined);
});

test('unchanged source keeps existing inference', async () => {
  const infer = { country: 'nigeria' };
  const db = fakeDb([{ ...role, id: 'old', elig_signals: { ...role.elig_signals, infer } }]);
  await writer(db)([role]);
  assert.deepEqual(db.rows.get(role.apply_url).elig_signals.infer, infer);
});

test('CAS retries merge concurrent verification from the latest snapshot', async () => {
  let raced = false;
  const verification = { status: 'closed', checked_at: '2026-10-18' };
  const db = fakeDb([{ ...role, id: 'old' }], { onUpdate(rows) {
    if (raced) return;
    raced = true;
    rows.get(role.apply_url).elig_signals.verification = verification;
  } });
  const result = await writer(db)([role]);
  assert.equal(result.updated, 1);
  assert.equal(db.writes, 2);
  assert.deepEqual(db.rows.get(role.apply_url).elig_signals.verification, verification);
});

test('concurrent insert collision cannot overwrite a native importer', async () => {
  const db = fakeDb([], { onInsert(rows) { rows.set(role.apply_url, { ...role, id: 'native', source: 'greenhouse' }); } });
  const result = await writer(db)([role]);
  assert.equal(result.inserted, 0);
  assert.equal(result.collisions, 1);
  assert.equal(db.rows.get(role.apply_url).source, 'greenhouse');
});

test('new-row budget spans batches and still permits existing refreshes', async () => {
  const db = fakeDb([{ ...role, id: 'old' }]);
  const write = writer(db, { maxNewRows: 1 });
  assert.equal((await write([{ ...role, apply_url: 'https://example.com/new' }])).inserted, 1);
  const result = await write([{ ...role, title: 'Updated' }, { ...role, apply_url: 'https://example.com/over' }]);
  assert.equal(result.updated, 1);
  assert.equal(result.budgetSkipped, 1);
  assert.equal(db.rows.size, 2);
});

test('payload budget blocks oversized new descriptions while keeping full existing text', async () => {
  const db = fakeDb([{ ...role, id: 'old' }]);
  const result = await writer(db, { maxNewBytes: 100 })([{ ...role, description: 'Full text'.repeat(1000) }, { ...role, apply_url: 'https://example.com/new' }]);
  assert.equal(result.updated, 1);
  assert.equal(result.budgetSkipped, 1);
  assert.equal(db.rows.get(role.apply_url).description.length, 9000);
});

test('failed writes never refresh last seen or count as accepted', async () => {
  const existing = { ...role, id: 'old', last_seen_at: '2026-09-18' };
  const db = fakeDb([existing], { failWrites: true });
  const result = await writer(db)([role]);
  assert.equal(result.accepted, 0);
  assert.equal(result.failedRows.length, 1);
  assert.equal(db.rows.get(role.apply_url).last_seen_at, existing.last_seen_at);
});

test('dry run never accesses the database', async () => {
  assert.equal((await createJobhiveRefreshWriter(null, { dryRun: true })([role])).accepted, 1);
});

test('CAS exhaustion reports a failed refresh instead of stamping freshness', async () => {
  let revision = 0;
  const existing = { ...role, id: 'old', last_seen_at: '2026-09-18' };
  const db = fakeDb([existing], { onUpdate(rows) { rows.get(role.apply_url).elig_signals.revision = ++revision; } });
  const result = await writer(db)([role]);
  assert.equal(result.updated, 0);
  assert.equal(result.failedRows.length, 1);
  assert.equal(db.rows.get(role.apply_url).last_seen_at, existing.last_seen_at);
});

test('incomplete feed observations cannot erase known eligibility requirements or refresh their timestamp', async () => {
  for (const missing of [{ description: '' }, { location: ' ' }, { country_iso: null }]) {
    const existing = { ...role, id: 'old', country_iso: 'NG', posted_at: '2025-10-18', last_seen_at: '2026-09-18', description: 'Candidates must reside in Nigeria.' };
    const db = fakeDb([existing]);
    const result = await writer(db)([{ ...existing, ...missing, last_seen_at: '2026-10-18', elig_signals: { v: 3, worldwideDesc: true } }]);
    assert.equal(result.partialSkipped, 1);
    assert.equal(result.updated, 0);
    assert.equal(db.writes, 0);
    assert.deepEqual(db.rows.get(role.apply_url), existing);
  }
});

test('an otherwise complete refresh preserves a known publication date when feed date is missing', async () => {
  const existing = { ...role, id: 'old', posted_at: '2025-10-18', elig_signals: { ...role.elig_signals, infer: { country: 'nigeria' } } };
  const db = fakeDb([existing]);
  const result = await writer(db)([{ ...role, posted_at: null }]);
  assert.equal(result.updated, 1);
  assert.equal(db.rows.get(role.apply_url).posted_at, '2025-10-18');
  assert.deepEqual(db.rows.get(role.apply_url).elig_signals.infer, existing.elig_signals.infer);
});

test('an older upstream observation cannot overwrite a newer row', async () => {
  const existing = { ...role, id: 'old', description: 'Newer applicant requirements', elig_signals: { ...role.elig_signals, source: { fetched_at: '2026-10-18T10:00:00Z' } } };
  const db = fakeDb([existing]);
  const result = await writer(db)([{ ...role, elig_signals: { ...role.elig_signals, source: { fetched_at: '2026-10-17T10:00:00Z' } } }]);
  assert.equal(result.staleSkipped, 1);
  assert.equal(db.writes, 0);
  assert.deepEqual(db.rows.get(role.apply_url), existing);
});

test('an unknown collection time cannot replace an existing known observation', async () => {
  const existing = { ...role, id: 'old', elig_signals: { ...role.elig_signals, source: { fetched_at: '2026-10-18T10:00:00Z' } } };
  const db = fakeDb([existing]);
  const result = await writer(db)([role]);
  assert.equal(result.partialSkipped, 1);
  assert.equal(db.writes, 0);
  assert.deepEqual(db.rows.get(role.apply_url), existing);
});

test('source changes retain verification with a change timestamp for downstream proof invalidation', async () => {
  for (const fetched_at of ['2026-10-18T10:00:00Z', null]) {
    const verification = { status: 'live', checked_at: '2026-10-17T10:00:00Z' };
    const existing = { ...role, id: 'old', elig_signals: { ...role.elig_signals, verification } };
    const db = fakeDb([existing]);
    const result = await writer(db)([{ ...role, description: 'New restriction', last_seen_at: '2026-10-18T12:00:00Z', elig_signals: { ...role.elig_signals, source: { fetched_at } } }]);
    assert.equal(result.updated, 1);
    assert.equal(db.rows.get(role.apply_url).elig_signals.source.changed_at, fetched_at || '2026-10-18T12:00:00Z');
    assert.deepEqual(db.rows.get(role.apply_url).elig_signals.verification, verification);
  }
});

test('unchanged source does not advance changed_at when merely seen again', async () => {
  const existing = { ...role, id: 'old', elig_signals: { ...role.elig_signals, source: { fetched_at: '2026-10-17T10:00:00Z', changed_at: '2026-10-15T10:00:00Z' } } };
  const db = fakeDb([existing]);
  const result = await writer(db)([{ ...role, elig_signals: { ...role.elig_signals, source: { fetched_at: '2026-10-18T10:00:00Z' } } }]);
  assert.equal(result.updated, 1);
  assert.equal(db.rows.get(role.apply_url).elig_signals.source.changed_at, '2026-10-15T10:00:00Z');
});

test('new insert source change timestamp uses upstream observation or import time', async () => {
  const db = fakeDb();
  await writer(db)([role]);
  assert.equal(db.rows.get(role.apply_url).elig_signals.source.changed_at, role.last_seen_at);
});

test('negative observations update metadata only without inserting or touching freshness', async () => {
  const existing = { ...role, id: 'old', last_seen_at: '2026-10-10', elig_signals: { ...role.elig_signals, infer: { country: 'nigeria' }, verification: { status: 'live' }, source: { hash: 'content-hash', changed_at: '2026-10-01', fetched_at: '2026-10-10T00:00:00Z' } } };
  const db = fakeDb([existing]);
  const source = { fetched_at: '2026-10-18T00:00:00Z', application_deadline: '2026-10-17T23:59:59Z', hash: 'ignored-content-hash' };
  const result = await persistRejectedJobhiveObservations(db, role.ats_source, [{ snapshot: existing, source }], { sleep: async () => {} });
  assert.equal(result.saved, 1);
  const saved = db.rows.get(role.apply_url);
  assert.equal(saved.last_seen_at, existing.last_seen_at);
  assert.equal(saved.description, existing.description);
  assert.equal(saved.elig_signals.source.hash, existing.elig_signals.source.hash);
  assert.equal(saved.elig_signals.source.changed_at, existing.elig_signals.source.changed_at);
  assert.equal(saved.elig_signals.source.application_deadline, source.application_deadline);
  assert.deepEqual(saved.elig_signals.infer, existing.elig_signals.infer);
  assert.deepEqual(saved.elig_signals.verification, existing.elig_signals.verification);
});

test('negative observations cannot override a newer source observation or another owner', async () => {
  for (const owner of [{}, { source: 'employer' }, { ats_source: 'icims' }]) {
    const existing = { ...role, ...owner, id: 'old', elig_signals: { ...role.elig_signals, source: { fetched_at: '2026-10-18T10:00:00Z' } } };
    const db = fakeDb([existing]);
    const result = await persistRejectedJobhiveObservations(db, role.ats_source, [{ snapshot: existing, source: { fetched_at: '2026-09-01T00:00:00Z', application_deadline: '2026-09-01T00:00:00Z' } }], { sleep: async () => {} });
    assert.equal(result.skipped, 1);
    assert.equal(db.writes, 0);
    assert.deepEqual(db.rows.get(role.apply_url), existing);
  }
});

test('negative observation CAS retains concurrent verification', async () => {
  const existing = { ...role, id: 'old' };
  let raced = false;
  const verification = { status: 'dead', checked_at: '2026-10-18' };
  const db = fakeDb([existing], { onUpdate(rows) {
    if (raced) return;
    raced = true;
    rows.get(role.apply_url).elig_signals.verification = verification;
  } });
  const result = await persistRejectedJobhiveObservations(db, role.ats_source, [{ snapshot: existing, source: { fetched_at: '2026-10-18T00:00:00Z', application_deadline: '2026-10-17' } }], { sleep: async () => {} });
  assert.equal(result.saved, 1);
  assert.deepEqual(db.rows.get(role.apply_url).elig_signals.verification, verification);
});

test('observation index keysets only the owned ATS slice with a hard memory cap', async () => {
  const owned = Array.from({ length: 5 }, (_, i) => ({ ...role, id: String(i), apply_url: `https://example.com/${i}` }));
  const rows = [...owned, { ...role, id: 'x', source: 'employer' }, { ...role, id: 'y', ats_source: 'icims' }];
  const db = { from() {
    let filters = [], cursor = null, limit = 1000;
    const q = {
      select(columns) { assert.equal(columns.includes('description'), false); return q; },
      eq(key, value) { filters.push([key, value]); return q; },
      gt(key, value) { assert.equal(key, 'id'); cursor = value; return q; },
      order(key) { assert.equal(key, 'id'); return q; },
      limit(value) { limit = value; return q; },
      then(resolve) { return Promise.resolve({ data: rows.filter(row => filters.every(([key, value]) => row[key] === value) && (!cursor || row.id > cursor)).slice(0, limit), error: null }).then(resolve); },
    };
    return q;
  } };
  const index = await loadJobhiveObservationIndex(db, role.ats_source, { pageSize: 2 });
  assert.equal(index.size, 5);
  assert.equal(index.has('https://example.com/4'), true);
  await assert.rejects(loadJobhiveObservationIndex(db, role.ats_source, { pageSize: 2, maxRows: 3 }), /refusing a partial index/);
});

test('new-row eligibility admission cannot prevent an existing row recording changed restrictions',async()=>{
 const db=fakeDb([{...role,id:'existing'}]);
 const write=createJobhiveRefreshWriter(db,{sleep:async()=>{},admitNew:()=>false});
 const changed={...role,description:'Applicants must reside in the UK.'};
 const result=await write([changed,{...role,apply_url:'https://example.com/new'}]);
 assert.equal(result.updated,1);
 assert.equal(result.ineligibleSkipped,1);
 assert.equal(result.inserted,0);
 assert.equal(db.rows.get(role.apply_url).description,changed.description);
});

test('a changed structured remote flag invalidates inference and older positive evidence',async()=>{
 const existing={...role,id:'remote-change',remote:true,remote_type:'fully_remote',elig_signals:{v:5,infer:{scope:'worldwide'},source:{fetched_at:'2026-10-18T08:00:00Z'},verification:{status:'ok',checked_at:'2026-10-18T09:00:00Z'}}};
 const db=fakeDb([existing]);
 await writer(db)([{...role,remote:false,remote_type:'on_site',last_seen_at:'2026-10-18T11:00:00Z',elig_signals:{v:5,source:{fetched_at:'2026-10-18T10:00:00Z'}}}]);
 const saved=db.rows.get(role.apply_url);
 assert.equal(saved.elig_signals.infer,undefined);
 assert.equal(saved.elig_signals.source.changed_at,'2026-10-18T10:00:00Z');
 assert.equal(saved.elig_signals.verification.status,'ok');
});

test('a later positive observation cannot erase an existing explicit deadline by omitting it',async()=>{
 const deadline='2026-10-18T09:00:00Z';
 const existing={...role,id:'deadline-preserved',elig_signals:{v:5,source:{fetched_at:'2026-10-18T08:00:00Z',application_deadline:deadline}}};
 const db=fakeDb([existing]);
 await writer(db)([{...role,last_seen_at:'2026-10-18T11:00:00Z',elig_signals:{v:5,source:{fetched_at:'2026-10-18T10:00:00Z',application_deadline:null}}}]);
 assert.equal(db.rows.get(role.apply_url).elig_signals.source.application_deadline,deadline);
});
