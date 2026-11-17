/** Outbound clicks are browsing evidence; only explicit actions enter Pipeline. */
import { supabase } from './supabaseClient';
import { track } from './track';
import { createApplicationTracking } from './applicationTracking';
import { applicationJobId } from './pipelineState';
export { EARLY_STAGES } from './pipelineState';

export const PIPELINE_CHANGED = 'jobcopilot:pipeline-changed';
export function notifyPipelineChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PIPELINE_CHANGED));
}
const tracking=createApplicationTracking({client:supabase,onChange:notifyPipelineChanged});

// Never await before navigation. A slow or failed tracking write must not stop
// the user opening the actual employer's application form.
export function recordApplyIntent({user,job,source='unknown'}) {
  if (!job) return;
  track(user,'apply_clicked',{job_id:applicationJobId(job),company:job.company,source});
  void tracking.recordClick({user,job});
}
export function openApply({user,job,source='unknown'}) {
  if (!job?.apply_url) return;
  window.open(job.apply_url,'_blank','noopener');
  recordApplyIntent({user,job,source});
}
export const resolveApplyIntent=(app,outcome,reason=null)=>tracking.resolve(app,outcome,reason);
export const persistPipelineJob=args=>tracking.persist(args);

export async function markNudged(app) {
  if (!supabase || !app?.id || !app.user_id) return;
  await supabase.from('applications')
    .update({nudge_count:(app.nudge_count || 0)+1,nudged_at:new Date().toISOString()})
    .eq('id',app.id).eq('user_id',app.user_id);
}
