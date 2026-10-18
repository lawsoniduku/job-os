import { updateJobSignals } from './jobSignalsWriter.js';
const COLUMNS = 'id,source,ats_source,apply_url,elig_signals';

// Scan only compact metadata for this importer-owned slice. Rejected foreign
// jobs never cause a DB lookup; the map bounds negative writes to existing rows.
export async function loadJobhiveObservationIndex(db, ats, { pageSize = 1000, maxRows = 100000 } = {}) {
  const index = new Map();
  let cursor = null, loaded = 0;
  while (true) {
    let query = db.from('jobs').select(COLUMNS).eq('source', 'jobhive').eq('ats_source', ats).order('id').limit(pageSize);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw new Error(`Could not load JobHive observation metadata: ${error.message}`);
    const rows = data || [];
    loaded += rows.length;
    if (loaded > maxRows) throw new Error(`JobHive observation index exceeds ${maxRows} rows; refusing a partial index`);
    for (const row of rows) index.set(row.apply_url, row);
    if (rows.length < pageSize) return index;
    const next = rows.at(-1).id;
    if (next === cursor) throw new Error('JobHive observation cursor did not advance');
    cursor = next;
  }
}

export async function persistRejectedJobhiveObservations(db, ats, observations, { concurrency = 4, sleep } = {}) {
  const queue = [...observations];
  const result = { saved: 0, skipped: 0, failed: 0 };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const { snapshot, source } = queue.shift();
      const written = await updateJobSignals(db, snapshot.id, (signals, current) => {
        if (current.source !== 'jobhive' || current.ats_source !== ats) return undefined;
        const previous = signals.source || {};
        const incomingAt = Date.parse(source.fetched_at), previousAt = Date.parse(previous.fetched_at);
        if (Number.isFinite(previousAt) && !Number.isFinite(incomingAt)) return undefined;
        if (Number.isFinite(incomingAt) && Number.isFinite(previousAt) && incomingAt < previousAt) return undefined;
        // Negative observations must not replace content hashes, change times,
        // inference or employer proof. Missing upstream fields erase nothing.
        return { ...signals, source: {
          ...previous,
          fetched_at: source.fetched_at || previous.fetched_at || null,
          application_deadline: source.application_deadline || previous.application_deadline || null,
        } };
      }, { snapshot, columns: COLUMNS, conditions: { source: 'jobhive', ats_source: ats }, ...(sleep ? { sleep } : {}) });
      if (written.saved) result.saved++;
      else if (written.skipped) result.skipped++;
      else result.failed++;
    }
  }));
  return result;
}
