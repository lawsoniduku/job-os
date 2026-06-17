/**
 * ingest/connectors/feeds/teamtailor.js
 * =====================================
 * Teamtailor exposes a PUBLIC RSS feed per career site at:
 *   https://{company}.teamtailor.com/jobs.rss?per_page=200
 * No auth required. Docs: support.teamtailor.com (RSS feed how-to).
 *
 * We add companies to TEAMTAILOR_SITES below. Each yields up to per_page jobs.
 * Dependency-free RSS parsing (mirrors the MyJobMag connector).
 */

import axios from "axios";
import { normalizeJob } from "../../core/normalize.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)" };

// Teamtailor career sites to pull. `region` tags African-HQ employers so the
// eligibility gate treats them as open to local candidates.
export const TEAMTAILOR_SITES = [
  { sub: "bamboo", name: "Bamboo", region: "Nigeria" },
  // add more as you find them: { sub: "companyslug", name: "Company", region: "Africa" },
];

function decodeEntities(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
function stripTags(s = "") {
  return decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}

function parseItems(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = stripTags(tag(block, "title"));
    const link = stripTags(tag(block, "link")) || stripTags(tag(block, "guid"));
    const description = stripTags(tag(block, "description")) || stripTags(tag(block, "content:encoded"));
    const pubDate = tag(block, "pubDate");
    // Teamtailor RSS often includes location/department in custom or category tags.
    const location = stripTags(tag(block, "location")) || stripTags(tag(block, "category"));
    if (title && link) items.push({ title, link, description, pubDate, location });
  }
  return items;
}

async function fetchOneSite(site) {
  const url = `https://${site.sub}.teamtailor.com/jobs.rss?per_page=200`;
  try {
    const res = await axios.get(url, { timeout: 20000, headers: UA, responseType: "text" });
    const body = typeof res.data === "string" ? res.data : String(res.data || "");
    if (!/<item/i.test(body)) { console.log(`  ❌ Teamtailor ${site.name}: no feed`); return []; }
    const items = parseItems(body);
    const jobs = items.map((it) =>
      normalizeJob(
        {
          title: it.title,
          company: site.name,
          // prefer an explicit per-job location; else tag with the site's country
          location: it.location || site.region || "",
          description: it.description || it.title,
          apply_url: it.link,
          posted_at: it.pubDate || null,
          created_at: it.pubDate || null,
          isRemote: /remote/i.test(`${it.title} ${it.description}`),
        },
        { source: "teamtailor", ats: "teamtailor", company: site.name, region: site.region }
      )
    ).filter(Boolean);
    console.log(`  ✔ Teamtailor ${site.name}: ${jobs.length} jobs`);
    return jobs;
  } catch (e) {
    console.log(`  ❌ Teamtailor ${site.name}: ${e.code || e.message}`);
    return [];
  }
}

export async function fetchTeamtailor(sites = TEAMTAILOR_SITES) {
  const results = await Promise.allSettled(sites.map(fetchOneSite));
  const all = [];
  for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
  return all;
}
