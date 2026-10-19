import { MAX_DISCOVERY_AGE_DAYS, publicationIsDiscoverable } from '../../api/jobFreshness.js';
import { isActiveJobSource } from '../../api/sourcePolicy.js';
import { extractEligibilitySignals, SIGNALS_VERSION, INFER_VERSION } from '../../api/roleIntelligence.js';
import { needsInference } from '../../api/inferEligibility.js';

const DAY = 86400000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Postgres timestamps carry six fractional digits. Date.parse alone truncates
// those to milliseconds and can reject a correctly ordered keyset page.
export function timestampMicros(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const seconds = Date.parse(`${match[1]}${match[3]}`);
  return Number.isFinite(seconds) ? BigInt(seconds) * 1000n + BigInt((match[2] || '').padEnd(6, '0')) : null;
}
const validDate = value => timestampMicros(value) !== null;
const positive = (value, name, fallback, maximum) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  return n;
};
export function decodeInferenceCursor(value) {
  if (!value) return null;
  let c;
  try { c = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { throw new Error('Invalid inference cursor'); }
  if (c.v !== 1 || !validDate(c.at) || !uuid.test(c.id || '') || !validDate(c.until)
    || !(c.from === null || validDate(c.from)) || timestampMicros(c.at) > timestampMicros(c.until)
    || !Number.isSafeInteger(c.days) || c.days < 1 || c.days > 3650) throw new Error('Invalid inference cursor');
  return c;
}
export const encodeInferenceCursor = cursor => cursor ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null;
export function inferenceOptions(argv = [], now = Date.now()) {
  const allowed = new Set(['--days','--limit','--scan','--page-size','--max-pages','--cursor','--audit']);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--all') { args.all = true; continue; }
    if (!allowed.has(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid or incomplete option ${flag}`);
    args[flag.slice(2)] = argv[++i];
  }
  const cursor = decodeInferenceCursor(args.cursor);
  const days = positive(args.days, '--days', MAX_DISCOVERY_AGE_DAYS, 3650);
  const from = args.all ? null : new Date(now - days * DAY).toISOString();
  if (cursor && ((args.all && cursor.from !== null) || (args.days && cursor.days !== days))) throw new Error('Cursor lookback differs from supplied scope');
  return {
    days: cursor?.days ?? days, from: cursor ? cursor.from : from, until: cursor?.until || new Date(now).toISOString(), cursor,
    limit: positive(args.limit, '--limit', 300, 10000), scan: positive(args.scan, '--scan', 20000, 100000),
    pageSize: positive(args['page-size'], '--page-size', 500, 1000), maxPages: positive(args['max-pages'], '--max-pages', 40, 1000),
    auditPath: args.audit || 'inference-audit.json',
  };
}
export function pendingInference(job, now = Date.now()) {
  if (!isActiveJobSource(job) || job.link_status === 'dead' || !publicationIsDiscoverable(job, now)) return null;
  if (job.elig_signals?.infer?.v === INFER_VERSION) return null;
  const sig = job.elig_signals?.v === SIGNALS_VERSION ? job.elig_signals
    : {...job.elig_signals, ...extractEligibilitySignals(job)};
  return needsInference(job, sig) ? { job, sig } : null;
}
export async function collectInferenceCandidates(fetchPage, options, now = Date.now(), onProgress = async () => {}) {
  const selected = [];
  let cursor = options.cursor, scanned = 0, pages = 0, exhausted = false;
  while (scanned < options.scan && pages < options.maxPages && selected.length < options.limit) {
    const size = Math.min(options.pageSize, options.scan - scanned);
    const rows = await fetchPage({ cursor, size, from: options.from, until: options.until });
    pages++;
    if (!Array.isArray(rows) || rows.length > size) throw new Error('Invalid inference queue page');
    if (!rows.length) { exhausted = true; break; }
    let consumed = 0;
    for (const row of rows) {
      const at = row.posted_at || row.created_at;
      if (!validDate(at) || !uuid.test(row.id || '')) throw new Error('Inference queue returned an invalid ordering key');
      if (cursor && !(timestampMicros(at) < timestampMicros(cursor.at) || (timestampMicros(at) === timestampMicros(cursor.at) && row.id < cursor.id))) throw new Error('Inference queue failed to advance in newest-first order');
      const beforeCursor = cursor;
      cursor = { v: 1, at, id: row.id, from: options.from, until: options.until, days: options.days };
      scanned++;
      consumed++;
      const candidate = pendingInference(row, now);
      if (candidate) selected.push({ ...candidate, beforeCursor });
      if (selected.length >= options.limit) break;
    }
    await onProgress({selected:selected.length,scanned,pages,cursor});
    if (consumed === rows.length && rows.length < size) { exhausted = true; break; }
  }
  return { selected, cursor, scanned, pages, exhausted };
}
export async function enrichInferenceCandidates(selected, { infer, write, sleep = async () => {}, concurrency = 2, paceMs = 1200, retryMs = 8000,
  onProgress = async () => {}, circuitMinCalls = 10, circuitFailureRatio = 0.8 }) {
  const audit = { selected: selected.length, attempted: 0, completed: 0, resolved: 0, unclear: 0, failed: 0, recovered: 0, written: 0, calls: 0, callFailures: 0, writeFailures: 0, scopes: {}, fatal: null, errors: {} };
  const savedIndexes = new Set();
  let next = 0;
  function snapshot() {
    const firstPending = selected.findIndex((_,index) => !savedIndexes.has(index));
    const failureRate = audit.calls ? audit.callFailures / audit.calls : 0;
    return {...audit,scopes:{...audit.scopes},errors:{...audit.errors},failureRate,
      unattempted:selected.length-audit.attempted,in_flight:audit.attempted-audit.completed,
      retryCursor:firstPending < 0 ? undefined : selected[firstPending].beforeCursor,
      exitCode:audit.fatal || failureRate > 0.3 || audit.writeFailures > 0 ? 1 : 0};
  }
  const checkpoint = () => onProgress(snapshot());
  function recordCallFailure() {
    audit.callFailures++;
    if (audit.calls >= circuitMinCalls && audit.callFailures / audit.calls >= circuitFailureRatio)
      audit.fatal ||= `Provider failure circuit opened after ${audit.calls} calls (${audit.callFailures} failed)`;
  }
  async function call(job) {
    audit.calls++;
    await checkpoint();
    try {
      const result = await infer(job);
      if (!result) recordCallFailure();
      return result;
    } catch (error) {
      recordCallFailure();
      if (error.fatal) {audit.fatal=error.message;throw error;}
      return null;
    }
  }
  async function worker() {
    while (next < selected.length && !audit.fatal) {
      const index = next++, candidate = selected[index];
      audit.attempted++;
      let result, recovered = false;
      try {
        result = await call(candidate.job);
        if (!result && !audit.fatal) {
          await sleep(retryMs);
          if (!audit.fatal) {result = await call(candidate.job);recovered = !!result;}
        }
        if (!result) throw new Error(audit.fatal || 'No usable model answer after retry');
        let saved;
        try { saved = await write(candidate, result); }
        catch (error) { audit.writeFailures++; throw error; }
        if (!saved?.saved) { audit.writeFailures++; throw new Error(saved?.error?.message || 'Posting changed or write skipped'); }
        savedIndexes.add(index);
        audit.written++;
        if (result.scope === 'unclear' || result.confidence === 'low') audit.unclear++; else audit.resolved++;
        audit.scopes[result.scope] = (audit.scopes[result.scope] || 0) + 1;
        if (recovered) audit.recovered++;
      } catch (error) {
        audit.failed++;
        audit.errors[error.message] = (audit.errors[error.message] || 0) + 1;
        if (error.fatal) audit.fatal = error.message;
      }
      audit.completed++;
      await checkpoint();
      // A dead provider must not sleep once for each untouched posting.
      if (!audit.fatal && next < selected.length) await sleep(paceMs);
    }
  }
  await checkpoint();
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  return snapshot();
}
