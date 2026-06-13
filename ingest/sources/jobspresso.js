/**
 * JOBSPRESSO — remote jobs, many Africa-eligible
 */
import axios from "axios";
function parseRSS(xml) {
  const jobs = [];
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const item of items) {
    const get = tag => {
      const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i")) ||
                item.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
      return m ? m[1].trim() : "";
    };
    const link = get("link") || get("guid");
    const title = get("title");
    const desc = get("description");
    const pubDate = get("pubDate");
    let company = "Unknown", jobTitle = title;
    if (title.includes(": ")) { const p = title.split(": "); company = p[0]; jobTitle = p.slice(1).join(": "); }
    if (link) jobs.push({
      title: jobTitle, company, location: "Remote", remote: true,
      description: desc.replace(/<[^>]*>/g,""),
      apply_url: link, source: "jobspresso",
      posted_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      created_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
    });
  }
  return jobs;
}
export async function fetchJobspresso() {
  try {
    const res = await axios.get("https://jobspresso.co/feed/", {
      timeout: 15000, headers: { "User-Agent": "job-copilot/3.0", Accept: "application/rss+xml" }
    });
    return parseRSS(res.data);
  } catch (err) { console.log("❌ Jobspresso:", err.message); return []; }
}
