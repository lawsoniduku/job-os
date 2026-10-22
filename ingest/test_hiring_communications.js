import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {createHiringDb,fixtureId as id} from './test_support/hiringDb.js';
import {hiringApiDb} from './test_support/hiringApiDb.js';
import {hiringCommunicationsRouter,normalizeHiringAction} from '../api/hiringCommunications.js';
import {buildHiringEmail,buildInterviewCalendar,deliverHiringMessages,hiringMailConfig,foldIcal} from '../api/hiringMail.js';
import {makeRequireAuth,makeRequireEmployer} from '../api/auth.js';
const config={configured:true,key:'synthetic-not-a-real-key',from:'JobCopilot <hiring@example.invalid>',sender:'hiring@example.invalid'};
const future=()=>new Date(Date.now()+2*86400000).toISOString();
test('mail requires a configured sender and invalid emails or meeting links cannot be sent',async()=>{
 assert.equal(hiringMailConfig({RESEND_API_KEY:'fake'}).configured,false);
 assert.equal(hiringMailConfig({RESEND_API_KEY:'fake',HIRING_FROM_ADDRESS:'onboarding@resend.dev'}).configured,false);
 assert.throws(()=>normalizeHiringAction({kind:'advance',email:'a@example.com\r\nBcc: other@example.com'},{config,source:'upload',organizer:'recruiter@example.invalid'}));
 assert.throws(()=>normalizeHiringAction({kind:'interview',email:'a@example.com',starts_at:future(),duration_minutes:30,timezone:'Africa/Lagos',location:'http://insecure.example'},{config,source:'upload',organizer:'recruiter@example.invalid'}));
 const result=await deliverHiringMessages({rpc:()=>{throw Error('must not claim mail');}},{config:{configured:false}});assert.equal(result.configured,false);
});
test('calendar requests are escaped, folded, timezone precise and cancellation preserves event identity',()=>{
 const event={id:id(25),sequence:0,starts_at:future(),ends_at:new Date(Date.parse(future())+1800000).toISOString(),organizer_email:'recruiter@example.invalid',attendee_email:'candidate@example.invalid',location:'https://meet.example.invalid/room',timezone:'Africa/Lagos'};
 const message={id:id(24),created_at:new Date().toISOString(),payload:{from:config.from,to:'candidate@example.invalid',reply_to:'recruiter@example.invalid',company:'Example',role:'Support\nMETHOD:CANCEL',stage:'interview',kind:'interview',note:'Public interview details.\nMore details.',event}};
 const ics=buildInterviewCalendar(message);assert.match(ics,/METHOD:REQUEST\r\n/);assert.match(ics,/UID:00000000-0000-4000-8000-000000000025@jobcopilot.app/);
 assert.match(ics,/Support\\nMETHOD:CANCEL/);assert.doesNotMatch(ics,/\r\nMETHOD:CANCEL/);
 assert.ok(ics.split('\r\n').every(l=>Buffer.byteLength(l)<=75));
 assert.ok(foldIcal('SUMMARY:'+ 'é'.repeat(100)).split('\r\n').every(l=>Buffer.byteLength(l)<=75));
 const email=buildHiringEmail(message);assert.equal(email.attachments.length,1);assert.doesNotMatch(email.subject,/\n/);assert.match(email.text,/Africa\/Lagos/);
 const cancelled=buildInterviewCalendar({...message,payload:{...message.payload,kind:'cancel',event:{...event,sequence:1,status:'cancelled'}}});assert.match(cancelled,/METHOD:CANCEL/);assert.match(cancelled,/SEQUENCE:1/);assert.match(cancelled,/STATUS:CANCELLED/);
});
test('advance, schedule, reschedule and cancel are atomic, idempotent and tenant-scoped',async()=>{
 const db=await createHiringDb(),supabase=hiringApiDb(db),app=express();app.use(express.json());
 app.use(hiringCommunicationsRouter({supabase,requireAuth:makeRequireAuth(supabase),requireEmployer:makeRequireEmployer(supabase),searchLimit:(_q,_s,n)=>n(),mailConfig:()=>config}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 const call=async(path,body,token='qa-token')=>{const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 const version=async()=> (await db.query("select to_jsonb(s)->>'updated_at' as v from posting_submissions s where id=$1",[id(4)])).rows[0].v;
 try {
  await db.query("insert into job_postings(id,org_id,title,status) values ($1,$2,'Support Specialist','open')",[id(3),id(2)]);
  await db.query("insert into posting_submissions(id,posting_id,org_id,source,applicant_email) values ($1,$2,$3,'upload','candidate@example.invalid')",[id(4),id(3),id(2)]);
  const path=`/employer/submissions/${id(4)}/communicate`,v=await version();
  const body={kind:'advance',request_id:randomUUID(),expected_updated_at:v,email:'candidate@example.invalid',email_confirmed:true,note:'We would like to learn more about your support experience.',copy_me:true};
  assert.equal((await call(path,{...body,email_confirmed:false})).status,400);
  const queued=await call(path,body);assert.equal(queued.status,202,JSON.stringify(queued));assert.equal(queued.data.stage,'screening');
  const repeat=await call(path,body);assert.equal(repeat.status,202);assert.equal(repeat.data.message_id,queued.data.message_id);
  assert.equal((await db.query('select count(*)::int as n from hiring_messages')).rows[0].n,1);
  assert.equal((await call(path,{...body,request_id:randomUUID()})).status,409);
  await db.query("insert into job_postings(id,org_id,title) values ($1,$2,'Another team')",[id(6),id(9)]);
  await db.query("insert into posting_submissions(id,posting_id,org_id,source) values ($1,$2,$3,'upload')",[id(7),id(6),id(9)]);
  assert.equal((await call(`/employer/submissions/${id(7)}/communicate`,body)).status,404);
  assert.equal((await call(path,body,'qa-candidate')).status,403);
  const schedule={...body,request_id:randomUUID(),expected_updated_at:await version(),kind:'interview',starts_at:future(),duration_minutes:30,timezone:'Africa/Lagos',location:'https://meet.example.invalid/room'};
  const interview=await call(path,schedule);assert.equal(interview.status,202,JSON.stringify(interview));assert.equal(interview.data.stage,'interview');
  const rescheduled=await call(path,{...schedule,request_id:randomUUID(),expected_updated_at:await version(),interview_id:interview.data.interview_id,starts_at:new Date(Date.parse(future())+86400000).toISOString()});assert.equal(rescheduled.status,202,JSON.stringify(rescheduled));
  const cancelled=await call(path,{...body,request_id:randomUUID(),expected_updated_at:await version(),kind:'cancel',interview_id:interview.data.interview_id});assert.equal(cancelled.status,202,JSON.stringify(cancelled));
  const events=(await db.query('select * from hiring_interviews')).rows;assert.equal(events.length,1);assert.equal(events[0].sequence,2);assert.equal(events[0].status,'cancelled');
  const keys=[],messages=[];
  const delivery=await deliverHiringMessages(supabase,{config,sleep:async()=>{},fetcher:async(_url,options)=>{keys.push(options.headers['Idempotency-Key']);messages.push(JSON.parse(options.body));return {ok:true,json:async()=>({id:randomUUID()})};}});
  assert.equal(delivery.sent,2,'superseded calendar messages are not sent');assert.equal(new Set(keys).size,2);assert.equal(messages[1].attachments[0].filename,'interview-cancelled.ics');
  assert.equal((await call(`/employer/submissions/${id(4)}/communications`)).data.messages.filter(m=>m.status==='sent').length,2);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const table of ['hiring_contacts','hiring_messages','hiring_interviews'])await assert.rejects(()=>db.query('select * from '+table));await assert.rejects(()=>db.query('select * from claim_hiring_message()'));await db.exec('reset role');}
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();}
});
test('mail retries keep the same provider idempotency key and never silently resend after its safe window',async()=>{
 const db=await createHiringDb(),supabase=hiringApiDb(db);
 try {
  await db.query("insert into job_postings(id,org_id,title) values ($1,$2,'Support')",[id(3),id(2)]);
  await db.query("insert into posting_submissions(id,posting_id,org_id,source) values ($1,$2,$3,'upload')",[id(4),id(3),id(2)]);
  const payload={from:config.from,to:'candidate@example.invalid',reply_to:'recruiter@example.invalid',stage:'screening',kind:'advance',role:'Support',company:'Example',note:'Next stage'};
  await db.query('insert into hiring_messages(id,org_id,submission_id,request_id,action,payload) values ($1,$2,$3,$4,$5,$6)',[id(10),id(2),id(4),randomUUID(),{},payload]);
  const keys=[];let attempts=0;
  const fetcher=async(_url,o)=>{keys.push(o.headers['Idempotency-Key']);return ++attempts===1?{ok:false,status:429,headers:{get:()=> '60'}}:{ok:true,json:async()=>({id:'synthetic-provider-receipt'})};};
  const a=await deliverHiringMessages(supabase,{config,fetcher,sleep:async()=>{}});assert.equal(a.deferred,1);
  await db.query('update hiring_messages set next_attempt_at=now() where id=$1',[id(10)]);
  const b=await deliverHiringMessages(supabase,{config,fetcher,sleep:async()=>{}});assert.equal(b.sent,1);assert.equal(keys[0],keys[1]);
  await db.query("update hiring_messages set status='queued',next_attempt_at=now(),first_attempt_at=now()-interval '25 hours' where id=$1",[id(10)]);
  const c=await deliverHiringMessages(supabase,{config,fetcher:()=>{throw Error('must not send');},sleep:async()=>{}});assert.equal(c.failed,1);assert.equal((await db.query('select last_error from hiring_messages where id=$1',[id(10)])).rows[0].last_error,'delivery_uncertain_check_provider');
 }finally{await db.close();}
});
test('the final advance records a human hire and its email exactly once',async()=>{
 const db=await createHiringDb();
 try {
  await db.query("insert into job_postings(id,org_id,title) values ($1,$2,'Support')",[id(3),id(2)]);
  await db.query("insert into posting_submissions(id,posting_id,org_id,candidate_id,source,stage) values ($1,$2,$3,$4,'platform','offer')",[id(4),id(3),id(2),id(8)]);
  await db.query('insert into hiring_contacts(submission_id,org_id,email,confirmed_by) values ($1,$2,$3,$4)',[id(4),id(2),'candidate@example.invalid',id(8)]);
  const version=(await db.query("select to_jsonb(s)->>'updated_at' as v from posting_submissions s where id=$1",[id(4)])).rows[0].v;
  const action=normalizeHiringAction({kind:'advance'},{config,source:'platform',recipient:'candidate@example.invalid',organizer:'recruiter@example.invalid'});
  const args=[id(2),id(1),id(4),version,randomUUID(),action];
  await db.query('select queue_hiring_action($1,$2,$3,$4,$5,$6)',args);
  await db.query('select queue_hiring_action($1,$2,$3,$4,$5,$6)',args);
  assert.equal((await db.query('select stage from posting_submissions where id=$1',[id(4)])).rows[0].stage,'hired');
  assert.equal((await db.query('select count(*)::int as n from hiring_messages')).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int as n from candidate_feedback where decision='hired'")).rows[0].n,1);
 }finally{await db.close();}
});
