/**
 * ingest/probe_job.js
 * ===================
 * READ-ONLY. Finds jobs whose title/company matches a search term and prints
 * exactly what the eligibility engine decides for them + why, plus the raw
 * location/description so we can see what the matcher is actually seeing.
 *
 * Usage:  node ingest/probe_job.js "nexus"
 *         node ingest/probe_job.js "data analyst"
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { checkEligibility } from "../api/roleIntelligence.js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const term = (process.argv[2] || "").toLowerCase();
if (!term) { console.log('Usage: node ingest/probe_job.js "search term"'); process.exit(1); }

const COUNTRY = process.argv[3] || "nigeria"; // target to test against

const { data, error } = await supabase
  .from("jobs")
  .select("title, company, location, description, eligibility_region")
  .or(`title.ilike.%${term}%,company.ilike.%${term}%`)
  .limit(15);

if (error) { console.log("error:", error.message); process.exit(1); }
if (!data?.length) { console.log("no matches for", term); process.exit(0); }

console.log(`\nProbing ${data.length} job(s) matching "${term}" against target=${COUNTRY}\n`);
for (const j of data) {
  const e = checkEligibility(j, COUNTRY);
  console.log("─".repeat(70));
  console.log(`${e.eligible ? "KEEP" : "DROP"}  [${e.confidence}]  ${e.reason}`);
  console.log(`  title:    ${j.title}`);
  console.log(`  company:  ${j.company}`);
  console.log(`  location: ${JSON.stringify(j.location)}`);          // JSON.stringify reveals hidden spacing/encoding
  console.log(`  region:   ${JSON.stringify(j.eligibility_region)}`);
  console.log(`  desc[0..200]: ${JSON.stringify((j.description || "").slice(0, 200))}`);
}
console.log("─".repeat(70));
