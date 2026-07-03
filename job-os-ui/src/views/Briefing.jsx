/**
 * views/Briefing.jsx — the daily editorial page.
 *   New for you  — fresh eligible matches from your most recent search
 *   Movement     — real signals derived from your Pipeline (follow-ups due,
 *                  shortlisted roles with no CV yet)
 * Everything here is real data — no invented numbers.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { aiSearch, verdictOf, fmtSalary, daysSince } from "../lib/api";

export default function Briefing({ shared, active }) {
  const { user, profile, setView, showToast } = shared;
  const [matches, setMatches] = useState(null); // null = loading, [] = none
  const [lastQuery, setLastQuery] = useState(null);
  const [movement, setMovement] = useState([]);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    if (!user) { setMatches([]); return; }

    // 1. Most recent saved search -> today's matches.
    const { data: searches } = await supabase
      .from("saved_searches").select("query")
      .order("created_at", { ascending: false }).limit(1);
    const q = searches?.[0]?.query || null;
    setLastQuery(q);
    if (q) {
      try {
        const res = await aiSearch({ q, country: profile?.country || undefined, limit: 5 });
        setMatches(res.data || []);
        setTotal(res.total || 0);
      } catch {
        setMatches([]);
      }
    } else {
      setMatches([]);
    }

    // 2. Movement from the Pipeline.
    const { data: apps } = await supabase.from("applications").select("*");
    const moves = [];
    for (const a of apps || []) {
      const d = daysSince(a.applied_at || a.created_at) ?? 0;
      if (a.status === "applied" && d >= 5) {
        moves.push({
          icon: "⏱",
          text: <>Your <b>{a.company || a.job_title}</b> application is on day {d + 1} with no update</>,
          sub: "A short, polite nudge email is usually well-received after a week",
        });
      }
      if (a.status === "shortlist" && d >= 2 && !a.cv_label) {
        moves.push({
          icon: "📄",
          text: <><b>{a.job_title}</b> at {a.company} has been on your shortlist for {d} days</>,
          sub: "Tailor a CV and apply before it closes — postings in this range move fast",
        });
      }
      if (a.status === "in_process") {
        moves.push({
          icon: "🎙",
          text: <><b>{a.company || a.job_title}</b> is in process — interview prep is unlocked in Pipeline</>,
          sub: "Questions are generated from the actual job description",
        });
      }
    }
    setMovement(moves.slice(0, 5));
  }, [user, profile]);

  useEffect(() => { if (active) load(); }, [active, load]);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const name = profile?.full_name?.split(" ")[0] || "there";

  if (!user) {
    return (
      <div className="scrollarea"><div className="page">
        <div className="page-eyebrow">{today}</div>
        <h1>Your daily briefing</h1>
        <p className="sub">Sign in and run one search — every morning after that, this page opens with fresh eligible matches and everything that moved in your pipeline.</p>
      </div></div>
    );
  }

  return (
    <div className="scrollarea"><div className="page">
      <div className="page-eyebrow">{today}</div>
      <h1>Good {daypart()}, {name}</h1>
      <p className="sub">
        {matches === null ? "Checking for new matches…" :
         lastQuery ? `Latest eligible matches for “${lastQuery}”` :
         "Run your first search in Copilot and your briefing starts tomorrow."}
      </p>

      <div className="block">
        <div className="block-head">
          <h2>New for you</h2>
          {total > 0 && <span className="bcount">top 5 of {total} eligible</span>}
        </div>
        {matches === null && <div className="thinking"><span /><span /><span /></div>}
        {matches?.length === 0 && (
          <div className="studio-card">
            <h3>No matches to show yet</h3>
            <div className="s-sub">Search once in Copilot — your latest search powers this feed.</div>
            <button className="btn primary" onClick={() => setView("copilot")}>Open Copilot</button>
          </div>
        )}
        {matches?.map((job) => {
          const v = verdictOf(job);
          const sal = fmtSalary(job.salary_min, job.salary_max);
          return (
            <div className="row-card" key={job.id}>
              <span className={`verdict ${v.key}`} style={{ cursor: "default" }}><span className="vdot" />{v.label}</span>
              <div className="rc-main">
                <div className="rc-title">{job.title} · {job.company}</div>
                <div className="rc-sub">{job.match_reason || job.location || ""}</div>
              </div>
              <div className="rc-right">
                {sal && <span className="sal">{sal}</span>}
                {job.apply_url && (
                  <a className="btn" href={job.apply_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>View ↗</a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="block">
        <div className="block-head"><h2>Movement</h2></div>
        {movement.length === 0 ? (
          <div className="s-sub">Nothing needs your attention right now. Shortlist or apply to a role and follow-ups will surface here automatically.</div>
        ) : movement.map((mv, i) => (
          <div className="move-item" key={i}>
            <div className="move-ic">{mv.icon}</div>
            <div>
              <div className="m-text">{mv.text}</div>
              <div className="m-sub">{mv.sub}</div>
            </div>
            <div className="m-act">
              <button className="btn" onClick={() => setView("pipeline")}>Open Pipeline</button>
            </div>
          </div>
        ))}
      </div>

      {total > 0 && (
        <div className="block">
          <div className="insight-card">
            <div className="i-eyebrow">One insight</div>
            <p>
              Right now there are <b>{total}</b> live roles you're verified eligible for on this search alone.
              The candidates who apply within the first 48 hours of a posting get the majority of replies — check this page daily.
            </p>
          </div>
        </div>
      )}
    </div></div>
  );
}

function daypart() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
