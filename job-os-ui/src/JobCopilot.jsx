import { useState, useRef, useEffect } from "react";
import { useSession } from "./lib/useSession";
import { useTheme } from "./lib/useTheme";
import { supabase } from "./lib/supabaseClient";
import AuthModal, { COUNTRY_LABEL, COUNTRY_OPTIONS } from "./AuthModal";

const API = import.meta.env.VITE_API_URL || "http://localhost:3000";

// ============================================================
// UTILITIES
// ============================================================
function clean(t) {
  if (!t) return "";
  return String(t)
    .replace(/<[^>]*>/g, " ")
    // mojibake
    .replace(/â€™|â€˜/g, "'").replace(/â€œ|â€\u009d/g, '"')
    .replace(/â€"/g, "—").replace(/â€¦|â¦/g, "…")
    .replace(/Â®/g, "®").replace(/Â©/g, "©").replace(/Â/g, "").replace(/â€/g, "").replace(/â/g, "")
    // spam / tracking boilerplate from re-syndicated posts
    .replace(/please mention the word[^.]*\.?/gi, "")
    .replace(/and tag\s+[A-Za-z0-9=+/]{6,}/gi, "")
    .replace(/\(#?R[A-Za-z0-9=+/]{10,}\)/g, "")
    .replace(/#R[A-Za-z0-9=+/]{6,}/g, "")
    .replace(/this is a beta feature to avoid spam applicants\.?/gi, "")
    .replace(/companies can search these words[^.]*\.?/gi, "")
    .replace(/see this and similar jobs on linkedin\.?/gi, "")
    .replace(/posted\s+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\.?/gi, "")
    .replace(/\*\*/g, "")
    // trailing read-more/less toggle artifact
    .replace(/(\w)(less|more)\s*$/i, "$1").replace(/\s+(less|more)\s*$/i, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
function fmtSalary(min, max) {
  if (!min && !max) return null;
  const f = n => n >= 1000 ? `$${(n/1000).toFixed(0)}k` : `$${n}`;
  if (min && max) return `${f(min)} – ${f(max)}`;
  return min ? `From ${f(min)}` : `Up to ${f(max)}`;
}
function scoreColor(s) {
  if (s >= 75) return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-200 dark:border-emerald-800";
  if (s >= 55) return "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-200 dark:border-blue-800";
  if (s >= 35) return "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-200 dark:border-amber-800";
  return "text-gray-700 dark:text-zinc-400 bg-gray-200 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700";
}
function gradeColor(g) {
  return { A:"text-emerald-600 dark:text-emerald-400", B:"text-blue-600 dark:text-blue-400", C:"text-amber-600 dark:text-amber-400", D:"text-orange-600 dark:text-orange-400", F:"text-red-600 dark:text-red-400" }[g] || "text-gray-800 dark:text-zinc-300";
}

// ============================================================
// PDF / DOCX TEXT EXTRACTION (client-side)
// ============================================================
async function extractTextFromFile(file) {
  const name = file.name.toLowerCase();

  // Plain text / markdown
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return await file.text();
  }

  // PDF — use PDF.js from CDN
  if (name.endsWith(".pdf")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          // Dynamically load PDF.js
          if (!window.pdfjsLib) {
            await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
              "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          }
          const typedArray = new Uint8Array(e.target.result);
          const pdf = await window.pdfjsLib.getDocument({ data: typedArray }).promise;
          let text = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(" ") + "\n";
          }
          resolve(text.trim());
        } catch (err) {
          reject(new Error("Could not read PDF: " + err.message));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // DOCX — use mammoth from CDN
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          if (!window.mammoth) {
            await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
          }
          const result = await window.mammoth.extractRawText({ arrayBuffer: e.target.result });
          resolve(result.value.trim());
        } catch (err) {
          reject(new Error("Could not read DOCX: " + err.message));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  throw new Error(`Unsupported file type: ${name.split(".").pop().toUpperCase()}. Please use PDF, DOCX, or TXT.`);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ============================================================
// COMPONENTS
// ============================================================
const Spinner = () => (
  <div className="flex gap-1 items-center justify-center">
    {[0,1,2].map(i => (
      <span key={i} className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
        style={{ animationDelay: `${i*0.15}s` }} />
    ))}
  </div>
);

const Badge = ({ children, className="" }) => (
  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${className}`}>
    {children}
  </span>
);

// ============================================================
// CV UPLOAD AREA (shared between panels)
// ============================================================
function CVUploadArea({ cvText, setCvText, label = "Your CV" }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [fileName, setFileName] = useState("");

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true); setUploadError("");
    try {
      const text = await extractTextFromFile(file);
      setCvText(text);
      setFileName(file.name);
    } catch (err) {
      setUploadError(err.message);
    }
    setUploading(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-sm text-gray-800 dark:text-zinc-300 font-medium">{label}</label>
        <label className={`text-xs px-3 py-1.5 rounded-lg border transition cursor-pointer ${
          uploading ? "opacity-50 cursor-not-allowed" : "border-gray-300 dark:border-zinc-700 text-gray-800 dark:text-zinc-300 hover:border-blue-500 hover:text-blue-600 dark:text-blue-400"
        }`}>
          {uploading ? "Reading..." : fileName ? `✓ ${fileName}` : "Upload PDF / DOCX / TXT"}
          <input type="file" accept=".pdf,.doc,.docx,.txt,.md" className="hidden"
            disabled={uploading} onChange={handleFile} />
        </label>
      </div>
      {uploadError && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
          ⚠️ {uploadError}
        </p>
      )}
      <textarea
        value={cvText}
        onChange={e => setCvText(e.target.value)}
        placeholder="Upload a file above, or paste your CV text here..."
        rows={7}
        className="w-full bg-gray-200 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-xl p-3 text-sm text-gray-800 dark:text-zinc-300 placeholder-zinc-600 outline-none focus:border-blue-500 resize-none font-mono"
      />
      <p className="text-xs text-gray-700 dark:text-zinc-400">
        {cvText.length > 0 ? `${cvText.length.toLocaleString()} characters loaded` : "PDF, DOCX, and TXT supported"}
      </p>
    </div>
  );
}

// ============================================================
// JOB CARD
// ============================================================
function JobCard({ job, onCVMatch, onInterviewPrep }) {
  const score = Math.round(job.score || 0);
  const salary = fmtSalary(job.salary_min, job.salary_max);
  const [expanded, setExpanded] = useState(false);
  const desc = clean(job.description);

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:border-gray-300 dark:hover:border-zinc-700 transition">
      <div className="flex justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white leading-snug">{job.title}</h3>
          <p className="text-sm text-gray-800 dark:text-zinc-300 mt-0.5">{job.company}</p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <Badge className={scoreColor(score)}>{score}% match</Badge>
          {job.role_cluster && <Badge className="text-purple-400 bg-purple-500/10 border-purple-900">{job.role_cluster}</Badge>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {job.location && <span className="text-xs text-gray-700 dark:text-zinc-400">📍 {job.location}</span>}
        {job.remote && <span className="text-xs text-emerald-500">🌐 Remote</span>}
        {job.eligibility_region && job.eligibility_region !== "Unknown" && (
          <Badge className="text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-200 dark:border-blue-900">{job.eligibility_region}</Badge>
        )}
        {salary && <span className="text-xs text-gray-800 dark:text-zinc-300 font-medium">{salary}</span>}
        {job.employment_type && <span className="text-xs text-gray-700 dark:text-zinc-400 capitalize">{job.employment_type.replace("_"," ")}</span>}
      </div>

      {desc ? (
        <p className="text-sm text-gray-800 dark:text-zinc-300 mt-3 leading-relaxed whitespace-pre-line">
          {expanded ? desc : desc.slice(0, 180)}
          {desc.length > 180 && (
            <button className="text-blue-600 dark:text-blue-400 ml-1 hover:underline"
              onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>
              {expanded ? " show less" : "…more"}
            </button>
          )}
        </p>
      ) : (
        <p className="text-sm text-gray-700 dark:text-zinc-400 mt-3 italic">
          No description provided — click Apply to view the full posting.
        </p>
      )}

      {job.match_reason && (
        <p className="text-xs text-gray-700 dark:text-zinc-400 mt-2 italic">{job.match_reason}</p>
      )}

      <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-200 dark:border-zinc-800">
        <div className="flex gap-2 text-xs text-gray-700 dark:text-zinc-400">
          {job.source && <span className="capitalize">{job.source}</span>}
          {job.posted_at && <span>· {new Date(job.posted_at).toLocaleDateString("en-NG",{day:"numeric",month:"short"})}</span>}
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => onCVMatch(job)}
            className="text-xs text-gray-800 dark:text-zinc-300 hover:text-gray-900 dark:text-white px-2 py-1 rounded-lg hover:bg-gray-200 dark:hover:bg-zinc-800 transition">
            CV Match
          </button>
          <button onClick={() => onInterviewPrep(job)}
            className="text-xs text-gray-800 dark:text-zinc-300 hover:text-gray-900 dark:text-white px-2 py-1 rounded-lg hover:bg-gray-200 dark:hover:bg-zinc-800 transition">
            Interview Prep
          </button>
          {job.apply_url && (
            <a href={job.apply_url} target="_blank" rel="noopener noreferrer"
              className="text-sm bg-blue-600 text-white hover:bg-blue-500 px-4 py-1.5 rounded-xl font-medium transition">
              Apply →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CV MATCH PANEL
// ============================================================
function CVMatchPanel({ job, onClose, initialCv = "", user }) {
  const [cvText, setCvText] = useState(initialCv);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("match");
  const [saveStatus, setSaveStatus] = useState("");

  async function saveCv() {
    if (!supabase || !user || !cvText.trim()) return;
    setSaveStatus("saving");
    const { error: saveErr } = await supabase.from("saved_cvs")
      .upsert({ user_id: user.id, cv_text: cvText, updated_at: new Date().toISOString() });
    setSaveStatus(saveErr ? "error" : "saved");
    setTimeout(() => setSaveStatus(""), 2000);
  }

  async function run() {
    if (!cvText.trim()) { setError("Please add your CV first."); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const endpoint = tab === "match" ? "/ai/cv-match" : "/ai/cv-rewrite";
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvText, jobId: job.id })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(tab === "match" ? data.analysis : { type: "rewrite", ...data.result });
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-200 dark:border-zinc-800 flex justify-between items-start sticky top-0 bg-white dark:bg-zinc-900 z-10">
          <div>
            <h2 className="text-lg font-semibold">CV Tools</h2>
            <p className="text-sm text-gray-800 dark:text-zinc-300 mt-0.5">{job.title} · {job.company}</p>
          </div>
          <button onClick={onClose} className="text-gray-700 dark:text-zinc-400 hover:text-gray-900 dark:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        <div className="flex border-b border-gray-200 dark:border-zinc-800">
          {["match","rewrite"].map(t => (
            <button key={t} onClick={() => { setTab(t); setResult(null); setError(""); }}
              className={`flex-1 py-3 text-sm font-medium transition ${tab===t ? "text-gray-900 dark:text-white border-b-2 border-blue-500" : "text-gray-700 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-300"}`}>
              {t === "match" ? "📊 Match Score" : "✍️ Rewrite CV"}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {!result && (
            <>
              <CVUploadArea cvText={cvText} setCvText={setCvText} />
              {user && cvText.trim() && (
                <button onClick={saveCv}
                  className="text-xs text-gray-800 dark:text-zinc-300 hover:text-gray-800 dark:hover:text-zinc-200 transition flex items-center gap-1.5">
                  {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "✓ Saved to your account" : saveStatus === "error" ? "Couldn't save — try again" : "💾 Save this CV to my account"}
                </button>
              )}
              {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">⚠️ {error}</p>}
              <button onClick={run} disabled={loading || !cvText.trim()}
                className="w-full bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed py-3 rounded-xl font-medium transition">
                {loading ? <Spinner /> : tab === "match" ? "Analyse My CV" : "Rewrite My CV"}
              </button>
              {loading && <p className="text-xs text-gray-700 dark:text-zinc-400 text-center">This takes 15–40 seconds on a local model...</p>}
            </>
          )}

          {result && !result.type && (
            <div className="space-y-4">
              <div className="flex items-center gap-5 p-4 bg-gray-200 dark:bg-zinc-800 rounded-xl">
                <div className="text-5xl font-bold text-gray-900 dark:text-white">{result.overall_score}</div>
                <div>
                  <div className={`text-2xl font-bold ${gradeColor(result.grade)}`}>Grade {result.grade}</div>
                  <div className="text-xs text-gray-800 dark:text-zinc-300 mt-1">{result.likelihood}</div>
                </div>
              </div>
              <p className="text-sm text-gray-800 dark:text-zinc-300">{result.summary}</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-2">✅ Strengths</h4>
                  <ul className="space-y-1">{(result.strengths||[]).map((s,i) => <li key={i} className="text-xs text-gray-800 dark:text-zinc-300">• {s}</li>)}</ul>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-red-600 dark:text-red-400 mb-2">❌ Gaps</h4>
                  <ul className="space-y-1">{(result.gaps||[]).map((g,i) => <li key={i} className="text-xs text-gray-800 dark:text-zinc-300">• {g}</li>)}</ul>
                </div>
              </div>
              {result.missing_keywords?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2">🔑 Missing Keywords</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {result.missing_keywords.map((k,i) => <Badge key={i} className="text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-200 dark:border-amber-800">{k}</Badge>)}
                  </div>
                </div>
              )}
              <div>
                <h4 className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-2">💡 Recommendations</h4>
                <ul className="space-y-1">{(result.recommendations||[]).map((r,i) => <li key={i} className="text-xs text-gray-800 dark:text-zinc-300">→ {r}</li>)}</ul>
              </div>
              <button onClick={() => setResult(null)} className="w-full py-2 text-sm text-gray-800 dark:text-zinc-300 hover:text-gray-900 dark:text-white border border-gray-300 dark:border-zinc-700 rounded-xl">
                Try Another CV
              </button>
            </div>
          )}

          {result?.type === "rewrite" && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-2">Changes Made</h4>
                <ul className="space-y-1">{(result.changes_made||[]).map((c,i) => <li key={i} className="text-xs text-gray-800 dark:text-zinc-300">✓ {c}</li>)}</ul>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-xs font-semibold text-blue-600 dark:text-blue-400">Rewritten CV</h4>
                  <button onClick={() => navigator.clipboard.writeText(result.rewritten_cv)}
                    className="text-xs text-gray-700 dark:text-zinc-400 hover:text-gray-900 dark:text-white border border-gray-300 dark:border-zinc-700 px-2 py-1 rounded-lg">
                    Copy All
                  </button>
                </div>
                <pre className="text-xs text-gray-800 dark:text-zinc-300 bg-gray-200 dark:bg-zinc-800 rounded-xl p-4 whitespace-pre-wrap max-h-72 overflow-y-auto">
                  {result.rewritten_cv}
                </pre>
              </div>
              <button onClick={() => setResult(null)} className="w-full py-2 text-sm text-gray-800 dark:text-zinc-300 hover:text-gray-900 dark:text-white border border-gray-300 dark:border-zinc-700 rounded-xl">
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// INTERVIEW PANEL
// ============================================================
function InterviewPanel({ job, onClose, initialCv = "" }) {
  const [mode, setMode] = useState("questions");
  const [cvText, setCvText] = useState(initialCv);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const catColors = { Behavioural:"text-purple-400", Technical:"text-blue-600 dark:text-blue-400", Situational:"text-amber-600 dark:text-amber-400", Motivational:"text-emerald-600 dark:text-emerald-400" };

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch(`${API}/ai/interview-coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, cvText, mode })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data.result);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-200 dark:border-zinc-800 flex justify-between items-start sticky top-0 bg-white dark:bg-zinc-900 z-10">
          <div>
            <h2 className="text-lg font-semibold">Interview Prep</h2>
            <p className="text-sm text-gray-800 dark:text-zinc-300 mt-0.5">{job.title} · {job.company}</p>
          </div>
          <button onClick={onClose} className="text-gray-700 dark:text-zinc-400 hover:text-gray-900 dark:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {!result && (
            <>
              <div className="flex gap-2">
                {["questions","tips"].map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${mode===m ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-zinc-800 text-gray-800 dark:text-zinc-300 hover:text-gray-800 dark:hover:text-zinc-200"}`}>
                    {m === "questions" ? "🎯 Interview Questions" : "💪 Strategy & Tips"}
                  </button>
                ))}
              </div>

              <div>
                <p className="text-xs text-gray-700 dark:text-zinc-400 mb-2">Optional: Upload your CV for personalised questions</p>
                <CVUploadArea cvText={cvText} setCvText={setCvText} label="Your CV (optional)" />
              </div>

              {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">⚠️ {error}</p>}

              <button onClick={run} disabled={loading}
                className="w-full bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 py-3 rounded-xl font-medium transition">
                {loading ? <Spinner /> : "Generate Interview Guide"}
              </button>
              {loading && <p className="text-xs text-gray-700 dark:text-zinc-400 text-center">Generating... takes 20–40 seconds on local model</p>}
            </>
          )}

          {result && mode === "questions" && (
            <div className="space-y-5">
              {result._fallback && (
                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                  ⚠️ AI model offline — showing general guidance. Start Ollama for personalised questions.
                </div>
              )}
              {result.company_research_tips?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2">🔍 Research Before You Go</h4>
                  <ul className="space-y-1">{result.company_research_tips.map((t,i) => <li key={i} className="text-xs text-gray-800 dark:text-zinc-300">→ {t}</li>)}</ul>
                </div>
              )}
              <div>
                <h4 className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-3">🎯 Likely Questions</h4>
                <div className="space-y-3">
                  {(result.likely_questions||[]).map((q,i) => (
                    <div key={i} className="bg-gray-200 dark:bg-zinc-800 rounded-xl p-3 space-y-1.5">
                      <span className={`text-xs font-semibold ${catColors[q.category]||"text-gray-800 dark:text-zinc-300"}`}>{q.category}</span>
                      <p className="text-sm text-gray-900 dark:text-white font-medium">{q.question}</p>
                      <p className="text-xs text-gray-700 dark:text-zinc-400 italic">Why asked: {q.why_asked}</p>
                      <p className="text-xs text-gray-800 dark:text-zinc-300">💡 {q.tips}</p>
                    </div>
                  ))}
                </div>
              </div>
              {result.questions_to_ask_them?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-2">🙋 Ask Them</h4>
                  <ul className="space-y-1">{result.questions_to_ask_them.map((q,i) => <li key={i} className="text-xs text-gray-800 dark:text-zinc-300">→ {q}</li>)}</ul>
                </div>
              )}
              {result.star_reminder && (
                <div className="bg-blue-500/10 border border-blue-200 dark:border-blue-900 rounded-xl p-3">
                  <h4 className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">⭐ STAR Method</h4>
                  <p className="text-xs text-gray-800 dark:text-zinc-300">{result.star_reminder}</p>
                </div>
              )}
              <button onClick={() => setResult(null)} className="w-full py-2 text-sm text-gray-800 dark:text-zinc-300 hover:text-gray-900 dark:text-white border border-gray-300 dark:border-zinc-700 rounded-xl">
                Regenerate
              </button>
            </div>
          )}

          {result && mode === "tips" && (
            <div className="space-y-4">
              {result._fallback && (
                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                  ⚠️ AI model offline — showing general guidance.
                </div>
              )}
              {[
                { key:"day_before_tips", label:"📅 Day Before", color:"text-purple-400" },
                { key:"day_of_tips", label:"🌅 Day Of", color:"text-amber-600 dark:text-amber-400" },
                { key:"technical_prep", label:"🔧 Technical Prep", color:"text-blue-600 dark:text-blue-400" }
              ].map(({ key, label, color }) => result[key]?.length > 0 && (
                <div key={key}>
                  <h4 className={`text-xs font-semibold mb-2 ${color}`}>{label}</h4>
                  <ul className="space-y-1">{result[key].map((t,i) => <li key={i} className="text-xs text-gray-800 dark:text-zinc-300">→ {t}</li>)}</ul>
                </div>
              ))}
              {result.salary_negotiation && (
                <div className="bg-emerald-500/10 border border-emerald-200 dark:border-emerald-900 rounded-xl p-3">
                  <h4 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1">💰 Salary Negotiation</h4>
                  <p className="text-xs text-gray-800 dark:text-zinc-300">{result.salary_negotiation}</p>
                </div>
              )}
              {result.mindset && (
                <div className="bg-blue-500/10 border border-blue-200 dark:border-blue-900 rounded-xl p-3">
                  <p className="text-sm text-gray-800 dark:text-zinc-300 italic">"{result.mindset}"</p>
                </div>
              )}
              <button onClick={() => setResult(null)} className="w-full py-2 text-sm text-gray-800 dark:text-zinc-300 hover:text-gray-900 dark:text-white border border-gray-300 dark:border-zinc-700 rounded-xl">
                Regenerate
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// QUICK PROMPTS
// ============================================================
const PROMPTS = [
  "Remote customer service open to Nigerians",
  "People analytics roles open to Africa",
  "Virtual assistant remote worldwide",
  "Customer success manager EMEA",
  "Remote data analyst open to Nigerians",
  "Software engineer remote global",
  "HR generalist remote Africa",
  "Digital marketing manager remote Kenya"
];

// ============================================================
// MAIN APP
// ============================================================
export default function JobCopilot() {
  const { user, profile, authEnabled, signOut, refreshProfile } = useSession();
  const { theme, toggleTheme } = useTheme();
  const [showAuth, setShowAuth] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [savedCv, setSavedCv] = useState("");
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [cvModal, setCvModal] = useState(null);
  const [interviewModal, setInterviewModal] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [lastQuery, setLastQuery] = useState("");
  const [tab, setTab] = useState("search");
  const [searchCount, setSearchCount] = useState(0);       // free searches used (unauthed)
  const [showSearchGate, setShowSearchGate] = useState(false);
  const FREE_SEARCHES = 5;
  const [searchCountry, setSearchCountry] = useState("");  // location dropdown (per-search)
  const [datePosted, setDatePosted] = useState("any");     // date filter: any|1|3|7|30 (days)
  const [loadingMore, setLoadingMore] = useState(false);   // "Show more" in-flight flag
  const chatRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Default the location dropdown to the user's profile country once loaded.
  useEffect(() => {
    if (profile?.country) setSearchCountry(profile.country);
  }, [profile?.country]);

  // Once signed in, searches are unlimited — clear the counter and any gate.
  useEffect(() => {
    if (user) { setSearchCount(0); setShowSearchGate(false); }
  }, [user]);

  // If the user arrived from the landing page's "Sign in / Sign up" button,
  // open the auth modal automatically — but only once. We read the navigation
  // state from the browser's history directly (instead of react-router's
  // useLocation) so this never crashes even if the component renders outside a
  // <Router>. We clear the state after consuming it so closing the modal can't
  // reopen it.
  useEffect(() => {
    const navState = (typeof window !== "undefined" && window.history.state) || null;
    const openAuth = navState && (navState.openAuth || navState.usr?.openAuth);
    if (openAuth && !user) {
      setShowAuth("signin");
      window.history.replaceState({}, document.title);
    }
  }, [user]);

  // Load the user's saved CV once they're signed in, so CV Match / Rewrite /
  // Interview Prep can pre-fill it without re-uploading every time.
  useEffect(() => {
    if (!user || !supabase) { setSavedCv(""); return; }
    supabase.from("saved_cvs").select("cv_text").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setSavedCv(data?.cv_text || ""));
  }, [user]);

  async function saveSearch(q) {
    if (!user || !supabase || !q.trim()) return;
    await supabase.from("saved_searches").insert({ user_id: user.id, query: q.trim() });
  }

  // Apply the active date filter + newest-first sort to a batch of jobs.
  // Shared by the initial search and "Show more" so both behave identically.
  function processJobs(jobs) {
    let out = jobs;
    if (datePosted !== "any") {
      const days = parseInt(datePosted, 10);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      out = out.filter(j => {
        const t = new Date(j.posted_at || j.created_at || 0).getTime();
        return t && t >= cutoff;
      });
    }
    return [...out].sort((a, b) => {
      const ta = new Date(a.posted_at || a.created_at || 0).getTime();
      const tb = new Date(b.posted_at || b.created_at || 0).getTime();
      return tb - ta;
    });
  }

  const PAGE_SIZE = 20;

  async function runSearch(q) {
    if (!q.trim()) return;
    if (!user) setSearchCount(c => c + 1);   // count free searches; logged-in = unlimited
    setLoading(true); setLastQuery(q.trim());
    setMessages(m => [...m, { type:"user", text: q.trim() }]);
    try {
      // Location: the dropdown choice takes priority, falling back to profile country.
      const chosenCountry = searchCountry || profile?.country || "";
      const countryParam = chosenCountry ? `&country=${encodeURIComponent(chosenCountry)}` : "";
      const res = await fetch(`${API}/ai/search?q=${encodeURIComponent(q.trim())}&limit=${PAGE_SIZE}&offset=0${countryParam}`);
      const data = await res.json();
      const jobs = processJobs(data.data || []);

      setMessages(m => [...m, {
        type:"results", jobs, summary: data.summary||"",
        intent: data.intent||{}, excluded: data.excluded_count||0, query: q.trim(),
        dateFilter: datePosted, country: chosenCountry,
        // pagination state carried on the message so "Show more" knows where to resume
        offset: PAGE_SIZE, hasMore: !!data.has_more, total: data.total || 0
      }]);
    } catch {
      setMessages(m => [...m, { type:"error", text:"Cannot reach the API. Is the server running on port 3000?" }]);
    }
    setLoading(false); setQuery(""); inputRef.current?.focus();
  }

  // Fetch the next page for the most recent results block and append it.
  async function fetchMore(msgIndex) {
    const msg = messages[msgIndex];
    if (!msg || msg.type !== "results" || !msg.hasMore) return;
    setLoadingMore(true);
    try {
      const countryParam = msg.country ? `&country=${encodeURIComponent(msg.country)}` : "";
      const res = await fetch(`${API}/ai/search?q=${encodeURIComponent(msg.query)}&limit=${PAGE_SIZE}&offset=${msg.offset}${countryParam}`);
      const data = await res.json();
      const newJobs = processJobs(data.data || []);
      // de-dupe by id in case of any overlap, then append
      setMessages(m => m.map((mm, i) => {
        if (i !== msgIndex) return mm;
        const seen = new Set(mm.jobs.map(j => j.id));
        const merged = [...mm.jobs, ...newJobs.filter(j => !seen.has(j.id))];
        return { ...mm, jobs: merged, offset: msg.offset + PAGE_SIZE, hasMore: !!data.has_more };
      }));
    } catch {
      /* silent — keep existing results visible */
    }
    setLoadingMore(false);
  }

  async function runChat(q) {
    if (!q.trim()) return;
    setLoading(true);
    const newHistory = [...chatHistory, { role:"user", content: q.trim() }];
    setChatHistory(newHistory);
    setMessages(m => [...m, { type:"user", text: q.trim() }]);
    try {
      const res = await fetch(`${API}/ai/chat`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ message: q.trim(), history: chatHistory, context: { lastSearchQuery: lastQuery } })
      });
      const data = await res.json();
      const reply = data.reply || "Couldn't generate a response.";
      setChatHistory([...newHistory, { role:"assistant", content: reply }]);
      setMessages(m => [...m, { type:"chat_reply", text: reply, searchSuggestion: data.searchSuggestion }]);
    } catch {
      setMessages(m => [...m, { type:"error", text:"Chat unavailable. Is Ollama running?" }]);
    }
    setLoading(false); setQuery(""); inputRef.current?.focus();
  }

  function handleSend() {
    if (!query.trim()) return;
    // Gate: unauthed users get FREE_SEARCHES searches, then must sign up.
    if (tab === "search" && !user && searchCount >= FREE_SEARCHES) {
      setShowSearchGate(true);
      return;
    }
    tab === "chat" ? runChat(query) : runSearch(query);
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-black text-gray-900 dark:text-white overflow-hidden">

      {/* HEADER */}
      <div className="px-5 py-3.5 border-b border-gray-200 dark:border-zinc-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center font-bold text-sm shrink-0">JC</div>
          <div>
            <div className="text-sm font-semibold leading-tight">Job Copilot</div>
            <div className="text-xs text-gray-700 dark:text-zinc-400">AI job search, global eligibility</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-white dark:bg-zinc-900 rounded-xl p-1">
            {["search","chat"].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${tab===t ? "bg-gray-300 dark:bg-zinc-700 text-gray-900 dark:text-white" : "text-gray-700 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-300"}`}>
                {t === "search" ? "🔍 Search" : "💬 Chat"}
              </button>
            ))}
          </div>
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setChatHistory([]); setLastQuery(""); }}
              title="Start a new search"
              className="flex items-center gap-1 text-xs font-medium bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200 border border-gray-300 dark:border-zinc-700 px-3 py-1.5 rounded-xl transition">
              <span>←</span> New search
            </button>
          )}
          <button onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="w-8 h-8 rounded-full bg-white dark:bg-zinc-900 hover:bg-gray-200 dark:hover:bg-zinc-800 border border-gray-200 dark:border-zinc-800 flex items-center justify-center text-sm transition">
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          {authEnabled && (
            user ? (
              <div className="relative">
                <button onClick={() => setShowUserMenu(v => !v)}
                  className="w-8 h-8 rounded-full bg-gray-200 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 flex items-center justify-center text-xs font-medium transition">
                  {(profile?.full_name || user.email || "?")[0].toUpperCase()}
                </button>
                {showUserMenu && (
                  <div className="absolute right-0 top-10 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl py-1.5 w-56 shadow-xl z-40">
                    <div className="px-3 py-2 border-b border-gray-200 dark:border-zinc-800">
                      <div className="text-xs text-gray-800 dark:text-zinc-300 truncate">{user.email}</div>
                      {profile?.country && (
                        <div className="text-[11px] text-gray-700 dark:text-zinc-400 mt-0.5">
                          📍 {COUNTRY_LABEL[profile.country] || profile.country}
                        </div>
                      )}
                    </div>
                    <button onClick={() => { setShowUserMenu(false); setShowAuth("profile"); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-900">
                      Edit location
                    </button>
                    <button onClick={() => { signOut(); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-zinc-900">
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => setShowAuth(true)}
                className="text-xs font-medium bg-white dark:bg-zinc-900 hover:bg-gray-200 dark:hover:bg-zinc-800 border border-gray-200 dark:border-zinc-800 px-3 py-1.5 rounded-xl transition">
                Sign in
              </button>
            )
          )}
        </div>
      </div>

      {/* MESSAGES */}
      <div ref={chatRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {messages.length === 0 && (
          <div className="space-y-6">
            <div className="text-center pt-6">
              <div className="text-3xl mb-2">🌍</div>
              <h2 className="text-lg font-semibold">Find jobs that are actually open to you</h2>
              <p className="text-sm text-gray-700 dark:text-zinc-400 mt-1 max-w-md mx-auto">
                We filter out jobs restricted to specific countries. Only roles genuinely open to African candidates — global remote, worldwide, EMEA — make it through.
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-700 dark:text-zinc-400 mb-3 text-center">Try these searches</p>
              <div className="grid grid-cols-2 gap-2">
                {PROMPTS.map((p,i) => (
                  <button key={i} onClick={() => runSearch(p)}
                    className="text-left text-xs text-gray-800 dark:text-zinc-300 bg-white dark:bg-zinc-900 hover:bg-gray-200 dark:hover:bg-zinc-800 border border-gray-200 dark:border-zinc-800 hover:border-gray-400 dark:hover:border-zinc-600 px-3 py-2.5 rounded-xl transition leading-snug">
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4">
              <p className="text-xs text-gray-800 dark:text-zinc-300 font-medium mb-2">What Job Copilot does:</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-700 dark:text-zinc-400">
                <span>✅ Filters geo-restricted jobs</span>
                <span>🧠 Understands role aliases</span>
                <span>📊 CV match scoring</span>
                <span>✍️ AI CV rewriting</span>
                <span>🎯 Interview prep</span>
                <span>💬 Career chat assistant</span>
              </div>
            </div>
          </div>
        )}

        {messages.map((m,i) => {
          if (m.type === "user") return (
            <div key={i} className="flex justify-end">
              <div className="bg-blue-600 px-4 py-2.5 rounded-2xl max-w-[75%] text-sm">{m.text}</div>
            </div>
          );

          if (m.type === "results") return (
            <div key={i} className="space-y-3">
              <div className="text-sm text-gray-800 dark:text-zinc-300">{m.summary}</div>
              {m.intent && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  {m.intent.cluster && <Badge className="text-purple-400 bg-purple-500/10 border-purple-900">{m.intent.cluster}</Badge>}
                  {m.intent.locationCountry && <Badge className="text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-200 dark:border-blue-900">📍 {m.intent.locationCountry}</Badge>}
                  {m.intent.remoteOnly && <Badge className="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-200 dark:border-emerald-900">🌐 Remote</Badge>}
                  {m.dateFilter && m.dateFilter !== "any" && (
                    <Badge className="text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-200 dark:border-amber-900">
                      🕒 {m.dateFilter === "1" ? "Last 24h" : m.dateFilter === "3" ? "Last 3 days" : m.dateFilter === "7" ? "Last week" : "Last month"}
                    </Badge>
                  )}
                  {m.excluded > 0 && <Badge className="text-red-600 dark:text-red-400 bg-red-500/10 border-red-200 dark:border-red-900">{m.excluded} restricted removed</Badge>}
                  {user && m.query && (
                    <button onClick={() => saveSearch(m.query)}
                      className="text-xs text-gray-700 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-300 transition ml-auto">
                      💾 Save this search
                    </button>
                  )}
                </div>
              )}
              {m.jobs.length === 0 ? (
                <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 text-center">
                  <p className="text-gray-800 dark:text-zinc-300 text-sm">No eligible jobs found for this search.</p>
                  <p className="text-gray-700 dark:text-zinc-400 text-xs mt-1">Try: "remote customer service" or "data analyst worldwide"</p>
                </div>
              ) : (
                <>
                  <div className="grid gap-3">
                    {m.jobs.map((job,j) => (
                      <JobCard key={job.id || j} job={job} onCVMatch={j => setCvModal(j)} onInterviewPrep={j => setInterviewModal(j)} />
                    ))}
                  </div>
                  <div className="text-center pt-1">
                    <p className="text-xs text-gray-600 dark:text-zinc-500 mb-2">
                      Showing {m.jobs.length}{m.total ? ` of ${m.total}` : ""} matches
                    </p>
                    {m.hasMore && (
                      <button onClick={() => fetchMore(i)} disabled={loadingMore}
                        className="bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200 border border-gray-300 dark:border-zinc-700 px-5 py-2 rounded-xl text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed">
                        {loadingMore ? "Loading…" : "Show more matches"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );

          if (m.type === "chat_reply") return (
            <div key={i} className="space-y-3">
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">JC</div>
                <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl px-4 py-3 text-sm text-gray-800 dark:text-zinc-300 leading-relaxed max-w-[85%] whitespace-pre-wrap">{m.text}</div>
              </div>
              {m.searchSuggestion && (
                <div className="ml-10">
                  <button onClick={() => runSearch(m.searchSuggestion)}
                    className="text-xs text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-200 dark:border-blue-900 px-3 py-1.5 rounded-xl hover:bg-blue-500/20 transition">
                    🔍 Search: "{m.searchSuggestion}"
                  </button>
                </div>
              )}
            </div>
          );

          if (m.type === "error") return (
            <div key={i} className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">
              ⚠️ {m.text}
            </div>
          );
          return null;
        })}

        {loading && (
          <div className="flex gap-3 items-start">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-xs font-bold shrink-0">JC</div>
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl px-4 py-3"><Spinner /></div>
          </div>
        )}
      </div>

      {/* INPUT */}
      <div className="p-4 border-t border-gray-200 dark:border-zinc-900 shrink-0">
        {tab === "search" && (
          <div className="flex gap-2 mb-2 flex-wrap">
            <select value={searchCountry} onChange={e => setSearchCountry(e.target.value)}
              title="Location to search jobs for"
              className="text-xs bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-800 dark:text-zinc-300 rounded-xl px-3 py-2 outline-none focus:border-blue-500 cursor-pointer">
              <option value="">🌍 Any location</option>
              {COUNTRY_OPTIONS.filter(c => c.value).map(c => (
                <option key={c.value} value={c.value}>📍 {c.label}</option>
              ))}
            </select>
            <select value={datePosted} onChange={e => setDatePosted(e.target.value)}
              title="Filter by when the job was posted"
              className="text-xs bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-800 dark:text-zinc-300 rounded-xl px-3 py-2 outline-none focus:border-blue-500 cursor-pointer">
              <option value="any">🕒 Any time</option>
              <option value="1">Last 24 hours</option>
              <option value="3">Last 3 days</option>
              <option value="7">Last week</option>
              <option value="30">Last month</option>
            </select>
          </div>
        )}
        <div className="flex gap-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-2 focus-within:border-zinc-600 transition">
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
            placeholder={tab === "search" ? "e.g. remote customer service open to Nigerians..." : "Ask about jobs, roles, or your search..."}
            className="flex-1 bg-transparent outline-none text-sm px-2 placeholder-zinc-600" />
          <button onClick={handleSend} disabled={loading || !query.trim()}
            className="bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-xl text-sm font-medium transition shrink-0">
            {tab === "search" ? "Search" : "Send"}
          </button>
        </div>
        <p className="text-xs text-gray-700 dark:text-zinc-400 text-center mt-1.5">Geo-restricted roles are filtered out automatically</p>
      </div>

      {cvModal && <CVMatchPanel job={cvModal} onClose={() => setCvModal(null)} initialCv={savedCv} user={user} />}
      {interviewModal && <InterviewPanel job={interviewModal} onClose={() => setInterviewModal(null)} initialCv={savedCv} />}
      {showAuth && (
        <AuthModal
          mode={showAuth === "profile" ? "profile" : "signin"}
          user={user}
          currentCountry={profile?.country}
          onClose={() => setShowAuth(false)}
          onAuthed={() => setShowAuth(false)}
          onProfileSaved={refreshProfile}
        />
      )}

      {showSearchGate && (
        <div className="fixed inset-0 bg-white dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold mb-2">You've used your {FREE_SEARCHES} free searches</h3>
            <p className="text-sm text-gray-800 dark:text-zinc-300 mb-5">
              Sign up free to keep searching, save jobs, and track your applications.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowSearchGate(false); setShowAuth("signin"); }}
                className="flex-1 bg-blue-600 text-white hover:bg-blue-500 rounded-xl py-2.5 text-sm font-medium transition"
              >
                Sign up / Sign in
              </button>
              <button
                onClick={() => setShowSearchGate(false)}
                className="px-4 py-2.5 border border-gray-200 dark:border-zinc-800 text-gray-800 dark:text-zinc-300 hover:text-gray-800 dark:hover:text-zinc-200 rounded-xl text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}