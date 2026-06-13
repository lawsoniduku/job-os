/**
 * WE WORK REMOTELY SOURCE
 * ========================
 * Uses their public RSS feed.
 */

import axios from "axios";

function parseRSS(xml) {
  const jobs = [];
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const item of items) {
    const get = (tag) => {
      const match = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i")) ||
                    item.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
      return match ? match[1].trim() : "";
    };

    const title = get("title");
    const link = get("link") || get("guid");
    const description = get("description");
    const pubDate = get("pubDate");
    const region = get("region");

    // WWR title format: "Company Name: Job Title"
    let company = "Unknown";
    let jobTitle = title;
    if (title.includes(": ")) {
      const parts = title.split(": ");
      company = parts[0];
      jobTitle = parts.slice(1).join(": ");
    }

    if (link) {
      jobs.push({
        id: `wwr-${link.replace(/[^a-z0-9]/gi, "")}`,
        title: jobTitle,
        company,
        location: region || "Remote",
        remote: true,
        description,
        apply_url: link,
        source: "weworkremotely",
        posted_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        created_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
      });
    }
  }

  return jobs;
}

export async function fetchWeWorkRemotely() {
  try {
    // WWR has category RSS feeds - pull the most relevant for our users
    const feeds = [
      "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
      "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
      "https://weworkremotely.com/categories/remote-customer-support-jobs.rss",
      "https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss",
      "https://weworkremotely.com/categories/remote-all-other-remote-jobs.rss"
    ];

    const results = await Promise.allSettled(
      feeds.map((url) =>
        axios.get(url, {
          timeout: 15000,
          headers: {
            "User-Agent": "job-copilot/2.0",
            "Accept": "application/rss+xml"
          }
        })
      )
    );

    const allJobs = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        const jobs = parseRSS(result.value.data);
        allJobs.push(...jobs);
      }
    }

    return allJobs;
  } catch (err) {
    console.log("❌ WeWorkRemotely fetch failed:", err.message);
    return [];
  }
}
