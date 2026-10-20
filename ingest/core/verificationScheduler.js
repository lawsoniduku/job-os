// Bound employer concurrency and pace Recruitee across tenant hostnames.
// A 429 defers unattempted work; it never proves vacancy closure.
import {verifyPosting,VERIFICATION_VERSION} from '../../api/postingVerification.js';
export function createVerificationScheduler({verify=verifyPosting,perHost=2,now=Date.now,
  recruiteeIntervalMs=600,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const hosts=new Map();
  const providers=new Map();
  const cap=Math.max(1,Math.min(4,Math.floor(perHost)||2));
  return async function scheduledVerification(row,options={}) {
    let host;
    try {host=new URL(row.apply_url).hostname;} catch {return verify(row,options);}
    let state=hosts.get(host);
    if(!state)hosts.set(host,state={active:0,waiters:[]});
    const recruitee=/^[a-z0-9-]+\.recruitee\.com$/i.test(host);
    const providerKey=recruitee?'recruitee.com':host;
    let provider=providers.get(providerKey);
    if(!provider)providers.set(providerKey,provider={until:0,nextAt:0});
    if(state.active>=cap) await new Promise(resolve=>state.waiters.push(resolve));
    else state.active++;
    try {
      const defer=()=>({v:VERIFICATION_VERSION,status:'unknown',deferred:true,checked_at:new Date(now()).toISOString(),evidence_url:row.apply_url,
        reason:`Provider cooldown; vacancy not checked. Retry after ${new Date(provider.until).toISOString()}`});
      if(provider.until>now())return defer();
      if(recruitee) {
        const start=Math.max(now(),provider.nextAt);
        provider.nextAt=start+Math.max(0,recruiteeIntervalMs);
        const wait=start-now();if(wait>0)await sleep(wait);
        if(provider.until>now())return defer();
      }
      const result=await verify(row,options);
      if(result.http_status===429)provider.until=Math.max(provider.until,now()+Math.max(1000,Math.min(3600000,result.retry_after_ms||60000)));
      return result;
    } finally {
      const next=state.waiters.shift();
      if(next)next();else state.active--;
    }
  };
}
