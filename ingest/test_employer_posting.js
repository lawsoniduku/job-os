import test from 'node:test';
import assert from 'node:assert/strict';
import {employerSearchDescription} from '../api/employerPosting.js';
import {checkEligibility,extractEligibilitySignals,SIGNALS_VERSION} from '../api/roleIntelligence.js';
function verdict(countries,country,description='Build useful software.'){const job={title:'Software Engineer',location:'Remote',remote:true,description:employerSearchDescription({description,eligible_countries:countries})};job.elig_signals={...extractEligibilitySignals(job),v:SIGNALS_VERSION};return checkEligibility(job,country);}
test('employer-declared countries reach the shared deterministic search authority',()=>{
 assert.equal(verdict(['united states'],'nigeria').eligible,false);
 assert.equal(verdict(['nigeria','kenya'],'nigeria').eligible,true);
 assert.equal(verdict(['nigeria','kenya'],'uk').eligible,false);
});
test('blank employer geography stays unconfirmed and never invents worldwide hiring',()=>assert.notEqual(verdict([],'nigeria').confidence,'certain'));
test('global wording cannot erase a separate explicit applicant restriction',()=>assert.equal(verdict(['worldwide'],'nigeria','Applicants must reside in the United States.').eligible,false));
