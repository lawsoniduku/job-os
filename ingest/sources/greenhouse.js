/**
 * GREENHOUSE SOURCE v3
 * =====================
 * Pulls jobs from companies known to:
 * 1. Hire remotely across Africa / globally
 * 2. Use Greenhouse as their ATS (public API, no auth needed)
 *
 * Greenhouse API: GET /v1/boards/{slug}/jobs?content=true
 * Response: { jobs: [{ id, title, absolute_url, location, content, departments }] }
 *
 * Company slugs verified as of 2025. If a company migrates ATS,
 * their slug returns 404 — we skip it silently.
 */

import axios from "axios";

// Companies that hire globally/remotely and are Africa-friendly
// Grouped by how likely they are to have open Africa-eligible roles
const COMPANIES = [
  // Fully remote, explicitly global
  { slug: "gitlab",        name: "GitLab" },
  { slug: "automattic",    name: "Automattic (WordPress)" },
  { slug: "zapier",        name: "Zapier" },
  { slug: "invision",      name: "InVision" },
  { slug: "hotjar",        name: "Hotjar" },
  { slug: "toggl",         name: "Toggl" },
  { slug: "doist",         name: "Doist (Todoist)" },
  { slug: "close",         name: "Close CRM" },
  { slug: "basecamp",      name: "Basecamp" },
  { slug: "buffer",        name: "Buffer" },

  // Large tech — many remote roles, some Africa-eligible
  { slug: "shopify",       name: "Shopify" },
  { slug: "stripe",        name: "Stripe" },
  { slug: "coinbase",      name: "Coinbase" },
  { slug: "duolingo",      name: "Duolingo" },
  { slug: "airtable",      name: "Airtable" },
  { slug: "notion",        name: "Notion" },
  { slug: "figma",         name: "Figma" },
  { slug: "dropbox",       name: "Dropbox" },
  { slug: "hubspot",       name: "HubSpot" },
  { slug: "zendesk",       name: "Zendesk" },
  { slug: "intercom",      name: "Intercom" },

  // Fintech / payments — relevant for African candidates
  { slug: "paystack",      name: "Paystack" },
  { slug: "flutterwave",   name: "Flutterwave" },
  { slug: "chipper",       name: "Chipper Cash" },
  { slug: "wave",          name: "Wave Financial" },
  { slug: "transferwise",  name: "Wise" },
  { slug: "payoneer",      name: "Payoneer" },
  { slug: "paddle",        name: "Paddle" },

  // HR Tech / SaaS — relevant given our audience
  { slug: "workable",      name: "Workable" },
  { slug: "bamboohr",      name: "BambooHR" },
  { slug: "personio",      name: "Personio" },
  { slug: "remote",        name: "Remote.com" },
  { slug: "oysterhr",      name: "Oyster HR" },
  { slug: "multiplier",    name: "Multiplier" },

  // Customer success / support focused
  { slug: "freshworks",    name: "Freshworks" },
  { slug: "klaviyo",       name: "Klaviyo" },
  { slug: "mixpanel",      name: "Mixpanel" },
  { slug: "segment",       name: "Segment / Twilio" },
];

function normalizeJob(job, companyName) {
  const location = job.location?.name || "";
  return {
    title: job.title || "",
    company: companyName,
    location,
    remote: location.toLowerCase().includes("remote") ||
            location.toLowerCase().includes("anywhere") ||
            location === "",
    description: (job.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000),
    apply_url: job.absolute_url || "",
    source: "greenhouse",
    department: job.departments?.[0]?.name || null,
    posted_at: job.updated_at || new Date().toISOString(),
    created_at: job.updated_at || new Date().toISOString(),
    employment_type: "full_time",
  };
}

export async function fetchGreenhouse() {
  const all = [];
  let success = 0, skipped = 0;

  // Run in parallel batches of 5 to avoid rate limiting
  const BATCH = 5;
  for (let i = 0; i < COMPANIES.length; i += BATCH) {
    const batch = COMPANIES.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async ({ slug, name }) => {
        try {
          const res = await axios.get(
            `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
            {
              timeout: 12000,
              headers: {
                "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.0)",
                "Accept": "application/json",
              }
            }
          );
          const jobs = (res.data?.jobs || [])
            .map(j => normalizeJob(j, name))
            .filter(j => j.apply_url && j.title);
          return { name, jobs };
        } catch (err) {
          return { name, jobs: [], err: err.response?.status || err.message };
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { name, jobs, err } = result.value;
        if (jobs.length > 0) {
          all.push(...jobs);
          success++;
        } else {
          skipped++;
        }
      }
    }

    // Small delay between batches to be respectful
    if (i + BATCH < COMPANIES.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log(`  ✔ Greenhouse: ${all.length} jobs from ${success} companies (${skipped} empty/failed)`);
  return all;
}
