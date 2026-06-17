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
import { fetchRemotive } from "./connectors/feeds/remotive.js";
import { fetchRemoteOK } from "./connectors/feeds/remoteok.js";
import { fetchHimalayas } from "./connectors/feeds/himalayas.js";
import { fetchJobicy } from "./connectors/feeds/jobicy.js";
import { fetchArbeitnow } from "./connectors/feeds/arbeitnow.js";
import { fetchMyJobMag } from "./connectors/feeds/myjobmag.js";
import { fetchTeamtailor } from "./connectors/feeds/teamtailor.js";
import { fetchBreezy } from "./connectors/feeds/breezy.js";
import {
  GREENHOUSE_COMPANIES, LEVER_COMPANIES, ASHBY_COMPANIES,
  WORKABLE_COMPANIES, SMARTRECRUITERS_COMPANIES,
} from "./connectors/registry.js";
import { looksEnglish, looksEnglishJob } from "./core/language.js";
import { dedupe } from "./core/dedup.js";
import { tagJob } from "./core/tag.js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
  console.log("\n🚀 INGESTION PIPELINE v3.2 (feeds + ATS)\n========================================\n");

  // 1. FETCH — company ATS boards + big aggregator feeds, all in parallel.
  console.log("Fetching ATS boards + aggregator feeds...");
  const settled = await Promise.allSettled([
    fetchGreenhouse(GREENHOUSE_COMPANIES),
    fetchLever(LEVER_COMPANIES),
    fetchAshby(ASHBY_COMPANIES),
    fetchWorkable(WORKABLE_COMPANIES || []),
    fetchSmartRecruiters(SMARTRECRUITERS_COMPANIES || []),
    fetchRemotive({ limit: 300 }),
    fetchRemoteOK(),
    fetchHimalayas({ limit: 300 }),
    fetchJobicy({ count: 100 }),
    fetchArbeitnow({ pages: 2 }),
    fetchMyJobMag(),
    fetchTeamtailor(),
    fetchBreezy(),
  ]);
  let jobs = [];
  for (const s of settled) if (s.status === "fulfilled") jobs.push(...s.value);
  console.log(`\n📦 RAW (normalized): ${jobs.length}`);

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
  console.log(`🏷  Tagged. Africa-eligible: ${africaCount}`);

  // 5. UPSERT — resilient: small delay between batches + one retry on failure,
  // so a single transient "fetch failed" doesn't lose the whole run (important
  // now that volume is in the thousands).
  const BATCH = 50;
  let ok = 0, fail = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function upsertBatch(batch, attempt = 1) {
    try {
      const { error } = await supabase
        .from("jobs")
        .upsert(batch, { onConflict: "apply_url", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      return true;
    } catch (e) {
      if (attempt < 3) {
        await sleep(1500 * attempt); // back off: 1.5s, then 3s
        return upsertBatch(batch, attempt + 1);
      }
      console.log(`❌ batch failed after ${attempt} tries: ${e.message}`);
      return false;
    }
  }

  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH).map(({ _region_hint, ...row }) => row);
    const success = await upsertBatch(batch);
    if (success) ok += batch.length; else fail += batch.length;
    await sleep(150); // gentle pacing so we don't overwhelm the connection
  }
  console.log(`\n✅ UPSERTED: ${ok} | ❌ FAILED: ${fail}`);

  // 6. TOUCH last_seen_at for EVERY job seen this run (new or existing).
  // The upsert above ignores duplicates, so it never refreshes existing rows.
  // We separately stamp last_seen_at = now() for all apply_urls in this batch,
  // updating ONLY that column (so cleaned descriptions / reclassified clusters
  // are never overwritten). This powers the nightly stale-job prune: jobs that
  // stop appearing in feeds stop being touched, and age out after 60 days.
  const nowIso = new Date().toISOString();
  const urls = jobs.map((j) => j.apply_url).filter(Boolean);
  let touched = 0;
  for (let i = 0; i < urls.length; i += BATCH) {
    const slice = urls.slice(i, i + BATCH);
    try {
      const { error } = await supabase
        .from("jobs")
        .update({ last_seen_at: nowIso })
        .in("apply_url", slice);
      if (!error) touched += slice.length;
    } catch { /* non-fatal: prune just waits another cycle */ }
    await sleep(120);
  }
  console.log(`🕒 last_seen refreshed: ${touched}\n`);
}

run();
