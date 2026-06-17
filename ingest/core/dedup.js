/**
 * ingest/core/dedup.js
 * ====================
 * The same role shows up on RemoteOK, the company's Greenhouse board, and an
 * aggregator. URL-only dedup (the old approach) misses these. We dedup on BOTH:
 *   1. canonical apply_url (query/hash stripped)
 *   2. a content key: company + normalized-title + first location token
 * First occurrence wins; later duplicates are dropped.
 */

// Strip tracking/fragment noise but PRESERVE meaningful identifying params.
// Some boards (e.g. MyJobMag: a_fields.php?id=123) encode the job's identity in
// the query string — stripping the whole query collapses every job to one URL
// and dedup nukes them all. So we keep identity-ish params (id, job, jobid,
// gh_jid, lever id, etc.) and drop only known tracking params.
const KEEP_PARAMS = /^(id|jobid|job_id|job|jid|gh_jid|lever|posting|pid|p|ref_id)$/i;
function canonicalUrl(url = "") {
  let s = String(url).replace(/#.*$/, "").replace(/\/+$/, "").trim();
  const qIdx = s.indexOf("?");
  if (qIdx === -1) return s.toLowerCase();
  const base = s.slice(0, qIdx);
  const params = s.slice(qIdx + 1).split("&").filter(Boolean);
  const kept = params
    .filter((kv) => KEEP_PARAMS.test(kv.split("=")[0]))
    .sort(); // stable order so param ordering can't create false uniques
  return (kept.length ? `${base}?${kept.join("&")}` : base).toLowerCase();
}

function contentKey(job) {
  const company = (job.company || "").toLowerCase().trim();
  const title = (job.title || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const loc = (job.location || "").toLowerCase().split(/[,/|]/)[0].trim();
  return `${company}::${title}::${loc}`;
}

export function dedupe(jobs) {
  const seenUrl = new Set();
  const seenContent = new Set();
  const out = [];
  for (const j of jobs) {
    if (!j) continue;
    const u = canonicalUrl(j.apply_url);
    const c = contentKey(j);
    if (!u || seenUrl.has(u) || seenContent.has(c)) continue;
    seenUrl.add(u);
    seenContent.add(c);
    out.push(j);
  }
  return out;
}
