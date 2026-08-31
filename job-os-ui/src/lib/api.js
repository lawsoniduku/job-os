/**
 * lib/api.js — backend calls with WEAK-NETWORK + COLD-START RESILIENCE.
 *
 * Two realities this file absorbs so users never have to:
 *   1. Render free tier sleeps after ~15 min idle; the first request can
 *      take 30-50s or drop entirely. We fire a warm-up ping the moment
 *      the app loads, and retry failed calls with backoff.
 *   2. Our users are on variable mobile networks. Every call has a
 *      timeout (no infinite hangs) and up to 2 retries on network errors.
 *      HTTP errors are never retried — those are real answers.
 */
export const API = import.meta.env.VITE_API_URL || "http://localhost:3000";

/* ── Resilient fetch core ─────────────────────────────────── */
async function call(path, { method = "GET", body, timeoutMs = 30000, attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new HttpError(data.error || `Request failed (${res.status})`, res.status);
      return data;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HttpError) throw err;      // real answer — don't retry
      lastErr = err;
      if (i < attempts - 1) {
        // backoff: 1.5s then 4s — enough for a wobbly connection to recover
        await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 4000));
      }
    }
  }
  throw new Error(
    "Can't reach the server — check your connection. If it just woke up, try once more."
  );
}
class HttpError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

/* ── Warm-up: wake Render the moment the app opens ────────── */
// Fire-and-forget; also re-ping when the tab regains focus after idling.
export function warmUp() {
  fetch(`${API}/health`).catch(() => {});
}
if (typeof window !== "undefined") {
  warmUp();
  let last = Date.now();
  window.addEventListener("focus", () => {
    if (Date.now() - last > 5 * 60 * 1000) warmUp();   // idle > 5 min -> re-warm
    last = Date.now();
  });
}

/* ── Endpoints ─────────────────────────────────────────────── */
export function aiSearch({ q, country, limit = 10, offset = 0 }) {
  const p = new URLSearchParams({ q, limit, offset });
  if (country) p.set("country", country);
  // generous timeout: cold start + search can legitimately take a while
  return call(`/ai/search?${p}`, { timeoutMs: 60000 });
}

export function aiRefine({ refinement, activeIntent }) {
  return call(`/ai/refine`, { method: "POST", body: { refinement, activeIntent }, timeoutMs: 45000 });
}

export function aiClarify({ q, hasCountry = false }) {
  return call(`/ai/clarify`, { method: "POST", body: { q, hasCountry }, timeoutMs: 20000 });
}

export function aiChat({ message, history = [], context = {} }) {
  return call(`/ai/chat`, { method: "POST", body: { message, history, context }, timeoutMs: 60000 });
}

export function aiCvRewrite({ cvText, jobId }) {
  // the big structured call — one attempt can take up to ~90s on Groq
  return call(`/ai/cv-rewrite`, { method: "POST", body: { cvText, jobId }, timeoutMs: 120000, attempts: 2 });
}

export function aiCvExtract({ cvText }) {
  // Runs in the background right after a CV upload, so it must never be the
  // reason an upload appears to fail: callers treat a rejection as "no
  // extraction this time", not as an error worth showing.
  return call(`/ai/cv-extract`, { method: "POST", body: { cvText }, timeoutMs: 75000, attempts: 2 });
}

export function aiCvMatch({ cvText, jobId }) {
  return call(`/ai/cv-match`, { method: "POST", body: { cvText, jobId }, timeoutMs: 90000, attempts: 2 });
}

export function aiInterviewCoach({ jobId, cvText, mode = "questions" }) {
  return call(`/ai/interview-coach`, { method: "POST", body: { jobId, cvText, mode }, timeoutMs: 90000, attempts: 2 });
}

/* ── Shared helpers (unchanged) ────────────────────────────── */
export function verdictOf(job) {
  const c = job?.eligibility?.confidence;
  if (c === "possible") return { key: "conditional", label: "Conditional" };
  return { key: "eligible", label: "Eligible" };
}

export function fmtSalary(min, max) {
  if (!min && !max) return null;
  const f = (n) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);
  if (min && max) return `${f(min)}–${f(max)}`;
  return f(min || max);
}

export function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
