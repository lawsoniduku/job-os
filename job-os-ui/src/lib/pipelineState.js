// Browsing evidence is separate from the candidate's deliberate pipeline.
export const EARLY_STAGES = ['saved', 'shortlist', 'interested', 'cv_tailored', 'applied_intent'];
export const PIPELINE_COLUMNS = [
  {key:'saved', label:'Saved', statuses:['saved','shortlist','interested','cv_tailored']},
  {key:'applied', label:'Applied', statuses:['applied']},
  {key:'in_process', label:'In progress', statuses:['assessment','interview','in_process']},
  {key:'offer', label:'Offer', statuses:['offer']},
  {key:'closed', label:'Closed', statuses:['rejected','archived','closed']},
];

export function confirmedApplication(app) {
  return !!(app?.applied_at || app?.apply_outcome === 'applied');
}

export function pipelineColumn(app) {
  const col = PIPELINE_COLUMNS.find(c => c.statuses.includes(app?.status));
  // Older nudge answers and closing an unsent saved role produced false
  // Closed cards. Hide those records without deleting feedback or snapshots.
  if (col?.key === 'closed' && !confirmedApplication(app)) return null;
  return col?.key || null;
}

export function pendingApplyQuestion(app) {
  return !!(app?.apply_clicked_at && !app.apply_outcome &&
    !confirmedApplication(app) && EARLY_STAGES.includes(app.status));
}

export function applicationJobId(job) {
  // A pipeline row's id belongs to applications, not jobs. A pruned job_id
  // must stay null rather than accidentally becoming the application UUID.
  return job && Object.hasOwn(job, 'job_id') ? job.job_id : job?.id;
}

export function closePipelinePatch(app, at) {
  const col=pipelineColumn(app);
  if (!col || col==='closed') return null;
  if (col==='saved' && !confirmedApplication(app)) return {
    status:'applied_intent',apply_outcome:'abandoned',outcome_reason:'other',outcome_at:at,
  };
  // An explicitly tracked interview/offer is application history even on an
  // older row without an applied date. Do not invent that missing date.
  return {status:'closed',apply_outcome:'applied',outcome_at:at,outcome_reason:null};
}
