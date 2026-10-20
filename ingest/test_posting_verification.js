import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPosting,applyVerification,compactVerification,verifyCandidates,nonVacancyReason,redirectedToIndex,parseJobPosting,locationText,retainVerificationEvidence,VERIFICATION_VERSION} from '../api/postingVerification.js';
import {checkEligibility,parseIntent,SIGNALS_VERSION,extractEligibilitySignals} from '../api/roleIntelligence.js';
import {rankCandidates} from '../api/searchCandidates.js';
import {normalizeJob} from './core/normalize.js';
const job={id:'1',source:'jobhive',title:'Administrative Assistant',apply_url:'https://example.bamboohr.com/careers/1',location:'Worldwide',remote:true,description:'Open to candidates worldwide.'};
const bamboo=(extra={})=>({result:{jobOpening:{jobOpeningStatus:'Open',jobOpeningName:job.title,atsLocation:{country:'Nigeria'},description:'Administrative support for the team.',locationType:'1',...extra}}});
const response=(body,status=200,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers});
const ld=j=>`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:job.title,description:'Administrative support for the team.',url:'https://jobs.ashbyhq.com/example/abc',...j})}</script>`;
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
 const v=await verifyPosting(j,{fetcher:async()=>response(ld({url:j.apply_url,title:j.title,jobLocation:[{address:{addressCountry:'GB'}},{address:{addressCountry:'US'}}],jobLocationType:'TELECOMMUTE',description:'Location: remote in the UK, EMEA, or US. You must already have the right to work where you are based.'}))});
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
 for(const apply_url of ['https://weworkremotely.com/remote-jobs/example','https://jobicy.com/jobs/example','https://himalayas.app/companies/example/jobs/assistant','https://www.arbeitnow.com/jobs/assistant','https://remotive.com/remote-jobs/assistant','https://remoteok.com/remote-jobs/assistant']) {
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
 const v=await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer({description:'People operations support.',requirements:'Remote team administration.',locations:[]}))});
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

// WS2 adversarial fixtures: synthetic HTTP responses only, never live postings.
const trustNow=Date.parse('2026-10-19T12:00:00Z');
const icimsUrl='https://careers-example.icims.com/jobs/123/administrative-assistant/job?in_iframe=1';
const phenomUrl='https://jobs.thermofisher.com/global/en/job/R-123/administrative-assistant';
const customRecruiteeUrl='https://careers.openvpn.net/o/administrative-assistant/c/new';
const myjobmagUrl='https://www.myjobmag.com/job/administrative-assistant-example';
const preciseLd=(url,extra={})=>ld({url,validThrough:'2026-12-31T23:59:59Z',jobLocationType:'TELECOMMUTE',...extra});
for(const [name,url] of [['iCIMS',icimsUrl],['Phenom',phenomUrl],['custom Recruitee',customRecruiteeUrl],['MyJobMag',myjobmagUrl]]) {
 test(`${name} earns availability from exact structured posting and records its proof`,async()=>{
  const v=await verifyPosting({...job,apply_url:url},{now:trustNow,fetcher:async requested=>{assert.equal(requested,url);return response(preciseLd(url));}});
  assert.equal(v.status,'ok');assert.equal(v.identity,'exact');assert.equal(v.evidence_url,url);assert.equal(v.checked_url,url);assert.equal(v.http_status,200);
  assert.equal(v.provider,name==='MyJobMag'?'jobboard':'employer');
  assert.equal(checkEligibility(applyVerification({...job,location:'Remote',apply_url:url},v),'nigeria').confidence,'possible','remote availability does not prove worldwide hiring');
 });
 test(`${name} rejects a same-title recommended job and handles closure conservatively`,async()=>{
  for(const html of [ld({url:undefined}),preciseLd(url.replace(/assistant|123/,'other')),preciseLd('https://evil.example/jobs/123')]) {
   const v=await verifyPosting({...job,apply_url:url},{now:trustNow,fetcher:async()=>response(html)});
   assert.equal(v.status,'unknown');
  }
  assert.equal((await verifyPosting({...job,apply_url:url},{now:trustNow,fetcher:async()=>response(preciseLd(url,{validThrough:'2026-01-01T00:00:00Z'}))})).status,'dead');
  for(const status of [403,429,500])assert.equal((await verifyPosting({...job,apply_url:url},{fetcher:async()=>response('',status)})).status,'unknown');
  for(const status of [404,410])assert.equal((await verifyPosting({...job,apply_url:url},{fetcher:async()=>response('',status)})).status,'dead');
  assert.equal((await verifyPosting({...job,apply_url:url},{fetcher:async()=>{throw new Error('timeout');}})).status,'unknown');
 });
}
test('new adapters never fetch misleading hosts, credentials, ports, indexes or arbitrary custom domains',async()=>{
 for(const apply_url of ['https://icims.com/jobs/123/assistant/job','https://a.b.icims.com/jobs/123/assistant/job','https://careers-example.icims.com.evil.test/jobs/123/assistant/job','https://jobs.thermofisher.com.evil.test/job/R-123','https://evil.example/job/R-123','https://jobs.thermofisher.com/jobs','https://careers-example.icims.com/jobs/search','https://user:secret@jobs.thermofisher.com/job/R-123','https://jobs.thermofisher.com:8443/job/R-123','https://careers.tether.io/api/offers/assistant','https://myjobmag.com/jobs']) {
  let calls=0;const v=await verifyPosting({...job,apply_url},{fetcher:async()=>{calls++;return response(ld({}));}});
  assert.equal(v.status,'unknown');assert.equal(calls,0,apply_url);
 }
});
test('new adapters reject cross-origin and login redirects without inventing closure',async()=>{
 for(const location of ['https://127.0.0.1/jobs','https://careers-other.icims.com/jobs','https://evil.example/','/login']) {
  let calls=0;const v=await verifyPosting({...job,apply_url:icimsUrl},{fetcher:async()=>{calls++;return response('',302,{location});}});
  assert.equal(v.status,'unknown');assert.equal(calls,1);
 }
});
test('iCIMS exact numeric identifier can prove identity without structured url',async()=>{
 const html=ld({url:undefined,identifier:{'@type':'PropertyValue',name:'iCIMS',value:'123'},validThrough:'2026-12-31'});
 assert.equal((await verifyPosting({...job,apply_url:icimsUrl},{now:trustNow,fetcher:async()=>response(html)})).status,'ok');
 assert.equal((await verifyPosting({...job,apply_url:icimsUrl},{now:trustNow,fetcher:async()=>response(html.replace('"123"','"124"'))})).status,'unknown');
});
test('structured expiration rejects malformed dates and respects inclusive date-only deadlines',async()=>{
 for(const validThrough of ['yesterday','2026-02-30','2026-02-30T00:00:00Z','2026-10-19']) {
  assert.equal((await verifyPosting({...job,apply_url:icimsUrl},{now:trustNow,fetcher:async()=>response(preciseLd(icimsUrl,{validThrough}))})).status,'ok');
 }
});
test('Recruitee locale route retains exact tenant offer checks',async()=>{
 const v=await verifyPosting({...recruiteeJob,apply_url:'https://example.recruitee.com/en/o/people-operations-specialist/c/new'},{fetcher:async url=>{assert.equal(url,'https://example.recruitee.com/api/offers/people-operations-specialist');return response(recruiteeOffer());}});
 assert.equal(v.status,'ok');assert.equal(v.identity,'exact');
});
test('Y Combinator remains explicitly unverified without a reliable adapter',async()=>{
 let calls=0;const v=await verifyPosting({...job,apply_url:'https://www.ycombinator.com/companies/example/jobs/123-assistant'},{fetcher:async()=>{calls++;return response(ld({}));}});
 assert.equal(v.status,'unknown');assert.equal(calls,0);
});
test('all employer APIs reject a response for another same or different vacancy',async()=>{
 assert.equal((await verifyPosting({...job,apply_url:'https://job-boards.greenhouse.io/example/jobs/1234'},{fetcher:async()=>response({id:1235,title:job.title,content:'Support the team.'})})).status,'unknown');
 assert.equal((await verifyPosting({...job,apply_url:'https://jobs.lever.co/example/abcd-1234'},{fetcher:async()=>response({id:'abcd-9999',text:job.title,description:'Support the team.'})})).status,'unknown');
 assert.equal((await verifyPosting(job,{fetcher:async()=>response(bamboo({jobOpeningName:'Unrelated Role'}))})).status,'unknown');
});

test('legacy structured adapters also require exact URL proof, not only a matching title',async()=>{
 for(const html of [ld({url:undefined}),ld({url:'https://jobs.ashbyhq.com/example/another-vacancy'})]) {
  assert.equal((await verifyPosting({...job,apply_url:'https://jobs.ashbyhq.com/example/abc'},{fetcher:async()=>response(html)})).status,'unknown');
 }
});
test('missing or unfamiliar employer states do not prove closure',async()=>{
 for(const jobOpeningStatus of [undefined,null,'Unknown']) {
  assert.equal((await verifyPosting(job,{fetcher:async()=>response(bamboo({jobOpeningStatus}))})).status,'unknown');
 }
 const row={...job,apply_url:'https://apply.workable.com/example/j/ABC/apply'};
 for(const state of [undefined,null,'Unknown']) {
  assert.equal((await verifyPosting(row,{fetcher:async url=>response(url.includes('/api/')?{title:row.title,state,description:'Team support.'}:'<html/>')})).status,'unknown');
 }
 assert.equal((await verifyPosting(job,{fetcher:async()=>response(bamboo({jobOpeningName:'Different Role',jobOpeningStatus:'Closed'}))})).status,'unknown');
});

import {recordVerificationSummary,printVerificationSummary} from './core/verificationDiagnostics.js';
import {verificationQuery} from './core/verificationQueue.js';
test('scheduled diagnostics explain high unknown shares by source and platform',()=>{
 const summary={};
 for(const reason of ['Source access blocked (HTTP 403)','Exact vacancy could not be verified','Exact vacancy could not be verified'])recordVerificationSummary(summary,{source:'jobhive',ats_source:'recruitee'},{status:'unknown',reason});
 recordVerificationSummary(summary,{source:'jobhive',ats_source:'recruitee'},{status:'ok'});
 recordVerificationSummary(summary,{source:'jobhive',ats_source:'phenom'},{status:'dead'});
 const output=[];printVerificationSummary(summary,line=>output.push(line));
 assert.equal(summary['jobhive/recruitee'].unknown,3);
 assert.equal(summary['jobhive/recruitee'].reasons['Exact vacancy could not be verified'],2);
 assert.ok(output.some(line=>line.includes('75.0%')));assert.ok(output.some(line=>line.includes('ABOVE 30%')));
});
test('scheduled queue uses search publication and source visibility, including missing last_seen_at',()=>{
 const calls=[];const q={};
 for(const name of ['select','in','or','eq','order','limit'])q[name]=(...args)=>{calls.push([name,...args]);return q;};
 const db={from:name=>{assert.equal(name,'jobs');return q;}};
 verificationQuery(db,{source:'jobhive',now:trustNow,limit:500,recheckDays:1});
 assert.ok(calls.some(([name,value])=>name==='or' && value.includes('last_seen_at.is.null')));
 assert.ok(calls.some(([name,value])=>name==='or' && value.includes('posted_at.gte.2026-04-22')));
 assert.ok(calls.some(([name,key,value])=>name==='eq' && key==='source' && value==='jobhive'));
 assert.ok(calls.some(([name,column,options])=>name==='order' && column==='link_checked_at' && options.nullsFirst));
 assert.equal(calls.filter(([name])=>name==='limit')[0][1],500);
 assert.throws(()=>verificationQuery(db,{source:'unsupported'}),/Unsupported/);
});
test('compact search projection retains the v4 exact evidence audit fields',async()=>{
 const row={...job,apply_url:phenomUrl};
 const v=compactVerification(await verifyPosting(row,{now:trustNow,fetcher:async()=>response(preciseLd(phenomUrl))}));
 const projected=applyVerification(row,v).verification;
 for(const key of ['v','identity','evidence_url','checked_url','http_status'])assert.equal(projected[key],v[key]);
});
test('MyJobMag allows only its known apex/www alias redirect and keeps global metadata uncertain',async()=>{
 const url='https://myjobmag.com/job/administrative-assistant-example';
 const v=await verifyPosting({...job,apply_url:url},{now:trustNow,fetcher:async requested=>requested===url?response('',301,{location:myjobmagUrl}):response(preciseLd(myjobmagUrl,{jobLocation:{name:'Worldwide'}}))});
 assert.equal(v.status,'ok');assert.equal(v.evidence_url,url);assert.equal(v.checked_url,myjobmagUrl);
 assert.equal(checkEligibility(applyVerification({...job,apply_url:url},v),'nigeria').confidence,'possible');
});
test('Phenom accepts observed underscored requisition identifiers without weakening host identity',async()=>{
 const apply_url='https://careers.marsh.com/job/R_364603';
 assert.equal((await verifyPosting({...job,apply_url},{now:trustNow,fetcher:async()=>response(preciseLd(apply_url))})).status,'ok');
});

test('failed rechecks display the original closure evidence and preserve retry diagnostics separately',()=>{
 const closure={v:VERIFICATION_VERSION,status:'dead',checked_at:'2026-10-18T10:00:00Z',reason:'Posting removed',evidence_url:icimsUrl,checked_url:icimsUrl,http_status:410,provider:'employer'};
 const retry={v:VERIFICATION_VERSION,status:'unknown',checked_at:'2026-10-19T12:00:00Z',reason:'Posting check timed out or was cancelled',evidence_url:icimsUrl,checked_url:icimsUrl};
 const row={...job,apply_url:icimsUrl,elig_signals:{...extractEligibilitySignals(job),verification:closure}};
 const applied=applyVerification(row,retry);
 for(const key of ['status','reason','checked_at','evidence_url','checked_url','http_status','provider'])assert.equal(applied.verification[key],closure[key]);
 assert.equal(applied.verification.evidence_checked_at,closure.checked_at);
 assert.deepEqual(applied.verification.latest_observation,retry);
 assert.deepEqual(applied.verification.last_known,closure);
 assert.equal(applied.elig_signals.verification.status,'unknown');
 assert.equal(applied.elig_signals.verification.reason,retry.reason);
 assert.deepEqual(applied.elig_signals.verification.last_known,closure);
 const restarted=applyVerification(JSON.parse(JSON.stringify(applied)),{...retry,checked_at:'2026-10-19T13:00:00Z'});
 assert.equal(restarted.verification.reason,closure.reason);
 assert.equal(restarted.verification.checked_at,closure.checked_at);
 assert.equal(restarted.verification.latest_observation.checked_at,'2026-10-19T13:00:00Z');
 assert.equal(restarted.verification.latest_observation.last_known,undefined);
 const conclusive=applyVerification(row,closure);
 assert.equal(conclusive.verification.latest_observation,undefined);
 assert.equal(conclusive.verification.evidence_checked_at,closure.checked_at);
});
test('a failed redirected request does not inherit the previous endpoint HTTP status',async()=>{
 const apply_url='https://jobs.thermofisher.com/job/R-123';
 const redirected='https://jobs.thermofisher.com/global/en/job/R-123/administrative-assistant';
 let calls=0;
 const v=await verifyPosting({...job,apply_url},{now:trustNow,fetcher:async url=>{
  calls++;
  if(calls===1)return response('',302,{location:redirected});
  assert.equal(url,redirected);throw new Error('timeout');
 }});
 assert.equal(calls,2);assert.equal(v.status,'unknown');assert.equal(v.checked_url,redirected);
 assert.equal(v.http_status,undefined,'no HTTP response was received from the redirected endpoint');
 assert.equal(JSON.parse(JSON.stringify(v)).http_status,undefined);
});

test('old verification versions are due even when recently checked, and current versions leave that queue',()=>{
 const calls=[];const q={};
 for(const name of ['select','in','or','eq','order','limit'])q[name]=(...args)=>{calls.push([name,...args]);return q;};
 verificationQuery({from:()=>q},{now:trustNow});
 const due=calls.find(c=>c[0]==='or' && c[1].includes('link_checked_at.lt.'))[1];
 assert.ok(due.includes('elig_signals->verification->>v.is.null'));
 assert.ok(due.includes(`elig_signals->verification->>v.neq.${VERIFICATION_VERSION}`));
 assert.ok(due.includes('link_checked_at.lt.'));
 assert.equal(calls.filter(c=>c[0]==='or').length,4);
});

const myjobmagLegacy='https://www.myjobmag.com/a_fields.php?id=1363262';
const myjobmagCanonical='https://www.myjobmag.com/job/human-resource-manager-viju-industries-nigeria-limited-1';
const myjobmagMain=(id='1363262',title=job.title,extra={})=>`<link rel="canonical" href="${myjobmagCanonical}"><h2 class="mag-b" id="job${id}"><span class="subjob-title">${title}</span></h2>${ld({url:undefined,validThrough:'2026-10-30T00:00:00+0000',...extra})}`;
test('observed MyJobMag RSS numeric ID redirects to its exact main vacancy before earning availability',async()=>{
 const v=await verifyPosting({...job,apply_url:myjobmagLegacy},{now:trustNow,fetcher:async url=>url===myjobmagLegacy?response('',302,{location:myjobmagCanonical}):response(myjobmagMain())});
 assert.equal(v.status,'ok');assert.equal(v.provider,'jobboard');assert.equal(v.checked_url,myjobmagCanonical);
});
test('MyJobMag rejects unrelated redirects, wrong numeric IDs, category pages and conflicting structured URLs',async()=>{
 for(const html of [myjobmagMain('1363263'),myjobmagMain('1363262','Different role'),myjobmagMain('1363262',job.title,{url:'https://www.myjobmag.com/job/unrelated'}),ld({url:undefined})]) {
  const v=await verifyPosting({...job,apply_url:myjobmagLegacy},{now:trustNow,fetcher:async url=>url===myjobmagLegacy?response('',302,{location:myjobmagCanonical}):response(html)});
  assert.equal(v.status,'unknown');
 }
 for(const location of ['/jobs-by-title/assistant','https://evil.example/job/1363262/assistant']) {
  assert.equal((await verifyPosting({...job,apply_url:myjobmagLegacy},{fetcher:async()=>response('',302,{location})})).status,'unknown');
 }
 for(const apply_url of ['https://www.myjobmag.com/a_fields.php?id=12&id=13','https://www.myjobmag.com/a_fields.php?id=abc','https://www.myjobmag.com/a_fields.php?category=12']){
  let calls=0;assert.equal((await verifyPosting({...job,apply_url},{fetcher:async()=>{calls++;return response(myjobmagMain());}})).status,'unknown');assert.equal(calls,0);
 }
});
test('MyJobMag deadline with observed +0000 timezone proves expiry only after exact identity',async()=>{
 const fetcher=async url=>url===myjobmagLegacy?response('',302,{location:myjobmagCanonical}):response(myjobmagMain('1363262',job.title,{validThrough:'2026-10-18T00:00:00+0000'}));
 assert.equal((await verifyPosting({...job,apply_url:myjobmagLegacy},{now:trustNow,fetcher})).status,'dead');
 assert.equal((await verifyPosting({...job,apply_url:'https://www.myjobmag.com/job/1363262/human-resource-manager'},{now:trustNow,fetcher:async()=>response(ld({url:'https://www.myjobmag.com/job/1363262/human-resource-manager'}))})).status,'ok');
});

import {createVerificationScheduler} from './core/verificationScheduler.js';
test('scheduled verification bounds each employer host and stops sending after its 429',async()=>{
 let active=0,maxActive=0,calls=0;let tick=Date.parse('2026-10-19T12:00:00Z');
 const scheduler=createVerificationScheduler({perHost:2,now:()=>tick,verify:async row=>{
  active++;maxActive=Math.max(maxActive,active);calls++;await new Promise(r=>setTimeout(r,3));active--;
  return {v:VERIFICATION_VERSION,status:'unknown',checked_at:new Date(tick).toISOString(),http_status:429,retry_after_ms:60000,reason:'Source access blocked (HTTP 429)'};
 }});
 const rows=Array.from({length:12},(_,i)=>({...job,id:String(i),apply_url:`https://example.bamboohr.com/careers/${i+1}`}));
 const results=await Promise.all(rows.map(row=>scheduler(row)));
 assert.equal(maxActive,2);assert.equal(calls,2);assert.equal(results.filter(v=>v.http_status===429).length,2);
 assert.ok(results.slice(2).every(v=>v.status==='unknown' && !v.http_status && v.reason.includes('Provider cooldown')));
 tick+=61000;await scheduler(rows[0]);assert.equal(calls,3);
});
test('one provider cooldown never blocks unrelated employers or marks deferred jobs closed',async()=>{
 let calls=0;const scheduler=createVerificationScheduler({verify:async row=>{calls++;return {v:VERIFICATION_VERSION,status:row.id==='1'?'unknown':'ok',http_status:row.id==='1'?429:200};}});
 await scheduler(job);const deferred=await scheduler({...job,id:'2'});assert.equal(deferred.status,'unknown');
 assert.equal((await scheduler({...job,id:'2',apply_url:'https://other.bamboohr.com/careers/2'})).status,'ok');assert.equal(calls,2);
});
test('unsupported URL shapes are explicitly non-retryable for this verifier version, not dead',async()=>{
 const v=await verifyPosting({...job,apply_url:'https://www.myjobmag.com/jobs-by-title/assistant'},{fetcher:async()=>{throw new Error('must not fetch');}});
 assert.equal(v.status,'unknown');assert.equal(v.retryable,false);
 const calls=[];const q={};for(const n of ['select','in','or','order','limit'])q[n]=(...args)=>{calls.push([n,...args]);return q;};
 verificationQuery({from:()=>q},{now:trustNow});
 assert.ok(calls.some(([name,value])=>name==='or' && value.includes('elig_signals->verification->>retryable.neq.false')));
});

test('MyJobMag RSS identity cannot be forged by an explicit matching URL on another main vacancy',async()=>{
 const html=myjobmagMain('1363263',job.title,{url:myjobmagLegacy});
 assert.equal((await verifyPosting({...job,apply_url:myjobmagLegacy},{fetcher:async url=>url===myjobmagLegacy?response('',302,{location:myjobmagCanonical}):response(html)})).status,'unknown');
});

test('observed Tether custom domain uses its public offer API and exact slug/id/published contract',async()=>{
 const url='https://careers.tether.io/o/people-operations-specialist/c/new';
 const v=await verifyPosting({...recruiteeJob,apply_url:url},{fetcher:async requested=>{assert.equal(requested,'https://careers.tether.io/api/offers/people-operations-specialist');return response(recruiteeOffer());}});
 assert.equal(v.status,'ok');assert.equal(v.provider,'employer');assert.equal(v.identity,'exact');
 for(const offer of [recruiteeOffer({slug:'another-role'}),recruiteeOffer({id:null}),recruiteeOffer({status:'unknown'})]) {
  assert.equal((await verifyPosting({...recruiteeJob,apply_url:url},{fetcher:async()=>response(offer)})).status,'unknown');
 }
});

test('Recruitee mandatory application locations survive Remote job and exclude Nigeria for the reported Zelh shape',async()=>{
 const v=await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer({
  description:'Logistics operations and customer support.',requirements:'Dispatch experience required.',
  location_question_visible:true,locations_question_required:true,locations_question_type:'multiple_choice',
  locations:[{city:'Belgrade',state:'Beograd',country:'Serbia'},{city:'Lviv',country:'Ukraine'}]
 }))});
 assert.equal(v.status,'ok');assert.match(v.location,/Belgrade, Beograd, Serbia/);assert.match(v.location,/Lviv, Ukraine/);
 const applied=applyVerification(recruiteeJob,compactVerification(v));
 assert.equal(checkEligibility(applied,'nigeria').eligible,false);
 assert.equal(checkEligibility(applied,'ukraine').eligible,true);
});
test('Recruitee mandatory locations retain Nigeria alternatives; optional office preferences do not narrow worldwide hiring',async()=>{
 const base={location_question_visible:true,locations_question_type:'multiple_choice',locations:[{city:'Prague',country:'Czechia'},{city:'Lagos',country:'Nigeria'}]};
 const allowed=await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer({...base,locations_question_required:true,description:'Operations support.',requirements:'Relevant experience.'}))});
 assert.equal(checkEligibility(applyVerification(recruiteeJob,compactVerification(allowed)),'nigeria').eligible,true);
 for(const extra of [{locations_question_required:false},{location_question_visible:false,locations_question_required:true},{locations_question_required:true,locations:[]}]) {
  const v=await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer({...base,...extra}))});
  assert.equal(v.location,'Remote job');assert.equal(checkEligibility(applyVerification(recruiteeJob,compactVerification(v)),'nigeria').confidence,'certain');
 }
});

test('Hard Rock shape retains published US work location when application location question is hidden',async()=>{
 const hardrock={...recruiteeJob,title:'BI Analyst',apply_url:'https://hardrockdigital.recruitee.com/o/bi-analyst-7/c/new'};
 const offer=recruiteeOffer({id:2608764,slug:'bi-analyst-7',title:'BI Analyst',remote:true,location:'Remote job',
  description:'Build business intelligence dashboards for the Finance team.',requirements:'Experience with SQL and business intelligence.',
  location_question_visible:false,locations_question_required:true,locations_question_type:'multiple_choice',
  locations:[{name:'United States',city:'United States',state:'Florida',country:'United States',country_code:'US'}]});
 const v=await verifyPosting(hardrock,{fetcher:async()=>response(offer)});
 assert.equal(v.status,'ok');assert.match(v.location,/Florida, United States/);
 const compact=compactVerification(v),applied=applyVerification(hardrock,compact);
 assert.equal(checkEligibility(applied,'nigeria').eligible,false);
 assert.equal(checkEligibility(applied,'us').eligible,true);
 assert.equal(rankCandidates([applied],parseIntent('BI analyst jobs Nigeria'),{},Date.now(),true).results.length,0);
});
test('published Recruitee locations remain usable without mandatory application preferences',async()=>{
 for(const location of ['Remote job','Remote','']){
  const v=await verifyPosting(recruiteeJob,{fetcher:async()=>response(recruiteeOffer({location,
   description:'Provide operations support.',requirements:'Relevant operations experience.',
   location_question_visible:false,locations_question_required:false,
   locations:[{city:'Belgrade',country:'Serbia'},{city:'Lagos',country:'Nigeria'}]}))});
  assert.match(v.location,/Serbia/);assert.match(v.location,/Nigeria/);
  assert.equal(checkEligibility(applyVerification(recruiteeJob,compactVerification(v)),'nigeria').eligible,true);
 }
});

import {createSourceVerificationSelector} from './core/verificationQueue.js';
test('verification rotates bounded source pages so a broad backlog cannot starve a small source',async()=>{
 const calls=[];const pending={jobhive:[[{id:'h1'}],[{id:'h2'}],[]],myjobmag:[[{id:'m1'}],[]]};
 const select=createSourceVerificationSelector(async(source,limit)=>{calls.push({source,limit});return pending[source].shift();},{sources:['jobhive','myjobmag']});
 assert.deepEqual(await select(500),[{id:'h1'}]);
 assert.deepEqual(await select(500),[{id:'m1'}]);
 assert.deepEqual(await select(1),[{id:'h2'}]);
 assert.deepEqual(await select(500),[]);
 assert.deepEqual(calls,[{source:'jobhive',limit:500},{source:'myjobmag',limit:500},{source:'jobhive',limit:1},{source:'myjobmag',limit:500},{source:'jobhive',limit:500}]);
 assert.deepEqual(await select(500),[]);assert.equal(calls.length,5);
});
test('verification source selection honours an explicit maintained source and exposes read failures',async()=>{
 let calls=0;const select=createSourceVerificationSelector(async(source,limit)=>{calls++;assert.equal(source,'myjobmag');assert.equal(limit,10);throw new Error('database timeout');},{source:'myjobmag'});
 await assert.rejects(select(10),/database timeout/);assert.equal(calls,1);
 assert.throws(()=>createSourceVerificationSelector(async()=>[],{source:'retired-feed'}),/Unsupported/);
});
test('verification source selection rejects unsafe page sizes and incomplete-looking reads',async()=>{
 let calls=0;const select=createSourceVerificationSelector(async()=>{calls++;return null;},{source:'jobhive'});
 for(const n of [0,501,1.5,NaN])await assert.rejects(select(n),/page size/);
 assert.equal(calls,0);await assert.rejects(select(500),/invalid page/);
});
test('provider recheck scopes the server query without changing other eligibility gates',()=>{
 const calls=[];const q={};for(const n of ['select','in','or','order','limit','eq'])q[n]=(...args)=>{calls.push([n,...args]);return q;};
 verificationQuery({from:()=>q},{source:'jobhive',atsSource:'recruitee'});
 assert.ok(calls.some(([n,k,v])=>n==='eq' && k==='ats_source' && v==='recruitee'));
 assert.ok(calls.some(([n,k,v])=>n==='eq' && k==='source' && v==='jobhive'));
 assert.throws(()=>verificationQuery({from:()=>q},{atsSource:'../../invalid'}),/ATS/);
});
test('exact posting recheck uses its unique URL without waiting for the bulk due window',()=>{
 const calls=[];const q={};for(const n of ['select','in','or','order','limit','eq'])q[n]=(...args)=>{calls.push([n,...args]);return q;};
 const postingUrl='https://hardrockdigital.recruitee.com/o/bi-analyst-7/c/new';
 verificationQuery({from:()=>q},{source:'jobhive',postingUrl});
 assert.ok(calls.some(([n,k,v])=>n==='eq' && k==='apply_url' && v===postingUrl));
 assert.ok(!calls.some(([n,v])=>n==='or' && v.includes('link_checked_at.lt.')));
 assert.throws(()=>verificationQuery({from:()=>q},{postingUrl:'http://127.0.0.1/private'}),/posting URL/);
});
test('Recruitee tenant requests share pacing and provider cooldown without affecting other ATS',async()=>{
 let tick=0;const calls=[],sleeps=[];
 const scheduler=createVerificationScheduler({now:()=>tick,recruiteeIntervalMs:600,sleep:async ms=>{sleeps.push(ms);tick+=ms;},
  verify:async row=>{calls.push(row.apply_url);return {status:'unknown',http_status:429,retry_after_ms:60000};}});
 const first={...recruiteeJob,apply_url:'https://one.recruitee.com/o/role'};
 await scheduler(first);
 const deferred=await scheduler({...first,apply_url:'https://two.recruitee.com/o/role'});
 assert.equal(deferred.deferred,true);assert.equal(calls.length,1);
 await scheduler(job);assert.equal(calls.length,2);
 tick=61000;await scheduler(first);await scheduler(job);
 assert.equal(calls.length,4);
 let at=0;const started=[];
 const paced=createVerificationScheduler({now:()=>at,recruiteeIntervalMs:600,sleep:async ms=>{at+=ms;},verify:async()=>{started.push(at);return {status:'ok'};}});
 await paced(first);await paced({...first,apply_url:'https://two.recruitee.com/o/role'});
 assert.deepEqual(started,[0,600]);
});

const jazzJob={...job,title:'Customer Support Specialist',apply_url:'https://example.applytojob.com/apply/aBcDe12345/Customer-Support-Specialist'};
const jazzLd=(extra={})=>ld({title:jazzJob.title,url:jazzJob.apply_url,description:'Provide customer support. Open to candidates worldwide.',jobLocationType:'TELECOMMUTE',...extra});
test('JazzHR exact structured posting earns availability without inventing country eligibility',async()=>{
 const v=await verifyPosting(jazzJob,{fetcher:async()=>response(jazzLd())});
 assert.equal(v.status,'ok');assert.equal(v.identity,'exact');assert.equal(v.provider,'employer');
 assert.equal(checkEligibility(applyVerification(jazzJob,compactVerification(v)),'nigeria').confidence,'certain');
 const generic=await verifyPosting(jazzJob,{fetcher:async()=>response(jazzLd({description:'Provide customer support.',jobLocation:undefined}))});
 assert.equal(checkEligibility(applyVerification(jazzJob,compactVerification(generic)),'nigeria').confidence,'possible');
});
test('JazzHR aliases retain case-sensitive vacancy identity and employer country restrictions',async()=>{
 const old='https://example.applytojob.com/apply/jobs/details/aBcDe12345';
 const v=await verifyPosting({...jazzJob,apply_url:old},{fetcher:async url=>url===old?response('',302,{location:jazzJob.apply_url}):response(jazzLd({description:'Customer support.',jobLocation:{address:{addressCountry:'US'}}}))});
 assert.equal(v.status,'ok');assert.equal(checkEligibility(applyVerification(jazzJob,compactVerification(v)),'nigeria').eligible,false);
 for(const url of [jazzJob.apply_url.replace('aBcDe12345','aBcDe12346'),jazzJob.apply_url.replace('aBcDe12345','abcde12345'),jazzJob.apply_url.replace('example.','other.')])
  assert.equal((await verifyPosting(jazzJob,{fetcher:async()=>response(jazzLd({url}))})).status,'unknown');
});
test('JazzHR indexes, lookalike hosts and arbitrary paths cannot be fetched as vacancies',async()=>{
 for(const apply_url of ['https://applytojob.com/apply/aBcDe12345','https://nested.example.applytojob.com/apply/aBcDe12345','https://example.applytojob.com.evil.test/apply/aBcDe12345','https://example.applytojob.com/apply/jobs','https://example.applytojob.com/api/private']){
  let calls=0;assert.equal((await verifyPosting({...jazzJob,apply_url},{fetcher:async()=>{calls++;return response(jazzLd());}})).status,'unknown');assert.equal(calls,0);
 }
});
test('JazzHR confirms removal only for 404/410, exact index redirects or expired structured proof',async()=>{
 for(const [status,want] of [[404,'dead'],[410,'dead'],[403,'unknown'],[429,'unknown'],[503,'unknown']])
  assert.equal((await verifyPosting(jazzJob,{fetcher:async()=>response('',status)})).status,want);
 for(const location of ['/apply','/apply/jobs'])assert.equal((await verifyPosting(jazzJob,{fetcher:async()=>response('',302,{location})})).status,'dead');
 assert.equal((await verifyPosting(jazzJob,{fetcher:async()=>response(jazzLd({validThrough:'2020-01-01'}))})).status,'dead');
 assert.equal((await verifyPosting(jazzJob,{fetcher:async()=>{throw new Error('timeout');}})).status,'unknown');
});
