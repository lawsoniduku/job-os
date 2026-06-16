/**
 * ingest/test_scoring.js
 * ======================
 * Regression test for the search scoring + eligibility engine. Run this after
 * ANY change to api/roleIntelligence.js so we don't re-break a case we already
 * fixed (the "whack-a-mole" problem).
 *
 * Run: node ingest/test_scoring.js
 * Exit code 0 = all pass, 1 = something regressed.
 *
 * Each case is a real pattern we hit during development. Add new ones whenever
 * a real search surfaces a mis-score — that locks the fix in permanently.
 */

import { checkEligibility, parseIntent, detectCluster } from "../api/roleIntelligence.js";

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : `  got=${got} want=${want}`}`);
}

console.log("\n=== ELIGIBILITY (target: nigeria) ===");
const E = (job) => checkEligibility(job, "nigeria").eligible;
const C = (job) => checkEligibility(job, "nigeria").confidence;

// non-English local-market roles → drop
check("Portuguese body dropped", E({ title:"Analytics Engineer", location:"Anywhere in the World", description:"Estamos revolucionando. Buscamos uma pessoa que combine excelência técnica e ambição." }), false);

// location field lies "Anywhere" but body ties to a foreign country → drop
check("Mexico HQ body dropped", E({ title:"Business Analyst", location:"Anywhere in the World", description:"Headquarters Mexico. CRM Mexico City Mexico remote available must speak english." }), false);
check("Remote, UK body dropped", E({ title:"Data Analyst", location:"Remote,", description:"Job title Data Analyst Location Remote, UK Full-time Permanent." }), false);

// real-world glued/mojibake scraped text ("UKFull-time", "AnalystLocation")
check("Glued 'UKFull' text dropped", E({ title:"Data Analyst", location:"Remote,", description:"Posted 3:15 PM. Job title : Data AnalystLocation : Remote, UKFull-time PermanentReports to Head of Data. See similar jobs on LinkedIn." }), false);
check("Global role w/ acronyms kept", E({ title:"Data Analyst", location:"Anywhere in the World", description:"We use AWS and SQL. Fully distributed team, work from anywhere in the world." }), true);

// genuine worldwide → keep, certain
check("Genuine global kept", E({ title:"Data Analyst", location:"Anywhere in the World", description:"Fully distributed team hiring globally, work from anywhere, strong SQL." }), true);
check("Work-from-anywhere in body = certain", C({ title:"Data Analyst", location:"Remote", description:"Location: Remote (Work from Anywhere). Competitive pay." }), "certain");

// passing foreign mention (not a location tie) → keep
check("UK passing mention kept", E({ title:"Data Analyst", location:"Worldwide", description:"Some clients in the uk use our tool, fully remote, work from anywhere." }), true);
check("US customers passing kept", E({ title:"Data Analyst", location:"Worldwide", description:"We serve clients in the united states market, fully remote globally." }), true);

// explicit US restriction → drop
check("US-only dropped", E({ title:"Data Analyst", location:"Remote", description:"Must be authorized to work in the united states." }), false);

// nigeria-targeted role → keep, certain
check("Nigeria role kept certain", C({ title:"Data Analyst", location:"Lagos, Nigeria", description:"Based in Nigeria, Lagos office.", eligibility_region:"Nigeria" }), "certain");

console.log("\n=== CLUSTER CLASSIFICATION ===");
const CL = (t) => detectCluster(t).cluster;
const clusters = [
  ["Software Engineer", "Software Engineering"],
  ["Backend / API Engineer, Billing", "Software Engineering"],
  ["Android Engineer", "Software Engineering"],
  ["Civil Engineer", "Civil / Mechanical / Electrical Engineering"],
  ["Registered Nurse", "Healthcare / Medical"],
  ["Accountant", "Accounting / Audit"],
  ["Internal Auditor", "Accounting / Audit"],
  ["Solutions Architect", "Solutions Architecture / Pre-Sales"],
  ["Sales Engineer", "Solutions Architecture / Pre-Sales"],
  ["Project Manager", "Project / Program Management"],
  ["Secondary School Teacher", "Education / Teaching"],
  ["Legal Officer", "Legal"],
  ["Procurement Officer", "Supply Chain / Logistics"],
  ["Data Analyst", "Data Analytics"],
  ["Data Scientist", "Data Science"],
  ["Product Manager", "Product Management"],
  ["Sales Manager", "Sales"],
];
for (const [t, want] of clusters) check(`cluster "${t}"`, CL(t), want);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
