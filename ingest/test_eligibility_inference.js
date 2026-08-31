/**
 * ingest/test_eligibility_inference.js
 * ====================================
 * Offline assertions for the eligibility engine. No network, no database, no
 * model — every case is a hand-built job object, so this runs in a second and
 * can gate a commit.
 *
 * Run: node ingest/test_eligibility_inference.js
 *
 * Covers the three changes that shipped together:
 *   1. own-country geography in a title is a POSITIVE, not an exclusion
 *   2. physical-presence requirements ("hybrid work", "must relocate")
 *   3. the LLM inference contract, including its precedence guarantees
 *
 * The precedence block at the end is the important one. The whole safety
 * argument for consulting a model at all is that it speaks ONLY where the
 * deterministic engine had nothing to say — if those assertions ever fail, a
 * hallucination can resurrect a role the engine deliberately excluded.
 */

import { checkEligibility, applyInference, INFER_VERSION } from "../api/roleIntelligence.js";

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "✅" : "❌"} ${name}`);
  if (!cond && detail) console.log(`       ${detail}`);
};
const J = (title, location, description = "") =>
  ({ title, location, description, company: "acme", elig_signals: null });
const verdict = (job, country) => checkEligibility(job, country);
const I = (o) => ({ v: INFER_VERSION, countries: [], regions: [], evidence: "stated in the posting", confidence: "high", ...o });

console.log("\n🧭 ELIGIBILITY — own-country geography in the title");
for (const [country, city] of [["india","Mumbai"],["uk","London"],["nigeria","Lagos"],["kenya","Nairobi"],["us","Austin"]]) {
  const v = verdict(J(`Data Analyst - ${city}`, "Remote"), country);
  t(`${country}: "${city}" in title → eligible/certain`, v.eligible && v.confidence === "certain", `got ${v.confidence}: ${v.reason}`);
}

console.log("\n🚫 ELIGIBILITY — someone else's geography still excludes");
for (const [country, city] of [["nigeria","Mumbai"],["nigeria","Tainan"],["nigeria","Tel Aviv"],["nigeria","Krakow"],["kenya","London"]]) {
  const v = verdict(J(`Engineer - ${city}`, "Remote"), country);
  t(`${country}: "${city}" in title → excluded`, !v.eligible, `got ${v.confidence}: ${v.reason}`);
}

console.log("\n🏢 PHYSICAL PRESENCE — excludes on a bare 'Remote'");
for (const [label, body] of [
  ["hybrid, 2 days/week", "You are allowed to hybrid work (remote 2 days/week) once familiar."],
  ["days in the office",  "We expect 3 days in the office each week."],
  ["must relocate",       "The successful candidate must relocate to our HQ."],
  ["on-site position",    "This is an on-site position based at our facility."],
  ["work from our office","You will work from our office alongside the team."],
]) t(label, !verdict(J("Analyst", "Remote", body), "nigeria").eligible);

console.log("\n↩️  PHYSICAL PRESENCE — negations must not invert");
for (const [label, body] of [
  ["'no relocation required'",   "Fully remote, open to candidates worldwide. No relocation required."],
  ["'not a hybrid role'",        "We work from anywhere in the world. This is not a hybrid role."],
  ["'relocation is not required'","Work from anywhere. Relocation is not required."],
]) t(label, verdict(J("Analyst", "Remote", body), "nigeria").eligible);

console.log("\n🔧 PHYSICAL PRESENCE — technology words are not an office");
t("'hybrid cloud' is not an office requirement",
  verdict(J("Cloud Engineer","Remote","Experience with hybrid cloud architecture and on-site data centre migration. Open to candidates worldwide."), "nigeria").eligible);
t("'in-person interview' is not an office requirement",
  verdict(J("Analyst","Remote","Work from anywhere. Final round is an in-person interview."), "nigeria").eligible);

console.log("\n🤖 INFERENCE — confidence gating");
t("low confidence is never acted on", applyInference(I({ scope:"country", countries:["united states"], confidence:"low" }), "nigeria", true) === null);
t("a stale version is ignored",       applyInference({ ...I({ scope:"worldwide" }), v: INFER_VERSION - 1 }, "nigeria", true) === null);
t("'unclear' changes nothing",        applyInference(I({ scope:"unclear" }), "nigeria", true) === null);

console.log("\n⚖️  INFERENCE — an inferred exclusion needs HIGH confidence");
const med = applyInference(I({ scope:"country", countries:["united arab emirates"], confidence:"medium" }), "nigeria", true);
t("medium does NOT hide the role", med.eligible === true && med.confidence === "possible", JSON.stringify(med));
t("medium tells the user to confirm", /worth confirming/.test(med.reason));
t("high DOES exclude", applyInference(I({ scope:"country", countries:["united arab emirates"] }), "nigeria", true).eligible === false);

console.log("\n✅ INFERENCE — positives cap at 'likely', never 'certain'");
t("worldwide → likely",            applyInference(I({ scope:"worldwide" }), "nigeria", true).confidence === "likely");
t("own country named → eligible",  applyInference(I({ scope:"country", countries:["nigeria"] }), "nigeria", true).eligible);
t("EMEA reaches an African user",  applyInference(I({ scope:"region", regions:["emea"] }), "nigeria", true).eligible);
t("APAC does not",                !applyInference(I({ scope:"region", regions:["apac"] }), "nigeria", true).eligible);

console.log("\n🔒 PRECEDENCE — the engine always wins (the safety property)");
const withInfer = (extra) => ({ title:"Analyst", location:"Remote", description:"",
  elig_signals: { v: 2, infer: I({ scope:"worldwide" }), ...extra } });
t("hard exclusion beats an inferred 'worldwide'",  !checkEligibility(withInfer({ hardExclusion:"us citizens only" }), "nigeria").eligible);
t("a country tie beats it",                        !checkEligibility(withInfer({ tiedCountries:["germany"] }), "nigeria").eligible);
t("an onsite requirement beats it",                !checkEligibility(withInfer({ onsiteRequired:"hybrid work" }), "nigeria").eligible);
t("a restriction phrase beats it",                 !checkEligibility(withInfer({ restricted:true }), "nigeria").eligible);
t("a non-English posting beats it",                !checkEligibility(withInfer({ nonEnglishMarkers:true }), "nigeria").eligible);
t("a title geography beats it",
  !checkEligibility({ ...withInfer({}), title:"Analyst - Mumbai" }, "nigeria").eligible);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
