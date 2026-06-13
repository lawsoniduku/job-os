/**
 * ingest/core/dedup.js
 * ====================
 * The same role shows up on RemoteOK, the company's Greenhouse board, and an
 * aggregator. URL-only dedup (the old approach) misses these. We dedup on BOTH:
 *   1. canonical apply_url (query/hash stripped)
 *   2. a content key: company + normalized-title + first location token
 * First occurrence wins; later duplicates are dropped.
 */

function canonicalUrl(url = "") {
  return String(url).replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
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
