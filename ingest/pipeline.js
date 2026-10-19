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
import { fetchMyJobMag } from "./connectors/feeds/myjobmag.js";
import {
  GREENHOUSE_COMPANIES, LEVER_COMPANIES, ASHBY_COMPANIES,
  WORKABLE_COMPANIES, SMARTRECRUITERS_COMPANIES,
} from "./connectors/registry.js";
import { looksEnglishJob } from "./core/language.js";
import { canonicalUrl } from "./core/dedup.js";
import { tagJob } from "./core/tag.js";
import { createNativeRefreshWriter } from "./core/nativeRefreshWriter.js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
  // Order overlapping imports by collection start, independently of publication.
  const observedAt = new Date().toISOString();
  console.log("\n🚀 INGESTION PIPELINE v3.3 (employer ATS + MyJobMag Nigeria)\n========================================\n");

  // 1. FETCH — employer boards plus the retained MyJobMag Nigeria feed.
  // JobHive has its own bounded importer/workflow; six other boards stay retired.
  console.log("Fetching employer ATS boards and MyJobMag Nigeria...");
  const settled = await Promise.allSettled([
    fetchGreenhouse(GREENHOUSE_COMPANIES),
    fetchLever(LEVER_COMPANIES),
    fetchAshby(ASHBY_COMPANIES),
    fetchWorkable(WORKABLE_COMPANIES || []),
    fetchSmartRecruiters(SMARTRECRUITERS_COMPANIES || []),
    fetchTeamtailor(),
    fetchBreezy(),
    fetchMyJobMag(),
  ]);
  const sourceNames = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "teamtailor", "breezy", "myjobmag"];
  let jobs = [], sourceFailures = 0;
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") jobs.push(...result.value);
    else {
      sourceFailures++;
      // Keep independently successful employers, but never report a source
      // outage as a successful empty board or touch unseen jobs.
      if (Array.isArray(result.reason?.partialJobs)) jobs.push(...result.reason.partialJobs);
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

  // 3. Deduplicate exact application identities. Distinct URLs with matching
  // titles/locations can be separate positions, and both owned rows need refresh.
  const seenUrls = new Set();
  jobs = jobs.filter(job => {
    const url = canonicalUrl(job.apply_url);
    if (!url || seenUrls.has(url)) return false;
    seenUrls.add(url); return true;
  });
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

  // Refresh only the source that owns each URL. Preserve independent evidence.
  const BATCH = 50;
  let ok = 0, fail = 0;
  let inserted = 0, updated = 0, collisions = 0, partial = 0, stale = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const upsertBatch = createNativeRefreshWriter(supabase, { observedAt });

  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const result = await upsertBatch(batch);
    ok += result.accepted;
    fail += result.failedRows.length;
    inserted += result.inserted; updated += result.updated;
    collisions += result.collisions; partial += result.partialSkipped; stale += result.staleSkipped;
    await sleep(150); // gentle pacing so we don't overwhelm the connection
  }
  console.log(`\n✅ Saved: ${ok} (${inserted} new, ${updated} refreshed) | collisions: ${collisions} | incomplete: ${partial} | stale: ${stale} | ❌ failed: ${fail}`);
  // There is deliberately no separate URL-only last_seen UPDATE: a rejected
  // observation or another owner's URL must not gain source freshness.
  if (sourceFailures || fail) {
    console.error(`Incomplete ingestion: ${sourceFailures} source failures, ${fail} failed rows`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Ingestion failed:", error.message);
  process.exitCode = 1;
});
