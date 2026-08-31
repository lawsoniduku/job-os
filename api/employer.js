/**
 * api/employer.js — the employer side: post · screen · feedback · match.
 * ======================================================================
 *
 * Mounted by server.js. Everything here runs behind makeRequireAuth and,
 * except for the two public/candidate routes at the bottom, behind
 * makeRequireEmployer as well.
 *
 * THE ONE RULE, restated because it is the whole of the access control:
 * this server holds a service_role key, so RLS is off. `req.orgId` comes
 * from a verified JWT and a server-side membership lookup, and EVERY query
 * below filters on it. A missing .eq("org_id", req.orgId) is not a bug that
 * returns too many rows — it is one that returns another company's
 * applicants. They are marked, so they are easy to audit.
 *
 * See migration 015 for why each table is shaped the way it is.
 */
import { Router } from "express";
import { classifyJob, extractEligibilitySignals, SIGNALS_VERSION } from "./roleIntelligence.js";
import { generateJSON, isLLMHealthy } from "../lib/llm.js";

// Where a candidate lands when they click Apply on an employer posting.
// This is written into jobs.apply_url, so it must be the PUBLIC origin of
// the frontend, not the API's own.
const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");

// Reason codes must match the check constraint in migration 015 §4. Kept
// here as well so the API rejects a bad code with a readable message
// instead of surfacing a Postgres constraint violation.
export const FEEDBACK_REASONS = [
  "experience_level", "missing_skill", "location_eligibility",
  "cv_presentation", "role_filled", "role_closed", "stronger_candidates",
];

const STAGES = ["new", "screening", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"];

export function employerRouter({ supabase, requireAuth, requireEmployer, optionalAuth, searchLimit, llmLimit }) {
  const r = Router();

  /* ══════════════════════════════════════════════════════════════════
     ACCOUNT
     ══════════════════════════════════════════════════════════════════ */

  // Who am I, and what org am I in. The frontend calls this once on load to
  // decide whether to render the employer console or the setup screen.
  r.get("/employer/me", requireAuth, async (req, res) => {
    const { data, error } = await supabase
      .from("employer_members")
      .select("org_id, role, employer_orgs(id, name, website, country, size, verified_at, created_at)")
      .eq("user_id", req.user.id);

    if (error) return res.status(503).json({ error: "Couldn't load your account." });

    res.json({
      user: { id: req.user.id, email: req.user.email },
      orgs: (data || []).map((m) => ({ ...m.employer_orgs, membership_role: m.role })),
    });
  });

  // Create an org. The creator becomes its owner in the same request —
  // an org with no members is unreachable forever, so the two writes are
  // not allowed to come apart. If the membership insert fails we delete
  // the org rather than leave an orphan.
  r.post("/employer/orgs", requireAuth, searchLimit, async (req, res) => {
    const { name, website, country, size } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "Company name is required." });

    const { data: org, error } = await supabase
      .from("employer_orgs")
      .insert({
        name: name.trim().slice(0, 200),
        website: website?.trim()?.slice(0, 300) || null,
        country: country?.trim()?.toLowerCase() || null,
        size: size?.trim() || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) return res.status(503).json({ error: "Couldn't create the account — try again." });

    const { error: memberErr } = await supabase
      .from("employer_members")
      .insert({ org_id: org.id, user_id: req.user.id, role: "owner" });

    if (memberErr) {
      await supabase.from("employer_orgs").delete().eq("id", org.id);
      return res.status(503).json({ error: "Couldn't create the account — try again." });
    }

    res.status(201).json({ org: { ...org, membership_role: "owner" } });
  });

  /* ══════════════════════════════════════════════════════════════════
     POST — publish a role into the same table candidates already search
     ══════════════════════════════════════════════════════════════════ */

  // Turn a pasted job description into structured fields. Convenience only:
  // it pre-fills a form the employer then edits, and every field it returns
  // is editable before anything is saved. Deliberately separate from the
  // create call so a model outage can never block posting a job — the
  // frontend just shows an empty form instead.
  r.post("/employer/postings/parse", requireAuth, requireEmployer, llmLimit, async (req, res) => {
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: "Paste a job description first." });
    if (!(await isLLMHealthy())) {
      return res.status(503).json({ error: "AI is offline — fill the form in manually.", code: "llm_offline" });
    }

    const prompt = `Extract structured fields from this job description. Use ONLY what the text states — never infer a salary, a location, or a requirement that isn't written down. Omit anything absent.

Return JSON:
{
  "title": string,
  "location": string|null,
  "remote_type": "remote"|"hybrid"|"onsite"|null,
  "employment_type": "full_time"|"part_time"|"contract"|"internship"|null,
  "salary_min": number|null,
  "salary_max": number|null,
  "seniority": "junior"|"mid"|"senior"|"lead"|null,
  "eligible_countries": string[],
  "summary": string
}

"eligible_countries" is ONLY for countries the text explicitly says the company can hire or employ in. An office location is not a hiring eligibility. If the text does not say, return [].

JOB DESCRIPTION:
${text.slice(0, 12000)}`;

    try {
      const parsed = await generateJSON(prompt, { maxTokens: 900 });
      if (!parsed) return res.status(502).json({ error: "Couldn't read that — fill the form in manually." });
      const { role_cluster, department } = classifyJob(parsed.title || "", text);
      res.json({ parsed: { ...parsed, role_cluster, department } });
    } catch {
      res.status(502).json({ error: "Couldn't read that — fill the form in manually." });
    }
  });

  r.post("/employer/postings", requireAuth, requireEmployer, searchLimit, async (req, res) => {
    const b = req.body || {};
    if (!b.title?.trim()) return res.status(400).json({ error: "A job title is required." });

    // Classified server-side, never taken from the client: role_cluster is
    // what the candidate search filters on, so letting a poster choose it
    // freely would let one posting appear under every search.
    const { role_cluster, department } = classifyJob(b.title, b.description || "");

    const { data, error } = await supabase
      .from("job_postings")
      .insert({
        org_id: req.orgId,
        title: b.title.trim().slice(0, 200),
        description: b.description?.slice(0, 20000) || null,
        location: b.location?.trim()?.slice(0, 200) || null,
        remote_type: b.remote_type || null,
        employment_type: b.employment_type || null,
        salary_min: intOrNull(b.salary_min),
        salary_max: intOrNull(b.salary_max),
        seniority: b.seniority || null,
        eligible_countries: normaliseCountries(b.eligible_countries),
        role_cluster,
        status: "draft",
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) return res.status(503).json({ error: "Couldn't save the posting — try again." });
    res.status(201).json({ posting: { ...data, department } });
  });

  // List postings with the two counts the console actually shows: how many
  // people applied, and how many are still waiting on an answer. Counted in
  // one query each rather than per-posting, because a per-row count is how
  // a list page ends up making twenty round trips.
  r.get("/employer/postings", requireAuth, requireEmployer, async (req, res) => {
    const { data: postings, error } = await supabase
      .from("job_postings")
      .select("*")
      .eq("org_id", req.orgId)
      .order("created_at", { ascending: false });

    if (error) return res.status(503).json({ error: "Couldn't load your postings." });

    const ids = (postings || []).map((p) => p.id);
    const counts = {};
    if (ids.length) {
      const { data: subs } = await supabase
        .from("posting_submissions")
        .select("posting_id, stage")
        .eq("org_id", req.orgId)
        .in("posting_id", ids);

      for (const s of subs || []) {
        const c = (counts[s.posting_id] ||= { total: 0, awaiting: 0 });
        c.total++;
        // "Awaiting" is anything the employer hasn't decided on. It is the
        // number that should make someone open the queue, so it counts
        // undecided stages rather than unread rows.
        if (s.stage === "new" || s.stage === "screening") c.awaiting++;
      }
    }

    res.json({
      postings: (postings || []).map((p) => ({ ...p, counts: counts[p.id] || { total: 0, awaiting: 0 } })),
    });
  });

  r.get("/employer/postings/:id", requireAuth, requireEmployer, async (req, res) => {
    const { data, error } = await supabase
      .from("job_postings")
      .select("*")
      .eq("id", req.params.id)
      .eq("org_id", req.orgId)
      .maybeSingle();

    if (error) return res.status(503).json({ error: "Couldn't load the posting." });
    if (!data) return res.status(404).json({ error: "Posting not found." });
    res.json({ posting: data });
  });

  // Edit and/or move status. Publishing is the interesting half: it mirrors
  // the posting into `jobs` so it appears in candidate search, and pausing
  // or closing removes that mirror again.
  r.patch("/employer/postings/:id", requireAuth, requireEmployer, searchLimit, async (req, res) => {
    const b = req.body || {};

    const { data: existing } = await supabase
      .from("job_postings").select("*")
      .eq("id", req.params.id).eq("org_id", req.orgId).maybeSingle();
    if (!existing) return res.status(404).json({ error: "Posting not found." });

    const patch = {};
    for (const f of ["title", "description", "location", "remote_type", "employment_type", "seniority"]) {
      if (b[f] !== undefined) patch[f] = b[f];
    }
    if (b.salary_min !== undefined) patch.salary_min = intOrNull(b.salary_min);
    if (b.salary_max !== undefined) patch.salary_max = intOrNull(b.salary_max);
    if (b.eligible_countries !== undefined) patch.eligible_countries = normaliseCountries(b.eligible_countries);
    if (patch.title) patch.role_cluster = classifyJob(patch.title, patch.description ?? existing.description ?? "").role_cluster;

    if (b.status !== undefined) {
      if (!["draft", "open", "paused", "closed"].includes(b.status)) {
        return res.status(400).json({ error: "Unknown status." });
      }
      // A closed posting stays closed. Reopening would resurrect a search
      // listing under a role the team has stopped hiring for, and every
      // candidate already told "role_closed" would be contradicted.
      if (existing.status === "closed" && b.status !== "closed") {
        return res.status(409).json({ error: "This posting is closed. Duplicate it to hire for the role again." });
      }
      patch.status = b.status;
      if (b.status === "open" && !existing.published_at) patch.published_at = new Date().toISOString();
      if (b.status === "closed") patch.closed_at = new Date().toISOString();
    }

    const merged = { ...existing, ...patch };

    // Mirror maintenance. Done before the posting write so that a failure
    // to publish leaves the posting un-published rather than claiming to be
    // live with nothing in search.
    let jobId = existing.job_id;
    if (patch.status === "open" || (merged.status === "open" && Object.keys(patch).length)) {
      try {
        jobId = await mirrorToJobs(supabase, merged, req.org, existing.job_id);
        patch.job_id = jobId;
      } catch {
        return res.status(503).json({ error: "Couldn't publish to search — the posting was not changed." });
      }
    } else if (patch.status === "paused" || patch.status === "closed") {
      if (existing.job_id) {
        // Removing the row is safe by design: `applications` snapshots
        // title/company precisely so a candidate's record outlives its
        // source job (migration 012 §3).
        await supabase.from("jobs").delete().eq("id", existing.job_id);
      }
      patch.job_id = null;
    }

    const { data, error } = await supabase
      .from("job_postings").update(patch)
      .eq("id", req.params.id).eq("org_id", req.orgId)
      .select().single();

    if (error) return res.status(503).json({ error: "Couldn't save the change." });
    res.json({ posting: data });
  });

  /* ══════════════════════════════════════════════════════════════════
     SCREEN — the ranked queue
     ══════════════════════════════════════════════════════════════════ */

  r.get("/employer/postings/:id/submissions", requireAuth, requireEmployer, async (req, res) => {
    const { data: posting } = await supabase
      .from("job_postings").select("id, title")
      .eq("id", req.params.id).eq("org_id", req.orgId).maybeSingle();
    if (!posting) return res.status(404).json({ error: "Posting not found." });

    const { data: subs, error } = await supabase
      .from("posting_submissions")
      .select("*")
      .eq("posting_id", req.params.id)
      .eq("org_id", req.orgId)
      .order("match_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) return res.status(503).json({ error: "Couldn't load applicants." });

    // Which of these has already been told something. Two queries rather
    // than a join, because PostgREST's embedded filters can't express
    // "sent feedback only" without leaking the unsent drafts too.
    const ids = (subs || []).map((s) => s.id);
    const feedbackBySub = {};
    if (ids.length) {
      const { data: fb } = await supabase
        .from("candidate_feedback")
        .select("submission_id, decision, reason_code, note, sent_at, seen_at")
        .eq("org_id", req.orgId)
        .in("submission_id", ids);
      for (const f of fb || []) feedbackBySub[f.submission_id] = f;
    }

    res.json({
      posting,
      submissions: (subs || []).map((s) => ({
        // The screening queue is identity-light on purpose. An employer
        // decides on evidence — CV, skills, eligibility, availability —
        // and a name is not evidence. It is released with the intro, or
        // when the candidate is advanced; see §candidate_reveal below.
        id: s.id,
        candidate_ref: shortRef(s.candidate_id),
        candidate_id: s.stage === "new" || s.stage === "screening" || s.stage === "rejected"
          ? undefined
          : s.candidate_id,
        cv_text: s.cv_text,
        cv_skills: s.cv_skills,
        cv_years: s.cv_years,
        country: s.country,
        availability: s.availability,
        match_score: s.match_score,
        match_reason: s.match_reason,
        stage: s.stage,
        created_at: s.created_at,
        decided_at: s.decided_at,
        feedback: feedbackBySub[s.id] || null,
      })),
    });
  });

  r.patch("/employer/submissions/:id", requireAuth, requireEmployer, searchLimit, async (req, res) => {
    const { stage } = req.body || {};
    if (!STAGES.includes(stage)) return res.status(400).json({ error: "Unknown stage." });
    // 'withdrawn' is the candidate's word, not the employer's. An employer
    // marking someone withdrawn would be putting words in their mouth.
    if (stage === "withdrawn") return res.status(400).json({ error: "Only the candidate can withdraw." });

    const { data, error } = await supabase
      .from("posting_submissions")
      .update({ stage, decided_at: new Date().toISOString(), decided_by: req.user.id })
      .eq("id", req.params.id)
      .eq("org_id", req.orgId)
      .select().maybeSingle();

    if (error) return res.status(503).json({ error: "Couldn't update." });
    if (!data) return res.status(404).json({ error: "Applicant not found." });
    res.json({ submission: data });
  });

  /* ══════════════════════════════════════════════════════════════════
     FEEDBACK — one click, and the candidate actually hears back
     ══════════════════════════════════════════════════════════════════ */

  // Accepts one submission or many. Bulk is the point: an employer closing
  // out a round rejects thirty people at once, and a feedback feature that
  // only works one-at-a-time is a feedback feature that goes unused.
  r.post("/employer/feedback", requireAuth, requireEmployer, searchLimit, async (req, res) => {
    const { submission_ids, decision, reason_code, note, hold } = req.body || {};
    const ids = Array.isArray(submission_ids) ? submission_ids.filter(Boolean) : [];

    if (!ids.length) return res.status(400).json({ error: "No applicants selected." });
    if (ids.length > 200) return res.status(400).json({ error: "Too many at once — select 200 or fewer." });
    if (!["advanced", "rejected", "hired"].includes(decision)) {
      return res.status(400).json({ error: "Unknown decision." });
    }
    if (reason_code && !FEEDBACK_REASONS.includes(reason_code)) {
      return res.status(400).json({ error: "Unknown reason code." });
    }
    // A rejection with no reason is the thing this product exists to
    // replace. The API refuses to record one.
    if (decision === "rejected" && !reason_code) {
      return res.status(400).json({ error: "Pick a reason — a rejection without one is what we're fixing." });
    }

    // Re-read the submissions under the org filter. This is what stops a
    // caller sending feedback on another company's applicants by guessing
    // ids: anything not belonging to req.orgId simply isn't returned.
    const { data: subs, error: readErr } = await supabase
      .from("posting_submissions")
      .select("id, posting_id, candidate_id")
      .eq("org_id", req.orgId)
      .in("id", ids);

    if (readErr) return res.status(503).json({ error: "Couldn't load those applicants." });
    if (!subs?.length) return res.status(404).json({ error: "No matching applicants." });

    const now = new Date().toISOString();
    const rows = subs.map((s) => ({
      submission_id: s.id,
      posting_id: s.posting_id,
      org_id: req.orgId,
      candidate_id: s.candidate_id,
      decision,
      reason_code: reason_code || null,
      note: note?.trim()?.slice(0, 2000) || null,
      created_by: req.user.id,
      sent_at: hold ? null : now,
    }));

    const { data: inserted, error } = await supabase
      .from("candidate_feedback").insert(rows).select("id, submission_id");
    if (error) return res.status(503).json({ error: "Couldn't record the feedback." });

    // Keep the queue honest: a decision communicated is a decision made.
    const stage = decision === "rejected" ? "rejected" : decision === "hired" ? "hired" : "shortlisted";
    await supabase
      .from("posting_submissions")
      .update({ stage, decided_at: now, decided_by: req.user.id })
      .eq("org_id", req.orgId)
      .in("id", subs.map((s) => s.id));

    res.status(201).json({ sent: hold ? 0 : inserted.length, recorded: inserted.length, held: !!hold });
  });

  /* ══════════════════════════════════════════════════════════════════
     MATCH — 012's shortlist, over candidates who opted in
     ══════════════════════════════════════════════════════════════════ */

  // Two queries and an aggregate in JS rather than one SQL statement with a
  // HAVING clause, because PostgREST cannot express the group-by. That is a
  // fine trade at the current size (tens of opted-in profiles) and a bad one
  // at ten thousand — at which point this becomes a Postgres function. The
  // LIMIT below is what keeps the failure mode "incomplete" rather than
  // "out of memory".
  r.get("/employer/postings/:id/matches", requireAuth, requireEmployer, async (req, res) => {
    const { data: posting } = await supabase
      .from("job_postings").select("*")
      .eq("id", req.params.id).eq("org_id", req.orgId).maybeSingle();
    if (!posting) return res.status(404).json({ error: "Posting not found." });

    let q = supabase
      .from("profiles")
      .select("id, country, cv_skills, cv_titles, cv_years, availability, headline, visibility_updated_at")
      .eq("visible_to_employers", true)
      .limit(500);

    // Rung 1: only people this employer can legally engage. An empty
    // eligible_countries means the employer didn't say, which is NOT the
    // same as "anywhere" — we widen to every country rather than silently
    // asserting a legal claim on their behalf, and the UI says so.
    const countries = posting.eligible_countries || [];
    if (countries.length) q = q.in("country", countries);

    const { data: profiles, error } = await q;
    if (error) return res.status(503).json({ error: "Couldn't run the search." });

    // Rung 2: behavioural evidence — are they actually applying to this
    // kind of role. One application is noise; 012 set the bar at two.
    const ids = (profiles || []).map((p) => p.id);
    const evidence = {};
    if (ids.length && posting.role_cluster) {
      const since = new Date(Date.now() - 90 * 86400000).toISOString();
      const { data: apps } = await supabase
        .from("applications")
        .select("user_id, applied_at, created_at")
        .in("user_id", ids)
        .eq("role_cluster", posting.role_cluster)
        .gte("created_at", since);

      for (const a of apps || []) {
        const e = (evidence[a.user_id] ||= { count: 0, last: null });
        e.count++;
        const t = a.applied_at || a.created_at;
        if (!e.last || t > e.last) e.last = t;
      }
    }

    // Who already has a live intro request from us — so the UI can show
    // "asked" instead of offering to ask again.
    const asked = {};
    if (ids.length) {
      const { data: intros } = await supabase
        .from("intro_requests")
        .select("candidate_id, status")
        .eq("org_id", req.orgId)
        .in("candidate_id", ids);
      for (const i of intros || []) asked[i.candidate_id] = i.status;
    }

    const matches = (profiles || [])
      .map((p) => {
        const e = evidence[p.id] || { count: 0, last: null };
        return {
          candidate_id: p.id,
          ref: shortRef(p.id),
          country: p.country,
          headline: p.headline,
          // Named `claimed_*` all the way to the UI. These are parsed from
          // a CV the person uploaded — tidier self-reporting, not
          // verification (012's rung 3). The employer console must never
          // render them as confirmed.
          claimed_skills: p.cv_skills || [],
          claimed_titles: p.cv_titles || [],
          claimed_years: p.cv_years,
          availability: p.availability,
          applications_90d: e.count,
          last_active: e.last,
          eligibility_checked: countries.length > 0,
          intro_status: asked[p.id] || null,
          skill_overlap: overlap(p.cv_skills, posting),
        };
      })
      .filter((m) => m.applications_90d >= 2 || m.skill_overlap > 0)
      .sort((a, b) =>
        b.skill_overlap - a.skill_overlap ||
        b.applications_90d - a.applications_90d ||
        String(b.last_active || "").localeCompare(String(a.last_active || "")));

    res.json({
      posting: { id: posting.id, title: posting.title, role_cluster: posting.role_cluster },
      // Surfaced so the console can say WHY a shortlist is short, instead of
      // rendering an empty state that reads as a broken feature.
      pool: {
        opted_in_considered: profiles?.length || 0,
        country_filtered: countries.length > 0,
        role_cluster: posting.role_cluster || null,
      },
      matches,
    });
  });

  // Ask to be introduced. Creates a request the CANDIDATE answers; it does
  // not reveal anything on its own.
  r.post("/employer/intros", requireAuth, requireEmployer, searchLimit, async (req, res) => {
    const { candidate_id, posting_id, message } = req.body || {};
    if (!candidate_id) return res.status(400).json({ error: "No candidate selected." });

    if (posting_id) {
      const { data: owned } = await supabase
        .from("job_postings").select("id")
        .eq("id", posting_id).eq("org_id", req.orgId).maybeSingle();
      if (!owned) return res.status(404).json({ error: "Posting not found." });
    }

    // Consent is checked here rather than trusted from the shortlist that
    // produced the id: the candidate may have switched visibility off in
    // between, and an intro request is the point where that must bind.
    const { data: profile } = await supabase
      .from("profiles").select("id, visible_to_employers")
      .eq("id", candidate_id).maybeSingle();
    if (!profile?.visible_to_employers) {
      return res.status(403).json({ error: "This candidate is no longer open to being contacted." });
    }

    // .is() rather than .eq() for the null case: PostgREST renders
    // .eq(col, null) as `col=eq.null`, which compares against the literal
    // string and matches nothing — so a general (posting-less) intro would
    // never find its own prior request, and the "don't ask twice" guarantee
    // would silently not hold for exactly the requests that aren't tied to
    // a role. Postgres also treats NULLs as distinct in the unique index,
    // so this query is the only thing enforcing it there.
    const priorQ = supabase
      .from("intro_requests").select("id, status")
      .eq("org_id", req.orgId).eq("candidate_id", candidate_id);
    const { data: prior } = await (posting_id
      ? priorQ.eq("posting_id", posting_id)
      : priorQ.is("posting_id", null)).maybeSingle();

    if (prior?.status === "declined") {
      return res.status(409).json({ error: "They declined an earlier request for this role." });
    }
    if (prior) return res.status(409).json({ error: "You've already asked — they haven't answered yet." });

    const { data, error } = await supabase
      .from("intro_requests")
      .insert({
        org_id: req.orgId,
        posting_id: posting_id || null,
        candidate_id,
        message: message?.trim()?.slice(0, 1000) || null,
        created_by: req.user.id,
      })
      .select().single();

    if (error) return res.status(503).json({ error: "Couldn't send the request." });
    res.status(201).json({ intro: data });
  });

  // Contact details, released only by the candidate's own acceptance. This
  // is the ONLY endpoint that returns a candidate's email, and the check
  // below is the reason it can.
  r.get("/employer/intros/:id/contact", requireAuth, requireEmployer, async (req, res) => {
    const { data: intro } = await supabase
      .from("intro_requests").select("*")
      .eq("id", req.params.id).eq("org_id", req.orgId).maybeSingle();

    if (!intro) return res.status(404).json({ error: "Request not found." });
    if (intro.status !== "accepted") {
      return res.status(403).json({ error: "They haven't accepted yet.", status: intro.status });
    }

    const { data: profile } = await supabase
      .from("profiles").select("id, email, full_name, country, headline")
      .eq("id", intro.candidate_id).maybeSingle();

    res.json({ contact: profile || null });
  });

  /* ══════════════════════════════════════════════════════════════════
     CANDIDATE-FACING — the two routes the other side of the market needs
     ══════════════════════════════════════════════════════════════════ */

  // Public view of an open posting. Signed-out visitors can read it; the
  // frontend uses `can_apply` to decide whether to show Apply or Sign in.
  r.get("/postings/:id", optionalAuth, async (req, res) => {
    const { data, error } = await supabase
      .from("job_postings")
      .select("id, title, description, location, remote_type, employment_type, salary_min, salary_max, seniority, role_cluster, eligible_countries, status, published_at, employer_orgs(name, website, country, verified_at)")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) return res.status(503).json({ error: "Couldn't load the role." });
    if (!data || data.status !== "open") return res.status(404).json({ error: "This role isn't accepting applications." });

    let applied = false;
    if (req.user) {
      const { data: mine } = await supabase
        .from("posting_submissions").select("id")
        .eq("posting_id", data.id).eq("candidate_id", req.user.id).maybeSingle();
      applied = !!mine;
    }

    res.json({
      posting: {
        ...data,
        org: data.employer_orgs,
        // Only ever true when a human confirmed the company exists (015 §1).
        verified_employer: !!data.employer_orgs?.verified_at,
        employer_orgs: undefined,
      },
      can_apply: !!req.user,
      applied,
    });
  });

  // Apply. Snapshots the profile as submitted, then scores the match — in
  // that order, and with the score in a try/catch, because a model outage
  // must never be the reason someone's application doesn't exist.
  r.post("/postings/:id/apply", requireAuth, llmLimit, async (req, res) => {
    const { data: posting } = await supabase
      .from("job_postings").select("*").eq("id", req.params.id).maybeSingle();
    if (!posting || posting.status !== "open") {
      return res.status(404).json({ error: "This role isn't accepting applications." });
    }

    const [{ data: profile }, { data: cv }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", req.user.id).maybeSingle(),
      supabase.from("saved_cvs").select("cv_text").eq("user_id", req.user.id).maybeSingle(),
    ]);

    const cvText = req.body?.cvText || cv?.cv_text || null;
    if (!cvText?.trim()) {
      return res.status(400).json({ error: "Upload a CV before applying.", code: "no_cv" });
    }

    const now = new Date().toISOString();

    // The candidate's own record, on their own board. Written first so the
    // application shows up in their Pipeline even if anything below fails.
    const { data: application } = await supabase
      .from("applications")
      .insert({
        user_id: req.user.id,
        job_id: posting.job_id,
        job_title: posting.title,
        company: req.body?.company || null,
        location: posting.location,
        salary_min: posting.salary_min,
        salary_max: posting.salary_max,
        source: "employer",
        status: "applied",
        role_cluster: posting.role_cluster,
        applied_at: now,
        apply_clicked_at: now,
        apply_outcome: "applied",     // no guesswork: they applied in-app
        outcome_at: now,
      })
      .select().maybeSingle();

    const { data: submission, error } = await supabase
      .from("posting_submissions")
      .upsert({
        posting_id: posting.id,
        org_id: posting.org_id,
        candidate_id: req.user.id,
        application_id: application?.id || null,
        cv_text: cvText.slice(0, 50000),
        cv_skills: profile?.cv_skills || [],
        cv_years: profile?.cv_years ?? null,
        country: profile?.country || null,
        availability: profile?.availability || null,
        stage: "new",
      }, { onConflict: "posting_id,candidate_id" })
      .select().single();

    if (error) return res.status(503).json({ error: "Couldn't submit your application — try again." });

    // Best-effort ranking. Never awaited into the response path's failure
    // modes: if this throws, the applicant is simply unscored and sorts
    // last, which the queue renders as "not scored" rather than "0".
    scoreSubmission(supabase, submission, posting, cvText).catch(() => {});

    res.status(201).json({ submitted: true, submission_id: submission.id });
  });

  return r;
}

/* ── helpers ─────────────────────────────────────────────────────────── */

// Publishes/refreshes the searchable mirror in `jobs`.
//
// last_seen_at is stamped on every write and the source is 'employer', which
// together are what keep prune_stale.js off it — see migration 015 §7 and
// the matching guard in ingest/prune_stale.js.
async function mirrorToJobs(supabase, posting, org, existingJobId) {
  const applyUrl = `${APP_URL}/apply/${posting.id}`;
  const now = new Date().toISOString();

  const row = {
    source: "employer",
    ats_source: "employer",
    company: org?.name || "Employer",
    title: posting.title,
    description: posting.description,
    location: posting.location,
    apply_url: applyUrl,
    remote: posting.remote_type === "remote",
    remote_type: posting.remote_type,
    role_cluster: posting.role_cluster,
    seniority: posting.seniority,
    employment_type: posting.employment_type,
    salary_min: posting.salary_min,
    salary_max: posting.salary_max,
    posted_at: posting.published_at || now,
    last_seen_at: now,
    link_status: "ok",          // it's our own page; no link check needed
    link_checked_at: now,
  };

  // Same precomputed eligibility blob the ingest path writes, so employer
  // postings go through the identical eligibility check as everything else
  // rather than falling back to the slow description-reading path.
  try {
    row.elig_signals = { ...extractEligibilitySignals({ ...row, eligibility_region: null }), v: SIGNALS_VERSION };
  } catch {
    row.elig_signals = null;
  }

  if (existingJobId) {
    const { data, error } = await supabase
      .from("jobs").update(row).eq("id", existingJobId).select("id").maybeSingle();
    if (!error && data) return data.id;
    // Fall through to insert: the row was pruned or deleted under us.
  }

  const { data, error } = await supabase
    .from("jobs").upsert(row, { onConflict: "apply_url" }).select("id").single();
  if (error) throw error;
  return data.id;
}

// One LLM pass, mirroring what the candidate side already does for cv-match,
// so both sides of the marketplace are reading the same kind of assessment.
async function scoreSubmission(supabase, submission, posting, cvText) {
  if (!(await isLLMHealthy())) return;

  const prompt = `Score how well this CV matches the role. Judge only on evidence present in the CV. Do not reward confident writing, and do not penalise a CV for being plainly formatted.

Return JSON: { "score": 0-100, "reason": "one sentence, max 25 words, naming the single strongest and single weakest point" }

ROLE: ${posting.title}
${posting.description ? posting.description.slice(0, 4000) : ""}

CV:
${cvText.slice(0, 8000)}`;

  const out = await generateJSON(prompt, { maxTokens: 200 });
  const score = Number(out?.score);
  if (!Number.isFinite(score)) return;

  await supabase
    .from("posting_submissions")
    .update({
      match_score: Math.max(0, Math.min(100, Math.round(score))),
      match_reason: typeof out.reason === "string" ? out.reason.slice(0, 300) : null,
    })
    .eq("id", submission.id);
}

// A stable, non-reversible-looking handle for an anonymous candidate card.
// Not a security boundary — the real protection is that identity columns are
// never selected — but it gives the employer something to refer to
// ("candidate 7f3a") without ever showing a name.
function shortRef(uuid = "") {
  return String(uuid).replace(/-/g, "").slice(0, 4);
}

function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function normaliseCountries(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((c) => String(c || "").trim().toLowerCase()).filter(Boolean))].slice(0, 40);
}

// Cheap lexical overlap between claimed skills and the posting text. This is
// a SORT KEY, not a judgement — the LLM score does the judging at submit
// time, and proactive matches have no submission to score.
function overlap(skills, posting) {
  if (!Array.isArray(skills) || !skills.length) return 0;
  const hay = `${posting.title} ${posting.description || ""}`.toLowerCase();
  let n = 0;
  for (const s of skills) {
    const k = String(s || "").toLowerCase().trim();
    if (k.length > 2 && hay.includes(k)) n++;
  }
  return n;
}
