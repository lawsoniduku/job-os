import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntent} from '../api/roleIntelligence.js';
import {matchesFilters,compareSearchResults,rankCandidates} from '../api/searchCandidates.js';
const job=(title,extra={})=>({id:title,title,company:'Example',source:'jobhive',apply_url:'https://example.com/job/'+encodeURIComponent(title),location:'Lagos, Nigeria',description:'Support employees in Nigeria.',posted_at:new Date().toISOString(),...extra});

test('unknown publication evidence cannot qualify as posted today or outrank a dated role',()=>{
 const now=Date.now(), unknown=job('Virtual Assistant',{id:'unknown-date',posted_at:new Date(now).toISOString(),elig_signals:{source:{publication_unknown:true}}});
 assert.equal(matchesFilters(unknown,{maxAgeDays:1},now),false);
 const eligibility={eligible:true,confidence:'certain',reason:'Location mentions nigeria'};
 const known=job('Virtual Assistant',{id:'known-date',posted_at:new Date(now-864e5).toISOString(),eligibility});
 assert.ok(compareSearchResults({...unknown,eligibility},known,now)>0);
 // Retain conservative historical visibility: marking a date uncertain must
 // not resurrect 2025 jobs or bypass publication-age discovery safeguards.
 assert.equal(matchesFilters({...unknown,posted_at:'2025-01-01T00:00:00Z'},{},now),false);
});
