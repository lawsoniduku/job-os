/**
 * ingest/connectors/feeds/jobicy.js
 * =================================
 * Jobicy public API — remote jobs (tech, marketing, support, etc.).
 * GET https://jobicy.com/api/v2/remote-jobs?count=N   (no auth)
 * Shape: { jobs: [{ id, url, jobTitle, companyName, jobGeo, jobLevel, jobType,
 *          jobIndustry, pubDate, jobDescription (HTML), annualSalaryMin/Max }] }
 *
 * KEY: `jobGeo` is an explicit eligibility field ("Anywhere", "USA", "EMEA"...).
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

export async function fetchJobicy({ count = 100 } = {}) {
  try {
    const url = `https://jobicy.com/api/v2/remote-jobs?count=${count}`;
    const res = await axios.get(url, { timeout: 15000, headers: UA });
    const jobs = (res.data?.jobs || [])
      .map((j) =>
        normalizeJob(
          {
            title: j.jobTitle,
            company: j.companyName,
            location: j.jobGeo || "Anywhere",
            description: j.jobExcerpt || j.jobDescription || "",
            apply_url: j.url,
            employment_type: Array.isArray(j.jobType) ? j.jobType[0] : j.jobType || null,
            salary_min: j.annualSalaryMin || null,
            salary_max: j.annualSalaryMax || null,
            isRemote: true,
            posted_at: j.pubDate || null,
            created_at: j.pubDate || null,
          },
          { source: "jobicy", ats: "jobicy" }
        )
      )
      .filter(Boolean);
    console.log(`  ✔ Jobicy: ${jobs.length} jobs`);
    return jobs;
  } catch (e) {
    console.log(`  ❌ Jobicy: ${e.response?.status || e.code || e.message}`);
    return [];
  }
}
