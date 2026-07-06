/**
 * ingest/connectors/ats/lever.js
 * ==============================
 * Generic Lever postings fetcher.
 * API (public): GET https://api.lever.co/v0/postings/{slug}?mode=json
 * Shape: [{ id, text(title), hostedUrl, categories:{location,team,commitment,
 *           allLocations}, descriptionPlain, description(HTML), createdAt,
 *           workplaceType }]
 *
 * KEY: categories.allLocations is an array of ALL eligible locations/countries.
 * For companies like RemoFirst that list "Nigeria / Egypt / Ukraine / ..." as
 * country-level eligibility, allLocations contains them all while the primary
 * categories.location may just be "Remote". We join allLocations so the
 * eligibility engine sees the full country list.
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";
import { runBatched } from "./greenhouse.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

async function fetchBoard({ slug, name, region }) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const res = await axios.get(url, { timeout: 12000, headers: UA });
  return (res.data || [])
    .map((j) => {
      // allLocations lists every eligible country/region. When present and
      // contains more entries than just the primary location, use it — this is
      // how RemoFirst surfaces "Nigeria / Egypt / ..." eligibility.
      const primaryLoc = j.categories?.location || "";
      const allLocs = Array.isArray(j.categories?.allLocations)
        ? j.categories.allLocations.filter(Boolean)
        : [];
      // Use allLocations if it's multi-entry and richer than the primary field.
      const location = allLocs.length > 1
        ? allLocs.join(" / ")
        : (primaryLoc || (allLocs[0] || ""));

      return normalizeJob(
        {
          title: j.text,
          company: name,
          location,
          description: j.descriptionPlain || j.description || "",
          apply_url: j.hostedUrl,
          department: j.categories?.team || null,
          employment_type: j.categories?.commitment || null,
          isRemote: typeof j.workplaceType === "string" ? j.workplaceType.toLowerCase() === "remote" : undefined,
          posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
          created_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        },
        { source: "lever", ats: "lever", company: name, region }
      );
    })
    .filter(Boolean);
}

export async function fetchLever(companies) {
  return runBatched(companies, fetchBoard, "Lever");
}
