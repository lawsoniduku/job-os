/**
 * api/ats.js - job drafting and durable CV evidence scanning.
 * ===============================================
 *
 * Two jobs, kept out of employer.js so that file stays about routing and
 * authorisation:
 *
 *   draftJD()          plain language in, a posting out - or the few
 *                      questions we refuse to answer on the recruiter's
 *                      behalf
 *   runScoringQueue()  bulk CV evidence scanning, independent of model quotas
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
import { scanCriteria } from "../shared/hiringWorkflow.js";
import { createHash } from "node:crypto";
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
   CV EVIDENCE SCANNING
   ============================================================ */

// Scanning is local and evidence-based, so a provider outage cannot stall CV
// review. A database lease is authoritative across restarts and API instances.
const queued = new Map();
let draining = null;
export async function scoreCandidate({ posting, cvText }) {
  const criteria = scanCriteria(cvText, posting.screening_criteria || []);
  const mentioned = criteria.filter(c=>c.status==='mentioned').length;
  const assessment = {
    v:1, method:'literal_cv_evidence', at:new Date().toISOString(), criteria,
    cv_hash:createHash('sha256').update(cvText || '').digest('hex'),
    criteria_hash:createHash('sha256').update(JSON.stringify(posting.screening_criteria || [])).digest('hex'),
    caveat:'Mentions are self-reported, not verified proficiency. Missing evidence needs human review.',
  };
  const contact={};
  const name=String(cvText || '').match(/^name:\s*([^\r\n]{2,120})$/im)?.[1]?.trim();
  const emails=[...new Set(String(cvText || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
  if(name)contact.applicant_name=name;
  if(emails.length===1)contact.applicant_email=emails[0];
  return {
    ...contact,
    assessment,
    match_score:criteria.length ? Math.round(100*mentioned/criteria.length) : null,
    match_reason:criteria.length ? `${mentioned} of ${criteria.length} screening criteria mentioned in the CV.` : 'Set screening criteria to compare CV evidence.',
    summary:criteria.length ? `${criteria.find(c=>c.evidence)?.evidence?.slice(0,250) || "No explicit criterion mentions found."} ${criteria.length-mentioned} criteria need a closer review.` : 'Ready for manual review. Add job-related criteria to scan this CV.',
  };
}
async function drainPosting(supabase, postingId) {
  for (let n=0;n<500;n++) {
    const {data:batch,error}=await supabase.rpc('claim_posting_scores',{p_posting:postingId});
    if(error)throw error;
    if(!batch?.length)return;
    const row=batch[0];
    // Read after claiming: changing criteria invalidates this lease, so an
    // old scan can never overwrite a result for the new requirements.
    const {data:posting,error:postingError}=await supabase.from('job_postings')
      .select('id,org_id,title,description,screening_criteria').eq('id',postingId).maybeSingle();
    if(postingError)throw postingError;
    if(!posting)return;
    try {
      const scored=await scoreCandidate({posting,cvText:row.cv_text || ''});
      const {error:saveError}=await supabase.from('posting_submissions').update({...scored,score_status:'done',scored_at:new Date().toISOString(),score_claim_token:null,score_claimed_at:null})
        .eq('id',row.id).eq('org_id',posting.org_id).eq('score_claim_token',row.claim_token);
      if(saveError)throw saveError;
    } catch(e) {
      console.error('[ats] scan failed:',e.code || e.message);
      const {error:failure}=await supabase.from('posting_submissions').update({score_status:'failed',score_claim_token:null,score_claimed_at:null})
        .eq('id',row.id).eq('org_id',posting.org_id).eq('score_claim_token',row.claim_token);
      if(failure)throw failure; // Leave the lease recoverable; never claim success.
    }
  }
}
export function runScoringQueue(supabase,postingId) {
  queued.set(postingId,supabase);
  if(!draining) {
    draining=(async()=>{
      while(queued.size) {
        const [id,db]=queued.entries().next().value;
        queued.delete(id);
        try {await drainPosting(db,id);} catch(e){console.error('[ats] queue:',e.code || e.message);}
      }
    })().finally(()=>{draining=null;});
  }
  return draining;
}
export function startScoringRecovery(supabase) {
  let active=false;
  const recover=async()=>{
    if(active)return;active=true;
    try {
      const cutoff=new Date(Date.now()-5*60000).toISOString();
      const {data,error}=await supabase.from('posting_submissions').select('posting_id')
        .or(`score_status.eq.pending,and(score_status.eq.scoring,score_claimed_at.lt.${cutoff}),and(score_status.eq.scoring,score_claimed_at.is.null)`)
        .order('created_at',{ascending:true}).limit(100);
      if(error)throw error;
      for(const id of new Set((data || []).map(s=>s.posting_id)))await runScoringQueue(supabase,id);
    }catch(e){console.error('[ats] recovery:',e.code || e.message);}finally{active=false;}
  };
  void recover();
  const timer=setInterval(recover,60000);timer.unref?.();
  return ()=>clearInterval(timer);
}

/* -- helpers ------------------------------------------------ */

function str(v) { return typeof v === "string" && v.trim() ? v.trim() : null; }
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

