/**
 * ingest/connectors/feeds/arbeitnow.js
 * ====================================
 * Arbeitnow public job board API (Europe-heavy, but flags visa sponsorship +
 * remote, which is useful eligibility signal).
 * GET https://www.arbeitnow.com/api/job-board-api   (no auth, paginated)
 * Shape: { data: [{ slug, company_name, title, description (HTML), remote,
 *          location, tags[], job_types[], visa_sponsorship (bool), url,
 *          created_at (epoch seconds) }], links: { next } }
 *
 * NOTE: Arbeitnow is mostly German/EU roles. The language filter (looksEnglish)
 * downstream drops the non-English ones; we keep it because the visa-sponsorship
 * flag surfaces genuinely-relocatable roles for international candidates.
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.2)", Accept: "application/json" };

export async function fetchArbeitnow({ pages = 2 } = {}) {
  const out = [];
  try {
    let url = "https://www.arbeitnow.com/api/job-board-api";
    for (let p = 0; p < pages && url; p++) {
      const res = await axios.get(url, { timeout: 15000, headers: UA });
      const rows = res.data?.data || [];
      for (const j of rows) {
        // If a role explicitly offers visa sponsorship, surface that in the
        // location so the eligibility gate treats it as broadly open.
        const loc = j.visa_sponsorship
          ? `${j.location || ""} (visa sponsorship)`.trim()
          : (j.remote ? (j.location || "Remote") : j.location || "");
        out.push(
          normalizeJob(
            {
              title: j.title,
              company: j.company_name,
              location: loc,
              description: j.description || "",
              apply_url: j.url,
              employment_type: Array.isArray(j.job_types) ? j.job_types[0] : null,
              isRemote: !!j.remote,
              posted_at: j.created_at || null,
              created_at: j.created_at || null,
            },
            { source: "arbeitnow", ats: "arbeitnow" }
          )
        );
      }
      url = res.data?.links?.next || null;
    }
    const jobs = out.filter(Boolean);
    console.log(`  ✔ Arbeitnow: ${jobs.length} jobs`);
    return jobs;
  } catch (e) {
    console.log(`  ❌ Arbeitnow: ${e.response?.status || e.code || e.message}`);
    return out.filter(Boolean);
  }
}
