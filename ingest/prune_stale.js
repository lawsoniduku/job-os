/**
 * Archived, bounded retention. A missing feed observation is not proof of closure.
 * Defaults to a read-only preview; --execute requires migrations 018 and 019.
 * No raw DELETE, automatic retries, VACUUM FULL, or archive purge is performed.
 *
 * PowerShell:
 *   node --env-file=.env ingest/prune_stale.js --dry-run
 *   node --env-file=.env ingest/prune_stale.js --execute --max-batches 5
 */
import { pathToFileURL } from 'node:url';
import { MAX_DISCOVERY_AGE_DAYS } from '../api/jobFreshness.js';

export function parsePruneOptions(args = []) {
  const result = {execute: false, days: MAX_DISCOVERY_AGE_DAYS, batchSize: 500, maxBatches: 1};
  const numeric = {'--days': ['days', MAX_DISCOVERY_AGE_DAYS, 3650], '--batch-size': ['batchSize', 1, 5000], '--max-batches': ['maxBatches', 1, 100]};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--execute') result.execute = true;
    else if (arg === '--dry-run') continue;
    else if (numeric[arg]) {
      const [key, min, max] = numeric[arg];
      const raw = args[++i];
      if (!/^\d+$/.test(raw || '') || Number(raw) < min || Number(raw) > max) throw new Error(`${arg} must be an integer between ${min} and ${max}`);
      result[key] = Number(raw);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (result.execute && args.includes('--dry-run')) throw new Error('Choose either --execute or --dry-run');
  return result;
}

export async function pruneStaleJobs(db, options = {}, log = console.log) {
  const settings = {...parsePruneOptions(), ...options};
  if (typeof settings.execute !== 'boolean') throw new Error('execute must be a boolean');
  // Validate programmatic use as strictly as CLI use.
  parsePruneOptions(['--days', String(settings.days), '--batch-size', String(settings.batchSize), '--max-batches', String(settings.maxBatches)]);
  const preview = await db.rpc('preview_stale_job_retention', {p_days: settings.days});
  if (preview.error) throw new Error(`Retention preview failed: ${preview.error.message}`);
  if (!preview.data || !Number.isSafeInteger(preview.data.selected) || preview.data.selected < 0) throw new Error('Retention preview returned an invalid count');
  log(JSON.stringify({mode: settings.execute ? 'execute' : 'preview', ...preview.data}, null, 2));
  if (!settings.execute) return {selected: preview.data.selected, archivedAndDeleted: 0, batches: 0, dryRun: true};

  let archivedAndDeleted = 0, batches = 0;
  for (; batches < settings.maxBatches;) {
    const result = await db.rpc('archive_prune_stale_jobs', {p_days: settings.days, p_limit: settings.batchSize});
    // Retrying an uncertain mutation could prune a second batch. Stop and let
    // the operator inspect the archive/cron log before choosing another run.
    if (result.error) throw new Error(`Retention batch failed after ${archivedAndDeleted} acknowledged archived deletions: ${result.error.message}. Not retried; inspect the archive before rerunning.`);
    if (!Number.isSafeInteger(result.data) || result.data < 0 || result.data > settings.batchSize) throw new Error('Retention batch returned an invalid count; not retried');
    batches++;
    archivedAndDeleted += result.data;
    log(`Archived and deleted ${result.data} jobs in batch ${batches}; acknowledged total ${archivedAndDeleted}.`);
    if (result.data < settings.batchSize) break;
  }
  return {selected: preview.data.selected, archivedAndDeleted, batches, dryRun: false};
}

export async function main(args = process.argv.slice(2)) {
  const options = parsePruneOptions(args);
  const {default: dotenv} = await import('dotenv');
  dotenv.config();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or server-side SUPABASE_KEY). Never use a client anon key.');
  const {createClient} = await import('@supabase/supabase-js');
  const db = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
  const result = await pruneStaleJobs(db, options);
  console.log(JSON.stringify(result));
  console.log('Archived descriptions still consume storage. Archiving protects recovery; it does not reclaim total database storage.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
