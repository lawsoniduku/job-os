/**
 * ingest/check_links.js
 * =====================
 * Answers the question the eligibility engine never asked: DOES THIS JOB
 * STILL EXIST?
 *
 * "Every job you see here, you can actually get" fails hardest not on
 * eligibility but on existence. Of the first 10 user reports, 5 were
 * reason='expired' — the most common complaint by a wide margin, and there
 * was no detection for it anywhere in the pipeline.
 *
 * WHAT IT DOES
 *   Picks the least-recently-checked live rows, requests each apply_url, and
 *   writes link_status back (see migration 010 for the semantics).
 *
 * DESIGN NOTES
 *   - HEAD first (cheap), falling back to GET when a host rejects HEAD.
 *     Plenty of ATS platforms return 405/501 for HEAD.
 *   - A 200 is NOT automatically alive: most ATS serve a friendly "this
 *     position is no longer accepting applications" page with a 200 status.
 *     We sniff the body for those phrases.
 *   - Anything ambiguous (403 bot-block, 429, 5xx, timeout, DNS failure) is
 *     recorded as 'unknown', NEVER 'dead'. Hiding a real job because
 *     Cloudflare challenged our crawler would be its own trust failure. Only
 *     positive evidence of death counts.
 *   - Politeness: bounded concurrency, per-host serialisation is not
 *     attempted but the shuffle spreads hosts out naturally.
 *
 * USAGE
 *   node --env-file=.env ingest/check_links.js                # default batch
 *   node --env-file=.env ingest/check_links.js --limit 300
 *   node --env-file=.env ingest/check_links.js --dry-run      # report only
 *   node --env-file=.env ingest/check_links.js --recheck-days 14
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const num = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i > -1 && args[i + 1] ? parseInt(args[i + 1], 10) || dflt : dflt;
};
const LIMIT = num("--limit", 500);
const RECHECK_DAYS = num("--recheck-days", 7);
const CONCURRENCY = num("--concurrency", 8);
const TIMEOUT_MS = 12000;

// A 200 response whose body says the posting is closed. Kept to phrases that
// are unambiguous — "closed" or "filled" alone appear in plenty of live JDs.
const CLOSED_PHRASES = [
  "no longer accepting applications",
  "no longer available",
  "no longer open",
  "this position has been filled",
  "this job has been filled",
  "position is closed",
  "job posting has expired",
  "this posting has expired",
  "posting is no longer active",
  "job is no longer active",
  "we are no longer accepting",
  "applications are closed",
  "job not found",
  "position no longer exists",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, method) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        // Identify honestly. Some ATS allow known crawlers and block blanks.
        "User-Agent": "JobCopilotLinkCheck/1.0 (+https://job-os-tau.vercel.app; verifying listings are still live)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Anti-bot interstitials. A challenge page is NOT evidence the job is gone —
// it's evidence we couldn't look. Must resolve to 'unknown', never 'dead'.
const CHALLENGE_PHRASES = [
  "just a moment", "checking your browser", "attention required",
  "enable javascript and cookies", "verify you are human",
  "performing security verification", "ddos protection by",
];

/**
 * Did the server redirect us AWAY from the specific posting?
 *
 * The most reliable death signal in practice, and language-independent.
 * Most ATS platforms don't 404 a removed job — they 200-redirect to the
 * company's listings index. Confirmed live: a fabricated id on
 * holafly.applytojob.com/apply/jobs/details/<id> lands on /apply/jobs with
 * status 200 and a full page of HTML, which no status-code or body-phrase
 * check would ever catch.
 *
 * Method: pull identifier-ish tokens out of the ORIGINAL url (last path
 * segment plus any query values). If the original had one and NONE of them
 * survive into the final url, the posting we asked for no longer exists.
 */
function redirectedAwayFromPosting(originalUrl, finalUrl) {
  if (!finalUrl || finalUrl === originalUrl) return false;
  let ids = [];
  try {
    const u = new URL(originalUrl);
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1];
    // Ignore generic trailing segments ("details", "apply", "jobs") — they
    // aren't identifiers and would produce false "still there" matches.
    const GENERIC = new Set(["details", "detail", "apply", "jobs", "job", "careers", "career", "postings", "posting"]);
    if (last && !GENERIC.has(last.toLowerCase())) ids.push(last);
    for (const v of u.searchParams.values()) ids.push(v);
  } catch { return false; }
  ids = ids.filter((s) => s && s.length >= 4);
  if (ids.length === 0) return false;               // nothing identifying to track
  const final = finalUrl.toLowerCase();
  return !ids.some((id) => final.includes(id.toLowerCase()));
}

/** -> 'ok' | 'dead' | 'unknown'  (exported so it can be tested without a DB) */
export async function checkOne(url) {
  if (!url || !/^https?:\/\//i.test(url)) return "unknown";
  try {
    // HEAD first: cheap, and it still follows redirects, so it catches both
    // an outright 404 and the redirect-to-index case without downloading.
    let res = await fetchWithTimeout(url, "HEAD");
    if (res.status === 405 || res.status === 501 || res.status === 400) {
      res = await fetchWithTimeout(url, "GET");
    }

    if (res.status === 404 || res.status === 410) return "dead";
    if (res.status === 403 || res.status === 429 || res.status >= 500) return "unknown";
    if (!res.ok) return "unknown";
    if (redirectedAwayFromPosting(url, res.url)) return "dead";

    // Still here and 200 — but the page itself may say the role is closed,
    // or may be a bot challenge. Both need the body, which HEAD never has.
    // A host can wave HEAD through and then challenge the GET — himalayas.app
    // answers HEAD 200 but serves a Cloudflare 403 interstitial on GET. That
    // is "we couldn't look", not "it's alive", so it must not resolve to 'ok'.
    const full = await fetchWithTimeout(url, "GET").catch(() => null);
    if (!full) return "unknown";
    if (full.status === 404 || full.status === 410) return "dead";
    if (!full.ok) return "unknown";
    if (redirectedAwayFromPosting(url, full.url)) return "dead";
    if (!(full.headers.get("content-type") || "").includes("text/html")) return "ok";

    const html = (await full.text().catch(() => "")).toLowerCase();
    if (!html) return "ok";
    const head = html.slice(0, 4000);                // challenges render immediately
    if (CHALLENGE_PHRASES.some((p) => head.includes(p))) return "unknown";
    if (CLOSED_PHRASES.some((p) => html.includes(p))) return "dead";
    return "ok";
  } catch {
    // Abort/DNS/TLS/network — ambiguous, never fatal to the listing.
    return "unknown";
  }
}

// Fails loudly and usefully if migration 010 hasn't been applied yet.
async function assertLivenessColumns() {
  const { error } = await supabase.from("jobs").select("link_status").limit(1);
  if (error) {
    console.log(`\n❌ jobs.link_status is missing — run this first:`);
    console.log(`   supabase/migrations/010_job_liveness.sql (Supabase Dashboard → SQL Editor)\n`);
    process.exit(1);
  }
}

async function selectBatch() {
  const staleBefore = new Date(Date.now() - RECHECK_DAYS * 864e5).toISOString();
  const liveCutoff = new Date(Date.now() - 28 * 864e5).toISOString();
  for (let a = 1; a <= 4; a++) {
    // Only rows the search can actually surface today — no point spending
    // requests on listings already gated out by freshness.
    const { data, error } = await supabase
      .from("jobs")
      .select("id, apply_url, title, company, link_status, link_checked_at")
      .gte("last_seen_at", liveCutoff)
      .or(`link_checked_at.is.null,link_checked_at.lt.${staleBefore}`)
      .order("link_checked_at", { ascending: true, nullsFirst: true })
      .limit(LIMIT);
    if (!error) return data || [];
    console.log(`  ⚠️  select failed (attempt ${a}/4): ${error.message}`);
    await sleep(1500 * a);
  }
  return [];
}

async function persist(rows) {
  if (dryRun || rows.length === 0) return 0;
  const now = new Date().toISOString();
  let written = 0;
  // Group by status so each status is one .in() update instead of N calls.
  for (const status of ["ok", "dead", "unknown"]) {
    const ids = rows.filter((r) => r.status === status).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      for (let a = 1; a <= 4; a++) {
        const { error } = await supabase.from("jobs")
          .update({ link_status: status, link_checked_at: now }).in("id", slice);
        if (!error) { written += slice.length; break; }
        console.log(`  ⚠️  update failed (attempt ${a}/4): ${error.message}`);
        await sleep(1500 * a);
      }
      await sleep(80);
    }
  }
  return written;
}

async function run() {
  console.log(`\n🔗 LINK CHECK${dryRun ? " (DRY RUN)" : ""} — batch ${LIMIT}, recheck older than ${RECHECK_DAYS}d`);
  await assertLivenessColumns();
  const batch = await selectBatch();
  if (batch.length === 0) { console.log("   nothing due for checking.\n"); return; }
  console.log(`   ${batch.length} listings due\n`);

  const results = [];
  let done = 0;
  const queue = [...batch];

  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      const status = await checkOne(row.apply_url);
      results.push({ ...row, status });
      done++;
      if (done % 50 === 0) process.stdout.write(`   …checked ${done}/${batch.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const by = { ok: 0, dead: 0, unknown: 0 };
  for (const r of results) by[r.status]++;
  const written = await persist(results);

  console.log(`\n📊 DONE`);
  console.log(`   alive:   ${by.ok}`);
  console.log(`   DEAD:    ${by.dead}   ← removed from search`);
  console.log(`   unknown: ${by.unknown}  (bot-blocked / timeout — left visible on purpose)`);
  if (dryRun) console.log(`   (dry run — nothing written)`);
  else console.log(`   rows updated: ${written}`);

  const dead = results.filter((r) => r.status === "dead").slice(0, 12);
  if (dead.length) {
    console.log(`\n   sample of dead listings:`);
    for (const d of dead) console.log(`     ✗ ${(d.title || "").slice(0, 52)} @ ${d.company}`);
  }
  console.log("");
}

// Only auto-run when invoked directly, so `import { checkOne }` is safe.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
