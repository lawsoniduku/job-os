import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createHiringDb,fixtureId as id} from './test_support/hiringDb.js';
import {hiringApiDb} from './test_support/hiringApiDb.js';
import {hiringDocumentsRouter,validateOriginal} from '../api/hiringDocuments.js';
import {makeRequireAuth,makeRequireEmployer} from '../api/auth.js';
test('original file type and size checks reject disguised or unsupported documents',()=>{
 assert.throws(()=>validateOriginal(Buffer.from('<html>not a PDF</html>'),'cv.pdf'));
 assert.throws(()=>validateOriginal(Buffer.alloc(6*1024*1024),'cv.pdf'));
 assert.throws(()=>validateOriginal(Buffer.from('<script>'),'cv.html'));
 assert.equal(validateOriginal(Buffer.from('%PDF-1.7 synthetic'),'../../cv.pdf').filename,'cv.pdf');
});
test('original PDF remains private, exact, immutable and scoped to its application',async()=>{
 const db=await createHiringDb(),supabase=hiringApiDb(db),app=express();
 app.use(hiringDocumentsRouter({supabase,requireAuth:makeRequireAuth(supabase),requireEmployer:makeRequireEmployer(supabase),searchLimit:(_q,_s,n)=>n()}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const call=async(path,bytes,token='qa-token')=>{const r=await fetch(origin+path,{method:bytes?'PUT':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','X-CV-Filename':encodeURIComponent('Original CV.pdf')},body:bytes});return {status:r.status,data:await r.json()};};
 try {
  await db.query("insert into job_postings(id,org_id,title,status) values ($1,$2,'Support','open')",[id(3),id(2)]);
  const text='Handled customer requests and resolved support issues in a busy help desk. Kept clear records and helped new colleagues.';
  const first=(await db.query('select * from add_hiring_upload($1,$2,$3,$4,$5)',[id(2),id(1),id(3),text,'CV.pdf'])).rows[0];
  const duplicate=(await db.query('select * from add_hiring_upload($1,$2,$3,$4,$5)',[id(2),id(1),id(3),text,'Renamed.pdf'])).rows[0];
  assert.equal(duplicate.id,first.id);assert.equal(duplicate.added,false);
  const route=`/employer/submissions/${first.id}/document`,pdf=Buffer.from('%PDF-1.7\nOriginal synthetic document.');
  assert.equal((await call(route)).data.document,null);
  assert.equal((await call(route,pdf)).status,201);assert.equal((await call(route,pdf)).status,200);
  assert.equal((await call(route,Buffer.from('%PDF-1.7 different'))).status,409);
  const original=await call(route);assert.equal(original.status,200);assert.equal(original.data.document.filename,'Original CV.pdf');assert.equal(original.data.document.expires_in,300);
  assert.equal((await call(`/candidate/submissions/${first.id}/document`,pdf,'qa-candidate')).status,404);
  await db.query("insert into job_postings(id,org_id,title) values ($1,$2,'Other team')",[id(6),id(9)]);
  await db.query("insert into posting_submissions(id,posting_id,org_id,source) values ($1,$2,$3,'upload')",[id(7),id(6),id(9)]);
  assert.equal((await call(`/employer/submissions/${id(7)}/document`,pdf)).status,404);
  const receipt=(await db.query('select * from submit_employer_application($1,$2,$3)',[id(3),id(8),text])).rows[0];
  assert.equal((await call(`/candidate/submissions/${receipt.submission_id}/document`,pdf,'qa-candidate')).status,201);
  assert.equal((await db.query("select public from storage.buckets where id='hiring-cvs'")).rows[0].public,false);
  await db.exec('set role anon');await assert.rejects(()=>db.query('select * from hiring_documents'));await db.exec('reset role');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();}
});
