/**
 * lib/employerApi.js — authenticated calls to the employer API.
 * =============================================================
 *
 * Separate from lib/api.js for one reason that matters: every call in
 * api.js is anonymous, and every call in here MUST carry a bearer token.
 * Keeping them in one file would make "did I remember the token" a
 * per-function question, and the answer would eventually be no on the one
 * endpoint that returns other people's data.
 *
 * Inherits api.js's weak-network posture — timeout per attempt, retries on
 * network failure only, never on an HTTP status — because the employer side
 * runs on the same connections the candidate side does.
 */
import { supabase } from "./supabaseClient";
import { API } from "./api";

export class ApiError extends Error {
  constructor(msg, status, code) {
    super(msg);
    this.status = status;
    this.code = code;
  }
}

async function token() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

/**
 * One call. `retryOn401` exists because an access token can expire between
 * the page loading and the user clicking something: rather than bouncing
 * them to a sign-in screen, we ask supabase-js to refresh once and replay.
 * Only once — a genuine sign-out must not become an infinite loop.
 */
async function call(path, { method = "GET", body, timeoutMs = 30000, attempts = method === "GET" ? 3 : 1, retryOn401 = true } = {}) {
  const jwt = await token();
  if (!jwt) throw new ApiError("Sign in to continue.", 401, "no_session");

  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${jwt}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));

      if (res.status === 401 && data.code === "session_expired" && retryOn401) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed?.session) return call(path, { method, body, timeoutMs, attempts, retryOn401: false });
      }
      if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.code);
      return data;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ApiError) throw err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 4000));
    }
  }
  throw new Error("Can't reach the server — check your connection and try again.");
}

/* ── account ──────────────────────────────────────────────── */
export const getMe = () => call("/employer/me");
export const createOrg = (org) => call("/employer/orgs", { method: "POST", body: org });

/* ── post ─────────────────────────────────────────────────── */
export const parseJD = (text) =>
  call("/employer/postings/parse", { method: "POST", body: { text }, timeoutMs: 75000, attempts: 2 });
export const listPostings = () => call("/employer/postings");
export const getPosting = (id) => call(`/employer/postings/${id}`);
export const createPosting = (posting) => call("/employer/postings", { method: "POST", body: posting });
export const updatePosting = (id, patch) => call(`/employer/postings/${id}`, { method: "PATCH", body: patch });

/**
 * One turn of the drafting conversation. Stateless — the caller keeps the
 * brief and every answer so far and sends both back, so an abandoned draft
 * never leaves a half-built posting behind.
 *
 * Resolves to either { ready: false, questions, partial } or
 * { ready: true, jd }.
 */
export const draftPosting = ({ brief, answers }) =>
  call("/employer/postings/draft", { method: "POST", body: { brief, answers }, timeoutMs: 90000, attempts: 2 });

/* ── screen ───────────────────────────────────────────────── */
export async function listSubmissions(postingId) {
 const submissions=[];let after=null,result;
 for(let page=0;page<200;page++) {
  result=await call(`/employer/postings/${postingId}/submissions${after?'?after='+after:''}`);
  submissions.push(...result.submissions);after=result.next_cursor;
  if(!after)break;
  if(page===199)throw Error('Too many applicants to load. Narrow this role before continuing.');
 }
 return {...result,submissions,scoring:{total:submissions.length,outstanding:submissions.filter(s=>['pending','scoring'].includes(s.score_status)).length,failed:submissions.filter(s=>s.score_status==='failed').length}};
}

// The CV text for one applicant. Separate from the queue because the queue
// carries fifty summaries, not fifty documents.
export const getSubmissionCv = (id) => call(`/employer/submissions/${id}/cv`, { timeoutMs: 45000 });

/**
 * Bulk CV upload. Text is extracted in the BROWSER (lib/extractText.js) so
 * the API never handles a file and needs no document parser.
 *
 * Sent in chunks because fifty CVs is comfortably past what a request body
 * should carry on a mobile connection, and because a partial failure should
 * cost one chunk rather than the whole drop.
 */
export async function uploadCandidates(postingId,candidates,onProgress) {
 let added=0,skipped=0;const errors=[];
 for(let i=0;i<candidates.length;i++) {
  const c=candidates[i];
  try {
   const r=await call(`/employer/postings/${postingId}/candidates`,{method:'POST',body:{candidates:[{text:c.text,filename:c.filename}]},timeoutMs:60000});
   added+=r.added;skipped+=r.skipped;
   const row=r.candidates?.[0];
   if(row?.error)errors.push({filename:c.filename,error:row.error,file:c.file});
   if(row?.id&&c.file){try{await uploadOriginalCv(row.id,c.file);}catch(e){errors.push({filename:c.filename,error:'CV text saved; original upload failed: '+e.message,id:row.id,file:c.file});}}
  }catch(e){errors.push({filename:c.filename,error:'CV import failed: '+e.message,file:c.file});}
  onProgress?.(i+1,candidates.length);
 }
 return {added,skipped,errors};
}
export const getOriginalCv=id=>call(`/employer/submissions/${id}/document`);
export async function uploadOriginalCv(id,file,candidate=false) {
 const jwt=await token();if(!jwt)throw new ApiError('Sign in to continue.',401);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try {
  const r=await fetch(`${API}/${candidate?'candidate':'employer'}/submissions/${id}/document`,{method:'PUT',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/octet-stream','X-CV-Filename':encodeURIComponent(file.name)},body:file,signal:controller.signal});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw new ApiError(data.error || 'Could not store the original CV.',r.status);return data;
 }finally{clearTimeout(timer);}
}
export const setStage = (id, stage) => call(`/employer/submissions/${id}`, { method: "PATCH", body: { stage } });

/* ── feedback ─────────────────────────────────────────────── */
export const sendFeedback = ({ submission_ids, decision, reason_code, note, hold }) =>
  call("/employer/feedback", { method: "POST", body: { submission_ids, decision, reason_code, note, hold } });

/* ── match ────────────────────────────────────────────────── */
export const listMatches = (postingId) => call(`/employer/postings/${postingId}/matches`, { timeoutMs: 45000 });
export const requestIntro = ({ candidate_id, posting_id, message }) =>
  call("/employer/intros", { method: "POST", body: { candidate_id, posting_id, message } });
export const getIntroContact = (id) => call(`/employer/intros/${id}/contact`);

/* ── candidate-facing ─────────────────────────────────────── */
export const applyToPosting = (postingId, body = {}) =>
  call(`/postings/${postingId}/apply`, { method: "POST", body, timeoutMs: 60000, attempts: 2 });

/**
 * The public posting view. Unauthenticated on purpose — someone following
 * an apply link may not be signed in yet, and bouncing them to a sign-in
 * screen before they can read the job is how you lose the applicant.
 */
export async function getPublicPosting(id) {
  const jwt = await token();
  const res = await fetch(`${API}/postings/${id}`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || "Couldn't load this role.", res.status, data.code);
  return data;
}

/* ── labels ───────────────────────────────────────────────── */
// The candidate-facing wording for each reason code. Written as something a
// person would be willing to receive: specific, non-euphemistic, and never
// implying a judgement the employer didn't actually make.
export const REASON_LABELS = {
  experience_level: "Experience level didn't match what the role needs",
  missing_skill: "A required skill wasn't evidenced in the CV",
  location_eligibility: "They can't legally employ someone in your location",
  cv_presentation: "The CV undersold the experience behind it",
  role_filled: "The role was filled",
  role_closed: "They stopped hiring for this role",
  stronger_candidates: "Other applicants were a closer match",
};

// What the employer picks from. Shorter, written from their side of the
// conversation, and ordered so the two most useful codes come first.
export const REASON_OPTIONS = [
  { code: "missing_skill", label: "Missing a required skill" },
  { code: "experience_level", label: "Experience level" },
  { code: "cv_presentation", label: "CV undersold them" },
  { code: "location_eligibility", label: "Can't employ in their location" },
  { code: "stronger_candidates", label: "Stronger candidates" },
  { code: "role_filled", label: "Role filled" },
  { code: "role_closed", label: "Role closed" },
];

export const STAGE_LABELS = {
  new: "New",
  screening: "Screening",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const AVAILABILITY_LABELS = {
  immediately: "Immediately",
  "2_weeks": "2 weeks",
  "1_month": "1 month",
  "2_months": "2 months",
  "3_months_plus": "3+ months",
};


/* Private recruiter workspace. These routes never expose notes to candidates. */
export const getHiringOverview=()=>call('/employer/overview');
export const getHiringReview=id=>call(`/employer/submissions/${id}/review`);
export const saveHiringReview=(id,review)=>call(`/employer/submissions/${id}/review`,{method:'PATCH',body:review,attempts:1});
export const rescanApplicants=id=>call(`/employer/postings/${id}/rescan`,{method:'POST',attempts:1});

export const requestAiHiringReview=id=>call(`/employer/submissions/${id}/analyze`,{method:'POST',attempts:1,timeoutMs:60000});

export const getCandidateCommunications=id=>call(`/employer/submissions/${id}/communications`);
export const communicateCandidate=(id,body)=>call(`/employer/submissions/${id}/communicate`,{method:'POST',body,attempts:1});
export const retryCandidateEmail=id=>call(`/employer/messages/${id}/retry`,{method:'POST',attempts:1});

export const suggestRoleCriteria=({title,description})=>call('/employer/postings/criteria/suggest',{method:'POST',body:{title,description},timeoutMs:60000,attempts:1});
