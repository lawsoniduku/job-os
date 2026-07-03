/**
 * ingest/connectors/feeds/jobspresso.js
 * =====================================
 * Jobspresso public RSS feed — free, no auth. Jobspresso is a hand-curated
 * remote job board (every listing is manually reviewed), so volume is lower
 * than aggregators but quality is high.
 * Feed: https://jobspresso.co/feed/?post_type=job_listing
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.2)", Accept: "application/rss+xml" };
const FEED = "https://jobspresso.co/feed/?post_type=job_listing";

function getTag(item, tag) {
  const cdata = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"));
  if (cdata) return cdata[1].trim();
  const plain = item.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
  return plain ? plain[1].trim() : "";
}

function parseRSS(xml) {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  const rows = [];
  for (const item of items) {
    const rawTitle = getTag(item, "title");
    const link = getTag(item, "link") || getTag(item, "guid");
    const description = getTag(item, "description") || getTag(item, "content:encoded");
    const pubDate = getTag(item, "pubDate");
    if (!link) continue;

    // Jobspresso title format is often "Company: Job Title" — split when present.
    let company = "";
    let title = rawTitle;
    if (rawTitle.includes(": ")) {
      const parts = rawTitle.split(": ");
      company = parts[0];
      title = parts.slice(1).join(": ");
    }

    rows.push({ title, company, location: "Remote", description, apply_url: link, posted_at: pubDate, created_at: pubDate });
  }
  return rows;
}

export async function fetchJobspresso() {
  try {
    const res = await axios.get(FEED, { timeout: 15000, headers: UA });
    const rows = parseRSS(res.data);
    const jobs = rows
      .map((r) => normalizeJob({ ...r, isRemote: true }, { source: "jobspresso", ats: "jobspresso" }))
      .filter(Boolean);
    console.log(`  ✔ Jobspresso: ${jobs.length} jobs`);
    return jobs;
  } catch (e) {
    console.log(`  ❌ Jobspresso: ${e.response?.status || e.code || e.message}`);
    return [];
  }
}
