/**
 * views/Briefing.jsx — the daily page.
 *
 * Feed priority:
 *   1. Profile preferred roles (target_roles + seniority) — the You page
 *      is now the primary engine of this feed
 *   2. Fallback: the user's most recent saved search
 * Movement is derived from real Pipeline state. No invented data anywhere.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { strengthOf } from "../lib/profile";
import { aiSearch, verdictOf, fmtSalary, daysSince } from "../lib/api";
import { recordApplyIntent } from "../lib/applyIntent";

export default function Briefing({ shared, active }) {
  const { user, profile, requireAuth, setView } = shared;
  const [matches, setMatches] = useState(null); // null = loading
  const [feedSource, setFeedSource] = useState(null); // "profile" | "search" | null
  const [feedLabel, setFeedLabel] = useState(null);
  const [movement, setMovement] = useState([]);
  const [total, setTotal] = useState(0);
  const [cvInfo, setCvInfo] = useState(null);

  // The daily page is where most people land, so it is where the profile
  // prompt has to live too — the You tab only reaches people who already
  // went looking. One gap, stated in terms of what it buys them.
  const strength = useMemo(() => strengthOf(profile, cvInfo), [profile, cvInfo]);

  const load = useCallback(async () => {
    if (!user) { setMatches([]); return; }

    // 1. Build the feed query — profile first, saved search fallback.
    let q = null;
    if (profile?.target_roles?.length) {
      const seniority = profile?.preferences?.seniority;
      q = `remote ${seniority && seniority !== "mid" ? seniority + " " : ""}${profile.target_roles[0]} jobs`;
      setFeedSource("profile");
      setFeedLabel(profile.target_roles.join(", "));
    } else {
      const { data: searches } = await supabase
        .from("saved_searches").select("query")
        .order("created_at", { ascending: false }).limit(1);
      q = searches?.[0]?.query || null;
      setFeedSource(q ? "search" : null);
      setFeedLabel(q);
    }

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

    // 2. CV state — the strength meter needs it and it's one cheap row.
    const { data: cv } = await supabase.from("saved_cvs")
      .select("filename, updated_at").eq("user_id", user.id).maybeSingle();
    setCvInfo(cv || null);

    // 3. Movement from the Pipeline.
    const { data: apps } = await supabase.from("applications").select("*");
    const moves = [];
    for (const a of apps || []) {
      const d = daysSince(a.applied_at || a.created_at) ?? 0;
      // Clicked through to the employer, never told us what happened. Asking
      // here catches the people who dismissed the in-session nudge or came
      // back days later.
      if (a.status === "applied_intent" && !a.apply_outcome) {
        const cd = daysSince(a.apply_clicked_at) ?? 0;
        moves.push({
          icon: "❓",
          text: <>You opened <b>{a.company || a.job_title}</b> {cd === 0 ? "today" : `${cd} days ago`} — did you apply?</>,
          sub: "Confirming it starts your follow-up reminders and keeps the pipeline honest",
        });
      }
      if (a.status === "applied" && d >= 5) {
        moves.push({
          icon: "⏱",
          text: <>Your <b>{a.company || a.job_title}</b> application is on day {d + 1} with no update</>,
          sub: "A short, polite nudge email is usually well-received after a week",
        });
      }
      if (["saved", "shortlist", "interested"].includes(a.status) && d >= 2) {
        moves.push({
          icon: "📄",
          text: <><b>{a.job_title}</b> at {a.company} has been saved for {d} days</>,
          sub: "Tailor a CV and apply — postings in this range move fast",
        });
      }
      if (["assessment", "interview", "in_process"].includes(a.status)) {
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
        <p className="sub">Sign in, set your preferred roles in You, and every morning this page opens with fresh eligible matches plus everything that moved in your pipeline.</p>
        <button className="btn primary" onClick={requireAuth}>Sign in or create account</button>
      </div></div>
    );
  }

  return (
    <div className="scrollarea"><div className="page">
      <div className="page-eyebrow">{today}</div>
      <h1>Good {daypart()}, {name}</h1>
      <p className="sub">
        {matches === null ? "Checking for new matches…" :
         feedSource === "profile" ? `Latest eligible matches for your preferred roles: ${feedLabel}` :
         feedSource === "search" ? `Latest eligible matches for “${feedLabel}”` :
         "Set your preferred roles in You (or run one search) and your briefing comes alive."}
      </p>

      {/* One gap at a time, phrased as what they get — never a checklist.
          Disappears entirely once the profile is complete. */}
      {strength.next && (
        <div className="bp-prompt">
          <div className="bp-bar" aria-hidden="true">
            <div className="bp-fill" style={{ width: `${strength.pct}%` }} />
          </div>
          <div className="bp-body">
            <div className="bp-what">
              Your profile is {strength.pct}% complete — next: {strength.next.label.toLowerCase()}
            </div>
            <div className="bp-why">{strength.next.unlocks}</div>
          </div>
          <button className="btn primary" onClick={() => setView("you")}>Add it</button>
        </div>
      )}

      <div className="block">
        <div className="block-head">
          <h2>New for you</h2>
          {total > 0 && <span className="bcount">top 5 of {total} eligible</span>}
        </div>
        {matches === null && <div className="thinking"><span /><span /><span /></div>}
        {matches?.length === 0 && (
          <div className="studio-card">
            <h3>No matches to show yet</h3>
            <div className="s-sub">Pick your preferred roles in the You tab — that's what this feed runs on.</div>
            <button className="btn primary" onClick={() => setView("you")}>Set preferred roles</button>
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
                  <a className="btn" href={job.apply_url} target="_blank" rel="noreferrer"
                     onClick={() => recordApplyIntent({ user, job, source: "briefing" })}
                     style={{ textDecoration: "none" }}>View ↗</a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="block">
        <div className="block-head"><h2>Movement</h2></div>
        {movement.length === 0 ? (
          <div className="s-sub">Nothing needs your attention right now. Save or apply to a role and follow-ups surface here automatically.</div>
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
              Right now there are <b>{total}</b> live roles you're verified eligible for on this feed alone.
              Candidates who apply within 48 hours of a posting get the majority of replies — check this page daily.
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
