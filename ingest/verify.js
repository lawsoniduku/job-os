/**
 * ingest/verify.js
 * ================
 * Pings every registry slug and reports which boards are LIVE vs 404, with a
 * job count. Run this once after editing the registry to prune dead slugs.
 *
 * Run: node ingest/verify.js
 */

import axios from "axios";
import {
  GREENHOUSE_COMPANIES, LEVER_COMPANIES, ASHBY_COMPANIES,
  WORKABLE_COMPANIES, SMARTRECRUITERS_COMPANIES, CANDIDATES_TO_VERIFY,
} from "./connectors/registry.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; job-copilot/3.1)", Accept: "application/json" };

const probes = {
  greenhouse: (s) => ({ url: `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, count: (d) => d?.jobs?.length || 0 }),
  lever: (s) => ({ url: `https://api.lever.co/v0/postings/${s}?mode=json`, count: (d) => (Array.isArray(d) ? d.length : 0) }),
  ashby: (s) => ({ url: `https://api.ashbyhq.com/posting-api/job-board/${s}`, count: (d) => d?.jobs?.length || 0 }),
  workable: (s) => ({ url: `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`, count: (d) => (d?.jobs || d?.results || []).length }),
  smartrecruiters: (s) => ({ url: `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`, count: (d) => d?.content?.length || 0 }),
};

async function check(ats, { slug, name }) {
  const { url, count } = probes[ats](slug);
  try {
    const res = await axios.get(url, { timeout: 10000, headers: UA });
    const n = count(res.data);
    console.log(`  ✅ ${ats.padEnd(10)} ${slug.padEnd(20)} ${name.padEnd(22)} ${n} jobs`);
    return { live: true, n };
  } catch (e) {
    console.log(`  ❌ ${ats.padEnd(10)} ${slug.padEnd(20)} ${name.padEnd(22)} ${e.response?.status || e.code || "ERR"}`);
    return { live: false, n: 0 };
  }
}

async function main() {
  console.log("\n🔎 Verifying registry slugs...\n");
  const c = CANDIDATES_TO_VERIFY || { greenhouse: [], lever: [], ashby: [] };
  const groups = [
    ["greenhouse", [...GREENHOUSE_COMPANIES, ...(c.greenhouse || [])]],
    ["lever", [...LEVER_COMPANIES, ...(c.lever || [])]],
    ["ashby", [...ASHBY_COMPANIES, ...(c.ashby || [])]],
    ["workable", [...(WORKABLE_COMPANIES || []), ...(c.workable || [])]],
    ["smartrecruiters", [...(SMARTRECRUITERS_COMPANIES || []), ...(c.smartrecruiters || [])]],
  ];
  let live = 0, total = 0, jobs = 0;
  for (const [ats, list] of groups) {
    for (const co of list) {
      total++;
      const r = await check(ats, co);
      if (r.live) { live++; jobs += r.n; }
    }
  }
  console.log(`\n📊 ${live}/${total} slugs live · ${jobs} total jobs reachable`);
  console.log(`   (Promote any new ✅ from CANDIDATES_TO_VERIFY into the ACTIVE arrays in registry.js)\n`);
}

main();
