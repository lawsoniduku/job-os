/**
 * employer/ScreenQueue.jsx - the applicant queue, and the feedback that
 * leaves it.
 *
 * TWO THINGS THIS SCREEN IS OPTIMISED FOR, in this order:
 *
 *   1. Deciding fast. One applicant focused at a time, j/k moves, a
 *      advances, r rejects. A queue that needs a mouse round-trip per
 *      person is a queue that gets abandoned at applicant nine.
 *
 *   2. Never letting a decision leave without a reason attached. Rejecting
 *      opens the reason picker rather than completing silently - the API
 *      refuses a reasonless rejection anyway (015 sec 4), and a UI that
 *      lets you try and then errors is a worse version of the same rule.
 *
 * ONE QUEUE, TWO SOURCES. People who applied through the platform and CVs
 * the recruiter dropped in from their own pipeline are ranked against each
 * other here, because that is the comparison a recruiter is actually making
 * (016 sec 1). They differ in exactly two ways, both of which the UI states
 * rather than hides: an uploaded CV shows a name (the recruiter already has
 * it, so concealing it would be theatre), and an uploaded CV cannot be sent
 * feedback, because that person has no account here to receive it.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  listSubmissions, sendFeedback, uploadCandidates, getSubmissionCv,
  REASON_OPTIONS, REASON_LABELS, STAGE_LABELS, AVAILABILITY_LABELS,
} from "../lib/employerApi";
import { extractTextFromFile } from "../lib/extractText";

export default function ScreenQueue({ postingId, showToast, onChanged }) {
  const [subs, setSubs] = useState([]);
  const [scoring, setScoring] = useState({ outstanding: 0, failed: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [focus, setFocus] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [rejecting, setRejecting] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [cvCache, setCvCache] = useState({});
  const [filter, setFilter] = useState("open");
  const [upload, setUpload] = useState(null);      // { done, total, phase }
  const [dragging, setDragging] = useState(false);
  const listRef = useRef(null);
  const fileRef = useRef(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const r = await listSubmissions(postingId);
      setSubs(r.submissions || []);
      setScoring(r.scoring || { outstanding: 0, failed: 0, total: 0 });
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [postingId]);

  useEffect(() => { load(); }, [load]);

  // Scoring is paced and asynchronous, so the list refreshes itself while
  // anything is outstanding and stops the moment nothing is. Polling only
  // while there is something to wait for is the difference between a
  // progress indicator and a background tab burning someone's data.
  useEffect(() => {
    if (!scoring.outstanding) return;
    const t = setTimeout(() => load(true), 4000);
    return () => clearTimeout(t);
  }, [scoring.outstanding, load]);

  function changeFilter(next) {
    setFilter(next);
    setFocus(0);
    setSelected(new Set());
  }

  const visible = subs.filter((s) =>
    filter === "all" ? true
    : filter === "open" ? !["rejected", "hired", "withdrawn"].includes(s.stage)
    : filter === "uploaded" ? s.source === "upload"
    : filter === "applied" ? s.source === "platform"
    : s.stage === filter
  );

  /* -- keyboard ---------------------------------------------- */
  useEffect(() => {
    function onKey(e) {
      if (rejecting || upload) return;
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!visible.length) return;

      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocus((i) => Math.min(i + 1, visible.length - 1)); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocus((i) => Math.max(i - 1, 0)); }
      else if (e.key === "a") { e.preventDefault(); advance([visible[focus].id]); }
      else if (e.key === "r") { e.preventDefault(); setRejecting({ ids: [visible[focus].id], subs: [visible[focus]] }); }
      else if (e.key === "x") { e.preventDefault(); toggleSelect(visible[focus].id); }
      else if (e.key === "Enter") { e.preventDefault(); openCv(visible[focus]); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${focus}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // The CV is fetched only when someone opens it. The queue carries fifty
  // summaries, not fifty documents.
  async function openCv(s) {
    if (expanded === s.id) { setExpanded(null); return; }
    setExpanded(s.id);
    if (cvCache[s.id]) return;
    try {
      const r = await getSubmissionCv(s.id);
      setCvCache((c) => ({ ...c, [s.id]: r.cv_text || "No CV text on file." }));
    } catch (e) {
      setCvCache((c) => ({ ...c, [s.id]: `Couldn't load the CV: ${e.message}` }));
    }
  }

  async function advance(ids) {
    try {
      const r = await sendFeedback({ submission_ids: ids, decision: "advanced" });
      showToast(describeSend(r, "advanced"));
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
      showToast(describeSend(r, "rejected"));
      setRejecting(null);
      setSelected(new Set());
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e.message);
    }
  }

  /* -- bulk upload ------------------------------------------- */
  async function handleFiles(fileList) {
    const files = [...fileList].filter((f) => /\.(pdf|docx?|txt|md)$/i.test(f.name));
    if (!files.length) { showToast("Only PDF, DOCX and TXT files can be read."); return; }
    if (files.length > 50) { showToast("50 CVs at a time - split the batch."); return; }

    setUpload({ done: 0, total: files.length, phase: "reading" });
    const parsed = [];
    const unreadable = [];

    // Extraction happens here, in the browser, one file at a time so a
    // 40-file drop doesn't lock the tab. A file that can't be read is
    // named rather than silently dropped - a recruiter needs to know which
    // three of their thirty didn't make it.
    for (let i = 0; i < files.length; i++) {
      try {
        const text = await extractTextFromFile(files[i]);
        if (text?.trim().length > 80) parsed.push({ filename: files[i].name, text });
        else unreadable.push(files[i].name);
      } catch {
        unreadable.push(files[i].name);
      }
      setUpload({ done: i + 1, total: files.length, phase: "reading" });
    }

    if (!parsed.length) {
      setUpload(null);
      showToast(`Couldn't read ${unreadable.length === 1 ? "that file" : "any of those files"}.`);
      return;
    }

    setUpload({ done: 0, total: parsed.length, phase: "uploading" });
    try {
      const r = await uploadCandidates(postingId, parsed, (done, total) =>
        setUpload({ done, total, phase: "uploading" }));
      const bits = [`${r.added} CV${r.added === 1 ? "" : "s"} added`];
      if (r.skipped) bits.push(`${r.skipped} already there`);
      if (unreadable.length) bits.push(`${unreadable.length} unreadable`);
      showToast(bits.join(" · ") + " — ranking now.");
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e.message);
    } finally {
      setUpload(null);
    }
  }

  if (loading) return <div className="emp-loading">Loading applicants...</div>;
  if (error) return <div className="emp-error">{error} <button className="btn" onClick={() => load()}>Retry</button></div>;

  const unanswered = subs.filter((s) => !s.feedback && s.source === "platform").length;

  return (
    <div
      className={`emp-queue ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
    >
      <div className="emp-queue-bar">
        <div className="emp-filters">
          {[["open", "Open"], ["applied", "Applied here"], ["uploaded", "Uploaded"],
            ["shortlisted", "Shortlisted"], ["rejected", "Rejected"], ["all", "All"]].map(([v, l]) => (
            <button key={v} className={`filter-pill ${filter === v ? "active" : ""}`} onClick={() => changeFilter(v)}>{l}</button>
          ))}
        </div>
        <div className="emp-queue-tools">
          <button className="btn" onClick={() => fileRef.current?.click()}>Upload CVs</button>
          <input
            ref={fileRef} type="file" multiple hidden
            accept=".pdf,.doc,.docx,.txt,.md"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
        </div>
      </div>

      {subs.length > 0 && (
        <div className="emp-queue-hint">
          <kbd>j</kbd><kbd>k</kbd> move · <kbd>a</kbd> advance · <kbd>r</kbd> reject · <kbd>x</kbd> select · <kbd>↵</kbd> CV
          <span className="emp-drophint">or drop a folder of CVs anywhere on this page</span>
        </div>
      )}

      {upload && (
        <div className="emp-progress">
          <div className="emp-progress-bar"><span style={{ width: `${Math.round((upload.done / upload.total) * 100)}%` }} /></div>
          {upload.phase === "reading"
            ? `Reading ${upload.done} of ${upload.total} CVs...`
            : `Uploading ${upload.done} of ${upload.total}...`}
        </div>
      )}

      {scoring.outstanding > 0 && (
        <div className="emp-progress">
          <div className="emp-progress-bar indeterminate"><span /></div>
          Ranking {scoring.outstanding} of {scoring.total} against this role. They'll sort themselves as it finishes.
        </div>
      )}

      {scoring.failed > 0 && (
        <div className="emp-nudge">
          {scoring.failed} CV{scoring.failed === 1 ? "" : "s"} couldn't be ranked — they're still listed, just unscored.
        </div>
      )}

      {unanswered > 0 && (
        <div className="emp-nudge">
          <strong>{unanswered}</strong> {unanswered === 1 ? "person is" : "people are"} still waiting to hear from you.
        </div>
      )}

      {selected.size > 0 && (
        <div className="emp-bulk">
          <span>{selected.size} selected</span>
          <button className="btn" onClick={() => advance([...selected])}>Advance all</button>
          <button
            className="btn danger"
            onClick={() => setRejecting({ ids: [...selected], subs: subs.filter((s) => selected.has(s.id)) })}
          >
            Reject all with a reason
          </button>
          <button className="btn ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {!subs.length && (
        <div className="emp-empty">
          <h2>No applicants yet</h2>
          <p>
            People who apply through JobCopilot arrive here already scored against this
            role and already checked for whether you can employ them where they are.
          </p>
          <p>
            You can also bring your own. Drop a folder of CVs anywhere on this page and
            they'll be read, ranked against this posting and summarised — sitting in the
            same list, so you're comparing everyone at once.
          </p>
          <button className="btn primary lg" onClick={() => fileRef.current?.click()}>Upload CVs</button>
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
              <span className="emp-ref">{s.candidate_ref}</span>
              <Score value={s.match_score} status={s.score_status} />
              <span className={`emp-chip src-${s.source}`}>
                {s.source === "upload" ? "Uploaded" : "Applied here"}
              </span>
              <span className={`emp-stage st-${s.stage}`}>{STAGE_LABELS[s.stage]}</span>
              <span className="emp-card-spacer" />
              {!s.feedback && s.stage !== "rejected" && (
                <>
                  <button className="btn" onClick={(e) => { e.stopPropagation(); advance([s.id]); }}>Advance</button>
                  <button className="btn danger" onClick={(e) => { e.stopPropagation(); setRejecting({ ids: [s.id], subs: [s] }); }}>Reject</button>
                </>
              )}
            </div>

            {/* The short description that exists so a recruiter doesn't
                open thirty PDFs to find the three worth opening. */}
            {s.summary && <p className="emp-summary">{s.summary}</p>}
            {s.match_reason && <p className="emp-reason">{s.match_reason}</p>}

            <div className="emp-facts">
              {s.applicant_email && <Fact k="Email" v={s.applicant_email} />}
              {s.country && <Fact k="Location" v={cap(s.country)} />}
              {s.availability && <Fact k="Can start" v={AVAILABILITY_LABELS[s.availability] || s.availability} />}
              {s.cv_years != null && <Fact k="Experience" v={`${s.cv_years} yr`} claimed />}
              <Fact k={s.source === "upload" ? "Uploaded" : "Applied"} v={ago(s.created_at)} />
            </div>

            {s.cv_skills?.length > 0 && (
              <div className="emp-skills">
                {/* "Claimed" is not hedging - it is the honest word. These
                    are read from a CV the candidate wrote, and calling them
                    verified would be a lie the product can't back. */}
                <span className="emp-skills-label">Claimed skills</span>
                {s.cv_skills.slice(0, 12).map((k) => <span key={k} className="kw-pill">{k}</span>)}
                {s.cv_skills.length > 12 && <span className="emp-more">+{s.cv_skills.length - 12}</span>}
              </div>
            )}

            {s.feedback && (
              <div className={`emp-sent d-${s.feedback.decision}`}>
                {s.feedback.decision === "rejected" ? "Rejected" : s.feedback.decision === "hired" ? "Hired" : "Advanced"}
                {s.feedback.reason_code && <> — told: "{REASON_LABELS[s.feedback.reason_code]}"</>}
                {s.feedback.seen_at ? <span className="emp-seen">· read</span> : s.feedback.sent_at ? <span className="emp-seen">· sent</span> : null}
              </div>
            )}

            <button className="emp-cv-toggle" onClick={(e) => { e.stopPropagation(); openCv(s); }}>
              {expanded === s.id ? "Hide CV" : "Read CV"}
              {s.cv_filename && <span className="emp-cv-name"> · {s.cv_filename}</span>}
            </button>
            {expanded === s.id && (
              <pre className="emp-cv">{cvCache[s.id] ?? "Loading CV..."}</pre>
            )}
          </article>
        ))}
        {subs.length > 0 && !visible.length && <p className="emp-rail-empty">Nothing in this filter.</p>}
      </div>

      {rejecting && (
        <RejectDialog
          subs={rejecting.subs}
          onCancel={() => setRejecting(null)}
          onSend={(reason_code, note) => reject({ ids: rejecting.ids, reason_code, note })}
        />
      )}
    </div>
  );
}

/* -- The reason picker --------------------------------------------------
   Deliberately has no "skip" button. The whole product claim is that people
   hear back with something they can use; an escape hatch here would be
   taken every time, and the claim would quietly stop being true. */
function RejectDialog({ subs, onCancel, onSend }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const count = subs.length;
  const uncontactable = subs.filter((s) => s.source === "upload").length;

  return (
    <div className="emp-modal-backdrop" onClick={onCancel}>
      <div className="emp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Why {count === 1 ? "this person isn't" : `these ${count} aren't`} moving forward</h3>
        <p className="emp-modal-sub">
          They'll see this. Pick the closest reason — it's the difference between a
          rejection someone can learn from and one that teaches them nothing.
        </p>

        {uncontactable > 0 && (
          <div className="emp-warn">
            {uncontactable === count
              ? count === 1
                ? "This CV was uploaded by you, so there's no account here to deliver feedback to. They'll be marked rejected in your queue only."
                : `All ${count} of these were uploaded by you, so there are no accounts here to deliver feedback to. They'll be marked rejected in your queue only.`
              : `${uncontactable} of these ${uncontactable === 1 ? "was" : "were"} uploaded by you and can't be sent feedback — only marked rejected. The other ${count - uncontactable} will hear from you.`}
          </div>
        )}

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

        {reason && <div className="emp-reason-preview">They'll read: "{REASON_LABELS[reason]}"</div>}

        <label className="field">
          <span className="field-label">Anything to add <em>optional, and they'll see it</em></span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={count === 1
              ? "Strong on the data side, but we needed someone who'd shipped Kafka in production."
              : "One line that applies to everyone you're rejecting here."} />
        </label>

        <div className="emp-modal-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!reason || busy} onClick={() => { setBusy(true); onSend(reason, note); }}>
            {busy ? "Sending..." : count === 1 ? "Send and reject" : `Send to all ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// A score that hasn't happened yet must not look like a score of zero -
// thirty CVs uploaded at once are all unscored for a minute, and rendering
// them as 0 would read as the product being wrong about thirty people.
function Score({ value, status }) {
  if (status === "pending" || status === "scoring") {
    return <span className="emp-score pending" title="Being ranked against this role right now.">ranking</span>;
  }
  if (status === "failed") {
    return <span className="emp-score none" title="The model couldn't read this CV. Open it to judge yourself.">unranked</span>;
  }
  if (value == null) return <span className="emp-score none" title="Not scored.">—</span>;
  const band = value >= 70 ? "hi" : value >= 45 ? "mid" : "lo";
  return <span className={`emp-score ${band}`}>{value}</span>;
}

function Fact({ k, v, claimed }) {
  return (
    <span className="emp-fact">
      <span className="emp-fact-k">{k}</span>
      <span className="emp-fact-v">{v}{claimed && <em title="Read from their CV, not independently verified."> claimed</em>}</span>
    </span>
  );
}

// The API reports how many were actually notified vs merely moved, and the
// toast repeats it exactly. Saying "30 people have been told" when eleven
// of them have no account to be told through is the kind of small lie that
// makes the rest of the product's claims worth less.
function describeSend(r, verb) {
  const sent = r.sent || 0;
  const un = r.uncontactable || 0;
  if (!un) return sent === 1 ? `Done — they've been told.` : `${sent} ${verb} and notified.`;
  if (!sent) return `${un} marked ${verb} in your queue. Uploaded CVs have no account here to notify.`;
  return `${sent} notified · ${un} marked ${verb} only (uploaded, no account to notify).`;
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
