/**
 * ingest/eval_remote_eligibility.js
 * =================================
 * EVAL HARNESS for the core promise: a job labelled "remote" must only be
 * surfaced to a Nigerian user when it is genuinely globally accessible.
 *
 * Runs the REAL checkEligibility() from api/roleIntelligence.js over real
 * rows, so before/after numbers are measured rather than asserted.
 *
 * Two populations:
 *   TARGET  — eligibility_region='Remote'. Remote-ish, no worldwide language,
 *             no country in the location field. Today these surface to
 *             Nigerian users as eligible ("Remote — region unconfirmed").
 *             This is the bucket under investigation.
 *   CONTROL — eligibility_region='Global'. Genuinely open roles. These MUST
 *             stay eligible; if this number drops, the fix is too aggressive.
 *
 * Within TARGET we flag rows carrying decisive country-lock evidence, using
 * word-boundary matching (a naive substring check for "ada" also matches
 * "Canada" and "adaptable" — that inflated an earlier count 4x).
 *
 * USAGE: node --env-file=.env ingest/eval_remote_eligibility.js
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { checkEligibility } from "../api/roleIntelligence.js";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const SAMPLE = 1200;

const bound = (text, phrase) =>
  new RegExp(`(?:^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i").test(text);
const anyOf = (text, arr) => arr.some((p) => bound(text, p));

// Country-specific STATUTORY instruments. Not vibes — legal/tax constructs
// that only exist for domestic payroll. You cannot enrol a Nigeria-based hire
// in a 401(k) (US Internal Revenue Code s.401), a UK pension with National
// Insurance, or an Australian superannuation fund. Their presence is positive
// evidence of where the employer can actually put someone on payroll.
// HARD = role-level payroll/tax/immigration instruments. A Nigeria-based hire
// cannot receive these, so surfacing such a role is a defect. Target: 0.
const US_STATUTORY = ["401(k)", "401k", "flsa", "w-2", "hsa", "cobra",
  "e-verify", "social security number", "green card", "h-1b", "us citizen", "u.s. citizen"];
// SOFT = US EEO/anti-discrimination boilerplate. Tracked but NOT treated as a
// defect: it describes the employer, not the role, and a US-incorporated but
// globally-distributed company carries it while still hiring worldwide.
// Excluding on it would hide exactly the roles this product exists to surface.
const US_BOILERPLATE = ["protected veteran", "veteran status", "americans with disabilities act"];
const UK_STATUTORY = ["national insurance", "hmrc", "right to work in the uk"];
const CA_STATUTORY = ["rrsp", "canada pension plan"];
const AU_STATUTORY = ["superannuation"];

const US_STATES = ["alabama","alaska","arizona","arkansas","california","colorado","connecticut",
  "delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky",
  "louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri",
  "montana","nebraska","nevada","new hampshire","new jersey","new mexico","north carolina",
  "north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina",
  "south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia",
  "wisconsin","wyoming"];

async function fetchRows(region, limit) {
  for (let a = 1; a <= 4; a++) {
    const { data, error } = await supabase.from("jobs")
      .select("id,title,company,location,description,eligibility_region,source")
      .eq("eligibility_region", region).order("id").limit(limit);
    if (!error) return data;
    console.log(`  retry ${a}/4 (${region}): ${error.message}`);
    await new Promise((r) => setTimeout(r, 1500 * a));
  }
  return [];
}

function evaluate(rows, label) {
  let eligible = 0;
  const reasons = {};
  const leaks = { statutory: [], state: [] };

  for (const r of rows) {
    const v = checkEligibility(r, "nigeria");
    if (v.eligible) {
      eligible++;
      const d = (r.description || "").toLowerCase();
      const t = (r.title || "").toLowerCase();
      // DEFECT: surfaced despite a role-level payroll/tax lock.
      if (anyOf(d, US_STATUTORY) || anyOf(d, UK_STATUTORY) || anyOf(d, CA_STATUTORY) || anyOf(d, AU_STATUTORY)) {
        if (leaks.statutory.length < 10) leaks.statutory.push(`${r.title} @ ${r.company}`);
        leaks.statutoryCount = (leaks.statutoryCount || 0) + 1;
      }
      // TRACKED, NOT A DEFECT: US EEO boilerplate only — deliberately allowed.
      if (!anyOf(d, US_STATUTORY) && anyOf(d, US_BOILERPLATE))
        leaks.boilerplateCount = (leaks.boilerplateCount || 0) + 1;
      if (anyOf(t, US_STATES)) {
        if (leaks.state.length < 10) leaks.state.push(`${r.title} @ ${r.company}`);
        leaks.stateCount = (leaks.stateCount || 0) + 1;
      }
    }
    reasons[v.reason] = (reasons[v.reason] || 0) + 1;
  }

  const pct = (n) => ((n / rows.length) * 100).toFixed(1) + "%";
  console.log(`\n── ${label} (n=${rows.length}) ──`);
  console.log(`   ELIGIBLE (shown to a Nigerian user): ${eligible} (${pct(eligible)})`);
  console.log(`   top verdicts:`);
  Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .forEach(([k, v]) => console.log(`      ${String(v).padStart(4)}  ${k}`));
  if (label.startsWith("TARGET")) {
    console.log(`   DEFECTS — surfaced as eligible despite a role-level country lock (target: 0):`);
    console.log(`      payroll/tax instrument (401k / FLSA / NI / RRSP …): ${leaks.statutoryCount || 0}`);
    console.log(`      US state named in TITLE:                            ${leaks.stateCount || 0}`);
    console.log(`   (tracked, allowed by policy — US EEO boilerplate only: ${leaks.boilerplateCount || 0})`);
    (leaks.statutory.slice(0, 5)).forEach((e) => console.log(`        · ${e}`));
    (leaks.state.slice(0, 4)).forEach((e) => console.log(`        · ${e}`));
  }
  return { eligible, n: rows.length };
}

async function run() {
  console.log("\n🎯 REMOTE-ELIGIBILITY EVAL — target country: nigeria");
  console.log("═".repeat(64));
  const target = await fetchRows("Remote", SAMPLE);
  const control = await fetchRows("Global", 400);
  const t = evaluate(target, "TARGET  eligibility_region='Remote'");
  const c = evaluate(control, "CONTROL eligibility_region='Global' (must stay eligible)");
  console.log("\n" + "═".repeat(64));
  console.log(`SUMMARY  target eligible ${t.eligible}/${t.n} · control eligible ${c.eligible}/${c.n}`);
}

run();
