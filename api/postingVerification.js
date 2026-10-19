// Current, public posting evidence. No model guesses and no arbitrary URL fetches.
import { updateJobSignals, mergePostingObservation } from '../ingest/core/jobSignalsWriter.js';
import { cleanText } from '../ingest/core/normalize.js';
import { extractEligibilitySignals, SIGNALS_VERSION } from './roleIntelligence.js';

export const VERIFICATION_VERSION = 3;
const TTL = 6 * 60 * 60 * 1000;
const cache = new Map();
const recruiteeTenant = hostname => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.recruitee\.com$/i.test(hostname);
const hosts = ['bamboohr.com', 'apply.workable.com', 'jobs.ashbyhq.com', 'api.ashbyhq.com', 'job-boards.greenhouse.io', 'boards.greenhouse.io', 'boards-api.greenhouse.io', 'boards-api.eu.greenhouse.io', 'api.lever.co', 'jobs.lever.co', 'canonical.com'];
const allowed = (u) => u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && (recruiteeTenant(u.hostname) || hosts.some(h => u.hostname === h || (h === 'bamboohr.com' && u.hostname.endsWith('.bamboohr.com'))));
const list = v => v == null ? [] : Array.isArray(v) ? v : [v];
function countryName(v) {
  const name = typeof v === 'object' ? v?.name : v;
  if (/^[A-Z]{2}$/.test(name || '')) { try { return new Intl.DisplayNames(['en'], {type:'region'}).of(name); } catch {} }
  return name || '';
}
export function locationText(v) {
  if (typeof v === 'string') return countryName(v);
  if (!v) return '';
  const a = v.address || v;
  return [a.addressLocality || a.city, a.addressRegion || a.state || a.region, countryName(a.addressCountry || a.country)].filter(Boolean).join(', ') || countryName(v.name) || '';
}
export function nonVacancyReason(job) {
  const title = String(job.title || '');
  const desc = String(job.description || '');
  if (/\b(internal (?:vacancy|applicants?|candidates?) only|internal[- ]only|internal vacancy)\b/i.test(title + '\n' + desc)) return 'Internal applicants only';
  if (/\b(talent (?:pool|community|network)|general (?:interest|application)|expression(?:s)? of interest|future opportunities)\b/i.test(title) || (/^(?:[a-z]{2,3}\s+)?talent pool\b/i.test(desc.trim()) && desc.length < 300)) return 'Talent pool, not a current vacancy';
  return null;
}
export function redirectedToIndex(original, final) {
  const a = new URL(original), b = new URL(final);
  // Only a recognised listing index proves removal. Login/locale/tracking
  // redirects are not evidence that a vacancy is closed. Numeric IDs can be 1 digit.
  return a.pathname !== b.pathname && /^\/(?:careers|jobs|(?:[^/]+\/)?careers)?\/?$/i.test(b.pathname);
}
function decode(s) {
  return String(s || '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
export function parseJobPosting(html) {
  const found = [];
  const visit = v => { if (!v || typeof v !== 'object') return; if (list(v['@type']).includes('JobPosting')) found.push(v); if (Array.isArray(v)) v.forEach(visit); if(v['@graph']) visit(v['@graph']); };
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    // Some boards put literal newline/tab controls inside JSON string values.
    let quoted = false, escaped = false, repaired = '';
    for (const c of m[1]) {
      if (c === '"' && !escaped) quoted = !quoted;
      repaired += quoted && c.charCodeAt(0) < 32 ? JSON.stringify(c).slice(1,-1) : c;
      escaped = c === '\\' && !escaped;
    }
    try { visit(JSON.parse(repaired)); } catch {}
  }
  return found;
}
async function readResponse(url, fetcher, signal, expectedOrigin) {
  let current = new URL(url);
  for(let i=0;i<5;i++) {
    if(!allowed(current) || (expectedOrigin && current.origin !== expectedOrigin)) throw new Error('Unsupported posting host');
    const r = await fetcher(current.href, {redirect:'manual',signal,headers:{'User-Agent':'JobCopilotVerification/1.0','Accept':'application/json,text/html'}});
    if ([301,302,303,307,308].includes(r.status)) {
      const next = new URL(r.headers.get('location'),current);
      if(expectedOrigin && next.origin !== expectedOrigin) throw new Error('Unexpected employer redirect');
      if(redirectedToIndex(url,next.href)) return {status:'dead',reason:'Posting redirects to a listings index'};
      current = next; continue;
    }
    if([404,410].includes(r.status)) return {status:'dead',reason:'Posting removed'};
    if(!r.ok) throw new Error('Posting could not be checked');
    // Bound body size and keep the abort signal active while consuming it.
    let text = ''; const reader = r.body?.getReader();
    if(reader) { const decoder = new TextDecoder(); let size=0; for(;;) { const {value,done}=await reader.read(); if(done)break; size+=value.length; if(size>2_000_000){await reader.cancel();throw new Error('Posting too large');} text+=decoder.decode(value,{stream:true}); } text+=decoder.decode(); }
    else text = await r.text();
    return {text,url:current.href};
  }
  throw new Error('Too many redirects');
}
// Recruitee emits UTC timestamps with spaces. Accept only explicit time zones;
// a malformed or ambiguous deadline cannot prove that a vacancy is closed.
function explicitTimestamp(value) {
  if(typeof value !== 'string') return NaN;
  const normalized=value.trim().replace(/ UTC$/, 'Z').replace(' ', 'T');
  const m=normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  if(!m) return NaN;
  const [,year,month,day,hour,minute,second]=m.map(Number);
  if(year<1000 || month<1 || month>12 || day<1 || day>new Date(Date.UTC(year,month,0)).getUTCDate() || hour>23 || minute>59 || second>59) return NaN;
  return Date.parse(normalized);
}
export async function verifyPosting(job, {fetcher=fetch, now=Date.now(), timeoutMs=12000, signal}={}) {
  const at = new Date(now).toISOString();
  const unknown = reason => ({v:VERIFICATION_VERSION,status:'unknown',checked_at:at,reason});
  const ctrl = new AbortController(), timer = setTimeout(()=>ctrl.abort(),timeoutMs);
  const abort=()=>ctrl.abort();
  if(signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort',abort,{once:true});
  try {
    let u = new URL(job.apply_url);
    if(!allowed(u)) return unknown('Source cannot yet be verified');
    let path = u.pathname, provider = 'structured posting', payload;
    const recruitee=recruiteeTenant(u.hostname);
    const offerPath=path.match(/^\/o\/([a-z0-9][a-z0-9-]*)(?:\/c\/new)?\/?$/i);
    if(recruitee && !offerPath) return unknown('Unsupported employer vacancy URL');
    const gh=path.match(/^\/([^/]+)\/jobs\/(\d+)/);
    const lever=path.match(/^\/([^/]+)\/([a-f0-9-]+)(?:\/apply)?\/?$/i);
    if(recruitee) {
      const slug=offerPath[1];
      const r=await readResponse(`${u.origin}/api/offers/${slug}`,fetcher,ctrl.signal,u.origin);
      if(r.status)return {...r,v:VERIFICATION_VERSION,checked_at:at};
      const j=JSON.parse(r.text)?.offer;
      const normalizedTitle=s=>cleanText(decode(s),Infinity).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
      if(!j || j.slug!==slug || !((typeof j.id==='number' && j.id>0) || (typeof j.id==='string' && /^\d+$/.test(j.id))) || typeof j.title!=='string' || !normalizedTitle(j.title) || normalizedTitle(j.title)!==normalizedTitle(job.title)) return unknown('Exact employer vacancy could not be verified');
      if(['draft','closed','archived','unpublished','internal'].includes(j.status)) return {v:VERIFICATION_VERSION,status:'dead',checked_at:at,reason:'Vacancy is not published'};
      if(j.status!=='published') return unknown('Employer vacancy status unavailable');
      if(explicitTimestamp(j.close_at)<now) return {v:VERIFICATION_VERSION,status:'dead',checked_at:at,reason:'Posting has expired'};
      if(typeof j.description!=='string' || !cleanText(decode(j.description),Infinity)) return unknown('Posting description is missing');
      if(j.requirements!=null && typeof j.requirements!=='string') return unknown('Employer requirements unavailable');
      provider='employer';
      // For remote vacancies, country/city/locations describe office metadata,
      // not applicant residency. The full body still supplies hiring limits.
      const remote=j.remote===true;
      const location=typeof j.location==='string' ? j.location.trim() : '';
      payload={title:j.title,description:[j.description,typeof j.requirements==='string'?j.requirements:''].filter(Boolean).join('\n'),location:location || (remote?'Remote':list(j.locations).map(locationText).filter(Boolean).join('; ') || locationText(j)),remote};
    } else if(['job-boards.greenhouse.io','boards.greenhouse.io'].includes(u.hostname) && gh) {
      const r=await readResponse(`https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs/${gh[2]}`,fetcher,ctrl.signal);
      if(r.status)return {...r,v:VERIFICATION_VERSION,checked_at:at};
      const j=JSON.parse(r.text);
      if(!j.id || !j.content)return unknown('Employer vacancy details unavailable');
      provider='employer';
      payload={title:j.title,description:j.content,location:j.location?.name||'',remote:/remote|home[- ]?based|worldwide|anywhere/i.test(j.location?.name||'')};
    } else if(u.hostname==='jobs.lever.co' && lever) {
      const r=await readResponse(`https://api.lever.co/v0/postings/${lever[1]}/${lever[2]}?mode=json`,fetcher,ctrl.signal);
      if(r.status)return {...r,v:VERIFICATION_VERSION,checked_at:at};
      const j=JSON.parse(r.text);
      if(!j.id || !j.text)return unknown('Employer vacancy details unavailable');
      provider='employer';
      payload={title:j.text,description:[j.description,...(j.lists||[]).map(l=>l.content),j.additional].filter(Boolean).join('\n'),location:j.categories?.location||'',remote:j.workplaceType==='remote'};
    } else if(u.hostname.endsWith('.bamboohr.com') && /^\/careers\/\d+\/?$/.test(path)) {
      const r = await readResponse(u.origin + path.replace(/\/$/,'') + '/detail',fetcher,ctrl.signal);
      if(r.status) return {...r,v:VERIFICATION_VERSION,checked_at:at};
      const j=JSON.parse(r.text)?.result?.jobOpening;
      if(!j) return unknown('No current vacancy details');
      if(j.jobOpeningStatus !== 'Open') return {v:VERIFICATION_VERSION,status:'dead',checked_at:at,reason:'Vacancy is not open'};
      provider='employer';
      payload={title:j.jobOpeningName,description:j.description,location:locationText(j.atsLocation || j.location),remote:String(j.locationType)==='1'};
    } else {
      const r=await readResponse(u.href,fetcher,ctrl.signal);
      if(r.status) return {...r,v:VERIFICATION_VERSION,checked_at:at};
      u=new URL(r.url);
      const wm=u.pathname.match(/^\/([^/]+)\/j\/([A-Z0-9]+)(?:\/apply)?\/?$/i);
      if(u.hostname==='apply.workable.com' && wm) {
        const d=await readResponse(`${u.origin}/api/v2/accounts/${wm[1]}/jobs/${wm[2]}`,fetcher,ctrl.signal);
        if(d.status)return {...d,v:VERIFICATION_VERSION,checked_at:at};
        const j=JSON.parse(d.text);
        if(j.state !== 'published' || j.isInternal) return {v:VERIFICATION_VERSION,status:'dead',checked_at:at,reason:j.isInternal?'Internal applicants only':'Vacancy is not published'};
        provider='employer';
        payload={title:j.title,description:[j.description,j.requirements,j.benefits].filter(Boolean).join('\n'),location:list(j.locations?.length?j.locations:j.location).map(locationText).filter(Boolean).join('; '),remote:j.remote===true};
      } else {
        if(/verify you are human|checking your browser|just a moment/i.test(r.text.slice(0,5000))) return unknown('Source verification blocked');
        const postings=parseJobPosting(r.text);
        const normalize=s=>cleanText(decode(s),Infinity).toLowerCase().replace(/[^a-z0-9]/g,'');
        const j=postings.find(j=>normalize(j.title)===normalize(job.title));
        if(!j) return unknown('Exact vacancy could not be verified');
        if(j.validThrough && Date.parse(j.validThrough)<now) return {v:VERIFICATION_VERSION,status:'dead',checked_at:at,reason:'Posting has expired'};
        const loc=list(j.applicantLocationRequirements?.length?j.applicantLocationRequirements:j.applicantLocationRequirements || j.jobLocation).map(locationText).filter(Boolean).join('; ');
        const description=cleanText(decode(j.description),Infinity);
        if(!description) return unknown('Posting description is missing');
        provider='employer';
        payload={title:decode(j.title),description,location:loc || '',remote:j.jobLocationType==='TELECOMMUTE' || /remote/i.test(loc)};
      }
    }
    payload.description=cleanText(decode(payload.description),Infinity);
    const reason=nonVacancyReason(payload);
    if(reason)return {v:VERIFICATION_VERSION,status:'dead',checked_at:at,reason};
    if(!payload.title || !payload.description) return unknown('Incomplete posting evidence');
    return {v:VERIFICATION_VERSION,status:'ok',checked_at:at,provider,...payload};
  } catch { return unknown('Current posting could not be verified'); }
  finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function compactVerification(v) {
  if(v.status!=='ok')return v;
  const {description,...rest}=v;
  return {...rest,signals:extractEligibilitySignals(v)};
}
// Keep the last conclusive evidence across transient failures, in both cron and search.
// A newer conclusive response replaces it; unknown responses never erase it.
export function retainVerificationEvidence(current, previous) {
  if (current.status === 'ok' || current.status === 'dead') return current;
  const known = [current.last_known, previous?.status === 'ok' || previous?.status === 'dead'
    ? previous : previous?.last_known].filter(Boolean)
    .sort((a,b)=>(Date.parse(b.checked_at)||0)-(Date.parse(a.checked_at)||0))[0];
  return known ? {...current, last_known: known} : current;
}
export function applyVerification(job, incoming) {
  const v = retainVerificationEvidence(incoming, job.elig_signals?.verification);
  const evidence = v.status === 'ok' || v.status === 'dead' ? v : v.last_known;
  if (evidence?.status === 'dead') return {...job, verification: {...v, status:'dead'}};
  if (evidence?.status === 'ok') {
    const changedAt=Date.parse(job.elig_signals?.source?.changed_at);
    if (Number.isFinite(changedAt) && changedAt > (Date.parse(evidence.checked_at) || 0)) {
      // Preserve the old observation for retries, but it cannot override newer
      // source requirements. Positive source claims stay unconfirmed until rechecked.
      return {...job,elig_signals:{...(job.elig_signals || extractEligibilitySignals(job)),descriptionMissing:true,verification:v},
        verification:{status:'pending',checked_at:v.checked_at,reason:'Posting content changed; employer recheck required'}};
    }
    const fresh={...job,title:evidence.title,description:evidence.description,location:evidence.location,remote:evidence.remote,apply_url:evidence.apply_url || job.apply_url};
    // Discard stored model inference in favour of the last complete posting evidence.
    const signals=evidence.signals;
    if(signals?.v===SIGNALS_VERSION) fresh.elig_signals=signals;
    else if(typeof evidence.description==='string' && evidence.description.trim()) fresh.elig_signals=extractEligibilitySignals(fresh);
    // Compact old checks have no full body to re-extract. Retain their known
    // restrictions across failures, but mark positives unconfirmed until the
    // new verifier obtains the complete current employer posting.
    else fresh.elig_signals=signals ? {...signals,v:SIGNALS_VERSION,descriptionMissing:true} : extractEligibilitySignals(fresh);
    // Keep source deadlines/observation metadata and the complete cache record
    // when projecting employer content into a search result.
    fresh.elig_signals={...fresh.elig_signals,
      ...(job.elig_signals?.source ? {source:job.elig_signals.source} : {}), verification:v};
    return {...fresh,verification:{status:v.status,checked_at:v.checked_at,provider:evidence.provider,evidence_checked_at:evidence.checked_at}};
  }
  return {...job,verification:v};
}
// Search uses persist:false: cache quick observations in memory and let the
// scheduled checker durably merge evidence. Database round trips and slow ATS
// responses must not determine whether every candidate reaches the response.
export async function verifyCandidates(rows,{db,verify=verifyPosting,now=Date.now(),budgetMs=2000,concurrency=8,persist=true}={}) {
  const output=new Array(rows.length), queue=[]; let cursor=0;
  const fresh=(v,job)=>v?.v===VERIFICATION_VERSION && !(Date.parse(job?.elig_signals?.source?.changed_at)>Date.parse(v.checked_at)) && now-Date.parse(v.checked_at)>=0 && now-Date.parse(v.checked_at)<(v.status==='unknown'?300000:TTL);
  rows.forEach((job,i)=>{
    const cached=cache.get(job.apply_url);
    const v=fresh(cached,job) ? cached : job.elig_signals?.verification;
    if(fresh(v,job))output[i]=applyVerification(job,v); else queue.push({job,i});
  });
  const budget=Number.isFinite(budgetMs)?Math.max(0,budgetMs):2000;
  const deadline=Date.now()+budget, stop=Symbol('verification deadline');
  const ctrl=new AbortController(); let timer;
  const deadlineReached=new Promise(resolve=>{timer=setTimeout(()=>{ctrl.abort();resolve(stop);},budget);});
  try {
    const workers=Array.from({length:Math.min(queue.length,Math.max(1,Math.min(32,Math.floor(concurrency)||1)))},async()=>{
      while(cursor<queue.length && Date.now()<deadline && !ctrl.signal.aborted) {
        const {job,i}=queue[cursor++];
        const unknown=()=>({v:VERIFICATION_VERSION,status:'unknown',checked_at:new Date(now).toISOString(),reason:'Current posting could not be verified'});
        // The race also bounds injected/non-cooperative verifiers. Handle late
        // rejection here so a response timeout never causes an unhandled error.
        const operation=Promise.resolve().then(()=>verify(job,{now,timeoutMs:Math.max(1,Math.min(12000,deadline-Date.now())),signal:ctrl.signal})).catch(unknown);
        let checked=await Promise.race([operation,deadlineReached]);
        if(checked===stop || ctrl.signal.aborted || Date.now()>=deadline) return;
        if(!['ok','dead','unknown'].includes(checked?.status)) checked=unknown();
        const previous = retainVerificationEvidence(cache.get(job.apply_url) || {status:'pending'},job.elig_signals?.verification);
        const v=retainVerificationEvidence(compactVerification(checked),previous);
        if(cache.size>5000)cache.delete(cache.keys().next().value);
        cache.set(job.apply_url,v); output[i]=applyVerification(job,v);
        if(persist && db && job.id) {
          // Preserve compatibility for non-search callers. Even a hung write
          // cannot extend this helper beyond its deadline.
          const write=Promise.resolve().then(()=>updateJobSignals(db,job.id,current=>({...current,
            verification:mergePostingObservation(current.verification,v)}))).catch(error=>({error}));
          const saved=await Promise.race([write,deadlineReached]);
          if(saved===stop || ctrl.signal.aborted) return;
          if(saved.error)console.warn('Posting verification cache write failed:',saved.error.message);
        }
      }
    });
    await Promise.race([Promise.all(workers),deadlineReached]);
  } finally {clearTimeout(timer);}
  return Array.from(output,(v,i)=>v||applyVerification(rows[i],retainVerificationEvidence({status:'pending',reason:'Not checked yet'},cache.get(rows[i].apply_url) || rows[i].elig_signals?.verification)));
}
