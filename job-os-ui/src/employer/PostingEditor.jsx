/**
 * employer/PostingEditor.jsx — create or edit a role.
 *
 * Two ways in, because employers arrive with a job description already
 * written far more often than not: paste it and let the model fill the
 * form, or type it. The paste path NEVER saves directly — it populates
 * fields the person then reads and corrects. A model that quietly invented
 * a salary band would be worse than no parsing at all.
 */
import { useState } from "react";
import { createPosting, updatePosting, parseJD } from "../lib/employerApi";

const REMOTE = [
  { v: "", l: "—" },
  { v: "remote", l: "Remote" },
  { v: "hybrid", l: "Hybrid" },
  { v: "onsite", l: "On-site" },
];
const EMPLOYMENT = [
  { v: "", l: "—" },
  { v: "full_time", l: "Full-time" },
  { v: "part_time", l: "Part-time" },
  { v: "contract", l: "Contract" },
  { v: "internship", l: "Internship" },
];
const SENIORITY = [
  { v: "", l: "—" },
  { v: "junior", l: "Junior" },
  { v: "mid", l: "Mid" },
  { v: "senior", l: "Senior" },
  { v: "lead", l: "Lead" },
];

export default function PostingEditor({ posting, onCancel, onSaved, showToast }) {
  const isNew = !posting;
  const [f, setF] = useState(() => ({
    title: posting?.title || "",
    description: posting?.description || "",
    location: posting?.location || "",
    remote_type: posting?.remote_type || "",
    employment_type: posting?.employment_type || "",
    seniority: posting?.seniority || "",
    salary_min: posting?.salary_min || "",
    salary_max: posting?.salary_max || "",
    eligible_countries: (posting?.eligible_countries || []).join(", "),
  }));
  const [paste, setPaste] = useState("");
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showPaste, setShowPaste] = useState(isNew);

  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  async function runParse() {
    if (!paste.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const { parsed } = await parseJD(paste);
      setF((prev) => ({
        ...prev,
        title: parsed.title || prev.title,
        description: paste,
        location: parsed.location || prev.location,
        remote_type: parsed.remote_type || prev.remote_type,
        employment_type: parsed.employment_type || prev.employment_type,
        seniority: parsed.seniority || prev.seniority,
        salary_min: parsed.salary_min ?? prev.salary_min,
        salary_max: parsed.salary_max ?? prev.salary_max,
        eligible_countries: (parsed.eligible_countries || []).join(", ") || prev.eligible_countries,
      }));
      setShowPaste(false);
      showToast?.("Filled in from your description — check it before publishing.");
    } catch (e) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  }

  async function save(status) {
    if (!f.title.trim()) { setError("A job title is required."); return; }
    setBusy(true);
    setError(null);
    const body = {
      ...f,
      salary_min: f.salary_min === "" ? null : Number(f.salary_min),
      salary_max: f.salary_max === "" ? null : Number(f.salary_max),
      eligible_countries: f.eligible_countries.split(",").map((s) => s.trim()).filter(Boolean),
    };
    try {
      let saved;
      if (isNew) {
        const r = await createPosting(body);
        saved = r.posting;
        if (status === "open") saved = (await updatePosting(saved.id, { status: "open" })).posting;
      } else {
        saved = (await updatePosting(posting.id, status ? { ...body, status } : body)).posting;
      }
      onSaved(saved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="emp-editor">
      <header className="emp-head">
        <h1>{isNew ? "New role" : "Edit role"}</h1>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </header>

      {showPaste && (
        <section className="emp-paste">
          <h3>Already written it?</h3>
          <p>Paste the description and we'll fill the form in. You check it before anything goes live.</p>
          <textarea
            rows={7}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste the full job description…"
          />
          <div className="emp-paste-actions">
            <button className="btn primary" onClick={runParse} disabled={parsing || !paste.trim()}>
              {parsing ? "Reading…" : "Fill the form"}
            </button>
            <button className="btn" onClick={() => setShowPaste(false)}>I'll type it</button>
          </div>
        </section>
      )}

      <div className="emp-form">
        <label className="field">
          <span className="field-label">Job title</span>
          <input value={f.title} onChange={set("title")} placeholder="Senior Backend Engineer" />
          <span className="field-hint">
            We classify the role from this to decide which searches it appears in, so
            write the title people would search for — not an internal one.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Description</span>
          <textarea rows={10} value={f.description} onChange={set("description")}
            placeholder="What the role is, what they'll do, what you need from them…" />
        </label>

        <div className="emp-row-3">
          <label className="field">
            <span className="field-label">Location</span>
            <input value={f.location} onChange={set("location")} placeholder="Lagos / Remote" />
          </label>
          <label className="field">
            <span className="field-label">Arrangement</span>
            <select value={f.remote_type} onChange={set("remote_type")}>
              {REMOTE.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Type</span>
            <select value={f.employment_type} onChange={set("employment_type")}>
              {EMPLOYMENT.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </label>
        </div>

        <div className="emp-row-3">
          <label className="field">
            <span className="field-label">Seniority</span>
            <select value={f.seniority} onChange={set("seniority")}>
              {SENIORITY.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Salary from <em>USD/yr</em></span>
            <input type="number" value={f.salary_min} onChange={set("salary_min")} placeholder="40000" />
          </label>
          <label className="field">
            <span className="field-label">Salary to <em>USD/yr</em></span>
            <input type="number" value={f.salary_max} onChange={set("salary_max")} placeholder="60000" />
          </label>
        </div>

        {/* The field that does the most work in the whole product. It is what
            lets a candidate be told "eligible" rather than "maybe", and what
            keeps this from being another board that wastes their time. */}
        <label className="field emp-elig">
          <span className="field-label">Countries you can employ in</span>
          <input
            value={f.eligible_countries}
            onChange={set("eligible_countries")}
            placeholder="Nigeria, Kenya, South Africa"
          />
          <span className="field-hint">
            Comma-separated. This is the one thing no other job board asks you, and it's
            why candidates trust what they see here: it filters out everyone you couldn't
            legally hire before they spend an evening applying. Leave it blank if you
            genuinely don't know — we'll say "not stated" rather than guess on your behalf.
          </span>
        </label>

        {error && <div className="auth-error">{error}</div>}

        <div className="emp-form-actions">
          <button className="btn" onClick={() => save(null)} disabled={busy}>
            {busy ? "Saving…" : isNew ? "Save as draft" : "Save changes"}
          </button>
          {(isNew || posting?.status !== "open") && (
            <button className="btn primary" onClick={() => save("open")} disabled={busy}>
              {busy ? "Publishing…" : "Publish to candidate search"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
