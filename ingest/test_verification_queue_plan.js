import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHiringDb} from './test_support/hiringDb.js';
import {VERIFICATION_VERSION} from '../api/postingVerification.js';
import {verificationQuery} from './core/verificationQueue.js';
test('verification uses a source-scoped complete ordering index without changing due rows',async()=>{
 const db=await createHiringDb();
 try {
  await db.exec(`create index old_timestamp_only on jobs(link_checked_at nulls first);
   insert into jobs(id,source,title,posted_at,last_seen_at,link_checked_at,elig_signals)
    select md5(i::text)::uuid,case when i%4=0 then 'myjobmag' else 'jobhive' end,'Synthetic job',
     case when i%11=0 then now()-interval '400 days' else now()-interval '2 days' end,
     now(),case when i%3=0 then now()-interval '2 days' else null end,
     jsonb_build_object('verification',jsonb_build_object('v',${VERIFICATION_VERSION},'retryable',case when i%5=0 then false else true end),'source',jsonb_build_object('note',repeat('fixture ',200)))
    from generate_series(1,5000) i;
   analyze jobs;`);
  const sql=`select id,elig_signals from jobs where source='jobhive'
   and (posted_at is null or posted_at>=now()-interval '180 days')
   and (link_checked_at is null or link_checked_at<now()-interval '1 day' or elig_signals->'verification'->>'v' is null or elig_signals->'verification'->>'v'<>'${VERIFICATION_VERSION}')
   and (elig_signals->'verification'->>'retryable' is null or elig_signals->'verification'->>'retryable'<>'false' or elig_signals->'verification'->>'v' is null or elig_signals->'verification'->>'v'<>'${VERIFICATION_VERSION}')
   order by link_checked_at nulls first,id limit 500`;
  const before=(await db.query(sql)).rows.map(r=>r.id);
  await db.exec(await readFile(new URL('../supabase/migrations/20261022233955_verification_queue_indexes.sql',import.meta.url),'utf8'));
  const after=(await db.query(sql)).rows.map(r=>r.id);assert.deepEqual(after,before);assert.equal(after.length,500);
  await db.exec('set enable_seqscan=off;set enable_bitmapscan=off;');
  const plan=(await db.query('explain(format json) '+sql)).rows[0]['QUERY PLAN'][0].Plan;
  const nodes=[];function walk(p){nodes.push(p);for(const child of p.Plans || [])walk(child);}walk(plan);
  assert.ok(nodes.some(p=>p['Index Name']==='jobs_verification_source_order_idx'));
  assert.ok(nodes.every(p=>!p['Node Type'].includes('Sort')),'the first 500 rows no longer require sorting the entire unchecked group');
  const calls=[],q={};for(const method of ['select','in','or','eq','order','limit'])q[method]=(...args)=>{calls.push([method,...args]);return q;};
  verificationQuery({from:()=>q},{source:'jobhive'});
  assert.deepEqual(calls.filter(c=>c[0]==='order').map(c=>c[1]),['link_checked_at','id']);
  assert.ok(calls.some(c=>c[0]==='or'&&c[1].includes(`verification->>v.neq.${VERIFICATION_VERSION}`)));
 }finally{await db.close();}
});
