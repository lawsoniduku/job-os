/**
 * ingest/import_jobhive_batch.js
 * ================================
 * Runs import_jobhive.js against a CURATED list of sources, one after another,
 * so you don't have to copy-paste 30+ commands by hand. This is for ONE-TIME
 * (or occasional) bulk backfills — NOT a daily cron. The daily cron
 * (.github/workflows/jobhive-import.yml) stays limited to the 6 small, proven
 * sources on purpose; downloading hundreds of MB to several GB every single
 * day would waste bandwidth on data that barely changes upstream.
 *
 * Deliberately EXCLUDED from this list (and from the whole project):
 *   - National/government job boards (arbetsformedlingen, bundesagentur,
 *     wanted, jobsch, eures): these are domestic labor-market services by
 *     design — Sweden's own employment service isn't going to have jobs
 *     open to a candidate in Nigeria. Running them would just burn bandwidth
 *     for a result we can already predict. eures especially: it's the EU's
 *     CITIZEN MOBILITY network (same domestic-rights logic, just EU-wide)
 *     AND the single largest file in the whole dataset (3.6GB) — the worst
 *     possible effort-to-value ratio in the entire list.
 *   - remoteok: banned (paywalled), enforced inside import_jobhive.js itself.
 *   - meta, wellfound: 0 rows, nothing to pull.
 *
 * USAGE:
 *   node --env-file=.env ingest/import_jobhive_batch.js
 *   node --env-file=.env ingest/import_jobhive_batch.js --tier=1     (just the big ones)
 *   node --env-file=.env ingest/import_jobhive_batch.js --from=ashby (resume from here)
 *   node --env-file=.env ingest/import_jobhive_batch.js --dry-run    (sample every source, write nothing)
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMPORTER = path.join(__dirname, "import_jobhive.js");

// Ordered smallest/fastest first so failures surface quickly and you get
// early confirmation the filter pattern holds before the big downloads start.
const SOURCES = {
  tiny: [
    "manfred", "uber", "getonbrd", "programathor", "taleo", "tiktok",
    "google", "apple", "avature", "gem", "pinpoint",
    "recruiterbox", "cornerstone",
  ],
  moderate: [
    "personio", "rippling", "eightfold", "join_com",
    "welcometothejungle", "jazzhr", "beisen", "tesla", "amazon",
  ],
  big_opportunity: [
    "ashby", "lever", "workable", "teamtailor", "smartrecruiters", "greenhouse",
  ],
  enterprise: [
    "oracle", "successfactors", "workday",
  ],
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tierArg = args.find(a => a.startsWith("--tier="))?.split("=")[1];
const fromArg = args.find(a => a.startsWith("--from="))?.split("=")[1];

let queue = tierArg
  ? SOURCES[
      { "1": "big_opportunity", "2": "moderate", "3": "enterprise", "0": "tiny" }[tierArg] || tierArg
    ] || []
  : [...SOURCES.tiny, ...SOURCES.moderate, ...SOURCES.big_opportunity, ...SOURCES.enterprise];

if (fromArg) {
  const idx = queue.indexOf(fromArg);
  if (idx > -1) queue = queue.slice(idx);
}

if (queue.length === 0) {
  console.error("No sources to run. Check --tier= or --from= value.");
  process.exit(1);
}

console.log(`\n🐝 BATCH IMPORT — ${queue.length} sources queued${dryRun ? " (DRY RUN — nothing will be written)" : ""}`);
console.log(`   ${queue.join(", ")}\n`);

function runOne(ats) {
  return new Promise((resolve) => {
    const cliArgs = [IMPORTER, ats];
    if (dryRun) cliArgs.push("--dry-run");
    const child = spawn(process.execPath, cliArgs, { stdio: "inherit", env: process.env });
    child.on("close", (code) => resolve({ ats, code }));
    child.on("error", (err) => resolve({ ats, code: 1, err }));
  });
}

async function main() {
  const results = [];
  for (const ats of queue) {
    console.log(`\n${"─".repeat(60)}\n▶ ${ats}\n${"─".repeat(60)}`);
    const r = await runOne(ats);
    results.push(r);
    // brief pause between sources — same courtesy as the pipeline's own pacing
    await new Promise((res) => setTimeout(res, 2000));
  }

  console.log(`\n\n${"=".repeat(60)}`);
  console.log(`📊 BATCH COMPLETE — ${results.length} sources run`);
  console.log(`${"=".repeat(60)}`);
  const ok = results.filter((r) => r.code === 0);
  const bad = results.filter((r) => r.code !== 0);
  console.log(`   ✅ succeeded: ${ok.map((r) => r.ats).join(", ") || "none"}`);
  if (bad.length) {
    console.log(`   ⚠️  had errors: ${bad.map((r) => r.ats).join(", ")}`);
    console.log(`   Re-run just the failed ones:`);
    for (const r of bad) console.log(`     node --env-file=.env ingest/import_jobhive.js ${r.ats}`);
  }
  console.log(`\n   Check DB size: SELECT pg_size_pretty(pg_database_size(current_database()));\n`);
}

main();
