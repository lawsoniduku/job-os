/**
 * DEEL JOB SOURCE v4 — HONEST IMPLEMENTATION
 * ============================================
 *
 * WHAT WE KNOW (as of June 2026):
 *
 * Deel built and uses their OWN native ATS (launched late 2024, replacing Ashby).
 * Their careers page: https://www.deel.com/careers/
 *
 * API structure (from official docs at developer.deel.com):
 *   GET https://api.letsdeel.com/rest/v2/ats/job-boards/:job_board_id/job-postings
 *   Authorization: Bearer <YOUR_DEEL_API_TOKEN>
 *   Scope required: ats:read
 *
 * The Deel ATS API is NOT public — it requires a Deel account + API token.
 * Their careers page is a Next.js SPA protected by Cloudflare — not scrapeable
 * from Node.js without a headless browser.
 *
 * TWO PATHS TO GET REAL DEEL JOBS:
 *
 * PATH A (if you have a Deel API token):
 *   Set DEEL_API_TOKEN in your .env
 *   Set DEEL_JOB_BOARD_ID in your .env (found in your Deel ATS settings)
 *   This function will use the real API.
 *
 * PATH B (no token):
 *   The function returns a clearly-labelled stub so your pipeline doesn't break,
 *   and logs instructions to visit their careers page manually.
 *
 * WHY DEEL MATTERS FOR THIS PROJECT:
 *   Deel operates in 150+ countries, hires from Nigeria, Kenya, Ghana and
 *   across Africa by design. Their own team is a great source of Africa-eligible roles.
 *   Their support, operations, finance, and growth roles are frequently open globally.
 *
 * TO GET A DEEL API TOKEN:
 *   1. Log in to app.deel.com
 *   2. Go to Settings → API Tokens → Create Token
 *   3. Grant scope: ats:read
 *   4. Copy the token into your .env as DEEL_API_TOKEN
 *   5. Get your job board ID from the ATS settings page
 *      or by calling GET /rest/v2/ats/job-boards (list all boards)
 */

import axios from "axios";

const DEEL_API_BASE = "https://api.letsdeel.com/rest/v2";

// ============================================================
// PATH A: Real Deel ATS API (requires token)
// ============================================================
async function fetchDeelViaAPI(token, jobBoardId) {
  const jobs = [];
  let cursor = null;
  let page = 0;
  const MAX_PAGES = 10; // safety cap

  do {
    const params = { limit: 50 };
    if (cursor) params.cursor = cursor;

    const res = await axios.get(
      `${DEEL_API_BASE}/ats/job-boards/${jobBoardId}/job-postings`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        params,
        timeout: 15000,
      }
    );

    const postings = res.data?.data || [];
    cursor = res.data?.next_cursor || null;

    for (const posting of postings) {
      const job = posting.job || {};
      const locations = (job.job_locations || [])
        .map(jl => jl.location?.name || "")
        .filter(Boolean);

      const compensation = job.compensation || {};
      const empTypes = (job.job_employment_types || [])
        .map(et => et.employment_type?.name || "")
        .filter(Boolean);

      jobs.push({
        title: posting.title || job.title || "",
        company: "Deel",
        location: locations.length > 0 ? locations.join(", ") : "Remote - Worldwide",
        remote: true,
        description: (posting.description || job.description || "")
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3000),
        apply_url: posting.application_url ||
                   `https://www.deel.com/careers/position/${posting.id}`,
        source: "deel",
        department: posting.department?.name || job.department?.name || null,
        posted_at: posting.published_at || posting.created_at || new Date().toISOString(),
        created_at: posting.created_at || new Date().toISOString(),
        salary_min: compensation.min_amount || null,
        salary_max: compensation.max_amount || null,
        employment_type: empTypes[0]?.toLowerCase().replace(/\s+/g, "_") || "full_time",
        // Deel hires from 150+ countries — all roles are globally eligible
        eligibility_region: "Global",
      });
    }

    page++;
  } while (cursor && page < MAX_PAGES);

  return jobs;
}

// ============================================================
// Discover all job boards on a Deel account (helper)
// Call this once to find your jobBoardId
// ============================================================
export async function listDeelJobBoards(token) {
  try {
    const res = await axios.get(`${DEEL_API_BASE}/ats/job-boards`, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
      timeout: 10000,
    });
    return res.data?.data || [];
  } catch (err) {
    console.log("Could not list Deel job boards:", err.message);
    return [];
  }
}

// ============================================================
// MAIN EXPORT
// ============================================================
export async function fetchDeelJobs() {
  const token = process.env.DEEL_API_TOKEN;
  const jobBoardId = process.env.DEEL_JOB_BOARD_ID;

  // PATH A: Use real API if credentials are set
  if (token && jobBoardId) {
    try {
      console.log("  📡 Deel: Using authenticated API...");
      const jobs = await fetchDeelViaAPI(token, jobBoardId);

      if (jobs.length > 0) {
        console.log(`  ✔ Deel ATS API: ${jobs.length} job postings`);
        return jobs;
      }

      console.log("  ⚠ Deel API returned 0 postings (board may be empty or wrong ID)");
      return [];

    } catch (err) {
      if (err.response?.status === 401) {
        console.log("  ❌ Deel: Invalid API token (401). Check DEEL_API_TOKEN in .env");
      } else if (err.response?.status === 403) {
        console.log("  ❌ Deel: Token missing ats:read scope (403). Regenerate token with correct scope.");
      } else if (err.response?.status === 404) {
        console.log("  ❌ Deel: Job board not found (404). Check DEEL_JOB_BOARD_ID in .env");
      } else {
        console.log("  ❌ Deel API error:", err.message);
      }
      return [];
    }
  }

  // PATH B: No credentials — log instructions and return nothing
  // (better to return 0 than stale hardcoded data)
  console.log("  ⚠ Deel: No API token configured. Skipping.");
  console.log("    To enable: add DEEL_API_TOKEN and DEEL_JOB_BOARD_ID to your .env");
  console.log("    Get token: app.deel.com → Settings → API Tokens (scope: ats:read)");
  console.log("    View jobs manually: https://www.deel.com/careers/");
  return [];
}
