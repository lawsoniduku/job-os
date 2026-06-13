/**
 * LEVER SOURCE v3
 * ================
 * Pulls jobs from companies that:
 * 1. Use Lever as their ATS
 * 2. Hire remotely / Africa-eligible
 *
 * Lever API: GET /v0/postings/{slug}?mode=json
 * Response: Array of job postings
 * No auth required for public boards.
 */

import axios from "axios";

const COMPANIES = [
  // Explicitly remote-first, global hiring
  { slug: "remote",          name: "Remote.com" },
  { slug: "netlify",         name: "Netlify" },
  { slug: "hashicorp",       name: "HashiCorp" },
  { slug: "elastic",         name: "Elastic" },
  { slug: "vercel",          name: "Vercel" },
  { slug: "posthog",         name: "PostHog" },
  { slug: "supabase",        name: "Supabase" },
  { slug: "grafana",         name: "Grafana Labs" },
  { slug: "1password",       name: "1Password" },
  { slug: "oxide",           name: "Oxide Computer" },

  // Fintech / payments
  { slug: "brex",            name: "Brex" },
  { slug: "plaid",           name: "Plaid" },
  { slug: "mercury",         name: "Mercury" },
  { slug: "divvy",           name: "Divvy" },

  // Customer success / support tools
  { slug: "intercom",        name: "Intercom" },
  { slug: "front",           name: "Front" },
  { slug: "gladly",          name: "Gladly" },
  { slug: "gorgias",         name: "Gorgias" },
  { slug: "kustomer",        name: "Kustomer" },

  // HR / People tech
  { slug: "lattice",         name: "Lattice" },
  { slug: "rippling",        name: "Rippling" },
  { slug: "leapsome",        name: "Leapsome" },
  { slug: "culturamp",       name: "Culture Amp" },
  { slug: "15five",          name: "15Five" },

  // Data / Analytics
  { slug: "dbt-labs",        name: "dbt Labs" },
  { slug: "fivetran",        name: "Fivetran" },
  { slug: "looker",          name: "Looker (Google)" },
  { slug: "montecarlohq",    name: "Monte Carlo" },

  // Product / SaaS
  { slug: "productboard",    name: "Productboard" },
  { slug: "miro",            name: "Miro" },
  { slug: "loom",            name: "Loom" },
  { slug: "typeform",        name: "Typeform" },
  { slug: "docusign",        name: "DocuSign" },
  { slug: "twilio",          name: "Twilio" },
  { slug: "segment",         name: "Segment" },
  { slug: "amplitude",       name: "Amplitude" },
  { slug: "fullstory",       name: "FullStory" },
];

function normalizeJob(job, companyName) {
  const location = job.categories?.location || job.workplaceType || "";
  const commitment = (job.categories?.commitment || "").toLowerCase();

  return {
    title: job.text || "",
    company: companyName,
    location,
    remote: location.toLowerCase().includes("remote") ||
            location.toLowerCase().includes("anywhere") ||
            job.workplaceType === "remote",
    description: (job.descriptionPlain || job.description || "")
      .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000),
    apply_url: job.hostedUrl || job.applyUrl || "",
    source: "lever",
    department: job.categories?.department || null,
    posted_at: job.createdAt ? new Date(job.createdAt).toISOString() : new Date().toISOString(),
    created_at: job.createdAt ? new Date(job.createdAt).toISOString() : new Date().toISOString(),
    employment_type: commitment.includes("contract") ? "contract" :
                     commitment.includes("part") ? "part_time" : "full_time",
  };
}

export async function fetchLever() {
  const all = [];
  let success = 0, skipped = 0;

  const BATCH = 5;
  for (let i = 0; i < COMPANIES.length; i += BATCH) {
    const batch = COMPANIES.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async ({ slug, name }) => {
        try {
          const res = await axios.get(
            `https://api.lever.co/v0/postings/${slug}?mode=json`,
            {
              timeout: 12000,
              headers: {
                "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.0)",
                "Accept": "application/json",
              }
            }
          );
          const jobs = (Array.isArray(res.data) ? res.data : [])
            .map(j => normalizeJob(j, name))
            .filter(j => j.apply_url && j.title);
          return { name, jobs };
        } catch {
          return { name, jobs: [] };
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { jobs } = result.value;
        if (jobs.length > 0) { all.push(...jobs); success++; }
        else skipped++;
      }
    }

    if (i + BATCH < COMPANIES.length) await new Promise(r => setTimeout(r, 300));
  }

  console.log(`  ✔ Lever: ${all.length} jobs from ${success} companies (${skipped} empty/failed)`);
  return all;
}
