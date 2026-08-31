/**
 * EmployerInbox.jsx — the employer side, seen from the candidate's chair.
 *
 * WITHOUT THIS FILE THERE IS NO LOOP. An employer can post, screen, reject
 * with a reason and ask for an intro, and if none of it ever reaches the
 * person it is about, the whole thing is a CRM with extra steps. This is
 * the half that makes the feedback real.
 *
 * Two kinds of thing arrive here, and they are deliberately weighted
 * differently:
 *
 *   INTRO REQUESTS need an answer, and the answer is a consent decision —
 *   nothing about the candidate reaches the employer until they say yes.
 *   So they're rendered first, and they persist until answered.
 *
 *   FEEDBACK needs no answer. It is shown once, marked seen, and then lives
 *   in the Pipeline. It does not nag, because a rejection you're forced to
 *   dismiss twice is worse than one you're told once.
 *
 * Reads go straight to Supabase under the candidate's own RLS policies
 * (015 §6) rather than through the API, matching how the rest of the
 * candidate app already reads its own rows.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabaseClient";
import { REASON_LABELS } from "./lib/employerApi";

export default function EmployerInbox({ user, showToast }) {
  const [intros, setIntros] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());

  const load = useCallback(async () => {
    if (!supabase || !user) return;

    const [{ data: i }, { data: f }] = await Promise.all([
      supabase
        .from("intro_requests")
        .select("id, message, created_at, posting_id, org_id, status")
        .eq("candidate_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("candidate_feedback")
        .select("id, decision, reason_code, note, sent_at, seen_at, posting_id")
        .eq("candidate_id", user.id)
        .is("seen_at", null)
        .order("sent_at", { ascending: false })
        .limit(5),
    ]);

    setIntros(i || []);
    setFeedback(f || []);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function respond(intro, status) {
    const { error } = await supabase
      .from("intro_requests")
      .update({ status, responded_at: new Date().toISOString() })
      .eq("id", intro.id);

    if (error) { showToast?.("Couldn't save that — try again."); return; }

    showToast?.(
      status === "accepted"
        ? "Shared. They can now see your name and email."
        : "Declined. They can't ask you about this role again."
    );
    setIntros((prev) => prev.filter((x) => x.id !== intro.id));
  }

  async function markSeen(item) {
    setDismissed((prev) => new Set(prev).add(item.id));
    await supabase
      .from("candidate_feedback")
      .update({ seen_at: new Date().toISOString() })
      .eq("id", item.id);
  }

  const liveFeedback = feedback.filter((f) => !dismissed.has(f.id));
  if (!intros.length && !liveFeedback.length) return null;

  return (
    <div className="inbox-stack">
      {intros.map((intro) => (
        <div key={intro.id} className="inbox-card intro">
          <div className="inbox-eyebrow">An employer wants to talk to you</div>
          <p className="inbox-body">
            {intro.message
              ? <>“{intro.message}”</>
              : <>A company found your profile and asked to be introduced.</>}
          </p>
          {/* Says exactly what changes hands. Consent without a plain
              statement of what is being consented to isn't consent. */}
          <p className="inbox-fine">
            They currently see an anonymous profile. Accepting shares your name and
            email so they can contact you — nothing else, and nothing until you tap it.
          </p>
          <div className="inbox-actions">
            <button className="btn primary" onClick={() => respond(intro, "accepted")}>Share my details</button>
            <button className="btn" onClick={() => respond(intro, "declined")}>No thanks</button>
          </div>
        </div>
      ))}

      {liveFeedback.map((f) => (
        <div key={f.id} className={`inbox-card fb-${f.decision}`}>
          <div className="inbox-eyebrow">
            {f.decision === "rejected" ? "You heard back" : f.decision === "hired" ? "You got it" : "You're moving forward"}
          </div>
          <p className="inbox-body">
            {f.decision === "rejected"
              ? <>They're not moving forward — <b>{REASON_LABELS[f.reason_code] || "no reason given"}</b>.</>
              : f.decision === "hired"
              ? <>They've offered you the role.</>
              : <>They've moved you to the next stage.</>}
          </p>
          {f.note && <p className="inbox-note">“{f.note}”</p>}
          {f.decision === "rejected" && (
            <p className="inbox-fine">
              Most applications end in silence. This one didn't — that's the point of
              applying through here.
            </p>
          )}
          <div className="inbox-actions">
            <button className="btn" onClick={() => markSeen(f)}>Got it</button>
          </div>
        </div>
      ))}
    </div>
  );
}
