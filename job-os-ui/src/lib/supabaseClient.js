/**
 * lib/supabaseClient.js
 * =====================
 * Frontend Supabase client with WEAK-NETWORK RESILIENCE.
 *
 * Every Supabase request now goes through a retrying fetch:
 *   - 20s timeout per attempt (flaky connections hang forever by default)
 *   - up to 2 retries with backoff (1s, 3s) on network failures ONLY
 *   - HTTP errors (4xx/5xx) are NOT retried — those are real answers
 *
 * This directly targets our market reality: variable mobile connections.
 * A dropped packet becomes a 1-second hiccup instead of a dead feature.
 *
 * Env (job-os-ui/.env):
 *   VITE_SUPABASE_URL=https://your-project.supabase.co
 *   VITE_SUPABASE_ANON_KEY=your-anon-key
 */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function resilientFetch(input, init = {}, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(input, { ...init, signal: init.signal || controller.signal });
      clearTimeout(timer);
      return res;                       // any HTTP status is a real answer — return it
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, i === 0 ? 1000 : 3000));
      }
    }
  }
  throw lastErr;
}

export const supabase = (url && anonKey)
  ? createClient(url, anonKey, { global: { fetch: resilientFetch } })
  : null;

export const authEnabled = !!supabase;
