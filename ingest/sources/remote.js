import axios from "axios";

function normalizeJob(job) {
  return {
    id: job.id || job.uuid || job.slug,
    title: job.title || job.position,
    company: job.company_name || "Remote.com",
    location: job.location || "Remote",
    remote: true,
    description: job.description || "",
    apply_url: job.url || job.apply_url,
    source: "remote",
    tags: job.tags || [],
    created_at: job.created_at || new Date().toISOString()
  };
}

export async function fetchRemoteJobs() {
  try {
    // Remote.com openings endpoint (public job feed pattern)
    const url = "https://remote.com/api/jobs";

    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "job-os"
      }
    });

    const jobs = res.data?.jobs || res.data || [];

    return jobs.map(normalizeJob);
  } catch (err) {
    console.log("❌ Remote.com fetch failed:", err.message);
    return [];
  }
}