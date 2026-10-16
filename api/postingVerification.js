// Current, public posting evidence. No model guesses and no arbitrary URL fetches.
import { GREENHOUSE_COMPANIES } from '../ingest/connectors/registry.js';
import { cleanText } from '../ingest/core/normalize.js';
import { extractEligibilitySignals } from './roleIntelligence.js';

export const VERIFICATION_VERSION = 2;
const TTL = 6 * 60 * 60 * 1000;
const cache = new Map();
const boardCache = new Map();
const hosts = ['bamboohr.com', 'apply.workable.com', 'jobs.ashbyhq.com', 'api.ashbyhq.com', 'job-boards.greenhouse.io', 'boards.greenhouse.io', 'boards-api.greenhouse.io', 'boards-api.eu.greenhouse.io', 'api.lever.co', 'jobs.lever.co', 'weworkremotely.com', 'jobicy.com', 'himalayas.app', 'myjobmag.com', 'www.myjobmag.com', 'canonical.com'];
const allowed = (u) => u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && hosts.some(h => u.hostname === h || (h === 'bamboohr.com' && u.hostname.endsWith('.bamboohr.com')));
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
async function readResponse(url, fetcher, signal) {
  let current = new URL(url);
  for(let i=0;i<5;i++) {
    if(!allowed(current)) throw new Error('Unsupported posting host');
    const r = await fetcher(current.href, {redirect:'manual',signal,headers:{'User-Agent':'JobCopilotVerification/1.0','Accept':'application/json,text/html'}});
    if ([301,302,303,307,308].includes(r.status)) {
      const next = new URL(r.headers.get('location'),current);
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
export async function verifyPosting(job, {fetcher=fetch, now=Date.now(), timeoutMs=12000}={}) {
  const at = new Date(now).toISOString();
  const unknown = reason => ({v:VERIFICATION_VERSION,status:'unknown',checked_at:at,reason});
  const ctrl = new AbortController(), timer = setTimeout(()=>ctrl.abort(),timeoutMs);
  try {
    let u = new URL(job.apply_url);
    if(!allowed(u)) return unknown('Source cannot yet be verified');
    let path = u.pathname, provider = 'structured posting', payload;
    // Known employer identities are curated in the ingestion registry. Resolve
    // board copies to an exact, unique current employer title when available.
    const employer=GREENHOUSE_COMPANIES.find(c=>c.name.toLowerCase()===String(job.company||'').trim().toLowerCase());
    if(employer && ['jobicy.com','weworkremotely.com','himalayas.app'].includes(u.hostname)) {
      const base=employer.apiBase || 'https://boards-api.greenhouse.io';
      let board=boardCache.get(employer.slug);
      if(!board || now-board.at>300000) {
        const r=await readResponse(`${base}/v1/boards/${employer.slug}/jobs`,fetcher,ctrl.signal);
        if(!r.status) {const data=JSON.parse(r.text);if(Array.isArray(data.jobs)){board={at:now,jobs:data.jobs};boardCache.set(employer.slug,board);}}
      }
      const normalized=s=>decode(s).toLowerCase().replace(/[^a-z0-9]/g,'');
      const matches=(board?.jobs||[]).filter(j=>normalized(j.title)===normalized(job.title));
      if(matches.length===1) {
        const direct=matches[0].absolute_url;
        const d=await readResponse(`${base}/v1/boards/${employer.slug}/jobs/${matches[0].id}`,fetcher,ctrl.signal);
        if(!d.status) {
          const j=JSON.parse(d.text);
          if(j.content && direct && allowed(new URL(direct))) {
            const candidate={title:j.title,description:cleanText(decode(j.content),Infinity),location:j.location?.name||'',remote:/remote|home[- ]?based|worldwide|anywhere/i.test(j.location?.name||'')};
            const reason=nonVacancyReason(candidate);
            return reason ? {v:VERIFICATION_VERSION,status:'dead',checked_at:at,reason}
              : {v:VERIFICATION_VERSION,status:'ok',checked_at:at,provider:'employer',apply_url:direct,...candidate};
          }
        }
      }
    }
    const gh=path.match(/^\/([^/]+)\/jobs\/(\d+)/);
    const lever=path.match(/^\/([^/]+)\/([a-f0-9-]+)(?:\/apply)?\/?$/i);
    if(['job-boards.greenhouse.io','boards.greenhouse.io'].includes(u.hostname) && gh) {
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
        provider=/ashbyhq|greenhouse|lever|canonical/.test(u.hostname)?'employer':'job board';
        payload={title:decode(j.title),description,location:(u.hostname==='weworkremotely.com' && /^remote\s+\S/i.test(j.hiringOrganization?.address || '') ? j.hiringOrganization.address : loc) || '',remote:j.jobLocationType==='TELECOMMUTE' || /remote/i.test(loc)};
        // Board labels are not proof of worldwide hiring. Retain them only as
        // uncertainty unless the actual description supports worldwide scope.
        if(provider==='job board' && /worldwide|anywhere|global/i.test(payload.location) && !extractEligibilitySignals(payload).worldwideDesc) payload.location='Remote';
      }
    }
    payload.description=cleanText(decode(payload.description),Infinity);
    const reason=nonVacancyReason(payload);
    if(reason)return {v:VERIFICATION_VERSION,status:'dead',checked_at:at,reason};
    if(!payload.title || !payload.description) return unknown('Incomplete posting evidence');
    return {v:VERIFICATION_VERSION,status:'ok',checked_at:at,provider,...payload};
  } catch { return unknown('Current posting could not be verified'); }
  finally {clearTimeout(timer);}
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
    const fresh={...job,title:evidence.title,description:evidence.description,location:evidence.location,remote:evidence.remote,apply_url:evidence.apply_url || job.apply_url};
    // Discard stored model inference in favour of the last complete posting evidence.
    fresh.elig_signals=evidence.signals || extractEligibilitySignals(fresh);
    return {...fresh,verification:{status:v.status,checked_at:v.checked_at,provider:evidence.provider,evidence_checked_at:evidence.checked_at}};
  }
  // Generic aggregator labels alone are not proof of worldwide hiring. Keep the
  // role discoverable, but do not give it a green badge when the body lacks evidence.
  const signals=job.elig_signals || extractEligibilitySignals(job);
  const board = ['weworkremotely','jobicy','himalayas'].includes(job.source)
    || /^https:\/\/(?:www\.)?(?:weworkremotely\.com|jobicy\.com|himalayas\.app)\//i.test(job.apply_url || '');
  if (board && /worldwide|anywhere|global/i.test(job.location || '') && !signals.worldwideDesc) {
    return {...job,location:'Remote',eligibility_region:null,elig_signals:signals,verification:v};
  }
  return {...job,verification:v};
}
// Bounded work per request. Unknown availability is separate from location eligibility.
// The scheduled checker persists this same evidence and progressively warms it.
export async function verifyCandidates(rows,{db,verify=verifyPosting,now=Date.now(),budgetMs=20000,concurrency=8}={}) {
  const output=new Array(rows.length), queue=[]; let cursor=0;
  const fresh=v=>v?.v===VERIFICATION_VERSION && now-Date.parse(v.checked_at)>=0 && now-Date.parse(v.checked_at)<(v.status==='unknown'?300000:TTL);
  rows.forEach((job,i)=>{
    const cached=cache.get(job.apply_url);
    const v=fresh(cached) ? cached : job.elig_signals?.verification;
    if(fresh(v))output[i]=applyVerification(job,v); else queue.push({job,i});
  });
  const deadline=Date.now()+budgetMs;
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(cursor<queue.length && Date.now()<deadline) {
      const {job,i}=queue[cursor++];
      const checked=await verify(job,{now,timeoutMs:Math.max(100,Math.min(12000,deadline-Date.now()))});
      const previous = retainVerificationEvidence(cache.get(job.apply_url) || {status:'pending'},job.elig_signals?.verification);
      const v=retainVerificationEvidence(compactVerification(checked),previous);
      if(cache.size>5000)cache.delete(cache.keys().next().value);
      cache.set(job.apply_url,v); output[i]=applyVerification(job,v);
      if(db && job.id) {
        const signals={...(job.elig_signals||{}),verification:v};
        // Cache only in JSONB; don't overwrite the source record or human edits.
        const {error}=await db.from('jobs').update({elig_signals:signals}).eq('id',job.id);
        if(error)console.warn('Posting verification cache write failed:',error.message);
      }
    }
  }));
  return Array.from(output,(v,i)=>v||applyVerification(rows[i],retainVerificationEvidence({status:'pending',reason:'Not checked yet'},cache.get(rows[i].apply_url) || rows[i].elig_signals?.verification)));
}
