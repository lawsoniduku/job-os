import {canonicalUrl,contentKey} from './dedup.js';

const time=value=>Number.isFinite(Date.parse(value))?Date.parse(value):-Infinity;
// Publication is the clock candidates see. Download/creation time never makes
// an undated opening outrank a genuinely new one. Ties are reproducible.
export function compareAdmission(a,b) {
 return time(b.row.posted_at)-time(a.row.posted_at)
  || b.confidence-a.confidence || a.url.localeCompare(b.url);
}

// Hold only the best bounded payload while streaming the full CSV. Existing
// owned rows bypass this buffer and still refresh even with a zero intake cap.
export function createJobhiveAdmission({maxRows=500,maxBytes=10*1024*1024}={}) {
 if(!Number.isSafeInteger(maxRows)||maxRows<0||!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new Error('Invalid new-job admission budget');
 let entries=[],bytes=0,considered=0,duplicates=0;
 const byUrl=new Map(),byContent=new Map();
 function remove(entry) {
  entries.splice(entries.indexOf(entry),1);bytes-=entry.bytes;byUrl.delete(entry.url);
  if(byContent.get(entry.key)===entry)byContent.delete(entry.key);
 }
 function insert(entry) {
  let lo=0,hi=entries.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(compareAdmission(entry,entries[mid])<0)hi=mid;else lo=mid+1;}
  entries.splice(lo,0,entry);bytes+=entry.bytes;byUrl.set(entry.url,entry);byContent.set(entry.key,entry);
 }
 return {
  offer(row,{confidence='possible'}={}) {
   considered++;
   if(!maxRows||!maxBytes)return;
   const url=canonicalUrl(row.apply_url);
   const key=String(row.company||'').trim()?contentKey(row):url;
   const entry={row,url,key,bytes:Buffer.byteLength(JSON.stringify(row),'utf8'),confidence:{certain:2,likely:1}[confidence]||0};
   if(!url||entry.bytes>maxBytes)return;
   const sameUrl=byUrl.get(url);
   if(sameUrl){
    duplicates++;
    const oldAt=time(sameUrl.row.elig_signals?.source?.fetched_at),newAt=time(row.elig_signals?.source?.fetched_at);
    if(newAt<oldAt || (newAt===oldAt&&compareAdmission(entry,sameUrl)>=0))return;
    remove(sameUrl);
   }
   const sameContent=byContent.get(key);
   if(sameContent){duplicates++;if(compareAdmission(entry,sameContent)>=0)return;remove(sameContent);}
   if(entries.length===maxRows && compareAdmission(entry,entries.at(-1))>=0)return;
   insert(entry);
   while(entries.length>maxRows||bytes>maxBytes)remove(entries.at(-1));
  },
  // A later contradictory observation cannot leave an earlier candidate in
  // this run's new-job buffer. It is still not a global closure verdict.
  reject(row) {
   const previous=byUrl.get(canonicalUrl(row.apply_url));
   if(previous && time(row.elig_signals?.source?.fetched_at)>=time(previous.row.elig_signals?.source?.fetched_at))remove(previous);
  },
  rows:()=>entries.map(e=>e.row),
  stats:()=>({considered,selected:entries.length,selectedBytes:bytes,duplicates,budgetSkipped:Math.max(0,considered-duplicates-entries.length)}),
 };
}
