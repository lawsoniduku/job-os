/**
 * ingest/connectors/ats/lever.js
 * ==============================
 * Generic Lever postings fetcher.
 * API (public): GET https://api.lever.co/v0/postings/{slug}?mode=json
 * Shape: [{ id, text(title), hostedUrl, categories:{location,team,commitment},
 *           descriptionPlain, description(HTML), createdAt, workplaceType }]
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";
import { runBatched } from "./greenhouse.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

async function fetchBoard({ slug, name, region }) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const res = await axios.get(url, { timeout: 12000, headers: UA });
  return (res.data || [])
    .map((j) =>
      normalizeJob(
        {
          title: j.text,
          company: name,
          location: j.categories?.location || "",
          description: j.descriptionPlain || j.description || "",
          apply_url: j.hostedUrl,
          department: j.categories?.team || null,
          employment_type: j.categories?.commitment || null,
          isRemote: typeof j.workplaceType === "string" ? j.workplaceType.toLowerCase() === "remote" : undefined,
          posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
          created_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        },
        { source: "lever", ats: "lever", company: name, region }
      )
    )
    .filter(Boolean);
}

export async function fetchLever(companies) {
  return runBatched(companies, fetchBoard, "Lever");
}
