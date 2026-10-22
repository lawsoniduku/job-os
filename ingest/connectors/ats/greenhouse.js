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
export async function runBatched(companies, fetchOne, label, batch = 5, {attempts=3,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const all = [];
  let ok = 0, empty = 0;
  const failures = [];
  for (let i = 0; i < companies.length; i += batch) {
    const slice = companies.slice(i, i + batch);
    const results = await Promise.allSettled(slice.map(async company=>{
      for(let attempt=0;attempt<attempts;attempt++) {
        try{return await fetchOne(company);}catch(e) {
          const status=e.response?.status;
          const transient=[408,429,500,502,503,504].includes(status)||['ECONNABORTED','ECONNRESET','ETIMEDOUT','EAI_AGAIN','ERR_NETWORK'].includes(e.code);
          const header=e.response?.headers?.['retry-after'];
          const retryAfter=header==null?null:/^\d+(\.\d+)?$/.test(String(header))?Number(header)*1000:Date.parse(header)-Date.now();
          const delay=retryAfter==null?1000*2**attempt:Math.max(1000,retryAfter);
          if(!transient||attempt+1>=attempts||!Number.isFinite(delay)||delay>10000)throw e;
          await sleep(delay);
        }
      }
    }));
    for (const [index,r] of results.entries()) {
      if (r.status === "fulfilled" && r.value?.length) { all.push(...r.value); ok++; }
      else if (r.status === "rejected" && r.reason?.response?.status !== 404) {
        const status=r.reason?.response?.status;
        const code=String(r.reason?.code || 'invalid_response').replace(/[^a-z0-9_]/gi,'').slice(0,40);
        failures.push(new Error(`${slice[index].slug || slice[index].sub || 'board'}: ${status?'HTTP '+status:code}`));
      }
      else empty++;
    }
    if (i + batch < companies.length) await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`  ${failures.length ? "⚠" : "✔"} ${label}: ${all.length} jobs from ${ok} boards (${empty} empty/404; ${failures.length} failed)`);
  if (failures.length) {
    const error = new AggregateError(failures,`${label}: ${failures.length} employer board fetches failed (${failures.map(e=>e.message).join('; ')})`);
    error.partialJobs = all;
    throw error;
  }
  return all;
}

