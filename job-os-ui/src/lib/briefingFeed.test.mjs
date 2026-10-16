import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBriefingFeed} from './briefingFeed.mjs';
test('all preferred roles are searched with country and bounded concurrency', async () => {
  let active=0, peak=0;
  const calls=[];
  const result=await loadBriefingFeed({queries:['analytics','people','performance','analytics'],country:'nigeria',search:async args=>{
    calls.push(args);peak=Math.max(peak,++active);
    await new Promise(r=>setTimeout(r,1));active--;
    return {data:[{id:args.q,title:args.q,company:'Example',posted_at:'2026-10-16'}]};
  }});
  assert.deepEqual(calls.map(c=>c.q).sort(),['analytics','people','performance']);
  assert.ok(calls.every(c=>c.country==='nigeria' && c.limit===5));
  assert.equal(peak,2);assert.equal(result.jobs.length,3);
});
test('overlapping results deduplicate and newest postings lead across roles', async () => {
  const result=await loadBriefingFeed({queries:['a','b'],search:async({q})=>({data:q==='a'?[{id:'old',posted_at:'2026-09-01',score:100},{id:'same',posted_at:'2026-10-15'}]:[{id:'same',posted_at:'2026-10-15'},{id:'new',posted_at:'2026-10-16',score:30}]})});
  assert.deepEqual(result.jobs.map(j=>j.id),['new','same','old']);
});
test('partial failure keeps results and exposes missing searches',async()=>{
  const result=await loadBriefingFeed({queries:['ok','bad'],search:async({q})=>{if(q==='bad')throw Error('network');return {data:[{id:1}]};}});
  assert.equal(result.jobs.length,1);assert.deepEqual(result.failed,['bad']);assert.equal(result.allFailed,false);
});
test('complete failure is distinct from a successful empty search',async()=>{
  const failed=await loadBriefingFeed({queries:['a'],search:async()=>{throw Error('network');}});
  const empty=await loadBriefingFeed({queries:['a'],search:async()=>({data:[]})});
  assert.equal(failed.allFailed,true);assert.equal(empty.allFailed,false);assert.deepEqual(empty.failed,[]);
});
