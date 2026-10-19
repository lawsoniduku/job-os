import test from 'node:test';
import assert from 'node:assert/strict';
import {rowToRaw,fastReject,recoverWorldwideJob,JOBHIVE_KEEP_REGIONS} from './core/jobhive.js';
import {normalizeJob} from './core/normalize.js';
import {tagJob} from './core/tag.js';
import {checkEligibility} from '../api/roleIntelligence.js';

function candidate(values={}) {
 const raw=rowToRaw({title:'Software Engineer',url:'https://example.recruitee.com/o/engineer',is_remote:'true',...values});
 const tagged=tagJob(normalizeJob(raw,{source:'jobhive',ats:'recruitee',countryIso:raw._country_iso}));
 const recovered=recoverWorldwideJob(tagged,raw);
 const verdict=checkEligibility(recovered,'nigeria');
 return {raw,tagged,recovered,verdict,admitted:!fastReject(raw)&&JOBHIVE_KEEP_REGIONS.has(recovered.eligibility_region)&&verdict.eligible!==false};
}

test('EMEA hiring location survives a company customer mention of Kenya',()=>{
 const result=candidate({location:'EMEA',description:'We serve customers in Kenya. Build excellent products.'});
 assert.equal(result.verdict.eligible,true);
 assert.equal(result.verdict.confidence,'likely');
 assert.equal(result.recovered.eligibility_region,'EMEA');
 assert.equal(result.admitted,true);
});
test('remote EMEA hiring location survives company team geography in South Africa',()=>{
 const result=candidate({location:'Remote - EMEA',description:'Our colleagues work in South Africa. Build excellent products.'});
 assert.equal(result.verdict.eligible,true);
 assert.equal(result.recovered.eligibility_region,'EMEA');
 assert.equal(result.admitted,true);
});
test('a false upstream remote flag cannot erase explicit worldwide remote location',()=>{
 const result=candidate({location:'Remote, anywhere worldwide',country_iso:'US',is_remote:'false',description:'Work from anywhere in the world.'});
 assert.equal(fastReject(result.raw),false);
 assert.equal(result.verdict.eligible,true);
 assert.equal(result.admitted,true);
});
test('concrete foreign onsite work without a remote location remains cheap-rejected',()=>{
 const result=candidate({location:'New York, United States',country_iso:'US',is_remote:'false',description:'Software development at our New York office.'});
 assert.equal(fastReject(result.raw),true);
 assert.equal(result.admitted,false);
});
test('EMEA customer marketing does not override explicit foreign applicant residency',()=>{
 const result=candidate({location:'EMEA',description:'We serve customers in Kenya. Applicants must reside in the United Kingdom.'});
 assert.equal(result.verdict.eligible,false);
 assert.equal(result.recovered.eligibility_region,result.tagged.eligibility_region);
 assert.equal(result.admitted,false);
});
test('worldwide location never overrides separate US-only residency',()=>{
 const result=candidate({location:'Remote, anywhere worldwide',country_iso:'US',is_remote:'false',description:'Applicants must reside in the United States. US citizens only.'});
 assert.equal(result.verdict.eligible,false);
 assert.equal(result.admitted,false);
});
test('worldwide marketing never overrides independent physical office attendance',()=>{
 const result=candidate({location:'Remote, anywhere worldwide',country_iso:'US',is_remote:'false',description:'Work from anywhere in the world. This is an on-site position. You must work on-site in our New York office.'});
 // The engine can keep conflicting worldwide text as uncertain. Intake must
 // never turn a conflicting non-remote row into a confirmed recovered role.
 assert.notEqual(result.verdict.confidence,'certain');
 assert.notEqual(result.verdict.confidence,'likely');
});
