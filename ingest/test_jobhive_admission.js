import test from 'node:test';
import assert from 'node:assert/strict';
import {createJobhiveAdmission} from './core/jobhiveAdmission.js';
const row=(n,patch={})=>({title:'People Analyst '+n,company:'Example',location:'Worldwide',apply_url:'https://example.recruitee.com/o/'+n,posted_at:new Date(Date.UTC(2026,9,1)+n*1000).toISOString(),description:'Build useful products.',...patch});
test('a reversed large feed keeps the newest bounded payload regardless of traversal order',()=>{
 for(const reverse of [false,true]){
  const q=createJobhiveAdmission({maxRows:3,maxBytes:5000}),rows=Array.from({length:2000},(_,i)=>row(i));
  if(reverse)rows.reverse();for(const r of rows)q.offer(r);
  assert.deepEqual(q.rows().map(r=>r.title),['People Analyst 1999','People Analyst 1998','People Analyst 1997']);
  assert.equal(q.stats().selected,3);assert.ok(q.stats().selectedBytes<=5000);
 }
});
test('unknown publication dates stay behind actual published jobs even with a fresh import date',()=>{
 const q=createJobhiveAdmission({maxRows:1});q.offer(row(1));q.offer(row(9,{posted_at:null,created_at:'2026-10-19',elig_signals:{source:{fetched_at:'2026-10-19'}}}));assert.equal(q.rows()[0].title,'People Analyst 1');
});
test('payload budget evicts older descriptions instead of growing with the input corpus',()=>{
 const q=createJobhiveAdmission({maxRows:100,maxBytes:700});for(let i=0;i<20;i++)q.offer(row(i,{description:'Description. '.repeat(10)}));assert.ok(q.stats().selectedBytes<=700);assert.equal(q.rows()[0].title,'People Analyst 19');
});
test('missing company names do not collapse unrelated employers into one content key',()=>{
 const q=createJobhiveAdmission({maxRows:3});q.offer(row(1,{company:'',title:'People Analyst'}));q.offer(row(2,{company:'',title:'People Analyst'}));assert.equal(q.rows().length,2);
});
test('later contradictory source observation removes an earlier buffered URL without declaring closure',()=>{
 const q=createJobhiveAdmission();q.offer(row(1,{elig_signals:{source:{fetched_at:'2026-10-18'}}}));q.reject(row(1,{elig_signals:{source:{fetched_at:'2026-10-19'}}}));assert.equal(q.rows().length,0);
});
test('bounded expansion reserves intake for evidenced eligibility before newer unconfirmed jobs',()=>{
 const a=createJobhiveAdmission({maxRows:2,maxBytes:100000,preferConfirmed:true});
 const make=(id,date)=>({title:'Support '+id,company:'Example',location:'Remote',apply_url:'https://example.com/'+id,posted_at:date});
 const uncertain=make('uncertain','2026-10-20'),older=make('global','2026-10-16'),newer=make('emea','2026-10-19');
 a.offer(uncertain,{confidence:'possible'});a.offer(older,{confidence:'certain'});a.offer(newer,{confidence:'likely'});
 assert.deepEqual(a.rows().map(x=>x.title),['Support emea','Support global']);
 const sparse=createJobhiveAdmission({maxRows:2,maxBytes:100000,preferConfirmed:true});
 sparse.offer(uncertain,{confidence:'possible'});sparse.offer(older,{confidence:'certain'});
 assert.deepEqual(sparse.rows().map(x=>x.title),['Support global','Support uncertain']);
});
