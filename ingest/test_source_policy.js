import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_JOB_SOURCES, isActiveJobSource } from '../api/sourcePolicy.js';
import { rankCandidates, fetchCandidates } from '../api/searchCandidates.js';
import { parseIntent, extractEligibilitySignals } from '../api/roleIntelligence.js';

const intent = parseIntent('virtual assistant jobs Nigeria');
const base = { title:'Virtual Assistant', company:'Example', location:'Nigeria',
  description:'Administrative support for our team in Nigeria.', posted_at:new Date().toISOString() };
const retired = ['arbeitnow','jobicy','himalayas','weworkremotely','jobspresso','remotive','myjobmag'];
test('search keeps every maintained source and rejects all retired and unknown sources', () => {
  const rows = [...ACTIVE_JOB_SOURCES, ...retired, 'unknown'].map((source, i) => ({...base,
    id:String(i), company:source, source, apply_url:`https://example.com/careers/${i}`}));
  const result = rankCandidates(rows, intent);
  assert.deepEqual(new Set(result.results.map(j=>j.source)), new Set(ACTIVE_JOB_SOURCES));
  assert.equal(result.exclusionReasons.retired_source, retired.length+1);
});
test('retired board URLs cannot bypass policy with a JobHive or employer source label', () => {
  for (const host of ['arbeitnow.com','jobicy.com','himalayas.app','weworkremotely.com','jobspresso.co','remotive.com','myjobmag.com']) {
    for (const source of ['jobhive','employer']) {
      const row = {...base, id:host, source, apply_url:`https://www.${host}/jobs/123`};
      assert.equal(isActiveJobSource(row),false);
      assert.equal(rankCandidates([row],intent).results.length,0);
    }
  }
  assert.equal(isActiveJobSource({...base,source:'jobhive',apply_url:'https://example.recruitee.com/o/assistant'}),true);
});
test('source policy is applied in database retrieval before fetching retired jobs', async () => {
  let requests=0;
  const db={from:()=>{
    let sources;
    const q={select:()=>q,in:(column,values)=>{assert.equal(column,'source');sources=values;return q;},
      or:()=>q,filter:()=>q,gte:()=>q,lt:()=>q,order:()=>q,limit:()=>q,
      then:resolve=>{requests++;assert.deepEqual(sources,ACTIVE_JOB_SOURCES);resolve({data:[],error:null});}};
    return q;
  }};
  assert.deepEqual(await fetchCandidates({db,intent,columns:'id,title,source,apply_url'}),[]);
  assert.ok(requests>0);
});
test('retired rows stay excluded even with persisted positive employer evidence', () => {
  const row={...base,id:'retired',source:'remotive',apply_url:'https://example.com/careers/1'};
  row.elig_signals={...extractEligibilitySignals(row),verification:{v:3,status:'ok',checked_at:new Date().toISOString(),
    title:base.title,location:'Nigeria',remote:true,signals:extractEligibilitySignals(base)}};
  assert.equal(rankCandidates([row],intent).results.length,0);
});
