/**
 * Landing.jsx — the public front door. v3.
 *
 * Research-driven rules this version obeys:
 *   - Headline under 8 words (high-performing H1s average <44 chars)
 *   - Visitors scan for 5-6 seconds: the demo card IS the pitch
 *   - Specific numbers beat claims ("693 job titles" not "every title")
 *   - Minimal copy: no paragraph over 20 words anywhere on the page
 *   - WCAG AA+ contrast everywhere (tokens fixed globally)
 *   - Mobile-first: single column, 44px+ tap targets, 16px+ body text
 */
import { useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { track } from "./lib/track";

const EXAMPLES = [
  "Data analyst · Nigeria",
  "Product manager · remote",
  "Customer support · worldwide",
  "HR roles · Kenya",
];

export default function Landing({ onStart, onSignIn, theme, toggleTheme }) {
  const [q, setQ] = useState("");
  const go = () => onStart(q.trim() || undefined);
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="landing">
      <header className="lp-topbar">
        <div className="lp-brand"><span className="dot" />JobCopilot</div>
        <nav className="lp-nav">
          <button className="lp-navlink" onClick={() => scrollTo("employers")}>For employers</button>
          <button className="lp-ghost" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? "☀" : "☾"}</button>
          <button className="lp-signin" onClick={onSignIn}>Sign in</button>
        </nav>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <h1>Only see jobs you can <span className="lp-accent">actually get.</span></h1>
          <p className="lp-sub">No more region-locked listings. No more sponsorship surprises. Eligibility checked before you see anything.</p>
          <div className="lp-cta-row">
            <button className="lp-btn-primary" onClick={go}>
              Find my jobs
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
            </button>
            <button className="lp-btn-secondary" onClick={() => scrollTo("employers")}>I'm hiring</button>
          </div>
          <p className="lp-cta-note">Free · no signup to try</p>
        </div>

        {/* The demo card IS the pitch */}
        <div className="lp-hero-demo" aria-hidden="true">
          <div className="lp-demo-card">
            <div className="lp-demo-query"><span className="lp-demo-dot" />"data analyst, remote, Nigeria"</div>
            <div className="lp-demo-scan">
              <div className="lp-demo-row"><span className="lp-demo-num">250</span><span className="lp-demo-lbl">jobs scanned</span></div>
              <div className="lp-demo-row excl"><span className="lp-demo-num">207</span><span className="lp-demo-lbl">region-locked — hidden</span></div>
              <div className="lp-demo-rule" />
              <div className="lp-demo-row elig"><span className="lp-demo-num">43</span><span className="lp-demo-lbl">you can actually apply to</span></div>
            </div>
            <div className="lp-demo-job">
              <span className="lp-demo-verdict">● Eligible</span>
              <div className="lp-demo-job-title">Data Analyst · Moniepoint</div>
              <div className="lp-demo-job-reason">✓ Open to Nigeria · no sponsorship needed</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Proof strip: real numbers from the engine ────────── */}
      <section className="lp-proof">
        <div className="lp-proof-item"><span className="lp-proof-num">693</span><span className="lp-proof-lbl">job titles understood</span></div>
        <div className="lp-proof-item"><span className="lp-proof-num">29</span><span className="lp-proof-lbl">role families mapped</span></div>
        <div className="lp-proof-item"><span className="lp-proof-num">100%</span><span className="lp-proof-lbl">of results eligibility-checked</span></div>
      </section>

      {/* ── Vision band ──────────────────────────────────────── */}
      <section className="lp-vision">
        <div className="lp-vision-inner">
          <p>Building the <b>AI employment operating system for Africa.</b></p>
        </div>
      </section>

      {/* ── The problem, in three lines ──────────────────────── */}
      <section className="lp-section">
        <h2>Job search wastes your time on purpose.</h2>
        <div className="lp-pains">
          <div className="lp-pain"><span className="lp-pain-x">✕</span>"Remote" — but US-only in the fine print</div>
          <div className="lp-pain"><span className="lp-pain-x">✕</span>Same role hidden under 10 different titles</div>
          <div className="lp-pain"><span className="lp-pain-x">✕</span>Hours of applications to jobs that were never open to you</div>
          <div className="lp-pain fix"><span className="lp-pain-check">✓</span><b>JobCopilot checks first. You only see real options.</b></div>
        </div>
      </section>

      {/* ── How it works: three lines ────────────────────────── */}
      <section className="lp-section" id="how">
        <h2>Three steps. No forms.</h2>
        <div className="lp-steps">
          <div className="lp-step"><span className="lp-step-n">1</span><div><h3>Say it plainly</h3><p>"Remote product roles open to Ghana, over $50k."</p></div></div>
          <div className="lp-step"><span className="lp-step-n">2</span><div><h3>It verifies eligibility</h3><p>Region locks, visas, sponsorship — checked before you see anything.</p></div></div>
          <div className="lp-step"><span className="lp-step-n">3</span><div><h3>Apply in minutes</h3><p>Tailored CV, ready-to-send PDF, tracked to offer.</p></div></div>
        </div>
      </section>

      {/* ── What you unlock ──────────────────────────────────── */}
      <section className="lp-section">
        <h2>Your whole job hunt, one calm place.</h2>
        <div className="lp-unlock">
          <div className="lp-unlock-item"><b>Daily briefing</b><span>Fresh matches every morning</span></div>
          <div className="lp-unlock-item"><b>Pipeline</b><span>Saved → applied → offer</span></div>
          <div className="lp-unlock-item"><b>CV studio</b><span>Tailored PDF per job</span></div>
          <div className="lp-unlock-item"><b>Interview prep</b><span>Questions from the real JD</span></div>
        </div>
      </section>

      {/* ── Search band ──────────────────────────────────────── */}
      <section className="lp-band">
        <h2>Try it now.</h2>
        <div className="lp-search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="Describe the role you want…"
            aria-label="Describe the role you want"
          />
          <button className="lp-btn-primary" onClick={go}>Search</button>
        </div>
        <div className="lp-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="lp-example" onClick={() => onStart(ex.replace(" · ", " "))}>{ex}</button>
          ))}
        </div>
      </section>

      {/* ── Employers ────────────────────────────────────────── */}
      <section className="lp-employers" id="employers">
        <EmployerWaitlist />
      </section>

      <footer className="lp-footer">
        <span className="lp-brand"><span className="dot" />JobCopilot</span>
        <span className="lp-footer-note">The AI employment OS for Africa.</span>
      </footer>
    </div>
  );
}

/* ── Employer waitlist ──────────────────────────────────────── */

function EmployerWaitlist() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [roles, setRoles] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!email.trim() || !/.+@.+\..+/.test(email)) { setErr("Enter a valid work email."); return; }
    setBusy(true); setErr("");
    try {
      const { error } = await supabase.from("employer_waitlist").insert({
        email: email.trim(), company: company.trim() || null, roles_hiring: roles.trim() || null,
      });
      if (error) throw new Error(error.message);
      track(null, "employer_waitlist_joined", { hasCompany: !!company });
      setDone(true);
    } catch (e) {
      setErr(e.message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lp-emp-inner">
      <div className="lp-emp-copy">
        <div className="lp-section-label">For employers</div>
        <h2>Hire pre-verified African talent.</h2>
        <p className="lp-sub">Describe who you need in plain English. Get candidates already checked for your role. Coming soon — join the waitlist.</p>
      </div>
      <div className="lp-emp-form">
        {done ? (
          <div className="lp-emp-done">
            <div className="lp-emp-check">✓</div>
            <h3>You're on the list.</h3>
            <p>We'll reach out when employer access opens.</p>
          </div>
        ) : (
          <>
            <h3>Join the waitlist</h3>
            <input className="lp-field" type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="lp-field" placeholder="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
            <input className="lp-field" placeholder="Roles you're hiring (optional)" value={roles} onChange={(e) => setRoles(e.target.value)} />
            {err && <p className="lp-emp-err">{err}</p>}
            <button className="lp-btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={submit} disabled={busy}>
              {busy ? "Joining…" : "Request early access"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
