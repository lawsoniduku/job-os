/**
 * HIMALAYAS — remote jobs, many global/Africa-eligible
 * Free API at https://himalayas.app/api
 */
import axios from "axios";
export async function fetchHimalayas() {
  try {
    const res = await axios.get("https://himalayas.app/jobs/api?limit=100", {
      timeout: 15000, headers: { "User-Agent": "job-copilot/3.0" }
    });
    const jobs = res.data?.jobs || [];
    return jobs.map(j => ({
      title: j.title,
      company: j.companyName || j.company?.name || "Unknown",
      location: j.locationRestrictions?.join(", ") || "Remote",
      remote: true,
      description: (j.description || "").replace(/<[^>]*>/g,""),
      apply_url: j.applicationLink || j.url || `https://himalayas.app/jobs/${j.slug}`,
      source: "himalayas",
      posted_at: j.publishedAt || j.createdAt,
      created_at: j.publishedAt || j.createdAt || new Date().toISOString(),
      eligibility_region: j.locationRestrictions?.join(", ") || "Global"
    }));
  } catch (err) { console.log("❌ Himalayas:", err.message); return []; }
}
