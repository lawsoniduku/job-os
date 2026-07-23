/**
 * ingest/import_jobhive.js
 * ========================
 * ONE-OFF / OCCASIONAL bulk importer for the open-source jobhive dataset
 * (https://data.stapply.ai — MIT licensed, aggregated from 49 ATS platforms
 * including Workday, Oracle, SuccessFactors, iCIMS that our own pipeline
 * cannot reach directly).
 *
 * WHY THIS IS SEPARATE FROM pipeline.js:
 *   The jobhive per-ATS files are large (Workday ~3.9GB CSV). Our twice-daily
 *   GitHub Action runs in a 15-min window on small feeds — bolting a multi-GB
 *   download into it would blow the time and memory budget. So this is a
 *   standalone script you run MANUALLY (or on a separate, infrequent schedule),
 *   one ATS slice at a time.
 *
 * WHAT IT DOES (memory-safe):
 *   1. STREAMS a chosen ATS CSV (never loads the whole file into memory).
 *   2. Filters HARD as it streams — English + eligibility gate — so we only
 *      keep rows a Nigerian/African candidate could realistically pursue.
 *      The vast majority of rows (US-only, in-office) are discarded on the fly.
 *   3. Truncates descriptions (normalizeJob caps at 3000 chars) to protect the
 *      500MB Supabase budget.
 *   4. Upserts survivors in batches, same onConflict logic as pipeline.js.
 *
 * USAGE:
 *   node --env-file=.env ingest/import_jobhive.js <ats> [--limit N] [--dry-run] [--repair-regions]
 *     <ats>              one of: ashby greenhouse lever workable icims workday oracle successfactors ...
 *     --limit N          stop after N rows KEPT (good for a first test)
 *     --dry-run          filter + count only, write nothing
 *     --repair-regions   ONE-OFF REPAIR MODE: overwrite existing rows instead of
 *                        skipping them. Use this to fix historical rows whose
 *                        eligibility_region was wrongly tagged before the
 *                        country_iso region-hint fix (2026-07-22) — normal runs
 *                        use ignoreDuplicates:true and silently skip anything
 *                        already in the DB, so a plain re-run does NOT correct
 *                        old rows. This flag is the only way to actually fix them,
 *                        because country_iso only exists in the source CSV, not
 *                        in our jobs table — reclassify.js cannot do this either.
 *
 * RECOMMENDED FIRST RUN (smallest, safest slice, dry run):
 *   node --env-file=.env ingest/import_jobhive.js ashby --limit 200 --dry-run
 *
 * FIX HISTORICAL ROWS (run once per ATS type you've already imported):
 *   node --env-file=.env ingest/import_jobhive.js icims --repair-regions
 *   node --env-file=.env ingest/import_jobhive.js phenom --repair-regions
 *   node --env-file=.env ingest/import_jobhive.js recruitee --repair-regions
 *   node --env-file=.env ingest/import_jobhive.js ycombinator --repair-regions
 *   node --env-file=.env ingest/import_jobhive.js bamboohr --repair-regions
 *   node --env-file=.env ingest/import_jobhive.js teamtailor --repair-regions
 *   (...and any other ATS types you've run through the batch runner)
 *
 * Then check DB size in Supabase before running larger slices.
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse";
import { Readable } from "node:stream";
import { normalizeJob } from "./core/normalize.js";
import { tagJob } from "./core/tag.js";
import { looksEnglishJob } from "./core/language.js";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── config ────────────────────────────────────────────────────
const BASE = "https://storage.stapply.ai/jobhive/v1";
const BATCH = 50;
const SLEEP_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Which eligibility regions we KEEP. A Nigerian candidate can pursue explicitly
// African roles, globally-open remote, and generic remote. Everything else
// (US-only, EU-only, in-office elsewhere) is dropped.
const KEEP_REGIONS = new Set(["Africa", "Nigeria", "Global", "Remote"]);

// ── args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ats = args[0];
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const keepLimit = limitIdx > -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
// One-off repair mode: overwrite existing rows (matched by apply_url) instead
// of silently skipping them. Needed because eligibility_region can only be
// correctly re-derived from country_iso, which lives in the SOURCE CSV, not
// in our DB — so fixing already-imported rows requires re-reading the source
// and actually updating, not just re-classifying what's already stored.
const repairMode = args.includes("--repair-regions");

if (!ats || ats.startsWith("--")) {
  console.error("Usage: node --env-file=.env ingest/import_jobhive.js <ats> [--limit N] [--dry-run]");
  console.error("  e.g. node --env-file=.env ingest/import_jobhive.js ashby --limit 200 --dry-run");
  process.exit(1);
}


// ATS types we already pull live via our own connectors — but our registry is
// a small hand-picked list (e.g. 38 Greenhouse companies), while jobhive's
// per-ATS files cover THOUSANDS of companies on the same ATS (4,966 on
// Greenhouse, 2,856 on Ashby). So we do NOT block these — the coverage gap
// is real and worth having. Overlap is harmless: upsertBatch uses
// onConflict:"apply_url", ignoreDuplicates:true, so any job we already have
// from our own connector is silently skipped here, not duplicated.
//
// remoteok is the one true BAN — its apply links are paywalled, which is
// exactly why we removed it as a live source. Not importing it from anywhere.
const BANNED = new Set(["remoteok"]);

if (BANNED.has(ats)) {
  console.error(`\n⛔ "${ats}" is deliberately excluded — its apply links are paywalled.`);
  console.error(`   We removed this source on purpose. Not importing.\n`);
  process.exit(1);
}

// Map a jobhive CSV record (an object keyed by lowercased header, from
// csv-parse with columns:true) into the shape normalizeJob expects.
//
// A real CSV parser (not line-splitting) is required here: job descriptions
// routinely contain literal embedded newlines inside quoted fields. Splitting
// on "\n" (as a naive readline-based approach does) breaks those rows into
// garbage fragments, which then land in the wrong columns — this is exactly
// what caused "invalid input syntax for type numeric" errors on Recruitee's
// richer multi-paragraph descriptions (e.g. a fragment like "Texas" or a
// paragraph of description text ending up where salary_min was expected).
function rowToRaw(record) {
  const g = (name) => (record[name] || "").trim();
  // REAL jobhive v2.0 schema (from manifest stats.schema_columns):
  //   url, title, company, ats_type, ats_id, location, is_remote, salary_min,
  //   salary_max, salary_currency, salary_period, salary_summary,
  //   employment_type, department, team, description, posted_at,
  //   requisition_id, apply_url, commitment, raw, country_iso
  return {
    title: g("title"),
    company: g("company"),
    location: g("location"),
    description: g("description"),
    // apply_url is the employer's real link; url is jobhive's canonical. Prefer apply_url.
    apply_url: g("apply_url") || g("url"),
    posted_at: g("posted_at"),
    created_at: g("posted_at"),
    employment_type: g("employment_type") || g("commitment") || null,
    department: g("department") || null,
    salary_min: g("salary_min") || null,
    salary_max: g("salary_max") || null,
    isRemote: /^(true|1|yes)$/i.test(g("is_remote")),
    _country_iso: g("country_iso").toUpperCase(),
  };
}

// African ISO-3166 alpha-2 codes — a job physically located in one of these is
// inherently reachable for our users.
const AFRICAN_ISO = new Set([
  "NG","GH","KE","ZA","EG","MA","TZ","UG","RW","ET","SN","CI","CM","DZ","TN",
  "ZM","ZW","BW","NA","MZ","AO","MU","MW","LY","SD","SS","BJ","BF","ML","NE",
  "TD","SO","SL","LR","TG","GA","GN","GM","GW","CV","CG","CD","CF","DJ","ER",
  "SZ","LS","MG","KM","ST","SC","MR","BI",
]);

/**
 * Cheap pre-filter before the expensive normalize+tag step. Streaming 726K rows
 * means we want to reject the obvious bulk (in-office roles in the US/EU/Asia)
 * without running the full classifier on each one.
 *
 * Deliberately conservative: we only fast-reject when a job has a CONCRETE
 * non-African country AND is not flagged remote. Anything remote, or with no
 * country at all, still goes through the real eligibility engine — because
 * "Remote, country_iso=US" might be genuinely global, and only
 * detectEligibilityRegion can judge that from the text.
 */
function fastReject(raw) {
  const iso = raw._country_iso;
  if (!iso) return false;                    // unknown country -> let the engine decide
  if (AFRICAN_ISO.has(iso)) return false;    // African -> always evaluate
  if (raw.isRemote) return false;            // remote anywhere -> might be global
  return true;                                // concrete foreign + on-site -> drop
}

async function upsertBatch(batch, attempt = 1) {
  if (dryRun || batch.length === 0) return true;
  try {
    const { error } = await supabase
      .from("jobs")
      // repairMode=false (normal imports): ignoreDuplicates=true — never touch
      //   a row we already have, just add genuinely new ones. Safe, cheap.
      // repairMode=true (one-off fix): ignoreDuplicates=false — a REAL upsert,
      //   overwriting existing rows with freshly computed values (including
      //   the now-correct eligibility_region). This is what actually fixes
      //   historical rows; simply re-running a normal import does nothing to
      //   them because ignoreDuplicates:true silently skips existing apply_urls.
      .upsert(batch, { onConflict: "apply_url", ignoreDuplicates: !repairMode });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    // More attempts + longer backoff — the CSV download competing for the
    // same connection's bandwidth is the usual cause of transient failures,
    // not a real Supabase problem.
    if (attempt < 5) { await sleep(2000 * attempt); return upsertBatch(batch, attempt + 1); }
    console.log(`  ❌ batch failed after ${attempt} tries: ${e.message}`);
    return false;
  }
}

async function run() {
  const url = `${BASE}/${ats}/jobs.csv`;
  console.log(`\n🐝 JOBHIVE IMPORT — ats=${ats} ${dryRun ? "(DRY RUN)" : ""}`);
  console.log(`   source: ${url}`);
  console.log(`   keep regions: ${[...KEEP_REGIONS].join(", ")}${keepLimit !== Infinity ? ` · limit ${keepLimit}` : ""}\n`);

  let res;
  try {
    res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`Could not fetch ${url}: ${e.message}`);
    console.error(`Check the ATS name against: node -e "fetch('${BASE}/manifest.json').then(r=>r.json()).then(m=>console.log(Object.keys(m.ats||m)))"`);
    process.exit(1);
  }

  // csv-parse handles quoted multi-line fields correctly (a job description
  // with real embedded newlines stays as ONE record, not split into garbage
  // fragments). columns: yields objects keyed by our own lowercased header.
  const parser = Readable.fromWeb(res.body).pipe(
    parse({
      columns: (hdr) => hdr.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
    })
  );

  let scanned = 0, keptEligible = 0, notEnglish = 0, wrongRegion = 0, kept = 0, upserted = 0, failed = 0, fastRejected = 0;
  const failedRows = []; // rows that failed mid-stream, retried once more after stream ends
  let batch = [];
  const regionTally = {};

  let streamError = null;
  try {
    for await (const record of parser) {
      scanned++;
      if (scanned % 25000 === 0) {
        process.stdout.write(`  …scanned ${scanned} · kept ${kept} (eligible & English)\n`);
      }

      const raw = rowToRaw(record);
      if (!raw.title || !raw.apply_url) continue;

      // 0) CHEAP pre-filter on country_iso — kills the bulk (on-site US/EU/Asia)
      //    before we spend CPU on language + classification.
      if (fastReject(raw)) { fastRejected++; continue; }

      // 1) English gate (reuse pipeline logic)
      if (!looksEnglishJob(raw)) { notEnglish++; continue; }

      // 2) normalize + tag (gives us eligibility_region using YOUR existing rules)
      // Derive a CONFIDENT region hint from country_iso — jobhive's structured,
      // already-validated location signal — instead of letting every row fall
      // through to free-text keyword matching (which only recognizes a small
      // hand-curated list of city/country names and silently misses anything
      // not on that list, e.g. Ibadan, Kano, Enugu, or African countries beyond
      // Nigeria/Kenya/Ghana/Rwanda/South Africa). A structured ISO code is a
      // strong positive signal here and should short-circuit the guesswork via
      // detectEligibilityRegion's existing regionHint mechanism.
      //
      // We deliberately do NOT set a hint for foreign+remote rows (e.g. US +
      // is_remote=true) — that ambiguity (genuinely global vs. US-only-remote)
      // is exactly what the free-text classifier is designed to resolve by
      // actually reading the description, and jumping to a conclusion from
      // country_iso alone there would be guessing in the other direction.
      let regionHint = null;
      if (raw._country_iso === "NG") regionHint = "Nigeria";
      else if (AFRICAN_ISO.has(raw._country_iso)) regionHint = "Africa";

      let job = normalizeJob(raw, { source: "jobhive", ats, region: regionHint });
      if (!job) continue;
      job = tagJob(job);

      regionTally[job.eligibility_region] = (regionTally[job.eligibility_region] || 0) + 1;

      // 3) eligibility gate — keep only regions a Nigerian candidate can pursue
      if (!KEEP_REGIONS.has(job.eligibility_region)) { wrongRegion++; continue; }

      keptEligible++;
      kept++;
      // Strip _region_hint before it reaches the DB — it's internal metadata
      // for detectEligibilityRegion(), not a real "jobs" table column. Same
      // fix as pipeline.js line ~107. Without this, EVERY row fails upsert
      // with "Could not find the '_region_hint' column of 'jobs' in the schema cache".
      const { _region_hint, ...row } = job;
      // Stamp last_seen_at explicitly — normalizeJob() doesn't set this column
      // (only pipeline.js's separate post-upsert step does, for its own live
      // sources). Without this, every jobhive row would have last_seen_at=NULL
      // forever, making it invisible to "WHERE last_seen_at < ..." prune
      // queries (NULL comparisons are neither true nor false in SQL) — the
      // row would never be re-stamped AND never age out. Bulk-imported jobs
      // are a one-time snapshot, not re-verified daily, so stamp it once at
      // import time and let it age from there like anything else.
      row.last_seen_at = new Date().toISOString();
      batch.push(row);

      if (batch.length >= BATCH) {
        const ok = await upsertBatch(batch);
        if (ok) upserted += batch.length; else failedRows.push(...batch);
        batch = [];
        await sleep(SLEEP_MS);
      }

      if (kept >= keepLimit) break;
    }
  } catch (e) {
    // Network drops (SSL resets, HTTP2 stream errors) on large multi-hundred-MB
    // files are common over consumer connections. Don't crash and lose all
    // progress — report what we got, and write the partial batch we're holding.
    streamError = e;
    console.log(`\n⚠️  Stream interrupted: ${e.message || e.code || e}`);
    console.log(`   This is usually a network blip on a large file, not a code bug.`);
    console.log(`   Progress so far is reported below. Re-run to continue/retry.`);
  }

  if (batch.length) {
    const ok = await upsertBatch(batch);
    if (ok) upserted += batch.length; else failedRows.push(...batch);
  }

  // FINAL RETRY PASS: once the download is fully done, the connection is no
  // longer split between "streaming a big file" and "writing to Supabase" —
  // so failures that were really just bandwidth contention often succeed now.
  if (failedRows.length > 0 && !dryRun) {
    console.log(`\n🔁 Retrying ${failedRows.length} rows that failed mid-stream (stream is done, bandwidth is free now)...`);
    for (let i = 0; i < failedRows.length; i += BATCH) {
      const slice = failedRows.slice(i, i + BATCH);
      const ok = await upsertBatch(slice);
      if (ok) { upserted += slice.length; }
      else { failed += slice.length; }
      await sleep(SLEEP_MS);
    }
  }

  console.log(`\n📊 DONE (${ats})`);
  console.log(`   scanned:        ${scanned}`);
  console.log(`   fast-rejected (foreign on-site): ${fastRejected}`);
  console.log(`   dropped (lang): ${notEnglish}`);
  console.log(`   dropped (region): ${wrongRegion}`);
  console.log(`   KEPT eligible:  ${kept}`);
  console.log(`   region split of kept:`, Object.fromEntries(Object.entries(regionTally).filter(([k]) => KEEP_REGIONS.has(k))));
  if (dryRun) console.log(`   (dry run — nothing written)`);
  else console.log(`   ✅ upserted: ${upserted} | ❌ failed: ${failed}`);
  console.log(`\n   ⚠️  Check Supabase DB size before importing a larger slice.\n`);
  if (streamError) process.exitCode = 1;
}

run().catch((e) => { console.error(e); process.exit(1); });
