/**
 * ingest/test_link_check.js
 * =========================
 * Regression test for the dead-link detector. No DB needed — it exercises
 * checkOne() against real URLs whose true state we verified by hand.
 *
 * Each case exists because it broke a naive implementation:
 *   - a plain 404 (the baseline)
 *   - two live postings (must not be flagged dead)
 *   - a removed posting that 200-REDIRECTS to the listings index rather than
 *     404ing, which is what most ATS platforms actually do
 *   - a Cloudflare-challenged host, which must be 'unknown' and never 'dead'
 *     (it answers HEAD 200 then 403s the GET)
 *
 * USAGE: node ingest/test_link_check.js
 */
import { checkOne } from "./check_links.js";

const CASES = [
  ["dead",    "https://ineventapp.hire.trakstar.com/jobs/fk0pynu/",
              "404 — a user reported this one 'expired'"],
  ["ok",      "https://holafly.applytojob.com/apply/jobs/details/kbvnRxplV6",
              "live, genuinely worldwide"],
  ["ok",      "https://wealthaccess.applytojob.com/apply/jobs/details/wptqpCI4FZ",
              "live posting"],
  ["dead",    "https://holafly.applytojob.com/apply/jobs/details/ZZZZnotarealjob",
              "removed → 200-redirects to /apply/jobs index"],
  ["unknown", "https://himalayas.app/companies/telus-digital/jobs/online-data-analyst-bengali-in-3174088034",
              "Cloudflare challenge — must never be 'dead'"],
];

let pass = 0, fail = 0;
for (const [expected, url, why] of CASES) {
  const got = await checkOne(url);
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? "✓" : "✗"} expected ${expected.padEnd(7)} got ${got.padEnd(7)}  ${why}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
