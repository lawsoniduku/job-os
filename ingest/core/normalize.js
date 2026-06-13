/**
 * ingest/core/normalize.js
 * ========================
 * ONE canonical Job shape that every connector must emit. Retrieval, scoring
 * and enrichment all read these fields, so connectors never leak source-specific
 * quirks downstream.
 *
 * The old pipeline let each source emit a slightly different object and defaulted
 * `remote: true` for unknown jobs (inflating the remote pool). Here `remote` is
 * only true when we can actually infer it.
 */

// strip HTML but KEEP paragraph/line structure, collapse only spaces+tabs
export function cleanText(html = "", max = 3000) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")     // collapse spaces/tabs only
    .replace(/ *\n */g, "\n")    // trim around newlines
    .replace(/\n{3,}/g, "\n\n")  // cap blank lines
    .trim()
    .slice(0, max);
}

const REMOTE_HINTS = ["remote", "anywhere", "distributed", "work from home", "wfh"];
const ONSITE_HINTS = ["on-site", "onsite", "in office", "in-office", "hybrid"];

// Infer remote ONLY from positive signal; default to false (not true).
export function inferRemote({ location = "", description = "", isRemote }) {
  if (typeof isRemote === "boolean") return isRemote; // connector already knew (Ashby/Lever)
  const blob = `${location} ${description}`.toLowerCase();
  if (ONSITE_HINTS.some((h) => blob.includes(h)) && !REMOTE_HINTS.some((h) => blob.includes(h))) return false;
  return REMOTE_HINTS.some((h) => blob.includes(h));
}

// Parse any date shape connectors throw at us: epoch seconds, epoch ms, or ISO.
// Returns a valid ISO string or null (so a bad value can't crash an upsert batch).
export function parseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    let n = Number(s);
    if (n < 1e12) n *= 1000;          // 10-digit epoch seconds -> ms
    const d = new Date(n);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * normalizeJob(raw, meta) -> canonical Job | null
 * Returns null for unusable rows (no url / no title) so callers can filter.
 */
export function normalizeJob(raw, meta = {}) {
  const title = (raw.title || "").trim();
  const apply_url = (raw.apply_url || "").trim();
  if (!title || !apply_url) return null;

  const location = (raw.location || "").trim();
  const description = cleanText(raw.description || "", 3000);
  const posted_at = parseDate(raw.posted_at) || parseDate(raw.created_at) || new Date().toISOString();
  const created_at = parseDate(raw.created_at) || posted_at;

  return {
    title,
    company: (raw.company || meta.company || "Unknown").trim(),
    location,
    description,
    apply_url,
    source: meta.source || raw.source || "unknown",
    ats_source: meta.ats || raw.ats || meta.source || "unknown",
    remote: inferRemote({ location, description, isRemote: raw.isRemote }),
    department: raw.department || null,
    employment_type: raw.employment_type || null,
    posted_at,
    created_at,
    // region/seniority/role_cluster left null here — tagged in core/tag.js
    eligibility_region: null,
    role_cluster: null,
    seniority: null,
    remote_type: null,
    salary_min: raw.salary_min || null,
    salary_max: raw.salary_max || null,
    raw_json: meta.keepRaw ? raw.raw || raw : null,
    _region_hint: meta.region || null,
  };
}
