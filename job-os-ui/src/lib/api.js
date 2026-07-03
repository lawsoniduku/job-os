/**
 * lib/api.js — one place for every backend call.
 */
export const API = import.meta.env.VITE_API_URL || "http://localhost:3000";

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function aiSearch({ q, country, limit = 10, offset = 0 }) {
  const p = new URLSearchParams({ q, limit, offset });
  if (country) p.set("country", country);
  return fetch(`${API}/ai/search?${p}`).then(handle);
}

export function aiChat({ message, history = [], context = {} }) {
  return fetch(`${API}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, context }),
  }).then(handle);
}

export function aiCvRewrite({ cvText, jobId }) {
  return fetch(`${API}/ai/cv-rewrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cvText, jobId }),
  }).then(handle);
}

export function aiCvMatch({ cvText, jobId }) {
  return fetch(`${API}/ai/cv-match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cvText, jobId }),
  }).then(handle);
}

export function aiInterviewCoach({ jobId, cvText, mode = "questions" }) {
  return fetch(`${API}/ai/interview-coach`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, cvText, mode }),
  }).then(handle);
}

/**
 * Map the engine's eligibility confidence to a UI verdict.
 *   certain / likely -> eligible (green)
 *   possible         -> conditional (amber)
 * ('excluded' rows never reach the client — the server filters them.)
 */
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
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d;
}
