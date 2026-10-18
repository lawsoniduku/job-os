// Cache public search results by parsed intent/filters before loading candidates.
// Concurrent pagination/retries share one load rather than repeating DB/ATS work.
export function createSearchCache({ttlMs=180000,maxEntries=100,now=Date.now}={}) {
  const cached=new Map(),pending=new Map();
  return async (key,load)=>{
    const hit=cached.get(key);
    if(hit && now()-hit.at<ttlMs)return hit.value;
    if(pending.has(key))return pending.get(key);
    const work=Promise.resolve().then(load).then(value=>{
      if(cached.size>=maxEntries)cached.delete(cached.keys().next().value);
      cached.set(key,{at:now(),value});return value;
    });
    pending.set(key,work);
    try{return await work;}finally{pending.delete(key);}
  };
}
