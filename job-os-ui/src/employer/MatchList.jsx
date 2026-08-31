/**
 * employer/MatchList.jsx — candidates who never applied, but fit.
 *
 * This is 012's shortlist query with a face on it, and it is the one screen
 * in the console that has to be careful about two different things at once.
 *
 * ANONYMITY. Nothing here is a name. An employer is deciding on evidence —
 * eligibility, claimed skills, whether the person is genuinely applying to
 * this kind of role — and a name is not evidence. Identity is released by
 * the candidate accepting an intro, never by us.
 *
 * HONEST EMPTINESS. The opted-in pool is currently tiny, so this list will
 * often be short or empty. An empty state that just says "no matches" reads
 * as a broken feature and teaches the employer to stop opening the tab. So
 * the API returns how many opted-in profiles were even considered, and this
 * screen says which of the filters did the narrowing.
 */
import { useState, useEffect, useCallback } from "react";
import { listMatches, requestIntro, AVAILABILITY_LABELS } from "../lib/employerApi";

export default function MatchList({ posting, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await listMatches(posting.id));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [posting.id]);

  useEffect(() => { load(); }, [load]);

  async function send(candidate_id, message) {
    try {
      await requestIntro({ candidate_id, posting_id: posting.id, message });
      showToast("Asked. They decide whether to share their details.");
      setAsking(null);
      await load();
    } catch (e) {
      showToast(e.message);
    }
  }

  if (loading) return <div className="emp-loading">Searching opted-in candidates…</div>;
  if (error) return <div className="emp-error">{error} <button className="btn" onClick={load}>Retry</button></div>;

  const { matches = [], pool = {} } = data || {};

  return (
    <div className="emp-matches">
      <div className="emp-match-head">
        <p>
          People who opted in to being found, filtered to those you can legally employ
          and who are actually applying to {pool.role_cluster ? <b>{pool.role_cluster}</b> : "this kind of"} roles.
          Nobody here applied to you — they haven't been contacted.
        </p>
      </div>

      {!matches.length && (
        <div className="emp-empty">
          <h2>Nobody matches yet</h2>
          {/* Says which filter emptied the list, because "no results" without
              a cause is indistinguishable from a bug. */}
          <p>
            We looked at <b>{pool.opted_in_considered}</b> {pool.opted_in_considered === 1 ? "candidate who has" : "candidates who have"} opted
            in to being found{pool.country_filtered ? " in the countries you said you can employ in" : ""}.
          </p>
          <ul className="emp-why-empty">
            {pool.opted_in_considered === 0 && pool.country_filtered && (
              <li>Nobody opted-in is based in the countries on this posting. Widening that list is the fastest fix.</li>
            )}
            {pool.opted_in_considered === 0 && !pool.country_filtered && (
              <li>No candidates have opted in to employer visibility yet. This grows as the candidate side does — it isn't something this posting can change.</li>
            )}
            {pool.opted_in_considered > 0 && (
              <li>They opted in, but none has applied to {pool.role_cluster || "this kind of role"} twice in the last 90 days, and none lists a skill this posting asks for.</li>
            )}
            <li>Applicants who come to you directly show up under <b>Applicants</b> — that tab doesn't depend on any of this.</li>
          </ul>
        </div>
      )}

      {matches.map((m) => (
        <article key={m.candidate_id} className="emp-card">
          <div className="emp-card-top">
            <span className="emp-ref">Candidate {m.ref}</span>
            {m.country && <span className="emp-chip">{cap(m.country)}</span>}
            {m.eligibility_checked && (
              <span className="emp-chip ok" title="They're in a country you told us you can employ in.">
                You can employ here
              </span>
            )}
            <span className="emp-card-spacer" />
            {m.intro_status === "accepted" ? <span className="emp-chip ok">Accepted — check your email</span>
              : m.intro_status === "pending" ? <span className="emp-chip">Asked, waiting</span>
              : m.intro_status === "declined" ? <span className="emp-chip">Declined</span>
              : <button className="btn primary" onClick={() => setAsking(m)}>Ask for an intro</button>}
          </div>

          {m.headline && <p className="emp-reason">{m.headline}</p>}

          <div className="emp-facts">
            {m.claimed_years != null && <Fact k="Experience" v={`${m.claimed_years} yr`} claimed />}
            {m.availability && <Fact k="Can start" v={AVAILABILITY_LABELS[m.availability] || m.availability} />}
            {/* Rung 2 of the ladder, and the only number here that isn't
                self-reported: it comes from what they actually did. */}
            <Fact k="Applied to similar" v={`${m.applications_90d}× in 90 days`} />
            {m.last_active && <Fact k="Last active" v={ago(m.last_active)} />}
          </div>

          {m.claimed_skills?.length > 0 && (
            <div className="emp-skills">
              <span className="emp-skills-label">Claimed skills</span>
              {m.claimed_skills.slice(0, 12).map((k) => <span key={k} className="kw-pill">{k}</span>)}
            </div>
          )}
        </article>
      ))}

      {asking && (
        <IntroDialog
          candidate={asking}
          posting={posting}
          onCancel={() => setAsking(null)}
          onSend={(msg) => send(asking.candidate_id, msg)}
        />
      )}
    </div>
  );
}

function IntroDialog({ candidate, posting, onCancel, onSend }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="emp-modal-backdrop" onClick={onCancel}>
      <div className="emp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Ask candidate {candidate.ref} for an introduction</h3>
        <p className="emp-modal-sub">
          They'll see your company, this role, and your note — then decide. You get their
          contact details only if they say yes, and you can't ask again if they say no.
        </p>
        <label className="field">
          <span className="field-label">Your note</span>
          <textarea rows={4} value={msg} onChange={(e) => setMsg(e.target.value)}
            placeholder={`Why you think they'd be a fit for ${posting.title}, and what happens next if they're interested.`} />
          <span className="field-hint">
            A specific note gets answered. "We're hiring, are you interested?" mostly doesn't.
          </span>
        </label>
        <div className="emp-modal-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={() => { setBusy(true); onSend(msg); }}>
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
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
