/**
 * ingest/connectors/feeds/weworkremotely.js
 * ==========================================
 * We Work Remotely public RSS feeds — no auth required, genuinely free to use.
 * https://weworkremotely.com/remote-job-rss-feed
 *
 * We pull a handful of category feeds relevant to our users rather than the
 * single "all jobs" feed, so we don't have to separately filter out categories
 * we don't care about (e.g. their region-specific or niche boards).
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.2)", Accept: "application/rss+xml" };

const FEEDS = [
  "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-customer-support-jobs.rss",
  "https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss",
  "https://weworkremotely.com/categories/remote-product-jobs.rss",
  "https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss",
  "https://weworkremotely.com/categories/all-other-remote-jobs.rss",
];

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
    const description = getTag(item, "description");
    const pubDate = getTag(item, "pubDate");
    const region = getTag(item, "region");
    if (!link) continue;

    // WWR title format is "Company Name: Job Title" — split it so the company
    // name doesn't end up duplicated inside the job title.
    let company = "";
    let title = rawTitle;
    if (rawTitle.includes(": ")) {
      const parts = rawTitle.split(": ");
      company = parts[0];
      title = parts.slice(1).join(": ");
    }

    rows.push({ title, company, location: region || "Remote", description, apply_url: link, posted_at: pubDate, created_at: pubDate });
  }
  return rows;
}

export async function fetchWeWorkRemotely() {
  const out = [];
  const settled = await Promise.allSettled(
    FEEDS.map((url) => axios.get(url, { timeout: 15000, headers: UA }))
  );
  let feedsOk = 0;
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    feedsOk++;
    const rows = parseRSS(result.value.data);
    for (const r of rows) {
      out.push(
        normalizeJob(
          { ...r, isRemote: true }, // every WWR listing is remote by definition
          { source: "weworkremotely", ats: "weworkremotely" }
        )
      );
    }
  }
  const jobs = out.filter(Boolean);
  console.log(`  ✔ We Work Remotely: ${jobs.length} jobs from ${feedsOk}/${FEEDS.length} feeds`);
  return jobs;
}
