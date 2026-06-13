import { useState, useRef, useEffect } from "react";

const API = "http://localhost:3000";

// ============================================================
// UTILITIES
// ============================================================
function clean(t) {
  if (!t) return "";
  return t.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
function fmtSalary(min, max) {
  if (!min && !max) return null;
  const f = n => n >= 1000 ? `$${(n/1000).toFixed(0)}k` : `$${n}`;
  if (min && max) return `${f(min)} – ${f(max)}`;
  return min ? `From ${f(min)}` : `Up to ${f(max)}`;
}
function scoreColor(s) {
  if (s >= 75) return "text-emerald-400 bg-emerald-500/10 border-emerald-800";
  if (s >= 55) return "text-blue-400 bg-blue-500/10 border-blue-800";
  if (s >= 35) return "text-amber-400 bg-amber-500/10 border-amber-800";
  return "text-zinc-500 bg-zinc-800 border-zinc-700";
}
function gradeColor(g) {
  return { A:"text-emerald-400", B:"text-blue-400", C:"text-amber-400", D:"text-orange-400", F:"text-red-400" }[g] || "text-zinc-400";
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
        <label className="text-sm text-zinc-300 font-medium">{label}</label>
        <label className={`text-xs px-3 py-1.5 rounded-lg border transition cursor-pointer ${
          uploading ? "opacity-50 cursor-not-allowed" : "border-zinc-700 text-zinc-400 hover:border-blue-500 hover:text-blue-400"
        }`}>
          {uploading ? "Reading..." : fileName ? `✓ ${fileName}` : "Upload PDF / DOCX / TXT"}
          <input type="file" accept=".pdf,.doc,.docx,.txt,.md" className="hidden"
            disabled={uploading} onChange={handleFile} />
        </label>
      </div>
      {uploadError && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-900 rounded-lg px-3 py-2">
          ⚠️ {uploadError}
        </p>
      )}
      <textarea
        value={cvText}
        onChange={e => setCvText(e.target.value)}
        placeholder="Upload a file above, or paste your CV text here..."
        rows={7}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-sm text-zinc-300 placeholder-zinc-600 outline-none focus:border-blue-500 resize-none font-mono"
      />
      <p className="text-xs text-zinc-600">
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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-700 transition">
      <div className="flex justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white leading-snug">{job.title}</h3>
          <p className="text-sm text-zinc-400 mt-0.5">{job.company}</p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <Badge className={scoreColor(score)}>{score}% match</Badge>
          {job.role_cluster && <Badge className="text-purple-400 bg-purple-500/10 border-purple-900">{job.role_cluster}</Badge>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {job.location && <span className="text-xs text-zinc-500">📍 {job.location}</span>}
        {job.remote && <span className="text-xs text-emerald-500">🌐 Remote</span>}
        {job.eligibility_region && job.eligibility_region !== "Unknown" && (
          <Badge className="text-blue-400 bg-blue-500/10 border-blue-900">{job.eligibility_region}</Badge>
        )}
        {salary && <span className="text-xs text-zinc-400 font-medium">{salary}</span>}
        {job.employment_type && <span className="text-xs text-zinc-600 capitalize">{job.employment_type.replace("_"," ")}</span>}
      </div>

      {desc && (
        <p className="text-sm text-zinc-400 mt-3 leading-relaxed">
          {expanded ? desc.slice(0, 600) : desc.slice(0, 180)}
          {desc.length > 180 && (
            <button className="text-blue-400 ml-1 hover:underline"
              onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>
              {expanded ? " less" : "...more"}
            </button>
          )}
        </p>
      )}

      {job.match_reason && (
        <p className="text-xs text-zinc-600 mt-2 italic">{job.match_reason}</p>
      )}

      <div className="flex justify-between items-center mt-4 pt-3 border-t border-zinc-800">
        <div className="flex gap-2 text-xs text-zinc-600">
          {job.source && <span className="capitalize">{job.source}</span>}
          {job.posted_at && <span>· {new Date(job.posted_at).toLocaleDateString("en-NG",{day:"numeric",month:"short"})}</span>}
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => onCVMatch(job)}
            className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded-lg hover:bg-zinc-800 transition">
            CV Match
          </button>
          <button onClick={() => onInterviewPrep(job)}
            className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded-lg hover:bg-zinc-800 transition">
            Interview Prep
          </button>
          {job.apply_url && (
            <a href={job.apply_url} target="_blank" rel="noopener noreferrer"
              className="text-sm bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded-xl font-medium transition">
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
function CVMatchPanel({ job, onClose }) {
  const [cvText, setCvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("match");

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
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-zinc-800 flex justify-between items-start sticky top-0 bg-zinc-900 z-10">
          <div>
            <h2 className="text-lg font-semibold">CV Tools</h2>
            <p className="text-sm text-zinc-400 mt-0.5">{job.title} · {job.company}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        <div className="flex border-b border-zinc-800">
          {["match","rewrite"].map(t => (
            <button key={t} onClick={() => { setTab(t); setResult(null); setError(""); }}
              className={`flex-1 py-3 text-sm font-medium transition ${tab===t ? "text-white border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-300"}`}>
              {t === "match" ? "📊 Match Score" : "✍️ Rewrite CV"}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {!result && (
            <>
              <CVUploadArea cvText={cvText} setCvText={setCvText} />
              {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-900 rounded-xl px-4 py-3">⚠️ {error}</p>}
              <button onClick={run} disabled={loading || !cvText.trim()}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed py-3 rounded-xl font-medium transition">
                {loading ? <Spinner /> : tab === "match" ? "Analyse My CV" : "Rewrite My CV"}
              </button>
              {loading && <p className="text-xs text-zinc-500 text-center">This takes 15–40 seconds on a local model...</p>}
            </>
          )}

          {result && !result.type && (
            <div className="space-y-4">
              <div className="flex items-center gap-5 p-4 bg-zinc-800 rounded-xl">
                <div className="text-5xl font-bold text-white">{result.overall_score}</div>
                <div>
                  <div className={`text-2xl font-bold ${gradeColor(result.grade)}`}>Grade {result.grade}</div>
                  <div className="text-xs text-zinc-400 mt-1">{result.likelihood}</div>
                </div>
              </div>
              <p className="text-sm text-zinc-300">{result.summary}</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-emerald-400 mb-2">✅ Strengths</h4>
                  <ul className="space-y-1">{(result.strengths||[]).map((s,i) => <li key={i} className="text-xs text-zinc-400">• {s}</li>)}</ul>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-red-400 mb-2">❌ Gaps</h4>
                  <ul className="space-y-1">{(result.gaps||[]).map((g,i) => <li key={i} className="text-xs text-zinc-400">• {g}</li>)}</ul>
                </div>
              </div>
              {result.missing_keywords?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-amber-400 mb-2">🔑 Missing Keywords</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {result.missing_keywords.map((k,i) => <Badge key={i} className="text-amber-400 bg-amber-500/10 border-amber-800">{k}</Badge>)}
                  </div>
                </div>
              )}
              <div>
                <h4 className="text-xs font-semibold text-blue-400 mb-2">💡 Recommendations</h4>
                <ul className="space-y-1">{(result.recommendations||[]).map((r,i) => <li key={i} className="text-xs text-zinc-400">→ {r}</li>)}</ul>
              </div>
              <button onClick={() => setResult(null)} className="w-full py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-xl">
                Try Another CV
              </button>
            </div>
          )}

          {result?.type === "rewrite" && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-emerald-400 mb-2">Changes Made</h4>
                <ul className="space-y-1">{(result.changes_made||[]).map((c,i) => <li key={i} className="text-xs text-zinc-400">✓ {c}</li>)}</ul>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-xs font-semibold text-blue-400">Rewritten CV</h4>
                  <button onClick={() => navigator.clipboard.writeText(result.rewritten_cv)}
                    className="text-xs text-zinc-500 hover:text-white border border-zinc-700 px-2 py-1 rounded-lg">
                    Copy All
                  </button>
                </div>
                <pre className="text-xs text-zinc-300 bg-zinc-800 rounded-xl p-4 whitespace-pre-wrap max-h-72 overflow-y-auto">
                  {result.rewritten_cv}
                </pre>
              </div>
              <button onClick={() => setResult(null)} className="w-full py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-xl">
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
function InterviewPanel({ job, onClose }) {
  const [mode, setMode] = useState("questions");
  const [cvText, setCvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const catColors = { Behavioural:"text-purple-400", Technical:"text-blue-400", Situational:"text-amber-400", Motivational:"text-emerald-400" };

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
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-zinc-800 flex justify-between items-start sticky top-0 bg-zinc-900 z-10">
          <div>
            <h2 className="text-lg font-semibold">Interview Prep</h2>
            <p className="text-sm text-zinc-400 mt-0.5">{job.title} · {job.company}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {!result && (
            <>
              <div className="flex gap-2">
                {["questions","tips"].map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${mode===m ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}>
                    {m === "questions" ? "🎯 Interview Questions" : "💪 Strategy & Tips"}
                  </button>
                ))}
              </div>

              <div>
                <p className="text-xs text-zinc-500 mb-2">Optional: Upload your CV for personalised questions</p>
                <CVUploadArea cvText={cvText} setCvText={setCvText} label="Your CV (optional)" />
              </div>

              {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-900 rounded-xl px-4 py-3">⚠️ {error}</p>}

              <button onClick={run} disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 py-3 rounded-xl font-medium transition">
                {loading ? <Spinner /> : "Generate Interview Guide"}
              </button>
              {loading && <p className="text-xs text-zinc-500 text-center">Generating... takes 20–40 seconds on local model</p>}
            </>
          )}

          {result && mode === "questions" && (
            <div className="space-y-5">
              {result._fallback && (
                <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-900 rounded-lg px-3 py-2">
                  ⚠️ AI model offline — showing general guidance. Start Ollama for personalised questions.
                </div>
              )}
              {result.company_research_tips?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-amber-400 mb-2">🔍 Research Before You Go</h4>
                  <ul className="space-y-1">{result.company_research_tips.map((t,i) => <li key={i} className="text-xs text-zinc-400">→ {t}</li>)}</ul>
                </div>
              )}
              <div>
                <h4 className="text-xs font-semibold text-blue-400 mb-3">🎯 Likely Questions</h4>
                <div className="space-y-3">
                  {(result.likely_questions||[]).map((q,i) => (
                    <div key={i} className="bg-zinc-800 rounded-xl p-3 space-y-1.5">
                      <span className={`text-xs font-semibold ${catColors[q.category]||"text-zinc-400"}`}>{q.category}</span>
                      <p className="text-sm text-white font-medium">{q.question}</p>
                      <p className="text-xs text-zinc-500 italic">Why asked: {q.why_asked}</p>
                      <p className="text-xs text-zinc-400">💡 {q.tips}</p>
                    </div>
                  ))}
                </div>
              </div>
              {result.questions_to_ask_them?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-emerald-400 mb-2">🙋 Ask Them</h4>
                  <ul className="space-y-1">{result.questions_to_ask_them.map((q,i) => <li key={i} className="text-xs text-zinc-400">→ {q}</li>)}</ul>
                </div>
              )}
              {result.star_reminder && (
                <div className="bg-blue-500/10 border border-blue-900 rounded-xl p-3">
                  <h4 className="text-xs font-semibold text-blue-400 mb-1">⭐ STAR Method</h4>
                  <p className="text-xs text-zinc-400">{result.star_reminder}</p>
                </div>
              )}
              <button onClick={() => setResult(null)} className="w-full py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-xl">
                Regenerate
              </button>
            </div>
          )}

          {result && mode === "tips" && (
            <div className="space-y-4">
              {result._fallback && (
                <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-900 rounded-lg px-3 py-2">
                  ⚠️ AI model offline — showing general guidance.
                </div>
              )}
              {[
                { key:"day_before_tips", label:"📅 Day Before", color:"text-purple-400" },
                { key:"day_of_tips", label:"🌅 Day Of", color:"text-amber-400" },
                { key:"technical_prep", label:"🔧 Technical Prep", color:"text-blue-400" }
              ].map(({ key, label, color }) => result[key]?.length > 0 && (
                <div key={key}>
                  <h4 className={`text-xs font-semibold mb-2 ${color}`}>{label}</h4>
                  <ul className="space-y-1">{result[key].map((t,i) => <li key={i} className="text-xs text-zinc-400">→ {t}</li>)}</ul>
                </div>
              ))}
              {result.salary_negotiation && (
                <div className="bg-emerald-500/10 border border-emerald-900 rounded-xl p-3">
                  <h4 className="text-xs font-semibold text-emerald-400 mb-1">💰 Salary Negotiation</h4>
                  <p className="text-xs text-zinc-400">{result.salary_negotiation}</p>
                </div>
              )}
              {result.mindset && (
                <div className="bg-blue-500/10 border border-blue-900 rounded-xl p-3">
                  <p className="text-sm text-zinc-300 italic">"{result.mindset}"</p>
                </div>
              )}
              <button onClick={() => setResult(null)} className="w-full py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-xl">
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
const SEARCH_PROMPTS = [
  "Remote customer service open to Nigerians",
  "People analytics roles open to Africa",
  "Virtual assistant remote worldwide",
  "Customer success manager EMEA",
  "Remote data analyst open to Nigerians",
  "Software engineer remote global",
  "HR generalist remote Africa",
  "Digital marketing manager remote Kenya"
];

const CHAT_PROMPTS = [
  "What remote roles can I do from Nigeria?",
  "What salary should I expect as a data analyst in Lagos?",
  "How do I tailor my CV for a remote role?",
  "What is the difference between people analytics and HR?",
  "Which companies are known to hire from Africa?",
  "How do I find jobs open to my location?",
];

// ============================================================
// MAIN APP
// ============================================================
export default function JobCopilot() {
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [cvModal, setCvModal] = useState(null);
  const [interviewModal, setInterviewModal] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [lastQuery, setLastQuery] = useState("");
  const [tab, setTab] = useState("search");
  const chatRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function runSearch(q) {
    if (!q.trim()) return;
    setLoading(true); setLastQuery(q.trim());
    setMessages(m => [...m, { type:"user", text: q.trim() }]);
    try {
      const res = await fetch(`${API}/ai/search?q=${encodeURIComponent(q.trim())}&limit=20`);
      const data = await res.json();
      setMessages(m => [...m, {
        type:"results", jobs: data.data||[], summary: data.summary||"",
        intent: data.intent||{}, excluded: data.excluded_count||0
      }]);
    } catch {
      setMessages(m => [...m, { type:"error", text:"Cannot reach the API. Is the server running on port 3000?" }]);
    }
    setLoading(false); setQuery(""); inputRef.current?.focus();
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
    tab === "chat" ? runChat(query) : runSearch(query);
  }

  return (
    <div className="h-screen flex flex-col bg-black text-white overflow-hidden">

      {/* HEADER */}
      <div className="px-5 py-3.5 border-b border-zinc-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center font-bold text-sm shrink-0">JC</div>
          <div>
            <div className="text-sm font-semibold leading-tight">Job Copilot</div>
            <div className="text-xs text-zinc-500">AI job search, global eligibility</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-zinc-900 rounded-xl p-1">
            {["search","chat"].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${tab===t ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}>
                {t === "search" ? "🔍 Search" : "💬 Chat"}
              </button>
            ))}
          </div>
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setChatHistory([]); setLastQuery(""); }}
              className="text-xs text-zinc-600 hover:text-zinc-400">Clear</button>
          )}
        </div>
      </div>

      {/* MESSAGES */}
      <div ref={chatRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {messages.length === 0 && (
          <div className="space-y-6">
            <div className="text-center pt-6">
              <div className="text-3xl mb-2">💬</div>
              <h2 className="text-lg font-semibold">Ask me anything about your job search</h2>
              <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
                Ask about roles, salaries, how to position your CV, which companies hire from your country, or what to search for. I'll answer directly — and suggest a search when it helps.
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-600 mb-3 text-center">{tab === "chat" ? "Try asking" : "Try these searches"}</p>
              <div className="grid grid-cols-2 gap-2">
                {(tab === "chat" ? CHAT_PROMPTS : SEARCH_PROMPTS).map((p,i) => (
                  <button key={i} onClick={() => tab === "chat" ? runChat(p) : runSearch(p)}
                    className="text-left text-xs text-zinc-400 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 px-3 py-2.5 rounded-xl transition leading-snug">
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <p className="text-xs text-zinc-400 font-medium mb-2">What Job Copilot does:</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500">
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
              <div className="text-sm text-zinc-300">{m.summary}</div>
              {m.intent && (
                <div className="flex flex-wrap gap-1.5">
                  {m.intent.cluster && <Badge className="text-purple-400 bg-purple-500/10 border-purple-900">{m.intent.cluster}</Badge>}
                  {m.intent.locationCountry && <Badge className="text-blue-400 bg-blue-500/10 border-blue-900">📍 {m.intent.locationCountry}</Badge>}
                  {m.intent.remoteOnly && <Badge className="text-emerald-400 bg-emerald-500/10 border-emerald-900">🌐 Remote</Badge>}
                  {m.excluded > 0 && <Badge className="text-red-400 bg-red-500/10 border-red-900">{m.excluded} restricted removed</Badge>}
                </div>
              )}
              {m.jobs.length === 0 ? (
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center">
                  <p className="text-zinc-400 text-sm">No eligible jobs found for this search.</p>
                  <p className="text-zinc-600 text-xs mt-1">Try: "remote customer service" or "data analyst worldwide"</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {m.jobs.map((job,j) => (
                    <JobCard key={j} job={job} onCVMatch={j => setCvModal(j)} onInterviewPrep={j => setInterviewModal(j)} />
                  ))}
                </div>
              )}
            </div>
          );

          if (m.type === "chat_reply") return (
            <div key={i} className="space-y-3">
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">JC</div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-zinc-300 leading-relaxed max-w-[85%] whitespace-pre-wrap">{m.text}</div>
              </div>
              {m.searchSuggestion && (
                <div className="ml-10">
                  <button onClick={() => runSearch(m.searchSuggestion)}
                    className="text-xs text-blue-400 bg-blue-500/10 border border-blue-900 px-3 py-1.5 rounded-xl hover:bg-blue-500/20 transition">
                    🔍 Search: "{m.searchSuggestion}"
                  </button>
                </div>
              )}
            </div>
          );

          if (m.type === "error") return (
            <div key={i} className="text-sm text-red-400 bg-red-500/10 border border-red-900 rounded-xl px-4 py-3">
              ⚠️ {m.text}
            </div>
          );
          return null;
        })}

        {loading && (
          <div className="flex gap-3 items-start">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-xs font-bold shrink-0">JC</div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3"><Spinner /></div>
          </div>
        )}
      </div>

      {/* INPUT */}
      <div className="p-4 border-t border-zinc-900 shrink-0">
        <div className="flex gap-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-2 focus-within:border-zinc-600 transition">
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
            placeholder={tab === "search" ? "e.g. remote customer service open to Nigerians..." : "Ask about jobs, roles, or your search..."}
            className="flex-1 bg-transparent outline-none text-sm px-2 placeholder-zinc-600" />
          <button onClick={handleSend} disabled={loading || !query.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-xl text-sm font-medium transition shrink-0">
            {tab === "search" ? "Search" : "Send"}
          </button>
        </div>
        <p className="text-xs text-zinc-700 text-center mt-1.5">Powered by Qwen via Ollama · Geo-restricted roles are filtered out</p>
      </div>

      {cvModal && <CVMatchPanel job={cvModal} onClose={() => setCvModal(null)} />}
      {interviewModal && <InterviewPanel job={interviewModal} onClose={() => setInterviewModal(null)} />}
    </div>
  );
}