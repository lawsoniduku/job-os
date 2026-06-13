/**
 * ingest/connectors/feeds/himalayas.js
 * ====================================
 * Himalayas public API — large, fresh remote-jobs feed.
 * GET https://himalayas.app/jobs/api?limit=N   (no auth)
 * Shape: { jobs: [{ title, companyName, description (HTML), excerpt, pubDate,
 *          applicationLink, guid, locationRestrictions: ["United States"],
 *          seniority, employmentType, categories }] }
 *
 * KEY: `locationRestrictions` is an explicit allow-list of countries. Empty array
 * = no restriction = worldwide. We map it into `location` for the eligibility gate.
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

export async function fetchHimalayas({ limit = 200 } = {}) {
  try {
    const url = `https://himalayas.app/jobs/api?limit=${limit}`;
    const res = await axios.get(url, { timeout: 15000, headers: UA });
    const jobs = (res.data?.jobs || [])
      .map((j) => {
        const restrictions = Array.isArray(j.locationRestrictions) ? j.locationRestrictions.filter(Boolean) : [];
        const location = restrictions.length ? restrictions.join(", ") : "Worldwide";
        return normalizeJob(
          {
            title: j.title,
            company: j.companyName || j.company || "Unknown",
            location,
            description: j.description || j.excerpt || "",
            apply_url: j.applicationLink || j.guid || j.url,
            employment_type: Array.isArray(j.employmentType) ? j.employmentType[0] : j.employmentType || null,
            isRemote: true,
            posted_at: j.pubDate ?? null,
            created_at: j.pubDate ?? null,
          },
          { source: "himalayas", ats: "himalayas" }
        );
      })
      .filter(Boolean);
    console.log(`  ✔ Himalayas: ${jobs.length} jobs`);
    return jobs;
  } catch (e) {
    console.log(`  ❌ Himalayas: ${e.response?.status || e.code || e.message}`);
    return [];
  }
}
