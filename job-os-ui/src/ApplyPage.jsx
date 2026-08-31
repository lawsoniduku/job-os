/**
 * ApplyPage.jsx — where jobs.apply_url points for an employer posting.
 *
 * Every other listing in this product hands the candidate off to someone
 * else's site and we lose sight of them (that whole problem is what 014
 * exists to mitigate). An employer posting is the one case where the apply
 * happens HERE — which is why this page can promise something no external
 * apply can: the application is definitely received, and the answer comes
 * back to the same place.
 *
 * That promise is the reason to keep this page boring and short. It reads
 * the role, it confirms what will be sent, it submits. No funnel.
 */
import { useState, useEffect } from "react";
import { useSession } from "./lib/useSession";
import { supabase } from "./lib/supabaseClient";
import { getPublicPosting, applyToPosting } from "./lib/employerApi";
import { fmtSalary } from "./lib/api";
import AuthModal from "./AuthModal";
import "./employer/employer.css";

export default function ApplyPage({ postingId }) {
  const { user, profile, loading } = useSession();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [cv, setCv] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    getPublicPosting(postingId).then(setData).catch((e) => setErr(e.message));
  }, [postingId, user]);

  // The CV is read here rather than uploaded, because the candidate already
  // has one on file from the copilot side — asking again would be asking
  // them to redo work the product already did.
  useEffect(() => {
    if (!user || !supabase) return;
    supabase.from("saved_cvs").select("cv_text, filename").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setCv(data || null));
  }, [user]);

  async function submit() {
    setBusy(true);
    try {
      await applyToPosting(postingId, { company: data?.posting?.org?.name });
      setDone(true);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  if (err && !data) return <Shell><div className="emp-error">{err}</div></Shell>;
  if (!data || loading) return <Shell><div className="emp-loading">Loading role…</div></Shell>;

  const p = data.posting;
  const salary = fmtSalary(p.salary_min, p.salary_max);

  if (done || data.applied) {
    return (
      <Shell>
        <div className="apply-done">
          <div className="apply-tick">✓</div>
          <h1>{done ? "Application sent" : "You've already applied"}</h1>
          <p>
            {p.org?.name} has it, along with your CV. Unlike most places you apply,
            you'll get an answer here either way — and if it's a no, it comes with a
            reason. It lands in your Pipeline.
          </p>
          <a className="btn primary lg" href="/">Back to JobCopilot</a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <article className="apply-role">
        <div className="apply-org">
          {p.org?.name}
          {p.verified_employer
            ? <span className="emp-chip ok" title="A person at JobCopilot confirmed this company exists.">Verified</span>
            : <span className="emp-chip" title="We haven't confirmed this company yet.">Unverified</span>}
        </div>
        <h1>{p.title}</h1>
        <div className="apply-meta">
          {p.location && <span>{p.location}</span>}
          {p.remote_type && <span>{cap(p.remote_type)}</span>}
          {p.employment_type && <span>{p.employment_type.replace("_", "-")}</span>}
          {salary && <span>{salary}</span>}
        </div>

        {p.eligible_countries?.length > 0 && (
          <div className="apply-elig">
            <strong>They can employ people in:</strong> {p.eligible_countries.map(cap).join(", ")}.
            {profile?.country && (
              p.eligible_countries.includes(profile.country)
                ? <span className="apply-elig-ok"> That includes {cap(profile.country)}, where you are.</span>
                : <span className="apply-elig-warn"> Your profile says {cap(profile.country)}, which isn't on their list — you can still apply, but they may not be able to hire you.</span>
            )}
          </div>
        )}

        {p.description && <div className="apply-desc">{p.description}</div>}

        <div className="apply-actions">
          {!user && (
            <>
              <button className="btn primary lg" onClick={() => setShowAuth(true)}>Sign in to apply</button>
              <p className="field-hint">Applying takes one click once you're in — your CV is already on file.</p>
            </>
          )}
          {user && !cv?.cv_text && (
            <>
              <a className="btn primary lg" href="/">Upload a CV first</a>
              <p className="field-hint">Add your CV in the You tab, then come back to this page.</p>
            </>
          )}
          {user && cv?.cv_text && (
            <>
              <button className="btn primary lg" onClick={submit} disabled={busy}>
                {busy ? "Sending…" : "Apply with my CV"}
              </button>
              <p className="field-hint">
                Sends {cv.filename || "your saved CV"} plus your country and availability. Nothing else.
              </p>
            </>
          )}
          {err && <div className="auth-error">{err}</div>}
        </div>
      </article>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="apply-page">
      <a className="emp-wordmark" href="/"><span className="dot" />JobCopilot</a>
      {children}
    </div>
  );
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
