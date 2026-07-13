/**
 * views/You.jsx — the full Eligibility Passport + career profile.
 *
 * Everything here directly powers the product:
 *   country          -> every search is eligibility-scoped to it
 *   preferred roles  -> Briefing builds your daily feed from these
 *   seniority        -> sharpens Briefing + future match scoring
 *   CV               -> Tailor & apply and Studio start from it
 *
 * Preferred roles come from the engine's own taxonomy (/ai/role-suggestions)
 * so what the user picks is exactly what the engine can match.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { extractTextFromFile } from "../lib/extractText";
import { track } from "../lib/track";
import { API } from "../lib/api";
import { COUNTRY_OPTIONS, COUNTRY_LABEL } from "../AuthModal";

// Fallback if /ai/role-suggestions is unreachable (Render cold start).
const FALLBACK_CLUSTERS = [
  "Data Analytics", "Data Engineering", "Software Engineering", "Product Management",
  "Product Design", "Customer Support", "Customer Success", "Sales",
  "Marketing", "Human Resources", "Finance", "Operations",
  "Project Management", "QA / Testing", "DevOps / SRE", "Cybersecurity",
];

const SENIORITY_OPTIONS = [
  { value: "", label: "Any level" },
  { value: "junior", label: "Junior / Entry level (0–2 yrs)" },
  { value: "mid", label: "Mid-level (2–5 yrs)" },
  { value: "senior", label: "Senior (5+ yrs)" },
];

export default function You({ shared, active, refreshProfile }) {
  const { user, profile, requireAuth, showToast, signOut, goHome } = shared;

  const [name, setName]           = useState("");
  const [country, setCountry]     = useState("");
  const [roles, setRoles]         = useState([]);        // selected role clusters
  const [seniority, setSeniority] = useState("");
  const [clusters, setClusters]   = useState(FALLBACK_CLUSTERS);
  const [saving, setSaving]       = useState(false);
  const [cvInfo, setCvInfo]       = useState(null);      // { filename, updated_at }
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // Hydrate form from profile.
  useEffect(() => {
    setName(profile?.full_name || "");
    setCountry(profile?.country || "");
    setRoles(profile?.target_roles || []);
    setSeniority(profile?.preferences?.seniority || "");
  }, [profile]);

  // Load the engine's role clusters + current CV state.
  const loadExtras = useCallback(async () => {
    fetch(`${API}/ai/role-suggestions?q=`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.clusters) && d.clusters.length) setClusters(d.clusters); })
      .catch(() => {}); // fallback list already in place
    if (user) {
      const { data } = await supabase.from("saved_cvs")
        .select("filename, updated_at").eq("user_id", user.id).maybeSingle();
      setCvInfo(data || null);
    }
  }, [user]);

  useEffect(() => { if (active) loadExtras(); }, [active, loadExtras]);

  function toggleRole(cluster) {
    setRoles((prev) =>
      prev.includes(cluster) ? prev.filter((r) => r !== cluster)
      : prev.length >= 5 ? prev            // cap at 5 — focus beats breadth
      : [...prev, cluster]
    );
  }

  async function save() {
    if (!requireAuth()) return;
    setSaving(true);
    // upsert (not update): if the profiles row is missing — e.g. an account
    // that was deleted and recreated, or any orphaned auth user — this
    // creates it instead of silently failing on a no-op update.
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email,
      full_name: name || null,
      country: country || null,
      target_roles: roles,
      preferences: { ...(profile?.preferences || {}), seniority: seniority || null },
    }, { onConflict: "id" });
    setSaving(false);
    if (error) showToast(`Couldn't save: ${error.message}`);
    else {
      track(user, "profile_saved", { roles: roles.length, seniority, country });
      showToast("Profile saved — Briefing and search now use this");
      refreshProfile?.();
    }
  }

  async function handleCvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!requireAuth()) { if (fileRef.current) fileRef.current.value = ""; return; }
    setUploading(true);
    try {
      const text = await extractTextFromFile(file);
      const { error } = await supabase.from("saved_cvs")
        .upsert({ user_id: user.id, cv_text: text, filename: file.name });
      if (error) throw new Error(error.message);
      setCvInfo({ filename: file.name, updated_at: new Date().toISOString() });
      track(user, "cv_uploaded", { via: "profile", type: file.name.split(".").pop() });
      showToast(`${file.name} saved — Tailor & apply now starts from it`);
    } catch (err) {
      showToast(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /* ── Signed-out state ─────────────────────────────────────────────────── */
  if (!user) {
    return (
      <div className="scrollarea"><div className="page">
        <div className="page-eyebrow">Profile</div>
        <h1>You</h1>
        <p className="sub">Your profile powers everything — eligibility checks, your daily Briefing, and CV tailoring. Sign in to set it up in under a minute.</p>
        <button className="btn primary" onClick={requireAuth}>Sign in or create account</button>
      </div></div>
    );
  }

  const countryLabel = COUNTRY_LABEL[country] || null;

  /* ── Signed-in ────────────────────────────────────────────────────────── */
  return (
    <div className="scrollarea"><div className="page">
      <div className="page-eyebrow">Profile</div>
      <h1>You</h1>
      <p className="sub">What the copilot knows, in plain language — visible, correctable, yours.</p>

      {/* Passport summary — always reflects the saved profile */}
      <div className="passport">
        <div className="p-eyebrow">Eligibility Passport</div>
        {countryLabel ? (
          <p>
            You're a{profile?.preferences?.seniority ? ` ${profile.preferences.seniority}-level` : ""} candidate in <b>{countryLabel}</b>
            {profile?.target_roles?.length ? <> targeting <b>{profile.target_roles.join(", ")}</b></> : null}.
            Every result is filtered to roles that are <b>worldwide-remote</b>, <b>explicitly open to {countryLabel}</b>, or <b>open to your wider region</b> — region-locked and sponsorship-walled postings never reach you.
          </p>
        ) : (
          <p>Set your location below and every search becomes eligibility-checked automatically — no more opening jobs you can't apply to.</p>
        )}
      </div>

      {/* Details */}
      <div className="studio-card">
        <h3>Details</h3>
        <div className="s-sub">These feed directly into the eligibility engine and your daily Briefing.</div>

        <div style={{ display: "grid", gap: 16, maxWidth: 460 }}>
          <div>
            <label className="field-label" htmlFor="you-name">Name</label>
            <input id="you-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>

          <div>
            <label className="field-label" htmlFor="you-email">Email</label>
            <input id="you-email" className="field" value={user.email || ""} disabled style={{ opacity: 0.6, cursor: "not-allowed" }} />
          </div>

          <div>
            <label className="field-label" htmlFor="you-country">Location</label>
            <select id="you-country" className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div>
            <label className="field-label">Preferred roles <span className="field-hint">(up to 5 — powers your Briefing)</span></label>
            <div className="role-grid">
              {clusters.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`role-chip ${roles.includes(c) ? "on" : ""}`}
                  onClick={() => toggleRole(c)}
                  aria-pressed={roles.includes(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="you-seniority">Experience level</label>
            <select id="you-seniority" className="field" value={seniority} onChange={(e) => setSeniority(e.target.value)}>
              {SENIORITY_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>
      </div>

      {/* CV */}
      <div className="studio-card">
        <h3>Your CV</h3>
        <div className="s-sub">
          {cvInfo
            ? <>On file: <b>{cvInfo.filename || "pasted text"}</b>{cvInfo.updated_at ? ` · updated ${new Date(cvInfo.updated_at).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })}` : ""} — Tailor & apply starts from this automatically.</>
            : "Upload once — every Tailor & apply starts from it. Fine-grained editing lives in Studio."}
        </div>
        <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? "Reading file…" : cvInfo ? "Replace CV (PDF / DOCX / TXT)" : "Upload CV (PDF / DOCX / TXT)"}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt,.md" style={{ display: "none" }} onChange={handleCvUpload} />
      </div>

      <div className="studio-card">
        <h3>Account</h3>
        <div className="s-sub">Signed in as {user.email}</div>
        <div className="account-actions">
          <button className="btn" onClick={goHome}>← Back to home</button>
          <button className="btn danger-outline" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div></div>
  );
}
