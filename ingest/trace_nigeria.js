/**
 * ingest/trace_nigeria.js
 * ======================
 * READ-ONLY (no DB writes). Fetches ONLY the MyJobMag Nigeria feed and traces
 * its jobs through each pipeline stage, printing how many survive each step:
 *   fetched -> English filter -> dedup -> tag (eligibility_region)
 * This pinpoints exactly where Nigerian jobs are being lost.
 *
 * Usage: node ingest/trace_nigeria.js
 */

import { fetchMyJobMag } from "./connectors/feeds/myjobmag.js";
import { looksEnglish } from "./core/language.js";
import { dedupe } from "./core/dedup.js";
import { tagJob } from "./core/tag.js";

// Only the Nigeria site.
const NIGERIA_ONLY = [{
  base: "https://www.myjobmag.com",
  country: "Nigeria", region: "Nigeria",
  feeds: [
    "https://www.myjobmag.com/aggregate_feed.xml",
    "https://www.myjobmag.com/jobsxml_by_categories.xml",
    "https://www.myjobmag.com/jobsxml.xml",
  ],
}];

console.log("\n🇳🇬 TRACING MyJobMag Nigeria through the pipeline\n");

const fetched = await fetchMyJobMag({ sites: NIGERIA_ONLY });
console.log(`1. Fetched:          ${fetched.length}`);

if (!fetched.length) {
  console.log("\n⚠️  Nothing fetched — the Nigeria feed itself returned no jobs.");
  console.log("   (Network issue, or the feed URL changed.) Stop here.\n");
  process.exit(0);
}

// sample a few raw jobs
console.log("\n   Sample of first 3 fetched jobs:");
for (const j of fetched.slice(0, 3)) {
  console.log(`   - "${j.title}" @ ${j.company} | loc=${JSON.stringify(j.location)} | url=${j.apply_url}`);
}

const eng = fetched.filter((j) => looksEnglish(`${j.title} ${j.description}`));
console.log(`\n2. After English:    ${eng.length}  (dropped ${fetched.length - eng.length})`);
if (fetched.length - eng.length > 0) {
  const dropped = fetched.filter((j) => !looksEnglish(`${j.title} ${j.description}`));
  console.log("   Examples dropped as non-English:");
  for (const j of dropped.slice(0, 5)) console.log(`   - "${j.title}"`);
}

const deduped = dedupe(eng);
console.log(`\n3. After dedup:      ${deduped.length}  (dropped ${eng.length - deduped.length})`);

// check for URL or content-key collisions within Nigeria itself
const urls = eng.map((j) => String(j.apply_url || "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase());
const dupUrls = urls.filter((u, i) => urls.indexOf(u) !== i);
console.log(`   Duplicate URLs within Nigeria feed: ${new Set(dupUrls).size} (${dupUrls.length} total dups)`);
if (dupUrls.length) console.log(`   e.g. ${[...new Set(dupUrls)].slice(0, 3).join("\n        ")}`);

const tagged = deduped.map(tagJob);
const byRegion = {};
for (const j of tagged) { const r = j.eligibility_region || "(none)"; byRegion[r] = (byRegion[r] || 0) + 1; }
console.log(`\n4. After tag — eligibility_region breakdown:`);
Object.entries(byRegion).forEach(([r, n]) => console.log(`   ${String(n).padStart(4)}  ${r}`));

console.log(`\n✅ Final Nigerian jobs that would reach upsert: ${tagged.length}\n`);
