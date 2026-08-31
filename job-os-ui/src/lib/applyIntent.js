/**
 * lib/applyIntent.js — record that someone left for an employer's site.
 *
 * THE LEAK THIS CLOSES. Four places open an apply URL (Copilot result card,
 * tailor modal, Pipeline card, Briefing row) and until now all four were a
 * plain link. A job only reached the pipeline if the user opened Tailor &
 * apply and then explicitly clicked Save or Mark as applied, so anyone who
 * applied the obvious way was invisible to us.
 *
 * The click is the signal. We record it immediately rather than waiting to
 * learn whether they actually applied — waiting throws away the one thing we
 * definitely observed. Confirmation comes later, from ReturnNudge.
 *
 * TWO THINGS THIS FILE IS CAREFUL ABOUT:
 *
 *  1. NEVER BLOCK THE NAVIGATION. Callers keep their native <a href> and
 *     call this from onClick without preventDefault; the Pipeline button
 *     calls window.open itself and then calls this. Either way the write is
 *     fire-and-forget. Awaiting a round-trip before opening a window is how
 *     you get eaten by a popup blocker — the browser only honours a
 *     window.open that happens inside the user's gesture.
 *
 *  2. NEVER DOWNGRADE A CARD. A user opening the posting again from a job
 *     already at "interview" must not have it reset to applied_intent. The
 *     status write is filtered to early-stage rows only, which also means a
 *     late-stage row never gets an apply_clicked_at and so never triggers a
 *     "did you apply?" nudge — we already know the answer.
 */
import { supabase } from "./supabaseClient";
import { track } from "./track";

// Stages where "they just clicked through to apply" is still news.
// Anything past this list has already told us more than the click would.
//
// Exported because it is also the correct guard for any OTHER explicit status
// move the user makes from the search UI: a deliberate action should be able
// to reposition a card that is still early, and must never drag a real
// application backwards. Keeping one list means the two can't disagree.
export const EARLY_STAGES = ["saved", "shortlist", "interested", "cv_tailored", "applied_intent"];

/**
 * recordApplyIntent({ user, job, source })
 *
 * job accepts either a search result or a Pipeline row — anything carrying
 * an id/job_id plus the snapshot fields. Returns nothing useful on purpose:
 * no caller should be waiting on it.
 */
export function recordApplyIntent({ user, job, source = "unknown" }) {
  if (!job) return;
  const jobId = job.id || job.job_id;

  // Guests are never tracked (track() no-ops without a user, and RLS would
  // reject the write anyway). They still get to apply — capturing the click
  // is not worth putting a sign-in wall in front of the core value.
  track(user, "apply_clicked", { job_id: jobId, company: job.company, source });
  if (!user?.id || !jobId || !supabase) return;

  const now = new Date().toISOString();

  (async () => {
    try {
      // 1. Insert if this job isn't in the pipeline yet. ignoreDuplicates
      //    means an existing row is left completely untouched here.
      await supabase.from("applications").upsert({
        user_id: user.id,
        job_id: jobId,
        job_title: job.title || job.job_title || null,
        company: job.company || null,
        location: job.location || null,
        apply_url: job.apply_url || null,
        salary_min: job.salary_min ?? null,
        salary_max: job.salary_max ?? null,
        source: job.source || null,
        role_cluster: job.role_cluster || null,
        verdict: job.verdict || null,
        verdict_reason: job.verdict_reason || job.eligibility?.reason || null,
        status: "applied_intent",
        apply_clicked_at: now,
      }, { onConflict: "user_id,job_id", ignoreDuplicates: true });

      // 2. Stamp the click on the row that's there now — but only if it is
      //    still early enough for the question to be worth asking. Clearing
      //    apply_outcome lets a genuine second attempt be asked about again;
      //    nudge_count deliberately survives, because the two-ask budget is
      //    per application for the life of the application.
      await supabase.from("applications")
        .update({ apply_clicked_at: now, status: "applied_intent", apply_outcome: null })
        .eq("user_id", user.id)
        .eq("job_id", jobId)
        .in("status", EARLY_STAGES);
    } catch {
      // Analytics and pipeline enrichment must never surface as an error to
      // someone who is, at this moment, applying for a job.
    }
  })();
}

/**
 * openApply({ user, job, source }) — for callers that have a button rather
 * than a link (Pipeline). Opens first, records second, for the popup-blocker
 * reason above.
 */
export function openApply({ user, job, source = "unknown" }) {
  const url = job?.apply_url;
  if (!url) return;
  window.open(url, "_blank", "noopener");
  recordApplyIntent({ user, job, source });
}

/* ── Resolving an intent ──────────────────────────────────────────────────
 * Called by ReturnNudge with the user's answer. Kept here so the status
 * mapping lives beside the code that created the intent in the first place.
 */
export async function resolveApplyIntent(app, outcome, reason = null) {
  if (!supabase || !app?.id) return { error: new Error("No application") };
  const now = new Date().toISOString();

  // The answer is recorded unconditionally. It is evidence, and it is true
  // regardless of where the card has since been dragged to.
  const { error } = await supabase.from("applications").update({
    apply_outcome: outcome,
    outcome_reason: reason,
    outcome_at: now,
  }).eq("id", app.id);
  if (error) return { error };

  // The status move is conditional: only a card still sitting at
  // applied_intent gets repositioned. If the user moved it themselves in the
  // meantime, their action beats our question.
  //
  // "not_yet" USED TO LEAVE THE CARD ALONE, on the reasoning that the
  // intention was still live. That was wrong on screen: applied_intent renders
  // in the Applied column, so answering "Not yet" left the job sitting under
  // Applied while the toast said "Kept in Saved". The card has to go where the
  // answer says it is.
  //
  // "broken" is carved out of abandoned for the same reason — a form that
  // failed is not a decision against the role, and closing it would bury a job
  // the user still wants. It goes back to Saved so they can retry.
  const move =
    outcome === "applied"   ? { status: "applied", applied_at: app.applied_at || now } :
    outcome === "not_yet"   ? { status: "saved" } :
    outcome === "abandoned" ? { status: reason === "broken" ? "saved" : "closed" } :
    null;

  if (move) {
    await supabase.from("applications")
      .update(move).eq("id", app.id).eq("status", "applied_intent");
  }
  return { error: null };
}

/** Bump the ask counter. Separate from resolve because we count asks, not answers. */
export async function markNudged(app) {
  if (!supabase || !app?.id) return;
  await supabase.from("applications")
    .update({ nudge_count: (app.nudge_count || 0) + 1, nudged_at: new Date().toISOString() })
    .eq("id", app.id);
}
