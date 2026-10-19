import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPosting,applyVerification,compactVerification,verifyCandidates,nonVacancyReason,redirectedToIndex,parseJobPosting,locationText,retainVerificationEvidence,VERIFICATION_VERSION} from '../api/postingVerification.js';
import {checkEligibility,parseIntent,SIGNALS_VERSION,extractEligibilitySignals} from '../api/roleIntelligence.js';
import {rankCandidates} from '../api/searchCandidates.js';
import {normalizeJob} from './core/normalize.js';
const job={id:'1',source:'jobhive',title:'Administrative Assistant',apply_url:'https://example.bamboohr.com/careers/1',location:'Worldwide',remote:true,description:'Open to candidates worldwide.'};
const bamboo=(extra={})=>({result:{jobOpening:{jobOpeningStatus:'Open',jobOpeningName:job.title,atsLocation:{country:'Nigeria'},description:'Administrative support for the team.',locationType:'1',...extra}}});
const response=(body,status=200,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers});
const ld=j=>`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:job.title,description:'Administrative support for the team.',...j})}</script>`;
test('employer Mexico location overrides cached worldwide metadata and inference',async()=>{
 const v=await verifyPosting(job,{fetcher:async()=>response(bamboo({atsLocation:{country:'Mexico'}}))});
 assert.equal(v.status,'ok');assert.equal(checkEligibility(applyVerification(job,v),'nigeria').eligible,false);
});
test('Nigerian employer vacancy survives compact persistent cache and remote search',async()=>{
 const v=compactVerification(await verifyPosting(job,{fetcher:async()=>response(bamboo())}));
 assert.equal(v.description,undefined);
 const fresh=applyVerification(job,v);
 assert.equal(rankCandidates([fresh],parseIntent('remote virtual assistant jobs Nigeria'),{},Date.now(),true).results.length,1);
});
test('short numeric ID redirect to index is dead, login redirect is not',()=>{
 assert.equal(redirectedToIndex(job.apply_url,'https://example.bamboohr.com/careers'),true);
 assert.equal(redirectedToIndex(job.apply_url,'https://example.bamboohr.com/login'),false);
});
test('removed, blocked and unavailable sources have distinct outcomes',async()=>{
 for(const [status,want] of [[404,'dead'],[410,'dead'],[403,'unknown'],[429,'unknown'],[500,'unknown']])assert.equal((await verifyPosting(job,{fetcher:async()=>response('',status)})).status,want);
});
test('closed Bamboo vacancy never passes merely because HTTP is 200',async()=>{
 assert.equal((await verifyPosting(job,{fetcher:async()=>response(bamboo({jobOpeningStatus:'Closed'}))})).status,'dead');
});
test('internal vacancies and talent pools are not current external openings',()=>{
 assert.ok(nonVacancyReason({title:'Administrator - Internal Vacancy Only'}));
 assert.ok(nonVacancyReason({title:'EA - Sourcing',description:'EA Talent pool for Contact Energy/DIA/FB'}));
 assert.equal(nonVacancyReason({title:'Talent Acquisition Specialist',description:'Build a talent pool while filling current vacancies.'}),null);
});
test('unknown availability does not suppress roles or imply country eligibility',()=>{
 const intent=parseIntent('remote virtual assistant Nigeria');
 assert.equal(rankCandidates([{...job,verification:{status:'unknown'}}],intent,{},Date.now(),true).results.length,1);
 assert.equal(rankCandidates([{...job,location:'Remote',description:'Support the team.',verification:{status:'ok'}}],intent,{},Date.now(),true).results[0].eligibility.confidence,'possible');
});
test('untrusted hosts and redirects are not fetched',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;return response('',302,{location:'http://127.0.0.1/private'});};
 assert.equal((await verifyPosting({...job,apply_url:'http://127.0.0.1/'},{fetcher})).status,'unknown');assert.equal(calls,0);
 assert.equal((await verifyPosting(job,{fetcher})).status,'unknown');assert.equal(calls,1);
});
test('no JSON-LD or mismatched title is unknown, not a live vacancy',async()=>{
 const j={...job,apply_url:'https://jobs.ashbyhq.com/example/abc'};
 for(const html of ['<h1>Current openings</h1>',ld({title:'Software Engineer'})])assert.equal((await verifyPosting(j,{fetcher:async()=>response(html)})).status,'unknown');
});
test('expired structured posting is dead',async()=>{
 assert.equal((await verifyPosting({...job,apply_url:'https://jobs.ashbyhq.com/example/abc'},{fetcher:async()=>response(ld({validThrough:'2001-01-01'}))})).status,'dead');
});
test('direct structured posting uses applicant location instead of headquarters address',async()=>{
 const v=await verifyPosting({...job,apply_url:'https://jobs.ashbyhq.com/example/abc'},{fetcher:async()=>response(ld({applicantLocationRequirements:[{'@type':'Country',name:'US'}],hiringOrganization:{address:'Nigeria'},jobLocationType:'TELECOMMUTE'}))});
 assert.equal(v.provider,'employer');assert.equal(v.location,'United States'); assert.equal(checkEligibility(applyVerification(job,v),'nigeria').eligible,false);
});
test('remote alone does not upgrade model worldwide inference',()=>{
 const j={...job,location:'Remote',description:undefined,elig_signals:{v:3,infer:{v:2,scope:'worldwide',confidence:'high',evidence:'Location field: Remote'}}};
 assert.equal(checkEligibility(j,'nigeria').confidence,'possible');
});
test('Ashby EMEA alternative survives UK mention in same location requirement',async()=>{
 const j={...job,title:'GEOINT Analyst, Scams',apply_url:'https://jobs.ashbyhq.com/trm-labs/abc/application'};
 const v=await verifyPosting(j,{fetcher:async()=>response(ld({title:j.title,jobLocation:[{address:{addressCountry:'GB'}},{address:{addressCountry:'US'}}],jobLocationType:'TELECOMMUTE',description:'Location: remote in the UK, EMEA, or US. You must already have the right to work where you are based.'}))});
 assert.equal(v.status,'ok');assert.equal(checkEligibility(applyVerification(j,v),'nigeria').eligible,true);
});
test('Workable retains country and requirements beyond first description block',async()=>{
 const j={...job,apply_url:'https://apply.workable.com/kuda/j/ABC/apply'};
 const v=await verifyPosting(j,{fetcher:async url=>response(url.includes('/api/')?{title:j.title,state:'published',remote:true,location:{city:'Cape Town',country:'South Africa'},description:'Role.',requirements:'Local work rights required.'}:'<html/>')});
 assert.equal(v.location,'Cape Town, South Africa');assert.match(v.description,/Local work rights/);assert.equal(checkEligibility(applyVerification(j,v),'nigeria').eligible,false);
});
test('full description preserves late eligibility restriction',()=>{
 const d='Job responsibilities. '.repeat(300)+'Applicants must be based in the United States.';
 assert.equal(normalizeJob({...job,description:d}).description,d);
 assert.equal(checkEligibility(normalizeJob({...job,description:d}),'nigeria').eligible,false);
});
test('onsite title cannot pass a remote search with an erroneous true flag',()=>{
 const j={...job,title:'Executive Assistant (Onsite, Lagos)',location:'Nigeria',verification:{status:'ok'}};
 assert.equal(rankCandidates([j],parseIntent('remote virtual assistant Nigeria'),{},Date.now(),true).results.length,0);
});
test('zero verification budget leaves records pending rather than verified',async()=>{
 const rows=await verifyCandidates([{...job,apply_url:'https://test.bamboohr.com/careers/555'}],{budgetMs:0});
 assert.equal(rows[0].verification.status,'pending');
});
test('search deadline bounds a non-cooperative verifier without dropping rows or known restrictions',async()=>{
 const known=compactVerification({v:VERIFICATION_VERSION,status:'ok',checked_at:'2000-01-01T00:00:00Z',title:job.title,description:'Applicants must be based in the United States.',location:'Remote',remote:true});
 const input=[
  {...job,id:'deadline-restricted',apply_url:'https://example.bamboohr.com/careers/771',elig_signals:{verification:known}},
  {...job,id:'deadline-closed',apply_url:'https://example.bamboohr.com/careers/772',elig_signals:{verification:{v:VERIFICATION_VERSION,status:'dead',checked_at:'2000-01-01T00:00:00Z',reason:'Posting removed'}}},
  {...job,id:'deadline-pending',apply_url:'https://example.bamboohr.com/careers/773'},
 ];
 const signals=[];let lateReject;
 const started=Date.now();
 const rows=await verifyCandidates(input,{budgetMs:40,concurrency:2,persist:false,verify:(_job,{signal})=>{
  signals.push(signal);return new Promise((_resolve,reject)=>{lateReject=reject;});
 }});
 assert.ok(Date.now()-started<1000,'deadline must not wait for an uncooperative ATS');
 assert.deepEqual(rows.map(row=>row.id),input.map(row=>row.id));assert.ok(signals.every(signal=>signal.aborted));
 assert.equal(rows[0].verification.status,'pending');assert.equal(checkEligibility(rows[0],'nigeria').eligible,false);
 assert.equal(rows[1].verification.status,'dead');assert.equal(rows[2].verification.status,'pending');
 lateReject(new Error('late ATS failure'));await new Promise(resolve=>setImmediate(resolve));
});
test('search persist:false never reads or writes database and retains all quick observations',async()=>{
 let dbCalls=0;
 const db={from(){dbCalls++;throw new Error('Search must not wait for database persistence');}};
 const input=Array.from({length:3},(_,i)=>({...job,id:`memory-${i}`,apply_url:`https://example.bamboohr.com/careers/${780+i}`}));
 const rows=await verifyCandidates(input,{db,persist:false,budgetMs:500,verify:async row=>({...row,v:VERIFICATION_VERSION,status:'ok',checked_at:new Date().toISOString(),provider:'employer'})});
 assert.equal(dbCalls,0);assert.equal(rows.length,input.length);assert.ok(rows.every(row=>row.verification.status==='ok'));
});
test('verification deadline also bounds a stalled durable persistence read',async()=>{
 let reads=0;
 const db={from:()=>({select:()=>({eq:()=>({maybeSingle:()=>{reads++;return new Promise(()=>{});}})})})};
 const started=Date.now();
 const rows=await verifyCandidates([{...job,id:'slow-write',apply_url:'https://example.bamboohr.com/careers/790'}],{db,budgetMs:40,verify:async row=>({...row,v:VERIFICATION_VERSION,status:'ok',checked_at:new Date().toISOString(),provider:'employer'})});
 assert.equal(reads,1);assert.ok(Date.now()-started<1000);assert.equal(rows.length,1);assert.equal(rows[0].verification.status,'ok');
});
test('rejected verifier becomes unknown while preserving conclusive restrictions',async()=>{
 const known=compactVerification({v:VERIFICATION_VERSION,status:'ok',checked_at:'2000-01-01T00:00:00Z',title:job.title,description:'US applicants only.',location:'Remote US',remote:true});
 const rows=await verifyCandidates([{...job,apply_url:'https://example.bamboohr.com/careers/791',elig_signals:{verification:known}}],{budgetMs:500,persist:false,verify:async()=>{throw new Error('network');}});
 assert.equal(rows[0].verification.status,'unknown');assert.equal(checkEligibility(rows[0],'nigeria').eligible,false);
});
test('verifyPosting forwards caller cancellation to its outbound request',async()=>{
 const ctrl=new AbortController();let requested;
 const checked=verifyPosting(job,{signal:ctrl.signal,fetcher:async(_url,{signal})=>{
  requested=signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
 }});
 ctrl.abort();const v=await checked;
 assert.equal(requested.aborted,true);assert.equal(v.status,'unknown');
});
test('schema parser handles graph arrays and invalid literal newline strings',()=>{
 assert.equal(parseJobPosting('<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"one\ntwo"}]}</script>')[0].title,'one\ntwo');
 assert.equal(locationText({name:'NG'}),'Nigeria');
});
test('Greenhouse employer board preserves a current worldwide vacancy',async()=>{
 const row={...job,apply_url:'https://job-boards.greenhouse.io/example/jobs/1234'};
 const v=await verifyPosting(row,{fetcher:async url=>{
   assert.equal(url,'https://boards-api.greenhouse.io/v1/boards/example/jobs/1234');
   return response({id:1234,title:row.title,location:{name:'Homebased - Worldwide'},content:'We are hiring administrative assistants. Open to candidates worldwide.'});
 }});
 assert.equal(v.provider,'employer');
 assert.equal(rankCandidates([applyVerification(row,compactVerification(v))],parseIntent('remote virtual assistant Nigeria'),{},Date.now(),true).results.length,1);
});
test('Lever reads the complete requirements and structured country',async()=>{
 const row={...job,apply_url:'https://jobs.lever.co/example/abcd-1234/apply'};
 const v=await verifyPosting(row,{fetcher:async()=>response({id:'abcd-1234',text:row.title,categories:{location:'Mexico'},workplaceType:'remote',description:'Support the team.',lists:[{content:'Must be based in Mexico.'}]})});
 assert.equal(v.status,'ok');assert.equal(checkEligibility(applyVerification(row,v),'nigeria').eligible,false);
});

test('failed rechecks preserve US restrictions across repeated failures and restart', () => {
 const known=compactVerification({v:1,status:'ok',checked_at:'2026-10-15T10:00:00Z',title:job.title,description:'US applicants only.',location:'Remote US',remote:true});
 const unknown={v:1,status:'unknown',checked_at:'2026-10-15T18:00:00Z'};
 const persisted=JSON.parse(JSON.stringify(retainVerificationEvidence(unknown,known)));
 const again=retainVerificationEvidence(unknown,persisted);
 assert.equal(again.last_known.last_known,undefined);
 const row=applyVerification({...job,elig_signals:{verification:again}},unknown);
 assert.equal(row.verification.status,'unknown');
 assert.equal(checkEligibility(row,'nigeria').eligible,false);
});
test('pending recheck retains restrictions and confirmed closure', async () => {
 const known=compactVerification({v:1,status:'ok',checked_at:'2000-01-01T00:00:00Z',title:job.title,description:'US applicants only.',location:'Remote US',remote:true});
 const rows=await verifyCandidates([{...job,apply_url:'https://example.bamboohr.com/careers/999991',elig_signals:{verification:known}}],{budgetMs:0});
 assert.equal(checkEligibility(rows[0],'nigeria').eligible,false);
 const closed=retainVerificationEvidence({status:'unknown'},{status:'dead',reason:'Posting removed'});
 assert.equal(applyVerification(job,closed).verification.status,'dead');
});
test('successful changed posting replaces old restrictions', () => {
 const current=compactVerification({...job,status:'ok',v:1});
 const retained=retainVerificationEvidence(current,{status:'dead'});
 assert.equal(retained.last_known,undefined);
 assert.equal(checkEligibility(applyVerification(job,retained),'nigeria').eligible,true);
});
test('Affirm direct employer posting preserves US restriction',async()=>{
 const row={...job,title:'Administrative Assistant IV',company:'Affirm',apply_url:'https://job-boards.greenhouse.io/affirm/jobs/7850544003'};
 const v=await verifyPosting(row,{fetcher:async()=>response({id:7850544003,title:row.title,location:{name:'Remote US'},content:'Administrative support for our engineering team.'})});
 assert.equal(v.provider,'employer');
 assert.equal(checkEligibility(applyVerification(row,compactVerification(v)),'nigeria').eligible,false);
 assert.equal(checkEligibility(applyVerification(row,compactVerification(v)),'us').eligible,true);
});
test('retired sources are never fetched or resolved through employer boards',async()=>{
 for(const apply_url of ['https://weworkremotely.com/remote-jobs/example','https://jobicy.com/jobs/example','https://himalayas.app/companies/example/jobs/assistant','https://myjobmag.com/job/assistant','https://www.myjobmag.com/job/assistant','https://www.arbeitnow.com/jobs/assistant','https://remotive.com/remote-jobs/assistant','https://remoteok.com/remote-jobs/assistant']) {
  let calls=0;
  const v=await verifyPosting({...job,company:'Canonical',apply_url},{fetcher:async()=>{calls++;return response(ld({}));}});
  assert.equal(v.status,'unknown');assert.equal(calls,0);
 }
});

test('v3 clean employer evidence keeps restrictions after source signals upgrade', () => {
 const checked={v:2,status:'ok',title:'Data Analyst',location:'Remote',remote:true,
   checked_at:new Date().toISOString(),signals:{v:3,hardExclusion:'us only',descriptionMissing:false}};
 const applied=applyVerification(job,checked);
 assert.equal(checkEligibility(applied,'nigeria').eligible,false);
 const unknown=applyVerification(job,{v:2,status:'unknown',last_known:checked});
 assert.equal(checkEligibility(unknown,'nigeria').eligible,false);
});
test('old compact employer scopes survive pending and unknown while old positives become unconfirmed',async()=>{
 const known={v:2,status:'ok',title:job.title,location:'Remote',remote:true,checked_at:'2026-10-15T10:00:00Z',signals:{v:4,descriptionMissing:false,worldwideDesc:true,hiringScopes:[{targets:['us'],required:true,evidence:'Applicants must be based in the United States.'}]}};
 for(const incoming of [known,{v:3,status:'unknown',checked_at:'2026-10-18T10:00:00Z',last_known:known},{status:'pending',last_known:known}]) {
  const applied=applyVerification(job,incoming);
  assert.equal(applied.elig_signals.v,SIGNALS_VERSION);assert.equal(applied.elig_signals.descriptionMissing,true);
  assert.equal(checkEligibility(applied,'nigeria').eligible,false);
 }
 const positive={...known,signals:{v:4,descriptionMissing:false,worldwideDesc:true,hiringScopes:[]}};
 assert.equal(checkEligibility(applyVerification(job,positive),'nigeria').confidence,'possible');
 const pending=await verifyCandidates([{...job,apply_url:'https://example.recruitee.com/o/old',elig_signals:{verification:known}}],{budgetMs:0});
 assert.equal(pending[0].verification.status,'pending');assert.equal(checkEligibility(pending[0],'nigeria').eligible,false);
 const fresh=applyVerification(job,{...known,description:'Open to candidates worldwide.',signals:{v:4,hardExclusion:'us only'}});
 assert.equal(checkEligibility(fresh,'nigeria').eligible,true);assert.equal(fresh.elig_signals.v,SIGNALS_VERSION);
});

const recruiteeJob={...job,title:'People Operations Specialist',apply_url:'https://example.recruitee.com/o/people-operations-specialist/c/new'};
const recruiteeOffer=(extra={})=>({offer:{id:2750730,slug:'people-operations-specialist',title:recruiteeJob.title,status:'published',description:'<p>People operations support. Open to candidates worldwide.</p>',requirements:'<p>Experience supporting remote teams.</p>',remote:true,location:'Remote job',country:'Czechia',country_code:'CZ',city:'Prague',locations:[{city:'Prague',country:'Czechia'}],close_at:null,...extra}});
test('Recruitee reads the exact tenant offer and does not turn office metadata into remote residency',async()=>{
 for(const suffix of ['', '/', '/c/new', '/c/new/']) {
  const row={...recruiteeJob,apply_url:'https://example.recruitee.com/o/people-operations-specialist'+suffix+'?source=jobhive'};
  let calls=0;
  const v=await verifyPosting(row,{fetcher:async url=>{
   calls++;assert.equal(url,'https://example.recruitee.com/api/offers/people-operations-specialist');return response(recruiteeOffer());
  }});
  assert.equal(calls,1);assert.equal(v.status,'ok');assert.equal(v.provider,'employer');assert.equal(v.location,'Remote job');assert.equal(v.remote,true);
  assert.match(v.description,/Experience supporting remote teams/);
  const applied=applyVerification(row,compactVerification(v));
  assert.equal(checkEligibility(applied,'nigeria').eligible,true);assert.equal(checkEligibility(applied,'nigeria').confidence,'certain');
 }
});
test('Recruitee generic remote remains unconfirmed while full requirements retain residency restrictions',async()=>{
 const v=await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer({description:'People operations support.',requirements:'Remote team administration.'}))});
 assert.equal(checkEligibility(applyVerification(recruiteeJob,compactVerification(v)),'nigeria').confidence,'possible');
 const restricted=await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer({requirements:'Required experience. '.repeat(400)+'Applicants must be based in the United States.'}))});
 assert.equal(restricted.status,'ok');assert.match(restricted.description,/Applicants must be based in the United States/);
 assert.equal(checkEligibility(applyVerification(recruiteeJob,compactVerification(restricted)),'nigeria').eligible,false);
 const onsite=await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer({remote:false,location:'',description:'Work in our Prague office.'}))});
 assert.equal(onsite.location,'Prague, Czechia');assert.equal(onsite.remote,false);
 assert.equal(checkEligibility(applyVerification(recruiteeJob,compactVerification(onsite)),'nigeria').eligible,false);
});
test('Recruitee requires exact identity, known status and usable full description',async()=>{
 for(const extra of [{slug:'another-role'},{title:'Software Engineer'},{id:null},{status:undefined},{status:'surprise'},{description:null},{description:'<p></p>'},{requirements:{text:'Applicants must be based in the United States.'}}]) {
  assert.equal((await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer(extra))})).status,'unknown');
 }
 for(const body of [{},{offer:[]},'<html>Verify you are human</html>']) {
  assert.equal((await verifyPosting(recruiteeJob,{fetcher:async()=>response(body)})).status,'unknown');
 }
 for(const status of ['draft','closed','archived','unpublished','internal']) {
  assert.equal((await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer({status}))})).status,'dead');
 }
});
test('Recruitee closes only unambiguous valid expired deadlines',async()=>{
 const now=Date.parse('2026-10-18T12:00:00Z');
 for(const close_at of ['2026-10-17T12:00:00Z','2026-10-17 12:00:00 UTC','2026-10-17T15:00:00+03:00']) {
  assert.equal((await verifyPosting(recruiteeJob,{now,fetcher:async()=>response(recruiteeOffer({close_at}))})).status,'dead');
 }
 for(const close_at of [null,0,'yesterday','2026-02-30T12:00:00Z','2026-10-17','2026-10-17 12:00:00','2026-10-19T12:00:00Z']) {
  assert.equal((await verifyPosting(recruiteeJob,{now,fetcher:async()=>response(recruiteeOffer({close_at}))})).status,'ok');
 }
});
test('Recruitee blocked and transient checks are unknown and preserve last conclusive evidence',async()=>{
 const known=compactVerification(await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer({requirements:'Applicants must be based in the United States.'}))}));
 for(const status of [403,429,500]) {
  const v=await verifyPosting(recruiteeJob,{fetcher:async()=>response('',status)});
  assert.equal(v.status,'unknown');
  assert.equal(checkEligibility(applyVerification({...recruiteeJob,elig_signals:{verification:known}},v),'nigeria').eligible,false);
 }
 assert.equal((await verifyPosting(recruiteeJob,{fetcher:async()=>{throw new Error('network');}})).status,'unknown');
 for(const status of [404,410])assert.equal((await verifyPosting(recruiteeJob,{fetcher:async()=>response('',status)})).status,'dead');
});
test('Recruitee rejects unsupported paths, misleading hosts and cross-tenant redirects',async()=>{
 for(const apply_url of ['https://recruitee.com/o/people-operations-specialist','https://nested.example.recruitee.com/o/people-operations-specialist','https://example.recruitee.com.evil.test/o/people-operations-specialist','https://example.recruitee.com/api/offers/people-operations-specialist','https://user:password@example.recruitee.com/o/people-operations-specialist']) {
  let calls=0;
  assert.equal((await verifyPosting({...recruiteeJob,apply_url},{fetcher:async()=>{calls++;return response(recruiteeOffer());}})).status,'unknown');assert.equal(calls,0);
 }
 let calls=0;
 const v=await verifyPosting(recruiteeJob,{fetcher:async()=>{calls++;return response('',302,{location:'https://other.recruitee.com/api/offers/people-operations-specialist'});}});
 assert.equal(v.status,'unknown');assert.equal(calls,1);
});

test('new source restrictions outrank old positive evidence until a fresh employer check',async()=>{
 const changed='2026-10-18T11:00:00Z';
 const source={...job,description:'Candidates must reside in the UK.',location:'Remote',elig_signals:{...extractEligibilitySignals({title:job.title,description:'Candidates must reside in the UK.',location:'Remote'}),source:{changed_at:changed}}};
 const old={v:3,status:'ok',checked_at:'2026-10-18T10:00:00Z',title:job.title,location:'Worldwide',remote:true,signals:extractEligibilitySignals({title:job.title,description:'Work from anywhere.',location:'Worldwide'})};
 const applied=applyVerification(source,old);
 assert.equal(checkEligibility(applied,'nigeria').eligible,false);
 const changedGlobal={...source,description:'Work from anywhere.',elig_signals:{...extractEligibilitySignals({title:job.title,description:'Work from anywhere.',location:'Remote'}),source:{changed_at:changed}}};
 assert.equal(checkEligibility(applyVerification(changedGlobal,old),'nigeria').confidence,'possible');
 const fresh={...old,checked_at:'2026-10-18T12:00:00Z'};
 assert.equal(checkEligibility(applyVerification(changedGlobal,fresh),'nigeria').confidence,'certain');
});
