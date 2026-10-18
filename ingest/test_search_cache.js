import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchCache} from '../api/searchCache.js';
test('repeated searches and pagination reuse results before the candidate loader runs',async()=>{
 let reads=0;const search=createSearchCache();const load=async()=>{reads++;return {total:54,results:['a','b']};};
 const first=await search('VA Nigeria',load),second=await search('VA Nigeria',load);
 assert.equal(reads,1);assert.equal(second,first);
});
test('a retry while a cold search is pending shares its database and verification work',async()=>{
 let resolve,reads=0;const gate=new Promise(r=>resolve=r),search=createSearchCache();
 const load=async()=>{reads++;await gate;return 'verified';};
 const first=search('same',load),retry=search('same',load);resolve();
 assert.deepEqual(await Promise.all([first,retry]),['verified','verified']);assert.equal(reads,1);
});
test('expired entries and different country/filter intents reload, failures do not poison future searches',async()=>{
 let at=0,reads=0;const search=createSearchCache({ttlMs:10,maxEntries:2,now:()=>at});const load=async()=>++reads;
 assert.equal(await search('Nigeria',load),1);assert.equal(await search('UK',load),2);
 at=11;assert.equal(await search('Nigeria',load),3);
 await assert.rejects(search('failure',async()=>{throw Error('DB unavailable');}),/DB unavailable/);
 assert.equal(await search('failure',load),4);
 assert.equal(await search('UK',load),5);
});
