/**
 * NODESK / REMOTEHABITS job feed
 * Falls back gracefully if down
 */
import axios from "axios";
export async function fetchArbeitnow() {
  // arbeitnow.com has a free remote jobs API
  try {
    const res = await axios.get("https://www.arbeitnow.com/api/job-board-api", {
      timeout: 15000, headers: { "User-Agent": "job-copilot/3.0" }
    });
    const jobs = res.data?.data || [];
    return jobs.filter(j => j.remote).map(j => ({
      title: j.title,
      company: j.company_name || "Unknown",
      location: j.location || "Remote",
      remote: true,
      description: (j.description || "").replace(/<[^>]*>/g,"").slice(0,2000),
      apply_url: j.url,
      source: "arbeitnow",
      posted_at: j.created_at ? new Date(j.created_at * 1000).toISOString() : new Date().toISOString(),
      created_at: j.created_at ? new Date(j.created_at * 1000).toISOString() : new Date().toISOString(),
      employment_type: j.job_types?.includes("full-time") ? "full_time" : j.job_types?.[0] || "full_time"
    }));
  } catch (err) { console.log("❌ Arbeitnow:", err.message); return []; }
}
