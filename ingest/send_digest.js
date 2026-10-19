import {buildDigestFeeds,digestPreferenceKey} from "./core/digestFeed.js";
import {buildDigestEmail} from "./core/digestEmail.js";
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
 *   node --env-file=.env ingest/send_digest.js --test=you@example.com --country=Nigeria  (send ONLY to this address)
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.DIGEST_FROM_ADDRESS || "JobCopilot <digest@resend.dev>";
const SITE_URL = process.env.SITE_URL || "https://job-os-tau.vercel.app";
const API_URL = process.env.DIGEST_API_URL || process.env.API_URL || "https://job-os-z27v.onrender.com";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const testArg = args.find((a) => a.startsWith("--test="))?.split("=")[1];

if (!RESEND_KEY && !dryRun) {
  console.error("Missing RESEND_API_KEY in environment. Get a free key at resend.com,");
  console.error("or run with --dry-run to preview without sending.");
  process.exit(1);
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
    subscribers = [{ email: testArg, country: args.find(a=>a.startsWith("--country="))?.slice(10) || null, role_cluster: args.find(a=>a.startsWith("--role="))?.slice(7) || null, unsubscribe_token: "test" }];
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

  // Complete discovery before sending so a failed page cannot produce a partial digest.
  const feeds = await buildDigestFeeds({db:supabase,preferences:subscribers});
  let sent = 0, failed = 0, skippedEmpty = 0;
  for (const sub of subscribers) {
    const feed = feeds.get(digestPreferenceKey(sub));
    if (feed.reason) { console.log(`  Skipped subscriber: ${feed.reason}`); skippedEmpty++; continue; }
    const jobs = feed.jobs;
    if (jobs.length === 0) { skippedEmpty++; continue; } // don't email an empty digest
    const html = buildDigestEmail({ jobs, unsubscribeToken: sub.unsubscribe_token, siteUrl:SITE_URL, apiUrl:API_URL });
    const subject = `${jobs.length} new eligible roles this week`;
    const ok = await sendOne(sub.email, html, subject);
    if (ok) {
      sent++;
      if (!dryRun && !testArg) {
        const {error} = await supabase.from("digest_subscribers").update({ last_sent_at: new Date().toISOString() }).eq("email", sub.email);
        if (error) { failed++; console.error(`Digest delivery timestamp failed: ${error.message}`); }
      }
    } else failed++;
    await new Promise((r) => setTimeout(r, 250)); // gentle pacing, respects Resend's rate limits
  }

  console.log(`\n📊 DONE — sent: ${sent} | failed: ${failed} | skipped (no new matches): ${skippedEmpty}\n`);
  if (failed) process.exitCode = 1;
}

run().catch((e) => { console.error(e); process.exit(1); });
