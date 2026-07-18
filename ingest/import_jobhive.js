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
 *   node --env-file=.env ingest/import_jobhive.js <ats> [--limit N] [--dry-run]
 *     <ats>       one of: ashby greenhouse lever workable icims workday oracle successfactors ...
 *     --limit N   stop after N rows KEPT (good for a first test)
 *     --dry-run   filter + count only, write nothing
 *
 * RECOMMENDED FIRST RUN (smallest, safest slice, dry run):
 *   node --env-file=.env ingest/import_jobhive.js ashby --limit 200 --dry-run
 *
 * Then check DB size in Supabase before running larger slices.
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline";
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

// ── tiny CSV line parser (handles quoted fields with commas/newlines-in-quotes
//    are NOT supported by line streaming; jobhive CSVs escape newlines, but if a
//    row breaks we skip it rather than corrupt the batch). ──
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// Map a jobhive CSV row (by header) into the shape normalizeJob expects.
function rowToRaw(headerIdx, cols) {
  const g = (name) => {
    const i = headerIdx[name];
    return i == null ? "" : (cols[i] || "").trim();
  };
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
      .upsert(batch, { onConflict: "apply_url", ignoreDuplicates: true });
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

  const rl = createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity });

  let headerIdx = null;
  let scanned = 0, keptEligible = 0, notEnglish = 0, wrongRegion = 0, kept = 0, upserted = 0, failed = 0, fastRejected = 0;
  const failedRows = []; // rows that failed mid-stream, retried once more after stream ends
  let batch = [];
  const regionTally = {};

  let streamError = null;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const cols = parseCsvLine(line);

      if (headerIdx === null) {
        headerIdx = {};
        cols.forEach((h, i) => { headerIdx[h.trim().toLowerCase()] = i; });
        continue;
      }

      scanned++;
      if (scanned % 25000 === 0) {
        process.stdout.write(`  …scanned ${scanned} · kept ${kept} (eligible & English)\n`);
      }

      const raw = rowToRaw(headerIdx, cols);
      if (!raw.title || !raw.apply_url) continue;

      // 0) CHEAP pre-filter on country_iso — kills the bulk (on-site US/EU/Asia)
      //    before we spend CPU on language + classification.
      if (fastReject(raw)) { fastRejected++; continue; }

      // 1) English gate (reuse pipeline logic)
      if (!looksEnglishJob(raw)) { notEnglish++; continue; }

      // 2) normalize + tag (gives us eligibility_region using YOUR existing rules)
      let job = normalizeJob(raw, { source: "jobhive", ats });
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
