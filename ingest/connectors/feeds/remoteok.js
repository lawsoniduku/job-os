/**
 * ingest/connectors/feeds/remoteok.js
 * ===================================
 * RemoteOK public API.
 * GET https://remoteok.com/api   (no auth, but REQUIRES a User-Agent)
 * Returns an array; element [0] is a legal/metadata notice, the rest are jobs:
 *   { id, slug, company, position, tags[], logo, description (HTML),
 *     location, url, apply_url, date, epoch, salary_min, salary_max }
 *
 * RemoteOK's `location` is frequently "Worldwide" or a region tag; when empty
 * we leave it blank so the eligibility engine treats it as bare remote.
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1; +https://example.com)", Accept: "application/json" };

export async function fetchRemoteOK() {
  try {
    const res = await axios.get("https://remoteok.com/api", { timeout: 15000, headers: UA });
    const rows = Array.isArray(res.data) ? res.data.filter((r) => r && r.id && r.position) : [];
    const jobs = rows
      .map((j) =>
        normalizeJob(
          {
            title: j.position,
            company: j.company,
            location: j.location || "Worldwide", // RemoteOK is remote-only; default worldwide
            description: j.description || (Array.isArray(j.tags) ? j.tags.join(", ") : ""),
            apply_url: j.apply_url || j.url,
            salary_min: j.salary_min || null,
            salary_max: j.salary_max || null,
            isRemote: true,
            posted_at: j.date ?? j.epoch ?? null,
            created_at: j.date ?? j.epoch ?? null,
          },
          { source: "remoteok", ats: "remoteok" }
        )
      )
      .filter(Boolean);
    console.log(`  ✔ RemoteOK: ${jobs.length} jobs`);
    return jobs;
  } catch (e) {
    console.log(`  ❌ RemoteOK: ${e.response?.status || e.code || e.message}`);
    return [];
  }
}
