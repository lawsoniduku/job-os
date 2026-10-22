import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestHiringCriteria,validateSuggestedCriteria} from '../api/hiringCriteria.js';
test('criterion suggestions retain actual job requirements and discard inventions or protected attributes',async()=>{
 const description='Resolve customer tickets using Zendesk. Excel experience is preferred. A degree is not required. Candidates of any age are welcome.';
 const rows=[{label:'Zendesk',importance:'required',evidence:'Resolve customer tickets using Zendesk.'},{label:'Excel experience',importance:'required',evidence:'Excel experience is preferred.'},{label:'Python',importance:'required',evidence:'Python expertise is essential.'},{label:'degree',importance:'required',evidence:'A degree is not required.'},{label:'age',importance:'required',evidence:'Candidates of any age are welcome.'}];
 const result=await suggestHiringCriteria({title:'Support',description,generate:async()=>({criteria:rows})});
 assert.deepEqual(result.map(c=>[c.label,c.importance]),[['Zendesk','required'],['Excel experience','preferred']]);
 assert.ok(result.every(c=>description.includes(c.evidence)));
});
test('malformed and duplicate suggestions do not erase manual criteria or invent a rubric',()=>{
 assert.deepEqual(validateSuggestedCriteria(null,'A role'),[]);
 assert.deepEqual(validateSuggestedCriteria([{label:'SQL',importance:'required',evidence:'SQL'}],'SQL'),[]);
 const rows=[{label:'SQL',importance:'required',evidence:'Build reliable SQL reports.'}];
 assert.equal(validateSuggestedCriteria([...rows,...rows],'Build reliable SQL reports.').length,1);
});
