import test from 'node:test';
import assert from 'node:assert/strict';
import {rankHiringEvidence} from '../api/hiringAnalysis.js';
import {scoreCandidate} from '../api/ats.js';
const criteria=[{id:'criterion_1',label:'Resolve customer issues',importance:'required'},{id:'criterion_2',label:'Excel',importance:'preferred'}];
const posting={title:'Support specialist',description:'Resolve customer issues and keep clear records.',screening_criteria:criteria};
test('role match weights required work evidence above preferred keyword mentions',()=>{
 const strong=rankHiringEvidence({criteria:[{criterion_id:'criterion_1',status:'evidence_found',strength:'demonstrated',evidence:'Resolved 40 customer tickets daily.'},{criterion_id:'criterion_2',status:'needs_review'}]},posting);
 const keywords=rankHiringEvidence({criteria:[{criterion_id:'criterion_1',status:'needs_review'},{criterion_id:'criterion_2',status:'evidence_found',strength:'mentioned',evidence:'Skills include Excel and Word.'}]},posting);
 assert.ok(strong.match_score>keywords.match_score);assert.equal(strong.match_score,75);
 assert.match(strong.summary,/Resolve customer issues/);assert.match(strong.summary,/Excel/);
 assert.doesNotMatch(strong.summary,/likely to succeed|hire this|reject/i);
});
test('a fabricated quote never earns a match point; unprocessed CVs have no semantic rank',async()=>{
 const cvText='Handled customer requests and resolved support issues in a busy help desk.';
 const out=await scoreCandidate({posting,cvText,analyze:async()=>({criteria:[{criterion_id:'criterion_1',status:'evidence_found',strength:'demonstrated',evidence:'Invented experience that was never stated.'}]})});
 assert.equal(out.match_score,0);assert.equal(out.assessment.method,'semantic_role_match');
 await assert.rejects(()=>scoreCandidate({posting,cvText,analyze:async()=>{throw Object.assign(Error('quota'),{deferred:true});}}),/quota/);
});
test('semantic equivalents get credit through grounded quotes; applicant identity is not scored',async()=>{
 const quote='Handled customer requests and resolved support issues in a busy help desk.';
 const analyze=async()=>({criteria:[{criterion_id:'criterion_1',status:'evidence_found',strength:'demonstrated',evidence:quote}]});
 const a=await scoreCandidate({posting,cvText:'Name: Ada Example\n'+quote,analyze});
 const b=await scoreCandidate({posting,cvText:'Name: Bob Example\n'+quote,analyze});
 assert.equal(a.match_score,b.match_score);assert.equal(a.match_score,75);
 assert.ok(a.assessment.at);assert.ok(a.assessment.model);assert.ok(a.assessment.cv_hash);
});
