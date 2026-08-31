/**
 * api/inferEligibility.js — LLM eligibility inference
 * ===================================================
 * Answers the one question a job posting almost never answers outright:
 * WHO IS ALLOWED TO APPLY?
 *
 * WHY THIS EXISTS. The deterministic engine in roleIntelligence.js reads a
 * posting for phrases that state eligibility. When a posting contains one it
 * is decisive and cheap, and it stays the authority. But measurement on the
 * live corpus showed the majority of listings simply never say — jobhive rows
 * average 2,366 characters of description with no missing data, and the engine
 * still lands on "Remote — region unconfirmed" for ~93% of the last week's
 * results. That is not a data gap that a longer phrase list can close: the
 * sentence being looked for was never written.
 *
 * A model can do what a phrase list cannot — read the whole posting and infer
 * from what IS there. Salary quoted in dollars with a 401(k). Hours given as
 * "9-5 ET". A named office. A legal entity. Those imply a jurisdiction without
 * ever naming an eligibility rule.
 *
 * ── THE CONTRACT, WHICH IS THE IMPORTANT PART ───────────────────────────────
 *
 * THE MODEL ONLY SPEAKS WHERE THE ENGINE SHRUGS. Inference is requested only
 * for postings the deterministic path cannot judge (see needsInference below),
 * and checkEligibility consults it at exactly one place: immediately before it
 * would have returned "region unconfirmed". Every existing rule — hard
 * exclusions, country ties, onsite requirements, jurisdiction locks, the
 * positive-evidence gate — runs first and wins. This is deliberate:
 *
 *   1. It caps cost. Only the genuinely ambiguous rows cost a call, which on
 *      current volume is a minority of a few dozen new jobs a day.
 *   2. It caps blast radius. A hallucinated "worldwide" cannot resurrect a
 *      role the engine already excluded, because the engine already returned.
 *      The worst case is a wrong verdict on a row that was going to be an
 *      unhelpful shrug anyway.
 *
 * EVIDENCE IS MANDATORY. The model must quote the span it inferred from, and a
 * verdict without a usable quote is discarded. This is not decoration: it is
 * the difference between a verdict a user can check and one they must trust.
 * The quote is shown in the UI, so a wrong inference is visibly wrong rather
 * than quietly wrong.
 *
 * NEVER BLOCKS INGEST. Every failure path — no API key, timeout, rate limit,
 * malformed JSON, unparseable scope — returns null, and the job is stored
 * exactly as it is today. Inference is an enrichment, never a gate.
 *
 * ── FREE-TIER BUDGETS THIS FEATURE SPENDS ─────────────────────────────────
 * Both providers are on free plans, so this is a real design constraint and
 * not a footnote. Two separate budgets:
 *
 * GROQ (tokens/minute). Descriptions are capped at 3,000 chars by
 * normalize.js, so a call is ~1,095 tokens. Against ~12,000 TPM that is a hard
 * ceiling of ~11 calls/min — reached long before the 30 requests/min limit.
 * This is why the pass is paced rather than parallel, and why "ask only the
 * ambiguous rows" is a budget decision as much as a correctness one: it is the
 * difference between ~10% of new rows and all of them.
 *
 * SUPABASE (500 MB). Measured: the jobs table is ~125 MB of text, 104 MB of it
 * descriptions, on 53,755 rows. elig_signals is ~14 MB of that. Every key
 * added here multiplies by the row count — `infer` runs ~200 chars, so
 * applying it corpus-wide would add ~10 MB. That is affordable ONCE. It is not
 * affordable as a habit, so resist storing anything here that can be derived
 * from the description at read time, and keep evidence strings short (they are
 * capped at 200 chars in the parser for exactly this reason).
 */

import { generateJSON } from "../lib/llm.js";
import { INFER_VERSION } from "./roleIntelligence.js";

// DEPENDENCY DIRECTION. This module imports from roleIntelligence.js and
// roleIntelligence.js never imports from here — deliberately one-way. The
// verdict half (applyInference, INFER_VERSION) lives with the engine so that
// roleIntelligence.js stays free of the HTTP client, and so search can read a
// stored inference without the model layer being loaded at all. Putting the
// mapping here instead would have made the two files mutually dependent.

// Regions the model may name. Kept to the ones the engine already reasons
// about, so an answer maps onto something the verdict code can use.
const VALID_REGIONS = new Set([
  "emea", "europe", "north_america", "latam", "apac", "seasia",
  "mena", "africa", "anz", "worldwide",
]);

const VALID_SCOPES = new Set(["worldwide", "region", "country", "unclear"]);

/**
 * Is this posting one the deterministic engine cannot judge?
 *
 * Mirrors the conditions under which checkEligibility falls through to
 * "Remote — region unconfirmed": nothing disqualifying, nothing confirming,
 * and a location field that carries no information. Anything that would hit a
 * decisive branch earlier is NOT worth a model call, because the model's
 * answer would be discarded anyway.
 */
export function needsInference(job, signals) {
  const s = signals || job?.elig_signals;
  if (!s) return false;
  // Any decisive negative — the engine already has its answer.
  if (s.hardExclusion || s.nonEnglishMarkers || s.nonEnglishLocal) return false;
  if (s.restricted || s.onsiteRequired || s.jurisdiction) return false;
  if (s.tiedCountries?.length) return false;
  // Any decisive positive — likewise.
  if (s.worldwideDesc) return false;
  // Location must be uninformative, or the location branch decides it.
  const loc = String(job?.location || "").trim().toLowerCase();
  const bare = !loc || [
    "remote", "remote,", "anywhere", "n/a", "-", "not specified",
    "remote worldwide", "fully remote", "global", "worldwide",
  ].includes(loc);
  if (!bare) return false;
  // Nothing to read is nothing to infer from.
  return (job?.description || "").length >= 200;
}

const PROMPT = (job) => `You determine WHO IS LEGALLY ALLOWED TO APPLY for a job, from its posting.

You are NOT judging whether someone is qualified. Only WHERE a candidate may live.

JOB TITLE: ${job.title}
COMPANY: ${job.company || "unknown"}
LOCATION FIELD: ${job.location || "(blank)"}
DESCRIPTION:
${(job.description || "").slice(0, 3000)}

Decide the hiring scope. Weigh indirect evidence, because most postings never state a rule outright:
- Salary in a specific currency, or a country-specific benefit (401k, NHS, RRSP, pension auto-enrolment) => that country.
- Working hours given in one timezone ("9-5 ET", "must overlap 10-4 PST") => that country or region.
- A named office or legal entity that staff are expected to work from => that country.
- Language requirement for a country's local language => that country.
- Explicit "work from anywhere" / "we hire globally" => worldwide.
- Compliance/licensing tied to one jurisdiction (US insurance license, SC clearance) => that country.

Return STRICT JSON:
{
  "scope": "worldwide" | "region" | "country" | "unclear",
  "countries": ["united states"],
  "regions": ["emea"],
  "evidence": "<= 25 words quoted or closely paraphrased FROM THE POSTING",
  "confidence": "high" | "medium" | "low"
}

RULES:
- "scope":"worldwide" ONLY when the posting genuinely implies no location restriction.
- "countries" holds full lowercase country names ("united states", "united kingdom", "india").
- "regions" only from: emea, europe, north_america, latam, apac, seasia, mena, africa, anz, worldwide.
- "evidence" MUST come from the posting. If you cannot point at anything, use "unclear" with an empty evidence string.
- Prefer "unclear" over guessing. An honest "unclear" is far more useful than a confident wrong answer.

WHERE A COMPANY IS BASED IS NOT WHERE IT HIRES. "Headquartered in X", "founded
in X", "our X office" describe a company, not a restriction on candidates —
plenty of globally-remote employers have a head office somewhere. Never rate
headquarters-only evidence "high". Use "medium" at most, and "unclear" if the
posting also calls the role remote. Reserve "high" for the posting actually
restricting WHO MAY APPLY: work authorisation in a named country, a licence or
clearance only issued there, payroll or benefits only available there, or a
stated requirement to live or be present somewhere.`;

/**
 * inferEligibility(job) -> structured verdict, or null.
 * Never throws. Never blocks. Null means "we learned nothing", which leaves
 * the deterministic verdict exactly as it was.
 */
export async function inferEligibility(job) {
  if (!job?.description) return null;
  try {
    const raw = await generateJSON(PROMPT(job), {
      timeoutMs: 20000,
      temperature: 0,
      numCtx: 8192,
      retries: 0,          // ingest runs over many jobs; a retry storm is worse than a gap
    });
    if (!raw) return null;

    const scope = String(raw.scope || "").toLowerCase().trim();
    if (!VALID_SCOPES.has(scope)) return null;

    const evidence = String(raw.evidence || "").trim().slice(0, 200);
    // A verdict we cannot show the user is a verdict we do not keep. "unclear"
    // is the one case allowed to carry no evidence, and it changes nothing
    // downstream anyway.
    if (scope !== "unclear" && evidence.length < 8) return null;

    const countries = (Array.isArray(raw.countries) ? raw.countries : [])
      .map((c) => String(c || "").toLowerCase().trim())
      .filter(Boolean).slice(0, 6);
    const regions = (Array.isArray(raw.regions) ? raw.regions : [])
      .map((r) => String(r || "").toLowerCase().trim().replace(/[\s-]+/g, "_"))
      .filter((r) => VALID_REGIONS.has(r)).slice(0, 4);

    // A country scope with no country named is not a verdict, it's noise.
    if (scope === "country" && !countries.length) return null;
    if (scope === "region" && !regions.length) return null;

    const confidence = ["high", "medium", "low"].includes(raw.confidence)
      ? raw.confidence : "low";

    return { v: INFER_VERSION, scope, countries, regions, evidence, confidence };
  } catch {
    return null;   // see NEVER BLOCKS INGEST above
  }
}
