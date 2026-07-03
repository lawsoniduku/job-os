/**
 * views/Pipeline.jsx — every application, shortlist to closed.
 * Backed by the `applications` table (migration 004). Cards advance
 * stage-by-stage and keep their job snapshot even if the posting dies.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { aiInterviewCoach, fmtSalary, daysSince } from "../lib/api";

const COLS = [
  { key: "shortlist", label: "Shortlist" },
  { key: "applied", label: "Applied" },
  { key: "in_process", label: "In process" },
  { key: "offer", label: "Offer" },
  { key: "closed", label: "Closed" },
];
const NEXT = { shortlist: "applied", applied: "in_process", in_process: "offer" };

export default function Pipeline({ shared, active }) {
  const { user, showToast, setView } = shared;
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [prepApp, setPrepApp] = useState(null);

  const load = useCallback(async () => {
    if (!user) { setApps([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .order("updated_at", { ascending: false });
    if (!error) setApps(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { if (active) load(); }, [active, load]);

  async function advance(app) {
    const next = NEXT[app.status];
    if (!next) return;
    const patch = { status: next };
    if (next === "applied" && !app.applied_at) patch.applied_at = new Date().toISOString();
    const { error } = await supabase.from("applications").update(patch).eq("id", app.id);
    if (error) return showToast(`Couldn't move it: ${error.message}`);
    showToast(next === "offer" ? "Moved to Offer 🎉" : `Moved to ${COLS.find((c) => c.key === next).label}`);
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
        <p className="sub">Sign in to track every application from shortlist to offer — each card keeps the job snapshot, dates, and the CV version you sent.</p>
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
          <div className="s-sub">Shortlist a job from Copilot and it lands here.</div>
          <button className="btn primary" onClick={() => setView("copilot")}>Find eligible jobs</button>
        </div>
      )}

      {apps.length > 0 && (
        <div className="board">
          {COLS.map((col) => {
            const cards = apps.filter((a) => a.status === col.key);
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
                    onAdvance={advance}
                    onClose={closeApp}
                    onRemove={remove}
                    onPrep={setPrepApp}
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

function AppCard({ app, onAdvance, onClose, onRemove, onPrep }) {
  const days = daysSince(app.applied_at || app.created_at);
  const sal = fmtSalary(app.salary_min, app.salary_max);
  const canPrep = app.status === "in_process" && app.job_id;

  return (
    <div className="p-card">
      <div className="pc-title">{app.job_title}</div>
      <div className="pc-co">{app.company || "—"}</div>
      <div className="pc-meta">
        {app.status === "applied" && days !== null ? `Applied · day ${Math.max(days, 0) + 1}` :
         app.status === "shortlist" ? `Shortlisted ${days === 0 ? "today" : `${days}d ago`}` :
         `Updated ${daysSince(app.updated_at) === 0 ? "today" : `${daysSince(app.updated_at)}d ago`}`}
        {sal ? ` · ${sal}` : ""}
      </div>
      {app.cv_label && <div className="pc-cv">{app.cv_label}</div>}
      <div className="pc-actions">
        {NEXT[app.status] && <button onClick={() => onAdvance(app)}>Advance →</button>}
        {canPrep && <button onClick={() => onPrep(app)}>Prep interview</button>}
        {app.apply_url && (
          <button onClick={() => window.open(app.apply_url, "_blank", "noopener")}>Open ↗</button>
        )}
        {app.status !== "closed" ? (
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
    aiInterviewCoach({ jobId: app.job_id, mode: "questions" })
      .then((res) => { if (live) setResult(res.result); })
      .catch((err) => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
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
