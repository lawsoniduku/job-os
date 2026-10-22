import test from 'node:test';
import assert from 'node:assert/strict';
import {createHiringDb,fixtureId as id} from './test_support/hiringDb.js';
import {scoreCandidate,scanCandidate} from '../api/ats.js';

test('real employer migrations enforce transactions, leases and private review access',async()=>{
 const db=await createHiringDb();
 try {
  const criteria=[{id:'criterion_1',label:'SQL',importance:'required'}];
  await db.query('insert into job_postings(id,org_id,title,status,screening_criteria) values ($1,$2,$3,$4,$5)',[id(3),id(2),'Data Analyst','open',criteria]);
  await db.query('insert into posting_submissions(id,posting_id,org_id,source,cv_text,score_status) values ($1,$2,$3,$4,$5,$6)',[id(4),id(3),id(2),'upload','Built SQL reporting.','pending']);
  const claim=(await db.query('select * from claim_posting_scores($1)',[id(3)])).rows[0];
  assert.equal((await db.query('select * from claim_posting_scores($1)',[id(3)])).rows.length,0,'live lease cannot be claimed twice');
  await db.query("update posting_submissions set score_claimed_at=now()-interval '6 minutes' where id=$1",[id(4)]);
  const recovered=(await db.query('select * from claim_posting_scores($1)',[id(3)])).rows[0];
  assert.notEqual(recovered.claim_token,claim.claim_token);
  assert.equal((await db.query("update posting_submissions set score_status='done' where id=$1 and score_claim_token=$2 returning id",[id(4),claim.claim_token])).rows.length,0,'expired worker cannot save');
  const version=(await db.query('select updated_at::text as updated_at from posting_submissions where id=$1',[id(4)])).rows[0].updated_at;
  await assert.rejects(()=>db.query('select save_hiring_review($1,$2,$3,$4,$5)',[id(9),id(1),id(4),version,{note:'Wrong org'}]));
  await db.query('select save_hiring_review($1,$2,$3,$4,$5)',[id(2),id(1),id(4),version,{stage:'interview',note:'Ask about SQL',next_action:'Arrange call',due_at:'2026-10-25T10:00:00Z'}]);
  assert.equal((await db.query('select * from hiring_activity')).rows.length,3);
  await assert.rejects(()=>db.query('select save_hiring_review($1,$2,$3,$4,$5)',[id(2),id(1),id(4),version,{note:'Stale edit'}]));
  const moved=(await db.query('select stage,stage_entered_at from posting_submissions where id=$1',[id(4)])).rows[0];
  assert.equal(moved.stage,'interview');assert.ok(moved.stage_entered_at);
  await db.query('update job_postings set screening_criteria=$2 where id=$1',[id(3),[]]);
  const invalidated=(await db.query('select score_claim_token,score_status from posting_submissions where id=$1',[id(4)])).rows[0];
  assert.equal(invalidated.score_claim_token,null);assert.equal(invalidated.score_status,'pending');
  const receipt=(await db.query('select * from submit_employer_application($1,$2,$3)',[id(3),id(8),'I built SQL reports.'])).rows[0];
  await db.query("update posting_submissions set stage='offer' where id=$1",[receipt.submission_id]);
  const duplicate=(await db.query('select * from submit_employer_application($1,$2,$3)',[id(3),id(8),'A different CV.'])).rows[0];
  assert.equal(duplicate.submission_id,receipt.submission_id);assert.equal(duplicate.already_applied,true);
  assert.equal((await db.query('select count(*)::int as n from applications')).rows[0].n,1);
  assert.equal((await db.query('select stage from posting_submissions where id=$1',[receipt.submission_id])).rows[0].stage,'offer');
  const args=[id(2),id(1),[receipt.submission_id],'rejected','missing_skill','SQL production experience was not evidenced.',false];
  const decision=(await db.query('select record_hiring_decision($1,$2,$3,$4,$5,$6,$7) as result',args)).rows[0].result;
  assert.equal(decision.sent,1);
  assert.equal((await db.query('select stage from posting_submissions where id=$1',[receipt.submission_id])).rows[0].stage,'rejected');
  const repeat=(await db.query('select record_hiring_decision($1,$2,$3,$4,$5,$6,$7) as result',args)).rows[0].result;
  assert.equal(repeat.sent,0);assert.equal((await db.query('select count(*)::int as n from candidate_feedback')).rows[0].n,1);
  await assert.rejects(()=>db.query('select record_hiring_decision($1,$2,$3,$4,$5,$6,$7)',[id(9),...args.slice(1)]));
  await assert.rejects(()=>db.query('select submit_employer_application($1,$2,$3)',[id(3),id(1),null]));
  assert.equal((await db.query('select count(*)::int as n from applications')).rows[0].n,1,'bad submit creates no application');
  const grants=(await db.query("select has_column_privilege('authenticated','candidate_feedback','seen_at','UPDATE') as acknowledge,has_column_privilege('authenticated','candidate_feedback','decision','UPDATE') as rewrite")).rows[0];
  assert.equal(grants.acknowledge,true);assert.equal(grants.rewrite,false);
  await db.exec('set role authenticated');
  await assert.rejects(()=>db.query("update candidate_feedback set decision='hired'"));
  await assert.rejects(()=>db.query("update intro_requests set message='Forged message'"));
  await db.exec('reset role');
  await db.exec('set role anon');
  for(const sql of ['select * from hiring_reviews','select * from hiring_activity',`select * from claim_posting_scores('${id(3)}')`])await assert.rejects(()=>db.query(sql));
  await db.exec('reset role');
 }finally{await db.close();}
});
test('CV scanning is immediate without an AI provider and carries source evidence',async()=>{
 const out=scanCandidate({posting:{screening_criteria:[{id:'criterion_1',label:'SQL',importance:'required'}]},cvText:'Built SQL reporting.'});
 assert.equal(out.match_score,null);assert.equal(out.assessment.criteria[0].evidence,'Built SQL reporting.');
 assert.equal(out.assessment.method,'literal_cv_evidence');
 const unknown=await scoreCandidate({posting:{},cvText:'A CV'});assert.equal(unknown.match_score,null);
});
