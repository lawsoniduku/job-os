// JobHive owns only rows it originally inserted for this exact ATS. The native
// pipeline retains its separate insert-only writer and ownership semantics.
const COLUMNS = 'id,source,ats_source,apply_url,title,location,description,country_iso,eligibility_region,posted_at,remote,remote_type,elig_signals';
const INPUT_FIELDS = ['title', 'location', 'description', 'country_iso', 'eligibility_region', 'remote', 'remote_type'];
const sameInput = (a, b) => INPUT_FIELDS.every(key => (a[key] ?? null) === (b[key] ?? null));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createJobhiveRefreshWriter(db, {
  dryRun = false, maxNewRows = 500, maxNewBytes = 10 * 1024 * 1024,
  sleep = delay, attempts = 4, concurrency = 4, admitNew = () => true,
} = {}) {
  let admittedRows = 0, admittedBytes = 0;
  for (const [name, value] of Object.entries({ maxNewRows, maxNewBytes })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number`);
  }
  const read = async url => {
    const { data, error } = await db.from('jobs').select(COLUMNS).eq('apply_url', url).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };
  async function refresh(row, initial) {
    let existing = initial;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (!existing) return 'failed';
      if (existing.source !== 'jobhive' || existing.ats_source !== row.ats_source) return 'collision';
      const previousFetched = Date.parse(existing.elig_signals?.source?.fetched_at);
      const incomingFetched = Date.parse(row.elig_signals?.source?.fetched_at);
      // CAS protects concurrent writes, while observation ordering protects
      // against a delayed older feed successfully overwriting newer content.
      if (Number.isFinite(previousFetched)) {
        if (!Number.isFinite(incomingFetched)) return 'partial';
        if (incomingFetched < previousFetched) return 'stale';
      }
      // Missing feed fields are not evidence that previous applicant restrictions
      // disappeared. Skip this incomplete observation without stamping freshness
      // or installing signals computed from its empty description/location.
      if (['description', 'location', 'country_iso'].some(key =>
        String(existing[key] ?? '').trim() && !String(row[key] ?? '').trim())) return 'partial';
      // Carry annotations from the latest DB snapshot, not the CSV or a stale
      // search response. Source changes invalidate only the old LLM inference.
      const signals = { ...(existing.elig_signals || {}), ...(row.elig_signals || {}) };
      const unchanged = sameInput(existing, row);
      signals.source = { ...(row.elig_signals?.source || {}) };
      if (unchanged) {
        if (existing.elig_signals?.source?.changed_at) signals.source.changed_at = existing.elig_signals.source.changed_at;
        else delete signals.source.changed_at;
      } else {
        signals.source.changed_at = row.elig_signals?.source?.fetched_at || row.last_seen_at;
      }
      if (existing.elig_signals?.verification) signals.verification = existing.elig_signals.verification;
      if (unchanged && existing.elig_signals?.infer) signals.infer = existing.elig_signals.infer;
      else delete signals.infer;
      const { id: _id, created_at: _created, link_status: _status, link_checked_at: _checked, ...patch } = row;
      // An absent source date must never turn a dated old job into an undated one.
      if (!row.posted_at && existing.posted_at) patch.posted_at = existing.posted_at;
      patch.elig_signals = signals;
      let query = db.from('jobs').update(patch).eq('id', existing.id).eq('source', 'jobhive').eq('ats_source', row.ats_source);
      query = existing.elig_signals == null ? query.is('elig_signals', null) : query.eq('elig_signals', JSON.stringify(existing.elig_signals));
      const { data, error } = await query.select('id');
      if (error) throw new Error(error.message);
      if (data?.length === 1) return 'updated';
      // An eligibility/verification writer won the race. Merge its new snapshot.
      existing = await read(row.apply_url);
    }
    return 'failed';
  }
  async function writeOne(row) {
    const insertRow = { ...row, elig_signals: { ...row.elig_signals, source: {
      ...row.elig_signals?.source,
      changed_at: row.elig_signals?.source?.fetched_at || row.last_seen_at,
    } } };
    let reservedBytes = 0;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const existing = await read(row.apply_url);
        if (existing) {
          if (reservedBytes) { admittedRows--; admittedBytes -= reservedBytes; reservedBytes = 0; }
          return await refresh(row, existing);
        }
        if (!admitNew(row)) return 'ineligible';
        if (!reservedBytes) {
          const bytes = Buffer.byteLength(JSON.stringify(insertRow), 'utf8');
          if (admittedRows >= maxNewRows || admittedBytes + bytes > maxNewBytes) return 'budget';
          admittedRows++; admittedBytes += bytes; reservedBytes = bytes;
        }
        // Ignore the URL conflict, then inspect RETURNING to count an actual
        // insert. A concurrent native importer may now own this application URL.
        const { data, error } = await db.from('jobs').upsert([insertRow], { onConflict: 'apply_url', ignoreDuplicates: true }).select('id');
        if (error) throw new Error(error.message);
        if (data?.length === 1) return 'inserted';
        const collision = await read(row.apply_url);
        admittedRows--; admittedBytes -= reservedBytes; reservedBytes = 0;
        return await refresh(row, collision);
      } catch {
        if (attempt + 1 < attempts) await sleep(250 * (attempt + 1));
      }
    }
    if (reservedBytes) { admittedRows--; admittedBytes -= reservedBytes; }
    return 'failed';
  }
  return async rows => {
    const result = { accepted: 0, inserted: 0, updated: 0, collisions: 0, budgetSkipped: 0, partialSkipped: 0, staleSkipped: 0, ineligibleSkipped: 0, failedRows: [] };
    if (dryRun) return { ...result, accepted: rows.length };
    const queue = [...rows];
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const row = queue.shift(), status = await writeOne(row);
        if (status === 'inserted' || status === 'updated') { result[status]++; result.accepted++; }
        else if (status === 'collision') result.collisions++;
        else if (status === 'budget') result.budgetSkipped++;
        else if (status === 'partial') result.partialSkipped++;
        else if (status === 'stale') result.staleSkipped++;
        else if (status === 'ineligible') result.ineligibleSkipped++;
        else result.failedRows.push(row);
      }
    }));
    return result;
  };
}
