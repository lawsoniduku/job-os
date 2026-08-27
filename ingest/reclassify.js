/**
 * ingest/reclassify.js
 * ====================
 * ONE-TIME FIX. Your existing jobs were labelled by the OLD buggy classifier
 * (the "r"-matches-everything bug), so many are wrongly stored as
 * role_cluster = "Data Analytics". enrich.js won't fix them because it only
 * touches rows where role_cluster IS NULL — these aren't null, they're wrong.
 *
 * This script re-runs the NEW boundary-aware classifier over EVERY row and
 * overwrites role_cluster, department, seniority, remote_type, eligibility_region.
 *
 * Safe to run multiple times. Run once after upgrading:  node ingest/reclassify.js
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { tagJob } from "./core/tag.js";
import { cleanText } from "./core/normalize.js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const PAGE = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function updateWithRetry(id, patch, tries = 5) {
  for (let a = 0; a < tries; a++) {
    try {
      const { error } = await supabase.from("jobs").update(patch).eq("id", id);
      if (!error) return true;
      throw new Error(error.message);
    } catch (e) {
      if (a === tries - 1) { console.log(`  ❌ ${id}: ${e.message}`); return false; }
      // exponential backoff: 0.8s, 1.6s, 2.4s, 3.2s — gives a dropped
      // connection time to recover before the next attempt.
      await sleep(800 * (a + 1));
    }
  }
  return false;
}

async function run() {
  console.log("\n🔁 RECLASSIFY ALL ROWS (fixing old mislabels)\n=============================================");

  // count first
  const { count } = await supabase.from("jobs").select("id", { count: "exact", head: true });
  console.log(`📊 Total rows: ${count ?? "?"}`);

  let from = 0, done = 0, changed = 0, failed = 0;
  const clusterBefore = {};
  const clusterAfter = {};

  while (true) {
    // Retry the page fetch itself — a dropped connection here used to abort
    // the ENTIRE run after whatever page it died on (seen in practice: died
    // on page 2 of 60, so 98% of rows silently never got reclassified). Same
    // backoff shape as upsertBatch() in import_jobhive.js.
    let rows = null, fetchErr = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, description, location, role_cluster, eligibility_region, country_iso, elig_signals")
        // .order() is required for .range() pagination to be stable — without
        // it Postgres/PostgREST doesn't guarantee row order is consistent
        // across separate page fetches, and this script UPDATEs rows between
        // page fetches (which can itself perturb implicit ordering). Without
        // a stable order, some rows can silently never appear in ANY page —
        // confirmed in practice: one row was still un-reclassified after two
        // full "processed all 59571 rows" runs.
        .order("id")
        .range(from, from + PAGE - 1);
      if (!error) { rows = data; fetchErr = null; break; }
      fetchErr = error;
      console.log(`  ⚠️  page fetch failed (attempt ${attempt}/5): ${error.message}`);
      await sleep(1500 * attempt);
    }
    if (fetchErr) {
      // Skip this page rather than abandoning the whole run — one stubborn
      // page shouldn't cost us the other ~58. Re-running the script later
      // (safe to do — see docstring) will retry whatever got skipped.
      console.log(`❌ fetch: giving up on rows ${from}-${from + PAGE - 1} after 5 tries: ${fetchErr.message} — skipping this page`);
      from += PAGE;
      continue;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const before = row.role_cluster || "null";
      clusterBefore[before] = (clusterBefore[before] || 0) + 1;

      const tagged = tagJob({ title: row.title, description: row.description, location: row.location, country_iso: row.country_iso });
      const after = tagged.role_cluster;
      clusterAfter[after] = (clusterAfter[after] || 0) + 1;

      // Also clean stored HTML descriptions (old rows from RemoteOK/WWR contain
      // raw <p>/<div>/<img> markup). cleanText strips HTML but keeps paragraphs.
      const cleanedDesc = cleanText(row.description || "", 6000);
      const descChanged = cleanedDesc && cleanedDesc !== row.description;

      const regionChanged = tagged.eligibility_region !== row.eligibility_region;
      // Backfill the precomputed eligibility blob whenever it's missing or
      // from an older logic version — this is what lets search stop shipping
      // descriptions. See migration 011 / SIGNALS_VERSION.
      const signalsStale = !row.elig_signals || row.elig_signals.v !== tagged.elig_signals?.v;
      const labelChanged = after !== row.role_cluster || regionChanged;
      if (labelChanged || descChanged || signalsStale) {
        const patch = {
          role_cluster: tagged.role_cluster,
          department: tagged.department,
          seniority: tagged.seniority,
          remote_type: tagged.remote_type,
          eligibility_region: tagged.eligibility_region,
          elig_signals: tagged.elig_signals,
        };
        if (descChanged) patch.description = cleanedDesc;
        const okUpdate = await updateWithRetry(row.id, patch);
        if (okUpdate && labelChanged) changed++;
        if (!okUpdate) failed++;
        await sleep(60); // gentle pacing so we don't saturate the connection
      }
      done++;
      if (done % 200 === 0) console.log(`  …processed ${done} (${changed} relabelled, ${failed} failed)`);
    }

    from += PAGE;
    if (rows.length < PAGE) break;
  }

  console.log(`\n✅ Processed ${done} rows · ${changed} relabelled · ${failed} failed`);
  if (failed > 0) console.log(`   (re-run to retry the ${failed} that failed — it only updates what changed)`);
  console.log("\nBefore (top clusters):", topN(clusterBefore));
  console.log("After  (top clusters):", topN(clusterAfter), "\n");
}

function topN(obj, n = 8) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `${k}:${v}`).join("  ");
}

run();
