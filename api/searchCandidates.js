import { compareTrustResults } from '../shared/jobTrust.js';
import { activeJobSources, isActiveJobSource } from './sourcePolicy.js';
import { getAliasesForCluster, scoreJobLocally, checkEligibility, SIGNALS_VERSION } from "./roleIntelligence.js";
import { applyVerification, nonVacancyReason } from "./postingVerification.js";
import { canonicalUrl } from "../ingest/core/dedup.js";

import { publicationIsDiscoverable, publicationFilter, sourceVisibilityFilter } from "./jobFreshness.js";

const PAGE_SIZE = 1000;
const PARTITIONS = 4;
const DAY = 86400000;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Quoting protects PostgREST's OR grammar, independently of regex escaping.
const quoteFilter = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function titlePattern(phrases) {
  const aliases = [...new Set(phrases.map((a) => String(a).trim().toLowerCase()).filter(Boolean))];
  // PostgreSQL's native word constraints let pg_trgm use boundary trigrams
  // even for two-letter aliases. A negated-character-class boundary forces a
  // costly scan on the same live dataset. Keep punctuation aliases literal.
  const words = aliases.filter((a) => /^[a-z0-9].*[a-z0-9]$|^[a-z0-9]$/.test(a));
  const other = aliases.filter((a) => !words.includes(a));
  return [words.length ? `\\m(${words.map(escapeRegex).join("|")})\\M` : null,
    ...other.map((a) => `(^|[^[:alnum:]])${escapeRegex(a)}(?=$|[^[:alnum:]])`)].filter(Boolean).join("|");
}

export function applyRoleQuery(query, intent) {
  if (intent.cluster) {
    const filters = getAliasesForCluster(intent.cluster).map((alias) => {
      const contains = `title.ilike.${quoteFilter(`%${alias}%`)}`;
      // Index-friendly literal retrieval for long titles, then the shared
      // scorer verifies the role. Short abbreviations MUST also be whole words
      // in SQL; otherwise EA/PA/VA pull thousands of unrelated candidates.
      return alias.length <= 3
        ? `and(${contains},title.imatch.${quoteFilter(titlePattern([alias]))})`
        : contains;
    });
    return query.or([`role_cluster.eq.${quoteFilter(intent.cluster)}`, ...filters].join(","));
  }
  for (const keyword of intent.keywords || []) query = query.filter("title", "imatch", titlePattern([keyword]));
  return query;
}

// Both endpoints use the same visibility gates and exhaust the relevant pool.
// Keyset pagination avoids the old newest-600 cutoff and Supabase's row limit.
export async function fetchCandidates({ db, intent, columns, lean, hasLiveness, suppressed = new Set(), now = Date.now() }) {
  if (!intent.cluster && !intent.keywords?.length) throw new Error("Include a job title or role in your search.");
  const byId = new Map();
  // Four disjoint UUID ranges keep broad pools parallel without imposing
  // sixteen round trips on small searches. Production reads returned the
  // complete software pool in one parallel wave at the REST limit of 1000.
  // Every range still exhausts keyset pages; this is not a candidate cap.
  const boundary = n => `${n.toString(16)}0000000-0000-0000-0000-000000000000`;
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < PARTITIONS) {
      const partition = cursor++;
      let after = null;
      for (;;) {
        let query = applyRoleQuery(activeJobSources(db.from("jobs").select(columns)), intent)
          .or(sourceVisibilityFilter(now))
          .or(publicationFilter(now));
        if (hasLiveness) query = query.or("link_status.is.null,link_status.neq.dead");
        if (after !== null) query = query.gt("id", after);
        else if (partition > 0) query = query.gte("id", boundary(partition * 4));
        if (partition < PARTITIONS - 1) query = query.lt("id", boundary((partition + 1) * 4));
        const { data, error } = await query.order("id", { ascending: true }).limit(PAGE_SIZE);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const job of data) if (!suppressed.has(job.id)) byId.set(job.id, job);
        const next = data.at(-1).id;
        if (next === after) throw new Error("Search pagination did not advance");
        after = next;
        if (data.length < PAGE_SIZE) break;
      }
    }
  }));
  const rows = [...byId.values()].sort((a,b) => String(a.id).localeCompare(String(b.id)));
  // Schema capability does not imply complete signal coverage. Hydrate every
  // stale/missing row rather than evaluating it without a job description.
  if (lean) {
    const missing = rows.filter((j) => j.elig_signals?.v !== SIGNALS_VERSION);
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const { data, error } = await db.from("jobs").select("id,description").in("id", chunk.map((j) => j.id));
      if (error) throw new Error(error.message);
      const descriptions = new Map((data || []).map((j) => [j.id, j.description]));
      for (const job of chunk) job.description = descriptions.get(job.id) || "";
    }
  }
  return rows;
}

// Shared by initial searches and refinements; spacing/currency must not turn
// a salary request into an unrelated new search.
export function parseSalaryFloor(text = '') {
  const s = String(text).toLowerCase();
  const m = s.match(/(?:\b(?:above|over|minimum|at least)\b|>)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/)
    || s.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*\+/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n * (m[2] || n < 1000 ? 1000 : 1) : null;
}

export function sanitizeFilters(filters = {}) {
  const oneOf = (value, values) => values.includes(value) ? value : null;
  return {
    salFloor: Number.isFinite(filters.salFloor) && filters.salFloor > 0 ? filters.salFloor : null,
    seniorityFilter: oneOf(filters.seniorityFilter, ["senior", "junior", "manager"]),
    sourceFilter: oneOf(filters.sourceFilter, ["lever", "greenhouse", "ashby", "workable"]),
    maxAgeDays: Number.isFinite(filters.maxAgeDays) && filters.maxAgeDays > 0 ? Math.min(filters.maxAgeDays, 365) : null,
    employmentFilter: oneOf(filters.employmentFilter, ["full_time", "part_time", "contract"]),
  };
}

export function matchesFilters(job, filters, now = Date.now()) {
  if (!publicationIsDiscoverable(job, now)) return false;
  const f = sanitizeFilters(filters);
  if (f.salFloor && ![job.salary_min, job.salary_max].some((s) => s != null && Number(s) >= f.salFloor)) return false;
  if (f.maxAgeDays && !(Date.parse(job.posted_at) >= now - f.maxAgeDays * DAY)) return false;
  if (f.sourceFilter && ![job.source, job.ats_source].some((s) => String(s || "").toLowerCase().split(/[:/]/).includes(f.sourceFilter))) return false;
  if (f.employmentFilter && String(job.employment_type || "").toLowerCase().replace(/[- ]/g, "_") !== f.employmentFilter) return false;
  if (f.seniorityFilter) {
    const title = String(job.title || "").toLowerCase();
    const senior = /\b(senior|sr|lead|principal|staff)\b/.test(title);
    const manager = /\b(manager|head|director|vp|chief)\b/.test(title);
    const junior = /\b(junior|jr|entry|graduate|intern|trainee)\b/.test(title);
    // Explicit title level wins over a stale stored seniority label.
    const level = senior ? "senior" : manager ? "manager" : junior ? "junior" : job.seniority;
    if (level !== f.seniorityFilter) return false;
  }
  return true;
}

// Role, eligibility and freshness remain gates. Supported eligibility plus current
// employer availability leads; publication recency orders within each trust bucket.
// Import timestamps never substitute for publication dates.
export function compareSearchResults(a, b, now = Date.now()) {
  return compareTrustResults(a, b, now);
}

export function rankCandidates(rows, intent, filters = {}, now = Date.now(), postingChecksApplied = false) {
  const exclusionReasons = {};
  const matching = [];
  const exclude = reason => {exclusionReasons[reason]=(exclusionReasons[reason] || 0)+1;};
  for (const sourceJob of rows) {
    // Employer evidence must be applied before source geography can exclude a
    // job. These decisive gates cannot be changed by its title/relevance score.
    const job = sourceJob.verification ? sourceJob : sourceJob.elig_signals?.verification
      ? applyVerification(sourceJob, sourceJob.elig_signals.verification) : sourceJob;
    const earlyReason = !isActiveJobSource(job) ? 'retired_source'
      : job.verification?.status === 'dead' ? 'closed' : null;
    if (earlyReason) {exclude(earlyReason);continue;}
    const eligibility = intent.locationCountry ? checkEligibility(job,intent.locationCountry) : null;
    // Dual role/location failures are counted by location; exclusion totals do not change.
    if (eligibility?.eligible === false) {exclude('location_eligibility');continue;}

    // All eligible/uncertain candidates retain the full scorer and its remote
    // requirement checks, reusing the same country verdict instead of rereading it.
    const r = scoreJobLocally(job, intent, eligibility);
    const j = {...job,score:r.score,eligibility:r.eligibility,offTarget:r.offTarget,
      match_breakdown:r.breakdown,match_reason:r.eligibility.reason};
    const reason = j.offTarget ? 'role_mismatch' : j.eligibility.eligible === false ? 'location_eligibility'
      : nonVacancyReason(j) ? 'non_vacancy' : !matchesFilters(j,filters,now) ? 'filters_or_freshness' : null;
    if (reason) exclude(reason); else matching.push(j);
  }
  matching.sort((a, b) => compareSearchResults(a, b, now));
  const urls = new Set(), contents = new Set();
  const results = matching.filter((j) => {
    const url = canonicalUrl(j.apply_url || "");
    // Preserve location distinctions and don't merge employers with missing names.
    const key = j.company && j.title ? [j.company, j.title, j.location || ""].map((s) => s.toLowerCase().trim().replace(/\s+/g, " ")).join("::") : null;
    if ((url && urls.has(url)) || (key && contents.has(key))) return false;
    if (url) urls.add(url);
    if (key) contents.add(key);
    return true;
  });
  return { results, evaluated: rows.length, excluded: rows.length - matching.length, duplicates: matching.length - results.length, exclusionReasons };
}
