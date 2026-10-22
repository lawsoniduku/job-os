import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {collectCvFiles,unpackCvZip} from './cvArchive.js';
test('ZIP imports retain original PDF bytes, flatten safe folders, and report ignored files',async()=>{
 const bytes=strToU8('%PDF-1.7\nSynthetic original CV');
 const zip=new File([zipSync({'applicants/Ada.pdf':bytes,'notes.txt':strToU8('Some notes'),'photo.png':new Uint8Array([1,2,3])})],'cvs.zip');
 const out=await collectCvFiles([zip]);assert.equal(out.files.length,2);assert.equal(out.files[0].name,'Ada.pdf');
 assert.deepEqual(new Uint8Array(await out.files[0].arrayBuffer()),bytes);assert.deepEqual(out.skipped,['photo.png']);
});
test('unsafe paths, excessive files, oversized expansion and unsupported archives fail explicitly',async()=>{
 for(const entries of [{'../outside.txt':strToU8('no')},Object.fromEntries(Array.from({length:51},(_,i)=>[i+'.txt',strToU8('a')])),{'bomb.txt':new Uint8Array(6*1024*1024)}]) {
  await assert.rejects(()=>unpackCvZip(new File([zipSync(entries)],'bad.zip')));
 }
 await assert.rejects(()=>unpackCvZip(new File(['not a zip'],'bad.zip')));
});
