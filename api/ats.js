/**
 * api/ats.js - the AI half of the hiring console.
 * ===============================================
 *
 * Two jobs, kept out of employer.js so that file stays about routing and
 * authorisation:
 *
 *   draftJD()          plain language in, a posting out - or the few
 *                      questions we refuse to answer on the recruiter's
 *                      behalf
 *   runScoringQueue()  bulk CV ranking, paced to the free tier it actually
 *                      runs on
 *
 * THE RULE BOTH SHARE. This product's whole claim to candidates is that
 * what they read is true. A model that invents a salary band or decides on
 * a company's behalf which countries it can employ in breaks that claim in
 * the one place it is most expensive - and it breaks it invisibly, because
 * an invented salary looks exactly like a real one. So: extraction only,
 * and anything material that wasn't stated becomes a question, never a
 * guess.
 */
import { generateJSON, isLLMHealthy } from "../lib/llm.js";
import { classifyJob } from "./roleIntelligence.js";

/* ============================================================
   DRAFTING
   ============================================================ */

// The things we will not infer. Each has a reason it cannot be guessed:
// eligibility is a legal claim only the employer can make, salary is
// unknowable from a description, and both are what a candidate decides
// whether to spend an evening applying on.
const MUST_ASK = {
  eligible_countries: {
    id: "eligible_countries",
    question: "Which countries can you legally employ someone in?",
    why: "This is the filter that stops people applying for a job they could never be hired for. It's also the one thing no job board asks, and the reason candidates trust what they see here.",
    suggestions: ["Nigeria only", "Nigeria, Kenya, South Africa", "Anywhere we can engage a contractor", "Not sure yet"],
  },
  compensation: {
    id: "compensation",
    question: "What's the salary range?",
    why: "Postings without a range get materially fewer applications, and the ones they do get are worse matched.",
    suggestions: ["I'd rather not say", "Depends on experience"],
  },
};

/**
 * One turn of the drafting conversation.
 *
 * Returns either { ready: false, questions } or { ready: true, jd }. The
 * model proposes the role-specific questions, but the checklist above is
 * enforced in CODE - a prompt can be talked out of asking, a conditional
 * cannot.
 */
export async function draftJD({ brief, answers = {}, orgName }) {
  if (!(await isLLMHealthy())) {
    const err = new Error("AI is offline");
    err.code = "llm_offline";
    throw err;
  }

  const answered = Object.entries(answers)
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const prompt = `You are helping a recruiter turn a rough description into a job posting.

NEVER INVENT A FACT. A fact is anything a candidate could be misled by: salary, benefits, which countries the employer can hire in, a required number of years, team size, funding, tech they didn't mention. If the recruiter did not say it, leave it null or empty - not zero, not "competitive", not "remote".

DO WRITE THE PROSE. Turning "senior backend engineer, payments, Postgres at scale" into readable responsibilities for that role is the job, and is not invention - it follows from the role they described. Draft 3-5 "responsibilities" this way. Keep every one of them traceable to something they said.

"title" is REQUIRED and must always be filled. Take it from what they described ("senior backend engineer" -> "Senior Backend Engineer"). Write it as a candidate would search for it, in title case, with no company name and no internal jargon.

WHAT THEY SAID:
${brief}

${answered ? `THEIR ANSWERS TO OUR QUESTIONS:\n${answered}\n` : ""}
Return JSON:
{
  "title": string,
  "seniority": "junior"|"mid"|"senior"|"lead"|null,
  "location": string|null,
  "remote_type": "remote"|"hybrid"|"onsite"|null,
  "employment_type": "full_time"|"part_time"|"contract"|"internship"|null,
  "salary_min": number|null,
  "salary_max": number|null,
  "eligible_countries": string[],
  "must_have": string[],
  "nice_to_have": string[],
  "responsibilities": string[],
  "about_role": string,
  "missing": string[],
  "questions": [{ "id": string, "question": string, "why": string, "suggestions": string[] }]
}

"missing" lists the field names above that the recruiter has not supplied and that genuinely matter for this role.

"questions" are AT MOST 3 role-specific things worth asking - the ones where the answer would change who applies. Ask about substance (which of these skills is genuinely required vs nice to have; is this replacing someone or a new seat; who will they report to), not about formatting. Each needs 2-4 concrete suggested answers a busy person can click. Do not ask about salary or about hiring eligibility - those are handled separately. If nothing important is missing, return [].

"about_role" is 2-3 sentences a candidate would actually want to read. No filler, no "fast-paced environment", no "rockstar". ${orgName ? `The company is ${orgName}.` : ""}`;

  const out = await generateJSON(prompt, { maxTokens: 1400, timeoutMs: 60000 });
  if (!out) {
    const err = new Error("The model returned nothing usable");
    err.code = "unparseable";
    throw err;
  }

  // Normalise before deciding anything - the model is allowed to be sloppy
  // about shape, but the checks below are not allowed to be.
  const jd = {
    // The answer wins if the model still can't produce one: a recruiter who
    // has just typed the title should never be asked for it twice.
    title: str(out.title) || str(answers.title),
    seniority: pick(out.seniority, ["junior", "mid", "senior", "lead"]),
    location: str(out.location),
    remote_type: pick(out.remote_type, ["remote", "hybrid", "onsite"]),
    employment_type: pick(out.employment_type, ["full_time", "part_time", "contract", "internship"]),
    // Salary uses a POSITIVE-only parser. A model that means "not stated"
    // reaches for 0 surprisingly often, and 0 passing as a real number was
    // enough to skip the compensation question entirely and store a
    // posting advertising a salary of zero.
    salary_min: posNum(out.salary_min),
    salary_max: posNum(out.salary_max),
    eligible_countries: arr(out.eligible_countries).map((c) => c.toLowerCase()),
    must_have: arr(out.must_have),
    nice_to_have: arr(out.nice_to_have),
    responsibilities: arr(out.responsibilities),
    about_role: str(out.about_role) || "",
  };

  const questions = [];

  // A posting with no title is not a posting: it classifies as "Other" and
  // appears in no search. The prompt demands one, but a model that omits it
  // anyway must not produce a silently useless draft.
  if (!jd.title) {
    questions.push({
      id: "title",
      question: "What's the job title?",
      why: "It decides which searches this appears in, so it should read the way a candidate would search for it.",
      suggestions: [],
    });
  }

  // Enforced, not requested. If the recruiter has answered it, we take the
  // answer; if they have not, we ask - every time, whatever the model said.
  if (!jd.eligible_countries.length && !answers.eligible_countries) {
    questions.push(MUST_ASK.eligible_countries);
  }
  if (jd.salary_min == null && jd.salary_max == null && !answers.compensation) {
    questions.push(MUST_ASK.compensation);
  }

  // MODEL QUESTIONS ARE ASKED ONCE, ON THE FIRST TURN ONLY.
  //
  // This is a termination guarantee, not a preference. The model invents its
  // own question ids and they are not stable between calls: answering
  // "q1, q2, q3" produced "q_experience, q_tech_stack, q_oncall" on the very
  // next turn, so the already-answered check matched nothing and the flow
  // would have asked forever, each round with plausible new questions.
  //
  // Capping them to the first round means the conversation is at most:
  // describe -> answer -> draft. The enforced questions above keep their
  // stable ids and so are safe to re-check every turn.
  const firstTurn = Object.keys(answers).length === 0;
  if (firstTurn) {
    for (const q of arr(out.questions, "object").slice(0, 3)) {
      if (!q?.question) continue;
      const id = str(q.id) || `q${questions.length}`;
      if (id === "eligible_countries" || id === "compensation" || id === "title") continue;
      questions.push({
        id,
        question: str(q.question),
        why: str(q.why) || "",
        suggestions: arr(q.suggestions).slice(0, 4),
      });
    }
  }

  if (questions.length) return { ready: false, questions, partial: jd };

  const { role_cluster } = classifyJob(jd.title, [jd.about_role, ...jd.must_have, ...jd.responsibilities].join(" "));
  return { ready: true, jd: { ...jd, role_cluster, description: renderJD(jd) } };
}

/**
 * Turns the structured draft into the text a candidate reads.
 *
 * Assembled in code rather than asked for as prose, so every posting has
 * the same shape, sections only appear when there is something to put in
 * them, and nothing the model didn't extract can appear here at all.
 */
export function renderJD(jd) {
  const out = [];
  if (jd.about_role) out.push("ABOUT THE ROLE\n" + jd.about_role);
  if (jd.responsibilities?.length) out.push("WHAT YOU'LL DO\n" + jd.responsibilities.map((r) => `- ${r}`).join("\n"));
  if (jd.must_have?.length) out.push("WHAT WE NEED\n" + jd.must_have.map((r) => `- ${r}`).join("\n"));
  if (jd.nice_to_have?.length) out.push("NICE TO HAVE\n" + jd.nice_to_have.map((r) => `- ${r}`).join("\n"));

  const where = [];
  if (jd.location) where.push(jd.location);
  if (jd.remote_type) where.push(cap(jd.remote_type));
  if (jd.employment_type) where.push(jd.employment_type.replace("_", "-"));
  if (jd.eligible_countries?.length) {
    where.push(`We can employ people in: ${jd.eligible_countries.map(cap).join(", ")}`);
  }
  if (where.length) out.push("LOCATION AND ELIGIBILITY\n" + where.join("\n"));

  if (jd.salary_min || jd.salary_max) {
    const f = (n) => `$${Number(n).toLocaleString()}`;
    out.push("COMPENSATION\n" +
      (jd.salary_min && jd.salary_max ? `${f(jd.salary_min)} - ${f(jd.salary_max)} per year`
        : `From ${f(jd.salary_min || jd.salary_max)} per year`));
  }
  return out.join("\n\n");
}

/* ============================================================
   BULK SCORING
   ============================================================ */

// Matches ingest/infer_pending.js, which measured this against the same
// Groq free tier: concurrency 2 with ~1.2s spacing is what stopped it being
// rate-limited. Raising either is how thirty CVs become thirty failures.
const CONCURRENCY = Number(process.env.ATS_SCORE_CONCURRENCY || 2);
const PACE_MS = Number(process.env.ATS_SCORE_PACE_MS || 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One run per posting at a time. In-memory because this API runs as a
// single instance; if it is ever scaled out, this becomes a claim in
// Postgres instead (score_status='scoring' already carries the state).
const running = new Set();

/**
 * Scores one CV against one posting, and writes the short description the
 * recruiter reads instead of opening the file.
 */
export async function scoreCandidate({ posting, cvText }) {
  const prompt = `Assess this CV against the role. Judge only on evidence in the CV. Do not reward confident writing, and do not penalise a plainly formatted CV.

Return JSON:
{
  "score": 0-100,
  "reason": "one sentence, max 25 words, naming the single strongest and single weakest point",
  "summary": "2 sentences a recruiter can read instead of the CV: what this person has actually done, and what they are missing for THIS role",
  "name": string|null,
  "email": string|null,
  "years": number|null,
  "skills": string[]
}

"name" and "email" only if the CV states them. Never guess a name from an email address.
"skills" are only skills the CV evidences, max 12.

ROLE: ${posting.title}
${posting.description ? posting.description.slice(0, 4000) : ""}

CV:
${cvText.slice(0, 9000)}`;

  const out = await generateJSON(prompt, { maxTokens: 400, timeoutMs: 45000 });
  if (!out) return null;

  const score = Number(out.score);
  return {
    match_score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    match_reason: str(out.reason)?.slice(0, 300) || null,
    summary: str(out.summary)?.slice(0, 700) || null,
    applicant_name: str(out.name)?.slice(0, 120) || null,
    applicant_email: str(out.email)?.slice(0, 200) || null,
    cv_years: num(out.years),
    cv_skills: arr(out.skills).slice(0, 12),
  };
}

/**
 * Drains every pending submission on a posting, paced.
 *
 * Fire-and-forget by design: the upload responds the moment the rows exist,
 * because a recruiter who dropped thirty CVs should see thirty rows
 * immediately, not a spinner for two minutes. score_status is what the UI
 * reads to show progress, and a row that fails ends as 'failed' rather than
 * sitting at 'pending' forever pretending it is about to happen.
 */
export async function runScoringQueue(supabase, postingId) {
  if (running.has(postingId)) return;
  running.add(postingId);

  try {
    const { data: posting } = await supabase
      .from("job_postings").select("id, title, description").eq("id", postingId).maybeSingle();
    if (!posting) return;

    for (;;) {
      const { data: batch } = await supabase
        .from("posting_submissions")
        .select("id, cv_text")
        .eq("posting_id", postingId)
        .eq("score_status", "pending")
        .order("created_at", { ascending: true })
        .limit(CONCURRENCY);

      if (!batch?.length) break;

      // Claim before working so a second run can't double-score them.
      await supabase
        .from("posting_submissions")
        .update({ score_status: "scoring" })
        .in("id", batch.map((b) => b.id));

      if (!(await isLLMHealthy())) {
        // Put them back rather than burning the batch: the model being
        // down is temporary, and a 'failed' row invites a recruiter to
        // conclude the CV was unreadable.
        await supabase.from("posting_submissions")
          .update({ score_status: "pending" }).in("id", batch.map((b) => b.id));
        break;
      }

      await Promise.all(batch.map(async (row) => {
        try {
          const scored = row.cv_text ? await scoreCandidate({ posting, cvText: row.cv_text }) : null;
          await supabase.from("posting_submissions").update(
            scored
              ? { ...stripEmpty(scored), score_status: "done", scored_at: new Date().toISOString() }
              : { score_status: "failed", scored_at: new Date().toISOString() }
          ).eq("id", row.id);
        } catch (e) {
          console.error(`[ats] score ${row.id}: ${e.message}`);
          await supabase.from("posting_submissions")
            .update({ score_status: "failed", scored_at: new Date().toISOString() }).eq("id", row.id);
        }
      }));

      await sleep(PACE_MS);
    }
  } catch (e) {
    console.error(`[ats] scoring queue ${postingId}: ${e.message}`);
  } finally {
    running.delete(postingId);
  }
}

/* -- helpers ------------------------------------------------ */

// Never overwrite a real value with a null the model happened to omit.
// A CV that stated a name on upload should not lose it on a rescore.
function stripEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
}

function str(v) { return typeof v === "string" && v.trim() ? v.trim() : null; }
function num(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
// For values where zero is not a value but a way of saying "I don't know".
function posNum(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function pick(v, allowed) { return allowed.includes(v) ? v : null; }
function arr(v, kind = "string") {
  if (!Array.isArray(v)) return [];
  return kind === "object"
    ? v.filter((x) => x && typeof x === "object")
    : v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
