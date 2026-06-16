/**
 * ingest/connectors/feeds/myjobmag.js
 * ===================================
 * MyJobMag publishes public RSS/XML feeds intended for aggregators
 * (https://www.myjobmag.com/feeds/). This connector pulls those feeds for
 * Nigeria + sister sites (Ghana, Kenya, South Africa) and maps them into our
 * normalized job shape, tagging location so the eligibility gate treats them
 * as open to that country.
 *
 * DESIGN NOTES
 * - Dependency-free: RSS is simple XML, parsed with small regexes. No new npm
 *   install, keeps the cron light.
 * - Defensive: the exact feed URLs are behind JS "Copy" buttons on their site,
 *   so we try several likely endpoints per site and use the first that returns
 *   valid <item> entries. If none work, we log and return [] (never throws,
 *   so it can't break the pipeline).
 * - To fix/confirm a URL: replace the CANDIDATE_PATHS entry with the real one
 *   you copied from myjobmag.com/feeds, then re-run. Everything else stays.
 *
 * Each MyJobMag site shares the same platform, so one parser handles all.
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";

const UA = {
  "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.2; +https://job-os-tau.vercel.app)",
  Accept: "application/rss+xml, application/xml, text/xml, */*",
};

// MyJobMag sites and the country we tag their jobs with.
// Each site exposes static XML feeds (confirmed URLs below). We try the
// aggregate feed first (built for aggregators, fullest data), then fall back
// to the summarized jobs feed.
const SITES = [
  {
    base: "https://www.myjobmag.com",
    country: "Nigeria", region: "Nigeria",
    feeds: [
      "https://www.myjobmag.com/aggregate_feed.xml",
      "https://www.myjobmag.com/jobsxml_by_categories.xml",
      "https://www.myjobmag.com/jobsxml.xml",
    ],
  },
  {
    base: "https://www.myjobmagghana.com",
    country: "Ghana", region: "Africa",
    feeds: [
      "https://www.myjobmagghana.com/aggregate_feed.xml",
      "https://www.myjobmagghana.com/jobsxml.xml",
    ],
  },
  {
    base: "https://www.myjobmag.co.ke",
    country: "Kenya", region: "Africa",
    feeds: [
      "https://www.myjobmag.co.ke/aggregate_feed.xml",
      "https://www.myjobmag.co.ke/jobsxml.xml",
    ],
  },
  {
    base: "https://www.myjobmag.co.za",
    country: "South Africa", region: "Africa",
    feeds: [
      "https://www.myjobmag.co.za/aggregate_feed.xml",
      "https://www.myjobmag.co.za/jobsxml.xml",
    ],
  },
];

// --- tiny RSS helpers (no deps) ------------------------------------------------
function decodeEntities(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
function stripTags(s = "") {
  return decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}

function parseRssItems(xml) {
  const items = [];
  // Aggregator XML feeds use either <item> (RSS) or <job> (custom). Handle both.
  const blocks =
    (xml.match(/<item[\s\S]*?<\/item>/gi) || [])
      .concat(xml.match(/<job[\s\S]*?<\/job>/gi) || []);

  for (const block of blocks) {
    const title = stripTags(tag(block, "title"));
    const link =
      stripTags(tag(block, "link")) ||
      stripTags(tag(block, "url")) ||
      stripTags(tag(block, "guid"));
    const description =
      stripTags(tag(block, "description")) ||
      stripTags(tag(block, "content")) ||
      stripTags(tag(block, "summary"));
    const pubDate =
      tag(block, "pubDate") || tag(block, "date") || tag(block, "published");
    // Some feeds expose company/location/category as explicit tags.
    const company =
      stripTags(tag(block, "company")) || stripTags(tag(block, "author"));
    const location =
      stripTags(tag(block, "location")) || stripTags(tag(block, "city")) || "";
    const category = stripTags(tag(block, "category"));
    if (title && link)
      items.push({ title, link, description, pubDate, company, location, category });
  }
  return items;
}

// Pull company/location out of a MyJobMag title when present.
// Their titles are often like: "Job Title at Company Name".
function splitTitleCompany(rawTitle) {
  const m = rawTitle.match(/^(.*?)\s+at\s+(.+)$/i);
  if (m) return { title: m[1].trim(), company: m[2].trim() };
  return { title: rawTitle.trim(), company: "" };
}

async function fetchOneSite(site) {
  for (const url of site.feeds) {
    try {
      const res = await axios.get(url, { timeout: 20000, headers: UA, responseType: "text" });
      const body = typeof res.data === "string" ? res.data : String(res.data || "");
      if (!/<item|<job/i.test(body)) continue; // not a usable feed body
      const items = parseRssItems(body);
      if (!items.length) continue;

      const jobs = items.map((it) => {
        const split = splitTitleCompany(it.title);
        const company = it.company || split.company || it.category || "MyJobMag";
        // Prefer an explicit per-job location if the feed provides one;
        // otherwise tag with the site's country so the eligibility gate
        // treats it as open to candidates there.
        const location = it.location ? `${it.location}, ${site.country}` : site.country;
        return normalizeJob(
          {
            title: split.title,
            company,
            location,
            description: it.description || split.title,
            apply_url: it.link,
            posted_at: it.pubDate || null,
            created_at: it.pubDate || null,
            isRemote: /remote/i.test(`${it.title} ${it.description}`),
          },
          { source: "myjobmag", ats: "myjobmag", region: site.region }
        );
      });

      const valid = jobs.filter(Boolean);
      console.log(`  ✔ MyJobMag ${site.country}: ${valid.length} jobs (${url.split("/").pop()})`);
      return valid;
    } catch (e) {
      continue; // try next feed URL for this site
    }
  }
  console.log(`  ❌ MyJobMag ${site.country}: no working feed endpoint found`);
  return [];
}

export async function fetchMyJobMag({ sites = SITES } = {}) {
  const results = await Promise.all(sites.map((s) => fetchOneSite(s)));
  return results.flat();
}
