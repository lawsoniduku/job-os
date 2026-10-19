/**
 * ingest/connectors/ats/greenhouse.js
 * ===================================
 * Generic Greenhouse board fetcher. Add a company by adding a slug to the
 * registry — no new file needed.
 *
 * API (public, no auth): GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 * Shape: { jobs: [{ id, title, absolute_url, location:{name}, content(HTML), updated_at, departments:[{name}] }] }
 * Unknown slugs return 404 -> skipped silently.
 */

import axios from "axios";
import { normalizeJob, parseDate } from "../../core/normalize.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

async function fetchBoard({ slug, name, region, apiBase }) {
  // Most boards live on boards-api.greenhouse.io. Some (e.g. EU-hosted) may need
  // a different base; allow an override per-company in the registry.
  const base = apiBase || "https://boards-api.greenhouse.io";
  const url = `${base}/v1/boards/${slug}/jobs?content=true`;
  const res = await axios.get(url, { timeout: 12000, headers: UA });
  return (res.data?.jobs || [])
    .map((j) => {
      const job = normalizeJob(
        {
          title: j.title,
          company: name,
          location: j.location?.name || "",
          description: j.content || "",
          apply_url: j.absolute_url,
          department: j.departments?.[0]?.name || null,
          // updated_at is a content revision, not a publication timestamp.
          posted_at: null,
          created_at: null,
        },
        { source: "greenhouse", ats: "greenhouse", company: name, region }
      );
      return job ? { ...job, _source_observation: {
        updated_at: parseDate(j.updated_at), publication_unknown: true,
      } } : null;
    })
    .filter(Boolean);
}

export async function fetchGreenhouse(companies) {
  return runBatched(companies, fetchBoard, "Greenhouse");
}

// shared bounded-concurrency runner used by all ATS connectors
export async function runBatched(companies, fetchOne, label, batch = 5) {
  const all = [];
  let ok = 0, empty = 0;
  const failures = [];
  for (let i = 0; i < companies.length; i += batch) {
    const slice = companies.slice(i, i + batch);
    const results = await Promise.allSettled(slice.map(fetchOne));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value?.length) { all.push(...r.value); ok++; }
      else if (r.status === "rejected" && r.reason?.response?.status !== 404) failures.push(r.reason);
      else empty++;
    }
    if (i + batch < companies.length) await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`  ${failures.length ? "⚠" : "✔"} ${label}: ${all.length} jobs from ${ok} boards (${empty} empty/404; ${failures.length} failed)`);
  if (failures.length) {
    const error = new AggregateError(failures,`${label}: ${failures.length} employer board fetches failed`);
    error.partialJobs = all;
    throw error;
  }
  return all;
}
