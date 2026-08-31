/**
 * employer/ScreenQueue.jsx — the applicant queue, and the feedback that
 * leaves it.
 *
 * TWO THINGS THIS SCREEN IS OPTIMISED FOR, in this order:
 *
 *   1. Deciding fast. One applicant is focused at a time, j/k moves, a
 *      advances, r rejects. A queue that needs a mouse round-trip per
 *      person is a queue that gets abandoned at applicant nine.
 *
 *   2. Never letting a decision leave without a reason attached. Rejecting
 *      opens the reason picker rather than completing silently — the API
 *      refuses a reasonless rejection anyway (015 §4), and a UI that lets
 *      you try and then errors is a worse version of the same rule.
 *
 * Bulk exists because the honest unit of work at the end of a round is
 * "these eleven, same reason", and a feedback tool that can't express that
 * gets replaced by silence.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  listSubmissions, sendFeedback,
  REASON_OPTIONS, REASON_LABELS, STAGE_LABELS, AVAILABILITY_LABELS,
} from "../lib/employerApi";

export default function ScreenQueue({ postingId, showToast, onChanged }) {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [focus, setFocus] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [rejecting, setRejecting] = useState(null);   // { ids: [...] }
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter] = useState("open");
  const listRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listSubmissions(postingId);
      setSubs(r.submissions || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [postingId]);

  useEffect(() => { load(); }, [load]);

  // Focus and selection reset when the filter changes, done here rather
  // than in an effect on [filter] — an effect would fire a second render
  // every time, and the reset is genuinely part of the click, not a
  // reaction to it. Switching POSTING resets the same state via the key
  // this component is mounted with; see EmployerApp.
  function changeFilter(next) {
    setFilter(next);
    setFocus(0);
    setSelected(new Set());
  }

  const visible = subs.filter((s) =>
    filter === "all" ? true
    : filter === "open" ? !["rejected", "hired", "withdrawn"].includes(s.stage)
    : s.stage === filter
  );

  /* ── keyboard ────────────────────────────────────────────── */
  useEffect(() => {
    function onKey(e) {
      if (rejecting) return;
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!visible.length) return;

      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocus((i) => Math.min(i + 1, visible.length - 1)); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocus((i) => Math.max(i - 1, 0)); }
      else if (e.key === "a") { e.preventDefault(); advance([visible[focus].id]); }
      else if (e.key === "r") { e.preventDefault(); setRejecting({ ids: [visible[focus].id] }); }
      else if (e.key === "x") { e.preventDefault(); toggleSelect(visible[focus].id); }
      else if (e.key === "Enter") { e.preventDefault(); setExpanded((x) => (x === visible[focus].id ? null : visible[focus].id)); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${focus}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function advance(ids) {
    try {
      await sendFeedback({ submission_ids: ids, decision: "advanced" });
      showToast(ids.length === 1 ? "Advanced — they've been told." : `${ids.length} advanced and notified.`);
      setSelected(new Set());
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e.message);
    }
  }

  async function reject({ ids, reason_code, note }) {
    try {
      const r = await sendFeedback({ submission_ids: ids, decision: "rejected", reason_code, note });
      showToast(`${r.sent} ${r.sent === 1 ? "person has" : "people have"} been told, with a reason.`);
      setRejecting(null);
      setSelected(new Set());
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e.message);
    }
  }

  if (loading) return <div className="emp-loading">Loading applicants…</div>;
  if (error) return <div className="emp-error">{error} <button className="btn" onClick={load}>Retry</button></div>;

  if (!subs.length) {
    return (
      <div className="emp-empty">
        <h2>No applicants yet</h2>
        <p>
          When someone applies, they arrive here already scored against this role and
          already checked for whether you can employ them where they are.
        </p>
      </div>
    );
  }

  const unanswered = subs.filter((s) => !s.feedback).length;

  return (
    <div className="emp-queue">
      <div className="emp-queue-bar">
        <div className="emp-filters">
          {[["open", "Open"], ["new", "New"], ["shortlisted", "Shortlisted"], ["rejected", "Rejected"], ["all", "All"]].map(([v, l]) => (
            <button key={v} className={`filter-pill ${filter === v ? "active" : ""}`} onClick={() => changeFilter(v)}>{l}</button>
          ))}
        </div>
        <div className="emp-queue-hint">
          <kbd>j</kbd><kbd>k</kbd> move · <kbd>a</kbd> advance · <kbd>r</kbd> reject · <kbd>x</kbd> select · <kbd>↵</kbd> CV
        </div>
      </div>

      {unanswered > 0 && (
        <div className="emp-nudge">
          <strong>{unanswered}</strong> {unanswered === 1 ? "person is" : "people are"} still waiting to hear from you.
        </div>
      )}

      {selected.size > 0 && (
        <div className="emp-bulk">
          <span>{selected.size} selected</span>
          <button className="btn" onClick={() => advance([...selected])}>Advance all</button>
          <button className="btn danger" onClick={() => setRejecting({ ids: [...selected] })}>Reject all with a reason</button>
          <button className="btn ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="emp-list" ref={listRef}>
        {visible.map((s, i) => (
          <article
            key={s.id}
            data-idx={i}
            className={`emp-card ${i === focus ? "focused" : ""} ${selected.has(s.id) ? "selected" : ""}`}
            onClick={() => setFocus(i)}
          >
            <div className="emp-card-top">
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => toggleSelect(s.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label="Select applicant"
              />
              <span className="emp-ref">Candidate {s.candidate_ref}</span>
              <Score value={s.match_score} />
              <span className={`emp-stage st-${s.stage}`}>{STAGE_LABELS[s.stage]}</span>
              <span className="emp-card-spacer" />
              {!s.feedback && s.stage !== "rejected" && (
                <>
                  <button className="btn" onClick={(e) => { e.stopPropagation(); advance([s.id]); }}>Advance</button>
                  <button className="btn danger" onClick={(e) => { e.stopPropagation(); setRejecting({ ids: [s.id] }); }}>Reject</button>
                </>
              )}
            </div>

            {s.match_reason && <p className="emp-reason">{s.match_reason}</p>}

            <div className="emp-facts">
              {s.country && <Fact k="Location" v={cap(s.country)} />}
              {s.availability && <Fact k="Can start" v={AVAILABILITY_LABELS[s.availability] || s.availability} />}
              {s.cv_years != null && <Fact k="Experience" v={`${s.cv_years} yr`} claimed />}
              <Fact k="Applied" v={ago(s.created_at)} />
            </div>

            {s.cv_skills?.length > 0 && (
              <div className="emp-skills">
                {/* "Claimed" is not hedging — it is the honest word. These are
                    parsed from a CV the candidate wrote (012's rung 3), and
                    calling them verified would be a lie the product can't back. */}
                <span className="emp-skills-label">Claimed skills</span>
                {s.cv_skills.slice(0, 12).map((k) => <span key={k} className="kw-pill">{k}</span>)}
                {s.cv_skills.length > 12 && <span className="emp-more">+{s.cv_skills.length - 12}</span>}
              </div>
            )}

            {s.feedback && (
              <div className={`emp-sent d-${s.feedback.decision}`}>
                {s.feedback.decision === "rejected" ? "Rejected" : s.feedback.decision === "hired" ? "Hired" : "Advanced"}
                {s.feedback.reason_code && <> — told: “{REASON_LABELS[s.feedback.reason_code]}”</>}
                {s.feedback.seen_at ? <span className="emp-seen">· read</span> : s.feedback.sent_at ? <span className="emp-seen">· sent</span> : null}
              </div>
            )}

            <button
              className="emp-cv-toggle"
              onClick={(e) => { e.stopPropagation(); setExpanded(expanded === s.id ? null : s.id); }}
            >
              {expanded === s.id ? "Hide CV" : "Read CV"}
            </button>
            {expanded === s.id && <pre className="emp-cv">{s.cv_text || "No CV on file."}</pre>}
          </article>
        ))}
        {!visible.length && <p className="emp-rail-empty">Nothing in this filter.</p>}
      </div>

      {rejecting && (
        <RejectDialog
          count={rejecting.ids.length}
          onCancel={() => setRejecting(null)}
          onSend={(reason_code, note) => reject({ ids: rejecting.ids, reason_code, note })}
        />
      )}
    </div>
  );
}

/* ── The reason picker ──────────────────────────────────────────────────
   Deliberately has no "skip" button. The whole product claim is that
   people hear back with something they can use; an escape hatch here would
   be taken every time, and the claim would quietly stop being true. */
function RejectDialog({ count, onCancel, onSend }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="emp-modal-backdrop" onClick={onCancel}>
      <div className="emp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Why {count === 1 ? "this person isn't" : `these ${count} aren't`} moving forward</h3>
        <p className="emp-modal-sub">
          They'll see this. Pick the closest reason — it's the difference between a
          rejection someone can learn from and one that teaches them nothing.
        </p>

        <div className="emp-reasons">
          {REASON_OPTIONS.map((o) => (
            <button
              key={o.code}
              className={`emp-reason-opt ${reason === o.code ? "active" : ""}`}
              onClick={() => setReason(o.code)}
            >
              {o.label}
            </button>
          ))}
        </div>

        {reason && (
          <div className="emp-reason-preview">
            They'll read: “{REASON_LABELS[reason]}”
          </div>
        )}

        <label className="field">
          <span className="field-label">Anything to add <em>optional, and they'll see it</em></span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={count === 1 ? "Strong on the data side, but we needed someone who'd shipped Kafka in production." : "One line that applies to everyone you're rejecting here."} />
        </label>

        <div className="emp-modal-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className="btn primary"
            disabled={!reason || busy}
            onClick={() => { setBusy(true); onSend(reason, note); }}
          >
            {busy ? "Sending…" : count === 1 ? "Send and reject" : `Send to all ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Score({ value }) {
  if (value == null) return <span className="emp-score none" title="Not scored — the model was unavailable when they applied.">—</span>;
  const band = value >= 70 ? "hi" : value >= 45 ? "mid" : "lo";
  return <span className={`emp-score ${band}`}>{value}</span>;
}

function Fact({ k, v, claimed }) {
  return (
    <span className="emp-fact">
      <span className="emp-fact-k">{k}</span>
      <span className="emp-fact-v">{v}{claimed && <em title="Parsed from their CV, not independently verified."> claimed</em>}</span>
    </span>
  );
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function ago(iso) {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
