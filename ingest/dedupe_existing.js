/**
 * ingest/dedupe_existing.js
 * ==========================
 * ONE-TIME CLEANUP. import_jobhive.js never ran rows through dedup.js's
 * content-key check (only pipeline.js did), so the same role posted many
 * times under different req IDs/apply URLs (common in bulk ATS exports —
 * e.g. "Customer Service Rep - Work From Home" @ spadepartners showed up
 * 5x in one import) is sitting in the table as separate rows, flooding
 * search results with duplicates of the same job.
 *
 * This finds existing rows sharing the same content key (company +
 * normalized title + first location token) and deletes all but one —
 * keeping the one with the most recent posted_at (falls back to
 * last_seen_at, then created_at) as the best signal for "most likely
 * still live."
 *
 * USAGE:
 *   node --env-file=.env ingest/dedupe_existing.js --dry-run   (report only)
 *   node --env-file=.env ingest/dedupe_existing.js             (actually delete)
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { contentKey } from "./core/dedup.js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const dryRun = process.argv.includes("--dry-run");
const PAGE = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(from) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, title, company, location, apply_url, posted_at, last_seen_at, created_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (!error) return data;
    console.log(`  ⚠️  page fetch failed (attempt ${attempt}/5): ${error.message}`);
    await sleep(1500 * attempt);
  }
  return null;
}

async function run() {
  console.log("\n🧹 DEDUPE EXISTING ROWS (content-key: company + title + location)\n===================================================================");

  const { count } = await supabase.from("jobs").select("id", { count: "exact", head: true });
  console.log(`📊 Total rows: ${count ?? "?"}`);

  const groups = new Map(); // contentKey -> [{id, posted_at, last_seen_at, created_at}, ...]
  let from = 0, scanned = 0;

  while (true) {
    const rows = await fetchPage(from);
    if (rows === null) { console.log(`❌ giving up on page at ${from} after 5 tries — skipping`); from += PAGE; continue; }
    if (rows.length === 0) break;

    for (const row of rows) {
      const key = contentKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    scanned += rows.length;
    if (scanned % 10000 < PAGE) console.log(`  …scanned ${scanned}`);

    from += PAGE;
    if (rows.length < PAGE) break;
  }

  console.log(`\n📊 Scanned ${scanned} rows · ${groups.size} unique content keys`);

  const toDelete = [];
  let dupGroups = 0;
  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    dupGroups++;
    // keep the row with the most recent posted_at (fallback: last_seen_at, then created_at)
    const ts = (r) => new Date(r.posted_at || r.last_seen_at || r.created_at || 0).getTime();
    rows.sort((a, b) => ts(b) - ts(a));
    for (const r of rows.slice(1)) toDelete.push(r.id);
  }

  console.log(`🔁 Duplicate groups: ${dupGroups} · rows to delete: ${toDelete.length}`);

  if (dryRun) {
    console.log("\n(dry run — nothing deleted)");
    return;
  }

  let deleted = 0, failed = 0;
  for (let i = 0; i < toDelete.length; i += 200) {
    const slice = toDelete.slice(i, i + 200);
    let ok = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { error } = await supabase.from("jobs").delete().in("id", slice);
      if (!error) { ok = true; break; }
      console.log(`  ⚠️  delete batch failed (attempt ${attempt}/5): ${error.message}`);
      await sleep(1500 * attempt);
    }
    if (ok) deleted += slice.length; else failed += slice.length;
    if ((i / 200) % 10 === 0) console.log(`  …deleted ${deleted} · failed ${failed}`);
    await sleep(100);
  }

  console.log(`\n✅ Deleted ${deleted} duplicate rows · ${failed} failed`);
  if (failed > 0) console.log("   (re-run to retry the ones that failed)");
}

run();
