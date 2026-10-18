// Versioned evidence shares one JSONB column with importer metadata and inference.
// Compare-and-swap prevents a slow worker from replacing another worker's update.
export async function updateJobSignals(db, id, transform, {
  snapshot = null, columns = 'id,elig_signals', attempts = 4,
  patch = {}, conditions = {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  let row = snapshot, lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (!row) {
        const read = await db.from('jobs').select(columns).eq('id', id).maybeSingle();
        if (read.error) throw new Error(read.error.message);
        if (!read.data) return {saved:false, skipped:true, error:null};
        row = read.data;
      }
      const previous = row.elig_signals ?? null;
      const signals = transform(previous || {}, row);
      if (signals === undefined) return {saved:false, skipped:true, error:null};
      const extra = typeof patch === 'function' ? patch(row, signals) : patch;
      let query = db.from('jobs').update({...extra, elig_signals:signals}).eq('id', id);
      for (const [key,value] of Object.entries(conditions)) query=query.eq(key,value);
      query = previous === null ? query.is('elig_signals', null)
        : query.filter('elig_signals', 'eq', JSON.stringify(previous));
      const written = await query.select('id');
      if (written.error) throw new Error(written.error.message);
      if (written.data?.length) return {saved:true, skipped:false, error:null};
      lastError = new Error('Job evidence changed concurrently');
      row = null; // Reload and transform the latest state after a conflict.
    } catch (error) {lastError = error; row = null;}
    if (attempt + 1 < attempts) await sleep(Math.min(1500, 200 * (attempt + 1)));
  }
  return {saved:false, skipped:false, error:lastError || new Error('Evidence update failed')};
}

export function mergePostingObservation(previous, incoming) {
  if (!previous) return incoming;
  if ((Date.parse(previous.checked_at) || 0) > (Date.parse(incoming.checked_at) || 0)) return previous;
  if (incoming.status === 'ok' || incoming.status === 'dead') return incoming;
  const known = [incoming.last_known, previous.status === 'ok' || previous.status === 'dead' ? previous : previous.last_known]
    .filter(Boolean).sort((a,b) => (Date.parse(b.checked_at)||0) - (Date.parse(a.checked_at)||0))[0];
  return known ? {...incoming,last_known:known} : incoming;
}
