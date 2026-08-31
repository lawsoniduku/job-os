/**
 * ingest/backfill_signals.js
 * ==========================
 * One-time (and idempotent) backfill of jobs.elig_signals — the precomputed
 * eligibility blob that lets search stop fetching descriptions. See
 * migration 011 and SIGNALS_VERSION in api/roleIntelligence.js.
 *
 * WHY NOT JUST RUN reclassify.js: it updates one row at a time with a 60ms
 * courtesy pause between writes. That's the right shape when a handful of
 * labels changed, but here EVERY row needs a write on the first pass —
 * 48k rows x (~100ms write + 60ms pause) is over two hours. This script does
 * the same work with bounded concurrency and no per-row pause, which brings
 * it down to minutes. reclassify.js still backfills signals as a side effect
 * for any stragglers; this is just the bulk path.
 *
 * Only touches elig_signals. Labels, regions and descriptions are left alone,
 * so it can't undo anything reclassify.js decided.
 *
 * USAGE:
 *   node --env-file=.env ingest/backfill_signals.js
 *   node --env-file=.env ingest/backfill_signals.js --all        (re-stamp every row)
 *   node --env-file=.env ingest/backfill_signals.js --concurrency 16
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { extractEligibilitySignals, SIGNALS_VERSION } from "../api/roleIntelligence.js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const args = process.argv.slice(2);
const ALL = args.includes("--all");
// 8 measured clean on a home connection; 24 produced a 44% `TypeError: fetch
// failed` rate — the client simply can't hold that many concurrent TLS
// connections open, and every failure costs 4 retries before the row is
// skipped. Higher is only safe on a datacenter link (see the GitHub Action).
const ci = args.indexOf("--concurrency");
const CONCURRENCY = ci > -1 && args[ci + 1] ? parseInt(args[ci + 1], 10) || 8 : 8;
const PAGE = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage() {
  for (let a = 1; a <= 5; a++) {
    // Always pull the OLDEST-id rows still missing signals. Because we write
    // signals as we go, the "still missing" set shrinks every pass — no
    // offset bookkeeping, and a crash just resumes where it left off.
    let q = supabase.from("jobs")
      // elig_signals is selected so writeOne can carry the LLM inference
      // across — see the comment there. Without it this backfill silently
      // deletes work that cost model calls to produce.
      .select("id, title, location, description, eligibility_region, elig_signals")
      .order("id").limit(PAGE);
    if (!ALL) q = q.is("elig_signals", null);
    const { data, error } = await q;
    if (!error) return data || [];
    console.log(`  ⚠️  fetch failed (${a}/5): ${error.message}`);
    await sleep(1500 * a);
  }
  return null;
}

let lastError = null;   // surfaced in the progress line — silent failures hid
                        // a 44% error rate behind a plausible-looking counter
async function writeOne(row) {
  const signals = extractEligibilitySignals(row);
  // PRESERVE THE INFERENCE. extractEligibilitySignals derives everything from
  // the posting text; infer is the one key it cannot regenerate, because it
  // came from a model call that cost money and time (see
  // ingest/infer_pending.js). This update replaces the whole jsonb column, so
  // without carrying it forward explicitly, every run of this backfill would
  // wipe the inferences and they would have to be bought again.
  if (row.elig_signals?.infer) signals.infer = row.elig_signals.infer;
  for (let a = 1; a <= 4; a++) {
    const { error } = await supabase.from("jobs")
      .update({ elig_signals: signals }).eq("id", row.id);
    if (!error) return true;
    lastError = error.message;
    await sleep(700 * a);
  }
  return false;
}

async function run() {
  console.log(`\n🧬 BACKFILL elig_signals (v${SIGNALS_VERSION}) — concurrency ${CONCURRENCY}${ALL ? " — ALL rows" : ""}\n`);
  const { count: total } = await supabase.from("jobs").select("*", { count: "exact", head: true });
  const { count: missing } = await supabase.from("jobs")
    .select("*", { count: "exact", head: true }).is("elig_signals", null);
  console.log(`   total rows: ${total} · missing signals: ${missing}\n`);

  let done = 0, failed = 0;
  const started = Date.now();

  while (true) {
    const page = await fetchPage();
    if (page === null) { console.log("   ❌ giving up — fetch kept failing"); break; }
    if (page.length === 0) break;

    const queue = [...page];
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const row = queue.shift();
        (await writeOne(row)) ? done++ : failed++;
      }
    }));

    const rate = done / Math.max((Date.now() - started) / 1000, 1);
    const left = Math.max((missing || 0) - done, 0);
    console.log(`   …${done} written · ${failed} failed · ${rate.toFixed(0)}/s · ~${Math.ceil(left / Math.max(rate, 1) / 60)}min left`
      + (failed > 0 && lastError ? `   last error: ${lastError.slice(0, 60)}` : ""));
    if (failed > done * 0.2 && done > 200) {
      console.log(`\n   ⚠️  failure rate above 20% — lower --concurrency (8 is safe on a home link),`);
      console.log(`      or run the GitHub Action, which has a datacenter connection.\n`);
    }

    // --all has no shrinking predicate to page through, so stop after one pass.
    if (ALL) break;
  }

  const { count: stillMissing } = await supabase.from("jobs")
    .select("*", { count: "exact", head: true }).is("elig_signals", null);
  const covered = total > 0 ? (1 - (stillMissing || 0) / total) * 100 : 0;
  console.log(`\n✅ written ${done} · failed ${failed}`);
  console.log(`   coverage: ${covered.toFixed(1)}% (${stillMissing} rows still missing)`);
  console.log(covered >= 95
    ? `   search will switch to the lean payload within 10 minutes (no redeploy needed).\n`
    : `   below the 95% threshold — search stays on the full-description path. Re-run to finish.\n`);
}

run();
