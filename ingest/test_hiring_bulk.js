import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import rateLimit from 'express-rate-limit';
import {createHiringDb,fixtureId as id} from './test_support/hiringDb.js';
import {hiringApiDb} from './test_support/hiringApiDb.js';
import {employerRouter} from '../api/employer.js';
import {makeRequireAuth,makeRequireEmployer,makeOptionalAuth} from '../api/auth.js';
import {runScoringQueue} from '../api/ats.js';
test('a complete 50-CV import and its originals fit the authenticated upload budget',async()=>{
 const db=await createHiringDb(),supabase=hiringApiDb(db),app=express();app.use(express.json({limit:'512kb'}));
 const searchLimit=rateLimit({windowMs:60000,max:1});
 const uploadLimit=rateLimit({windowMs:60000,max:120,keyGenerator:req=>req.user.id});
 app.use(employerRouter({supabase,requireAuth:makeRequireAuth(supabase),requireEmployer:makeRequireEmployer(supabase),optionalAuth:makeOptionalAuth(supabase),searchLimit,llmLimit:searchLimit,uploadLimit}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 try {
  await db.query("insert into job_postings(id,org_id,title,status) values ($1,$2,'Support','open')",[id(3),id(2)]);
  // Also support an older client that uploads one record at a time: 100 requests.
  for(let i=0;i<50;i++) {
   const response=await fetch(`${origin}/employer/postings/${id(3)}/candidates`,{method:'POST',headers:{Authorization:'Bearer qa-token','Content-Type':'application/json'},body:JSON.stringify({candidates:[{filename:`candidate-${i}.pdf`,text:`Candidate ${i}. Handled customer requests and resolved support issues in a busy help desk. Kept clear records and helped new colleagues.`}]})});
   assert.equal(response.status,201,'record '+i);const row=(await response.json()).candidates[0];
   const original=await fetch(`${origin}/employer/submissions/${row.id}/document`,{method:'PUT',headers:{Authorization:'Bearer qa-token','Content-Type':'application/octet-stream','X-CV-Filename':`candidate-${i}.pdf`},body:Buffer.from('%PDF-1.7 synthetic original '+i)});
   assert.equal(original.status,201,'original '+i);
  }
  await runScoringQueue(supabase,id(3));
  assert.equal((await db.query('select count(*)::int as n from posting_submissions')).rows[0].n,50);
  assert.equal((await db.query('select count(*)::int as n from hiring_documents')).rows[0].n,50);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await runScoringQueue(supabase,id(3));await db.close();}
});
