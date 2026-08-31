/**
 * views/Pipeline.jsx — every application, saved to closed.
 *
 * The DB accepts the full lifecycle (migration 006); the UI maps those
 * statuses into 5 clear columns:
 *   Saved       <- saved | shortlist | interested | cv_tailored
 *   Applied     <- applied
 *   In process  <- assessment | interview | in_process
 *   Offer       <- offer
 *   Closed      <- rejected | archived | closed
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { aiInterviewCoach, fmtSalary, daysSince } from "../lib/api";
import { track } from "../lib/track";
import { openApply, resolveApplyIntent } from "../lib/applyIntent";
import { REASON_LABELS } from "../lib/employerApi";

const COLS = [
  { key: "saved",      label: "Saved",      statuses: ["saved", "shortlist", "interested", "cv_tailored"] },
  // applied_intent sits here rather than in a column of its own: an
  // unconfirmed application is a STATE of an application, not a stage of a
  // search. The card renders as unconfirmed and asks in place.
  { key: "applied",    label: "Applied",    statuses: ["applied", "applied_intent"] },
  { key: "in_process", label: "In process", statuses: ["assessment", "interview", "in_process"] },
  { key: "offer",      label: "Offer",      statuses: ["offer"] },
  { key: "closed",     label: "Closed",     statuses: ["rejected", "archived", "closed"] },
];
// Advancing moves a card to the canonical status of the next column.
const NEXT = { saved: "applied", applied: "in_process", in_process: "offer" };

function colOf(status) {
  return COLS.find((c) => c.statuses.includes(status))?.key || "saved";
}

export default function Pipeline({ shared, active }) {
  const { user, requireAuth, showToast, setView } = shared;
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [prepApp, setPrepApp] = useState(null);
  // application_id -> the employer's answer, for applications made to a
  // posting inside JobCopilot. EmployerInbox shows a rejection ONCE, as a
  // notification; this is where it stays reachable afterwards. Told-once
  // and then gone would be a strange way to treat the one thing this
  // product promises candidates they'll get.
  const [answers, setAnswers] = useState({});

  const load = useCallback(async () => {
    if (!user) { setApps([]); setAnswers({}); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .order("updated_at", { ascending: false });
    if (!error) setApps(data || []);

    // Feedback keys on submission, and submission is what knows the
    // application it came from — so it takes both reads to get from "this
    // card" to "what they said". Two small queries over the user's own
    // rows; neither is on the critical path for rendering the board.
    const [{ data: subs }, { data: fb }] = await Promise.all([
      supabase.from("posting_submissions").select("id, application_id, stage"),
      supabase.from("candidate_feedback").select("submission_id, decision, reason_code, note, sent_at"),
    ]);
    const bySubmission = {};
    for (const f of fb || []) bySubmission[f.submission_id] = f;
    const next = {};
    for (const s of subs || []) {
      if (s.application_id && bySubmission[s.id]) next[s.application_id] = { ...bySubmission[s.id], stage: s.stage };
    }
    setAnswers(next);

    setLoading(false);
  }, [user]);

  useEffect(() => { if (active) load(); }, [active, load]);

  async function advance(app) {
    const next = NEXT[colOf(app.status)];
    if (!next) return;
    const patch = { status: next };
    if (next === "applied" && !app.applied_at) patch.applied_at = new Date().toISOString();
    const { error } = await supabase.from("applications").update(patch).eq("id", app.id);
    if (error) return showToast(`Couldn't move it: ${error.message}`);
    track(user, "pipeline_advance", { from: colOf(app.status), to: next });
    showToast(next === "offer" ? "Moved to Offer 🎉" : `Moved to ${COLS.find((c) => c.key === colOf(next)).label}`);
    load();
  }

  // In-place answer to the same question ReturnNudge asks. A user scanning
  // their board is the other natural moment to confirm, so the card carries
  // the control rather than making them wait to be asked.
  async function confirmApplied(app) {
    const { error } = await resolveApplyIntent(app, "applied");
    if (error) return showToast(`Couldn't confirm: ${error.message}`);
    track(user, "apply_confirmed", { job_id: app.job_id, via: "pipeline_card" });
    showToast("Confirmed — follow-up reminders start from today");
    load();
  }

  async function closeApp(app) {
    const { error } = await supabase.from("applications").update({ status: "closed" }).eq("id", app.id);
    if (!error) { showToast("Moved to Closed"); load(); }
  }

  async function remove(app) {
    const { error } = await supabase.from("applications").delete().eq("id", app.id);
    if (!error) { showToast("Removed"); load(); }
  }

  if (!user) {
    return (
      <div className="scrollarea"><div className="page">
        <div className="page-eyebrow">Applications</div>
        <h1>Pipeline</h1>
        <p className="sub">Track every application from saved to offer — each card keeps the job snapshot, dates, and the CV version you sent, even after the posting expires.</p>
        <button className="btn primary" onClick={requireAuth}>Sign in or create account</button>
      </div></div>
    );
  }

  return (
    <div className="scrollarea"><div className="page wide">
      <div className="page-eyebrow">Applications</div>
      <h1>Pipeline</h1>
      <p className="sub">
        Everything in flight. Cards keep their job snapshot even after the posting expires.
        {loading ? " Loading…" : ""}
      </p>

      {apps.length === 0 && !loading && (
        <div className="studio-card">
          <h3>Nothing in flight yet</h3>
          <div className="s-sub">Open any job in Copilot with Tailor & apply — "Save for later" or "Mark as applied" lands it here.</div>
          <button className="btn primary" onClick={() => setView("copilot")}>Find eligible jobs</button>
        </div>
      )}

      {apps.length > 0 && (
        <div className="board">
          {COLS.map((col) => {
            const cards = apps.filter((a) => colOf(a.status) === col.key);
            return (
              <div className="col" key={col.key}>
                <div className="col-head">{col.label}<span className="ccount">{cards.length}</span></div>
                {cards.length === 0 && col.key === "offer" && (
                  <div className="col-empty">No offers yet — everything to the left is pushing toward this column.</div>
                )}
                {cards.map((app) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    answer={answers[app.id]}
                    user={user}
                    onAdvance={advance}
                    onClose={closeApp}
                    onRemove={remove}
                    onPrep={setPrepApp}
                    onConfirm={confirmApplied}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {prepApp && <PrepModal app={prepApp} onClose={() => setPrepApp(null)} />}
    </div></div>
  );
}

function AppCard({ app, answer, user, onAdvance, onClose, onRemove, onPrep, onConfirm }) {
  const col = colOf(app.status);
  const days = daysSince(app.applied_at || app.created_at);
  const sal = fmtSalary(app.salary_min, app.salary_max);
  // Prep is available on ANY card that still links to a live job record —
  // users prepare before applying too, not only once "in process".
  const canPrep = !!app.job_id;
  // We saw them click through but they've never told us what happened.
  const unconfirmed = app.status === "applied_intent" && !app.apply_outcome;
  const clickedDays = daysSince(app.apply_clicked_at);

  return (
    <div className={`p-card ${unconfirmed ? "unconfirmed" : ""}`}>
      <div className="pc-title">{app.job_title}</div>
      <div className="pc-co">{app.company || "—"}</div>
      <div className="pc-meta">
        {unconfirmed ? `Opened ${clickedDays === 0 ? "today" : `${clickedDays}d ago`}` :
         col === "applied" && days !== null ? `Applied · day ${Math.max(days, 0) + 1}` :
         col === "saved" ? `Saved ${days === 0 ? "today" : `${days}d ago`}` :
         `Updated ${daysSince(app.updated_at) === 0 ? "today" : `${daysSince(app.updated_at)}d ago`}`}
        {sal ? ` · ${sal}` : ""}
      </div>
      {unconfirmed && (
        <div className="pc-confirm">
          <span className="pc-unconf">Did you apply?</span>
          <button onClick={() => onConfirm(app)}>Yes, I applied</button>
        </div>
      )}
      {/* Only ever present on applications made to a posting inside
          JobCopilot — which is the whole argument for applying here rather
          than clicking through to a careers page. */}
      {answer?.sent_at && (
        <div className={`pc-answer a-${answer.decision}`}>
          <span className="pc-answer-k">
            {answer.decision === "rejected" ? "They said no"
              : answer.decision === "hired" ? "You got the role"
              : "Moving forward"}
          </span>
          {answer.decision === "rejected" && answer.reason_code && (
            <span className="pc-answer-v">{REASON_LABELS[answer.reason_code]}</span>
          )}
          {answer.note && <span className="pc-answer-note">“{answer.note}”</span>}
        </div>
      )}
      {app.cv_label && <div className="pc-cv">{app.cv_label}</div>}
      <div className="pc-actions">
        {NEXT[col] && <button onClick={() => onAdvance(app)}>Advance →</button>}
        {canPrep && <button onClick={() => onPrep(app)}>Prep interview</button>}
        {app.apply_url && (
          <button onClick={() => openApply({ user, job: app, source: "pipeline_card" })}>Open ↗</button>
        )}
        {col !== "closed" ? (
          <button className="danger" onClick={() => onClose(app)}>Close</button>
        ) : (
          <button className="danger" onClick={() => onRemove(app)}>Remove</button>
        )}
      </div>
    </div>
  );
}

/* Interview prep — unlocks when an application is In process. */
function PrepModal({ app, onClose }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      // Send the saved CV. This call never passed one, so the endpoint's
      // "aim at the seam between CV and JD" half was dead and every question
      // came back generic. The CV is already on file; not sending it was
      // simply an omission.
      let cvText = "";
      try {
        const { data } = await supabase.from("saved_cvs").select("cv_text").maybeSingle();
        cvText = data?.cv_text || "";
      } catch { /* prep still works without it, just less sharply */ }
      try {
        const res = await aiInterviewCoach({ jobId: app.job_id, cvText, mode: "questions" });
        if (live) setResult(res.result);
      } catch (err) {
        if (live) setError(err.message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [app.job_id]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Interview prep — {app.job_title} at {app.company}</h3>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {loading && <div className="thinking"><span /><span /><span /></div>}
          {error && <div style={{ color: "var(--ineligible)", fontSize: 13 }}>{error}</div>}
          {result && (
            <>
              <label className="field-label">Likely questions for this specific role</label>
              {(result.likely_questions || []).map((q, i) => (
                <div className="qa-item" key={i}>
                  <div className="qa-cat">{q.category}</div>
                  <div className="qa-q">{q.question}</div>
                  {(q.tip || q.tips) && <div className="qa-tip">{q.tip || q.tips}</div>}
                </div>
              ))}
              {result.questions_to_ask_them?.length > 0 && (
                <>
                  <label className="field-label" style={{ marginTop: 16 }}>Smart questions to ask them</label>
                  {result.questions_to_ask_them.map((q, i) => (
                    <div className="qa-item" key={i}><div className="qa-q">{q}</div></div>
                  ))}
                </>
              )}
              {result.star_reminder && <div className="s-sub" style={{ marginTop: 14 }}>{result.star_reminder}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
