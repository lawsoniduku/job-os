/**
 * ingest/connectors/ats/smartrecruiters.js
 * ========================================
 * Generic SmartRecruiters public postings fetcher.
 * GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100
 * Shape: { content: [{ id, name, refNumber, releasedDate, location:
 *          {city, region, country, remote}, company:{identifier}, ... }] }
 * Description requires a second call per posting, so we keep the list-level
 * summary as the description seed (kept lightweight + reliable).
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";
import { runBatched } from "./greenhouse.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

function loc(p) {
  const l = p.location || {};
  if (l.remote) return "Remote";
  return [l.city, l.region, l.country].filter(Boolean).join(", ") || "";
}

async function fetchBoard({ slug, name, region }) {
  const url = `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`;
  const res = await axios.get(url, { timeout: 12000, headers: UA });
  return (res.data?.content || [])
    .map((p) =>
      normalizeJob(
        {
          title: p.name,
          company: name || p.company?.name || slug,
          location: loc(p),
          description: p.jobAd?.sections?.jobDescription?.text || p.releasedDate ? (p.name || "") : "",
          apply_url: `https://jobs.smartrecruiters.com/${slug}/${p.id}`,
          posted_at: p.releasedDate || null,
          created_at: p.releasedDate || null,
        },
        { source: "smartrecruiters", ats: "smartrecruiters", company: name, region }
      )
    )
    .filter(Boolean);
}

export async function fetchSmartRecruiters(companies) {
  return runBatched(companies, fetchBoard, "SmartRecruiters");
}
