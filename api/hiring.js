import {Router} from 'express';
import {validateReview,hiringMetrics} from '../shared/hiringWorkflow.js';
import {analyzeHiringCv,analysisIsCurrent} from './hiringAnalysis.js';
import {runScoringQueue} from './ats.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function hiringRouter({supabase,requireAuth,requireEmployer,searchLimit,llmLimit}) {
 const r=Router();
 const analyzing=new Set();
 const scoped=[requireAuth,requireEmployer];
 const fail=(res,e)=>{console.error('[hiring]',e.code || e.message);return res.status(503).json({error:'Could not load hiring data. Please retry.'});};
 r.get('/employer/overview',...scoped,async(req,res)=>{
  try {
   const rows=[];let after=null;
   for(let page=0;page<100;page++) {
    let q=supabase.from('posting_submissions').select('id,posting_id,stage,stage_entered_at,created_at')
      .eq('org_id',req.orgId).order('id').limit(500);
    if(after)q=q.gt('id',after);
    const {data,error}=await q;if(error)throw error;
    rows.push(...data || []);
    if(!data || data.length<500)break;
    if(page===99)throw new Error('Hiring overview too large');
    after=data.at(-1).id;
   }
   const tasks=[];let taskCursor=null;
   for(let page=0;page<100;page++) {
    let q=supabase.from('hiring_reviews').select('submission_id,next_action,due_at').eq('org_id',req.orgId)
      .neq('next_action','').order('submission_id').limit(500);
    if(taskCursor)q=q.gt('submission_id',taskCursor);
    const {data,error}=await q;if(error)throw error;tasks.push(...data || []);
    if(!data || data.length<500)break;
    if(page===99)throw new Error('Hiring tasks too large');
    taskCursor=data.at(-1).submission_id;
   }
   const byId=new Map(rows.map(x=>[x.id,x]));
   for(const task of tasks)if(byId.has(task.submission_id))byId.get(task.submission_id).review=task;
   const active=tasks.filter(t=>byId.has(t.submission_id)&&!['rejected','withdrawn','hired'].includes(byId.get(t.submission_id).stage))
     .sort((a,b)=>(Date.parse(a.due_at)||Infinity)-(Date.parse(b.due_at)||Infinity));
   res.json({metrics:hiringMetrics(rows),tasks:active.slice(0,50).map(t=>({...t,posting_id:byId.get(t.submission_id).posting_id})),task_limit:50});
  }catch(e){return fail(res,e);}
 });
 r.get('/employer/submissions/:id/review',...scoped,async(req,res)=>{
  if(!uuid.test(req.params.id))return res.status(404).json({error:'Applicant not found.'});
  try {
   const {data:s,error}=await supabase.from('posting_submissions').select('id,updated_at,stage').eq('id',req.params.id).eq('org_id',req.orgId).maybeSingle();
   if(error)throw error;if(!s)return res.status(404).json({error:'Applicant not found.'});
   const [review,activity]=await Promise.all([
    supabase.from('hiring_reviews').select('next_action,due_at,scorecard,updated_at,ai_review').eq('submission_id',s.id).eq('org_id',req.orgId).maybeSingle(),
    supabase.from('hiring_activity').select('id,kind,body,created_at,actor_id').eq('submission_id',s.id).eq('org_id',req.orgId).order('created_at',{ascending:false}).limit(100),
   ]);
   if(review.error || activity.error)throw review.error || activity.error;
   let ai_review=null;
   if(review.data?.ai_review) {
    const {data:current,error}=await supabase.from('posting_submissions').select('cv_text,job_postings(screening_criteria)').eq('id',s.id).eq('org_id',req.orgId).maybeSingle();
    if(error)throw error;
    if(current && analysisIsCurrent(review.data.ai_review,current.job_postings,current.cv_text))ai_review=review.data.ai_review;
   }
   res.json({review:review.data?{...review.data,ai_review:undefined}:null,ai_review,activity:activity.data || [],updated_at:s.updated_at,stage:s.stage});
  }catch(e){return fail(res,e);}
 });
 r.patch('/employer/submissions/:id/review',...scoped,searchLimit,async(req,res)=>{
  if(!uuid.test(req.params.id))return res.status(404).json({error:'Applicant not found.'});
  let review;try{review=validateReview(req.body);}catch(e){return res.status(400).json({error:e.message});}
  const expected=req.body?.expected_updated_at;
  if(!expected || !Number.isFinite(Date.parse(expected)))return res.status(400).json({error:'Reload the applicant before saving.'});
  try {
   if(review.scorecard) {
    const {data:s,error}=await supabase.from('posting_submissions').select('job_postings(screening_criteria)')
      .eq('id',req.params.id).eq('org_id',req.orgId).maybeSingle();
    if(error)throw error;if(!s)return res.status(404).json({error:'Applicant not found.'});
    const allowed=new Set((s.job_postings?.screening_criteria || []).map(c=>c.id));
    const ids=review.scorecard.ratings.map(c=>c.criterion_id);
    if(ids.some(id=>!allowed.has(id)) || new Set(ids).size!==ids.length)return res.status(400).json({error:'The criteria changed. Reload this applicant.'});
   }
   const {error}=await supabase.rpc('save_hiring_review',{p_org:req.orgId,p_actor:req.user.id,p_submission:req.params.id,p_expected:expected,p_review:review});
   if(error) {
    const status=error.code==='40001'?409:error.code==='P0002'?404:['42501','23514'].includes(error.code)?400:503;
    return res.status(status).json({error:status===409?'This applicant changed. Reload before saving.':status===404?'Applicant not found.':'Could not save this review. Reload and retry.'});
   }
   res.json({saved:true});
  }catch(e){return fail(res,e);}
 });
 r.post('/employer/submissions/:id/analyze',...scoped,llmLimit || searchLimit,async(req,res)=>{
  if(!uuid.test(req.params.id))return res.status(404).json({error:'Applicant not found.'});
  const key=req.orgId+':'+req.params.id;
  if(analyzing.has(key))return res.status(409).json({error:'This CV is already being reviewed. Try again shortly.'});
  analyzing.add(key);
  try {
   const {data:s,error}=await supabase.from('posting_submissions').select('id,cv_text,job_postings(title,screening_criteria)').eq('id',req.params.id).eq('org_id',req.orgId).maybeSingle();
   if(error)throw error;if(!s)return res.status(404).json({error:'Applicant not found.'});
   if(!s.job_postings?.screening_criteria?.length)return res.status(400).json({error:'Set screening criteria on this role first.'});
   const analysis=await analyzeHiringCv({posting:s.job_postings,cvText:s.cv_text});
   const {error:write}=await supabase.from('hiring_reviews').upsert({submission_id:s.id,org_id:req.orgId,ai_review:analysis,updated_by:req.user.id,updated_at:new Date().toISOString()},{onConflict:'submission_id'});
   if(write)throw write;
   // The read endpoint hides stale analyses if CV or criteria changed in flight.
   res.json({analyzed:true});
  }catch(e){
   console.error('[hiring] AI review:',e.code || e.message);
   return res.status(e.rateLimited || e.deferred?429:503).json({error:e.rateLimited || e.deferred?'AI capacity is temporarily full. Your CV scan and manual review remain available.':'AI review is unavailable right now. Your CV scan and manual review remain available.'});
  }finally{analyzing.delete(key);}
 });
 r.post('/employer/postings/:id/rescan',...scoped,searchLimit,async(req,res)=>{
  if(!uuid.test(req.params.id))return res.status(404).json({error:'Posting not found.'});
  try {
   const {data:p,error}=await supabase.from('job_postings').select('id').eq('id',req.params.id).eq('org_id',req.orgId).maybeSingle();
   if(error)throw error;if(!p)return res.status(404).json({error:'Posting not found.'});
   const {error:write}=await supabase.from('posting_submissions').update({score_status:'pending'})
    .eq('posting_id',p.id).eq('org_id',req.orgId).eq('score_status','failed');
   if(write)throw write;
   void runScoringQueue(supabase,p.id);
   res.status(202).json({queued:true});
  }catch(e){return fail(res,e);}
 });
 return r;
}
