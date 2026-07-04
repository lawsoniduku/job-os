/**
 * AuthModal.jsx — sign in / sign up, now with Google SSO.
 *
 * Google requires one-time setup in Supabase:
 *   Dashboard -> Authentication -> Providers -> Google -> enable,
 *   paste Client ID + Secret from Google Cloud Console.
 * Until enabled, the Google button shows a clear error instead of failing silently.
 *
 * COUNTRY_OPTIONS keys MUST match COUNTRY_TERMS keys in api/roleIntelligence.js.
 */
import { useState } from "react";
import { supabase } from "./lib/supabaseClient";

export const COUNTRY_OPTIONS = [
  { value: "", label: "Prefer not to say / Anywhere" },
  { value: "nigeria", label: "Nigeria" },
  { value: "kenya", label: "Kenya" },
  { value: "ghana", label: "Ghana" },
  { value: "southafrica", label: "South Africa" },
  { value: "egypt", label: "Egypt" },
  { value: "ethiopia", label: "Ethiopia" },
  { value: "uganda", label: "Uganda" },
  { value: "rwanda", label: "Rwanda" },
  { value: "india", label: "India" },
  { value: "pakistan", label: "Pakistan" },
  { value: "philippines", label: "Philippines" },
  { value: "bangladesh", label: "Bangladesh" },
  { value: "indonesia", label: "Indonesia" },
  { value: "uk", label: "United Kingdom" },
  { value: "us", label: "United States" },
  { value: "canada", label: "Canada" },
  { value: "germany", label: "Germany" },
  { value: "brazil", label: "Brazil" },
  { value: "mexico", label: "Mexico" },
];

export const COUNTRY_LABEL = Object.fromEntries(
  COUNTRY_OPTIONS.filter((c) => c.value).map((c) => [c.value, c.label])
);

export default function AuthModal({ onClose, onAuthed }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function handleGoogle() {
    if (!supabase) return;
    setError("");
    const { error: gErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (gErr) {
      setError(
        /not enabled|provider/i.test(gErr.message || "")
          ? "Google sign-in isn't enabled yet — use email for now."
          : gErr.message
      );
    }
    // On success the browser redirects to Google; nothing more to do here.
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true); setError(""); setInfo("");
    try {
      if (mode === "signup") {
        // Country goes in as metadata; the handle_new_user trigger writes the
        // profile row as SECURITY DEFINER (works even pre-email-confirmation).
        const { data, error: signErr } = await supabase.auth.signUp({
          email, password,
          options: { data: { country: country || "" }, emailRedirectTo: window.location.origin },
        });
        if (signErr) throw signErr;
        if (!data.session) {
          setInfo("Check your email to confirm your account, then sign in.");
          setLoading(false);
          return;
        }
        onAuthed?.();
        onClose?.();
      } else {
        const { error: inErr } = await supabase.auth.signInWithPassword({ email, password });
        if (inErr) throw inErr;
        onAuthed?.();
        onClose?.();
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{mode === "signup" ? "Create your account" : "Welcome back"}</h3>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <button type="button" className="sso-btn" onClick={handleGoogle}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/>
            </svg>
            Continue with Google
          </button>

          <div className="auth-divider"><span>or use email</span></div>

          <form onSubmit={handleSubmit} className="auth-form">
            <div>
              <label className="field-label" htmlFor="auth-email">Email</label>
              <input id="auth-email" className="field" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="field-label" htmlFor="auth-pass">Password</label>
              <input id="auth-pass" className="field" type="password" required minLength={6} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
            </div>

            {mode === "signup" && (
              <div>
                <label className="field-label" htmlFor="auth-country">Where are you searching from?</label>
                <select id="auth-country" className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <p className="auth-note">Searches are automatically filtered to roles open to you. Change anytime in You.</p>
              </div>
            )}

            {error && <p className="auth-error">{error}</p>}
            {info && <p className="auth-info">{info}</p>}

            <button type="submit" className="btn primary" style={{ width: "100%", padding: "10px 0" }} disabled={loading}>
              {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>

          <button
            className="auth-switch"
            onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setInfo(""); }}
          >
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </div>
      </div>
    </div>
  );
}
