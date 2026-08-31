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
async function call(path, { method = "GET", body, timeoutMs = 30000, attempts = 3, retryOn401 = true } = {}) {
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

/* ── screen ───────────────────────────────────────────────── */
export const listSubmissions = (postingId) => call(`/employer/postings/${postingId}/submissions`);
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
