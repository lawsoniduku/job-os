/**
 * employer/EmployerApp.jsx — the hiring console shell.
 *
 * Mounted by main.jsx on /employer paths. Deliberately a sibling of App.jsx
 * rather than a sixth tab inside it: the two sides of the marketplace have
 * different nouns, different navigation, and — the part that matters — a
 * different answer to "whose data is on this screen". Keeping them apart
 * makes it hard to accidentally render a candidate's private field in a
 * view an employer can reach.
 */
import { useState, useEffect, useCallback } from "react";
import { useSession } from "../lib/useSession";
import AuthModal from "../AuthModal";
import { getMe, createOrg, listPostings, updatePosting } from "../lib/employerApi";
import PostingEditor from "./PostingEditor";
import JDComposer from "./JDComposer";
import ScreenQueue from "./ScreenQueue";
import MatchList from "./MatchList";
import HiringOverview from "./HiringOverview";
import "./employer.css";

export default function EmployerApp() {
  const { user, loading, signOut } = useSession();

  const [org, setOrg] = useState(null);
  const [checkingOrg, setCheckingOrg] = useState(true);
  const [postings, setPostings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null);      // posting object, or "new"
  const [tab, setTab] = useState("applicants");
  const [view,setView]=useState("overview");
  const [reviewId,setReviewId]=useState(null);
  const [orgError,setOrgError]=useState("");
  const [orgRetry,setOrgRetry]=useState(0);
  const [toast, setToast] = useState(null);
  const [showAuth, setShowAuth] = useState(false);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    let cancelled = false;
    getMe()
      .then((r) => { if (!cancelled) setOrg(r.orgs?.[0] || null); })
      .catch(e => { if (!cancelled) setOrgError(e.message); })
      .finally(() => { if (!cancelled) setCheckingOrg(false); });
    return () => { cancelled = true; };
  }, [user, loading, orgRetry]);

  const refreshPostings = useCallback(async () => {
    if (!org) return;
    try {
      const r = await listPostings();
      setPostings(r.postings || []);
      setSelectedId((cur) => cur || r.postings?.[0]?.id || null);
    } catch (e) {
      showToast(e.message);
    }
  }, [org, showToast]);

  useEffect(() => {
    if(!org)return;
    let cancelled=false;
    listPostings().then(r=>{if(!cancelled){setPostings(r.postings || []);setSelectedId(cur=>cur || r.postings?.[0]?.id || null);}}).catch(e=>{if(!cancelled)showToast(e.message);});
    return()=>{cancelled=true;};
  },[org,showToast]);

  if (loading || (user && checkingOrg)) return <div className="emp-loading" role="status">Loading your hiring workspace…</div>;
  if(orgError)return <div className="emp-gate"><div className="emp-gate-card"><h1>Could not load your hiring workspace</h1><p role="alert">{orgError}</p><button className="btn primary" onClick={()=>{setCheckingOrg(true);setOrgError("");setOrgRetry(n=>n+1);}}>Try again</button></div></div>;

  if (!user) {
    return (
      <div className="emp-gate">
        <div className="emp-gate-card">
          <div className="emp-wordmark"><span className="dot" />JobCopilot <span className="emp-badge">for employers</span></div>
          <h1>Less CV chaos. More great conversations.</h1>
          <p>
            Bring your CVs, set what matters for the role, and move from a pile of applications to an evidence-backed shortlist. Original documents and human decisions, together.
          </p>
          <button className="btn primary lg" onClick={() => setShowAuth(true)}>Sign in to continue</button>
          <a className="emp-alt" href="/">I'm looking for work instead</a>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </div>
    );
  }

  if (!org) return <OrgSetup onCreated={(o) => { setOrg(o); setEditing("form");setView("role");showToast(`${o.name} is set up.`); }} />;

  const selected = postings.find((p) => p.id === selectedId) || null;

  return (
    <div className="emp-app">
      <nav className="emp-rail" aria-label="Hiring navigation">
        <a className="emp-wordmark" href="/employer">
          <span className="emp-brand-symbol">✳</span><span>JobCopilot<small>RECRUITING WORKSPACE</small></span>
        </a>

        <div className="emp-org">
          <span className="emp-org-avatar">{org.name.slice(0,1)}</span><div className="emp-org-name">{org.name}</div>
          <div className="emp-org-sub">
            {org.verified_at
              ? <span className="emp-verified">Verified employer</span>
              : <span title="A person confirms the company before this appears to candidates.">Unverified</span>}
          </div>
        </div>

        <button className="btn primary emp-new" onClick={() => { setEditing("form");setView("role"); }}>
          ＋ Create a role
        </button>

        <button className={`btn emp-overview-nav ${view==="overview"?"primary":""}`} onClick={()=>{setEditing(null);setView("overview");}}>▦ &nbsp; Hiring overview</button><div className="emp-rail-label">YOUR ROLES <span>{postings.length}</span></div>
        <div className="emp-postings">
          {postings.length === 0 && (
            <p className="emp-rail-empty">No roles yet. Post one and it appears in candidate search straight away.</p>
          )}
          {postings.map((p) => (
            <button
              key={p.id}
              className={`emp-posting-item ${p.id === selectedId ? "active" : ""}`}
              onClick={() => { setSelectedId(p.id); setTab("applicants");setView("role");setReviewId(null); }}
            >
              <div className="emp-pi-title">{p.title}</div>
              <div className="emp-pi-meta">
                <span className={`emp-status s-${p.status}`}>{p.status}</span>
                {p.counts.total > 0 && <span>{p.counts.total} applied</span>}
                {p.counts.awaiting > 0 && <span className="emp-awaiting">{p.counts.awaiting} waiting</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="emp-rail-foot">
          <div className="emp-user">{user.email}</div>
          <div className="rail-mini">
            <a href="/">Candidate experience ↗</a>
            <button onClick={async () => { await signOut(); window.location.href = "/"; }}>Sign out</button>
          </div>
        </div>
      </nav>

      <main className="emp-main"><div className="emp-topbar"><span>Workspace <span>/</span> {view==="overview"?"Overview":selected?.title || "New role"}</span><span className="emp-topbar-person"><span className="emp-small-avatar">{user.email?.slice(0,1).toUpperCase()}</span>Your hiring desk</span></div><div className="emp-content">
        {/* Describing the role is the default way in; the form is the
            escape hatch, reachable from inside the composer and used
            automatically when the model is unavailable. Editing an
            existing posting always goes to the form — someone fixing a
            typo does not want to be interviewed about it again. */}
        {editing === "new" && (
          <JDComposer
            onCancel={(mode) => setEditing(mode === "manual" ? "form" : null)}
            onSaved={async (p) => {
              setEditing(null);
              await refreshPostings();
              setSelectedId(p.id);
              showToast(p.status === "open" ? "Live — it's in candidate search now." : "Saved as a draft.");
            }}
          />
        )}

        {editing && editing !== "new" && (
          <PostingEditor
            posting={editing === "form" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={async (p) => {
              setEditing(null);
              await refreshPostings();
              setSelectedId(p.id);
              showToast(p.status === "open" ? "Live — it's in candidate search now." : "Saved as a draft.");
            }}
            showToast={showToast}
          />
        )}

        {!editing && view==="overview" && <HiringOverview postings={postings} onSelect={(id,applicantId)=>{setSelectedId(id);setReviewId(applicantId);setView("role");setTab("applicants");}}/>}
        {!editing && view==="role" && !selected && (
          <div className="emp-empty">
            <h2>Nothing posted yet</h2>
            <p>Publish a role, set clear hiring locations and review all your applicants in one place.</p>
            <button className="btn primary lg" onClick={() => setEditing("new")}>Post your first role</button>
          </div>
        )}

        {!editing && view==="role" && selected && (
          <>
            <header className="emp-head emp-role-head">
              <div><span className="eyebrow">ROLE WORKSPACE</span>
                <h1>{selected.title}</h1>
                <div className="emp-head-meta">
                  <span className={`emp-status s-${selected.status}`}>{selected.status}</span>
                  {selected.role_cluster && <span>{selected.role_cluster}</span>}
                  {selected.location && <span>{selected.location}</span>}
                  {selected.eligible_countries?.length > 0 && (
                    <span title="Countries you said you can employ in. Used to filter candidates.">
                      Can employ in {selected.eligible_countries.length}
                    </span>
                  )}
                </div>
              </div>
              <div className="emp-head-actions">
                {selected.status==="open"&&<a className="btn" href={`/apply/${selected.id}`} target="_blank" rel="noreferrer">View live posting ↗</a>}
                <button className="btn" onClick={() => setEditing(selected)}>Edit</button>
                {selected.status === "draft" && (
                  <button className="btn primary" onClick={() => publish(selected, "open")}>Publish</button>
                )}
                {selected.status === "open" && (
                  <button className="btn" onClick={() => publish(selected, "paused")}>Pause</button>
                )}
                {selected.status === "paused" && (
                  <button className="btn primary" onClick={() => publish(selected, "open")}>Reopen</button>
                )}
              </div>
            </header>

            <div className="emp-role-brief"><div><span className="eyebrow">THE ROLE AT A GLANCE</span><p>{selected.description?.split(/\n\s*\n/).find(s=>s.trim().length>30)?.replace(/^[A-Z \n]+\n/,'').slice(0,360) || "Add a role description to tell candidates what they will own."}</p><div className="emp-role-facts"><span>◎ {selected.remote_type || "Arrangement not stated"}</span><span>◷ {selected.employment_type?.replaceAll("_"," ") || "Employment type not stated"}</span><span>⌁ {selected.eligible_countries?.join(", ") || "Hiring countries not stated"}</span></div></div><div className="emp-role-rubric"><span className="emp-spark">✳</span><strong>{selected.screening_criteria?.length || 0} screening criteria</strong><p>One consistent assessment for every CV.</p><button onClick={()=>setEditing(selected)}>Review criteria ↗</button></div></div>

            <div className="emp-tabs">
              <button className={tab === "applicants" ? "active" : ""} onClick={() => setTab("applicants")}>
                Applicants{selected.counts.total > 0 ? ` (${selected.counts.total})` : ""}
              </button>
              <button className={tab === "matches" ? "active" : ""} onClick={() => setTab("matches")}>
                Find candidates
              </button>
            </div>

            {tab === "applicants" && (
              // key={} so switching posting remounts with fresh focus,
              // selection and filter rather than carrying the previous
              // role's state onto a different set of people.
              <ScreenQueue key={selected.id} postingId={selected.id} initialReviewId={reviewId} showToast={showToast} onChanged={refreshPostings} />
            )}
            {tab === "matches" && <MatchList posting={selected} showToast={showToast} />}
          </>
        )}
      </div></main>

      <div className={`toast ${toast ? "show" : ""}`} role="status"><span className="t-dot" />{toast}</div>
    </div>
  );

  async function publish(posting, status) {
    try {
      await updatePosting(posting.id, { status });
      await refreshPostings();
      showToast(
        status === "open" ? "Live — it's in candidate search now."
        : status === "paused" ? "Paused. It's out of search; applicants so far are untouched."
        : "Closed."
      );
    } catch (e) {
      showToast(e.message);
    }
  }
}

/* ── Org setup ─────────────────────────────────────────────────────────
   One screen, four fields, and only one of them required. Everything else
   about the company can be filled in later; asking for it now is how you
   turn an interested employer into a bounced one. */
function OrgSetup({ onCreated }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [country, setCountry] = useState("");
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createOrg({ name, website, country, size });
      onCreated(r.org);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="emp-gate">
      <form className="emp-gate-card" onSubmit={submit}>
        <div className="emp-wordmark"><span className="emp-brand-symbol">✳</span><span>JobCopilot<small>RECRUITING WORKSPACE</small></span></div>
        <h1>Set up your company</h1>
        <p>This is what candidates see on your postings.</p>

        <label className="field">
          <span className="field-label">Company name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc" autoFocus required />
        </label>

        <label className="field">
          <span className="field-label">Website <em>optional</em></span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" />
        </label>

        <div className="emp-row-2">
          <label className="field">
            <span className="field-label">Based in <em>optional</em></span>
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Nigeria" />
          </label>
          <label className="field">
            <span className="field-label">Team size <em>optional</em></span>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="">—</option>
              <option value="1-10">1–10</option>
              <option value="11-50">11–50</option>
              <option value="51-200">51–200</option>
              <option value="200+">200+</option>
            </select>
          </label>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button className="btn primary lg" disabled={busy || !name.trim()}>
          {busy ? "Setting up…" : "Continue"}
        </button>
        <p className="field-hint">
          Companies are verified by a person, not a form. Until that happens your
          postings show as unverified to candidates — which is honest, and still lets
          you hire.
        </p>
      </form>
    </div>
  );
}

