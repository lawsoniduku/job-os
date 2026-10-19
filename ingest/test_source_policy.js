import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_JOB_SOURCES, isActiveJobSource } from '../api/sourcePolicy.js';
import { rankCandidates, fetchCandidates } from '../api/searchCandidates.js';
import { parseIntent, extractEligibilitySignals } from '../api/roleIntelligence.js';

const intent = parseIntent('virtual assistant jobs Nigeria');
const base = { title:'Virtual Assistant', company:'Example', location:'Nigeria',
  description:'Administrative support for our team in Nigeria.', posted_at:new Date().toISOString() };
const retired = ['arbeitnow','jobicy','himalayas','weworkremotely','jobspresso','remotive'];
test('search keeps every maintained source and rejects all retired and unknown sources', () => {
  const rows = [...ACTIVE_JOB_SOURCES, ...retired, 'unknown'].map((source, i) => ({...base,
    id:String(i), company:source, source, apply_url:`https://example.com/careers/${i}`}));
  const result = rankCandidates(rows, intent);
  assert.deepEqual(new Set(result.results.map(j=>j.source)), new Set(ACTIVE_JOB_SOURCES));
  assert.equal(result.exclusionReasons.retired_source, retired.length+1);
});
test('retired board URLs cannot bypass policy with a JobHive or employer source label', () => {
  for (const host of ['arbeitnow.com','jobicy.com','himalayas.app','weworkremotely.com','jobspresso.co','remotive.com']) {
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

// Fixture-only connector checks: these never contact MyJobMag or the database.
import { fetchMyJobMag } from './connectors/feeds/myjobmag.js';
import { readFileSync } from 'node:fs';
const rssItem = ({ title='Virtual Assistant at Example', description='Fully remote administrative support.',
  location='Lagos', date='2026-10-18T12:00:00Z', url='https://www.myjobmag.com/job/assistant' }={}) =>
  `<item><title><![CDATA[${title}]]></title><link>${url}</link><description><![CDATA[${description}]]></description><location>${location}</location><pubDate>${date}</pubDate></item>`;

test('MyJobMag remains discoverable and the pipeline fetcher names stay aligned', () => {
  assert.equal(isActiveJobSource({...base,source:'myjobmag',apply_url:'https://www.myjobmag.com/job/assistant'}),true);
  assert.equal(isActiveJobSource({...base,source:'jobhive',apply_url:'https://www.myjobmag.com/job/assistant'}),true);
  const pipeline=readFileSync(new URL('./pipeline.js',import.meta.url),'utf8');
  const fetchers=[...pipeline.match(/const settled = await Promise\.allSettled\(\[([\s\S]*?)\n  \]\)/)[1].matchAll(/fetch(\w+)\(/g)].map(m=>m[1].toLowerCase());
  const names=JSON.parse(pipeline.match(/const sourceNames = (\[[^\]]+\])/)[1]);
  assert.deepEqual(fetchers,names);
  assert.ok(names.includes('myjobmag'));
  for(const source of retired) assert.ok(!names.includes(source));
});

test('MyJobMag normalizes a Nigeria RSS fixture without turning field work into remote work', async () => {
  let calls=0;
  const jobs=await fetchMyJobMag({httpGet:async(url,options)=>{
    calls++;
    assert.equal(url,'https://www.myjobmag.com/aggregate_feed.xml');
    assert.equal(options.timeout,20000);
    assert.equal(options.maxContentLength,5*1024*1024);
    return {data:`<rss><channel>${rssItem()}${rssItem({title:'Field Assistant at Charity',description:'Work in remote communities.',date:'not-a-date'})}</channel></rss>`};
  }});
  assert.equal(calls,1);
  assert.equal(jobs.length,2);
  assert.equal(jobs[0].source,'myjobmag');
  assert.equal(jobs[0].ats_source,'myjobmag');
  assert.equal(jobs[0].company,'Example');
  assert.equal(jobs[0].title,'Virtual Assistant');
  assert.equal(jobs[0].location,'Lagos, Nigeria');
  assert.equal(jobs[0].posted_at,'2026-10-18T12:00:00.000Z');
  assert.equal(jobs[0].remote,true);
  assert.equal(jobs[1].remote,false);
  assert.equal(jobs[1].posted_at,null);
});

test('MyJobMag falls back across historical endpoints and accepts custom job XML', async () => {
  let calls=0;
  const jobs=await fetchMyJobMag({httpGet:async()=>{
    calls++;
    if(calls===1) throw new Error('fixture timeout');
    if(calls===2) return {data:'<html>not a feed</html>'};
    return {data:`<jobs>${rssItem({description:'On-site role, despite remote work tools.'}).replaceAll('<item>','<job>').replaceAll('</item>','</job>')}</jobs>`};
  }});
  assert.equal(calls,3);
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].remote,false);
});

test('MyJobMag refuses oversized responses and returns no fabricated rows when every feed fails', async () => {
  let calls=0;
  const jobs=await fetchMyJobMag({httpGet:async()=>{
    calls++;
    if(calls===1) return {data:rssItem()+' '.repeat(5*1024*1024)};
    if(calls===2) return {data:'<jobs><job><title>Missing posting URL</title></job></jobs>'};
    throw new Error('fixture unavailable');
  }});
  assert.equal(calls,3);
  assert.deepEqual(jobs,[]);
});
