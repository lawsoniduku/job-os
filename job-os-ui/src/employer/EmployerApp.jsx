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
import { useTheme } from "../lib/useTheme";
import AuthModal from "../AuthModal";
import { getMe, createOrg, listPostings, updatePosting } from "../lib/employerApi";
import PostingEditor from "./PostingEditor";
import JDComposer from "./JDComposer";
import ScreenQueue from "./ScreenQueue";
import MatchList from "./MatchList";
import "./employer.css";

export default function EmployerApp() {
  const { user, loading, signOut } = useSession();
  const { theme, toggleTheme } = useTheme();

  const [org, setOrg] = useState(null);
  const [checkingOrg, setCheckingOrg] = useState(true);
  const [postings, setPostings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null);      // posting object, or "new"
  const [tab, setTab] = useState("applicants");
  const [toast, setToast] = useState(null);
  const [showAuth, setShowAuth] = useState(false);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) { setCheckingOrg(false); return; }
    let cancelled = false;
    getMe()
      .then((r) => { if (!cancelled) setOrg(r.orgs?.[0] || null); })
      .catch(() => { if (!cancelled) setOrg(null); })
      .finally(() => { if (!cancelled) setCheckingOrg(false); });
    return () => { cancelled = true; };
  }, [user, loading]);

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

  useEffect(() => { refreshPostings(); }, [refreshPostings]);

  if (loading || checkingOrg) return <div className="emp-app" />;

  if (!user) {
    return (
      <div className="emp-gate">
        <div className="emp-gate-card">
          <div className="emp-wordmark"><span className="dot" />JobCopilot <span className="emp-badge">for employers</span></div>
          <h1>Hire people who can actually take the job.</h1>
          <p>
            Post a role, screen applicants who arrive already checked against it, and
            tell every one of them where they stand — in a click, not a paragraph.
          </p>
          <button className="btn primary lg" onClick={() => setShowAuth(true)}>Sign in to continue</button>
          <a className="emp-alt" href="/">I'm looking for work instead</a>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </div>
    );
  }

  if (!org) return <OrgSetup onCreated={(o) => { setOrg(o); showToast(`${o.name} is set up.`); }} />;

  const selected = postings.find((p) => p.id === selectedId) || null;

  return (
    <div className="emp-app">
      <nav className="emp-rail">
        <a className="emp-wordmark" href="/employer">
          <span className="dot" />JobCopilot <span className="emp-badge">hiring</span>
        </a>

        <div className="emp-org">
          <div className="emp-org-name">{org.name}</div>
          <div className="emp-org-sub">
            {org.verified_at
              ? <span className="emp-verified">Verified employer</span>
              : <span title="A person confirms the company before this appears to candidates.">Unverified</span>}
          </div>
        </div>

        <button className="btn primary emp-new" onClick={() => { setEditing("new"); }}>
          New role
        </button>

        <div className="emp-postings">
          {postings.length === 0 && (
            <p className="emp-rail-empty">No roles yet. Post one and it appears in candidate search straight away.</p>
          )}
          {postings.map((p) => (
            <button
              key={p.id}
              className={`emp-posting-item ${p.id === selectedId ? "active" : ""}`}
              onClick={() => { setSelectedId(p.id); setTab("applicants"); }}
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
            <button onClick={toggleTheme}>{theme === "dark" ? "Light" : "Dark"}</button>
            <button onClick={async () => { await signOut(); window.location.href = "/"; }}>Sign out</button>
          </div>
        </div>
      </nav>

      <main className="emp-main">
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

        {!editing && !selected && (
          <div className="emp-empty">
            <h2>Nothing posted yet</h2>
            <p>
              A role you post here goes into the same search 53,000 other listings sit in —
              except yours arrives with an eligibility filter attached, so the people who
              see it can actually take it.
            </p>
            <button className="btn primary lg" onClick={() => setEditing("new")}>Post your first role</button>
          </div>
        )}

        {!editing && selected && (
          <>
            <header className="emp-head">
              <div>
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
              <ScreenQueue key={selected.id} postingId={selected.id} showToast={showToast} onChanged={refreshPostings} />
            )}
            {tab === "matches" && <MatchList posting={selected} showToast={showToast} />}
          </>
        )}
      </main>

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
        <div className="emp-wordmark"><span className="dot" />JobCopilot <span className="emp-badge">hiring</span></div>
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
