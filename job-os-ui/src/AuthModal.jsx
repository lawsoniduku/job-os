/**
 * AuthModal.jsx
 * =============
 * Sign up / log in + a one-time "where are you?" country picker that feeds
 * straight into the search engine's COUNTRY_TERMS keys (api/roleIntelligence.js),
 * so a logged-in user's default search is automatically scoped to their country.
 *
 * Keys here MUST match COUNTRY_TERMS keys in api/roleIntelligence.js.
 * Kept as a curated subset (full list is 50+; this is the common/launch set).
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

export const COUNTRY_LABEL = Object.fromEntries(COUNTRY_OPTIONS.filter(c => c.value).map(c => [c.value, c.label]));

export default function AuthModal({ onClose, onAuthed, mode: initialMode = "signin", user, currentCountry, onProfileSaved }) {
  const [mode, setMode] = useState(initialMode); // "signin" | "signup" | "profile"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState(currentCountry || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // "profile" mode: just update the country for an already-logged-in user.
  async function handleProfileSave(e) {
    e.preventDefault();
    if (!supabase || !user) return;
    setLoading(true); setError("");
    const { error: upErr } = await supabase.from("profiles").update({ country }).eq("id", user.id);
    setLoading(false);
    if (upErr) { setError(upErr.message); return; }
    onProfileSaved?.();
    onClose?.();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true); setError(""); setInfo("");

    try {
      if (mode === "signup") {
        // Pass country as user metadata. The DB trigger (handle_new_user)
        // reads it and writes the profile row as SECURITY DEFINER — so it
        // works even when email confirmation is on and there's no session yet.
        // (A direct profiles.update() here would silently fail RLS pre-confirmation.)
        const { data, error: signErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { country: country || "" },
            emailRedirectTo: window.location.origin,
          },
        });
        if (signErr) throw signErr;

        if (!data.session) {
          setInfo("Check your email to confirm your account, then sign in.");
          setLoading(false);
          return;
        }
        onAuthed?.();
      } else {
        const { error: inErr } = await supabase.auth.signInWithPassword({ email, password });
        if (inErr) throw inErr;
        onAuthed?.();
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">
            {mode === "profile" ? "Your location" : mode === "signup" ? "Create your account" : "Sign in"}
          </h2>
          <button onClick={onClose} className="text-gray-600 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-zinc-300 text-sm">✕</button>
        </div>

        {mode === "profile" ? (
          <form onSubmit={handleProfileSave} className="space-y-3">
            <div>
              <label className="text-xs text-gray-600 dark:text-zinc-500 block mb-1">Where are you searching from?</label>
              <select value={country} onChange={e => setCountry(e.target.value)}
                className="w-full bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-300 dark:border-zinc-600">
                {COUNTRY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <p className="text-[11px] text-gray-600 dark:text-zinc-600 mt-1">Searches will automatically be filtered to roles open to this location.</p>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl py-2.5 text-sm font-medium transition">
              {loading ? "Saving…" : "Save"}
            </button>
          </form>
        ) : (
        <>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-gray-600 dark:text-zinc-500 block mb-1">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-300 dark:border-zinc-600"
              placeholder="you@example.com" />
          </div>
          <div>
            <label className="text-xs text-gray-600 dark:text-zinc-500 block mb-1">Password</label>
            <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-300 dark:border-zinc-600"
              placeholder="At least 6 characters" />
          </div>

          {mode === "signup" && (
            <div>
              <label className="text-xs text-gray-600 dark:text-zinc-500 block mb-1">Where are you searching from?</label>
              <select value={country} onChange={e => setCountry(e.target.value)}
                className="w-full bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-300 dark:border-zinc-600">
                {COUNTRY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <p className="text-[11px] text-gray-600 dark:text-zinc-600 mt-1">We'll automatically filter searches to roles open to you. You can change this later.</p>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
          {info && <p className="text-xs text-emerald-400">{info}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl py-2.5 text-sm font-medium transition">
            {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <button onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setInfo(""); }}
          className="w-full text-center text-xs text-gray-600 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-zinc-300 mt-3">
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
        </>
        )}
      </div>
    </div>
  );
}
