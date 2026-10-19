import {ACTIVE_JOB_SOURCES} from '../../api/sourcePolicy.js';
import {VERIFICATION_VERSION} from '../../api/postingVerification.js';
import {publicationFilter,sourceVisibilityFilter} from '../../api/jobFreshness.js';

export function verificationQuery(db,{limit=500,source=null,recheckDays=1,now=Date.now()}={}) {
  if(source && !ACTIVE_JOB_SOURCES.includes(source)) throw new Error(`Unsupported --source: ${source}`);
  const staleBefore=new Date(now-recheckDays*864e5).toISOString();
  let q=db.from('jobs')
    .select('id, source, ats_source, apply_url, title, company, link_status, link_checked_at, elig_signals')
    .in('source',ACTIVE_JOB_SOURCES)
    .or(sourceVisibilityFilter(now))
    .or(publicationFilter(now))
    .or(`link_checked_at.is.null,link_checked_at.lt.${staleBefore},elig_signals->verification->>v.is.null,elig_signals->verification->>v.neq.${VERIFICATION_VERSION}`);
  // Unsupported shapes cannot gain evidence by repeating the same code. A new
  // verifier version automatically makes them due again; search retains them.
  q=q.or(`elig_signals->verification->>retryable.is.null,elig_signals->verification->>retryable.neq.false,elig_signals->verification->>v.is.null,elig_signals->verification->>v.neq.${VERIFICATION_VERSION}`);
  if(source)q=q.eq('source',source);
  return q.order('link_checked_at',{ascending:true,nullsFirst:true}).order('id',{ascending:true}).limit(limit);
}

// Keep each PostgREST query on one indexed source instead of repeatedly
// filtering/sorting every maintained source's JSON metadata as the queue drains.
// Rotate nonempty pages so a large board does not hide smaller sources.
export function createSourceVerificationSelector(fetchPage,{source=null,sources=ACTIVE_JOB_SOURCES}={}) {
  if(source && !ACTIVE_JOB_SOURCES.includes(source))throw new Error(`Unsupported --source: ${source}`);
  const pending=[...new Set(source?[source]:sources)];
  if(pending.some(s=>!ACTIVE_JOB_SOURCES.includes(s)))throw new Error('Unsupported verification source');
  return async function select(limit=500) {
    if(!Number.isInteger(limit) || limit<1 || limit>500)throw new Error('Invalid verification page size');
    while(pending.length) {
      const current=pending[0];
      const rows=await fetchPage(current,limit);
      if(!Array.isArray(rows))throw new Error('Verification source returned an invalid page');
      pending.shift();
      if(rows.length){pending.push(current);return rows;}
    }
    return [];
  };
}
