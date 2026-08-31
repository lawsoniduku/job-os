/**
 * ingest/verify_employer.js
 * =========================
 * Checks that 015a/b/c actually applied — all of them, not just the tables.
 *
 * WHY THIS EXISTS. The first attempt at this migration appeared to have
 * worked when probed with `.select("*", { count: "exact", head: true })`:
 * that returns `{ count: null, error: null }` for a table PostgREST can't
 * see, which reads as success. Every check below uses a real select and
 * asserts on the actual failure, because a verification script that can
 * report a false pass is worse than no verification script.
 *
 * It also distinguishes the two ways a table looks missing:
 *   - PGRST205  the table isn't in PostgREST's SCHEMA CACHE (it may exist;
 *               015c ends with `notify pgrst, 'reload schema'` for this)
 *   - 42P01     it genuinely does not exist
 *
 * USAGE:
 *   node --env-file=.env ingest/verify_employer.js
 *
 * Writes and deletes a handful of probe rows in employer_orgs /
 * job_postings / candidate_feedback. It cleans up after itself, including
 * on failure. It touches nothing that already existed.
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// The frontend's anon key, read from the UI's env so the RLS checks below
// exercise the key the browser actually uses rather than a guess at it.
function anonClient() {
  try {
    const env = fs.readFileSync("job-os-ui/.env", "utf8");
    const key = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)?.[1];
    return key ? createClient(process.env.SUPABASE_URL, key) : null;
  } catch {
    return null;
  }
}

const TABLES = [
  "employer_orgs", "employer_members", "job_postings",
  "posting_submissions", "candidate_feedback", "intro_requests",
];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`   ✅ ${m}`); };
const no = (m) => { fail++; console.log(`   ❌ ${m}`); };

async function run() {
  console.log("\n🔎 VERIFY EMPLOYER SCHEMA (015a · 015b · 015c)\n");

  /* ── 015a: tables reachable ─────────────────────────────── */
  console.log("015a — tables");
  let missing = 0;
  for (const t of TABLES) {
    // select("*") rather than select("id"): employer_members is keyed on
    // (org_id, user_id) and has no id column, so asking for one reported
    // 42703 and made a table that exists look like a table that doesn't.
    const { error } = await supabase.from(t).select("*").limit(1);
    if (!error) { ok(t); continue; }
    missing++;
    if (error.code === "PGRST205") {
      no(`${t} — not in PostgREST's schema cache. Run:  notify pgrst, 'reload schema';`);
    } else {
      no(`${t} — ${error.code || "?"} ${error.message}`);
    }
  }
  if (missing) {
    console.log(`\n   ${missing} table(s) unreachable — 015a has not applied. Stopping.\n`);
    process.exit(1);
  }

  /* ── 015b: constraints actually reject ──────────────────── */
  console.log("\n015b — constraints");
  const { data: org, error: orgErr } = await supabase
    .from("employer_orgs").insert({ name: "__verify_probe__" }).select().single();

  if (orgErr) { no(`couldn't create a probe org: ${orgErr.message}`); return finish(); }

  let posting = null;
  try {
    const bad = await supabase.from("job_postings")
      .insert({ org_id: org.id, title: "__probe__", status: "not_a_status" });
    bad.error ? ok("job_postings rejects an unknown status")
              : no("job_postings ACCEPTED an unknown status — 015b §2 missing");

    const good = await supabase.from("job_postings")
      .insert({ org_id: org.id, title: "__probe__" }).select().single();
    if (good.error) { no(`valid posting insert failed: ${good.error.message}`); }
    else {
      posting = good.data;
      good.data.status === "draft"
        ? ok("job_postings defaults to draft")
        : no(`job_postings defaulted to '${good.data.status}', expected 'draft'`);
    }

    if (posting) {
      const banned = await supabase.from("candidate_feedback").insert({
        posting_id: posting.id, org_id: org.id,
        candidate_id: "00000000-0000-0000-0000-000000000001",
        decision: "rejected", reason_code: "not_a_fit",
      });
      banned.error ? ok("candidate_feedback rejects 'not_a_fit'")
                   : no("candidate_feedback ACCEPTED 'not_a_fit' — 015b §4 missing");

      const badScore = await supabase.from("posting_submissions").insert({
        posting_id: posting.id, org_id: org.id,
        candidate_id: "00000000-0000-0000-0000-000000000001",
        match_score: 250,
      });
      badScore.error ? ok("posting_submissions rejects a score above 100")
                     : no("posting_submissions ACCEPTED score=250 — 015b §3 missing");
    }

    /* ── 015c: RLS closes the client out ──────────────────── */
    console.log("\n015c — row-level security");
    const anon = anonClient();
    if (!anon) {
      no("couldn't read job-os-ui/.env — skipped the RLS checks");
    } else {
      for (const t of ["employer_orgs", "job_postings", "posting_submissions", "intro_requests"]) {
        const { data, error } = await anon.from(t).select("*").limit(1);
        // Either an explicit refusal or an empty result is correct; a row
        // coming back means the client can read a table it must not.
        (error || (data || []).length === 0)
          ? ok(`${t} is closed to the anon key`)
          : no(`${t} RETURNED A ROW to the anon key — RLS not enabled`);
      }
    }

    /* ── 015c §4: updated_at trigger ──────────────────────── */
    console.log("\n015c — triggers");
    const before = org.updated_at;
    await new Promise((r) => setTimeout(r, 1100));
    const bumped = await supabase.from("employer_orgs")
      .update({ website: "example.test" }).eq("id", org.id).select().single();
    if (bumped.error) no(`couldn't update the probe org: ${bumped.error.message}`);
    else bumped.data.updated_at !== before
      ? ok("touch_employer_orgs bumps updated_at")
      : no("updated_at did not change — the trigger from 015c §4 is missing");
  } finally {
    // Cascades clean up postings, submissions and feedback with the org.
    if (org?.id) await supabase.from("employer_orgs").delete().eq("id", org.id);
    console.log("\n   (probe rows removed)");
  }

  finish();
}

function finish() {
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed · ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error("\n💥", e.message, "\n");
  process.exit(1);
});
