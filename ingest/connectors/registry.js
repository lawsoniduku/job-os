/**
 * ingest/connectors/registry.js
 * =============================
 * TWO kinds of lists:
 *   - ACTIVE arrays (GREENHOUSE_/LEVER_/ASHBY_COMPANIES): boards confirmed LIVE.
 *     The pipeline ingests ONLY these, so your runs stay clean.
 *   - CANDIDATES_TO_VERIFY: more African companies whose slug we're unsure of.
 *     `node ingest/verify.js` probes these too. When one comes back ✅, move it
 *     up into the matching ACTIVE array.
 *
 * `region` is a hint persisted to eligibility_region for African-HQ employers.
 */

// ---------- ACTIVE (verified live on your run) ----------
export const GREENHOUSE_COMPANIES = [
  { slug: "paystack", name: "Paystack", region: "Africa" }, // 11 jobs ✅
  { slug: "gitlab",   name: "GitLab" },                     // 141 jobs ✅
  { slug: "remote",   name: "Remote.com" },                 // 2 jobs ✅
];

export const LEVER_COMPANIES = [
  // none confirmed live yet — add here once verify.js shows ✅
];

export const ASHBY_COMPANIES = [
  { slug: "sabi",   name: "Sabi",   region: "Africa" }, // 6 jobs ✅
  { slug: "linear", name: "Linear" },                   // 25 jobs ✅
  { slug: "vercel", name: "Vercel" },                   // valid board ✅
];

// Workable + SmartRecruiters boards (slug = the subdomain/company id in the
// careers URL). Start empty; promote whatever verify.js confirms.
export const WORKABLE_COMPANIES = [
  // { slug: "example", name: "Example", region: "Africa" },
];
export const SMARTRECRUITERS_COMPANIES = [
  // { slug: "Example", name: "Example", region: "Africa" },
];

// ---------- CANDIDATES TO VERIFY (probed by verify.js, NOT ingested) ----------
// Best-effort African-startup slugs. Run verify.js; promote the green ones.
export const CANDIDATES_TO_VERIFY = {
  greenhouse: [
    { slug: "flutterwave", name: "Flutterwave", region: "Africa" },
    { slug: "interswitchgroup", name: "Interswitch", region: "Nigeria" },
    { slug: "jumia", name: "Jumia", region: "Africa" },
    { slug: "andela", name: "Andela", region: "Africa" },
    { slug: "tymebank", name: "TymeBank", region: "Africa" },
  ],
  lever: [
    { slug: "moniepoint", name: "Moniepoint", region: "Nigeria" },
    { slug: "paga", name: "Paga", region: "Nigeria" },
    { slug: "piggyvest", name: "PiggyVest", region: "Nigeria" },
    { slug: "patricia", name: "Patricia", region: "Nigeria" },
  ],
  ashby: [
    { slug: "fincra", name: "Fincra", region: "Nigeria" },
    { slug: "anchor", name: "Anchor", region: "Nigeria" },
    { slug: "raenest", name: "Raenest", region: "Nigeria" },
    { slug: "maplerad", name: "Maplerad", region: "Nigeria" },
    { slug: "bujeti", name: "Bujeti", region: "Nigeria" },
    { slug: "grey", name: "Grey", region: "Nigeria" },
    { slug: "cleva", name: "Cleva", region: "Nigeria" },
    { slug: "eden", name: "Eden Life", region: "Nigeria" },
    { slug: "mono", name: "Mono", region: "Nigeria" },
  ],
  workable: [
    { slug: "kuda", name: "Kuda", region: "Nigeria" },
    { slug: "reliancehealth", name: "Reliance Health", region: "Africa" },
    { slug: "lemfi", name: "LemFi", region: "Nigeria" },
    { slug: "moniepoint", name: "Moniepoint", region: "Nigeria" },
  ],
  smartrecruiters: [
    { slug: "Andela", name: "Andela", region: "Africa" },
    { slug: "Visa", name: "Visa" },
  ],
};
