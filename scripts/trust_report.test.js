import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrustReport, isDiscoverable, pendingInference, readJobPages, reportOptions } from './trust_report.js';
import { extractEligibilitySignals, INFER_VERSION } from '../api/roleIntelligence.js';
const now = Date.parse('2026-10-19T12:00:00Z');
const at = '2026-10-19T10:00:00Z';
const neutral = 'Help the team plan work, support colleagues and document processes. '.repeat(5);
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const job = (n, extra={}) => ({ id:id(n), source:'jobhive', ats_source:'bamboohr', title:'Operations Analyst',
  company:'Fixture', location:'Remote', description:neutral, apply_url:`https://fixture.bamboohr.com/careers/${n}`,
  posted_at:'2026-10-18T12:00:00Z', created_at:at, last_seen_at:at, ...extra });
const proof = row => ({ v:4, status:'ok', provider:'employer', identity:'exact', http_status:200,
  evidence_url:row.apply_url, checked_url:`${row.apply_url}/detail`, checked_at:at,
  title:row.title, description:row.description, location:row.location, remote:true,
  signals:extractEligibilitySignals(row) });

test('uncertain remote is pending, decisive eligibility is not', () => {
  assert.equal(pendingInference(job(1),now),true);
  assert.equal(pendingInference(job(1,{location:'Nigeria'}),now),false);
  assert.equal(pendingInference(job(1,{title:'Operations Analyst (US)'}),now),false);
  assert.equal(pendingInference(job(1,{description:'Short'}),now),false);
  const row=job(1);row.elig_signals={...extractEligibilitySignals(row),infer:{v:INFER_VERSION,scope:'unclear'}};
  assert.equal(pendingInference(row,now),false);
});
test('discovery rejects stale, dead, changed/expired and retired rows without deleting their all-row denominators', async () => {
  const rows=[job(1),job(2,{link_status:'dead'}),job(3,{posted_at:'2025-12-31T00:00:00Z'}),
    job(4,{last_seen_at:'2026-01-01T00:00:00Z'}),job(5,{source:'remotive'}),
    job(6,{elig_signals:{source:{application_deadline:'2026-10-18T00:00:00Z'}}})];
  const report=await buildTrustReport(rows,{now});
  const s=report.sources.find(s=>s.source==='jobhive');
  assert.equal(s.rows,5);assert.equal(s.discoverable,1);assert.equal(s.pendingInference,1);
  assert.equal(s.deadLinks,1);assert.equal(s.deadLinkPct,20);
  assert.equal(report.sources.find(s=>s.source==='remotive').discoverable,0);
});
test('independent eligibility and auditable availability numerators do not imply each other', async () => {
  const eligible=job(1,{location:'Nigeria'});
  const verified=job(2);verified.elig_signals={...extractEligibilitySignals(verified),verification:proof(verified)};
  const historical=job(3,{location:'Nigeria'});historical.elig_signals={verification:{...proof(historical),v:3}};
  const r=await buildTrustReport([eligible,verified,historical],{now});const s=r.sources[0];
  assert.equal(s.discoverable,3);assert.equal(s.confidentEligibility,2);assert.equal(s.verifiedAvailability,1);
  assert.equal(s.confidentEligibilityPct,66.67);assert.equal(s.verifiedAvailabilityPct,33.33);
  assert.equal(s.unknownAvailability,2);assert.equal(s.availabilityNeedsExplanation,true);
  assert.equal(s.platforms.bamboohr.discoverable,3);
});
test('pending counts resolve only with current verdict, audit metadata separately counted', async () => {
  const before=job(1);
  const after={...before,elig_signals:{...extractEligibilitySignals(before),infer:{v:INFER_VERSION,
    scope:'region',regions:['africa'],countries:[],confidence:'medium',evidence:'A fixture scope declaration.',at,model:'fixture-model'}}};
  const b=(await buildTrustReport([before],{now})).sources[0];
  const a=(await buildTrustReport([after],{now})).sources[0];
  assert.equal(b.pendingInference,1);assert.equal(a.pendingInference,0);
  assert.equal(a.currentInference,1);assert.equal(a.auditableInference,1);assert.equal(a.confidentEligibility,1);
  delete after.elig_signals.infer.model;
  assert.equal((await buildTrustReport([after],{now})).sources[0].auditableInference,0);
});
test('unknown after positive check remains unverified and closure stays excluded', async () => {
  const row=job(1);row.elig_signals={verification:{status:'unknown',checked_at:at,last_known:proof(row)}};
  const closed=job(2);closed.elig_signals={verification:{status:'unknown',checked_at:at,last_known:{status:'dead',checked_at:at}}};
  const report=await buildTrustReport([row,closed],{now});
  assert.equal(report.sources[0].verifiedAvailability,0);assert.equal(report.sources[0].discoverable,1);
  assert.equal(report.sources[0].deadLinks,1);assert.equal(isDiscoverable(closed,now),false);
});
test('pagination exhausts beyond newest-3000 and makes only GET requests', async () => {
  const rows=Array.from({length:4001},(_,i)=>job(i+1));let calls=0;
  const fetcher=async(url,options)=>{
    calls++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    const u=new URL(url);assert.equal(u.pathname,'/rest/v1/jobs');
    const after=u.searchParams.get('id')?.slice(3);const start=after?rows.findIndex(r=>r.id===after)+1:0;
    return {ok:true,json:async()=>rows.slice(start,start+1000)};
  };
  let count=0;for await(const row of readJobPages({url:'https://example.supabase.co',key:'fixture',pageSize:1000,fetcher}))count++;
  assert.equal(count,4001);assert.equal(calls,5);
});
test('broken read or cursor aborts instead of printing a complete-looking report', async () => {
  for(const fetcher of [async()=>({ok:false,status:403}),async()=>({ok:true,json:async()=>[job(1),job(1)]})]) {
    await assert.rejects(async()=>{for await(const row of readJobPages({url:'https://example.supabase.co',key:'fixture',pageSize:2,fetcher})){};});
  }
  await assert.rejects(async()=>{for await(const row of readJobPages({url:'https://example.supabase.co',key:'',fetcher:()=>{throw Error('must not fetch')}})){};},/Set SUPABASE/);
});
test('zero denominators are null, and historical dates are fixture-only', async () => {
  const r=await buildTrustReport([job(1,{link_status:'dead'})],{now});
  assert.equal(r.sources[0].confidentEligibilityPct,null);assert.equal(r.sources[0].deadLinkPct,100);
  assert.throws(()=>reportOptions(['--at',at]),/fixture-only/);
  assert.throws(()=>reportOptions(['--page-size','2000']),/Invalid/);
  assert.throws(()=>reportOptions(['--country']),/incomplete/);
  assert.equal(reportOptions(['--fixture','fake.json','--at',at,'--json']).json,true);
});
