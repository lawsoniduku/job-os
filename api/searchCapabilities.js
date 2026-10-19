// Probe schema capabilities, not corpus coverage. fetchCandidates hydrates the
// exact rows whose signals are missing/stale, so old rows never require a
// whole-database count or a full-description payload for every other result.
export function createSearchCapabilities({db, ttlMs=600000, now=Date.now}={}) {
  let cached=null, pending=null;
  async function columnExists(column) {
    try {
      const {error}=await db.from('jobs').select(column).limit(1);
      return !error;
    } catch {
      return false;
    }
  }
  return async()=>{
    if(cached && now()-cached.at<ttlMs)return cached.value;
    if(pending)return pending;
    const work=Promise.all([columnExists('elig_signals'),columnExists('link_status')])
      .then(([lean,hasLiveness])=>{
        const value={lean,hasLiveness};
        cached={at:now(),value};
        return value;
      });
    pending=work;
    try{return await work;}finally{pending=null;}
  };
}
