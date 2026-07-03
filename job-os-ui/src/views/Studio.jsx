/**
 * views/Studio.jsx — documents workspace.
 * V1: the Master CV. Save it once and every "Tailor & apply" in Copilot
 * starts from it automatically. Tailored versions land in Pipeline as
 * cv_label on the application record.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { extractTextFromFile } from "../lib/extractText";

export default function Studio({ shared, active }) {
  const { user, showToast, setView } = shared;
  const [cvText, setCvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [versions, setVersions] = useState([]);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("saved_cvs")
      .select("cv_text, filename, updated_at").eq("user_id", user.id).maybeSingle();
    if (data) {
      setCvText(data.cv_text || "");
      setFileName(data.filename || "");
      setUpdatedAt(data.updated_at);
    }
    // Tailored versions = distinct cv_labels on applications.
    const { data: apps } = await supabase.from("applications")
      .select("cv_label, job_title, company, status").not("cv_label", "is", null);
    setVersions(apps || []);
  }, [user]);

  useEffect(() => { if (active) load(); }, [active, load]);

  async function save() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("saved_cvs").upsert({
      user_id: user.id, cv_text: cvText, filename: fileName || null,
    });
    setSaving(false);
    if (error) showToast(`Couldn't save: ${error.message}`);
    else { showToast("Master CV saved — Tailor & apply now starts from it"); setUpdatedAt(new Date().toISOString()); }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const text = await extractTextFromFile(file);
      setCvText(text);
      setFileName(file.name);
      showToast(`Read ${file.name} — review below, then save`);
    } catch (err) {
      showToast(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!user) {
    return (
      <div className="scrollarea"><div className="page">
        <div className="page-eyebrow">Workspace</div>
        <h1>Studio</h1>
        <p className="sub">Sign in to save your master CV. Every tailored version starts from it — and every version knows which applications used it.</p>
      </div></div>
    );
  }

  return (
    <div className="scrollarea"><div className="page">
      <div className="page-eyebrow">Workspace</div>
      <h1>Studio</h1>
      <p className="sub">Your master CV is the source of truth. Tailored versions are generated per job in Copilot and always reviewed by you before use.</p>

      <div className="studio-card">
        <h3>Master CV</h3>
        <div className="s-sub">
          {updatedAt ? `Last saved ${new Date(updatedAt).toLocaleDateString()}` : "Not saved yet"}
          {fileName ? ` · from ${fileName}` : ""}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Reading file…" : "Upload PDF / DOCX / TXT"}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt,.md" style={{ display: "none" }} onChange={handleFile} />
        </div>
        <textarea
          className="textarea"
          value={cvText}
          onChange={(e) => setCvText(e.target.value)}
          placeholder="Paste your CV text here, or upload a file above…"
          style={{ minHeight: 320 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button className="btn primary" onClick={save} disabled={saving || !cvText.trim()}>
            {saving ? "Saving…" : "Save master CV"}
          </button>
          <span className="s-sub" style={{ margin: 0 }}>Stored privately in your account — only you can read it</span>
        </div>
      </div>

      <div className="studio-card">
        <h3>Tailored versions</h3>
        <div className="s-sub">Created when you use Tailor & apply. Each one is tied to its application in Pipeline.</div>
        {versions.length === 0 ? (
          <div className="s-sub" style={{ marginBottom: 0 }}>
            None yet — open <button className="btn" style={{ margin: "0 4px" }} onClick={() => setView("copilot")}>Copilot</button>
            and hit Tailor & apply on any eligible job.
          </div>
        ) : versions.map((v, i) => (
          <div className="move-item" key={i}>
            <div className="move-ic">📄</div>
            <div>
              <div className="m-text"><b>{v.cv_label}</b></div>
              <div className="m-sub">{v.job_title} at {v.company} · {v.status.replace("_", " ")}</div>
            </div>
            <div className="m-act">
              <button className="btn" onClick={() => setView("pipeline")}>View application</button>
            </div>
          </div>
        ))}
      </div>
    </div></div>
  );
}
