import { ACTIVE_JOB_SOURCES } from "../api/sourcePolicy.js";
import { createVerificationScheduler } from "./core/verificationScheduler.js";
import { verificationQuery } from "./core/verificationQueue.js";
import { recordVerificationSummary, printVerificationSummary } from "./core/verificationDiagnostics.js";
/** Scheduled verification of current public postings, with bounded batches.
 * Stores compact evidence in existing elig_signals JSONB; no schema change.
 * A blocked/unsupported source is unknown, never falsely marked closed.
 */

import { verifyPosting, compactVerification, retainVerificationEvidence } from "../api/postingVerification.js";
import dotenv from "dotenv";
import { persistVerifications } from "./core/verificationWriter.js";
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allRegions = args.includes("--all-regions");
const num = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i > -1 && args[i + 1] ? parseInt(args[i + 1], 10) || dflt : dflt;
};
const LIMIT = num("--limit", 500);
const RECHECK_DAYS = num("--recheck-days", 7);
const CONCURRENCY = num("--concurrency", 8);
const sourceIndex=args.indexOf('--source');
const source=sourceIndex>=0?args[sourceIndex+1]:null;
if(source && !ACTIVE_JOB_SOURCES.includes(source)) throw new Error(`Unsupported --source: ${source}`);
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

// Read at most this much of a page body. We only ever phrase-match against it,
// and the "this role is closed" banner is always in the served markup near the
// top — not 800KB down past the analytics bundles. In the first real run 273
// of 400 checks were live pages downloaded in full purely to confirm nothing
// was wrong with them.
const MAX_BODY_BYTES = 256 * 1024;

/** Read a response body up to MAX_BODY_BYTES, then stop pulling. */
async function readCapped(res) {
  try {
    if (!res.body) return await res.text().catch(() => "");
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});   // stop the transfer; don't drain the rest
    return new TextDecoder("utf-8", { fatal: false })
      .decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  } catch {
    return "";
  }
}

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
  ids = ids.filter((s) => s && s.length >= 1);
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

    const html = (await readCapped(full)).toLowerCase();
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
  if (error) throw new Error(`Cannot read jobs.link_status: ${error.message}`);
}

// Regions the search pre-filter actually surfaces to an African candidate
// (see /ai/search in api/server.js). A listing tagged US / UK / Canada /
// Regional can never appear in results, so whether its link still works is
// information no user will ever benefit from. Measured: 18,560 of 48,673 rows
// — 38% of the crawl — were in that unreachable set. Skipping them is free
// coverage, not a shortcut. Pass --all-regions to check everything anyway.
const SEARCHABLE_REGIONS = ["Nigeria", "Africa", "Global", "Remote", "EMEA", "Unknown"];

async function selectBatch(limit = Math.min(LIMIT, 500)) {
  for (let a = 1; a <= 4; a++) {
    // Only rows the search can actually surface today — no point spending
    // requests on listings already gated out by freshness or by region.
    // Persist each batch before selecting the next: rows leave the due queue.
    // Country filters are applied at search time; check every region.
    const { data, error } = await verificationQuery(supabase,{limit,source,recheckDays:RECHECK_DAYS});
    if (!error) return data || [];
    console.log(`  ⚠️  select failed (attempt ${a}/4): ${error.message}`);
    await sleep(1500 * a);
  }
  throw new Error("Could not select verification batch after 4 attempts");
}

async function run() {
  console.log(`\n🔗 LINK CHECK${dryRun ? " (DRY RUN)" : ""} — batch ${LIMIT}, recheck older than ${RECHECK_DAYS}d`);
  await assertLivenessColumns();
  let checked = 0, written = 0;
  const by = { ok: 0, dead: 0, unknown: 0 };
  const diagnostics={};
  const deadline = Date.now() + 44 * 60 * 1000;
  const scheduledVerification=createVerificationScheduler({perHost:2});
  while (checked < LIMIT && Date.now() < deadline) {
    // Persist each batch before selecting again, so PostgREST's response row
    // limit cannot silently turn a requested 12,000-job sweep into 1,000 jobs.
    const batch = await selectBatch(Math.min(500, LIMIT - checked));
    if (!batch.length) break;
    const results = [], queue = [...batch];
    await Promise.all(Array.from({length: CONCURRENCY}, async () => {
      while (queue.length) {
        const row = queue.shift();
        const verification = retainVerificationEvidence(compactVerification(await scheduledVerification(row, {timeoutMs: 12000})), row.elig_signals?.verification);
        const status = verification.status === 'ok' ? 'ok' : verification.status === 'dead' ? 'dead' : 'unknown';
        recordVerificationSummary(diagnostics,row,verification);
        results.push({...row,status,verification}); by[status]++; checked++;
      }
    }));
    const outcome = dryRun ? { saved: 0, failedIds: [] } : await persistVerifications(supabase, results);
    const count = outcome.saved;
    written += count;
    if (outcome.failedIds.length) console.error(`Verification persistence exhausted retries for ${outcome.failedIds.length} rows; these remain due for recheck.`);
    console.log(`Checked ${checked}/${LIMIT}: ${by.ok} current, ${by.dead} closed/non-vacancies, ${by.unknown} unverified`);
    if (dryRun || count !== results.length || process.exitCode) {
      if (!dryRun) process.exitCode=1;
      break;
    }
  }
  console.log(`Verification complete: ${checked} checked, ${written} saved. Unverified listings remain available with uncertainty labels.`);
  printVerificationSummary(diagnostics);
  console.log("");
}

// Only auto-run when invoked directly, so `import { checkOne }` is safe.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch(error => { console.error(error.message); process.exitCode = 1; });
