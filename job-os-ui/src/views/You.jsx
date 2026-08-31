/**
 * views/You.jsx — the full Eligibility Passport + career profile.
 *
 * Everything here directly powers the product:
 *   country          -> every search is eligibility-scoped to it
 *   preferred roles  -> Briefing builds your daily feed from these
 *   CV               -> Tailor & apply and Studio start from it, AND it is
 *                       parsed once at upload into structured skills/titles/
 *                       years (migration 012 columns, /ai/cv-extract)
 *   skills + years   -> confirmed by the user, never auto-trusted
 *   work auth        -> eligibility beyond a single country
 *   availability     -> the first thing a hiring manager checks
 *
 * THE COMPLETION LOOP. A profile is not filled in by asking for it all at
 * once; the strength meter asks for exactly ONE thing at a time, always the
 * highest-value gap, and always states what the user gets for it. The field
 * definitions and weights live in lib/profile.js so the meter and the form
 * cannot drift apart.
 *
 * CONSENT IS NOT PART OF THE SCORE. Employer visibility is its own card,
 * off by default, and worth zero points — see lib/profile.js for why.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { extractTextFromFile } from "../lib/extractText";
import { track } from "../lib/track";
import { API, aiCvExtract } from "../lib/api";
import { COUNTRY_OPTIONS, COUNTRY_LABEL } from "../AuthModal";
import {
  strengthOf, strengthLabel, AVAILABILITY_OPTIONS, availabilityLabel, employerPreview,
} from "../lib/profile";

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

// Which card each strength field lives in, so "Add this" can scroll to it.
const SECTION_ANCHOR = {
  details: "you-details",
  cv: "you-cv",
  skills: "you-skills",
  eligibility: "you-eligibility",
};

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
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
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

  const strength = useMemo(() => strengthOf(profile, cvInfo), [profile, cvInfo]);

  /* ── One writer for every card ──────────────────────────────────────────
   * upsert (not update): if the profiles row is missing — e.g. an account
   * that was deleted and recreated, or any orphaned auth user — this creates
   * it instead of silently failing on a no-op update. id + email are always
   * included so an insert produces a usable row.
   *
   * Stamps profile_completed_at the first time a profile crosses the
   * employer-ready bar. It is set once and never cleared: it records when
   * they got there, not whether they are still there.
   */
  const patchProfile = useCallback(async (patch, { event, eventProps } = {}) => {
    if (!user) return false;
    const willBeReady = strengthOf({ ...profile, ...patch }, cvInfo).employerReady;
    const body = { id: user.id, email: user.email, ...patch };
    if (willBeReady && !profile?.profile_completed_at) {
      body.profile_completed_at = new Date().toISOString();
    }
    const { error } = await supabase.from("profiles").upsert(body, { onConflict: "id" });
    if (error) { showToast(`Couldn't save: ${error.message}`); return false; }
    if (event) track(user, event, eventProps || {});
    if (body.profile_completed_at) track(user, "profile_employer_ready", { pct: strength.pct });
    refreshProfile?.();
    return true;
  }, [user, profile, cvInfo, strength.pct, showToast, refreshProfile]);

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
    const ok = await patchProfile({
      full_name: name || null,
      country: country || null,
      target_roles: roles,
      preferences: { ...(profile?.preferences || {}), seniority: seniority || null },
    }, { event: "profile_saved", eventProps: { roles: roles.length, seniority, country } });
    setSaving(false);
    if (ok) showToast("Saved — Briefing and search now use this");
  }

  /* ── CV upload, then the parse that fills the cv_* columns ────────────── */
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
      showToast(`${file.name} saved — reading it now`);
      runExtraction(text);           // deliberately not awaited
    } catch (err) {
      showToast(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /**
   * The extraction pass. Writes the RAW CLAIMS to the cv_* columns only —
   * never to skills/headline/years_experience, which are the user's
   * confirmed values. The review card below is what promotes one to the
   * other.
   *
   * A failure here is silent by design: the CV is already saved, the upload
   * succeeded, and an error toast about a background parse would read as if
   * it hadn't.
   */
  const runExtraction = useCallback(async (cvText) => {
    if (!user || !cvText?.trim()) return;
    setExtracting(true);
    setExtractError("");
    try {
      const { extract } = await aiCvExtract({ cvText });
      if (!extract) throw new Error("The reader returned nothing usable.");

      // The DB write is checked, not fired and forgotten. A silent failure
      // here is indistinguishable from "the parse didn't work" to the user,
      // and it is exactly how a missing column stays invisible for a week.
      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email,
        cv_extract: extract,
        cv_skills: extract.skills || [],
        cv_titles: extract.titles || [],
        cv_years: Number.isFinite(extract.years_experience) ? extract.years_experience : null,
        cv_parsed_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (error) throw new Error(error.message);

      track(user, "cv_extracted", {
        skills: extract.skills?.length || 0,
        years: extract.years_experience || 0,
      });
      refreshProfile?.();
    } catch (err) {
      // Non-blocking — the CV itself is saved and the product still works —
      // but never invisible. "Read my CV" is the retry.
      if (import.meta.env.DEV) console.warn("cv extraction:", err.message);
      setExtractError(err.message || "Couldn't read that CV.");
    } finally {
      setExtracting(false);
    }
  }, [user, refreshProfile]);

  // Re-parse on demand — covers CVs uploaded before extraction existed, and
  // gives a retry path when the model was cold or offline.
  async function reExtract() {
    if (!requireAuth()) return;
    const { data } = await supabase.from("saved_cvs")
      .select("cv_text").eq("user_id", user.id).maybeSingle();
    if (!data?.cv_text) return showToast("Upload a CV first");
    showToast("Reading your CV…");
    await runExtraction(data.cv_text);
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
  const extract = profile?.cv_extract || {};
  // Show the review card once the CV has been parsed but the user hasn't yet
  // confirmed anything off it. Driven by saved state, not local state, so it
  // survives a refresh and reappears until it's dealt with.
  const needsReview =
    !!profile?.cv_parsed_at &&
    !(profile?.skills?.length) &&
    !!(extract.skills?.length || extract.headline || extract.years_experience);

  /* ── Signed-in ────────────────────────────────────────────────────────── */
  return (
    <div className="scrollarea"><div className="page">
      <div className="page-eyebrow">Profile</div>
      <h1>You</h1>
      <p className="sub">What the copilot knows, in plain language — visible, correctable, yours.</p>

      <StrengthMeter strength={strength} />

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
        {profile?.work_authorization?.residence && profile.work_authorization.authorizations?.length > 1 && (
          <div className="p-note">
            You also hold work rights in{" "}
            <b>{profile.work_authorization.authorizations
              .filter((a) => a !== profile.work_authorization.residence)
              .map((a) => COUNTRY_LABEL[a] || a).join(", ")}</b> — those roles reach you too.
          </div>
        )}
      </div>

      {/* Details */}
      <div className="studio-card" id={SECTION_ANCHOR.details}>
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
      <div className="studio-card" id={SECTION_ANCHOR.cv}>
        <h3>Your CV</h3>
        <div className="s-sub">
          {cvInfo
            ? <>On file: <b>{cvInfo.filename || "pasted text"}</b>{cvInfo.updated_at ? ` · updated ${new Date(cvInfo.updated_at).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })}` : ""} — Tailor &amp; apply starts from this automatically.</>
            : "Upload once — every Tailor & apply starts from it, and we read your skills straight off it so you never type them in."}
        </div>
        <div className="cv-upload-row" style={{ marginBottom: 0 }}>
          <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={uploading || extracting}>
            {uploading ? "Reading file…" : cvInfo ? "Replace CV (PDF / DOCX / TXT)" : "Upload CV (PDF / DOCX / TXT)"}
          </button>
          {cvInfo && !profile?.cv_parsed_at && !extracting && (
            <button className="btn" onClick={reExtract}>Read my CV</button>
          )}
          {extracting && <span className="cv-source">Reading your CV — this takes a few seconds…</span>}
          {!extracting && profile?.cv_parsed_at && !extractError && (
            <span className="cv-source">
              Read {new Date(profile.cv_parsed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          )}
        </div>
        {extractError && !extracting && (
          <div className="cv-error">
            Couldn't read your CV: {extractError}
            <button className="btn sm" onClick={reExtract}>Try again</button>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt,.md" style={{ display: "none" }} onChange={handleCvUpload} />
      </div>

      {/* Skills & experience — the review card, then the confirmed state */}
      <SkillsCard
        anchor={SECTION_ANCHOR.skills}
        profile={profile}
        extract={extract}
        needsReview={needsReview}
        onSave={patchProfile}
        showToast={showToast}
      />

      {/* Eligibility, availability, salary */}
      <EligibilityCard
        anchor={SECTION_ANCHOR.eligibility}
        profile={profile}
        onSave={patchProfile}
        showToast={showToast}
      />

      {/* Employer visibility — consent, never scored */}
      <VisibilityCard
        user={user}
        profile={profile}
        strength={strength}
        onSave={patchProfile}
        showToast={showToast}
      />

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

/* ── Strength meter ───────────────────────────────────────────────────────
 * Asks for one thing, states what it buys, and links straight to the field.
 * The percentage is honest — it never rounds up to flatter, and it does not
 * congratulate below 100.
 */
function StrengthMeter({ strength }) {
  const { pct, next, employerReady, complete, missing } = strength;

  function jumpTo(section) {
    const el = document.getElementById(SECTION_ANCHOR[section]);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  }

  return (
    <div className={`strength ${complete ? "done" : ""}`}>
      <div className="strength-top">
        <div>
          <div className="st-label">Profile strength</div>
          <div className="st-state">{strengthLabel(pct)}</div>
        </div>
        <div className="st-pct">{pct}<span>%</span></div>
      </div>

      <div className="strength-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Profile strength">
        <div className="strength-fill" style={{ width: `${pct}%` }} />
      </div>

      {next ? (
        <div className="strength-next">
          <div>
            <div className="sn-what">Next: {next.label.toLowerCase()}</div>
            <div className="sn-why">{next.unlocks}</div>
          </div>
          <button className="btn" onClick={() => jumpTo(next.section)}>Add it</button>
        </div>
      ) : (
        <div className="strength-next">
          <div>
            <div className="sn-what">Everything's filled in</div>
            <div className="sn-why">Search, Briefing and tailoring are all running on your full profile.</div>
          </div>
        </div>
      )}

      {!complete && (
        <div className="strength-foot">
          {employerReady
            ? "Enough is on file for employers to find you — the rest just sharpens your own matches."
            : `${missing.length} thing${missing.length === 1 ? "" : "s"} left. Each one makes your results measurably better.`}
        </div>
      )}
    </div>
  );
}

/* ── Skills & experience ──────────────────────────────────────────────────
 * The claim -> confirmation step. cv_skills is what the document said;
 * skills is what the person stands behind. 012 requires the employer side to
 * keep that distinction, which means the UI has to create it first.
 */
function SkillsCard({ anchor, profile, extract, needsReview, onSave, showToast }) {
  const [skills, setSkills]     = useState([]);
  const [headline, setHeadline] = useState("");
  const [years, setYears]       = useState("");
  const [draft, setDraft]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [editing, setEditing]   = useState(false);

  // Seed from confirmed values, falling back to the parse when nothing has
  // been confirmed yet — so the review card opens pre-filled with the CV's
  // own answers and confirming is one click, not eight.
  useEffect(() => {
    setSkills(profile?.skills?.length ? profile.skills : (extract.skills || []));
    setHeadline(profile?.headline || extract.headline || "");
    const y = Number.isFinite(profile?.years_experience) ? profile.years_experience
            : Number.isFinite(extract.years_experience) ? extract.years_experience : "";
    setYears(y === "" ? "" : String(y));
  }, [profile, extract]);

  const open = needsReview || editing;

  function addSkill() {
    const s = draft.trim();
    if (!s) return;
    if (skills.length >= 20) return showToast("20 skills is plenty — remove one first");
    if (skills.some((x) => x.toLowerCase() === s.toLowerCase())) { setDraft(""); return; }
    setSkills([...skills, s]);
    setDraft("");
  }

  async function confirm() {
    setSaving(true);
    const n = parseInt(years, 10);
    const ok = await onSave({
      skills,
      headline: headline.trim() || null,
      years_experience: Number.isFinite(n) && n >= 0 && n <= 60 ? n : null,
    }, {
      event: needsReview ? "cv_extract_confirmed" : "skills_edited",
      eventProps: { skills: skills.length, edited: skills.length !== (extract.skills?.length || 0) },
    });
    setSaving(false);
    if (ok) { setEditing(false); showToast("Saved — this is what you stand behind"); }
  }

  /* Nothing parsed and nothing confirmed: point at the CV instead of showing
     an empty form. The CV route is one click; the form is twenty. */
  if (!open && !profile?.skills?.length) {
    return (
      <div className="studio-card" id={anchor}>
        <h3>Skills &amp; experience</h3>
        <div className="s-sub">
          Upload a CV above and we'll read your skills, titles and years off it — then you check them. Faster than typing, and you stay in control of every line.
        </div>
        <button className="btn" onClick={() => setEditing(true)}>Enter them manually instead</button>
      </div>
    );
  }

  /* Confirmed and settled: a summary, not a form. */
  if (!open) {
    return (
      <div className="studio-card" id={anchor}>
        <h3>Skills &amp; experience</h3>
        <div className="s-sub">
          {profile.headline ? <><b>{profile.headline}</b>{Number.isFinite(profile.years_experience) ? ` · ${profile.years_experience} yrs` : ""} — </> : null}
          confirmed by you{profile?.cv_parsed_at ? ", read from your CV" : ""}.
        </div>
        <div className="skill-row">
          {profile.skills.map((s) => <span className="skill-chip" key={s}>{s}</span>)}
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`studio-card ${needsReview ? "review" : ""}`} id={anchor}>
      <h3>{needsReview ? "Does this look right?" : "Skills & experience"}</h3>
      <div className="s-sub">
        {needsReview
          ? "We read this off your CV. Nothing counts until you confirm it — remove anything that's wrong, add anything we missed."
          : "What you stand behind. Kept separate from the raw CV text on purpose."}
      </div>

      <div style={{ display: "grid", gap: 16, maxWidth: 460 }}>
        <div>
          <label className="field-label" htmlFor="you-headline">Current or most recent title</label>
          <input id="you-headline" className="field" value={headline} maxLength={80}
                 onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Data Analyst" />
        </div>
        <div>
          <label className="field-label" htmlFor="you-years">Years of experience</label>
          <input id="you-years" className="field" type="number" min="0" max="60" value={years}
                 onChange={(e) => setYears(e.target.value)} placeholder="e.g. 4" style={{ maxWidth: 140 }} />
        </div>
      </div>

      <label className="field-label" style={{ marginTop: 16 }}>
        Skills <span className="field-hint">({skills.length}/20 — tap × to remove)</span>
      </label>
      <div className="skill-row">
        {skills.map((s) => (
          <span className="skill-chip on" key={s}>
            {s}
            <button className="x" onClick={() => setSkills(skills.filter((x) => x !== s))} aria-label={`Remove ${s}`}>×</button>
          </span>
        ))}
        {skills.length === 0 && <span className="s-sub" style={{ margin: 0 }}>Nothing yet — add your first below.</span>}
      </div>

      <div className="chip-input-row">
        <input
          className="field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
          placeholder="Add a skill and press Enter"
        />
        <button className="btn" onClick={addSkill} disabled={!draft.trim()}>Add</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button className="btn primary" onClick={confirm} disabled={saving}>
          {saving ? "Saving…" : needsReview ? "Looks right — confirm" : "Save"}
        </button>
        {!needsReview && <button className="btn" onClick={() => setEditing(false)}>Cancel</button>}
      </div>
    </div>
  );
}

/* ── Eligibility, availability, salary ────────────────────────────────────
 * The three things no CV can tell us. Work authorization is the one that
 * earns its keep twice: it sharpens the user's own search results AND it is
 * rung 1 of the verification ladder, the only rung we can honestly claim
 * without a vendor.
 */
function EligibilityCard({ anchor, profile, onSave, showToast }) {
  const wa = profile?.work_authorization || {};
  const [residence, setResidence]   = useState("");
  const [citizenship, setCitizenship] = useState("");
  const [auths, setAuths]           = useState([]);
  const [sponsor, setSponsor]       = useState(false);
  const [availability, setAvail]    = useState("");
  const [salary, setSalary]         = useState("");
  const [moreAuth, setMoreAuth]     = useState(false);
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    const w = profile?.work_authorization || {};
    setResidence(w.residence || profile?.country || "");
    setCitizenship(w.citizenship || "");
    setAuths(w.authorizations || []);
    setSponsor(!!w.needs_sponsorship);
    setAvail(profile?.availability || "");
    setSalary(Number.isFinite(profile?.target_salary_min) ? String(profile.target_salary_min) : "");
    setMoreAuth((w.authorizations || []).length > 1);
  }, [profile]);

  function toggleAuth(c) {
    setAuths((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  }

  async function saveAll() {
    if (!residence) return showToast("Where you live is the one field this needs");
    setSaving(true);
    const n = parseInt(salary, 10);
    // Residence always counts as an authorization — you can work where you
    // legally live — so the array is never missing the obvious entry.
    const authorizations = [...new Set([residence, ...auths])];
    const ok = await onSave({
      work_authorization: {
        ...(profile?.work_authorization || {}),
        residence,
        citizenship: citizenship || residence,
        authorizations,
        needs_sponsorship: sponsor,
        timezone: wa.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      },
      availability: availability || null,
      target_salary_min: Number.isFinite(n) && n > 0 ? n : null,
    }, {
      event: "eligibility_saved",
      eventProps: { authorizations: authorizations.length, sponsor, availability: availability || null },
    });
    setSaving(false);
    if (ok) showToast("Saved — your eligibility check just got sharper");
  }

  return (
    <div className="studio-card" id={anchor}>
      <h3>Right to work &amp; availability</h3>
      <div className="s-sub">
        Country alone is a blunt filter. A second passport or an existing visa opens roles your location would otherwise hide — and "when can you start" is the first thing a hiring manager checks.
      </div>

      <div style={{ display: "grid", gap: 16, maxWidth: 460 }}>
        <div>
          <label className="field-label" htmlFor="you-residence">Where you live</label>
          <select id="you-residence" className="field" value={residence} onChange={(e) => setResidence(e.target.value)}>
            {COUNTRY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.value ? c.label : "Select…"}</option>)}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="you-citizenship">Citizenship <span className="field-hint">(if different)</span></label>
          <select id="you-citizenship" className="field" value={citizenship} onChange={(e) => setCitizenship(e.target.value)}>
            {COUNTRY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.value ? c.label : "Same as where I live"}</option>)}
          </select>
        </div>

        <div>
          <label className="check-row">
            <input type="checkbox" checked={sponsor} onChange={(e) => setSponsor(e.target.checked)} />
            <span>I'd need visa sponsorship to work abroad</span>
          </label>
          <div className="field-hint" style={{ marginTop: 4 }}>
            Tells us to stop showing you roles that explicitly rule sponsorship out.
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="you-availability">When you could start</label>
          <select id="you-availability" className="field" value={availability} onChange={(e) => setAvail(e.target.value)}>
            <option value="">Select…</option>
            {AVAILABILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="you-salary">Lowest salary you'd accept <span className="field-hint">(USD per year)</span></label>
          <input id="you-salary" className="field" type="number" min="0" step="1000" value={salary}
                 onChange={(e) => setSalary(e.target.value)} placeholder="e.g. 45000" style={{ maxWidth: 200 }} />
          <div className="field-hint" style={{ marginTop: 4 }}>
            Roles paying under this stop taking up space in your feed. Never shown on a posting.
          </div>
        </div>
      </div>

      {!moreAuth ? (
        <button className="btn" style={{ marginTop: 16 }} onClick={() => setMoreAuth(true)}>
          I can also work somewhere else legally
        </button>
      ) : (
        <div style={{ marginTop: 16 }}>
          <label className="field-label">
            Anywhere else you can work without sponsorship <span className="field-hint">(passport, visa, residency)</span>
          </label>
          <div className="role-grid">
            {COUNTRY_OPTIONS.filter((c) => c.value && c.value !== residence).map((c) => (
              <button key={c.value} type="button"
                      className={`role-chip ${auths.includes(c.value) ? "on" : ""}`}
                      onClick={() => toggleAuth(c.value)} aria-pressed={auths.includes(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <button className="btn primary" onClick={saveAll} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/* ── Employer visibility ──────────────────────────────────────────────────
 * Off by default and worth zero completion points. The toggle is the ONLY
 * thing that puts a candidate into an employer query — migration 012 keeps
 * profiles owner-read-only precisely so this switch is the whole gate.
 *
 * The preview is the honest half: before deciding, they see exactly the row
 * an employer would get. It also turns out to be the strongest reason anyone
 * finishes their profile, which is why it sits here rather than in a modal.
 */
function VisibilityCard({ user, profile, strength, onSave, showToast }) {
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const on = !!profile?.visible_to_employers;
  const preview = useMemo(() => employerPreview(profile), [profile]);

  async function toggle() {
    setBusy(true);
    const next = !on;
    const ok = await onSave({
      visible_to_employers: next,
      visibility_updated_at: new Date().toISOString(),
    }, { event: next ? "visibility_on" : "visibility_off", eventProps: { pct: strength.pct } });
    setBusy(false);
    if (ok) {
      showToast(next
        ? "You're visible to verified employers — switch off any time"
        : "Hidden again. No employer can see your profile.");
    }
  }

  return (
    <div className={`studio-card consent ${on ? "on" : ""}`}>
      <h3>Let employers find you</h3>
      <div className="s-sub">
        Off unless you turn it on. We're building a hiring side where employers search for people
        who are actually eligible for their roles — this is how you'd appear in it.
      </div>

      <div className="consent-what">
        <div className="cw-head">If you switch this on, a verified employer can see:</div>
        <ul>
          <li>Your first name, country, current title and years of experience</li>
          <li>The skills you've confirmed — never the raw CV file</li>
          <li>When you could start, and where you can legally work</li>
          <li>That you've been applying to roles in a given field, as a count</li>
        </ul>
        <div className="cw-head" style={{ marginTop: 12 }}>They cannot see:</div>
        <ul>
          <li>Your email, phone number or address — contact only happens if you accept</li>
          <li>Your full name, your CV document, or which specific jobs you applied to</li>
        </ul>
      </div>

      <div className="consent-row">
        <button
          className={`switch ${on ? "on" : ""}`}
          role="switch"
          aria-checked={on}
          aria-label="Visible to employers"
          onClick={toggle}
          disabled={busy}
        >
          <span className="knob" />
        </button>
        <div>
          <div className="cs-state">{on ? "Visible to employers" : "Not visible"}</div>
          <div className="cs-sub">
            {on && profile?.visibility_updated_at
              ? `On since ${new Date(profile.visibility_updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
              : "You can change this whenever you want."}
          </div>
        </div>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setShowPreview((s) => !s)}>
          {showPreview ? "Hide preview" : "See what they'd see"}
        </button>
      </div>

      {showPreview && <EmployerPreview preview={preview} ready={strength.employerReady} user={user} />}
    </div>
  );
}

/* The candidate's-eye view of an employer shortlist row. Thin data looks
   thin here, which is the point — it is the most persuasive completion
   prompt in the product because it is simply true. */
function EmployerPreview({ preview, ready, user }) {
  const p = preview;
  return (
    <div className="emp-preview">
      <div className="ep-eyebrow">Employer view</div>
      <div className="ep-card">
        <div className="ep-top">
          <div className="avatar">{(p.displayName[0] || "?").toUpperCase()}</div>
          <div>
            <div className="ep-name">
              {p.displayName}{p.country ? ` · ${COUNTRY_LABEL[p.country] || p.country}` : ""}
            </div>
            <div className="ep-head">
              {p.headline || <span className="ep-missing">No title on file</span>}
              {Number.isFinite(p.years) ? ` · ${p.years} yrs` : ""}
            </div>
          </div>
        </div>

        <div className="ep-row">
          <span className="ep-k">Skills</span>
          <span className="ep-v">
            {p.skills.length
              ? <>
                  {p.skills.map((s) => <span className="skill-chip sm" key={s}>{s}</span>)}
                  <span className={`ep-tag ${p.skillsConfirmed ? "ok" : ""}`}>
                    {p.skillsConfirmed ? "confirmed by candidate" : "parsed from CV, unconfirmed"}
                  </span>
                </>
              : <span className="ep-missing">None listed</span>}
          </span>
        </div>

        <div className="ep-row">
          <span className="ep-k">Available</span>
          <span className="ep-v">{p.availability || <span className="ep-missing">Not stated</span>}</span>
        </div>

        <div className="ep-row">
          <span className="ep-k">Can work in</span>
          <span className="ep-v">
            {p.workAuth?.authorizations?.length
              ? p.workAuth.authorizations.map((a) => COUNTRY_LABEL[a] || a).join(", ")
                + (p.workAuth.needs_sponsorship ? " · needs sponsorship elsewhere" : "")
              : <span className="ep-missing">Not stated</span>}
          </span>
        </div>

        <div className="ep-row">
          <span className="ep-k">Contact</span>
          <span className="ep-v ep-locked">
            Hidden — {user?.email ? "an employer must ask, and you decide" : "you decide"}
          </span>
        </div>
      </div>

      <div className="ep-foot">
        {ready
          ? "This is a complete row. An employer searching your field and country would find you."
          : "Gaps show up as “not stated”, and most employers filter those rows out. Filling them in is what puts you in front of people."}
      </div>
    </div>
  );
}
