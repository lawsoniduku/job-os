/** Read-only trust inventory. No model calls, posting fetches, RPCs or writes. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { checkEligibility, extractEligibilitySignals, SIGNALS_VERSION, INFER_VERSION } from '../api/roleIntelligence.js';
import { needsInference } from '../api/inferEligibility.js';
import { isActiveJobSource } from '../api/sourcePolicy.js';
import { publicationIsDiscoverable, hasRecentOpenEvidence, SOURCE_MAX_AGE_DAYS, MAX_DISCOVERY_AGE_DAYS } from '../api/jobFreshness.js';
import { applyVerification } from '../api/postingVerification.js';
import { availabilityOf } from '../shared/jobTrust.js';

const DAY = 86400000;
const COLUMNS = 'id,source,ats_source,title,company,location,description,apply_url,posted_at,created_at,last_seen_at,link_status,eligibility_region,remote,elig_signals';
const share = (count, total) => total ? Number((100 * count / total).toFixed(2)) : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const increment = (object, key) => { object[key] = (object[key] || 0) + 1; };
export function isDiscoverable(row, now = Date.now()) {
  if (!isActiveJobSource(row) || row.link_status === 'dead' || !publicationIsDiscoverable(row, now)) return false;
  const verification = row.elig_signals?.verification;
  if (verification?.status === 'dead' || verification?.last_known?.status === 'dead') return false;
  if (row.last_seen_at && !(Date.parse(row.last_seen_at) >= now - SOURCE_MAX_AGE_DAYS * DAY) && !hasRecentOpenEvidence(row, now)) return false;
  return true;
}
export function pendingInference(row, now = Date.now(), country = 'nigeria') {
  if (!isDiscoverable(row, now) || row.elig_signals?.infer?.v === INFER_VERSION) return false;
  const signals = row.elig_signals?.v === SIGNALS_VERSION ? row.elig_signals : extractEligibilitySignals(row);
  if (!needsInference(row, signals)) return false;
  // Match the engine's unresolved branch, rather than interpreting remote as worldwide.
  const verdict = checkEligibility(row, country);
  return verdict.eligible === true && verdict.confidence === 'possible' && verdict.reason === 'Remote — region unconfirmed';
}
function empty(source) {
  return { source, rows: 0, discoverable: 0, confidentEligibility: 0, verifiedAvailability: 0,
    pendingInference: 0, currentInference: 0, auditableInference: 0, deadLinks: 0,
    unknownAvailability: 0, unknownReasons: {}, platforms: {} };
}
export async function buildTrustReport(rows, { country = 'nigeria', now = Date.now() } = {}) {
  if (!Number.isFinite(now)) throw new Error('Invalid report date');
  const sources = new Map();
  let total = 0;
  for await (const row of rows) {
    if (!row || typeof row !== 'object' || !row.source) throw new Error('Invalid job row in report input');
    total++;
    const stats = sources.get(row.source) || empty(row.source);
    sources.set(row.source, stats); stats.rows++;
    const stored = row.elig_signals?.verification;
    if (row.link_status === 'dead' || stored?.status === 'dead' || stored?.last_known?.status === 'dead') stats.deadLinks++;
    if (!isDiscoverable(row, now)) continue;
    stats.discoverable++;
    const projected = stored ? applyVerification(row, stored) : row;
    const eligibility = checkEligibility(projected, country);
    if (eligibility.eligible === true && ['certain', 'likely'].includes(eligibility.confidence)) stats.confidentEligibility++;
    const availability = availabilityOf(row, now);
    if (availability.key === 'verified') stats.verifiedAvailability++;
    else if (availability.key !== 'closed') {
      stats.unknownAvailability++;
      increment(stats.unknownReasons, availability.reason || 'No availability evidence');
    }
    const platform = row.ats_source || row.elig_signals?.source?.ats || row.elig_signals?.source?.platform || 'unspecified';
    const p = stats.platforms[platform] || { discoverable: 0, pendingInference: 0, unknownAvailability: 0 };
    stats.platforms[platform] = p; p.discoverable++;
    if (availability.key === 'unverified') p.unknownAvailability++;
    if (pendingInference(row, now, country)) { stats.pendingInference++; p.pendingInference++; }
    const infer = row.elig_signals?.infer;
    if (infer?.v === INFER_VERSION) {
      stats.currentInference++;
      if (typeof infer.model === 'string' && infer.model.trim() && Number.isFinite(Date.parse(infer.at)) && Date.parse(infer.at) <= now) stats.auditableInference++;
    }
  }
  return { generatedAt: new Date(now).toISOString(), country, rows: total, discoveryAgeDays: MAX_DISCOVERY_AGE_DAYS,
    definitions: { confidentEligibility: 'Eligible=true and confidence=certain/likely from the deterministic engine for the target country; model-only coverage is separate.',
      verifiedAvailability: 'Same independent availability policy used by job cards (fresh, current, identified posting evidence).',
      pendingInference: 'Discoverable, no current-version inference, needsInference=true and engine returns Remote — region unconfirmed.',
      deadLinkShare: 'Confirmed dead rows divided by all stored rows for that source, including hidden/retired rows.',
      unknownAvailability: 'Discoverable rows without current verified availability; reasons and ATS counts included.',
      scope: 'Freshness, source and closure gates only; no role query or personal skill fit. Each page is read at request time, not a transactionally frozen snapshot.' },
    sources: [...sources.values()].sort((a, b) => a.source.localeCompare(b.source)).map(s => ({ ...s,
      confidentEligibilityPct: share(s.confidentEligibility, s.discoverable),
      verifiedAvailabilityPct: share(s.verifiedAvailability, s.discoverable),
      deadLinkPct: share(s.deadLinks, s.rows), unknownAvailabilityPct: share(s.unknownAvailability, s.discoverable),
      availabilityNeedsExplanation: s.discoverable > 0 && s.unknownAvailability / s.discoverable > 0.3 })) };
}
export async function* readJobPages({ url, key, pageSize = 500, fetcher = fetch }) {
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY), or pass --fixture.');
  const origin = new URL(url);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Supabase URL must use HTTPS (local HTTP is allowed).');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('--page-size must be between 1 and 1000');
  let cursor;
  for (;;) {
    const endpoint = new URL('/rest/v1/jobs', origin);
    endpoint.searchParams.set('select', COLUMNS);
    endpoint.searchParams.set('order', 'id.asc');
    endpoint.searchParams.set('limit', String(pageSize));
    if (cursor) endpoint.searchParams.set('id', `gt.${cursor}`);
    const response = await fetcher(endpoint.href, { method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(60000), headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Trust report read failed (HTTP ${response.status}); no complete report produced.`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length > pageSize) throw new Error('Invalid jobs page');
    for (const row of rows) {
      if (!uuid.test(row.id || '') || (cursor && row.id.toLowerCase() <= cursor.toLowerCase())) throw new Error('Jobs pagination failed to advance');
      cursor = row.id; yield row;
    }
    if (rows.length < pageSize) return;
  }
}
export function reportOptions(argv = []) {
  const options = { country: 'nigeria', pageSize: 500, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--json') { options.json = true; continue; }
    if (!['--fixture', '--country', '--page-size', '--at'].includes(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option ${flag}`);
    const value = argv[++i];
    if (flag === '--fixture') options.fixture = value;
    if (flag === '--country') options.country = value.toLowerCase().trim();
    if (flag === '--page-size') options.pageSize = Number(value);
    if (flag === '--at') options.now = Date.parse(value);
  }
  if (!options.country || !Number.isSafeInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 1000 || (options.now !== undefined && !Number.isFinite(options.now))) throw new Error('Invalid report options');
  if (options.now !== undefined && !options.fixture) throw new Error('--at is fixture-only; live evidence must be evaluated at the actual report time');
  return options;
}
export function printReport(report) {
  console.log(`Trust report | ${report.generatedAt} | candidate: ${report.country} | ${report.rows} rows`);
  console.table(report.sources.map(s => ({ source: s.source, rows: s.rows, discoverable: s.discoverable,
    'confident %': s.confidentEligibilityPct, 'verified %': s.verifiedAvailabilityPct,
    pending: s.pendingInference, 'dead % (all)': s.deadLinkPct, 'unverified %': s.unknownAvailabilityPct,
    'explanation required': s.availabilityNeedsExplanation })));
  for (const source of report.sources) {
    console.log(`${source.source}: current inference=${source.currentInference}; auditable=${source.auditableInference}`);
    console.log(JSON.stringify({ platforms: source.platforms, unknownReasons: source.unknownReasons }, null, 2));
  }
  console.log(JSON.stringify(report.definitions, null, 2));
}
export async function main(argv = process.argv.slice(2)) {
  const options = reportOptions(argv);
  let rows;
  if (options.fixture) {
    const fixture = JSON.parse(await readFile(options.fixture, 'utf8'));
    rows = Array.isArray(fixture) ? fixture : fixture.jobs;
    if (!Array.isArray(rows)) throw new Error('Fixture must be an array of jobs, or {jobs: [...]}');
  } else {
    // Environment is loaded only for an explicitly invoked connected report.
    const { default: dotenv } = await import('dotenv'); dotenv.config({ quiet: true });
    rows = readJobPages({ url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY, pageSize: options.pageSize });
  }
  const report = await buildTrustReport(rows, options);
  if (options.json) console.log(JSON.stringify(report, null, 2)); else printReport(report);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Trust report failed: ${error.message}`); process.exitCode = 1; });
}
