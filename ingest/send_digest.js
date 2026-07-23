/**
 * ingest/send_digest.js
 * ======================
 * Weekly "new eligible roles this week" email digest.
 * Inspired by seeing OpenRemote (a similar, smaller project) do this well
 * with a static weekly list — we build the same idea as an actual feature:
 * personalized by country/cluster preference, sent to opted-in subscribers.
 *
 * USES: Resend (https://resend.com) — free tier: 3,000 emails/mo, 100/day.
 * Get a free API key at resend.com, verify a sending domain (or use their
 * onboarding@resend.dev test address while you set that up), add it as
 * RESEND_API_KEY in .env (local) and as a repo secret (for the cron).
 *
 * USAGE:
 *   node --env-file=.env ingest/send_digest.js            (send to everyone)
 *   node --env-file=.env ingest/send_digest.js --dry-run  (build emails, print, send nothing)
 *   node --env-file=.env ingest/send_digest.js --test=you@example.com  (send ONLY to this address)
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.DIGEST_FROM_ADDRESS || "JobCopilot <digest@resend.dev>";
const SITE_URL = process.env.SITE_URL || "https://job-os-tau.vercel.app";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const testArg = args.find((a) => a.startsWith("--test="))?.split("=")[1];

if (!RESEND_KEY && !dryRun) {
  console.error("Missing RESEND_API_KEY in environment. Get a free key at resend.com,");
  console.error("or run with --dry-run to preview without sending.");
  process.exit(1);
}

// Roles a candidate can pursue regardless of specific country match.
const KEEP_REGIONS = new Set(["Africa", "Nigeria", "Global", "Remote"]);

async function fetchNewRoles({ country, roleCluster }) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from("jobs")
    .select("title, company, apply_url, role_cluster, eligibility_region, posted_at, location, source")
    .gte("posted_at", since)
    .order("posted_at", { ascending: false })
    .limit(500);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let jobs = (data || []).filter((j) => KEEP_REGIONS.has(j.eligibility_region));

  // country preference: keep explicitly-that-country roles PLUS global/remote
  // (never narrow to ONLY that country — global/remote is always relevant too)
  if (country) {
    jobs = jobs.filter(
      (j) => j.eligibility_region === "Nigeria" || j.eligibility_region === "Africa" ||
             (j.location || "").toLowerCase().includes(country.toLowerCase()) ||
             ["Global", "Remote"].includes(j.eligibility_region)
    );
  }
  if (roleCluster) {
    jobs = jobs.filter((j) => j.role_cluster === roleCluster);
  }

  return jobs;
}

function groupByCluster(jobs) {
  const groups = {};
  for (const j of jobs) {
    const key = j.role_cluster || "Other";
    (groups[key] ||= []).push(j);
  }
  // biggest groups first, same as OpenRemote's layout
  return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
}

function buildEmailHtml({ jobs, unsubscribeToken }) {
  const groups = groupByCluster(jobs);
  const weekOf = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const sections = groups
    .map(([cluster, list]) => {
      const rows = list
        .slice(0, 15) // cap per section so the email doesn't become enormous
        .map(
          (j) => `
        <tr>
          <td style="padding:8px 0; border-bottom:1px solid #eee;">
            <a href="${j.apply_url}" style="color:#2563eb; text-decoration:none; font-weight:600;">${escapeHtml(j.title)}</a>
            <div style="color:#666; font-size:13px;">${escapeHtml(j.company || "")} · ${escapeHtml(j.location || j.eligibility_region)}</div>
          </td>
        </tr>`
        )
        .join("");
      return `
      <h3 style="margin:24px 0 8px; font-size:16px; color:#111;">${escapeHtml(cluster)} <span style="color:#888; font-weight:normal;">(${list.length})</span></h3>
      <table style="width:100%; border-collapse:collapse;">${rows}</table>`;
    })
    .join("");

  return `
  <div style="font-family:system-ui,-apple-system,sans-serif; max-width:600px; margin:0 auto; padding:20px;">
    <h1 style="font-size:20px; color:#111;">${jobs.length} new eligible roles this week</h1>
    <p style="color:#666; font-size:14px;">Week of ${weekOf} — roles you can actually get, not just roles that exist.</p>
    ${sections || "<p>No new eligible roles matched your preferences this week — check back soon.</p>"}
    <p style="margin-top:32px; font-size:12px; color:#999;">
      <a href="${SITE_URL}/app" style="color:#2563eb;">Open JobCopilot</a> to search anytime.<br/>
      <a href="${SITE_URL}/digest/unsubscribe?token=${unsubscribeToken}" style="color:#999;">Unsubscribe</a>
    </p>
  </div>`;
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function sendOne(to, html, subject) {
  if (dryRun) {
    console.log(`  [DRY RUN] would send to ${to}: "${subject}"`);
    return true;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.log(`  ❌ send failed for ${to}: ${res.status} ${body.slice(0, 200)}`);
    return false;
  }
  return true;
}

async function run() {
  console.log(`\n📬 WEEKLY DIGEST ${dryRun ? "(DRY RUN)" : ""}${testArg ? ` — TEST MODE: ${testArg}` : ""}\n`);

  let subscribers;
  if (testArg) {
    subscribers = [{ email: testArg, country: null, role_cluster: null, unsubscribe_token: "test" }];
  } else {
    const { data, error } = await supabase
      .from("digest_subscribers")
      .select("email, country, role_cluster, unsubscribe_token")
      .eq("confirmed", true);
    if (error) throw new Error(error.message);
    subscribers = data || [];
  }

  console.log(`Subscribers to send to: ${subscribers.length}\n`);
  if (subscribers.length === 0) {
    console.log("No subscribers yet — nothing to send.");
    return;
  }

  let sent = 0, failed = 0, skippedEmpty = 0;
  for (const sub of subscribers) {
    const jobs = await fetchNewRoles({ country: sub.country, roleCluster: sub.role_cluster });
    if (jobs.length === 0) { skippedEmpty++; continue; } // don't email an empty digest
    const html = buildEmailHtml({ jobs, unsubscribeToken: sub.unsubscribe_token });
    const subject = `${jobs.length} new eligible roles this week`;
    const ok = await sendOne(sub.email, html, subject);
    if (ok) {
      sent++;
      if (!dryRun && !testArg) {
        await supabase.from("digest_subscribers").update({ last_sent_at: new Date().toISOString() }).eq("email", sub.email);
      }
    } else failed++;
    await new Promise((r) => setTimeout(r, 250)); // gentle pacing, respects Resend's rate limits
  }

  console.log(`\n📊 DONE — sent: ${sent} | failed: ${failed} | skipped (no new matches): ${skippedEmpty}\n`);
}

run().catch((e) => { console.error(e); process.exit(1); });
