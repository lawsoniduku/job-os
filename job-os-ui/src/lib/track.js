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
 *
 *   -- profile completeness (migration 013) --
 *   cv_uploaded           { via, type }
 *   cv_extracted          { skills, years }
 *   cv_extract_confirmed  { skills, edited }
 *   skills_edited         { skills, edited }
 *   eligibility_saved     { authorizations, sponsor, availability }
 *   profile_saved         { roles, seniority, country }
 *   profile_employer_ready{ pct }
 *   visibility_on/off     { pct }
 *
 *   -- apply capture (migration 014) --
 *   apply_clicked         { job_id, company, source }
 *   apply_fast_return     { job_id, company, ms }   -- likely dead posting
 *   apply_nudge_shown     { job_id, ask }
 *   apply_nudge_answered  { job_id, outcome, reason }
 *   apply_nudge_dismissed { job_id }
 *   apply_confirmed       { job_id, via }
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
