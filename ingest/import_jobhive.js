import { isActiveJobSource } from "../api/sourcePolicy.js";
import { publicationMayBeImported } from "../api/jobFreshness.js";
/**
 * Stream one JobHive ATS slice. Refresh only JobHive-owned rows from the same
 * ATS; preserve employer/native ownership and concurrent verification evidence.
 * Full descriptions remain available for eligibility reclassification.
 * New storage is bounded per invocation; existing rows refresh after the cap.
 * Usage: node ingest/import_jobhive.js <ats> [--limit N] [--dry-run]
 *   [--max-new-rows N] [--max-new-bytes N]
 * --repair-regions is retained as a compatibility alias: safe refresh is now
 * always enabled and never overwrites another source's row.
 */

import dotenv from "dotenv";
import { checkEligibility } from "../api/roleIntelligence.js";
import { createJobhiveRefreshWriter } from "./core/jobhiveRefreshWriter.js";
import { loadJobhiveObservationIndex, persistRejectedJobhiveObservations } from "./core/jobhiveObservations.js";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse";
import { Readable } from "node:stream";
import { createJobhiveAdmission } from "./core/jobhiveAdmission.js";
import { normalizeJob } from "./core/normalize.js";
import { tagJob } from "./core/tag.js";
import { looksEnglishJob } from "./core/language.js";
import { canonicalUrl } from "./core/dedup.js";
import { rowToRaw, fastReject, recoverWorldwideJob, sourceObservation, createRejectionLedger, JOBHIVE_KEEP_REGIONS as KEEP_REGIONS } from "./core/jobhive.js";

dotenv.config();

// ── config ────────────────────────────────────────────────────
const BASE = "https://storage.stapply.ai/jobhive/v1";
const BATCH = 50;
const SLEEP_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Which eligibility regions we KEEP. A Nigerian candidate can pursue explicitly
// African roles, globally-open remote, and generic remote. Everything else
// (US-only, EU-only, in-office elsewhere) is dropped.
// Shared with offline tests; includes EMEA, which the search engine accepts for Africa.

// ── args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ats = args[0];
const dryRun = args.includes("--dry-run");
const supabase = dryRun ? null : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const limitIdx = args.indexOf("--limit");
const keepLimit = limitIdx > -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
function numericArg(name, fallback) {
  const index = args.indexOf(name);
  const value = index < 0 ? fallback : Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} requires a non-negative integer`);
  return value;
}
const maxNewRows = numericArg("--max-new-rows", 500);
const maxNewBytes = numericArg("--max-new-bytes", 10 * 1024 * 1024);
const upsertBatch = createJobhiveRefreshWriter(supabase, { dryRun, sleep, maxNewRows, maxNewBytes, admitNew:row => isActiveJobSource(row) && checkEligibility(row,"nigeria").eligible !== false });

if (!ats || ats.startsWith("--")) {
  console.error("Usage: node --env-file=.env ingest/import_jobhive.js <ats> [--limit N] [--dry-run]");
  console.error("  e.g. node --env-file=.env ingest/import_jobhive.js ashby --limit 200 --dry-run");
  process.exit(1);
}


// ATS types we already pull live via our own connectors — but our registry is
// a small hand-picked list (e.g. 38 Greenhouse companies), while jobhive's
// per-ATS files cover THOUSANDS of companies on the same ATS (4,966 on
// Greenhouse, 2,856 on Ashby). So we do NOT block these — the coverage gap
// is real and worth having. Existing native/employer records retain ownership and are never overwritten.
//
// remoteok is the one true BAN — its apply links are paywalled, which is
// exactly why we removed it as a live source. Not importing it from anywhere.
const BANNED = new Set(["remoteok"]);

if (BANNED.has(ats)) {
  console.error(`\n⛔ "${ats}" is deliberately excluded — its apply links are paywalled.`);
  console.error(`   We removed this source on purpose. Not importing.\n`);
  process.exit(1);
}

async function run() {
  const url = `${BASE}/${ats}/jobs.csv`;
  console.log(`\n🐝 JOBHIVE IMPORT — ats=${ats} ${dryRun ? "(DRY RUN)" : ""}`);
  console.log(`   source: ${url}`);
  console.log(`   keep regions: ${[...KEEP_REGIONS].join(", ")}${keepLimit !== Infinity ? ` · limit ${keepLimit}` : ""}\n`);

  const observationIndex = dryRun ? new Map() : await loadJobhiveObservationIndex(supabase, ats);
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
  //
  // IMPORTANT: plain .pipe() does NOT forward errors from the source stream
  // to the destination — a mid-download network drop on `sourceStream` would
  // otherwise crash the whole process as an unhandled 'error' event, instead
  // of being caught by the try/catch below. We forward it explicitly so a
  // network blip degrades gracefully (partial progress reported, move on to
  // the next source) instead of taking down the entire batch run.
  const sourceStream = Readable.fromWeb(res.body);
  const parser = sourceStream.pipe(
    parse({
      bom: true,
      columns: (hdr) => {
        const columns = hdr.map((h) => h.trim().toLowerCase());
        if (!columns.includes("title") || !(columns.includes("url") || columns.includes("apply_url")))
          throw new Error("JobHive CSV schema missing title or application URL columns");
        return columns;
      },
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
    })
  );
  sourceStream.on("error", (err) => parser.destroy(err));

  const rejections = createRejectionLedger();
  const rejectedObservations = new Map();
  const observedNegativeUrls = new Set();
  let negativeSaved = 0, negativeSkipped = 0, negativeFailed = 0;
  async function flushRejectedObservations() {
    if (!rejectedObservations.size) return;
    const result = await persistRejectedJobhiveObservations(supabase, ats, rejectedObservations.values());
    negativeSaved += result.saved; negativeSkipped += result.skipped; negativeFailed += result.failed;
    rejectedObservations.clear();
  }
  let recoveredWorldwide = 0, stalePublication = 0, inserted = 0, updated = 0, collisions = 0, budgetSkipped = 0, partialSkipped = 0, staleSkipped = 0, ineligibleSkipped = 0, existingMissing = 0;
  function collectWrite(result, existingOnly = false) {
    upserted += result.accepted; inserted += result.inserted; updated += result.updated;
    collisions += result.collisions; budgetSkipped += result.budgetSkipped;
    partialSkipped += result.partialSkipped;
    staleSkipped += result.staleSkipped; ineligibleSkipped += result.ineligibleSkipped;
    existingMissing += result.existingMissing;
    (existingOnly ? failedExistingRows : failedRows).push(...result.failedRows);
  }
  let scanned = 0, notEnglish = 0, wrongRegion = 0, kept = 0, upserted = 0, failed = 0, fastRejected = 0, duplicate = 0;
  const failedRows = []; // rows that failed mid-stream, retried once more after stream ends
  const failedExistingRows = [];
  let batch = [], existingBatch = [];
  const admission = createJobhiveAdmission({maxRows:maxNewRows,maxBytes:maxNewBytes});
  const regionTally = {};
  const keptRegionTally = {};

  // Existing URL refreshes stream independently. New rows are deduplicated
  // within the bounded admission buffer and ordered by real publication date
  // before they consume the database's new-row budget.
  const seenUrls = new Set();

  let streamError = null;
  try {
    for await (const record of parser) {
      scanned++;
      if (scanned % 25000 === 0) {
        process.stdout.write(`  …scanned ${scanned} · kept ${kept} candidates (English + region filter)\n`);
      }

      const raw = rowToRaw(record);
      if (!raw.title || !raw.apply_url) { rejections.record("missing_identity", raw); continue; }
      const existingOwned = observationIndex.has(raw.apply_url);
      const observation = sourceObservation(raw);
      if (observation.rejection) {
        rejections.record(observation.rejection, raw);
        if (["upstream_stale", "deadline_expired"].includes(observation.rejection) && observationIndex.has(raw.apply_url) && !observedNegativeUrls.has(raw.apply_url)) {
          observedNegativeUrls.add(raw.apply_url);
          rejectedObservations.set(raw.apply_url, { snapshot: observationIndex.get(raw.apply_url), source: observation.source });
          if (rejectedObservations.size >= BATCH) await flushRejectedObservations();
        }
        continue;
      }

      // 0) CHEAP pre-filter on country_iso — kills the bulk (on-site US/EU/Asia)
      //    before we spend CPU on language + classification.
      if (!existingOwned && fastReject(raw)) { fastRejected++; rejections.record("foreign_onsite", raw); continue; }

      // 1) English gate (reuse pipeline logic)
      if (!existingOwned && !looksEnglishJob(raw)) { notEnglish++; rejections.record("language", raw); continue; }

      // 2) normalize + tag (gives us eligibility_region using YOUR existing rules)
      // Only Nigeria gets a hard regionHint here. We used to also collapse
      // every OTHER African country's ISO into a blanket "Africa" hint, but
      // that was a real bug: a role restricted to e.g. Algeria-only got
      // labeled "Africa" and shown to Nigerian candidates as eligible, since
      // "Africa" is treated as blanket-eligible for any African-country
      // search. A country isn't thereby open to Nigeria just because it's on
      // the same continent. For non-Nigeria countries we pass countryIso
      // through instead (below) and let detectEligibilityRegion's own text +
      // structured-fallback logic decide — it already knows the difference
      // between genuine pan-African language and a single named country.
      let regionHint = null;
      if (raw._country_iso === "NG") regionHint = "Nigeria";

      let job = normalizeJob(raw, { source: "jobhive", ats, region: regionHint, countryIso: raw._country_iso });
      if (!job) continue;
      job.elig_signals = { source: observation.source };
      if (!existingOwned && !publicationMayBeImported(job)) { stalePublication++; rejections.record("publication_age", raw); continue; }
      job = tagJob(job);
      const recovered = recoverWorldwideJob(job, raw);
      if (recovered !== job) recoveredWorldwide++;
      job = recovered;

      regionTally[job.eligibility_region] = (regionTally[job.eligibility_region] || 0) + 1;

      // 3) eligibility gate — keep only regions a Nigerian candidate can pursue
      if (!existingOwned && !KEEP_REGIONS.has(job.eligibility_region)) { wrongRegion++; rejections.record("region", raw); continue; }

      // The deterministic verdict must run BEFORE new-row content dedup. An
      // ineligible sibling must never hide a separate eligible requisition.
      const admissionVerdict = existingOwned ? null : checkEligibility(job,"nigeria");
      if (admissionVerdict?.eligible === false) {
        ineligibleSkipped++; rejections.record("location_eligibility",raw);
        admission.reject({...job,elig_signals:{...job.elig_signals,source:observation.source}});
        continue;
      }

      // 4) de-dup — same content key (company + normalized title + location)
      // or same canonical URL as a row we've already kept this run.
      const dedupUrl = canonicalUrl(job.apply_url);
      if (existingOwned && seenUrls.has(dedupUrl)) { duplicate++; rejections.record("duplicate", raw); continue; }
      if (existingOwned) seenUrls.add(dedupUrl);

      keptRegionTally[job.eligibility_region] = (keptRegionTally[job.eligibility_region] || 0) + 1;
      kept++;
      // Strip _region_hint before it reaches the DB — it's internal metadata
      // for detectEligibilityRegion(), not a real "jobs" table column. Same
      // fix as pipeline.js line ~107. Without this, EVERY row fails upsert
      // with "Could not find the '_region_hint' column of 'jobs' in the schema cache".
      const { _region_hint, ...row } = job;  // country_iso now persists
      row.elig_signals = { ...row.elig_signals, source: observation.source };
      // Upstream collection time is stronger evidence than our download time.
      // Missing collection dates are explicitly recorded as unknown metadata.
      row.last_seen_at = observation.source.fetched_at || new Date().toISOString();
      // Admission policy governs NEW records only. Existing owned URLs must
      // receive changed country/language/on-site requirements even when they
      // no longer qualify for import, so stale global signals are replaced.
      if (existingOwned) existingBatch.push(row);
      else admission.offer(row,{confidence:admissionVerdict?.confidence});
      if (existingBatch.length >= BATCH) {
        collectWrite(await upsertBatch(existingBatch, { existingOnly: true }), true);
        existingBatch = [];
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

  await flushRejectedObservations();

  if (existingBatch.length) {
    collectWrite(await upsertBatch(existingBatch, { existingOnly: true }), true);
  }
  const intake = admission.stats();
  duplicate += intake.duplicates;
  budgetSkipped += intake.budgetSkipped;
  batch = admission.rows();
  console.log(`   newest-first admission: ${intake.selected} selected; ${intake.selectedBytes} buffered bytes; ${intake.considered} candidates considered`);
  for (let i=0;i<batch.length;i+=BATCH) {
    collectWrite(await upsertBatch(batch.slice(i,i+BATCH)));
    await sleep(SLEEP_MS);
  }

  // FINAL RETRY PASS: once the download is fully done, the connection is no
  // longer split between "streaming a big file" and "writing to Supabase" —
  // so failures that were really just bandwidth contention often succeed now.
  for (const retry of [{ rows: failedRows, existingOnly: false }, { rows: failedExistingRows, existingOnly: true }]) {
    if (retry.rows.length > 0 && !dryRun) {
      console.log(`\n🔁 Retrying ${retry.rows.length} rows that failed mid-stream (stream is done, bandwidth is free now)...`);
      for (let i = 0; i < retry.rows.length; i += BATCH) {
        const slice = retry.rows.slice(i, i + BATCH);
        const ok = await upsertBatch(slice, { existingOnly: retry.existingOnly });
        upserted += ok.accepted; inserted += ok.inserted; updated += ok.updated;
        collisions += ok.collisions; budgetSkipped += ok.budgetSkipped;
        partialSkipped += ok.partialSkipped;
        staleSkipped += ok.staleSkipped; ineligibleSkipped += ok.ineligibleSkipped;
        existingMissing += ok.existingMissing;
        failed += ok.failedRows.length;
        await sleep(SLEEP_MS);
      }
    }

  }

  console.log(`\n📊 DONE (${ats})`);
  console.log(`   scanned:        ${scanned}`);
  console.log(`   fast-rejected (foreign on-site): ${fastRejected}`);
  console.log(`   dropped (publication age): ${stalePublication}`);
  console.log(`   dropped (lang): ${notEnglish}`);
  console.log(`   dropped (region): ${wrongRegion}`);
  console.log(`   dropped (duplicate): ${duplicate}`);
  console.log(`   rejection reasons:`, rejections.counts);
  console.log(`   bounded rejection samples:`, rejections.samples);
  console.log(`   existing negative observations: saved ${negativeSaved} | skipped ${negativeSkipped} | failed ${negativeFailed}`);
  console.log(`   new-row budget: ${maxNewRows} rows / ${maxNewBytes} serialized payload bytes`);
  console.log(`   KEPT candidates: ${kept}`);
  console.log(`   worldwide candidates recovered before dedup: ${recoveredWorldwide}`);
  console.log(`   region split before dedup:`, regionTally);
  console.log(`   region split of kept:`, keptRegionTally);
  if (dryRun) console.log(`   (dry run — nothing written)`);
  else console.log(`   inserted: ${inserted} | refreshed: ${updated} | other-owner collisions: ${collisions} | incomplete observations skipped: ${partialSkipped} | older observations skipped: ${staleSkipped} | new location-ineligible rows skipped: ${ineligibleSkipped} | new rows skipped by budget: ${budgetSkipped} | missing existing rows: ${existingMissing} | failed: ${failed}`);
  console.log(`\n   ⚠️  Check Supabase DB size before importing a larger slice.\n`);
  if (streamError || failed > 0 || negativeFailed > 0) process.exitCode = 1;
}

run().catch((e) => { console.error(e); process.exit(1); });
