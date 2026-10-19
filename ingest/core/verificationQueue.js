import {ACTIVE_JOB_SOURCES} from '../../api/sourcePolicy.js';
import {publicationFilter,sourceVisibilityFilter} from '../../api/jobFreshness.js';

export function verificationQuery(db,{limit=500,source=null,recheckDays=1,now=Date.now()}={}) {
  if(source && !ACTIVE_JOB_SOURCES.includes(source)) throw new Error(`Unsupported --source: ${source}`);
  const staleBefore=new Date(now-recheckDays*864e5).toISOString();
  let q=db.from('jobs')
    .select('id, source, ats_source, apply_url, title, company, link_status, link_checked_at, elig_signals')
    .in('source',ACTIVE_JOB_SOURCES)
    .or(sourceVisibilityFilter(now))
    .or(publicationFilter(now))
    .or(`link_checked_at.is.null,link_checked_at.lt.${staleBefore}`);
  if(source)q=q.eq('source',source);
  return q.order('link_checked_at',{ascending:true,nullsFirst:true}).order('id',{ascending:true}).limit(limit);
}
