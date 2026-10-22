import test from 'node:test';
import assert from 'node:assert/strict';
import {cvUploadBatches,cvImportPayload,CV_BATCH_BYTES} from './cvUploadBatches.js';
test('50 long multilingual CVs fit request byte limits and preserve every original reference',()=>{
 const originals=Array.from({length:50},(_,i)=>({filename:`CV ${i}.pdf`,text:'履'.repeat(50000),file:{toJSON(){throw Error('Original must not enter JSON');}}}));
 const batches=cvUploadBatches(originals);
 assert.equal(batches.flat().length,50);assert.ok(batches.every(b=>b.length<=10));
 assert.ok(batches.every(b=>new TextEncoder().encode(JSON.stringify(cvImportPayload(b))).byteLength<=CV_BATCH_BYTES));
 assert.ok(batches.length+50<120,'an entire 50-CV batch fits the dedicated authenticated upload budget');
 assert.ok(batches.flat().every((c,i)=>c.file===originals[i].file));
});
test('ordinary CVs share batches and text is capped before transmission',()=>{
 const candidates=Array.from({length:50},(_,i)=>({filename:i+'.txt',text:'a'.repeat(1000)}));
 assert.equal(cvUploadBatches(candidates).length,5);
 assert.equal(cvUploadBatches([{filename:'long.txt',text:'a'.repeat(100000)}])[0][0].text.length,50000);
});
