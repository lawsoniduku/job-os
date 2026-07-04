/**
 * lib/track.js — privacy-respecting product analytics.
 *
 * Fire-and-forget events into our own Supabase (no third-party vendor,
 * no cookies, nothing leaves our infrastructure). Signed-out users are
 * not tracked at all.
 *
 * Usage:  track(user, "search", { query, total, excluded })
 *
 * Event names in use (keep this list current):
 *   search            { query, cluster, total, excluded }
 *   refine            { refinement, type, total }
 *   clarify_asked     { query }
 *   shortlist         { job_id, company }
 *   tailor_opened     { job_id, company }
 *   tailor_generated  { job_id }
 *   marked_applied    { job_id, company }
 *   thread_cleared    {}
 *   pipeline_advance  { from, to }
 */
import { supabase } from "./supabaseClient";

export function track(user, name, props = {}) {
  if (!user?.id || !supabase) return;           // guests: never tracked
  // Fire and forget — analytics must never block or break the product.
  supabase
    .from("events")
    .insert({ user_id: user.id, name, props })
    .then(({ error }) => {
      if (error && import.meta.env.DEV) console.warn("track:", error.message);
    });
}
