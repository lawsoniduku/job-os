import { detectEligibilityRegion } from "./tag.js";
import { cleanText } from "./normalize.js";
import { createHash } from "node:crypto";
import { checkEligibility, extractEligibilitySignals } from "../../api/roleIntelligence.js";

// JobHive conversion and import policy, kept pure for offline regression tests.
export const JOBHIVE_KEEP_REGIONS = new Set(["Africa", "Nigeria", "Global", "Remote", "EMEA"]);

export function parseRemoteFlag(value) {
  const flag = String(value ?? "").trim();
  if (/^(true|1|yes)$/i.test(flag)) return true;
  if (/^(false|0|no)$/i.test(flag)) return false;
  return undefined; // Missing or unfamiliar is not affirmative evidence of on-site work.
}

export function rowToRaw(record) {
  const g = (name) => (record[name] || "").trim();
  // REAL jobhive v2.0 schema (from manifest stats.schema_columns):
  //   url, title, company, ats_type, ats_id, location, is_remote, salary_min,
  //   salary_max, salary_currency, salary_period, salary_summary,
  //   employment_type, department, team, description, posted_at,
  //   requisition_id, apply_url, commitment, raw, country_iso
  return {
    title: g("title"),
    company: g("company"),
    location: g("location"),
    description: g("description"),
    // apply_url is the employer's real link; url is jobhive's canonical. Prefer apply_url.
    apply_url: g("apply_url") || g("url"),
    posted_at: g("posted_at"),
    created_at: g("posted_at"),
    employment_type: g("employment_type") || g("commitment") || null,
    department: g("department") || null,
    salary_min: g("salary_min") || null,
    salary_max: g("salary_max") || null,
    isRemote: parseRemoteFlag(g("is_remote")),
    _country_iso: g("country_iso").toUpperCase(),
    _fetched_at: g("fetched_at"),
    _application_deadline: g("application_deadline"),
  };
}

// African ISO-3166 alpha-2 codes retained by the existing regional import policy.
const AFRICAN_ISO = new Set([
  "NG","GH","KE","ZA","EG","MA","TZ","UG","RW","ET","SN","CI","CM","DZ","TN",
  "ZM","ZW","BW","NA","MZ","AO","MU","MW","LY","SD","SS","BJ","BF","ML","NE",
  "TD","SO","SL","LR","TG","GA","GN","GM","GW","CV","CG","CD","CF","DJ","ER",
  "SZ","LS","MG","KM","ST","SC","MR","BI",
]);

/**
 * Cheap pre-filter before the expensive normalize+tag step. Streaming 726K rows
 * means we want to reject the obvious bulk (in-office roles in the US/EU/Asia)
 * without running the full classifier on each one.
 *
 * Deliberately conservative: we only fast-reject when a job has a CONCRETE
 * non-African country AND is explicitly non-remote. Unknown flags or countries
 * still go through region classification — because
 * "Remote, country_iso=US" might be genuinely global, and only
 * detectEligibilityRegion can judge that from the text.
 */
export function fastReject(raw) {
  const iso = raw._country_iso;
  if (!iso) return false;                    // unknown country -> let the engine decide
  if (AFRICAN_ISO.has(iso)) return false;    // African -> always evaluate
  if (raw.isRemote !== false) return false;  // remote or unknown -> evaluate
  // A conflicting feed boolean is not enough to discard explicit role-location
  // evidence before the authority sees it. This only defers the decision:
  // residency/onsite restrictions still run through the unchanged engine.
  if (/\b(remote|worldwide|anywhere|global|emea)\b/i.test(raw.location || '')) return false;
  return true;                                // concrete foreign + on-site -> drop
}


// Recover explicit worldwide hiring evidence rejected by the coarse region tag.
// Re-evaluate full source text so restrictions beyond the stored excerpt count.
// This does not admit generic Remote/Unknown or widen the source inventory.
export function recoverWorldwideJob(job, raw) {
  if (JOBHIVE_KEEP_REGIONS.has(job.eligibility_region)) return job;
  const full = { ...job, description: cleanText(raw.description, Infinity) };
  full.elig_signals = extractEligibilitySignals(full);
  // Coarse country hints and company marketing can mis-tag an explicit EMEA
  // hiring location. Ask the same country engine used by search before the
  // import allow-list throws it away; do not expand a customer-region mention.
  if (/\bemea\b|europe[, /-]+middle east[, /&-]+(?:and )?africa/i.test(job.location || '')) {
    const regionVerdict = checkEligibility(full,"nigeria");
    if (regionVerdict.eligible && ["certain","likely"].includes(regionVerdict.confidence))
      return {...job,eligibility_region:"EMEA",elig_signals:full.elig_signals};
  }
  const candidate = { ...full, eligibility_region: "Global" };
  const worldwideLocation = detectEligibilityRegion("", job.location, null, job.country_iso) === "Global";
  const genericLocation = /^(?:remote(?:\s+job)?|fully remote|work from home)?$/i.test((job.location || "").trim());
  if (!worldwideLocation && !(genericLocation && candidate.elig_signals.worldwideDesc)) return job;
  const verdict = checkEligibility(candidate, "nigeria");
  if (!verdict.eligible || !["certain", "likely"].includes(verdict.confidence)) return job;
  return { ...job, eligibility_region: "Global", elig_signals: candidate.elig_signals };
}

function sourceDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) return null;
  const dateOnly = text.slice(0, 10);
  const midnight = new Date(`${dateOnly}T00:00:00Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== dateOnly) return null;
  const qualified = text.length === 10 ? `${text}T00:00:00Z` : /(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text.replace(" ", "T")}Z`;
  const date = new Date(qualified);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function sourceObservation(raw, now = Date.now()) {
  const fetchedAt = sourceDate(raw._fetched_at);
  let deadline = sourceDate(raw._application_deadline);
  // A date without a time remains open through that UTC calendar day.
  if (deadline && /^\d{4}-\d{2}-\d{2}$/.test(raw._application_deadline || "")) {
    deadline = new Date(Date.parse(deadline) + 86400000 - 1).toISOString();
  }
  const hash = createHash("sha256").update(JSON.stringify([raw.title, raw.location, cleanText(raw.description, Infinity), raw._country_iso, raw.isRemote])).digest("hex");
  const source = { fetched_at: fetchedAt, application_deadline: deadline, hash };
  if (fetchedAt && Date.parse(fetchedAt) < now - 28 * 86400000) return { source, rejection: "upstream_stale" };
  if (fetchedAt && Date.parse(fetchedAt) > now + 86400000) return { source, rejection: "upstream_future" };
  if (deadline && Date.parse(deadline) < now) return { source, rejection: "deadline_expired" };
  return { source, rejection: null };
}

export function createRejectionLedger(sampleLimit = 3) {
  const counts = {}, samples = {};
  return {
    counts, samples,
    record(reason, raw = {}) {
      counts[reason] = (counts[reason] || 0) + 1;
      const bucket = samples[reason] ||= [];
      if (bucket.length < sampleLimit) bucket.push({ title: String(raw.title || "").slice(0, 100), location: String(raw.location || "").slice(0, 100) });
    },
  };
}
