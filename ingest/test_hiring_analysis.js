import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeHiringCv,analysisIsCurrent,validateHiringAnalysis} from '../api/hiringAnalysis.js';
const criteria=[{id:'criterion_1',label:'Customer service',importance:'required'}];
test('AI cannot claim evidence for a fabricated or missing CV quote',()=>{
 for(const evidence of [null,'Expert at everything.','SQL']){
  const r=validateHiringAnalysis({criteria:[{criterion_id:'criterion_1',status:'evidence_found',evidence}]},criteria,'Handled customer requests and resolved support issues.');
  assert.equal(r[0].status,'needs_review');assert.equal(r[0].evidence,null);
 }
});
test('semantic review is traceable and stale CVs or changed criteria invalidate it',async()=>{
 const cvText='Handled customer requests and resolved support issues.';
 const out=await analyzeHiringCv({posting:{title:'Support',screening_criteria:criteria},cvText,generate:async()=>({criteria:[{criterion_id:'criterion_1',status:'evidence_found',evidence:cvText,question:'How did you measure response quality?'}]})});
 assert.equal(out.criteria[0].status,'evidence_found');assert.ok(out.model);assert.ok(out.at);
 assert.ok(analysisIsCurrent(out,{title:'Support',screening_criteria:criteria},cvText));
 assert.equal(analysisIsCurrent(out,{screening_criteria:[]},cvText),false);
 assert.equal(analysisIsCurrent(out,{screening_criteria:criteria},'New CV'),false);
});
test('AI failure never writes a false assessment and truncated reviews are labelled partial',async()=>{
 await assert.rejects(()=>analyzeHiringCv({posting:{screening_criteria:criteria},cvText:'A CV',generate:async()=>null}));
 const out=await analyzeHiringCv({posting:{screening_criteria:criteria},cvText:'x'.repeat(15000),generate:async()=>({criteria:[]})});assert.equal(out.partial,true);assert.equal(out.criteria[0].status,'needs_review');
});

test('protected-characteristic interview questions are replaced with job-related questions',()=>{
 const r=validateHiringAnalysis({criteria:[{criterion_id:'criterion_1',status:'needs_review',question:'What is your age?'}]},criteria,'A CV');
 assert.equal(r[0].question,'Ask for a concrete example of Customer service.');
});

test('maximum role rubric and long job descriptions cannot exceed the free-tier request budget',async()=>{
 const fullCriteria=Array.from({length:12},(_,i)=>({id:'criterion_'+(i+1),label:'"\\'.repeat(60),importance:'required'}));
 let estimate;
 const cvText='x'.repeat(13980)+'END_OF_VISIBLE_CV';
 const result=await analyzeHiringCv({posting:{title:'x'.repeat(1000),description:'y'.repeat(50000),screening_criteria:fullCriteria},cvText,generate:async(prompt,options)=>{
  estimate=Math.ceil(prompt.length/3.5)+options.maxCompletionTokens;
  assert.ok(prompt.includes('END_OF_VISIBLE_CV'),'retain the existing 14k CV window');
  assert.ok(!prompt.includes('y'.repeat(100)),'do not resend the full JD for each applicant');
  assert.ok(estimate<=7000,'leave the existing 1,000-token reserve within the published 8k TPM budget');
  return {criteria:[]};
 }});
 assert.ok(estimate);assert.equal(result.prompt_version,2);
});
