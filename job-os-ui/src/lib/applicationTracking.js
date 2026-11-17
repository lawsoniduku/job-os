import { EARLY_STAGES, applicationJobId, confirmedApplication, pendingApplyQuestion, pipelineColumn } from './pipelineState.js';

const changedError = () => new Error('This job changed while you were updating it. Please try again.');
const result = (error=null, app=null, changed=false) => ({error, app, changed});
const matchField=(query,key,value)=>value==null ? query.is(key,null) : query.eq(key,value);

// The database client is supplied so the exact production writes can be tested
// against isolated Postgres, rather than copying transition rules into tests.
export function createApplicationTracking({client, now=()=>new Date().toISOString(), onChange=()=>{}}) {
  function notify(data) {
    if (data?.length) onChange();
    return result(null, data?.[0] || null, !!data?.length);
  }
  function snapshot(user, job) {
    return {
      user_id:user.id, job_id:applicationJobId(job), job_title:job.title || job.job_title || null,
      company:job.company || null, location:job.location || null, apply_url:job.apply_url || null,
      salary_min:job.salary_min ?? null, salary_max:job.salary_max ?? null, source:job.source || null,
      role_cluster:job.role_cluster || null, verdict:job.verdict || null,
      verdict_reason:job.verdict_reason || job.eligibility?.reason || null,
    };
  }
  async function recordClick({user, job}) {
    if (!client || !user?.id || !applicationJobId(job)) return result();
    try {
      const at=now();
      const inserted=await client.from('applications').upsert({
        ...snapshot(user,job), status:'applied_intent', apply_clicked_at:at,
      }, {onConflict:'user_id,job_id',ignoreDuplicates:true});
      if (inserted.error) return result(inserted.error);
      const current=await client.from('applications').select('*')
        .eq('user_id',user.id).eq('job_id',applicationJobId(job)).maybeSingle();
      if (current.error) return result(current.error);
      const app=current.data;
      if (!app || !EARLY_STAGES.includes(app.status) || confirmedApplication(app) ||
        (app.outcome_at && Date.parse(app.outcome_at)>=Date.parse(at)) ||
        Date.parse(app.apply_clicked_at)>Date.parse(at)) return result();
      // Reopening Saved keeps Saved. Clicking is never a stage transition.
      let update=client.from('applications')
        .update({apply_clicked_at:at,apply_outcome:null,outcome_reason:null,outcome_at:null})
        .eq('user_id',user.id).eq('job_id',applicationJobId(job))
        .eq('status',app.status).is('applied_at',null);
      for (const key of ['apply_outcome','outcome_at','apply_clicked_at']) update=matchField(update,key,app[key]);
      if (app.updated_at) update=update.eq('updated_at',app.updated_at);
      const {data,error}=await update.select('id,status');
      return error ? result(error) : notify(data);
    } catch(error) { return result(error); }
  }
  async function resolve(app, outcome, reason=null) {
    if (!client || !app?.id || !app.user_id || !['applied','not_yet','abandoned'].includes(outcome))
      return result(new Error('No valid application answer'));
    if (!pendingApplyQuestion(app)) return result();
    try {
      const at=now();
      const patch={apply_outcome:outcome,outcome_reason:reason,outcome_at:at,
        status:outcome==='applied' ? 'applied' : outcome==='not_yet' ? 'saved' : 'applied_intent'};
      if (outcome==='applied') patch.applied_at=at;
      // One atomic write: a failure cannot save an outcome without its stage.
      // A later explicit save, application or a newer click beats a stale nudge.
      const {data,error}=await client.from('applications').update(patch)
        .eq('id',app.id).eq('user_id',app.user_id).in('status',EARLY_STAGES)
        .is('applied_at',null).is('apply_outcome',null)
        .eq('apply_clicked_at',app.apply_clicked_at).select('id,status,applied_at');
      return error ? result(error) : notify(data);
    } catch(error) { return result(error); }
  }
  async function persist({user, job, status, cvLabel}) {
    if (!client || !user?.id || !applicationJobId(job) || !['saved','applied'].includes(status))
      return result(new Error('Sign in to track this job'));
    try {
      const at=now(), patch={status,apply_outcome:status==='applied'?'applied':'not_yet',outcome_at:at,outcome_reason:null};
      if (status==='applied') patch.applied_at=at;
      if (cvLabel) patch.cv_label=cvLabel;
      const inserted=await client.from('applications').upsert({...snapshot(user,job),...patch},
        {onConflict:'user_id,job_id',ignoreDuplicates:true}).select('id,status,applied_at');
      if (inserted.error) return result(inserted.error);
      if (inserted.data?.length) return notify(inserted.data);
      const current=await client.from('applications').select('*')
        .eq('user_id',user.id).eq('job_id',applicationJobId(job)).maybeSingle();
      if (current.error) return result(current.error);
      const app=current.data;
      if (!app) return result(changedError());
      // Also allow deliberately re-saving an old false Closed entry. Genuine
      // applications, including closed history, retain their stage and dates.
      const editable=!confirmedApplication(app) &&
        (EARLY_STAGES.includes(app.status) || pipelineColumn(app)===null);
      if (!editable) return result(null,app);
      let update=client.from('applications').update(patch).eq('id',app.id)
        .eq('user_id',user.id).eq('status',app.status).is('applied_at',null);
      for (const key of ['apply_outcome','outcome_at','apply_clicked_at']) update=matchField(update,key,app[key]);
      if (app.updated_at) update=update.eq('updated_at',app.updated_at);
      const {data,error}=await update.select('id,status,applied_at');
      return error ? result(error) : data?.length ? notify(data) : result(changedError());
    } catch(error) { return result(error); }
  }
  return {recordClick,resolve,persist};
}
