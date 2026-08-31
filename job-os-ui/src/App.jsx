/**
 * App.jsx — the shell: rail navigation + five surfaces.
 * Copilot · Briefing · Pipeline · Studio · You
 */
import { useState, useCallback, useEffect } from "react";
import { useSession } from "./lib/useSession";
import { useTheme } from "./lib/useTheme";
import AuthModal from "./AuthModal";
import Landing from "./Landing";
import Copilot from "./views/Copilot";
import Briefing from "./views/Briefing";
import Pipeline from "./views/Pipeline";
import Studio from "./views/Studio";
import You from "./views/You";
import ReturnNudge from "./ReturnNudge";
import EmployerInbox from "./EmployerInbox";

const NAV = [
  { key: "copilot", label: "Copilot", icon: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 20l1-4.9A8.4 8.4 0 1 1 21 11.5Z" /> },
  { key: "briefing", label: "Briefing", icon: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></> },
  { key: "pipeline", label: "Pipeline", icon: <><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="10" rx="1.5" /><rect x="17" y="4" width="5" height="13" rx="1.5" /></> },
  { key: "studio", label: "Studio", icon: <><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" /><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9" /></> },
  { key: "you", label: "You", icon: <><circle cx="12" cy="8.5" r="3.5" /><path d="M4.5 20c1.4-3.4 4.2-5 7.5-5s6.1 1.6 7.5 5" /></> },
];

export default function App() {
  const [view, setView] = useState("copilot");
  const [showAuth, setShowAuth] = useState(false);
  const [toast, setToast] = useState(null);
  // Landing page: shown to first-time visitors and signed-out users who
  // haven't entered the app yet. Signed-in users skip straight to the app.
  const [entered, setEntered] = useState(false);
  const [initialQuery, setInitialQuery] = useState(null);
  const session = useSession();
  const { theme, toggleTheme } = useTheme();
  const { user, profile, signOut, refreshProfile, loading } = session;

  // Signed-in users never see the landing page.
  useEffect(() => {
    if (user) setEntered(true);
  }, [user]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  // Views call this before any action that needs an account.
  const requireAuth = useCallback(() => {
    if (user) return true;
    setShowAuth(true);
    return false;
  }, [user]);

  const enterWithSearch = useCallback((q) => {
    setInitialQuery(q);
    setView("copilot");
    setEntered(true);
  }, []);

  const shared = { ...session, requireAuth, showToast, setView, goHome: () => setEntered(false),
    signOut: async () => { await signOut(); setEntered(false); setView("copilot"); } };
  const initial = (profile?.full_name || user?.email || "?").trim()[0]?.toUpperCase() || "?";

  // While the session is resolving, render nothing (avoids a landing flash
  // for already-signed-in users).
  if (loading) return <div className="app" />;

  // Landing page — first thing a new visitor sees.
  if (!entered) {
    return (
      <>
        <Landing
          onStart={(q) => q ? enterWithSearch(q) : setEntered(true)}
          onSignIn={() => setShowAuth(true)}
          theme={theme}
          toggleTheme={toggleTheme}
        />
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuthed={() => setEntered(true)} />}
      </>
    );
  }

  return (
    <div className="app">
      <nav className="rail" aria-label="Primary">
        <button className="wordmark" onClick={() => setEntered(false)} title="Back to home" aria-label="Back to home">
          <span className="dot" />JobCopilot
        </button>
        <div className="nav">
          {NAV.map((n) => (
            <button key={n.key} className={view === n.key ? "active" : ""} onClick={() => setView(n.key)} aria-label={n.label}>
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{n.icon}</svg>
              {n.label}
            </button>
          ))}
        </div>
        <div className="rail-foot">
          {user ? (
            <>
              <button className="userchip" onClick={() => setView("you")} title="Open profile">
                <div className="avatar">{initial}</div>
                <div>
                  <div className="u-name">{profile?.full_name || user.email?.split("@")[0]}</div>
                  <div className="u-sub">{profile?.country ? cap(profile.country) : "Set your country"}</div>
                </div>
              </button>
              <div className="rail-mini">
                <button onClick={toggleTheme}>{theme === "dark" ? "Light" : "Dark"}</button>
                <button onClick={shared.signOut}>Sign out</button>
              </div>
            </>
          ) : (
            <>
              <button className="btn primary" style={{ width: "100%" }} onClick={() => setShowAuth(true)}>
                Sign in
              </button>
              <div className="rail-mini">
                <button onClick={toggleTheme}>{theme === "dark" ? "Light mode" : "Dark mode"}</button>
              </div>
            </>
          )}
        </div>
      </nav>

      <main className="main">
        <section className={`view ${view === "copilot" ? "active" : ""}`}><Copilot shared={shared} active={view === "copilot"} initialQuery={initialQuery} onInitialConsumed={() => setInitialQuery(null)} /></section>
        <section className={`view ${view === "briefing" ? "active" : ""}`}><Briefing shared={shared} active={view === "briefing"} /></section>
        <section className={`view ${view === "pipeline" ? "active" : ""}`}><Pipeline shared={shared} active={view === "pipeline"} /></section>
        <section className={`view ${view === "studio" ? "active" : ""}`}><Studio shared={shared} active={view === "studio"} /></section>
        <section className={`view ${view === "you" ? "active" : ""}`}><You shared={shared} active={view === "you"} refreshProfile={refreshProfile} /></section>
      </main>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {/* Lives at the shell, not in a view: someone can return from an
          employer's site onto any tab, and the question belongs to the
          session rather than to a screen. */}
      {user && <ReturnNudge user={user} showToast={showToast} />}
      {/* Same reasoning as ReturnNudge: an intro request or a rejection is
          addressed to the person, not to a screen, so it belongs to the
          session and follows them across tabs. */}
      {user && <EmployerInbox user={user} showToast={showToast} />}
      <div className={`toast ${toast ? "show" : ""}`} role="status">
        <span className="t-dot" />{toast}
      </div>
    </div>
  );
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
