// Per-employer pressure control for scheduled checks. A provider's 429 applies
// to this run's host, never proves anything about another vacancy's liveness.
import {verifyPosting,VERIFICATION_VERSION} from '../../api/postingVerification.js';
export function createVerificationScheduler({verify=verifyPosting,perHost=2,now=Date.now}={}) {
  const hosts=new Map();
  const cap=Math.max(1,Math.min(4,Math.floor(perHost)||2));
  return async function scheduledVerification(row,options={}) {
    let host;
    try {host=new URL(row.apply_url).hostname;} catch {return verify(row,options);}
    let state=hosts.get(host);
    if(!state)hosts.set(host,state={active:0,waiters:[],until:0});
    if(state.active>=cap) await new Promise(resolve=>state.waiters.push(resolve));
    else state.active++;
    try {
      if(state.until>now())return {v:VERIFICATION_VERSION,status:'unknown',checked_at:new Date(now()).toISOString(),evidence_url:row.apply_url,
        reason:`Provider cooldown; vacancy not checked. Retry after ${new Date(state.until).toISOString()}`};
      const result=await verify(row,options);
      if(result.http_status===429)state.until=Math.max(state.until,now()+Math.max(1000,Math.min(3600000,result.retry_after_ms||60000)));
      return result;
    } finally {
      const next=state.waiters.shift();
      if(next)next();else state.active--;
    }
  };
}
