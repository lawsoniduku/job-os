import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { hiringApiDb } from '../../../ingest/test_support/hiringApiDb.js';
import { pipelineColumn, pendingApplyQuestion, closePipelinePatch } from './pipelineState.js';
import { createApplicationTracking } from './applicationTracking.js';

const user={id:'00000000-0000-4000-8000-000000000001'};
const job={id:'00000000-0000-4000-8000-000000000002',title:'Customer support',company:'Example',apply_url:'https://example.invalid/apply'};
const now='2026-11-17T12:00:00.000Z';
async function fixture(run) {
 const db=new PGlite();
 await db.exec(`create table applications(id uuid primary key default gen_random_uuid(),user_id uuid not null,job_id uuid,job_title text,company text,location text,apply_url text,salary_min integer,salary_max integer,source text,role_cluster text,verdict text,verdict_reason text,cv_label text,status text,applied_at timestamptz,apply_clicked_at timestamptz,apply_outcome text,outcome_reason text,outcome_at timestamptz,nudge_count integer default 0,nudged_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),unique(user_id,job_id));`);
 const client=hiringApiDb(db),events=[];
 let tick=0;
 const tracking=createApplicationTracking({client,now:()=>new Date(Date.parse(now)+tick++*1000).toISOString(),onChange:()=>events.push('change')});
 const row=async()=>(await db.query('select to_jsonb(a) as row from applications a where user_id=$1',[user.id])).rows[0]?.row;
 try{await run({db,client,tracking,row,events});}finally{await db.close();}
}

test('opening, ignoring, dismissing and declining a role never creates a pipeline card',()=>fixture(async({tracking,row,events})=>{
 await tracking.recordClick({user,job});
 let app=await row();assert.equal(pipelineColumn(app),null);assert.equal(pendingApplyQuestion(app),true);
 // Dismissing has no state mutation. Reasons retain feedback, not a board card.
 for(const reason of ['expired','location','visa','experience','salary','broken','other']){
  await tracking.recordClick({user,job});app=await row();
  assert.equal((await tracking.resolve(app,'abandoned',reason)).error,null);
  app=await row();assert.equal(app.outcome_reason,reason);assert.equal(app.status,'applied_intent');
  assert.equal(pipelineColumn(app),null);assert.equal(pendingApplyQuestion(app),false);
 }
 assert.ok(events.length);
}));

test('explicit save and confirmed application are the only ways a click enters the board',()=>fixture(async({tracking,row})=>{
 await tracking.recordClick({user,job});await tracking.resolve(await row(),'not_yet');
 assert.equal(pipelineColumn(await row()),'saved');
 await tracking.recordClick({user,job});assert.equal(pipelineColumn(await row()),'saved','reopening preserves an explicit save');
 await tracking.resolve(await row(),'applied');
 const app=await row();assert.equal(pipelineColumn(app),'applied');assert.ok(Date.parse(app.applied_at)>=Date.parse(now));
 await tracking.recordClick({user,job});assert.equal(pendingApplyQuestion(await row()),false);
}));

test('stale negative answers cannot downgrade an interview or overwrite a newer explicit save',()=>fixture(async({tracking,row,db})=>{
 await tracking.recordClick({user,job});const stale=await row();
 await tracking.persist({user,job,status:'saved'});
 assert.equal((await tracking.resolve(stale,'abandoned','other')).changed,false);
 assert.equal(pipelineColumn(await row()),'saved');
 await tracking.persist({user,job,status:'applied'});await db.query("update applications set status='interview'");
 assert.equal((await tracking.resolve(stale,'abandoned','location')).changed,false);
 assert.equal((await row()).status,'interview');assert.equal((await row()).apply_outcome,'applied');
}));

test('search actions preserve advanced stages and the original applied date',()=>fixture(async({tracking,row,db})=>{
 await tracking.persist({user,job,status:'applied'});const applied=(await row()).applied_at;
 for(const status of ['applied','interview','in_process','offer','closed']){
  await db.query('update applications set status=$1',[status]);
  await tracking.persist({user,job,status:'saved'});await tracking.persist({user,job,status:'applied'});
  assert.equal((await row()).status,status);assert.equal((await row()).applied_at,applied);
 }
}));

test('legacy false Closed entries hide and can be explicitly saved again without deletion',()=>fixture(async({tracking,row,db})=>{
 await tracking.recordClick({user,job});await db.query("update applications set status='closed',apply_outcome='abandoned',outcome_reason='location'");
 const previous=await row();assert.equal(pipelineColumn(previous),null);
 await tracking.persist({user,job,status:'saved'});
 assert.equal((await row()).id,previous.id);assert.equal(pipelineColumn(await row()),'saved');
 assert.equal((await db.query('select count(*)::int as n from applications')).rows[0].n,1);
}));

test('only genuine application history renders in Closed; unknown states never fall back to Saved',()=>{
 for(const status of ['saved','shortlist','interested','cv_tailored'])assert.equal(pipelineColumn({status}),'saved');
 for(const status of ['assessment','interview','in_process'])assert.equal(pipelineColumn({status}),'in_process');
 assert.equal(pipelineColumn({status:'offer'}),'offer');
 for(const status of ['closed','rejected','archived']){
  assert.equal(pipelineColumn({status,apply_outcome:'abandoned'}),null);
  assert.equal(pipelineColumn({status,applied_at:now,apply_outcome:'abandoned'}),'closed');
  assert.equal(pipelineColumn({status,apply_outcome:'applied'}),'closed');
 }
 for(const status of ['applied_intent','unknown',null])assert.equal(pipelineColumn({status}),null);
 assert.equal(pendingApplyQuestion({status:'interview',apply_clicked_at:now}),false);
});

test('removing an unsent Saved card hides it; closing an interview preserves application history',()=>{
 const removed={status:'saved',...closePipelinePatch({status:'saved'},now)};
 assert.equal(pipelineColumn(removed),null);assert.equal(removed.apply_outcome,'abandoned');
 for(const status of ['applied','interview','offer']){
  const closed={status,...closePipelinePatch({status},now)};
  assert.equal(pipelineColumn(closed),'closed');assert.equal(closed.applied_at,undefined);
 }
});

test('reopening pipeline rows uses job_id; orphan snapshots never use the application ID',()=>fixture(async({tracking,row,db})=>{
 await tracking.persist({user,job,status:'saved'});const saved=await row();
 await tracking.recordClick({user,job:saved});await tracking.recordClick({user,job:{...saved,job_id:null}});
 assert.equal((await db.query('select count(*)::int as n from applications')).rows[0].n,1);
}));

test('failed writes are returned without half an outcome or false success',()=>fixture(async({client,tracking,row,db,events})=>{
 await tracking.recordClick({user,job});const before=await row();events.length=0;
 await db.exec('alter table applications add constraint block_answer check (apply_outcome is null)');
 assert.ok((await tracking.resolve(before,'applied')).error);
 assert.equal((await row()).apply_outcome,null);assert.equal((await row()).status,'applied_intent');assert.equal(events.length,0);
 const failing=createApplicationTracking({client:{from:()=>{throw Error('network unavailable');}}});
 assert.match((await failing.persist({user,job,status:'saved'})).error.message,/network/);
 assert.equal((await createApplicationTracking({client}).resolve(before,'unsupported')).changed,false);
}));

test('an application now owned by another account cannot be resolved',()=>fixture(async({tracking,row,db})=>{
 await tracking.recordClick({user,job});const app=await row();
 await db.query('update applications set user_id=$1',['00000000-0000-4000-8000-000000000099']);
 assert.equal((await tracking.resolve(app,'applied')).changed,false);
 assert.equal((await db.query('select status from applications')).rows[0].status,'applied_intent');
}));
