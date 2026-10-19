import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntent} from '../api/roleIntelligence.js';
import {matchesFilters,compareSearchResults,rankCandidates} from '../api/searchCandidates.js';
const job=(title,extra={})=>({id:title,title,company:'Example',source:'jobhive',apply_url:'https://example.com/job/'+encodeURIComponent(title),location:'Lagos, Nigeria',description:'Support employees in Nigeria.',posted_at:new Date().toISOString(),...extra});

for(const title of ['Performance and Talent Development Specialist','Performance & Talent Development Specialist']) test(`combined HR performance title remains discoverable: ${title}`,()=>{
 const now=Date.now();
 const row=job(title,{role_cluster:'Performance Management',location:'Remote',remote:true,description:'Support performance reviews, calibration and talent development.'});
 assert.equal(rankCandidates([row],parseIntent('performance management jobs open to nigeria'),{},now).results.length,1);
});
for(const title of ['Performance Marketing Manager','High Performance Computing Engineer','Talent Acquisition Specialist']) test(`performance HR search still excludes distinct profession: ${title}`,()=>{
 assert.equal(rankCandidates([job(title,{role_cluster:'Performance Management'})],parseIntent('performance management jobs open to nigeria')).results.length,0);
});
for(const title of ['Sr. People & Talent Operations Partner','People and Talent Operations Partner']) test(`combined people operations title remains discoverable: ${title}`,()=>{
 assert.equal(rankCandidates([job(title,{location:'Worldwide',remote:true})],parseIntent('people operations jobs open to nigeria')).results.length,1);
 assert.equal(rankCandidates([job(title,{location:'Worldwide',description:'Applicants must reside in the United States.'})],parseIntent('people operations jobs open to nigeria')).results.length,0);
});
