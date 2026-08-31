/**
 * ingest/infer_pending.js — LLM eligibility inference over pending rows
 * =====================================================================
 * Finds recent jobs the deterministic engine could not judge, asks the model
 * who may apply, and writes the answer into elig_signals.infer.
 *
 * Run: node --env-file=.env ingest/infer_pending.js [--days 14] [--limit 300] [--all]
 *
 * ── WHY THIS IS A SEPARATE PASS AND NOT PART OF ingest/pipeline.js ─────────
 *
 * It was inline first. That was wrong, and the reason is worth recording so
 * nobody moves it back.
 *
 * The pipeline upserts with ignoreDuplicates:true, so it only ever touches a
 * job once — the run in which it first appears. Any row whose inference failed
 * during that run would never be reconsidered. Measured on live data, Groq's
 * free tier rate-limited 7 of 20 calls even at concurrency 2 with pacing, so
 * inline inference would have permanently abandoned about a third of exactly
 * the rows it was built to fix.
 *
 * As a separate pass keyed on "inference is missing", a rate limit costs
 * nothing but time: the row is still pending, and the next run picks it up.
 * Coverage converges instead of leaking. It also keeps model latency out of
 * the ingest critical path.
 *
 * ── SCOPE ─────────────────────────────────────────────────────────────────
 * Defaults to the last 14 days: new jobs only, which is the agreed scope. The
 * existing corpus is left alone until the measured lift justifies a backfill.
 * --all removes the date bound if that decision is ever taken.
 */

import { createClient } from "@supabase/supabase-js";
import { extractEligibilitySignals, SIGNALS_VERSION, INFER_VERSION } from "../api/roleIntelligence.js";
import { inferEligibility, needsInference } from "../api/inferEligibility.js";
import { isLLMHealthy, llmConfig } from "../lib/llm.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DAYS  = Number(arg("--days", 14));
const LIMIT = Number(arg("--limit", 300));
const ALL   = process.argv.includes("--all");

// Rate limiting, not parallelism, is the binding constraint — a 429 arrived on
// a strictly sequential run. These two numbers are the throttle; raising them
// makes runs fail faster, not finish faster.
const CONCURRENCY = Number(process.env.INFER_CONCURRENCY || 2);
const PACE_MS     = Number(process.env.INFER_PACE_MS || 1200);
const RETRY_MS    = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log(`\n🤖 ELIGIBILITY INFERENCE — ${llmConfig.provider}/${llmConfig.model}`);
  console.log(`   scope: ${ALL ? "ALL rows" : `last ${DAYS} days`} · limit ${LIMIT} · concurrency ${CONCURRENCY}\n`);

  if (!(await isLLMHealthy())) {
    console.log("❌ model unreachable — nothing done, safe to re-run later.\n");
    process.exit(1);
  }

  // SCAN SIZE IS NOT WORK SIZE. Only a minority of rows are ambiguous, so the
  // scan has to be much wider than the number we intend to ask about — tying
  // the two together made a --limit of 15 read only 90 rows and find nothing.
  const SCAN = Number(arg("--scan", 3000));
  let q = supabase.from("jobs")
    .select("id, title, company, location, description, elig_signals")
    .order("posted_at", { ascending: false })
    .limit(SCAN);
  if (!ALL) q = q.gte("posted_at", new Date(Date.now() - DAYS * 864e5).toISOString());

  const { data, error } = await q;
  if (error) { console.error("❌", error.message); process.exit(1); }

  // Only rows that are (a) still ambiguous and (b) not already inferred.
  const pending = [];
  for (const job of data) {
    const sig = job.elig_signals?.v === SIGNALS_VERSION
      ? job.elig_signals
      : extractEligibilitySignals(job);
    // Already asked under the CURRENT contract — don't pay twice. Version-aware
    // on purpose: a stale inference is one applyInference will refuse to use,
    // so skipping on mere presence would strand those rows unenriched forever
    // every time the prompt improves.
    if (sig.infer?.v === INFER_VERSION) continue;
    if (!needsInference(job, sig)) continue;       // engine already has an answer
    pending.push({ job, sig });
    if (pending.length >= LIMIT) break;
  }

  console.log(`   ${data.length} scanned → ${pending.length} pending inference\n`);
  if (!pending.length) { console.log("✅ nothing to do.\n"); return; }

  let resolved = 0, unclear = 0, failed = 0, written = 0, recovered = 0;
  const scopes = {};
  let cursor = 0;

  async function worker() {
    while (cursor < pending.length) {
      const { job, sig } = pending[cursor++];
      let infer = null;
      try {
        infer = await inferEligibility(job);
        if (!infer) {                              // usually a 429 — one patient retry
          await sleep(RETRY_MS);
          infer = await inferEligibility(job);
          if (infer) recovered++;
        }
      } catch { /* falls through to failed */ }

      if (!infer) { failed++; await sleep(PACE_MS); continue; }

      scopes[infer.scope] = (scopes[infer.scope] || 0) + 1;
      if (infer.scope === "unclear" || infer.confidence === "low") unclear++; else resolved++;

      // Store even "unclear" and "low". It costs nothing extra, it stops us
      // paying to ask the same question next run, and it is the only record of
      // where the prompt is weak.
      const { error: upErr } = await supabase.from("jobs")
        .update({ elig_signals: { ...sig, infer } })
        .eq("id", job.id);
      if (upErr) failed++; else written++;

      if (written % 25 === 0 && written) process.stdout.write(`   …${written} written\n`);
      await sleep(PACE_MS);
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  const pct = pending.length ? ((resolved / pending.length) * 100).toFixed(0) : "0";
  console.log(`\n✅ ${pending.length} asked in ${secs}s`);
  console.log(`   ${resolved} resolved (${pct}%) · ${unclear} still unclear · ${failed} failed${recovered ? ` · ${recovered} recovered after backoff` : ""}`);
  console.log(`   scopes: ${Object.entries(scopes).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`);
  console.log(`   written: ${written}`);
  if (failed) console.log(`   ${failed} left pending — they are picked up by the next run, nothing is lost.`);
  console.log();
}

run().catch((e) => { console.error("❌", e.message); process.exit(1); });
