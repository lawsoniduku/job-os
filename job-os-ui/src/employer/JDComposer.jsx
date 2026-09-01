/**
 * employer/JDComposer.jsx - describe the role, answer a few questions,
 * approve the posting.
 *
 * THE SHAPE OF THE FLOW, and why it is three steps rather than a form:
 *
 *   1. DESCRIBE   one box. "Senior backend engineer, Lagos, remote ok,
 *                 must have done payments." Nothing else asked yet.
 *   2. ANSWER     only the questions that matter and that we refuse to
 *                 guess. Each has clickable suggestions, because a
 *                 recruiter answering on a phone will not type four
 *                 paragraphs.
 *   3. APPROVE    the drafted posting, editable, with nothing hidden.
 *
 * WHAT IS DELIBERATELY NOT AUTOMATED. Eligibility and salary are always
 * asked, never inferred - api/ats.js enforces that in code rather than in a
 * prompt. Eligibility is a legal claim only the employer can make, and an
 * invented salary looks exactly like a real one to the person deciding
 * whether to spend an evening applying.
 *
 * And nothing goes live without step 3. The product's claim is that AI
 * drafts and a person approves; a flow that published straight from step 1
 * would make that false.
 */
import { useState } from "react";
import { draftPosting, createPosting, updatePosting } from "../lib/employerApi";

export default function JDComposer({ onCancel, onSaved }) {
  const [step, setStep] = useState("describe");     // describe | answer | approve
  const [brief, setBrief] = useState("");
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [jd, setJd] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function draft(nextAnswers = answers) {
    setBusy(true);
    setError(null);
    try {
      const out = await draftPosting({ brief, answers: nextAnswers });
      if (out.ready) {
        setJd(out.jd);
        setStep("approve");
      } else {
        setQuestions(out.questions || []);
        setStep("answer");
      }
    } catch (e) {
      setError(e.code === "llm_offline"
        ? "The AI is offline right now. You can still write the posting yourself."
        : e.message);
    } finally {
      setBusy(false);
    }
  }

  async function publish(goLive) {
    setBusy(true);
    setError(null);
    try {
      const r = await createPosting({
        title: jd.title,
        description: jd.description,
        location: jd.location,
        remote_type: jd.remote_type,
        employment_type: jd.employment_type,
        seniority: jd.seniority,
        salary_min: jd.salary_min,
        salary_max: jd.salary_max,
        eligible_countries: jd.eligible_countries,
        jd_source: "drafted",
        // Kept so this posting can be redrafted later without asking the
        // same questions again.
        draft_brief: { brief, answers },
      });
      const saved = goLive
        ? (await updatePosting(r.posting.id, { status: "open" })).posting
        : r.posting;
      onSaved(saved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="emp-editor">
      <header className="emp-head">
        <div>
          <h1>New role</h1>
          <div className="emp-steps">
            <Step n={1} label="Describe" active={step === "describe"} done={step !== "describe"} />
            <Step n={2} label="A few questions" active={step === "answer"} done={step === "approve"} />
            <Step n={3} label="Approve" active={step === "approve"} done={false} />
          </div>
        </div>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </header>

      {step === "describe" && (
        <section className="emp-compose">
          <h3>What are you hiring for?</h3>
          <p className="emp-compose-sub">
            Plain language is fine. A sentence or two is enough to start - we'll ask about
            anything important you leave out rather than making it up.
          </p>
          <textarea
            rows={7}
            value={brief}
            autoFocus
            onChange={(e) => setBrief(e.target.value)}
            placeholder={"e.g. We need a senior backend engineer for our payments team in Lagos. Remote is fine. They must have run Postgres at scale and ideally have fintech experience. Someone who can start within a month."}
          />
          <div className="emp-compose-actions">
            <button className="btn primary lg" onClick={() => draft()} disabled={busy || brief.trim().length < 12}>
              {busy ? "Reading..." : "Draft the posting"}
            </button>
            <button className="btn" onClick={() => onCancel("manual")}>I'd rather fill in a form</button>
          </div>
          {error && <div className="auth-error">{error}</div>}
        </section>
      )}

      {step === "answer" && (
        <section className="emp-compose">
          <h3>{questions.length === 1 ? "One thing before we draft it" : `${questions.length} things before we draft it`}</h3>
          <p className="emp-compose-sub">
            These are the ones we won't guess at on your behalf.
          </p>

          {questions.map((q) => (
            <div className="emp-q" key={q.id}>
              <label className="emp-q-text">{q.question}</label>
              {q.why && <p className="emp-q-why">{q.why}</p>}
              {q.suggestions?.length > 0 && (
                <div className="emp-q-suggestions">
                  {q.suggestions.map((s) => (
                    <button
                      key={s}
                      className={`emp-reason-opt ${answers[q.id] === s ? "active" : ""}`}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: s }))}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <input
                value={answers[q.id] || ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                placeholder="Or type your own answer"
              />
            </div>
          ))}

          <div className="emp-compose-actions">
            <button
              className="btn primary lg"
              onClick={() => draft()}
              disabled={busy || !questions.every((q) => String(answers[q.id] || "").trim())}
            >
              {busy ? "Drafting..." : "Draft the posting"}
            </button>
            <button className="btn" onClick={() => setStep("describe")}>Back</button>
          </div>
          {error && <div className="auth-error">{error}</div>}
        </section>
      )}

      {step === "approve" && jd && (
        <section className="emp-compose">
          <h3>Read it before it goes live</h3>
          <p className="emp-compose-sub">
            Everything here is editable. Nothing was invented - if a detail isn't below,
            it's because you didn't mention it.
          </p>

          <label className="field">
            <span className="field-label">Job title</span>
            <input value={jd.title || ""} onChange={(e) => setJd({ ...jd, title: e.target.value })} />
          </label>

          <label className="field">
            <span className="field-label">The posting</span>
            <textarea
              rows={18}
              value={jd.description || ""}
              onChange={(e) => setJd({ ...jd, description: e.target.value })}
            />
          </label>

          <div className="emp-draft-facts">
            <Fact k="Classified as" v={jd.role_cluster || "-"} note="decides which searches it appears in" />
            <Fact k="Location" v={jd.location || "not stated"} />
            <Fact k="Arrangement" v={jd.remote_type ? cap(jd.remote_type) : "not stated"} />
            <Fact k="Type" v={jd.employment_type ? jd.employment_type.replace("_", "-") : "not stated"} />
            <Fact k="Seniority" v={jd.seniority ? cap(jd.seniority) : "not stated"} />
            <Fact
              k="Salary"
              v={jd.salary_min || jd.salary_max
                ? `$${(jd.salary_min || jd.salary_max).toLocaleString()}${jd.salary_max && jd.salary_min ? ` - $${jd.salary_max.toLocaleString()}` : ""}`
                : "not stated"}
            />
          </div>

          <label className="field emp-elig">
            <span className="field-label">Countries you can employ in</span>
            <input
              value={(jd.eligible_countries || []).join(", ")}
              onChange={(e) => setJd({ ...jd, eligible_countries: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              placeholder="Nigeria, Kenya"
            />
            <span className="field-hint">
              This filters out everyone you couldn't legally hire before they spend an
              evening applying. It's the reason candidates trust what they see here.
            </span>
          </label>

          {error && <div className="auth-error">{error}</div>}

          <div className="emp-form-actions">
            <button className="btn" onClick={() => setStep("answer")} disabled={busy}>Back</button>
            <button className="btn" onClick={() => publish(false)} disabled={busy || !jd.title?.trim()}>
              {busy ? "Saving..." : "Save as draft"}
            </button>
            <button className="btn primary" onClick={() => publish(true)} disabled={busy || !jd.title?.trim()}>
              {busy ? "Publishing..." : "Approve and publish"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Step({ n, label, active, done }) {
  return (
    <span className={`emp-step ${active ? "active" : ""} ${done ? "done" : ""}`}>
      <span className="emp-step-n">{done ? "✓" : n}</span>{label}
    </span>
  );
}

function Fact({ k, v, note }) {
  return (
    <div className="emp-df">
      <span className="emp-df-k">{k}</span>
      <span className={`emp-df-v ${v === "not stated" ? "muted" : ""}`}>{v}</span>
      {note && <span className="emp-df-note">{note}</span>}
    </div>
  );
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
