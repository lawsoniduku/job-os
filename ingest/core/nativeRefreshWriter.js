import { createHash } from 'node:crypto';
import { tagJob } from './tag.js';

const SOURCES = new Set(['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'teamtailor', 'breezy', 'myjobmag']);
const COLUMNS = 'id,source,ats_source,apply_url,title,company,location,description,country_iso,posted_at,created_at,remote,remote_type,eligibility_region,elig_signals,last_seen_at';
const INPUTS = ['title', 'company', 'location', 'description', 'country_iso', 'remote', 'remote_type', 'eligibility_region'];
const same = (left, right) => INPUTS.every(key => (left[key] ?? null) === (right[key] ?? null));
const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const nonempty = value => String(value ?? '').trim().length > 0;
function ownsLegacyCanonical(row, existing) {
  if (existing.source !== 'remote_company' || existing.ats_source != null
    || row.source !== 'greenhouse' || row.ats_source !== 'greenhouse'
    || existing.company !== 'Canonical' || row.company !== 'Canonical') return false;
  try {
    const url = new URL(row.apply_url);
    return row.apply_url === existing.apply_url && url.protocol === 'https:' && !url.username && !url.password
      && (!url.port || url.port === '443') && url.hostname === 'job-boards.greenhouse.io'
      && /^\/canonical\/jobs\/[1-9]\d*\/?$/.test(url.pathname);
  } catch { return false; }
}

// Snapshot reads and inserts are batched. Only existing owned rows need a CAS
// update; a race reloads that one URL rather than redownloading a source corpus.
export function createNativeRefreshWriter(db, {
  dryRun = false, now = () => new Date().toISOString(), observedAt = null, attempts = 3, concurrency = 4,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const readMany = async urls => {
    const { data, error } = await db.from('jobs').select(COLUMNS).in('apply_url', urls);
    if (error) throw new Error(error.message);
    return new Map((data || []).map(row => [row.apply_url, row]));
  };
  function prepare(row, existing, fetchedAt) {
    const { _region_hint, _source_observation = {}, elig_signals: _incomingSignals,
      id: _id, created_at, link_status: _status, link_checked_at: _checked,
      last_seen_at: _seen, ...input } = row;
    const previous = existing?.elig_signals || {}, priorSource = previous.source || {};
    if (existing) {
      // Reconcile the legacy Canonical source only when its own live board
      // returns this exact URL. Do not globally enable an unknown source label
      // or resurrect old rows absent from the employer's current board.
      if ((existing.source !== row.source || (existing.ats_source ?? null) !== (row.ats_source ?? null))
        && !ownsLegacyCanonical(row, existing)) return { status: 'collision' };
      if (timestamp(priorSource.fetched_at) > timestamp(fetchedAt)
        || (timestamp(priorSource.updated_at) !== null && timestamp(_source_observation.updated_at) !== null
          && timestamp(priorSource.updated_at) > timestamp(_source_observation.updated_at))) return { status: 'stale' };
      // RSS may carry a summary instead of the full posting. It cannot retract
      // restrictions in a previous full description by shortening or omitting it.
      if (nonempty(existing.description) && (!nonempty(input.description)
        || _source_observation.description_complete === false
        || (row.source === 'myjobmag' && input.description.length < existing.description.length))) return { status: 'partial' };
      for (const key of ['location', 'country_iso', 'company']) {
        if (!nonempty(input[key]) && nonempty(existing[key])) input[key] = existing[key];
      }
      if (!input.posted_at && existing.posted_at) input.posted_at = existing.posted_at;
    }
    // Classify the merged authoritative inputs, never flags from a stale feed,
    // AI response or a shortened description. Preserve the connector's hint.
    const { _region_hint: _hint, ...tagged } = tagJob({ ...input, _region_hint });
    const changed = !existing || !same(existing, tagged);
    const source = { ...priorSource, fetched_at: fetchedAt,
      hash: createHash('sha256').update(JSON.stringify(INPUTS.map(key => tagged[key] ?? null))).digest('hex') };
    if (_source_observation.updated_at) source.updated_at = _source_observation.updated_at;
    if (_source_observation.publication_unknown) source.publication_unknown = true;
    else if (row.posted_at) delete source.publication_unknown;
    if (changed) source.changed_at = now();
    const signals = { ...previous, ...tagged.elig_signals, source };
    if (changed) delete signals.infer;
    // Input-supplied inference and verification never enter the merge. Existing
    // independent posting observations survive, but changed_at expires their proof.
    const patch = { ...tagged, elig_signals: signals, last_seen_at: fetchedAt };
    if (!existing) patch.created_at = created_at || fetchedAt;
    else if (!changed) delete patch.description; // do not resend unchanged full descriptions
    return { patch };
  }
  async function update(row, existing, fetchedAt) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (!existing) return 'missing';
      const prepared = prepare(row, existing, fetchedAt);
      if (prepared.status) return prepared.status;
      try {
        let query = db.from('jobs').update(prepared.patch).eq('id', existing.id).eq('source', existing.source);
        query = existing.ats_source == null ? query.is('ats_source', null) : query.eq('ats_source', existing.ats_source);
        query = existing.elig_signals == null ? query.is('elig_signals', null) : query.eq('elig_signals', JSON.stringify(existing.elig_signals));
        const { data, error } = await query.select('id');
        if (error) throw new Error(error.message);
        if (data?.length === 1) return 'updated';
      } catch { /* A failed request is never counted or stamped separately. */ }
      if (attempt + 1 < attempts) {
        await sleep(200 * (attempt + 1));
        try { existing = (await readMany([row.apply_url])).get(row.apply_url); } catch { return 'failed'; }
      }
    }
    return 'failed';
  }
  return async rows => {
    const result = { accepted: 0, inserted: 0, updated: 0, collisions: 0, partialSkipped: 0, staleSkipped: 0, failedRows: [] };
    if (dryRun) return { ...result, accepted: rows.length };
    if (!rows.length) return result;
    const fetchedAt = observedAt || now();
    if (timestamp(fetchedAt) === null) throw new Error('Native import needs a valid observation time');
    const valid = [], seen = new Set();
    for (const row of rows) {
      if (!SOURCES.has(row.source) || !row.apply_url || !row.title) { result.failedRows.push(row); continue; }
      if (!seen.has(row.apply_url)) { valid.push(row); seen.add(row.apply_url); }
    }
    if (!valid.length) return result;
    let snapshots;
    try { snapshots = await readMany(valid.map(row => row.apply_url)); }
    catch { return { ...result, failedRows: [...result.failedRows, ...valid] }; }
    const newRows = valid.filter(row => !snapshots.has(row.apply_url));
    const pending = valid.filter(row => snapshots.has(row.apply_url));
    if (newRows.length) {
      // Ignore concurrent URL conflicts; only RETURNING confirms ownership.
      // Keep malformed-row isolation without exposing descriptions in logs.
      async function insert(batch) {
        let written;
        for (let attempt = 0; attempt < attempts; attempt++) {
          const response = await db.from('jobs').upsert(batch.map(row => prepare(row, null, fetchedAt).patch),
            { onConflict: 'apply_url', ignoreDuplicates: true }).select('id,apply_url')
            .then(value => value, error => ({ error }));
          if (!response.error) { written = response.data || []; break; }
          if (/invalid input syntax|violates .*constraint|value too long|invalid byte sequence/i.test(response.error.message)) {
            if (batch.length > 1) {
              const middle = Math.ceil(batch.length / 2); await insert(batch.slice(0, middle)); await insert(batch.slice(middle));
            } else result.failedRows.push(...batch);
            return;
          }
          if (attempt + 1 < attempts) await sleep(200 * (attempt + 1));
        }
        if (!written) { result.failedRows.push(...batch); return; }
        const inserted = new Set(written.map(row => row.apply_url));
        result.inserted += inserted.size; result.accepted += inserted.size;
        const conflicts = batch.filter(row => !inserted.has(row.apply_url));
        if (conflicts.length) {
          try {
            const current = await readMany(conflicts.map(row => row.apply_url));
            for (const row of conflicts) { snapshots.set(row.apply_url, current.get(row.apply_url)); pending.push(row); }
          } catch { result.failedRows.push(...conflicts); }
        }
      }
      await insert(newRows);
    }
    const queue = [...pending];
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const row = queue.shift(), status = await update(row, snapshots.get(row.apply_url), fetchedAt);
        if (status === 'updated') { result.updated++; result.accepted++; }
        else if (status === 'collision') result.collisions++;
        else if (status === 'partial') result.partialSkipped++;
        else if (status === 'stale') result.staleSkipped++;
        else result.failedRows.push(row);
      }
    }));
    return result;
  };
}
