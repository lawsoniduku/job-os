/**
 * ingest/test_employer_loop.js
 * ============================
 * Drives the whole employer loop against a RUNNING API, over real HTTP,
 * with real JWTs:
 *
 *   employer signs up -> creates an org -> posts a role -> publishes it
 *   -> the role appears in `jobs` where candidate search can find it
 *   -> a candidate opens the public posting page -> applies
 *   -> the applicant lands in the employer's queue
 *   -> the employer rejects with a reason
 *   -> the CANDIDATE can read that reason under their own RLS policy
 *
 * WHY OVER HTTP RATHER THAN BY CALLING THE FUNCTIONS. The thing most worth
 * proving is not that the SQL is right — verify_employer.js covers that —
 * but that the AUTHORISATION holds: that a request carrying candidate A's
 * token cannot read employer B's applicants. That only means something if
 * the token actually travels through the middleware, so every call below
 * goes through fetch with an Authorization header, exactly as the browser
 * would send it.
 *
 * PREREQUISITES:
 *   - the API running on API_URL (default http://localhost:3000)
 *   - 015a/b/c applied (run ingest/verify_employer.js first)
 *
 * USAGE:
 *   node --env-file=.env ingest/test_employer_loop.js
 *
 * CREATES AND DELETES two throwaway auth users, an org, a posting, a jobs
 * row, an application and a submission. Cleanup runs in a finally block and
 * reports anything it could not remove, so a failed run never leaves you
 * guessing what's still in the database.
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

dotenv.config();

const API = process.env.API_URL || "http://localhost:3000";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anonKey = fs.readFileSync("job-os-ui/.env", "utf8").match(/VITE_SUPABASE_ANON_KEY=(\S+)/)?.[1];

const stamp = Date.now();
const EMPLOYER = { email: `probe.employer.${stamp}@jobcopilot.test`, password: `Probe!${stamp}aA` };
const CANDIDATE = { email: `probe.candidate.${stamp}@jobcopilot.test`, password: `Probe!${stamp}bB` };

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`   PASS  ${m}`); };
const no = (m) => { fail++; console.log(`   FAIL  ${m}`); };

async function call(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Creates a confirmed user and returns a signed-in access token. Confirmed
// on purpose: this exercises the API, not Supabase's email delivery.
async function makeUser({ email, password }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser: ${error.message}`);
  const client = createClient(process.env.SUPABASE_URL, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sess, error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  return { id: data.user.id, token: sess.session.access_token, client };
}

const created = { users: [], orgId: null, jobIds: [] };

async function run() {
  console.log(`\nEMPLOYER LOOP — end to end against ${API}\n`);

  const health = await call("/health");
  if (health.status !== 200) {
    console.log(`   API not reachable at ${API}. Start it first.\n`);
    process.exit(1);
  }

  console.log("setup");
  const employer = await makeUser(EMPLOYER);
  created.users.push(employer.id);
  ok(`employer signed in (${employer.id.slice(0, 8)})`);

  const candidate = await makeUser(CANDIDATE);
  created.users.push(candidate.id);
  ok(`candidate signed in (${candidate.id.slice(0, 8)})`);

  // The candidate needs a CV on file — applying reads it rather than asking
  // for it again, which is the whole point of applying from inside the app.
  await admin.from("saved_cvs").upsert({
    user_id: candidate.id,
    cv_text: "Ada Probe. Backend engineer, 6 years. Python, Django, PostgreSQL, Redis, Docker. Built and shipped a payments ledger at scale. Based in Lagos, Nigeria.",
    filename: "probe-cv.pdf",
  });
  await admin.from("profiles").update({
    country: "nigeria", cv_skills: ["python", "django", "postgresql"], cv_years: 6, availability: "2_weeks",
  }).eq("id", candidate.id);
  ok("candidate has a CV and a profile");

  /* ── the employer has no org yet ─────────────────────────── */
  console.log("\naccount");
  const before = await call("/employer/postings", { token: employer.token });
  before.status === 403 && before.data.code === "no_org"
    ? ok("an account with no org is refused with no_org, not a 500")
    : no(`expected 403/no_org before setup, got ${before.status} ${JSON.stringify(before.data).slice(0, 80)}`);

  const orgRes = await call("/employer/orgs", {
    token: employer.token, method: "POST",
    body: { name: `Probe Labs ${stamp}`, country: "nigeria", size: "11-50" },
  });
  if (orgRes.status !== 201) { no(`create org: ${orgRes.status} ${JSON.stringify(orgRes.data)}`); return; }
  created.orgId = orgRes.data.org.id;
  ok("org created, creator is owner");

  orgRes.data.org.verified_at === null
    ? ok("a brand-new org is NOT verified")
    : no("a new org came back verified — verification must be a human step");

  /* ── drafting (016) ──────────────────────────────────────── */
  console.log("\ndrafting");
  const BRIEF = "We need a senior backend engineer for our payments team in Lagos. Remote is fine. They must have run Postgres at scale and ideally have fintech experience.";

  const turn1 = await call("/employer/postings/draft", {
    token: employer.token, method: "POST", body: { brief: BRIEF },
  });
  turn1.data?.ready === false
    ? ok("plain language comes back with questions, not a finished posting")
    : no(`first turn returned ready=${turn1.data?.ready} (${turn1.status})`);

  const qIds = (turn1.data?.questions || []).map((q) => q.id);
  qIds.includes("eligible_countries")
    ? ok("it always asks which countries you can employ in")
    : no(`eligibility was not asked - it would have been guessed. asked: ${qIds.join(", ")}`);
  qIds.includes("compensation")
    ? ok("it always asks for salary rather than inventing one")
    : no(`salary was not asked. asked: ${qIds.join(", ")}`);

  const answers = {};
  for (const q of turn1.data.questions) {
    answers[q.id] = q.id === "eligible_countries" ? "Nigeria, Kenya"
      : q.id === "compensation" ? "60000 to 90000 USD"
      : (q.suggestions?.[0] || "Yes");
  }

  const turn2 = await call("/employer/postings/draft", {
    token: employer.token, method: "POST", body: { brief: BRIEF, answers },
  });
  // The termination guarantee: answering once must produce a draft, never
  // a fresh set of questions. This regressed once and would have looped.
  turn2.data?.ready === true
    ? ok("answering the questions produces a draft - the flow terminates")
    : no(`SECOND TURN ASKED AGAIN: ${JSON.stringify(turn2.data?.questions?.map((q) => q.id))}`);

  const draft = turn2.data?.jd || {};
  draft.title
    ? ok(`drafted a title: "${draft.title}"`)
    : no("no title - the posting would classify as Other and appear in no search");
  draft.role_cluster && draft.role_cluster !== "Other"
    ? ok(`classified as '${draft.role_cluster}'`)
    : no(`classified as '${draft.role_cluster}' - it would surface in no relevant search`);
  draft.salary_min > 0
    ? ok(`salary read from the answer (${draft.salary_min}-${draft.salary_max})`)
    : no(`salary came back as ${draft.salary_min}-${draft.salary_max}`);
  (draft.eligible_countries || []).includes("nigeria")
    ? ok("eligibility taken from the answer, not invented")
    : no(`eligible_countries = ${JSON.stringify(draft.eligible_countries)}`);
  draft.description?.includes("WHAT YOU'LL DO")
    ? ok("responsibilities were drafted, not left blank")
    : no("the posting has no responsibilities section");
  !/competitive|fast-paced|rockstar|ninja/i.test(draft.description || "")
    ? ok("no filler language in the drafted posting")
    : no("the draft contains filler the prompt forbids");

  /* ── post ────────────────────────────────────────────────── */
  console.log("\npost");
  const postRes = await call("/employer/postings", {
    token: employer.token, method: "POST",
    body: {
      title: "Senior Backend Engineer",
      description: "We need someone strong in Python and PostgreSQL to own our payments ledger.",
      location: "Lagos / Remote", remote_type: "remote", employment_type: "full_time",
      seniority: "senior", salary_min: 60000, salary_max: 90000,
      eligible_countries: ["nigeria", "kenya"],
    },
  });
  if (postRes.status !== 201) { no(`create posting: ${postRes.status} ${JSON.stringify(postRes.data)}`); return; }
  const postingId = postRes.data.posting.id;

  postRes.data.posting.status === "draft"
    ? ok("a new posting starts as a draft, not live")
    : no(`new posting had status '${postRes.data.posting.status}'`);

  postRes.data.posting.role_cluster
    ? ok(`classified server-side as '${postRes.data.posting.role_cluster}'`)
    : no("posting got no role_cluster — it would appear in no search");

  // A draft must not be reachable by a candidate.
  const draftPublic = await call(`/postings/${postingId}`);
  draftPublic.status === 404
    ? ok("a draft is not visible on the public posting page")
    : no(`a draft returned ${draftPublic.status} to the public — drafts must not leak`);

  const pub = await call(`/employer/postings/${postingId}`, {
    token: employer.token, method: "PATCH", body: { status: "open" },
  });
  if (pub.status !== 200) { no(`publish: ${pub.status} ${JSON.stringify(pub.data)}`); return; }
  const jobId = pub.data.posting.job_id;
  if (jobId) created.jobIds.push(jobId);

  jobId ? ok("publishing mirrored the posting into `jobs`")
        : no("published, but no jobs row was created — it is in no search");

  if (jobId) {
    const { data: job } = await admin.from("jobs").select("*").eq("id", jobId).maybeSingle();
    job?.source === "employer"
      ? ok("the jobs row is tagged source='employer' (prune skips it)")
      : no(`jobs row has source='${job?.source}' — prune_stale would delete it`);
    job?.apply_url?.includes(`/apply/${postingId}`)
      ? ok(`apply_url points at the in-app page (${job.apply_url})`)
      : no(`apply_url is '${job?.apply_url}' — applicants would land nowhere`);
    job?.last_seen_at
      ? ok("last_seen_at stamped so the freshness gate shows it")
      : no("last_seen_at is null — search hides it immediately");
  }

  /* ── apply ───────────────────────────────────────────────── */
  console.log("\napply");
  const publicView = await call(`/postings/${postingId}`, { token: candidate.token });
  publicView.status === 200
    ? ok("an open posting is readable by a candidate")
    : no(`public posting view returned ${publicView.status}`);
  publicView.data?.posting?.verified_employer === false
    ? ok("shown as an unverified employer, honestly")
    : no("posting claimed a verified employer without a human having verified it");

  const applyRes = await call(`/postings/${postingId}/apply`, { token: candidate.token, method: "POST" });
  applyRes.status === 201
    ? ok("candidate applied")
    : no(`apply returned ${applyRes.status} ${JSON.stringify(applyRes.data).slice(0, 100)}`);

  const { data: app } = await admin.from("applications")
    .select("*").eq("user_id", candidate.id).maybeSingle();
  app?.status === "applied" && app?.apply_outcome === "applied"
    ? ok("it landed on the candidate's own board as a confirmed apply")
    : no(`application status='${app?.status}' outcome='${app?.apply_outcome}' — expected applied/applied`);

  /* ── screen ──────────────────────────────────────────────── */
  console.log("\nscreen");
  const queue = await call(`/employer/postings/${postingId}/submissions`, { token: employer.token });
  const subs = queue.data?.submissions || [];
  subs.length === 1
    ? ok("the applicant is in the employer's queue")
    : no(`queue has ${subs.length} applicants, expected 1`);

  const sub = subs[0];
  if (sub) {
    sub.candidate_ref && !sub.candidate_id
      ? ok("the queue shows an anonymous ref, not the candidate's identity")
      : no("the queue exposed candidate_id at the 'new' stage");
    sub.country === "nigeria" && sub.availability === "2_weeks"
      ? ok("profile snapshotted at submit time (country, availability)")
      : no(`snapshot wrong: country='${sub.country}' availability='${sub.availability}'`);
    // The CV travelled with the application, but is fetched separately -
    // the queue carries summaries, not documents (016). Asserting on
    // sub.cv_text here is what this check used to do, and it started
    // failing the moment that became true.
    const applicantCv = await call(`/employer/submissions/${sub.id}/cv`, { token: employer.token });
    applicantCv.data?.cv_text?.includes("Ada Probe")
      ? ok("the CV travelled with the application and is fetchable")
      : no(`no CV behind the submission - nothing to screen (${applicantCv.status})`);
  }

  // The authorisation check that matters most.
  const stranger = await call(`/employer/postings/${postingId}/submissions`, { token: candidate.token });
  stranger.status === 403
    ? ok("a candidate's token CANNOT read the employer's applicant queue")
    : no(`SECURITY: candidate token got ${stranger.status} on the employer queue`);

  const noToken = await call(`/employer/postings/${postingId}/submissions`);
  noToken.status === 401
    ? ok("an unauthenticated request cannot read the queue")
    : no(`SECURITY: anonymous request got ${noToken.status} on the employer queue`);

  /* ── bulk upload + ranking (016) ─────────────────────────── */
  console.log("\nbulk upload");
  const CVS = [
    { filename: "strong.pdf", text: "Tomi Adeyemi. Senior Backend Engineer, 8 years. Python, Django, PostgreSQL at scale, Redis, Kafka, Docker, Kubernetes. Led the payments ledger rewrite at a Lagos fintech processing 2M transactions daily. Owned Postgres partitioning and query tuning. Mentored four engineers. Lagos, Nigeria. tomi@example.test" },
    { filename: "weak.pdf", text: "Chidi Okonkwo. Graphic designer, 4 years. Adobe Photoshop, Illustrator, InDesign, Figma. Brand identity work for small retail clients. Built social campaigns and print collateral. Certificate in visual communication. Abuja, Nigeria." },
    { filename: "middling.pdf", text: "Ama Mensah. Backend developer, 3 years. Node.js, Express, MongoDB, some PostgreSQL. Built REST APIs for an e-commerce platform. Familiar with Docker. Interested in moving into fintech. Accra, Ghana." },
  ];

  const up = await call(`/employer/postings/${postingId}/candidates`, {
    token: employer.token, method: "POST", body: { candidates: CVS },
  });
  up.status === 201 && up.data.added === 3
    ? ok("3 CVs uploaded")
    : no(`upload returned ${up.status} ${JSON.stringify(up.data).slice(0, 120)}`);

  // The same batch again must not create six candidates.
  const dupe = await call(`/employer/postings/${postingId}/candidates`, {
    token: employer.token, method: "POST", body: { candidates: CVS },
  });
  (dupe.status === 400 || dupe.data.added === 0)
    ? ok("re-uploading the same CVs adds nobody")
    : no(`duplicate upload added ${dupe.data.added} — the same person would appear twice`);

  // Scoring is paced and asynchronous. Poll rather than assume, with a
  // ceiling so a stuck queue fails the test instead of hanging it.
  let queueState = null;
  for (let i = 0; i < 40; i++) {
    const q = await call(`/employer/postings/${postingId}/submissions`, { token: employer.token });
    queueState = q.data;
    if (!queueState?.scoring?.outstanding) break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  queueState?.scoring?.outstanding === 0
    ? ok(`ranking finished for all ${queueState.scoring.total}`)
    : no(`${queueState?.scoring?.outstanding} still unranked after 2 minutes`);

  const uploads = (queueState?.submissions || []).filter((s) => s.source === "upload");
  uploads.length === 3
    ? ok("uploaded CVs sit in the same queue as platform applicants")
    : no(`expected 3 uploads in the queue, found ${uploads.length}`);

  const scored = uploads.filter((s) => s.match_score != null);
  scored.length === 3
    ? ok("all three were scored")
    : no(`${scored.length} of 3 scored — the rest: ${uploads.map((u) => u.score_status).join(", ")}`);

  const withSummary = uploads.filter((s) => s.summary);
  withSummary.length === 3
    ? ok("each has a short summary to read instead of the CV")
    : no(`${withSummary.length} of 3 have a summary`);

  // The ranking has to be RIGHT, not merely present. A backend engineer
  // with Postgres at scale must outrank a graphic designer for a backend
  // role, or the feature is decoration.
  const byFile = Object.fromEntries(uploads.map((u) => [u.cv_filename, u]));
  const strong = byFile["strong.pdf"]?.match_score;
  const weak = byFile["weak.pdf"]?.match_score;
  const mid = byFile["middling.pdf"]?.match_score;
  console.log(`         scores: strong=${strong} middling=${mid} weak=${weak}`);
  strong > weak
    ? ok(`the matching engineer outranks the graphic designer (${strong} vs ${weak})`)
    : no(`RANKING IS WRONG: designer ${weak} >= engineer ${strong}`);
  strong > mid
    ? ok(`the senior outranks the junior (${strong} vs ${mid})`)
    : no(`ranking questionable: junior ${mid} >= senior ${strong}`);

  // Names are read from the CV, because the recruiter already has them.
  byFile["strong.pdf"]?.candidate_ref?.includes("Tomi")
    ? ok("an uploaded CV shows the name, not an anonymous ref")
    : no(`uploaded card showed '${byFile["strong.pdf"]?.candidate_ref}' instead of the name`);

  // ...but the CV text is no longer shipped with the list.
  byFile["strong.pdf"]?.cv_text === undefined
    ? ok("the queue no longer ships full CV text for every applicant")
    : no("the queue is still shipping full CVs — that's megabytes on a mobile connection");

  const cvOne = await call(`/employer/submissions/${byFile["strong.pdf"].id}/cv`, { token: employer.token });
  cvOne.data?.cv_text?.includes("Tomi Adeyemi")
    ? ok("the CV is fetchable on demand")
    : no(`fetching one CV returned ${cvOne.status}`);

  /* ── feedback ────────────────────────────────────────────── */
  console.log("\nfeedback");
  const reasonless = await call("/employer/feedback", {
    token: employer.token, method: "POST",
    body: { submission_ids: [sub.id], decision: "rejected" },
  });
  reasonless.status === 400
    ? ok("a rejection with no reason is refused by the API")
    : no(`reasonless rejection returned ${reasonless.status} — the core promise is unenforced`);

  // A MIXED batch - one platform applicant and one uploaded CV - which is
  // the realistic case and the one where it would be easy to lie about how
  // many people were notified.
  const uploadToReject = byFile["weak.pdf"];
  const fb = await call("/employer/feedback", {
    token: employer.token, method: "POST",
    body: {
      submission_ids: [sub.id, uploadToReject.id],
      decision: "rejected", reason_code: "missing_skill",
      note: "Strong on Python; we needed Kafka in production.",
    },
  });
  fb.status === 201 && fb.data.sent === 1
    ? ok("only the person with an account was notified")
    : no(`feedback returned ${fb.status} sent=${fb.data?.sent} (expected 1)`);
  fb.data?.uncontactable === 1
    ? ok("the uploaded CV is reported as uncontactable rather than counted as notified")
    : no(`uncontactable=${fb.data?.uncontactable}, expected 1 - the UI would overstate who was told`);
  fb.data?.moved === 2
    ? ok("both moved to rejected in the recruiter's queue")
    : no(`moved=${fb.data?.moved}, expected 2 - the queue would be out of date`);

  const { data: fbRows } = await admin.from("candidate_feedback").select("candidate_id");
  (fbRows || []).every((f) => f.candidate_id)
    ? ok("no feedback row was written for an accountless candidate")
    : no("a feedback row exists with no candidate to deliver it to");

  /* ── the candidate actually hears back ───────────────────── */
  console.log("\nthe loop closes");
  const { data: heard, error: heardErr } = await candidate.client
    .from("candidate_feedback").select("decision, reason_code, note, sent_at");
  if (heardErr) no(`candidate could not read their feedback: ${heardErr.message}`);
  else if (heard?.length === 1 && heard[0].reason_code === "missing_skill") {
    ok("the candidate can read the rejection AND the reason, under their own RLS");
    heard[0].note?.includes("Kafka")
      ? ok("the employer's note reached them too")
      : no("the note did not reach the candidate");
  } else {
    no(`candidate sees ${heard?.length ?? 0} feedback rows — the loop does not close`);
  }

  // And cannot read anyone else's.
  const { data: others } = await candidate.client.from("posting_submissions").select("*");
  (others || []).every((r) => r.candidate_id === candidate.id)
    ? ok("the candidate sees only their own submission")
    : no("SECURITY: the candidate can read another person's submission");
}

async function cleanup() {
  console.log("\ncleanup");
  const problems = [];
  try {
    if (created.orgId) {
      // Cascades take postings, submissions, feedback and intros with it.
      const { error } = await admin.from("employer_orgs").delete().eq("id", created.orgId);
      if (error) problems.push(`org ${created.orgId}: ${error.message}`);
    }
    for (const j of created.jobIds) {
      const { error } = await admin.from("jobs").delete().eq("id", j);
      if (error) problems.push(`jobs ${j}: ${error.message}`);
    }
    for (const u of created.users) {
      const { error } = await admin.auth.admin.deleteUser(u);
      if (error) problems.push(`user ${u}: ${error.message}`);
    }
  } catch (e) {
    problems.push(e.message);
  }
  problems.length
    ? console.log(`   LEFT BEHIND — remove by hand:\n     ${problems.join("\n     ")}`)
    : console.log("   probe org, jobs row and both users removed");
}

try {
  await run();
} catch (e) {
  no(`threw: ${e.message}`);
} finally {
  await cleanup();
  console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
