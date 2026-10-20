import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeRefreshWriter } from './core/nativeRefreshWriter.js';
import { tagJob } from './core/tag.js';
import { hasRecentOpenEvidence } from '../api/jobFreshness.js';
const now='2026-10-19T20:00:00.000Z';
const role={title:'People Analyst',company:'Example',location:'Remote',description:'We hire worldwide. '+ 'Analyse people data. '.repeat(20),source:'lever',ats_source:'lever',apply_url:'https://jobs.lever.co/example/123',posted_at:'2026-09-01T00:00:00Z',created_at:'2026-09-01T00:00:00Z',remote:true};
const clone=structuredClone;
const canonicalRole={...role,title:'Graduate Customer Success Manager',company:'Canonical',source:'greenhouse',ats_source:'greenhouse',apply_url:'https://job-boards.greenhouse.io/canonical/jobs/6103331',location:'Home based - Worldwide'};
function fakeDb(initial=[],{onUpdate,onInsert,failReads=false,failWrites=false}={}) {
 const rows=new Map(initial.map(row=>[row.apply_url,clone(row)])); let reads=0,writes=0;
 return {rows,get reads(){return reads;},get writes(){return writes;},from(){let filters=[],patch,batch,projection;
 const matches=row=>filters.every(([key,value,op])=>op==='in'?value.includes(row[key]):key==='elig_signals'&&value!==null?JSON.stringify(row[key])===value:(row[key]??null)===value);
 const execute=async()=>{if(!patch&&!batch){reads++;return{data:failReads?null:[...rows.values()].filter(matches).map(row=>projection?Object.fromEntries(projection.split(',').map(key=>[key,clone(row[key])])):clone(row)),error:failReads?{message:'network'}:null};}writes++;if(failWrites)return{error:{message:'write failed'}};
 if(batch){onInsert?.(rows,batch);const data=[];for(const item of batch){if(rows.has(item.apply_url))continue;const row={...clone(item),id:'new-'+rows.size};rows.set(row.apply_url,row);data.push({id:row.id,apply_url:row.apply_url});}return{data,error:null};}
 onUpdate?.(rows,patch);const row=[...rows.values()].find(matches);if(!row)return{data:[],error:null};Object.assign(row,clone(patch));return{data:[{id:row.id}],error:null};};
 const q={select(value){projection=value;return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},in(k,v){filters.push([k,v,'in']);return q;},update(p){patch=p;return q;},upsert(b){batch=b;return q;},async maybeSingle(){const r=await execute();return{...r,data:r.data?.[0]||null};},then(a,b){return execute().then(a,b);}};return q;}};
}
const write=(db,opts={})=>createNativeRefreshWriter(db,{now:()=>now,sleep:async()=>{},...opts});
const stored=(patch={})=>({...tagJob(role),id:'existing',last_seen_at:'2026-10-18T00:00:00Z',...patch});
test('refreshes owned full text and flags, invalidates inference, retains independent proof but makes it stale',async()=>{
 const verification={v:4,status:'ok',checked_at:'2026-10-19T19:00:00Z'};
 const existing=stored();existing.elig_signals={...existing.elig_signals,infer:{scope:'worldwide'},verification};
 const db=fakeDb([existing]);const description='Candidates must reside in the United States. '+ 'New duties. '.repeat(500);
 const result=await write(db)([{...role,description,title:'Senior People Analyst',company:'Example Inc',location:'Remote, US',country_iso:'US',remote:true}]);const saved=db.rows.get(role.apply_url);
 assert.equal(result.updated,1);assert.equal(saved.description,description);assert.equal(saved.company,'Example Inc');assert.equal(saved.id,existing.id);assert.equal(saved.created_at,existing.created_at);assert.equal(saved.elig_signals.infer,undefined);assert.deepEqual(saved.elig_signals.verification,verification);assert.equal(saved.elig_signals.source.changed_at,now);assert.equal(saved.eligibility_region,'US');assert.equal(hasRecentOpenEvidence(saved,Date.parse(now)),false);
});
test('unchanged source retains inference and change time while observation time advances',async()=>{
 const existing=stored();existing.elig_signals={...existing.elig_signals,infer:{scope:'worldwide'},source:{changed_at:'2026-10-01T00:00:00Z',fetched_at:'2026-10-18T00:00:00Z'}};
 const db=fakeDb([existing]);await write(db)([role]);const saved=db.rows.get(role.apply_url);assert.deepEqual(saved.elig_signals.infer,existing.elig_signals.infer);assert.equal(saved.elig_signals.source.changed_at,existing.elig_signals.source.changed_at);assert.equal(saved.elig_signals.source.fetched_at,now);
});
test('batch lookup and insert avoid per-row reads for new jobs',async()=>{
 const db=fakeDb();const rows=Array.from({length:30},(_,i)=>({...role,apply_url:role.apply_url+i}));const result=await write(db)(rows);assert.equal(result.inserted,30);assert.equal(db.reads,1);assert.equal(db.writes,1);
});
test('different owners and ATS collisions are never touched, including freshness',async()=>{
 for(const owner of [{source:'jobhive'},{source:'employer'},{source:'ashby',ats_source:'ashby'},{ats_source:'other'}]){const existing=stored(owner),db=fakeDb([existing]);const result=await write(db)([role]);assert.equal(result.collisions,1);assert.deepEqual(db.rows.get(role.apply_url),existing);assert.equal(db.writes,0);}
});
test('a concurrent insert collision cannot take ownership',async()=>{
 const db=fakeDb([],{onInsert(rows){rows.set(role.apply_url,stored({source:'employer'}));}});const result=await write(db)([role]);assert.equal(result.collisions,1);assert.equal(result.inserted,0);assert.equal(db.rows.get(role.apply_url).source,'employer');
});
test('concurrent verification survives source refresh and CAS retry',async()=>{
 let raced=false;const proof={v:4,status:'dead',checked_at:now};const db=fakeDb([stored()],{onUpdate(rows){if(raced)return;raced=true;rows.get(role.apply_url).elig_signals.verification=proof;}});const result=await write(db)([{...role,description:role.description+' Applicants must live in Nigeria.'}]);assert.equal(result.updated,1);assert.deepEqual(db.rows.get(role.apply_url).elig_signals.verification,proof);assert.equal(db.writes,2);
});
test('older source collection or revision cannot overwrite newer restrictions',async()=>{
 for(const source of [{fetched_at:'2026-10-20T00:00:00Z'},{fetched_at:'2026-10-18T00:00:00Z',updated_at:'2026-10-19T10:00:00Z'}]){const existing=stored();existing.elig_signals={...existing.elig_signals,source};const db=fakeDb([existing]);const result=await write(db)([{...role,_source_observation:{updated_at:'2026-10-18T10:00:00Z'}}]);assert.equal(result.staleSkipped,1);assert.deepEqual(db.rows.get(role.apply_url),existing);}
});
test('empty or known summary observations cannot erase full restrictions',async()=>{
 for(const row of [{...role,description:''},{...role,description:'People Analyst',_source_observation:{description_complete:false}},{...role,source:'myjobmag',ats_source:'myjobmag',description:'Short summary'}]){const existing=stored({...row,description:role.description+' Applicants must reside in Kenya.'});const db=fakeDb([existing]);const result=await write(db)([row]);assert.equal(result.partialSkipped,1);assert.deepEqual(db.rows.get(role.apply_url),existing);}
});
test('unknown date/location/country cannot erase known values or make old roles new',async()=>{
 const existing=stored({location:'Lagos, Nigeria',country_iso:'NG',posted_at:'2025-01-01T00:00:00Z'});const db=fakeDb([existing]);await write(db)([{...role,location:'',country_iso:null,posted_at:null}]);const saved=db.rows.get(role.apply_url);assert.equal(saved.location,existing.location);assert.equal(saved.country_iso,'NG');assert.equal(saved.posted_at,existing.posted_at);assert.equal(saved.created_at,existing.created_at);assert.equal(saved.elig_signals.source.fetched_at,now);
});
test('missing authoritative publication date is recorded without inventing a replacement',async()=>{
 const existing=stored({source:'greenhouse',ats_source:'greenhouse'});const db=fakeDb([existing]);await write(db)([{...role,source:'greenhouse',ats_source:'greenhouse',posted_at:null,_source_observation:{publication_unknown:true,updated_at:'2026-10-18T00:00:00Z'}}]);const saved=db.rows.get(role.apply_url);assert.equal(saved.posted_at,existing.posted_at);assert.equal(saved.elig_signals.source.publication_unknown,true);
});
test('failed reads/writes never count as accepted or stamp freshness',async()=>{
 for(const options of [{failReads:true},{failWrites:true}]){const existing=stored(),db=fakeDb([existing],options);const result=await write(db)([role]);assert.equal(result.accepted,0);assert.equal(result.failedRows.length,1);assert.deepEqual(db.rows.get(role.apply_url),existing);}
});
test('dry run never contacts database',async()=>{assert.equal((await write(null,{dryRun:true})([role])).accepted,1);});

test('live Canonical board adopts its exact legacy remote_company row without changing its ID',async()=>{
 const existing=stored({...canonicalRole,source:'remote_company',ats_source:null});
 existing.elig_signals.verification={v:5,status:'unknown',reason:'Previous check'};
 const db=fakeDb([existing]);const result=await write(db)([canonicalRole]);
 const saved=db.rows.get(canonicalRole.apply_url);
 assert.equal(result.updated,1);assert.equal(result.inserted,0);assert.equal(saved.id,existing.id);
 assert.equal(saved.source,'greenhouse');assert.equal(saved.ats_source,'greenhouse');
 assert.deepEqual(saved.elig_signals.verification,existing.elig_signals.verification);
});
test('legacy adoption cannot claim other employers, hosts, schemes, source owners or ATS identities',async()=>{
 for(const override of [{source:'employer'},{source:'jobhive'},{company:'Different employer'},
   {ats_source:'lever'},{apply_url:'https://attacker.example/canonical/jobs/6103331'},
   {apply_url:'https://job-boards.greenhouse.io/another/jobs/6103331'},
   {apply_url:'http://job-boards.greenhouse.io/canonical/jobs/6103331'}]){
  const existing=stored({...canonicalRole,source:'remote_company',ats_source:null,...override});
  const incoming={...canonicalRole,apply_url:existing.apply_url};
  const db=fakeDb([existing]);const result=await write(db)([incoming]);
  assert.equal(result.collisions,1);assert.deepEqual(db.rows.get(existing.apply_url),existing);
 }
});
test('legacy adoption retries concurrent evidence and refuses a new employer owner',async()=>{
 let raced=false;const existing=stored({...canonicalRole,source:'remote_company',ats_source:null});
 const db=fakeDb([existing],{onUpdate(rows){if(raced)return;raced=true;rows.get(canonicalRole.apply_url).source='employer';}});
 const result=await write(db)([canonicalRole]);assert.equal(result.updated,0);assert.equal(result.collisions,1);
 assert.equal(db.rows.get(canonicalRole.apply_url).source,'employer');
});

test('collection order and proof invalidation use distinct clocks',async()=>{
 const existing=stored();existing.elig_signals.verification={v:4,status:'ok',checked_at:'2026-10-19T19:30:00Z'};
 const db=fakeDb([existing]);const observedAt='2026-10-19T19:00:00Z';await write(db,{observedAt})([{...role,description:role.description+' Updated role responsibilities.'}]);const saved=db.rows.get(role.apply_url);assert.equal(saved.elig_signals.source.fetched_at,observedAt);assert.equal(saved.last_seen_at,observedAt);assert.equal(saved.elig_signals.source.changed_at,now);assert.equal(hasRecentOpenEvidence(saved,Date.parse(now)),false);
});
test('CAS exhaustion never claims success or stamps last seen',async()=>{
 let revision=0;const existing=stored();const db=fakeDb([existing],{onUpdate(rows){rows.get(role.apply_url).elig_signals.revision=++revision;}});const result=await write(db)([role]);assert.equal(result.accepted,0);assert.equal(result.failedRows.length,1);assert.equal(db.rows.get(role.apply_url).last_seen_at,existing.last_seen_at);
});
test('incoming model and verification annotations cannot seed a source insert',async()=>{
 const db=fakeDb();await write(db)([{...role,elig_signals:{infer:{scope:'worldwide'},verification:{status:'ok'},worldwideDesc:true}}]);const saved=db.rows.get(role.apply_url);assert.equal(saved.elig_signals.infer,undefined);assert.equal(saved.elig_signals.verification,undefined);assert.equal(saved.elig_signals.worldwideDesc,false);
});

test('a malformed new row cannot discard its healthy neighbours',async()=>{
 const bad={...role,title:'Malformed',apply_url:role.apply_url+'bad'};
 const good={...role,apply_url:role.apply_url+'good'};
 const db=fakeDb([],{onInsert(_rows,batch){if(batch.some(row=>row.title==='Malformed'))throw new Error('invalid input syntax for type numeric');}});
 const result=await write(db)([bad,good]);assert.equal(result.accepted,1);assert.equal(result.inserted,1);assert.deepEqual(result.failedRows,[bad]);assert.equal(db.rows.has(good.apply_url),true);assert.equal(db.rows.has(bad.apply_url),false);
});
test('transient insert failure retries without duplicating source records',async()=>{
 let calls=0;const db=fakeDb([],{onInsert(){if(!calls++)throw new Error('temporary network failure');}});const result=await write(db)([role]);assert.equal(result.inserted,1);assert.equal(result.accepted,1);assert.equal(result.failedRows.length,0);assert.equal(db.rows.size,1);assert.equal(db.writes,2);
});
test('connector-only hints are applied but never sent as database columns',async()=>{
 const db=fakeDb();await write(db)([{...role,location:'',description:'Analyse data.',_region_hint:'Nigeria',_source_observation:{updated_at:'2026-10-18T00:00:00Z'}}]);const saved=db.rows.get(role.apply_url);assert.equal(saved.eligibility_region,'Nigeria');assert.equal(saved._region_hint,undefined);assert.equal(saved._source_observation,undefined);assert.equal(saved.elig_signals.source.updated_at,'2026-10-18T00:00:00Z');
});
