/**
 * REMOTIVE SOURCE
 * ===============
 * Remotive.com has a free public API with many remote-friendly jobs.
 * Great for Africa/global candidates.
 */

import axios from "axios";

function normalizeJob(job) {
  // Remotive includes salary ranges and category
  let salary_min = null;
  let salary_max = null;

  if (job.salary) {
    const match = job.salary.match(/(\d{2,6})[kK]?\s*[-–to]+\s*(\d{2,6})[kK]?/);
    if (match) {
      salary_min = parseInt(match[1]) * (job.salary.includes("k") || job.salary.includes("K") ? 1000 : 1);
      salary_max = parseInt(match[2]) * (job.salary.includes("k") || job.salary.includes("K") ? 1000 : 1);
    }
  }

  return {
    id: `remotive-${job.id}`,
    title: job.title,
    company: job.company_name,
    location: job.candidate_required_location || "Remote",
    remote: true,
    description: job.description || "",
    apply_url: job.url,
    source: "remotive",
    posted_at: job.publication_date,
    created_at: job.publication_date || new Date().toISOString(),
    salary_min,
    salary_max,
    employment_type: job.job_type || "full_time",
    tags: job.tags || []
  };
}

export async function fetchRemotive() {
  try {
    const res = await axios.get("https://remotive.com/api/remote-jobs", {
      params: { limit: 200 },
      timeout: 20000,
      headers: { "User-Agent": "job-copilot/2.0" }
    });

    const jobs = res.data?.jobs || [];
    return jobs.map(normalizeJob);
  } catch (err) {
    console.log("❌ Remotive fetch failed:", err.message);
    return [];
  }
}
