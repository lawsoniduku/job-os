/**
 * views/Copilot.jsx — the conversation. The search bar IS the product.
 *
 * Flow per search:
 *   1. taxonomy card  — which role variants the engine expanded to (real data
 *      from the server's intent.variants)
 *   2. scan card      — scanned / excluded / eligible (real counts from the
 *      server's total + excluded_count)
 *   3. job cards      — verdict badge (eligibility confidence), match %, reason
 *   4. actions        — Tailor & apply (cv-rewrite + review), Shortlist (Pipeline)
 *
 * Non-search questions fall through to /ai/chat.
 */
import { useState, useRef, useEffect } from "react";
import { aiSearch, aiChat, aiCvRewrite, verdictOf, fmtSalary } from "../lib/api";
import { supabase } from "../lib/supabaseClient";

const SUGGESTIONS = [
  "Remote data analyst roles open to Nigeria",
  "Customer support jobs that hire worldwide",
  "Product manager roles open to Africans",
];

export default function Copilot({ shared, active }) {
  const { user, profile, requireAuth, showToast } = shared;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tailorJob, setTailorJob] = useState(null);
  const scrollRef = useRef(null);
  const chatHistory = useRef([]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  function push(msg) { setMessages((m) => [...m, msg]); }

  async function runSearch(q) {
    if (busy || !q.trim()) return;
    setBusy(true);
    setInput("");
    push({ role: "user", text: q });
    try {
      const res = await aiSearch({ q, country: profile?.country || undefined, limit: 10 });
      if (res.total === 0 && !res.intent?.cluster) {
        // Doesn't look like a job search — treat it as a question.
        await runChat(q);
        return;
      }
      chatHistory.current.push({ role: "user", content: q });
      push({
        role: "ai", kind: "results",
        query: q,
        cluster: res.intent?.cluster || null,
        variants: res.intent?.variants || [],
        total: res.total,
        excluded: res.excluded_count || 0,
        scanned: (res.total || 0) + (res.excluded_count || 0),
        jobs: res.data || [],
        offset: (res.data || []).length,
        hasMore: !!res.has_more,
        summary: res.summary,
      });
    } catch (err) {
      push({ role: "ai", kind: "text", text: `Something went wrong: ${err.message}. If the backend is asleep on Render's free tier, give it ~30s and try again.` });
    } finally {
      setBusy(false);
    }
  }

  async function runChat(q) {
    try {
      const res = await aiChat({
        message: q,
        history: chatHistory.current.slice(-6),
        context: {},
      });
      chatHistory.current.push({ role: "user", content: q }, { role: "assistant", content: res.reply });
      push({ role: "ai", kind: "text", text: res.reply, searchSuggestion: res.searchSuggestion });
    } catch (err) {
      push({ role: "ai", kind: "text", text: `Couldn't get an answer: ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(msgIndex) {
    const msg = messages[msgIndex];
    if (!msg || busy) return;
    setBusy(true);
    try {
      const res = await aiSearch({ q: msg.query, country: profile?.country || undefined, limit: 10, offset: msg.offset });
      setMessages((all) => all.map((m, i) => i === msgIndex ? {
        ...m,
        jobs: dedupe([...m.jobs, ...(res.data || [])]),
        offset: m.offset + (res.data || []).length,
        hasMore: !!res.has_more,
      } : m));
    } catch (err) {
      showToast(`Couldn't load more: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function shortlist(job) {
    if (!requireAuth()) return;
    const v = verdictOf(job);
    const { error } = await supabase.from("applications").insert({
      user_id: user.id,
      job_id: job.id,
      job_title: job.title,
      company: job.company,
      location: job.location,
      apply_url: job.apply_url,
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      source: job.source,
      verdict: v.key,
      verdict_reason: job.eligibility?.reason || null,
      status: "shortlist",
    });
    if (error) {
      showToast(error.code === "23505" ? "Already in your Pipeline" : `Couldn't save: ${error.message}`);
    } else {
      showToast(`${job.company || job.title} added to your Shortlist`);
    }
  }

  function handleSend() {
    const q = input.trim();
    if (q) runSearch(q);
  }

  const empty = messages.length === 0;

  return (
    <>
      <div className="scrollarea" ref={scrollRef}>
        <div className="chat-wrap">
          {empty && (
            <div className="empty-state">
              <h1>Every job you see here,<br />you can actually get.</h1>
              <p>Tell me what you're looking for. I check eligibility — location rules, region locks, language — before you ever see a listing.</p>
              <div className="prompts">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="prompt-chip" onClick={() => runSearch(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => m.role === "user" ? (
            <div className="msg user" key={i}><div className="bubble">{m.text}</div></div>
          ) : (
            <div className="msg ai" key={i}>
              <div className="ai-label"><span className="dot" />Copilot</div>
              {m.kind === "text" && (
                <>
                  <div className="ai-text">{m.text}</div>
                  {m.searchSuggestion && (
                    <div className="refine">
                      <button className="prompt-chip" onClick={() => runSearch(m.searchSuggestion)}>
                        Search: {m.searchSuggestion}
                      </button>
                    </div>
                  )}
                </>
              )}
              {m.kind === "results" && (
                <ResultsBlock m={m} msgIndex={i} onLoadMore={loadMore} onShortlist={shortlist} onTailor={setTailorJob} busy={busy} onRefine={runSearch} />
              )}
            </div>
          ))}

          {busy && (
            <div className="msg ai">
              <div className="ai-label"><span className="dot" />Copilot</div>
              <div className="thinking" aria-label="Copilot is working"><span /><span /><span /></div>
            </div>
          )}
        </div>
      </div>

      <div className="composer">
        <div className="composer-inner">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder='Ask anything — "remote product roles open to Ghana"'
            aria-label="Message the copilot"
            disabled={busy}
          />
          <button className="send" onClick={handleSend} disabled={busy} aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
          </button>
        </div>
        <div className="composer-hint">Every result is eligibility-checked for {profile?.country ? cap(profile.country) : "your location"}</div>
      </div>

      {tailorJob && (
        <TailorModal job={tailorJob} shared={shared} onClose={() => setTailorJob(null)} />
      )}
    </>
  );
}

/* ---------------- Results block ---------------- */

function ResultsBlock({ m, msgIndex, onLoadMore, onShortlist, onTailor, busy, onRefine }) {
  return (
    <>
      {m.cluster && m.variants.length > 1 && (
        <>
          <div className="ai-text">
            This role gets posted under <b>{m.variants.length} different names</b> — I searched all of them so you don't miss anything:
          </div>
          <div className="taxonomy-card">
            <div className="taxonomy-head">
              <span className="tx-label">Role taxonomy</span>
              <span className="tx-title">{m.cluster}</span>
              <span className="tx-count">{m.variants.length} variants</span>
            </div>
            <div className="taxonomy-body">
              {m.variants.map((v, i) => (
                <span key={v} className={`tx-chip ${i === 0 ? "primary" : ""}`} style={{ animationDelay: `${i * 50}ms` }}>
                  <span className="chip-dot" />{v}
                </span>
              ))}
            </div>
            <div className="taxonomy-foot">
              A title-only search would miss most of these — the engine matches the <b>role</b>, not the wording.
            </div>
          </div>
        </>
      )}

      <div className="scan-card" role="group" aria-label="Scan results">
        <div className="scan-item"><div className="num">{m.scanned.toLocaleString()}</div><div className="lbl">recent {m.cluster || "matching"} listings scanned</div></div>
        <div className="scan-item excluded"><div className="num">{m.excluded.toLocaleString()}</div><div className="lbl">excluded — region-locked or restricted</div></div>
        <div className="scan-item eligible"><div className="num">{m.total.toLocaleString()}</div><div className="lbl">you are actually eligible for</div></div>
      </div>

      {m.total === 0 && (
        <div className="ai-text" style={{ marginTop: 10 }}>
          Nothing eligible right now for this exact search. Try broader terms, or drop a constraint — new roles land daily and Briefing will flag matches.
        </div>
      )}

      {m.jobs.map((job) => (
        <JobCard key={job.id} job={job} onShortlist={onShortlist} onTailor={onTailor} />
      ))}

      {m.hasMore && (
        <div className="refine">
          <button className="prompt-chip" disabled={busy} onClick={() => onLoadMore(msgIndex)}>
            Show more ({m.total - m.jobs.length} remaining)
          </button>
          <button className="prompt-chip" disabled={busy} onClick={() => onRefine(`${m.query} senior`)}>Senior only</button>
          <button className="prompt-chip" disabled={busy} onClick={() => onRefine(`${m.query} posted this week`)}>Newest first</button>
        </div>
      )}
    </>
  );
}

function JobCard({ job, onShortlist, onTailor }) {
  const [pop, setPop] = useState(false);
  const [saved, setSaved] = useState(false);
  const v = verdictOf(job);
  const sal = fmtSalary(job.salary_min, job.salary_max);
  const confLabel = { certain: "High", likely: "Good", possible: "Unconfirmed" }[job.eligibility?.confidence] || "—";

  return (
    <div className="job-card">
      <div className="jc-top">
        <span className="pop-wrap">
          <button
            className={`verdict ${v.key}`}
            onClick={() => setPop((p) => !p)}
            aria-expanded={pop}
            title="Why this verdict"
          >
            <span className="vdot" />{v.label}
          </button>
          {pop && (
            <span className="popover" onClick={(e) => e.stopPropagation()}>
              <h4>Why this verdict</h4>
              {job.eligibility?.reason || "Eligibility signal found in the posting."}
              <span className="conf" style={{ display: "block" }}>
                Confidence: <b>{confLabel}</b>{v.key === "conditional" && " — open the posting to confirm before applying"}
              </span>
            </span>
          )}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="jc-title-row">
            <span className="jc-title">{job.title}</span>
            {job.role_cluster && <span className="jc-variant">{job.role_cluster}</span>}
          </div>
          <div className="jc-co">{job.company}{job.location ? ` · ${job.location}` : ""}</div>
        </div>
        <div className="jc-match">
          <div className="pct">{Math.min(job.score || 0, 100)}%</div>
          <div className="m-lbl">match</div>
        </div>
      </div>
      {job.match_reason && <div className="jc-why">{job.match_reason}</div>}
      <div className="jc-meta">
        {sal && <span className="sal">{sal}</span>}
        {job.posted_at && <span>Posted {new Date(job.posted_at).toLocaleDateString()}</span>}
        {job.source && <span>{job.source}</span>}
      </div>
      <div className="jc-actions">
        <button className="btn primary" onClick={() => onTailor(job)}>Tailor & apply</button>
        <button className={`btn ${saved ? "done" : ""}`} onClick={() => { onShortlist(job); setSaved(true); }}>
          {saved ? "Shortlisted ✓" : "Shortlist"}
        </button>
        {job.apply_url && (
          <a className="btn" href={job.apply_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            View posting ↗
          </a>
        )}
      </div>
    </div>
  );
}

/* ---------------- Tailor & apply modal ---------------- */

function TailorModal({ job, shared, onClose }) {
  const { user, requireAuth, showToast } = shared;
  const [cvText, setCvText] = useState("");
  const [cvLoaded, setCvLoaded] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load master CV from Studio's saved_cvs.
  useEffect(() => {
    let live = true;
    (async () => {
      if (user) {
        const { data } = await supabase.from("saved_cvs").select("cv_text").eq("user_id", user.id).maybeSingle();
        if (live && data?.cv_text) setCvText(data.cv_text);
      }
      if (live) setCvLoaded(true);
    })();
    return () => { live = false; };
  }, [user]);

  async function run() {
    if (!cvText.trim()) { setError("Paste your CV first, or save a master CV in Studio."); return; }
    setLoading(true); setError("");
    try {
      const res = await aiCvRewrite({ cvText, jobId: job.id });
      setResult(res.result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function markApplied() {
    if (!requireAuth()) return;
    const v = verdictOf(job);
    const { error: e } = await supabase.from("applications").upsert({
      user_id: user.id, job_id: job.id,
      job_title: job.title, company: job.company, location: job.location,
      apply_url: job.apply_url, salary_min: job.salary_min, salary_max: job.salary_max,
      source: job.source, verdict: v.key, verdict_reason: job.eligibility?.reason || null,
      status: "applied", applied_at: new Date().toISOString(),
      cv_label: `CV · ${job.company || job.title}`,
    }, { onConflict: "user_id,job_id" });
    if (e) showToast(`Couldn't record it: ${e.message}`);
    else { showToast("Recorded in Pipeline as Applied"); onClose(); }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Tailor CV — {job.title} at {job.company}</h3>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {!result && (
            <>
              <label className="field-label">Your CV {cvLoaded && cvText ? "(loaded from Studio — edit freely)" : "(paste it, or save a master CV in Studio once)"}</label>
              <textarea className="textarea" value={cvText} onChange={(e) => setCvText(e.target.value)} placeholder="Paste your CV text here…" />
              {error && <div style={{ color: "var(--ineligible)", fontSize: 13, marginTop: 8 }}>{error}</div>}
            </>
          )}
          {result && (
            <>
              <div className="s-sub">Tailored against the actual job description. Review and edit before you use it — you always fire the final shot.</div>
              <pre>{result.rewritten_cv}</pre>
              {result.keywords_added?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <label className="field-label">Keywords the JD wants that your CV was missing</label>
                  {result.keywords_added.map((k) => <span className="kw-pill" key={k}>{k}</span>)}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          {!result ? (
            <button className="btn primary" onClick={run} disabled={loading}>
              {loading ? "Tailoring…" : "Tailor my CV"}
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => navigator.clipboard?.writeText(result.rewritten_cv).then(() => shared.showToast("Copied"))}>Copy text</button>
              {job.apply_url && (
                <a className="btn primary" href={job.apply_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                  Open application ↗
                </a>
              )}
              <button className="btn" onClick={markApplied}>Mark as applied</button>
            </>
          )}
          <span className="note">Nothing is sent anywhere without you</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- utils ---------------- */
function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
