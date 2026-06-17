/**
 * ingest/connectors/feeds/breezy.js
 * =================================
 * Breezy HR's official API requires an auth token, so we CANNOT use it for
 * other companies' jobs. However, public Breezy career sites
 * ({company}.breezy.hr) often expose a public JSON endpoint that backs the
 * page. This connector tries the known public paths and parses whatever it
 * gets. It is best-effort: if Breezy changes their public structure, it fails
 * gracefully (logs ❌, returns []) without breaking the pipeline.
 *
 * NOTE: this is inherently more fragile than the official ATS APIs. Treat it as
 * a bonus source, not a guaranteed one.
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

// Breezy career sites to pull.
export const BREEZY_SITES = [
  { sub: "cowrywise", name: "Cowrywise", region: "Nigeria" },
  // add more: { sub: "companyslug", name: "Company", region: "Africa" },
];

// Public JSON endpoints seen backing Breezy career pages, tried in order.
const PATHS = ["/json", "/positions?state=published", "/positions.json"];

function pickField(obj, ...keys) {
  for (const k of keys) if (obj?.[k] != null && obj[k] !== "") return obj[k];
  return "";
}

function normalizeBreezyJob(p, site) {
  // Breezy public JSON varies; handle the common shapes defensively.
  const title = pickField(p, "name", "title");
  if (!title) return null;
  const loc =
    (typeof p.location === "string" && p.location) ||
    p.location?.name ||
    [p.location?.city?.name, p.location?.country?.name].filter(Boolean).join(", ") ||
    site.region || "";
  const desc = pickField(p, "description", "summary") || title;
  // build an apply URL from the friendly id when present
  const fid = pickField(p, "friendly_id", "_id", "id");
  const apply = pickField(p, "url", "apply_url") ||
    (fid ? `https://${site.sub}.breezy.hr/p/${fid}` : `https://${site.sub}.breezy.hr/`);
  const date = pickField(p, "published_date", "creation_date", "updated_date") || null;

  return normalizeJob(
    {
      title: typeof title === "string" ? title : String(title),
      company: site.name,
      location: typeof loc === "string" ? loc : site.region || "",
      description: typeof desc === "string" ? desc : "",
      apply_url: apply,
      posted_at: date,
      created_at: date,
      isRemote: /remote/i.test(`${title} ${typeof desc === "string" ? desc : ""}`),
    },
    { source: "breezy", ats: "breezy", company: site.name, region: site.region }
  );
}

async function fetchOneSite(site) {
  for (const path of PATHS) {
    const url = `https://${site.sub}.breezy.hr${path}`;
    try {
      const res = await axios.get(url, { timeout: 15000, headers: UA });
      let data = res.data;
      if (typeof data === "string") {
        // some endpoints return text/html; bail to next path
        try { data = JSON.parse(data); } catch { continue; }
      }
      const list = Array.isArray(data) ? data : data?.positions || data?.jobs || [];
      if (!Array.isArray(list) || !list.length) continue;
      const jobs = list.map((p) => normalizeBreezyJob(p, site)).filter(Boolean);
      if (jobs.length) {
        console.log(`  ✔ Breezy ${site.name}: ${jobs.length} jobs (${path})`);
        return jobs;
      }
    } catch (e) {
      continue; // try next path
    }
  }
  console.log(`  ❌ Breezy ${site.name}: no public JSON found (API needs auth)`);
  return [];
}

export async function fetchBreezy(sites = BREEZY_SITES) {
  const results = await Promise.allSettled(sites.map(fetchOneSite));
  const all = [];
  for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
  return all;
}
