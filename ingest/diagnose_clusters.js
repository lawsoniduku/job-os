/**
 * ingest/diagnose_clusters.js
 * ===========================
 * READ-ONLY diagnostic. No writes. Helps decide taxonomy changes from REAL data:
 *   1. Most common title words among jobs tagged "Other" (what we're missing)
 *   2. A sample of actual "Other" titles (to eyeball real local job names)
 *   3. Title-word breakdown inside the biggest cluster (Software Engineering)
 *      so we can see whether it should be split into sub-clusters.
 *
 * Run: node ingest/diagnose_clusters.js
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const PAGE = 1000;

// words too generic to be useful signal
const STOP = new Set([
  "the","and","for","with","you","your","our","are","this","that","will","has",
  "job","jobs","role","roles","work","team","new","all","other","a","an","of",
  "to","in","on","at","is","be","as","or","by","we","it","&","-","–","—","i",
  "senior","junior","lead","head","officer","manager","specialist","analyst",
  "assistant","associate","executive","coordinator","intern","staff","remote",
  "ii","iii","sr","jr","full","time","part","ng","nigeria","at","vacancy",
]);

async function fetchAll(cluster) {
  let from = 0;
  const titles = [];
  while (true) {
    let q = supabase.from("jobs").select("title, role_cluster, company, location").range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) { console.log("fetch error:", error.message); break; }
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (cluster === "*" || r.role_cluster === cluster) titles.push(r);
    }
    from += PAGE;
    if (data.length < PAGE) break;
  }
  return titles;
}

function wordFreq(rows) {
  const freq = {};
  for (const r of rows) {
    const words = (r.title || "").toLowerCase().replace(/[^a-z0-9&\s]/g, " ").split(/\s+/);
    for (const w of words) {
      if (!w || w.length < 3 || STOP.has(w)) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]);
}

async function run() {
  console.log("\n🔬 CLUSTER DIAGNOSTIC (read-only)\n=================================");

  // 1. everything, to get cluster sizes
  const all = await fetchAll("*");
  const sizes = {};
  for (const r of all) {
    const c = r.role_cluster || "null";
    sizes[c] = (sizes[c] || 0) + 1;
  }
  console.log(`\n📊 Total rows: ${all.length}`);
  console.log("\nCluster sizes:");
  Object.entries(sizes).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${String(n).padStart(5)}  ${c}`));

  // 2. the "Other" bucket — what are we failing to classify?
  const other = all.filter((r) => (r.role_cluster || "Other") === "Other");
  console.log(`\n\n❓ "Other" bucket: ${other.length} jobs`);
  console.log("\nTop 40 title words in Other (these reveal missing clusters/aliases):");
  wordFreq(other).slice(0, 40).forEach(([w, n]) => console.log(`  ${String(n).padStart(4)}  ${w}`));

  console.log("\n30 sample Other titles (real, to eyeball):");
  other.slice(0, 30).forEach((r) => console.log(`  • ${r.title}  ${r.company ? "@ " + r.company : ""}`));

  // 3. inside the biggest cluster — should it be split?
  const big = Object.entries(sizes).filter(([c]) => c !== "null" && c !== "Other")
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  if (big) {
    const rows = all.filter((r) => r.role_cluster === big);
    console.log(`\n\n🔎 Biggest cluster "${big}" (${rows.length} jobs) — title-word spread:`);
    console.log("   (if you see distinct sub-groups like backend/frontend/devops, it may be worth splitting)");
    wordFreq(rows).slice(0, 30).forEach(([w, n]) => console.log(`  ${String(n).padStart(4)}  ${w}`));
  }

  console.log("\n=================================\nDone (no data was changed).\n");
}

run();
