import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPosting,applyVerification,compactVerification,verifyCandidates,nonVacancyReason,redirectedToIndex,parseJobPosting,locationText,retainVerificationEvidence} from '../api/postingVerification.js';
import {checkEligibility,parseIntent} from '../api/roleIntelligence.js';
import {rankCandidates} from '../api/searchCandidates.js';
import {normalizeJob} from './core/normalize.js';
const job={id:'1',title:'Administrative Assistant',apply_url:'https://example.bamboohr.com/careers/1',location:'Worldwide',remote:true,description:'Open to candidates worldwide.'};
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
 const j={...job,apply_url:'https://jobicy.com/jobs/123-assistant'};
 for(const html of ['<h1>Current openings</h1>',ld({title:'Software Engineer'})])assert.equal((await verifyPosting(j,{fetcher:async()=>response(html)})).status,'unknown');
});
test('expired structured posting is dead',async()=>{
 assert.equal((await verifyPosting({...job,apply_url:'https://jobicy.com/jobs/123-assistant'},{fetcher:async()=>response(ld({validThrough:'2001-01-01'}))})).status,'dead');
});
test('WWR role address beats generated worldwide country list',async()=>{
 const v=await verifyPosting({...job,apply_url:'https://weworkremotely.com/remote-jobs/example-assistant'},{fetcher:async()=>response(ld({applicantLocationRequirements:[{'@type':'Country',name:'NG'},{'@type':'Country',name:'US'}],hiringOrganization:{address:'Remote US'},jobLocationType:'TELECOMMUTE'}))});
 assert.equal(v.location,'Remote US'); assert.equal(checkEligibility(applyVerification(job,v),'nigeria').eligible,false);
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
test('known employer board replaces aggregator metadata and supplies direct application',async()=>{
 const row={...job,company:'Canonical',apply_url:'https://jobicy.com/jobs/123-assistant'};
 const direct='https://job-boards.greenhouse.io/canonical/jobs/1234';
 const v=await verifyPosting(row,{fetcher:async url=>response(url.endsWith('/1234')
   ? {id:1234,title:row.title,location:{name:'Homebased - Worldwide'},content:'Open to candidates worldwide.'}
   : {jobs:[{id:1234,title:row.title,absolute_url:direct}]})});
 assert.equal(v.provider,'employer');assert.equal(v.apply_url,direct);
 assert.equal(applyVerification(row,compactVerification(v)).apply_url,direct);
 assert.equal(checkEligibility(applyVerification(row,compactVerification(v)),'nigeria').eligible,true);
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
test('unverified board worldwide label stays discoverable but unconfirmed', () => {
 const row={...job,source:'weworkremotely',description:'Administrative support for the team.'};
 const uncertain=applyVerification(row,{status:'unknown'});
 assert.equal(checkEligibility(uncertain,'nigeria').confidence,'possible');
 assert.equal(rankCandidates([uncertain],parseIntent('virtual assistant Nigeria'),{},Date.now(),true).results.length,1);
 assert.equal(checkEligibility(applyVerification({...row,description:'Open to candidates worldwide.'},{status:'unknown'}),'nigeria').confidence,'certain');
});

test('Affirm aggregator copy resolves to employer US restriction',async()=>{
 const row={...job,title:'Administrative Assistant IV',company:'Affirm',apply_url:'https://weworkremotely.com/remote-jobs/affirm-administrative-assistant-iv'};
 const v=await verifyPosting(row,{fetcher:async url=>response(url.endsWith('/7850544003')
 ? {id:7850544003,title:row.title,location:{name:'Remote US'},content:'Administrative support for our engineering team.'}
 : {jobs:[{id:7850544003,title:row.title,absolute_url:'https://job-boards.greenhouse.io/affirm/jobs/7850544003'}]})});
 assert.equal(v.provider,'employer');
 assert.equal(checkEligibility(applyVerification(row,compactVerification(v)),'nigeria').eligible,false);
 assert.equal(checkEligibility(applyVerification(row,compactVerification(v)),'us').eligible,true);
});
