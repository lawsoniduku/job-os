// Read-only digest discovery. One paged scan per run; subscriber preferences
// share it, and each feed retains only its bounded best results in memory.
import {ACTIVE_JOB_SOURCES,isActiveJobSource} from '../../api/sourcePolicy.js';
import {publicationIsDiscoverable,sourceVisibilityFilter,hasRecentOpenEvidence,SOURCE_MAX_AGE_DAYS} from '../../api/jobFreshness.js';
import {LOCATION_INTELLIGENCE,getAliasesForCluster,checkEligibility} from '../../api/roleIntelligence.js';
import {rankCandidates,compareSearchResults} from '../../api/searchCandidates.js';
import {applyVerification,nonVacancyReason} from '../../api/postingVerification.js';
import {canonicalUrl,contentKey} from './dedup.js';
const DAY=86400000;
const COLUMNS='id,title,company,location,description,apply_url,source,ats_source,posted_at,last_seen_at,remote,role_cluster,seniority,salary_min,salary_max,employment_type,eligibility_region,elig_signals,link_status';
const text=value=>typeof value==='string'?value.trim():'';
export function normalizeDigestPreference({country,roleCluster,role_cluster}={}){
 const input=text(country).toLowerCase();
 const canonical=Object.entries(LOCATION_INTELLIGENCE).find(([key,aliases])=>input===key||aliases.some(alias=>alias.toLowerCase()===input))?.[0]||null;
 const requested=text(roleCluster||role_cluster);
 const cluster=requested&&getAliasesForCluster(requested).length?requested:null;
 return {country:canonical,roleCluster:cluster,reason:!canonical?'Set a supported country before receiving location-eligible roles.':requested&&!cluster?'Choose a supported role preference before receiving a role-specific digest.':null};
}
export const digestPreferenceKey=preference=>{const p=normalizeDigestPreference(preference);return JSON.stringify([p.country,p.roleCluster,p.reason]);};
function recentSource(job,now){
 const seen=Date.parse(job.last_seen_at);
 return !job.last_seen_at||(Number.isFinite(seen)&&seen>=now-SOURCE_MAX_AGE_DAYS*DAY)||hasRecentOpenEvidence(job,now);
}
function applicationLink(value){
 try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!!url.hostname&&!url.username&&!url.password;}catch{return false;}
}
function eligibleJob(row,p,now){
 if(row.elig_signals?.source?.publication_unknown)return null;
 if(!applicationLink(row.apply_url)||!isActiveJobSource(row)||row.link_status==='dead'||!recentSource(row,now)||!publicationIsDiscoverable(row,now))return null;
 const job=row.elig_signals?.verification?applyVerification(row,row.elig_signals.verification):row;
 if(job.verification?.status==='dead'||nonVacancyReason(job))return null;
 let result;
 if(p.roleCluster){
  const intent={cluster:p.roleCluster,matchedAliases:getAliasesForCluster(p.roleCluster),keywords:[],locationCountry:p.country,remoteOnly:false,seniority:null};
  result=rankCandidates([job],intent,{},now).results[0];
 }else result={...job,eligibility:checkEligibility(job,p.country),score:0};
 // Unknown is useful in interactive search with explanation. A digest promising
 // eligible roles must wait for positive location evidence instead of guessing.
 return result?.eligibility?.eligible===true&&['certain','likely'].includes(result.eligibility.confidence)?result:null;
}
function boundedMerge(previous,added,maxJobs,now){
 const urls=new Set(),contents=new Set();
 return [...previous,...added].sort((a,b)=>compareSearchResults(a,b,now)).filter(job=>{
  const url=canonicalUrl(job.apply_url),key=String(job.company||'').trim()?contentKey(job):url;
  if(urls.has(url)||contents.has(key))return false;urls.add(url);contents.add(key);return true;
 }).slice(0,maxJobs);
}
export async function buildDigestFeeds({db,preferences,now=Date.now(),pageSize=500,maxJobs=30}={}){
 if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000||!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>100)throw Error('Digest page/output limits are invalid');
 const feeds=new Map();
 for(const preference of preferences||[]){const key=digestPreferenceKey(preference);if(!feeds.has(key))feeds.set(key,{...normalizeDigestPreference(preference),jobs:[]});}
 const active=[...feeds.values()].filter(p=>!p.reason);
 if(!active.length)return feeds;
 const since=now-7*DAY,until=now+DAY;
 let cursor=null;
 for(;;){
  let query=db.from('jobs').select(COLUMNS).in('source',ACTIVE_JOB_SOURCES)
   .gte('posted_at',new Date(since).toISOString()).lte('posted_at',new Date(until).toISOString())
   .or(sourceVisibilityFilter(now)).or('link_status.is.null,link_status.neq.dead').order('id').limit(pageSize);
  if(cursor!==null)query=query.gt('id',cursor);
  const {data,error}=await query;
  if(error)throw Error(`Digest discovery failed: ${error.message}`);
  const rows=data||[];
  // Reapply date/source gates locally so fixtures, policy and SQL remain honest.
  const fresh=rows.filter(row=>Date.parse(row.posted_at)>=since&&Date.parse(row.posted_at)<=until);
  for(const p of active)p.jobs=boundedMerge(p.jobs,fresh.map(row=>eligibleJob(row,p,now)).filter(Boolean),maxJobs,now);
  if(rows.length<pageSize)break;
  const next=rows.at(-1).id;if(!next||next===cursor)throw Error('Digest discovery pagination did not advance');cursor=next;
 }
 return feeds;
}
