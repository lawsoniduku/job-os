import test from 'node:test';
import assert from 'node:assert/strict';
import {updateJobSignals,mergePostingObservation} from './core/jobSignalsWriter.js';
import {evidenceDb} from './test_support/evidenceDb.js';
const options={sleep:async()=>{}};

test('a concurrent importer update survives a slow verification cache write',async()=>{
 const snapshot={id:'1',elig_signals:{v:4,source:{hash:'old'}}};
 const db=evidenceDb([snapshot]);let first=true;
 db.beforeWrite=async()=>{if(first){first=false;db.rows.set('1',{id:'1',elig_signals:{v:5,source:{hash:'new'},infer:{scope:'unclear'}}});}};
 const verification={status:'ok',checked_at:'2026-10-18T10:00:00Z'};
 const result=await updateJobSignals(db,'1',current=>({...current,verification}),{...options,snapshot});
 assert.equal(result.saved,true);
 assert.deepEqual(db.rows.get('1').elig_signals,{v:5,source:{hash:'new'},infer:{scope:'unclear'},verification});
});
test('stale inference is discarded if its posting text changed during the model call',async()=>{
 const db=evidenceDb([{id:'1',description:'New residency rules',elig_signals:{v:5,source:{hash:'new'}}}]);
 const result=await updateJobSignals(db,'1',(current,row)=>row.description==='Old text'?{...current,infer:{scope:'worldwide'}}:undefined,{...options,columns:'id,description,elig_signals'});
 assert.equal(result.skipped,true);assert.equal(db.rows.get('1').elig_signals.infer,undefined);
});
test('an older response cannot replace a newer closure or erase its observation time',()=>{
 const closed={status:'dead',checked_at:'2026-10-18T12:00:00Z'};
 assert.deepEqual(mergePostingObservation(closed,{status:'ok',checked_at:'2026-10-18T11:00:00Z'}),closed);
 const failure={status:'unknown',checked_at:'2026-10-18T13:00:00Z'};
 assert.deepEqual(mergePostingObservation(closed,failure),{...failure,last_known:closed});
});
test('persistent conflicts fail without overwriting current evidence',async()=>{
 const db=evidenceDb([{id:'1',elig_signals:{n:0}}]);db.beforeWrite=async()=>{const row=db.rows.get('1');row.elig_signals={n:row.elig_signals.n+1};};
 const result=await updateJobSignals(db,'1',current=>({...current,verification:{status:'ok'}}),{...options,attempts:3});
 assert.ok(result.error);assert.equal(db.rows.get('1').elig_signals.verification,undefined);
});
