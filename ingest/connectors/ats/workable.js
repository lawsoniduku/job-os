/**
 * ingest/connectors/ats/workable.js
 * =================================
 * Generic Workable public job-board fetcher.
 * GET https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true
 * Shape: { jobs: [{ title, shortcode, url, application_url, location:
 *          {city, region, country, telecommuting}, employment_type,
 *          description (HTML), created_at }] }
 * Field names vary; read defensively. Unknown slugs 404 -> skipped.
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";
import { runBatched } from "./greenhouse.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

function loc(j) {
  const l = j.location || {};
  if (l.telecommuting || j.telecommuting) return "Remote";
  return [l.city, l.region, l.country].filter(Boolean).join(", ") || "";
}

async function fetchBoard({ slug, name, region }) {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`;
  const res = await axios.get(url, { timeout: 12000, headers: UA });
  const jobs = res.data?.jobs || res.data?.results || [];
  return jobs
    .map((j) =>
      normalizeJob(
        {
          title: j.title || j.name,
          company: name || j.company || res.data?.name,
          location: loc(j),
          description: j.description || j.full_description || "",
          apply_url: j.application_url || j.url || j.shortlink,
          employment_type: j.employment_type || null,
          posted_at: j.created_at || j.published_on || null,
          created_at: j.created_at || null,
        },
        { source: "workable", ats: "workable", company: name, region }
      )
    )
    .filter(Boolean);
}

export async function fetchWorkable(companies) {
  return runBatched(companies, fetchBoard, "Workable");
}
