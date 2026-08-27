/**
 * ingest/test_signals_parity.js
 * =============================
 * PARITY TEST for the precomputed-eligibility refactor.
 *
 * checkEligibility() now reads a small precomputed blob (jobs.elig_signals)
 * instead of scanning the full description on every request. That is only a
 * safe optimisation if it produces EXACTLY the same verdict as computing from
 * the description — otherwise we'd be silently changing who sees what job,
 * which is the one thing this product cannot get wrong.
 *
 * So: for every sampled row, run the verdict twice —
 *   A) with elig_signals stripped  -> forces the from-description path
 *   B) with elig_signals attached  -> the precomputed path
 * and assert they match, across several target countries.
 *
 * USAGE: node --env-file=.env ingest/test_signals_parity.js [sampleSize]
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { checkEligibility, extractEligibilitySignals } from "../api/roleIntelligence.js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const N = parseInt(process.argv[2], 10) || 1500;
const COUNTRIES = ["nigeria", "kenya", "ghana", "africa", null];

async function run() {
  console.log(`\n🔬 SIGNALS PARITY — ${N} rows × ${COUNTRIES.length} target countries\n`);
  const { data, error } = await supabase.from("jobs")
    .select("id,title,company,location,description,eligibility_region,remote")
    .order("id").limit(N);
  if (error) { console.log("fetch failed:", error.message); process.exit(1); }

  let checked = 0, mismatch = 0;
  const examples = [];

  for (const row of data) {
    const signals = extractEligibilitySignals(row);
    for (const country of COUNTRIES) {
      // A: no signals -> computes from description
      const fromDesc = checkEligibility({ ...row, elig_signals: null }, country);
      // B: signals present, description REMOVED entirely — proves the blob is
      // sufficient on its own, not quietly leaning on the description.
      const fromSignals = checkEligibility({ ...row, description: null, elig_signals: signals }, country);
      checked++;
      if (fromDesc.eligible !== fromSignals.eligible ||
          fromDesc.confidence !== fromSignals.confidence ||
          fromDesc.reason !== fromSignals.reason) {
        mismatch++;
        if (examples.length < 8) {
          examples.push(`  ${(row.title || "").slice(0, 40)} @ ${row.company} [${country}]\n` +
            `     from description: ${fromDesc.eligible} / ${fromDesc.confidence} / ${fromDesc.reason}\n` +
            `     from signals    : ${fromSignals.eligible} / ${fromSignals.confidence} / ${fromSignals.reason}`);
        }
      }
    }
  }

  console.log(`  verdicts compared : ${checked}`);
  console.log(`  mismatches        : ${mismatch}`);
  if (examples.length) { console.log("\n  examples:"); examples.forEach((e) => console.log(e)); }
  console.log(mismatch === 0
    ? "\n✅ PARITY — precomputed signals reproduce every verdict exactly.\n"
    : `\n❌ ${mismatch} verdicts differ — do NOT drop description from the search payload.\n`);
  process.exit(mismatch === 0 ? 0 : 1);
}

run();
