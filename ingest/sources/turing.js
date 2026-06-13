/**
 * TURING — Africa-friendly platform, pays in USD
 */
import axios from "axios";
export async function fetchTuringJobs() {
  try {
    const res = await axios.get("https://api.turing.com/jobs?remote=true&limit=100", {
      timeout: 15000, headers: { "User-Agent": "job-copilot/3.0" }
    });
    const jobs = res.data?.jobs || res.data?.data || res.data || [];
    return Array.isArray(jobs) ? jobs.map(j => ({
      title: j.title || j.position,
      company: j.company || "Turing Client",
      location: j.location || "Remote",
      remote: true,
      description: j.description || j.requirements || "",
      apply_url: j.apply_url || j.url || `https://turing.com/jobs/${j.id}`,
      source: "turing",
      posted_at: j.created_at || j.posted_at,
      created_at: j.created_at || new Date().toISOString()
    })) : [];
  } catch (err) { console.log("❌ Turing:", err.message); return []; }
}
