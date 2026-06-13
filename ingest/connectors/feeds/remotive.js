/**
 * ingest/connectors/feeds/remotive.js
 * ===================================
 * Remotive public API — a big, fresh feed of curated remote jobs.
 * GET https://remotive.com/api/remote-jobs?limit=N   (no auth)
 * Shape: { jobs: [{ id, url, title, company_name, candidate_required_location,
 *          salary, job_type, publication_date, description (HTML), category }] }
 *
 * KEY: `candidate_required_location` is an explicit eligibility field
 * ("Worldwide", "USA Only", "Europe", "USA, Canada"...). We map it straight into
 * `location` so the eligibility engine reads it as authoritative.
 *
 * NOTE: Remotive asks for light usage (a few calls/day). One call/day is plenty.
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

export async function fetchRemotive({ limit = 200 } = {}) {
  try {
    const url = `https://remotive.com/api/remote-jobs?limit=${limit}`;
    const res = await axios.get(url, { timeout: 15000, headers: UA });
    const jobs = (res.data?.jobs || [])
      .map((j) =>
        normalizeJob(
          {
            title: j.title,
            company: j.company_name,
            // explicit eligibility field -> location (authoritative for the gate)
            location: j.candidate_required_location || "Worldwide",
            description: j.description || "",
            apply_url: j.url,
            employment_type: j.job_type || null,
            isRemote: true,
            posted_at: j.publication_date || null,
            created_at: j.publication_date || null,
          },
          { source: "remotive", ats: "remotive" }
        )
      )
      .filter(Boolean);
    console.log(`  ✔ Remotive: ${jobs.length} jobs`);
    return jobs;
  } catch (e) {
    console.log(`  ❌ Remotive: ${e.response?.status || e.code || e.message}`);
    return [];
  }
}
