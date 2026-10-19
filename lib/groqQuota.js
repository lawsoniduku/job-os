/** Groq admission control for background enrichment. No keys, prompts or job data.
 * Header semantics: https://console.groq.com/docs/rate-limits (2026-10-19).
 * Request headers describe RPD; token headers describe TPM, never TPD.
 */
const finite = value => ['string','number'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;
function duration(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const input=value.trim();
  if (/^\d+(?:\.\d+)?$/.test(input)) {const ms=Number(input)*1000;return Number.isFinite(ms)?ms:undefined;}
  let total=0, consumed='';
  for (const match of input.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) {
    total+=Number(match[1])*({ms:1,s:1000,m:60000,h:3600000,d:86400000}[match[2]]); consumed+=match[0];
  }
  return consumed===input && Number.isFinite(total) ? total : undefined;
}
export function parseGroqQuota(headers={}, now=Date.now()) {
  const get=name=>headers.get?.(name) ?? headers[name] ?? Object.entries(headers).find(([key])=>key.toLowerCase()===name)?.[1];
  const after=value=>{const ms=duration(value);return ms===undefined || !Number.isFinite(now+ms) || now+ms>8640000000000000?undefined:now+ms;};
  const retry=get('retry-after');
  return Object.fromEntries(Object.entries({
    retryAt:after(retry) ?? (typeof retry==='string' && Number.isFinite(Date.parse(retry)) ? Math.max(now,Date.parse(retry)):undefined),
    remainingRequests:finite(get('x-ratelimit-remaining-requests')), remainingTokens:finite(get('x-ratelimit-remaining-tokens')),
    requestsResetAt:after(get('x-ratelimit-reset-requests')), tokensResetAt:after(get('x-ratelimit-reset-tokens')),
  }).filter(([,value])=>value!==undefined));
}
export function quotaDeferral(reason,retryAt,{requestMade=false,rateLimited=false}={}) {
  return Object.assign(new Error(`Eligibility enrichment deferred: ${reason}${retryAt ? ` until ${new Date(retryAt).toISOString()}`:''}`),
    {deferred:true,rateLimited,requestMade,reason,retryAt});
}
export function createGroqQuota({model='unknown',state,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  maxWaitMs=60000,maxRequests=100,maxTokens=60000,requestReserve=100,tokenReserve=1000}={}) {
  const initial=state?.v===1 && state.model===model ? state : {};
  // Persist observations, never per-run consumption: each new run has its own cap.
  const q={};
  for(const key of ['remainingRequests','remainingTokens','requestsResetAt','tokensResetAt','blockedUntil']) {
    if(finite(initial[key])!==undefined && (!key.endsWith('At') && key!=='blockedUntil' || Number(initial[key])<=8640000000000000))q[key]=Number(initial[key]);
  }
  let runRequests=0,runTokens=0,waitedMs=0,lock=Promise.resolve();
  const snapshot=()=>({v:1,model,...q,runRequests,runTokens,waitedMs,limits:{maxRequests,maxTokens,requestReserve,tokenReserve}});
  const expire=()=>{
    if(q.requestsResetAt && q.requestsResetAt<=now()){delete q.remainingRequests;delete q.requestsResetAt;}
    if(q.tokensResetAt && q.tokensResetAt<=now()){delete q.remainingTokens;delete q.tokensResetAt;}
    if(q.blockedUntil && q.blockedUntil<=now())delete q.blockedUntil;
  };
  function observe(headers={},usage,estimatedTokens=0) {
    expire();
    Object.assign(q,parseGroqQuota(headers,now()));
    delete q.retryAt;
    if(q.remainingRequests!==undefined && !q.requestsResetAt)q.requestsResetAt=now()+86400000;
    if(q.remainingTokens!==undefined && !q.tokensResetAt)q.tokensResetAt=now()+60000;
    const actual=finite(usage?.total_tokens);
    if(actual!==undefined)runTokens+=actual-estimatedTokens;
  }
  function rateLimited(headers={}) {
    const data=parseGroqQuota(headers,now());observe(headers);
    // Retry-After is authoritative, including daily/token-day limits not exposed
    // by the remaining-* headers. Missing hints get one conservative minute.
    q.blockedUntil=Math.max(now()+1000,data.retryAt || now()+60000,
      data.remainingRequests===0 ? data.requestsResetAt || now()+86400000 : 0,
      data.remainingTokens===0 ? data.tokensResetAt || 0 : 0);
    return quotaDeferral('provider_rate_limit',q.blockedUntil,{requestMade:true,rateLimited:true});
  }
  async function admit(estimatedTokens) {
    expire();
    if(runRequests>=maxRequests)throw quotaDeferral('run_request_budget');
    if(runTokens+estimatedTokens>maxTokens)throw quotaDeferral('run_token_budget');
    if(q.remainingRequests!==undefined && q.remainingRequests<=requestReserve)
      throw quotaDeferral('request_reserve',q.requestsResetAt || now()+86400000);
    let waitUntil=q.blockedUntil || 0;
    if(q.remainingTokens!==undefined && q.remainingTokens<estimatedTokens+tokenReserve)
      waitUntil=Math.max(waitUntil,q.tokensResetAt || now()+60000);
    if(waitUntil>now()) {
      const wait=waitUntil-now()+250;
      if(wait>maxWaitMs)throw quotaDeferral('quota_reset',waitUntil);
      await sleep(wait);waitedMs+=wait;expire();
    }
    // Reserve before releasing the lock so concurrent workers cannot overspend
    // the same response observation. Unknown account limits are not invented.
    runRequests++;runTokens+=estimatedTokens;
    if(q.remainingRequests!==undefined)q.remainingRequests--;
    if(q.remainingTokens!==undefined)q.remainingTokens=Math.max(0,q.remainingTokens-estimatedTokens);
  }
  return {snapshot,observe,rateLimited,beforeRequest(estimatedTokens=0){
    const task=lock.then(()=>admit(Math.max(0,Math.ceil(estimatedTokens))));
    lock=task.catch(()=>{});return task;
  }};
}
