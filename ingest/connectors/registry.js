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
  // African / Nigerian
  { slug: "paystack", name: "Paystack", region: "Africa" },   // ✅ 9
  { slug: "jumia",    name: "Jumia",    region: "Africa" },   // ✅ 5
  { slug: "carbon",   name: "Carbon",   region: "Nigeria" },  // ✅ 9
  // Moniepoint is on Greenhouse's EU instance — needs the eu apiBase, which is
  // why an earlier probe on the default domain returned 0. Verify with verify.js.
  { slug: "moniepoint", name: "Moniepoint", region: "Nigeria",
    apiBase: "https://boards-api.eu.greenhouse.io" },
  // global volume (worldwide-remote friendly)
  { slug: "gitlab",     name: "GitLab" },       // ✅ 136
  { slug: "remote",     name: "Remote.com" },   // ✅ 2
  { slug: "stripe",     name: "Stripe" },       // ✅ 508
  { slug: "airbnb",     name: "Airbnb" },        // ✅ 224
  { slug: "dropbox",    name: "Dropbox" },       // ✅ 56
  { slug: "robinhood",  name: "Robinhood" },     // ✅ 164
  { slug: "coinbase",   name: "Coinbase" },      // ✅ 89
  { slug: "databricks", name: "Databricks" },    // ✅ 768
  { slug: "twilio",     name: "Twilio" },        // ✅ 157
  { slug: "cloudflare", name: "Cloudflare" },    // ✅ 191
  { slug: "discord",    name: "Discord" },       // ✅ 61
  { slug: "figma",      name: "Figma" },         // ✅ 167
  { slug: "anthropic",  name: "Anthropic" },     // ✅ 377
];

export const LEVER_COMPANIES = [
  { slug: "spotify", name: "Spotify" }, // ✅ 147
  // netflix/plaid were live but returned 0 jobs — skipped (re-check later)
];

export const ASHBY_COMPANIES = [
  // African / Nigerian
  { slug: "sabi",  name: "Sabi",  region: "Africa" },   // ✅ 6
  { slug: "lemfi", name: "LemFi", region: "Nigeria" },  // ✅ 14
  // global volume
  { slug: "linear",  name: "Linear" },   // ✅ 25
  { slug: "ramp",    name: "Ramp" },     // ✅ 111
  { slug: "openai",  name: "OpenAI" },   // ✅ 728
  { slug: "notion",  name: "Notion" },   // ✅ 152
  { slug: "runway",  name: "Runway" },   // ✅ 4
  { slug: "posthog", name: "PostHog" },  // ✅ 16
  { slug: "replit",  name: "Replit" },   // ✅ 99
  // vercel/pesto/deel were live but 0 jobs — skipped
];

// Workable + SmartRecruiters boards (slug = the subdomain/company id in the
// careers URL). Start empty; promote whatever verify.js confirms.
export const WORKABLE_COMPANIES = [
  { slug: "kuda", name: "Kuda", region: "Nigeria" }, // ✅ 15
  // moniepoint/autochek were live but 0 jobs — skipped (re-check later)
];
export const SMARTRECRUITERS_COMPANIES = [
  { slug: "Visa", name: "Visa" }, // ✅ 10
  // Andela/Jumia/MTNNigeria/Bolt/Block were live but 0 jobs — skipped (re-check later)
];

// ---------- CANDIDATES TO VERIFY (probed by verify.js, NOT ingested) ----------
// Best-effort slugs. Run `node ingest/verify.js`; promote the green ones into
// the ACTIVE arrays above. African/Nigerian companies are the priority for the
// home market; the global names add raw volume.
export const CANDIDATES_TO_VERIFY = {
  greenhouse: [
    // African / Nigerian
    { slug: "flutterwave", name: "Flutterwave", region: "Africa" },
    { slug: "interswitchgroup", name: "Interswitch", region: "Nigeria" },
    { slug: "jumia", name: "Jumia", region: "Africa" },
    { slug: "andela", name: "Andela", region: "Africa" },
    { slug: "tymebank", name: "TymeBank", region: "Africa" },
    { slug: "opay", name: "OPay", region: "Nigeria" },
    { slug: "palmpay", name: "PalmPay", region: "Nigeria" },
    { slug: "kuda", name: "Kuda", region: "Nigeria" },
    { slug: "chipper", name: "Chipper Cash", region: "Africa" },
    { slug: "chippercash", name: "Chipper Cash", region: "Africa" },
    { slug: "wave", name: "Wave", region: "Africa" },
    { slug: "yoco", name: "Yoco", region: "Africa" },
    { slug: "mfsafrica", name: "MFS Africa", region: "Africa" },
    { slug: "cellulant", name: "Cellulant", region: "Africa" },
    { slug: "smileidentity", name: "Smile ID", region: "Africa" },
    { slug: "termii", name: "Termii", region: "Nigeria" },
    { slug: "carbon", name: "Carbon", region: "Nigeria" },
    { slug: "renmoney", name: "Renmoney", region: "Nigeria" },
    { slug: "umba", name: "Umba", region: "Nigeria" },
    // high-volume global (raw volume)
    { slug: "stripe", name: "Stripe" },
    { slug: "airbnb", name: "Airbnb" },
    { slug: "dropbox", name: "Dropbox" },
    { slug: "robinhood", name: "Robinhood" },
    { slug: "coinbase", name: "Coinbase" },
    { slug: "doordash", name: "DoorDash" },
    { slug: "databricks", name: "Databricks" },
    { slug: "twilio", name: "Twilio" },
    { slug: "cloudflare", name: "Cloudflare" },
    { slug: "discord", name: "Discord" },
    { slug: "figma", name: "Figma" },
    { slug: "anthropic", name: "Anthropic" },
  ],
  lever: [
    // African / Nigerian
    { slug: "moniepoint", name: "Moniepoint", region: "Nigeria" },
    { slug: "paga", name: "Paga", region: "Nigeria" },
    { slug: "piggyvest", name: "PiggyVest", region: "Nigeria" },
    { slug: "patricia", name: "Patricia", region: "Nigeria" },
    { slug: "kobo360", name: "Kobo360", region: "Nigeria" },
    { slug: "thepalmpay", name: "PalmPay", region: "Nigeria" },
    { slug: "reliancehmo", name: "Reliance Health", region: "Nigeria" },
    { slug: "54gene", name: "54gene", region: "Nigeria" },
    { slug: "helium-health", name: "Helium Health", region: "Nigeria" },
    { slug: "lori", name: "Lori Systems", region: "Africa" },
    { slug: "twiga", name: "Twiga Foods", region: "Africa" },
    { slug: "sokowatch", name: "Sokowatch", region: "Africa" },
    // global volume
    { slug: "netflix", name: "Netflix" },
    { slug: "spotify", name: "Spotify" },
    { slug: "plaid", name: "Plaid" },
    { slug: "brex", name: "Brex" },
    { slug: "ramp", name: "Ramp" },
  ],
  ashby: [
    // African / Nigerian
    { slug: "fincra", name: "Fincra", region: "Nigeria" },
    { slug: "anchor", name: "Anchor", region: "Nigeria" },
    { slug: "raenest", name: "Raenest", region: "Nigeria" },
    { slug: "maplerad", name: "Maplerad", region: "Nigeria" },
    { slug: "bujeti", name: "Bujeti", region: "Nigeria" },
    { slug: "grey", name: "Grey", region: "Nigeria" },
    { slug: "cleva", name: "Cleva", region: "Nigeria" },
    { slug: "eden", name: "Eden Life", region: "Nigeria" },
    { slug: "mono", name: "Mono", region: "Nigeria" },
    { slug: "okra", name: "Okra", region: "Nigeria" },
    { slug: "nomba", name: "Nomba", region: "Nigeria" },
    { slug: "prospa", name: "Prospa", region: "Nigeria" },
    { slug: "brass", name: "Brass", region: "Nigeria" },
    { slug: "cowrywise", name: "Cowrywise", region: "Nigeria" },
    { slug: "risevest", name: "Rise", region: "Nigeria" },
    { slug: "bamboo", name: "Bamboo", region: "Nigeria" },
    { slug: "lemfi", name: "LemFi", region: "Nigeria" },
    { slug: "moove", name: "Moove", region: "Africa" },
    { slug: "pesto", name: "Pesto", region: "Africa" },
    // global volume
    { slug: "ramp", name: "Ramp" },
    { slug: "openai", name: "OpenAI" },
    { slug: "notion", name: "Notion" },
    { slug: "runway", name: "Runway" },
    { slug: "deel", name: "Deel" },
    { slug: "posthog", name: "PostHog" },
    { slug: "replit", name: "Replit" },
  ],
  workable: [
    { slug: "kuda", name: "Kuda", region: "Nigeria" },
    { slug: "reliancehealth", name: "Reliance Health", region: "Africa" },
    { slug: "lemfi", name: "LemFi", region: "Nigeria" },
    { slug: "moniepoint", name: "Moniepoint", region: "Nigeria" },
    { slug: "sokowatch", name: "Sokowatch", region: "Africa" },
    { slug: "mookh", name: "Mookh", region: "Africa" },
    { slug: "autochek", name: "Autochek", region: "Africa" },
    { slug: "duplo", name: "Duplo", region: "Nigeria" },
  ],
  smartrecruiters: [
    { slug: "Andela", name: "Andela", region: "Africa" },
    { slug: "Visa", name: "Visa" },
    { slug: "Jumia", name: "Jumia", region: "Africa" },
    { slug: "MTNNigeria", name: "MTN Nigeria", region: "Nigeria" },
    { slug: "Bolt", name: "Bolt" },
    { slug: "Square", name: "Block" },
  ],
};
