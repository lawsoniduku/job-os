/**
 * ingest/prune_stale.js
 * =====================
 * Deletes listings that no feed has re-confirmed for N days.
 *
 * WHY THIS IS SAFE: search already hides anything with last_seen_at older
 * than 28 days (see the freshness gate in api/server.js). Rows past that
 * window are pure storage cost — no user can reach them by any query. The
 * ingest pipeline re-stamps last_seen_at every time a job is still present
 * in its source feed, so "not seen in 28 days" means the employer's own
 * board stopped listing it.
 *
 * WHY IT ISN'T THE WHOLE STORAGE STORY: on a 54k-row table only ~10% is
 * ever this stale, and descriptions (avg ~2.6KB) dominate the footprint.
 * Deleting also does NOT shrink the database on disk — Postgres leaves dead
 * tuples behind and only marks the space reusable. Run VACUUM FULL after
 * this if you actually want the file to shrink (see the reminder printed at
 * the end).
 *
 * ⚠️ WHAT NOT TO DO INSTEAD: truncating stored descriptions would look like
 * an easy win, but the eligibility engine reads the whole JD. The
 * jurisdiction markers (401(k), FLSA, HSA) live in the BENEFITS section,
 * which is almost always at the END of a posting — truncating would blind
 * those checks and silently reintroduce US-only jobs into Nigerian results.
 *
 * USAGE:
 *   node --env-file=.env ingest/prune_stale.js --dry-run     (preview, default 28d)
 *   node --env-file=.env ingest/prune_stale.js               (delete)
 *   node --env-file=.env ingest/prune_stale.js --days 45     (more conservative)
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const i = args.indexOf("--days");
const DAYS = i > -1 && args[i + 1] ? parseInt(args[i + 1], 10) || 28 : 28;
const cutoff = new Date(Date.now() - DAYS * 864e5).toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// THE STALENESS FILTER — every query below goes through this, so the rule
// is stated in exactly one place.
//
// source='employer' is excluded because those rows are OUR OWN postings
// (migration 015 §2), and nothing refreshes their last_seen_at: there is no
// feed to re-confirm them from. Without this they would be deleted 28 days
// after publishing — silently removing the one category of listing on this
// table we know for certain is real, while its job_postings row went on
// claiming to be open. A posting leaves search when its owner pauses or
// closes it, which deletes the mirror deliberately; see the status handler
// in api/employer.js.
const stale = (q) => q.lt("last_seen_at", cutoff).neq("source", "employer");

async function run() {
  console.log(`\n🧹 PRUNE STALE${dryRun ? " (DRY RUN)" : ""} — not re-seen in ${DAYS} days (before ${cutoff.slice(0, 10)})`);

  const { count: total } = await supabase.from("jobs").select("*", { count: "exact", head: true });
  const { count: doomed } = await stale(
    supabase.from("jobs").select("*", { count: "exact", head: true }));
  console.log(`   total rows: ${total}`);
  console.log(`   to delete:  ${doomed}  (${((doomed / total) * 100).toFixed(1)}%)`);

  // Show what's going, oldest first — a sanity check that we're not about to
  // delete something that should still be live.
  const { data: sample } = await stale(
    supabase.from("jobs").select("title, company, source, last_seen_at"))
    .order("last_seen_at", { ascending: true }).limit(12);
  console.log(`\n   oldest examples:`);
  for (const r of sample || []) {
    console.log(`     ${(r.last_seen_at || "").slice(0, 10)}  ${(r.title || "").slice(0, 44).padEnd(46)} @ ${(r.company || "").slice(0, 22)} [${r.source}]`);
  }

  // Which sources lose the most — a source losing everything usually means
  // that connector stopped running, not that its jobs all closed.
  const { data: srcRows } = await stale(
    supabase.from("jobs").select("source")).limit(10000);
  const bySrc = {};
  for (const r of srcRows || []) bySrc[r.source] = (bySrc[r.source] || 0) + 1;
  console.log(`\n   by source:`);
  Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([k, v]) => console.log(`     ${String(v).padStart(6)}  ${k}`));

  if (dryRun) { console.log(`\n   (dry run — nothing deleted)\n`); return; }

  // Delete in id batches so one huge statement can't time out mid-flight.
  let deleted = 0, failed = 0;
  while (true) {
    const { data: batch, error } = await stale(
      supabase.from("jobs").select("id")).limit(500);
    if (error) { console.log(`   ❌ fetch: ${error.message}`); break; }
    if (!batch || batch.length === 0) break;
    const ids = batch.map((r) => r.id);
    let ok = false;
    for (let a = 1; a <= 4; a++) {
      const { error: delErr } = await supabase.from("jobs").delete().in("id", ids);
      if (!delErr) { ok = true; break; }
      console.log(`   ⚠️  delete failed (attempt ${a}/4): ${delErr.message}`);
      await sleep(1500 * a);
    }
    if (ok) { deleted += ids.length; process.stdout.write(`   …deleted ${deleted}\n`); }
    else { failed += ids.length; break; }
    await sleep(120);
  }

  const { count: remaining } = await supabase.from("jobs").select("*", { count: "exact", head: true });
  console.log(`\n✅ Deleted ${deleted} · failed ${failed} · remaining ${remaining}`);
  console.log(`\n   ⚠️  Postgres has NOT returned this space to disk yet — the rows are`);
  console.log(`   dead tuples until vacuumed. To actually shrink the database:`);
  console.log(`     VACUUM FULL public.jobs;      -- Supabase Dashboard → SQL Editor`);
  console.log(`   (locks the table briefly and needs temporary free space)\n`);
}

run();
