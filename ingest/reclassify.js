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
    const { data: rows, error } = await supabase
      .from("jobs")
      .select("id, title, description, location, role_cluster")
      .range(from, from + PAGE - 1);

    if (error) { console.log("❌ fetch:", error.message); break; }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const before = row.role_cluster || "null";
      clusterBefore[before] = (clusterBefore[before] || 0) + 1;

      const tagged = tagJob({ title: row.title, description: row.description, location: row.location });
      const after = tagged.role_cluster;
      clusterAfter[after] = (clusterAfter[after] || 0) + 1;

      // Also clean stored HTML descriptions (old rows from RemoteOK/WWR contain
      // raw <p>/<div>/<img> markup). cleanText strips HTML but keeps paragraphs.
      const cleanedDesc = cleanText(row.description || "", 6000);
      const descChanged = cleanedDesc && cleanedDesc !== row.description;

      const labelChanged = after !== row.role_cluster;
      if (labelChanged || descChanged) {
        const patch = {
          role_cluster: tagged.role_cluster,
          department: tagged.department,
          seniority: tagged.seniority,
          remote_type: tagged.remote_type,
          eligibility_region: tagged.eligibility_region,
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
