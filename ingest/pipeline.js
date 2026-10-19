import { publicationIsDiscoverable } from "../api/jobFreshness.js";
/**
 * ingest/pipeline.js  (v3.1)
 * ==========================
 * fetch (all ATS) -> normalize -> language filter -> dedup -> tag -> upsert.
 *
 * Run: node ingest/pipeline.js
 * Then jobs arrive already classified/region-tagged, so search reads precomputed
 * fields instead of re-scanning text per query.
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fetchGreenhouse } from "./connectors/ats/greenhouse.js";
import { fetchLever } from "./connectors/ats/lever.js";
import { fetchAshby } from "./connectors/ats/ashby.js";
import { fetchWorkable } from "./connectors/ats/workable.js";
import { fetchSmartRecruiters } from "./connectors/ats/smartrecruiters.js";
import { fetchTeamtailor } from "./connectors/feeds/teamtailor.js";
import { fetchBreezy } from "./connectors/feeds/breezy.js";
import {
  GREENHOUSE_COMPANIES, LEVER_COMPANIES, ASHBY_COMPANIES,
  WORKABLE_COMPANIES, SMARTRECRUITERS_COMPANIES,
} from "./connectors/registry.js";
import { looksEnglishJob } from "./core/language.js";
import { dedupe } from "./core/dedup.js";
import { tagJob } from "./core/tag.js";
import { createJobhiveWriter } from "./core/jobhiveWriter.js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
  console.log("\n🚀 INGESTION PIPELINE v3.3 (direct employer ATS)\n========================================\n");

  // 1. FETCH — direct company ATS boards and employer-owned feeds only.
  // JobHive has its own bounded importer/workflow; aggregator connectors are retired.
  console.log("Fetching direct employer ATS boards...");
  const settled = await Promise.allSettled([
    fetchGreenhouse(GREENHOUSE_COMPANIES),
    fetchLever(LEVER_COMPANIES),
    fetchAshby(ASHBY_COMPANIES),
    fetchWorkable(WORKABLE_COMPANIES || []),
    fetchSmartRecruiters(SMARTRECRUITERS_COMPANIES || []),
    fetchTeamtailor(),
    fetchBreezy(),
  ]);
  const sourceNames = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "teamtailor", "breezy"];
  let jobs = [], sourceFailures = 0;
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") jobs.push(...result.value);
    else {
      sourceFailures++;
      console.error(`❌ ${sourceNames[index]} fetch failed: ${result.reason?.message || result.reason}`);
    }
  });
  console.log(`\n📦 RAW (normalized): ${jobs.length}`);

  const beforeFreshness = jobs.length;
  jobs = jobs.filter(j => publicationIsDiscoverable(j));
  console.log(`Publication age: retained ${jobs.length}; excluded ${beforeFreshness - jobs.length}`);

  // 2. LANGUAGE FILTER (kills non-English postings at the source)
  const before = jobs.length;
  jobs = jobs.filter((j) => looksEnglishJob(j));
  console.log(`🌍 English-only: ${jobs.length} (dropped ${before - jobs.length} non-English)`);

  // 3. DEDUP (url + content key)
  jobs = dedupe(jobs);
  console.log(`🧹 Unique: ${jobs.length}`);

  // 4. TAG (role_cluster, seniority, remote_type, eligibility_region)
  jobs = jobs.map(tagJob);
  const africaCount = jobs.filter((j) => ["Africa", "Nigeria"].includes(j.eligibility_region)).length;
  const globalCount = jobs.filter((j) => j.eligibility_region === "Global").length;
  const remoteCount = jobs.filter((j) => j.eligibility_region === "Remote").length;
  // "Reachable" = everything a Nigerian candidate could actually apply to:
  // explicitly-African roles + globally-open remote + generic remote.
  const reachable = africaCount + globalCount + remoteCount;
  console.log(`🏷  Tagged. Africa/Nigeria: ${africaCount} | Global: ${globalCount} | Remote: ${remoteCount} | → Reachable: ${reachable}`);

  // Use the same bounded retries and malformed-row isolation as JobHive.
  const BATCH = 50;
  let ok = 0, fail = 0;
  const acceptedUrls = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const upsertBatch = createJobhiveWriter(supabase);

  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH).map(({ _region_hint, ...row }) => row);
    const result = await upsertBatch(batch);
    ok += result.accepted;
    fail += result.failedRows.length;
    const failedUrls = new Set(result.failedRows.map((j) => j.apply_url));
    acceptedUrls.push(...batch.filter((j) => !failedUrls.has(j.apply_url)).map((j) => j.apply_url));
    await sleep(150); // gentle pacing so we don't overwhelm the connection
  }
  console.log(`\n✅ ACCEPTED (including existing): ${ok} | ❌ FAILED: ${fail}`);

  // 6. TOUCH last_seen_at for EVERY job seen this run (new or existing).
  // The upsert above ignores duplicates, so it never refreshes existing rows.
  // We separately stamp last_seen_at = now() for all apply_urls in this batch,
  // updating ONLY that column (so cleaned descriptions / reclassified clusters
  // are never overwritten). This powers the nightly stale-job prune: jobs that
  // stop appearing in feeds stop being touched, and age out after 60 days.
  const nowIso = new Date().toISOString();
  const urls = [...new Set(acceptedUrls.filter(Boolean))];
  let touched = 0, touchFailures = 0;
  for (let i = 0; i < urls.length; i += BATCH) {
    const slice = urls.slice(i, i + BATCH);
    try {
      const { error } = await supabase
        .from("jobs")
        .update({ last_seen_at: nowIso })
        .in("apply_url", slice);
      if (error) throw new Error(error.message);
      touched += slice.length;
    } catch (error) {
      touchFailures += slice.length;
      console.error(`❌ Freshness update failed for ${slice.length} candidates: ${error.message}`);
    }
    await sleep(120);
  }
  console.log(`🕒 last_seen refresh accepted: ${touched} | failed: ${touchFailures}\n`);
  if (sourceFailures || fail || touchFailures) {
    console.error(`Incomplete ingestion: ${sourceFailures} source failures, ${fail} failed rows, ${touchFailures} failed freshness updates`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Ingestion failed:", error.message);
  process.exitCode = 1;
});
