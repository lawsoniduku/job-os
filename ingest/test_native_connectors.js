import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { fetchGreenhouse } from './connectors/ats/greenhouse.js';
import { fetchLever } from './connectors/ats/lever.js';
import { fetchSmartRecruiters } from './connectors/ats/smartrecruiters.js';
import { fetchBreezy } from './connectors/feeds/breezy.js';
function response(t,data){const previous=axios.get;axios.get=async()=>({data});t.after(()=>{axios.get=previous;});}
test('Greenhouse revision is not a source publication date, but revision stays auditable',async t=>{
 response(t,{jobs:[{title:'People Analyst',absolute_url:'https://boards.greenhouse.io/example/jobs/1',location:{name:'Remote'},content:'Remote worldwide. '+ 'Description. '.repeat(100),updated_at:'2026-10-19T12:00:00Z'}]});
 const [job]=await fetchGreenhouse([{slug:'example',name:'Example'}]);assert.equal(job.posted_at,null);assert.equal(job._source_observation.updated_at,'2026-10-19T12:00:00.000Z');assert.equal(job._source_observation.publication_unknown,true);
});
test('Lever retains full list and additional applicant restrictions at the end of the posting',async t=>{
 response(t,[{text:'People Analyst',hostedUrl:'https://jobs.lever.co/example/1',categories:{location:'Remote',allLocations:['Remote','Nigeria']},descriptionPlain:'Analyse people data. ',lists:[{text:'Eligibility',content:'<ul><li>Applicants must reside in Nigeria.</li></ul>'}],additionalPlain:'Must be authorised to work in Nigeria.',closingPlain:'No relocation or sponsorship is available.',createdAt:Date.parse('2026-01-01T00:00:00Z')}]);
 const [job]=await fetchLever([{slug:'example',name:'Example'}]);assert.match(job.description,/Applicants must reside in Nigeria/);assert.match(job.description,/authorised to work in Nigeria/);assert.match(job.description,/No relocation or sponsorship/);assert.equal(job.posted_at,'2026-01-01T00:00:00.000Z');assert.equal(job.location,'Remote / Nigeria');
});
test('SmartRecruiters keeps available jobAd sections instead of ternary-returning only the title',async t=>{
 response(t,{content:[{id:'1',name:'People Analyst',releasedDate:'2026-10-01',location:{city:'Lagos',country:'Nigeria'},jobAd:{sections:{jobDescription:{text:'Analyse people data.'},qualifications:{text:'Candidates must live in Nigeria.'},additionalInformation:{text:'No relocation.'}}}}]});
 const [job]=await fetchSmartRecruiters([{slug:'example',name:'Example'}]);assert.match(job.description,/Analyse people data/);assert.match(job.description,/Candidates must live in Nigeria/);assert.match(job.description,/No relocation/);assert.equal(job._source_observation.description_complete,true);
});
test('SmartRecruiters list summaries are explicitly marked incomplete',async t=>{
 response(t,{content:[{id:'2',name:'People Analyst',releasedDate:'2026-10-01',location:{country:'Nigeria'}}]});const [job]=await fetchSmartRecruiters([{slug:'example',name:'Example'}]);assert.equal(job._source_observation.description_complete,false);
});
test('Breezy updated_date never masquerades as a publication date',async t=>{
 response(t,[{name:'People Analyst',friendly_id:'1',description:'Analyse people data.',updated_date:'2026-10-19T12:00:00Z'}]);const [job]=await fetchBreezy([{sub:'example',name:'Example'}]);assert.equal(job.posted_at,null);assert.equal(job._source_observation.updated_at,'2026-10-19T12:00:00.000Z');
});

import {runBatched} from './connectors/ats/greenhouse.js';
test('temporary board failures are visible while successful source rows remain recoverable',async()=>{
 const good={title:'People Analyst',apply_url:'https://example.com/job/1'};
 let failure;
 try {await runBatched([{slug:'good'},{slug:'broken'}],async c=>{if(c.slug==='broken')throw Object.assign(new Error('provider unavailable'),{response:{status:503}});return [good];},'Fixture',5);}catch(error){failure=error;}
 assert.ok(failure,'a failed provider must not produce a green empty-board report');
 assert.deepEqual(failure.partialJobs,[good]);assert.match(failure.message,/failed/i);
});
test('a known missing employer board remains distinct from a transient source outage',async()=>{
 assert.deepEqual(await runBatched([{slug:'retired'}],async()=>{throw Object.assign(new Error('not found'),{response:{status:404}});},'Fixture',5),[]);
});
test('a transient employer outage retries only the failed board and preserves every successful board',async()=>{
 const calls={},delays=[];
 const rows=await runBatched([{slug:'good'},{slug:'flaky'}],async c=>{
  calls[c.slug]=(calls[c.slug] || 0)+1;
  if(c.slug==='flaky'&&calls[c.slug]<3)throw Object.assign(Error('temporary'),{response:{status:503}});
  return [{title:c.slug}];
 },'Fixture',5,{sleep:async ms=>delays.push(ms)});
 assert.equal(calls.good,1);assert.equal(calls.flaky,3);assert.equal(rows.length,2);assert.deepEqual(delays,[1000,2000]);
});
test('forbidden and missing boards are not retried; a failed board names its slug and HTTP status',async()=>{
 let calls=0;
 await assert.rejects(()=>runBatched([{slug:'restricted'}],async()=>{calls++;throw Object.assign(Error('not public'),{response:{status:403}});},'Fixture'),/restricted: HTTP 403/);
 assert.equal(calls,1);
});

import {GREENHOUSE_COMPANIES} from './connectors/registry.js';
test('Moniepoint uses the observed public board API that returns its official requisitions',async t=>{
 const previous=axios.get;t.after(()=>{axios.get=previous;});let requested;
 axios.get=async url=>{requested=url;return {data:{jobs:[]}};};
 await fetchGreenhouse([GREENHOUSE_COMPANIES.find(c=>c.slug==='moniepoint')]);
 assert.equal(requested,'https://boards-api.greenhouse.io/v1/boards/moniepoint/jobs?content=true');
});

