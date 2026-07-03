/**
 * views/You.jsx — profile as an Eligibility Passport.
 * Plain-language, visible, correctable. The country here feeds every search.
 */
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

// Keep in sync with the backend's COUNTRY_TERMS keys (roleIntelligence.js).
const COUNTRIES = [
  ["nigeria", "Nigeria"], ["kenya", "Kenya"], ["ghana", "Ghana"],
  ["southafrica", "South Africa"], ["egypt", "Egypt"], ["rwanda", "Rwanda"],
  ["ethiopia", "Ethiopia"], ["tanzania", "Tanzania"], ["uganda", "Uganda"],
  ["senegal", "Senegal"], ["morocco", "Morocco"], ["zambia", "Zambia"],
  ["zimbabwe", "Zimbabwe"], ["india", "India"], ["pakistan", "Pakistan"],
  ["philippines", "Philippines"], ["indonesia", "Indonesia"], ["brazil", "Brazil"],
  ["mexico", "Mexico"], ["argentina", "Argentina"], ["colombia", "Colombia"],
  ["uk", "United Kingdom"], ["us", "United States"], ["canada", "Canada"],
  ["germany", "Germany"], ["france", "France"], ["spain", "Spain"],
  ["portugal", "Portugal"], ["netherlands", "Netherlands"], ["poland", "Poland"],
  ["turkey", "Turkey"], ["uae", "United Arab Emirates"], ["australia", "Australia"],
];

export default function You({ shared, active, refreshProfile }) {
  const { user, profile, showToast } = shared;
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(profile?.full_name || "");
    setCountry(profile?.country || "");
  }, [profile]);

  async function save() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles")
      .update({ full_name: name || null, country: country || null })
      .eq("id", user.id);
    setSaving(false);
    if (error) showToast(`Couldn't save: ${error.message}`);
    else { showToast("Saved — every search now checks eligibility for this"); refreshProfile?.(); }
  }

  const countryLabel = COUNTRIES.find(([k]) => k === country)?.[1] || null;

  if (!user) {
    return (
      <div className="scrollarea"><div className="page">
        <div className="page-eyebrow">Profile</div>
        <h1>You</h1>
        <p className="sub">Sign in to set your Eligibility Passport — where you are, where you can work. It powers every verdict in the product.</p>
      </div></div>
    );
  }

  return (
    <div className="scrollarea"><div className="page">
      <div className="page-eyebrow">Profile</div>
      <h1>You</h1>
      <p className="sub">What the copilot knows, in plain language — visible, correctable, yours.</p>

      <div className="passport">
        <div className="p-eyebrow">Eligibility Passport</div>
        {countryLabel ? (
          <p>
            You're searching as a candidate in <b>{countryLabel}</b>. Every result is filtered to roles that are
            <b> worldwide-remote</b>, <b>explicitly open to {countryLabel}</b>, or <b>open to your wider region</b>.
            Region-locked and sponsorship-walled postings are excluded before you ever see them.
          </p>
        ) : (
          <p>Set your country below and every search becomes eligibility-checked automatically — no more opening jobs you can't apply to.</p>
        )}
        <div className="p-note">Coming next: work authorizations, timezone bands, and sponsorship preferences.</div>
      </div>

      <div className="studio-card">
        <h3>Details</h3>
        <div className="s-sub">These feed directly into the eligibility engine.</div>
        <div style={{ display: "grid", gap: 14, maxWidth: 420 }}>
          <div>
            <label className="field-label" htmlFor="you-name">Name</label>
            <input id="you-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div>
            <label className="field-label" htmlFor="you-country">Country</label>
            <select id="you-country" className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">Select your country…</option>
              {COUNTRIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <div className="studio-card">
        <h3>Account</h3>
        <div className="s-sub" style={{ marginBottom: 0 }}>Signed in as {user.email}</div>
      </div>
    </div></div>
  );
}
