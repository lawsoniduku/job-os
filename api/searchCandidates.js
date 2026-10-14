import { getAliasesForCluster, scoreJobLocally, SIGNALS_VERSION } from "./roleIntelligence.js";
import { canonicalUrl } from "../ingest/core/dedup.js";

const PAGE_SIZE = 500;
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
  const rows = [];
  let after = null;
  for (;;) {
    let query = applyRoleQuery(db.from("jobs").select(columns), intent)
      .or(`last_seen_at.is.null,last_seen_at.gte.${new Date(now - 28 * DAY).toISOString()}`);
    if (hasLiveness) query = query.or("link_status.is.null,link_status.neq.dead");
    // Coarse eligibility_region tags are NOT a country gate. They can be stale,
    // null, or merely the country of the employer, and used to hide real matches.
    if (after !== null) query = query.gt("id", after);
    const { data, error } = await query.order("id", { ascending: true }).limit(PAGE_SIZE);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data.filter((j) => !suppressed.has(j.id)));
    const next = data.at(-1).id;
    if (next === after) throw new Error("Search pagination did not advance");
    after = next;
    if (data.length < PAGE_SIZE) break;
  }
  // The coverage probe permits up to 5% stale/missing signals. Hydrate precisely
  // those rows rather than evaluating them with an absent job description.
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

export function rankCandidates(rows, intent, filters = {}, now = Date.now()) {
  const scored = rows.map((job) => {
    const r = scoreJobLocally(job, intent);
    return { ...job, score: r.score, eligibility: r.eligibility, offTarget: r.offTarget, match_breakdown: r.breakdown, match_reason: r.eligibility.reason };
  });
  const matching = scored.filter((j) => j.eligibility.eligible !== false && !j.offTarget && matchesFilters(j, filters, now));
  matching.sort((a, b) => b.score - a.score || (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0) || String(a.id).localeCompare(String(b.id)));
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
  return { results, evaluated: scored.length, excluded: scored.length - matching.length, duplicates: matching.length - results.length };
}
