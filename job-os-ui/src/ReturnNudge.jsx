/**
 * ReturnNudge.jsx — "did you apply?", asked once, well.
 *
 * lib/applyIntent records the moment someone leaves for an employer's site.
 * This asks what happened when they come back, and turns a guess into a
 * fact. It is the second half of migration 014.
 *
 * MOUNTED AT THE APP SHELL, not inside a view, because the return can land
 * on any tab and the question belongs to the session rather than to a screen.
 *
 * THE RULES THAT KEEP THIS FROM BECOMING NAGWARE — all four are load-bearing:
 *
 *   1. DWELL GATE. Back inside 15 seconds means they didn't apply; they
 *      bounced off a dead link or changed their mind at the door. Don't ask.
 *      (We do record the fast bounce — it is a decent signal that a posting
 *      is gone, which is exactly what the link checker wants to know.)
 *
 *   2. TWO ASKS, EVER. nudge_count is checked before anything renders. After
 *      two unanswered asks this application goes quiet permanently. An
 *      unanswered question that keeps coming back costs more trust than the
 *      row is worth.
 *
 *   3. A GAP BETWEEN ASKS. Six hours minimum, so tabbing in and out of the
 *      app doesn't burn the budget in a minute.
 *
 *   4. NON-BLOCKING. It's a bar, not a modal. Dismissing is one click and
 *      does not count as an answer — it just ends the conversation for now.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./lib/supabaseClient";
import { track } from "./lib/track";
import { resolveApplyIntent, markNudged } from "./lib/applyIntent";

const DWELL_MIN_MS   = 15 * 1000;            // faster than this = didn't apply
const INTENT_MAX_AGE = 14 * 24 * 3600 * 1000; // after a fortnight, don't bother
const REASK_GAP_MS   = 6 * 3600 * 1000;       // minimum time between two asks
const MAX_NUDGES     = 2;
// Throttle for INCIDENTAL focus events only. A real return from an employer's
// site is never throttled — see the comment on check().
const CHECK_THROTTLE_MS = 60 * 1000;
// How long the page must have been hidden/blurred to count as "they actually
// went somewhere" rather than a file picker or a flick to another window.
const REAL_TRIP_MS = 5 * 1000;

// Same vocabulary as the "this job isn't actually open to me" report in
// Copilot — one shared set of reasons means one comparable dataset, and this
// is the higher-intent version of that same signal.
const ABANDON_REASONS = [
  ["expired",    "Posting was gone"],
  ["location",   "Not open to my country"],
  ["visa",       "Needed sponsorship"],
  ["experience", "Wrong experience level"],
  ["salary",     "Pay didn't work"],
  ["broken",     "Application form was broken"],
  ["other",      "Changed my mind"],
];

export default function ReturnNudge({ user, showToast }) {
  const [app, setApp]       = useState(null);   // the application being asked about
  const [asking, setAsking] = useState(false);  // showing the reason chips
  const [busy, setBusy]     = useState(false);
  const dismissed = useRef(new Set());          // ids silenced for this session
  const bounced   = useRef(new Set());          // fast-bounces already logged
  const lastCheck = useRef(0);                  // throttle — see check()
  // When the page was last hidden. null (not 0) means "hasn't left", so the
  // sentinel can never collide with a real timestamp.
  const awaySince = useRef(null);

  /**
   * check({ force })
   *
   * THROTTLING, AND WHY IT MUST NOT APPLY TO A RETURN. focus and
   * visibilitychange fire on every alt-tab and every dismissed file picker, so
   * incidental ones are rate-limited to one lookup a minute.
   *
   * A return from the employer's site is NOT incidental — it is the entire
   * reason this component exists — so it passes force and skips the throttle.
   * An earlier version threw the throttle across everything, on the reasoning
   * that "an apply intent is minutes old at the earliest". That was wrong: the
   * intent is written the instant the user clicks out, and people come back in
   * well under a minute. The mount check consumed the budget and the real
   * return was then silently dropped, so the nudge never appeared at all.
   */
  const check = useCallback(async ({ force = false } = {}) => {
    if (!user?.id || !supabase) return;

    const now = Date.now();
    if (!force && now - lastCheck.current < CHECK_THROTTLE_MS) return;
    lastCheck.current = now;

    const { data, error } = await supabase
      .from("applications")
      .select("id, job_id, job_title, company, apply_url, applied_at, apply_clicked_at, nudge_count, nudged_at")
      .is("apply_outcome", null)
      .not("apply_clicked_at", "is", null)
      .lt("nudge_count", MAX_NUDGES)
      .order("apply_clicked_at", { ascending: false })
      .limit(5);
    if (error || !data?.length) return;

    for (const a of data) {
      if (dismissed.current.has(a.id)) continue;
      const clicked = new Date(a.apply_clicked_at).getTime();
      const away = now - clicked;

      if (away > INTENT_MAX_AGE) continue;

      // Rule 1 — too quick to have applied. Log it once as a liveness hint
      // and leave the intent open; a later visit will ask properly.
      if (away < DWELL_MIN_MS) {
        if (!bounced.current.has(a.id)) {
          bounced.current.add(a.id);
          track(user, "apply_fast_return", { job_id: a.job_id, company: a.company, ms: away });
        }
        continue;
      }

      // Rule 3 — respect the gap since the last ask.
      if (a.nudged_at && now - new Date(a.nudged_at).getTime() < REASK_GAP_MS) continue;

      setApp(a);
      setAsking(false);
      markNudged(a);
      track(user, "apply_nudge_shown", { job_id: a.job_id, ask: (a.nudge_count || 0) + 1 });
      return;
    }
  }, [user]);

  useEffect(() => {
    // App.jsx only mounts this for a signed-in user, and check() no-ops
    // without one, so there is no signed-out branch to handle here.
    // Note when the page goes away, so coming back can be told apart from an
    // incidental focus event.
    const leave = () => { awaySince.current = Date.now(); };

    // Coming back. If the page was genuinely away — which is what happens when
    // someone opens an employer's apply page — this is the moment the whole
    // component exists for, so it bypasses the throttle.
    const returned = () => {
      const away = awaySince.current === null ? 0 : Date.now() - awaySince.current;
      awaySince.current = null;
      check({ force: away >= REAL_TRIP_MS });
    };

    const onVis = () =>
      document.visibilityState === "hidden" ? leave() : returned();

    window.addEventListener("blur", leave);
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", onVis);
    // Cold return: they closed the tab and came back later. Deferred out of
    // the effect body so the first paint isn't waiting on a query.
    const t = setTimeout(() => check({ force: true }), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", returned);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [check]);

  if (!app) return null;

  const where = app.company || app.job_title || "that role";

  async function answer(outcome, reason = null) {
    setBusy(true);
    const { error } = await resolveApplyIntent(app, outcome, reason);
    setBusy(false);
    if (error) { showToast?.(`Couldn't save that: ${error.message}`); return; }

    track(user, "apply_nudge_answered", { job_id: app.job_id, outcome, reason });
    dismissed.current.add(app.id);
    setApp(null);

    // The reply is the payoff, not a thank-you — say what we'll now do.
    // Each line names where the card actually went. They are worth keeping in
    // step with the status map in resolveApplyIntent — the previous "Kept in
    // Saved" was said while the card stayed under Applied, which teaches
    // people not to trust the toast.
    if (outcome === "applied") {
      showToast?.("Tracked. I'll flag it in Briefing if there's no reply by day 7.");
    } else if (outcome === "not_yet") {
      showToast?.("Moved back to Saved — it'll resurface in your Briefing.");
    } else if (reason === "broken") {
      showToast?.("Back in Saved so you can retry — and noted, that helps.");
    } else {
      showToast?.("Moved to Closed. That feedback tunes what reaches you.");
    }
  }

  function dismiss() {
    // Not an answer. Ends it for this session only; the two-ask budget still
    // governs whether it ever comes back.
    dismissed.current.add(app.id);
    track(user, "apply_nudge_dismissed", { job_id: app.job_id });
    setApp(null);
  }

  return (
    <div className="nudge" role="dialog" aria-live="polite" aria-label="Confirm your application">
      {!asking ? (
        <>
          <div className="nudge-body">
            <div className="nudge-q">Did you apply to {where}?</div>
            <div className="nudge-sub">
              {app.job_title ? `${app.job_title} · ` : ""}One tap and it's tracked in your Pipeline.
            </div>
          </div>
          <div className="nudge-acts">
            {/* Three answers with three different outcomes, so each label has
                to carry its consequence. "Not yet" and "Didn't apply" read as
                near-synonyms while doing opposite things — one keeps the job,
                the other closes it. */}
            <button className="btn primary" onClick={() => answer("applied")} disabled={busy}>Yes, applied</button>
            <button className="btn" onClick={() => answer("not_yet")} disabled={busy}>Not yet — keep it</button>
            <button className="btn subtle" onClick={() => setAsking(true)} disabled={busy}>Not applying</button>
          </div>
          <button className="nudge-x" onClick={dismiss} aria-label="Dismiss">✕</button>
        </>
      ) : (
        <>
          <div className="nudge-body">
            <div className="nudge-q">What stopped you?</div>
            <div className="nudge-sub">
              This is the signal that keeps roles you can't apply to out of your results.
              The job moves to Closed — except a broken form, which goes back to Saved so you can retry.
            </div>
          </div>
          <div className="nudge-reasons">
            {ABANDON_REASONS.map(([key, label]) => (
              <button key={key} className="prompt-chip" onClick={() => answer("abandoned", key)} disabled={busy}>
                {label}
              </button>
            ))}
          </div>
          <button className="nudge-x" onClick={() => setAsking(false)} aria-label="Back">✕</button>
        </>
      )}
    </div>
  );
}
