/**
 * ingest/connectors/ats/ashby.js
 * ==============================
 * Generic Ashby public job-board fetcher.
 * API (public): GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
 * Shape: { jobs: [{ id, title, locationName, departmentName, employmentType,
 *           isRemote, isListed, publishedAt, jobUrl, applyUrl, descriptionHtml }] }
 * Field names vary slightly across boards, so we read defensively.
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";
import { runBatched } from "./greenhouse.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

async function fetchBoard({ slug, name, region }) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
  const res = await axios.get(url, { timeout: 12000, headers: UA });
  return (res.data?.jobs || [])
    .filter((j) => j.isListed !== false)
    .map((j) =>
      normalizeJob(
        {
          title: j.title,
          company: name,
          // locationName is the primary location. secondaryLocations lists
          // additional offices — append them so the eligibility engine has the
          // full picture (e.g. "Remote / San Francisco / London").
          location: (() => {
            const primary = j.locationName || j.location || "";
            const secondary = Array.isArray(j.secondaryLocations)
              ? j.secondaryLocations.map((l) => l.location || l.name || "").filter(Boolean)
              : [];
            return secondary.length
              ? [primary, ...secondary].filter(Boolean).join(" / ")
              : primary;
          })(),
          description: j.descriptionHtml || j.descriptionPlain || j.description || "",
          apply_url: j.applyUrl || j.jobUrl,
          department: j.departmentName || j.teamName || null,
          employment_type: j.employmentType || null,
          isRemote: typeof j.isRemote === "boolean" ? j.isRemote : undefined,
          posted_at: j.publishedAt || null,
          created_at: j.publishedAt || null,
        },
        { source: "ashby", ats: "ashby", company: name, region }
      )
    )
    .filter(Boolean);
}

export async function fetchAshby(companies) {
  return runBatched(companies, fetchBoard, "Ashby");
}
