/**
 * Read-only trace of Nigeria/Africa-seeded direct employer boards.
 * These employers can publish roles in other countries too; the final
 * personalized eligibility check is separate from their registry region.
 * JobHive coverage is audited through import_jobhive.js --dry-run.
 * Usage: node ingest/trace_nigeria.js
 */
import { fetchGreenhouse } from "./connectors/ats/greenhouse.js";
import { fetchLever } from "./connectors/ats/lever.js";
import { fetchAshby } from "./connectors/ats/ashby.js";
import { fetchWorkable } from "./connectors/ats/workable.js";
import { fetchSmartRecruiters } from "./connectors/ats/smartrecruiters.js";
import { fetchTeamtailor } from "./connectors/feeds/teamtailor.js";
import { fetchBreezy } from "./connectors/feeds/breezy.js";
import { GREENHOUSE_COMPANIES, LEVER_COMPANIES, ASHBY_COMPANIES,
  WORKABLE_COMPANIES, SMARTRECRUITERS_COMPANIES } from "./connectors/registry.js";
import { looksEnglishJob } from "./core/language.js";
import { dedupe, canonicalUrl } from "./core/dedup.js";
import { tagJob } from "./core/tag.js";
import { checkEligibility } from "../api/roleIntelligence.js";
import { publicationIsDiscoverable } from "../api/jobFreshness.js";

const regional = companies => companies.filter(company => ["Nigeria", "Africa"].includes(company.region));
const sources = [
  ["greenhouse", () => fetchGreenhouse(regional(GREENHOUSE_COMPANIES))],
  ["lever", () => fetchLever(regional(LEVER_COMPANIES))],
  ["ashby", () => fetchAshby(regional(ASHBY_COMPANIES))],
  ["workable", () => fetchWorkable(regional(WORKABLE_COMPANIES))],
  ["smartrecruiters", () => fetchSmartRecruiters(regional(SMARTRECRUITERS_COMPANIES))],
  ["teamtailor", () => fetchTeamtailor()],
  ["breezy", () => fetchBreezy()],
];
console.log("\nTracing Nigeria/Africa-seeded direct employer boards (no DB writes)\n");
const settled = await Promise.allSettled(sources.map(([, fetcher]) => fetcher()));
const fetched = [];
for (const [index, result] of settled.entries()) {
  if (result.status === "fulfilled") fetched.push(...result.value);
  else console.error(`${sources[index][0]} failed: ${result.reason?.message || result.reason}`);
}
const fresh = fetched.filter(job => publicationIsDiscoverable(job));
console.log(`Publication freshness: ${fresh.length} retained, ${fetched.length - fresh.length} excluded`);

console.log(`1. Fetched:          ${fetched.length}`);

if (!fetched.length) {
  console.log("\n⚠️  Nothing fetched — the selected direct employer boards returned no jobs.");
  console.log("   Check the source errors and registry slugs before interpreting this as no openings.\n");
  process.exit(0);
}

// sample a few raw jobs
console.log("\n   Sample of first 3 fetched jobs:");
for (const j of fetched.slice(0, 3)) {
  console.log(`   - "${j.title}" @ ${j.company} | loc=${JSON.stringify(j.location)} | url=${j.apply_url}`);
}

const eng = fresh.filter((j) => looksEnglishJob(j));
console.log(`\n2. After English:    ${eng.length}  (dropped ${fresh.length - eng.length})`);
if (fresh.length - eng.length > 0) {
  const dropped = fresh.filter((j) => !looksEnglishJob(j));
  console.log("   Examples dropped as non-English:");
  for (const j of dropped.slice(0, 5)) console.log(`   - "${j.title}"`);
}

const deduped = dedupe(eng);
console.log(`\n3. After dedup:      ${deduped.length}  (dropped ${eng.length - deduped.length})`);

// check for URL or content-key collisions within Nigeria itself
const urls = eng.map((j) => canonicalUrl(j.apply_url));
const dupUrls = urls.filter((u, i) => urls.indexOf(u) !== i);
console.log(`   Duplicate URLs across direct employer boards: ${new Set(dupUrls).size} (${dupUrls.length} total dups)`);
if (dupUrls.length) console.log(`   e.g. ${[...new Set(dupUrls)].slice(0, 3).join("\n        ")}`);

const tagged = deduped.map(tagJob);
const byRegion = {};
for (const j of tagged) { const r = j.eligibility_region || "(none)"; byRegion[r] = (byRegion[r] || 0) + 1; }
console.log(`\n4. After tag — eligibility_region breakdown:`);
Object.entries(byRegion).forEach(([r, n]) => console.log(`   ${String(n).padStart(4)}  ${r}`));

console.log(`\n✅ Regional employer candidates before personalized Nigerian eligibility: ${tagged.length}\n`);

const nigeriaEligible = tagged.filter(job => checkEligibility(job, "nigeria").eligible !== false);
console.log(`Nigerian search candidates after eligibility: ${nigeriaEligible.length}`);
