/**
 * views/Copilot.jsx — the conversational core.
 *
 * Day 2 capabilities:
 *   1. Thread persistence — the conversation survives refresh (threads table).
 *   2. Clarify flow — ambiguous intent triggers ONE question before searching;
 *      the user's answer merges into the original query.
 *   3. True refinement — "only above $70k" / "senior only" / "Lever only" /
 *      "posted this week" filter the LIVE result set via /ai/refine, carrying
 *      the previous intent (cluster + country) across turns.
 *   4. Contextual refine chips above the composer, built from the active state.
 *   5. Product analytics on every meaningful action (lib/track).
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { aiSearch, aiRefine, aiClarify, aiChat, aiCvRewrite, verdictOf, fmtSalary } from "../lib/api";
import { supabase } from "../lib/supabaseClient";
import { track } from "../lib/track";
import { recordApplyIntent } from "../lib/applyIntent";
import { extractTextFromFile } from "../lib/extractText";
import { downloadCvPdf, cvFilename } from "../lib/pdf";

const SUGGESTIONS = [
  "Remote data analyst roles open to Nigeria",
  "Customer support jobs that hire worldwide",
  "Product manager roles open to Africans",
];

// If the message contains these AND a search is active, treat it as a
// refinement of the current results rather than a brand-new search.
const REFINE_SIGNALS = [
  /above|over|minimum|at least|\$\d|salary|pay/i,
  /\bsenior\b|\bjunior\b|entry.level|\blead\b|\bprincipal\b/i,
  /lever|greenhouse|ashby|workable/i,
  /this week|today|last \d+ day|posted|newest/i,
  /full.?time|contract|part.?time/i,
  /\bonly\b|\bjust\b|filter|narrow/i,
];
function looksLikeRefinement(text, hasActiveSearch) {
  if (!hasActiveSearch) return false;
  return REFINE_SIGNALS.some((re) => re.test(text));
}

/* ── Thread persistence ─────────────────────────────────────────────────── */

async function loadThread(userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from("threads")
    .select("id, messages, last_query, last_intent")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function saveThread(userId, threadId, messages, lastQuery, lastIntent) {
  if (!userId) return null;
  // Job descriptions are huge — strip them from the stored snapshot.
  const slim = messages.map((m) =>
    m.kind === "results"
      ? { ...m, jobs: m.jobs.map(({ description, ...rest }) => rest) }
      : m
  );
  if (threadId) {
    await supabase.from("threads")
      .update({ messages: slim, last_query: lastQuery, last_intent: lastIntent })
      .eq("id", threadId);
    return threadId;
  }
  const { data } = await supabase.from("threads")
    .insert({ user_id: userId, messages: slim, last_query: lastQuery, last_intent: lastIntent })
    .select("id")
    .maybeSingle();
  return data?.id || null;
}

/* ── Component ──────────────────────────────────────────────────────────── */

export default function Copilot({ shared, active, initialQuery, onInitialConsumed }) {
  const { user, profile, requireAuth, showToast } = shared;

  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState("");
  const [busy, setBusy]                 = useState(false);
  const [tailorJob, setTailorJob]       = useState(null);
  const [threadLoaded, setThreadLoaded] = useState(false);
  // The clarifying question the copilot is waiting on. STATE, not a ref —
  // it drives the composer placeholder, which must re-render.
  const [awaiting, setAwaiting]         = useState(null); // { baseQuery }
  // Mirrors activeIntent for render (refine bar visibility + chips).
  const [intentState, setIntentState]   = useState(null);

  const scrollRef    = useRef(null);
  const threadId     = useRef(null);
  const activeIntent = useRef(null);
  const lastQuery    = useRef(null);
  const chatHistory  = useRef([]);
  const saveTimer    = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Restore the latest thread on sign-in / first open.
  useEffect(() => {
    if (!active || threadLoaded) return;
    let live = true;
    (async () => {
      const thread = await loadThread(user?.id);
      if (!live) return;
      if (thread?.messages?.length) {
        setMessages(thread.messages);
        threadId.current     = thread.id;
        lastQuery.current    = thread.last_query || null;
        activeIntent.current = thread.last_intent || null;
        setIntentState(thread.last_intent || null);
      }
      setThreadLoaded(true);
    })();
    return () => { live = false; };
  }, [active, user?.id, threadLoaded]);

  const persistThread = useCallback((msgs, query, intent) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const id = await saveThread(user?.id, threadId.current, msgs, query, intent);
      if (id) threadId.current = id;
      if (user?.id && query) {
        // Unique (user_id, query) index exists from migration 006.
        await supabase.from("saved_searches")
          .upsert({ user_id: user.id, query }, { onConflict: "user_id,query", ignoreDuplicates: true });
      }
    }, 500);
  }, [user?.id]);

  // Run a query handed in from the landing-page hero (once, after the
  // thread has had a chance to load so we don't clobber a restored thread).
  useEffect(() => {
    if (!active || !initialQuery || !threadLoaded) return;
    const q = initialQuery;
    onInitialConsumed?.();
    push({ role: "user", text: q });
    dispatch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, initialQuery, threadLoaded]);

  function push(msg, afterPush) {
    setMessages((prev) => {
      const next = [...prev, msg];
      afterPush?.(next);
      return next;
    });
  }

  function updateLastResult(updater, persist = false) {
    setMessages((prev) => {
      const revIdx = [...prev].reverse().findIndex((m) => m.kind === "results");
      if (revIdx === -1) return prev;
      const realIdx = prev.length - 1 - revIdx;
      const next = prev.map((m, i) => (i === realIdx ? updater(m) : m));
      if (persist) persistThread(next, lastQuery.current, activeIntent.current);
      return next;
    });
  }

  /* ── Core flows ───────────────────────────────────────────────────────── */

  async function handleSend() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");

    // Answering a clarifying question completes the original query.
    if (awaiting) {
      const merged = `${awaiting.baseQuery} ${q}`;
      setAwaiting(null);
      push({ role: "user", text: q });
      setBusy(true);
      await runSearch(merged);
      setBusy(false);
      return;
    }

    push({ role: "user", text: q });

    if (looksLikeRefinement(q, !!activeIntent.current)) {
      await runRefinement(q);
      return;
    }
    await dispatch(q);
  }

  async function dispatch(q) {
    setBusy(true);
    try {
      const clarify = await aiClarify({ q, hasCountry: !!profile?.country }).catch(() => ({ needsClarification: false }));
      if (clarify.needsClarification) {
        setAwaiting({ baseQuery: q });
        track(user, "clarify_asked", { query: q });
        push({ role: "ai", kind: "question", text: clarify.question });
        return;
      }
      await runSearch(q);
    } finally {
      setBusy(false);
    }
  }

  async function runSearch(q) {
    try {
      const res = await aiSearch({ q, country: profile?.country || undefined, limit: 10 });

      if (res.total === 0 && !res.intent?.cluster) {
        await runChat(q);
        return;
      }

      activeIntent.current = res.intent || null;
      setIntentState(res.intent || null);
      lastQuery.current = q;
      chatHistory.current.push({ role: "user", content: q });
      track(user, "search", { query: q, cluster: res.intent?.cluster, total: res.total, excluded: res.excluded_count });

      push({
        role: "ai", kind: "results",
        query: q,
        cluster: res.intent?.cluster || null,
        variants: res.intent?.variants || [],
        total: res.total,
        excluded: res.excluded_count || 0,
        // How many listings we actually eligibility-checked. This used to be
        // total+excluded, which always summed to the backend's row cap — a
        // hardcoded constant presented as evidence of thoroughness.
        // Deliberately `evaluated` and NOT the raw pool size (`res.scanned`):
        // the pool can be several thousand while we deeply check the most
        // recent 1000, and quoting the bigger number would just be a
        // different lie. evaluated = excluded + eligible exactly, so all
        // three figures on the card reconcile and each one is true.
        scanned: res.evaluated ?? ((res.total || 0) + (res.excluded_count || 0)),
        jobs: res.data || [],
        offset: (res.data || []).length,
        hasMore: !!res.has_more,
        activeFilters: {},
      }, (next) => persistThread(next, q, res.intent));
    } catch (err) {
      push({ role: "ai", kind: "text", text: `Search failed: ${err.message}. If Render is cold-starting, wait ~30s and try again.` });
    }
  }

  async function runRefinement(refinement) {
    setBusy(true);
    try {
      const res = await aiRefine({ refinement, activeIntent: activeIntent.current });
      track(user, "refine", { refinement, type: res.type, total: res.total });

      if (res.type === "new_search") {
        push({ role: "ai", kind: "text", text: `That sounds like a new search — running: "${res.query}"` });
        await runSearch(res.query);
        return;
      }

      // Push the refined results as a NEW block below the confirmation, so the
      // conversation reads top-to-bottom: "you refined" -> "here are the results".
      // (Mutating the old block above the message left users staring at a
      //  "22 roles match" line with no visible cards — the classic bug.)
      setMessages((prev) => {
        const prevResult = [...prev].reverse().find((mm) => mm.kind === "results");
        const newBlock = {
          role: "ai", kind: "results",
          query: lastQuery.current,
          cluster: null,          // no taxonomy card on a refinement
          variants: [],
          total: res.total,
          excluded: prevResult ? prevResult.excluded : 0,
          scanned: prevResult ? prevResult.scanned : res.total,
          jobs: res.data || [],
          offset: (res.data || []).length,
          hasMore: false,
          activeFilters: res.filters || {},
          refinedNote: res.description,
        };
        const next = [...prev, newBlock];
        persistThread(next, lastQuery.current, activeIntent.current);
        return next;
      });
    } catch (err) {
      push({ role: "ai", kind: "text", text: `Couldn't apply that filter: ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  async function runChat(q) {
    try {
      const res = await aiChat({
        message: q,
        history: chatHistory.current.slice(-6),
        context: { lastSearchQuery: lastQuery.current },
      });
      chatHistory.current.push({ role: "user", content: q }, { role: "assistant", content: res.reply });
      push(
        { role: "ai", kind: "text", text: res.reply, searchSuggestion: res.searchSuggestion },
        (next) => persistThread(next, lastQuery.current, activeIntent.current)
      );
    } catch (err) {
      push({ role: "ai", kind: "text", text: `Couldn't get an answer: ${err.message}` });
    }
  }

  async function loadMore() {
    const lastResult = [...messages].reverse().find((m) => m.kind === "results");
    if (!lastResult || busy) return;
    setBusy(true);
    try {
      const res = await aiSearch({
        q: lastResult.query,
        country: profile?.country || undefined,
        limit: 10,
        offset: lastResult.offset,
      });
      updateLastResult((m) => ({
        ...m,
        jobs: dedupe([...m.jobs, ...(res.data || [])]),
        offset: m.offset + (res.data || []).length,
        hasMore: !!res.has_more,
      }), true);
    } catch (err) {
      showToast(`Couldn't load more: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  // "Save for later" — lives inside Tailor & apply now (clearer intent than
  // a per-card Shortlist button). Lands in Pipeline's Saved column.
  async function saveForLater(job) {
    if (!requireAuth()) return false;
    const v = verdictOf(job);
    const { error } = await supabase.from("applications").upsert({
      user_id: user.id,
      job_id: job.id,
      job_title: job.title,
      company: job.company,
      location: job.location,
      apply_url: job.apply_url,
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      source: job.source,
      role_cluster: job.role_cluster || null,
      verdict: v.key,
      verdict_reason: job.eligibility?.reason || null,
      status: "saved",
    }, { onConflict: "user_id,job_id", ignoreDuplicates: true });
    if (error) {
      showToast(`Couldn't save: ${error.message}`);
      return false;
    }
    track(user, "saved_for_later", { job_id: job.id, company: job.company });
    showToast(`${job.company || job.title} saved — find it in Pipeline`);
    return true;
  }

  // Trust feedback loop: user flags a job as not actually open to them.
  // Writes to job_reports (guests allowed). This is the guardrail instrument.
  async function reportJob(job, reason, detail) {
    const v = verdictOf(job);
    // job.id is a UUID string — send it directly. The old code tried to
    // coerce it through Number() which corrupts UUIDs entirely.
    const payload = {
      user_id: user?.id || null,
      job_id: job.id || null,
      job_title: (job.title || "").slice(0, 300),
      company: (job.company || "").slice(0, 200),
      reason,
      detail: detail || null,
      verdict: (v?.key || "unknown").slice(0, 40),
      user_country: profile?.country || null,
    };
    const { error } = await supabase.from("job_reports").insert(payload);
    track(user, "job_reported", { job_id: job.id, reason });
    if (error) {
      console.error("job_reports insert failed:", error.message, error.details, error.hint, payload);
      showToast("Thanks — noted. (Report didn't save — we'll still look into it.)");
    } else {
      showToast("Thank you — that helps us fix eligibility for everyone.");
    }
  }

  function clearThread() {
    setMessages([]);
    setIntentState(null);
    setAwaiting(null);
    activeIntent.current = null;
    lastQuery.current    = null;
    chatHistory.current  = [];
    track(user, "thread_cleared", {});
    if (user?.id && threadId.current) {
      supabase.from("threads").delete().eq("id", threadId.current).then(() => {});
      threadId.current = null;
    }
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  const empty = messages.length === 0;
  const lastResult = [...messages].reverse().find((m) => m.kind === "results");
  const lastResultIdx = messages.map((x) => x.kind).lastIndexOf("results");

  return (
    <>
      <div className="chat-topbar">
        <button className="ct-home" onClick={shared.goHome} title="Back to home">
          <span className="dot" />JobCopilot
        </button>
        {messages.length > 0 && (
          <>
            <span className="ct-title">{lastQuery.current || "Conversation"}</span>
            <button className="btn" onClick={clearThread}>＋ New search</button>
          </>
        )}
      </div>
      <div className="scrollarea" ref={scrollRef}>
        <div className="chat-wrap">
          {empty && threadLoaded && (
            <div className="empty-state">
              <h1>Every job you see here,<br />you can actually get.</h1>
              <p>Tell me what you're looking for. I verify eligibility — location rules, region locks, sponsorship — before you see a single listing.</p>
              <div className="prompts">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="prompt-chip" onClick={() => { push({ role: "user", text: s }); dispatch(s); }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div className="msg user" key={i}><div className="bubble">{m.text}</div></div>
            ) : (
              <div className="msg ai" key={i}>
                <div className="ai-label"><span className="dot" />Copilot</div>

                {m.kind === "text" && (
                  <>
                    <div className="ai-text">{m.text}</div>
                    {m.searchSuggestion && (
                      <div className="refine">
                        <button
                          className="prompt-chip"
                          onClick={() => {
                            push({ role: "user", text: m.searchSuggestion });
                            setBusy(true);
                            runSearch(m.searchSuggestion).finally(() => setBusy(false));
                          }}
                        >
                          Search: {m.searchSuggestion}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {m.kind === "question" && (
                  <div className="clarify-block">
                    <div className="ai-text">{m.text}</div>
                  </div>
                )}

                {m.kind === "results" && (
                  <ResultsBlock
                    m={m}
                    isLatest={i === lastResultIdx}
                    onLoadMore={loadMore}
                    onTailor={setTailorJob}
                    onReport={reportJob}
                    user={user}
                    busy={busy}
                  />
                )}
              </div>
            )
          )}

          {busy && (
            <div className="msg ai">
              <div className="ai-label"><span className="dot" />Copilot</div>
              <div className="thinking" aria-label="Copilot is working"><span /><span /><span /></div>
            </div>
          )}
        </div>
      </div>

      <div className="composer">
        {intentState && !busy && !awaiting && (
          <div className="refine-bar">
            <span className="refine-label">Refine</span>
            {buildRefineChips(lastResult).map((chip) => (
              <button key={chip} className="prompt-chip" onClick={() => { push({ role: "user", text: chip }); runRefinement(chip); }}>
                {chip}
              </button>
            ))}
            <button className="refine-clear" onClick={clearThread}>New search</button>
          </div>
        )}
        <div className="composer-inner">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={
              awaiting ? "Answer the question above…"
              : intentState ? 'Refine — "only above $70k", "senior only", "posted this week"…'
              : 'Ask anything — "remote product roles open to Ghana"'
            }
            aria-label="Message the copilot"
            disabled={busy}
          />
          <button className="send" onClick={handleSend} disabled={busy || !input.trim()} aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <div className="composer-hint">
          {profile?.country
            ? `Eligibility-checked for ${cap(profile.country)}${intentState ? " · type to refine, or start a new search" : ""}`
            : "Set your country in You → for automatic eligibility checking"}
        </div>
      </div>

      {tailorJob && <TailorModal job={tailorJob} shared={shared} onSaveForLater={saveForLater} onClose={() => setTailorJob(null)} />}
    </>
  );
}

/* ── Taxonomy card (collapsible) ────────────────────────────────────────── */

function TaxonomyCard({ cluster, variants }) {
  // Collapsed by default on small screens — the full list ate the whole
  // viewport on mobile. Show the first 4, expand on tap.
  const [open, setOpen] = useState(false);
  const PREVIEW = 4;
  const shown = open ? variants : variants.slice(0, PREVIEW);
  const hidden = variants.length - PREVIEW;

  return (
    <div className="taxonomy-card">
      <div className="taxonomy-head">
        <span className="tx-label">Role taxonomy</span>
        <span className="tx-title">{cluster}</span>
        <span className="tx-count">{variants.length} variants</span>
      </div>
      <div className="taxonomy-body">
        {shown.map((v, i) => (
          <span key={v} className={`tx-chip ${i === 0 ? "primary" : ""}`}>
            <span className="chip-dot" />{v}
          </span>
        ))}
        {!open && hidden > 0 && (
          <button className="tx-more" onClick={() => setOpen(true)}>
            +{hidden} more
          </button>
        )}
      </div>
      <div className="taxonomy-foot">
        A title-only search misses most of these — the engine matches the <b>role</b>, not the wording.
        {open && <button className="tx-collapse" onClick={() => setOpen(false)}>Collapse</button>}
      </div>
    </div>
  );
}

/* ── Results block ──────────────────────────────────────────────────────── */

function ResultsBlock({ m, isLatest, onLoadMore, onTailor, onReport, user, busy }) {
  const hasFilters = m.activeFilters && Object.values(m.activeFilters).some(Boolean);
  return (
    <>
      {m.cluster && m.variants.length > 1 && (
        <>
          <div className="ai-text">
            <b>{m.cluster}</b> gets posted under {m.variants.length} different names — I searched all of them:
          </div>
          <TaxonomyCard cluster={m.cluster} variants={m.variants} />
        </>
      )}

      {m.refinedNote ? (
        <div className="refined-header">
          <span className="refined-label">Refined</span>
          <span className="refined-desc">{m.refinedNote} — {m.total} role{m.total !== 1 ? "s" : ""}</span>
        </div>
      ) : (
        <div className="scan-card" role="group" aria-label="Eligibility scan">
          <div className="scan-item" aria-label={`${m.scanned.toLocaleString()} listings scanned`}><div className="num" aria-hidden="true">{m.scanned.toLocaleString()}</div><div className="lbl">listings scanned across all role names</div></div>
          <div className="scan-item excluded" aria-label={`${m.excluded.toLocaleString()} excluded — region-locked or restricted`}><div className="num" aria-hidden="true">{m.excluded.toLocaleString()}</div><div className="lbl">excluded — region-locked or restricted</div></div>
          <div className="scan-item eligible" aria-label={`${m.total.toLocaleString()} roles you are actually eligible for`}><div className="num" aria-hidden="true">{m.total.toLocaleString()}</div><div className="lbl">you are actually eligible for</div></div>
        </div>
      )}

      {hasFilters && (
        <div className="filter-pills">
          {m.activeFilters.salFloor && <span className="filter-pill">${m.activeFilters.salFloor >= 1000 ? m.activeFilters.salFloor / 1000 + "k" : m.activeFilters.salFloor}+ salary</span>}
          {m.activeFilters.seniorityFilter && <span className="filter-pill">{cap(m.activeFilters.seniorityFilter)}</span>}
          {m.activeFilters.sourceFilter && <span className="filter-pill">{cap(m.activeFilters.sourceFilter)} only</span>}
          {m.activeFilters.maxAgeDays && <span className="filter-pill">Last {m.activeFilters.maxAgeDays}d</span>}
          {m.activeFilters.employmentFilter && <span className="filter-pill">{m.activeFilters.employmentFilter.replace("_", "-")}</span>}
        </div>
      )}

      {m.total === 0 && (
        <div className="ai-text" style={{ marginTop: 10 }}>
          No eligible roles match those filters right now. Loosen a constraint — new listings arrive daily.
        </div>
      )}

      {m.jobs.map((job) => (
        <JobCard key={job.id} job={job} onTailor={onTailor} onReport={onReport} user={user} />
      ))}

      {isLatest && m.hasMore && (
        <div className="refine">
          <button className="prompt-chip" disabled={busy} onClick={onLoadMore}>
            Show more ({m.total - m.jobs.length} remaining)
          </button>
        </div>
      )}
    </>
  );
}

/* ── Job card ───────────────────────────────────────────────────────────── */

function JobCard({ job, onTailor, onReport, user }) {
  const [pop, setPop] = useState(false);
  const [matchPop, setMatchPop] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const v   = verdictOf(job);
  const sal = fmtSalary(job.salary_min, job.salary_max);
  const confLabel = { certain: "High", likely: "Good", possible: "Unconfirmed" }[job.eligibility?.confidence] || "—";

  useEffect(() => {
    if (!pop && !matchPop) return;
    const close = () => { setPop(false); setMatchPop(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [pop, matchPop]);

  // Plain-English readout of the score breakdown, so "89% match" isn't a
  // black box — {roleScore: 0-55, locScore: 20-48, bonus: freshness/salary}.
  const mb = job.match_breakdown;
  const matchLines = mb ? [
    [Math.round(mb.roleScore), 50, "How well the role matches your search"],
    [Math.round(mb.locScore), 35, "How confident we are it's open to you"],
    [Math.round(mb.bonus), 15, "Freshness / salary listed"],
  ] : null;

  const REASONS = [
    ["location", "Not open to my country"],
    ["visa", "Needs visa/sponsorship"],
    ["experience", "Wrong experience level"],
    ["salary", "Salary doesn't match"],
    ["expired", "Posting is expired/gone"],
    ["other", "Something else"],
  ];

  function fileReport(reason) {
    onReport?.(job, reason);
    setReporting(false);
    setReported(true);
  }

  return (
    <div className="job-card">
      <div className="jc-top">
        <span className="pop-wrap">
          <button
            className={`verdict ${v.key}`}
            onClick={(e) => { e.stopPropagation(); setPop((p) => !p); }}
            aria-expanded={pop}
            title="Why this verdict"
          >
            <span className="vdot" />{v.label}
          </button>
          {pop && (
            <div className="popover" onClick={(e) => e.stopPropagation()}>
              <h4>Why this verdict</h4>
              <p style={{ margin: 0 }}>{job.eligibility?.reason || "Eligibility signal found in the posting."}</p>
              <div className="conf">Confidence: <b>{confLabel}</b>{v.key === "conditional" && " — confirm in the posting before applying"}</div>
            </div>
          )}
        </span>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="jc-title-row">
            <span className="jc-title">{job.title}</span>
            {job.role_cluster && <span className="jc-variant">{job.role_cluster}</span>}
          </div>
          <div className="jc-co">{job.company}{job.location ? ` · ${job.location}` : ""}</div>
        </div>

        <span className="pop-wrap">
          <button
            className="jc-match"
            onClick={(e) => { e.stopPropagation(); setMatchPop((p) => !p); }}
            aria-expanded={matchPop}
            title="What makes up this score"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            <div className="pct">{Math.min(job.score || 0, 100)}%</div>
            <div className="m-lbl">match</div>
          </button>
          {matchPop && matchLines && (
            <div className="popover" onClick={(e) => e.stopPropagation()}>
              <h4>What makes up this score</h4>
              {matchLines.map(([val, max, label]) => (
                <p key={label} style={{ margin: "4px 0" }}>
                  <b>{val > 0 ? `+${val}` : val}{max ? `/${max}` : ""}</b> — {label}
                </p>
              ))}
              <div className="conf" style={{ marginTop: 6 }}>
                Role fit and eligibility drive the score; recency and salary only nudge it — a strong match never loses to a merely newer, weaker one.
              </div>
            </div>
          )}
        </span>
      </div>

      {job.match_reason && <div className="jc-why">{job.match_reason}</div>}

      <div className="jc-meta">
        {sal && <span className="sal">{sal}</span>}
        {job.posted_at && <span>{fmtPosted(job.posted_at)}</span>}
        {job.source && <span>{job.source}</span>}
      </div>

      {(() => {
        const sig = applySignal(job);
        return sig ? <div className={`jc-signal ${sig.tone}`}>{sig.text}</div> : null;
      })()}

      <div className="jc-actions">
        <button className="btn primary" onClick={() => onTailor(job)}>Tailor & apply</button>
        {job.apply_url && (
          /* No preventDefault: the link navigates natively and the record is
             fire-and-forget, so nothing can delay or block the trip out. */
          <a className="btn" href={job.apply_url} target="_blank" rel="noreferrer"
             onClick={() => recordApplyIntent({ user, job, source: "result_card" })}
             style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            View posting ↗
          </a>
        )}
      </div>

      <div className="jc-report">
        {reported ? (
          <span className="jc-report-done">✓ Thanks — flagged for review</span>
        ) : reporting ? (
          <div className="jc-report-reasons">
            <span className="jc-report-q">Why isn't it open to you?</span>
            {REASONS.map(([key, label]) => (
              <button key={key} className="jc-report-reason" onClick={() => fileReport(key)}>{label}</button>
            ))}
            <button className="jc-report-cancel" onClick={() => setReporting(false)}>Cancel</button>
          </div>
        ) : (
          <button className="jc-report-trigger" onClick={() => setReporting(true)}>
            This job isn't actually open to me
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Tailor modal ───────────────────────────────────────────────────────── */

function TailorModal({ job, shared, onSaveForLater, onClose }) {
  const { user, profile, requireAuth, showToast } = shared;
  const [cvText, setCvText]     = useState("");
  const [cvSource, setCvSource] = useState(null);  // "profile" | filename
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedLater, setSavedLater] = useState(false);
  const [error, setError]       = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    track(user, "tailor_opened", { job_id: job.id, company: job.company });
    let live = true;
    (async () => {
      if (user) {
        const { data } = await supabase.from("saved_cvs").select("cv_text, filename").eq("user_id", user.id).maybeSingle();
        if (live && data?.cv_text) { setCvText(data.cv_text); setCvSource(data.filename || "profile"); }
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, job.id]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setError("");
    try {
      const text = await extractTextFromFile(file);
      setCvText(text);
      setCvSource(file.name);
      // Save it as the user's CV so next time it's automatic.
      if (user) {
        await supabase.from("saved_cvs").upsert({ user_id: user.id, cv_text: text, filename: file.name });
        track(user, "cv_uploaded", { via: "tailor", type: file.name.split(".").pop() });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function run() {
    if (!cvText.trim()) { setError("Upload or paste your CV first."); return; }
    setLoading(true); setError("");
    try {
      const res = await aiCvRewrite({ cvText, jobId: job.id });
      const r = res.result || {};
      // Map the endpoint shape into what CvPreview / downloadCvPdf expect.
      const t = r.tailored_cv || {};
      // The header is not optional. The prompt used to omit name/contact
      // entirely while this code read them, so every generated PDF came out
      // anonymous — no name, no email, opening straight into PROFESSIONAL
      // SUMMARY. The prompt asks for them now; this is the belt-and-braces
      // fallback to the signed-in profile so a model slip can never again
      // produce a CV nobody can be contacted about.
      const contactBits = [user?.email, profile?.country ? cap(profile.country) : null].filter(Boolean);
      const cv = {
        name: t.name?.trim() || profile?.full_name || null,
        contact: t.contact?.trim() || (contactBits.length ? contactBits.join(" · ") : null),
        summary: t.summary || "",
        sections: t.sections || [],
      };
      setResult({
        cv,
        cover_letter: r.cover_letter || "",
        match_notes: r.match_notes || "",
        changes_made: r.changes_made || [],
        keywords_added: r.keywords_added || [],
        // plain-text fallback for copy
        rewritten_cv: cvToText(cv),
      });
      track(user, "tailor_generated", { job_id: job.id });
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
      source: job.source, role_cluster: job.role_cluster || null,
      verdict: v.key, verdict_reason: job.eligibility?.reason || null,
      // A hand-confirmed "I applied" is the strongest answer the nudge could
      // ever get, so record it in the same shape and skip asking later.
      status: "applied", applied_at: new Date().toISOString(),
      apply_outcome: "applied", outcome_at: new Date().toISOString(),
      cv_label: `CV · ${job.company || job.title}`,
    }, { onConflict: "user_id,job_id" });
    if (e) showToast(`Couldn't record: ${e.message}`);
    else {
      track(user, "marked_applied", { job_id: job.id, company: job.company });
      showToast("Recorded in Pipeline — interview prep is ready on that card");
      onClose();
    }
  }

  return (
    <div className="modal-scrim" role="presentation" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Tailor CV — ${job.title}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Tailor CV — {job.title} at {job.company}</h3>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {!result ? (
            <>
              <div className="cv-upload-row">
                <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? "Reading file…" : cvText ? "Replace CV (PDF / DOCX)" : "Upload CV (PDF / DOCX)"}
                </button>
                <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt,.md" style={{ display: "none" }} onChange={handleFile} />
                {cvText && (
                  <span className="cv-source">
                    {cvSource && cvSource !== "profile" ? `Using ${cvSource}` : "Using your saved CV"}
                  </span>
                )}
              </div>
              <label className="field-label" style={{ marginTop: 14 }}>
                {cvText ? "Review or edit before tailoring" : "…or paste your CV as text"}
              </label>
              <textarea className="textarea" value={cvText} onChange={(e) => setCvText(e.target.value)} placeholder="Paste your CV text here…" />
              {error && <div style={{ color: "var(--ineligible)", fontSize: 13, marginTop: 8 }}>{error}</div>}
            </>
          ) : (
            <>
              <div className="s-sub">Tailored against the actual JD — every employer, date and qualification from your CV preserved. This preview is exactly what the PDF will look like.</div>
              {result.match_notes && (
                <div className="match-notes"><b>Honest read:</b> {result.match_notes}</div>
              )}
              {result.cv ? <CvPreview cv={result.cv} /> : <pre>{result.rewritten_cv}</pre>}
              {result.cover_letter && (
                <div className="cover-letter">
                  <div className="cl-head">
                    <label className="field-label" style={{ margin: 0 }}>Cover letter</label>
                    <button className="btn subtle sm" onClick={() => navigator.clipboard?.writeText(result.cover_letter).then(() => showToast("Cover letter copied")).catch(() => showToast("Copy failed — select the text manually"))}>Copy</button>
                  </div>
                  <div className="cl-body">{result.cover_letter}</div>
                </div>
              )}
              {result.changes_made?.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <label className="field-label">What I changed</label>
                  {result.changes_made.map((c, i) => (
                    <div className="qa-item" key={i} style={{ padding: "7px 0" }}>
                      <div className="qa-tip" style={{ marginTop: 0 }}>{c}</div>
                    </div>
                  ))}
                </div>
              )}
              {result.keywords_added?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <label className="field-label">JD keywords worked in</label>
                  {result.keywords_added.map((k) => <span className="kw-pill" key={k}>{k}</span>)}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          {!result ? (
            <>
              <button className="btn primary" onClick={run} disabled={loading || uploading}>
                {loading ? "Tailoring…" : "Tailor my CV"}
              </button>
              <button className={`btn ${savedLater ? "done" : ""}`} onClick={async () => {
                const ok = await onSaveForLater?.(job);
                if (ok) setSavedLater(true);
              }}>
                {savedLater ? "Saved ✓" : "Save for later"}
              </button>
            </>
          ) : (
            <>
              <button
                className="btn primary"
                disabled={!result.cv}
                onClick={async () => {
                  try {
                    await downloadCvPdf(result.cv, cvFilename(job.company, job.title));
                    track(user, "cv_pdf_downloaded", { job_id: job.id, company: job.company });
                  } catch {
                    showToast("PDF generation failed — use Copy text as a fallback");
                  }
                }}
              >
                Download PDF
              </button>
              {job.apply_url && (
                <a className="btn" href={job.apply_url} target="_blank" rel="noreferrer"
                   onClick={() => recordApplyIntent({ user, job, source: "tailor_modal" })}
                   style={{ textDecoration: "none" }}>
                  Open application ↗
                </a>
              )}
              <button className="btn" onClick={markApplied}>Mark as applied</button>
              <button
                className="btn subtle"
                onClick={() => navigator.clipboard?.writeText(result.rewritten_cv).then(() => showToast("Copied")).catch(() => showToast("Copy failed — select the text manually"))}
              >
                Copy text
              </button>
            </>
          )}
          <span className="note">Nothing is sent anywhere without you</span>
        </div>
      </div>
    </div>
  );
}

/* ── CV preview — mirrors the PDF layout ────────────────────────────────── */

function CvPreview({ cv }) {
  return (
    <div className="cv-preview">
      {cv.name && <div className="cvp-name">{cv.name}</div>}
      {cv.contact && <div className="cvp-contact">{cv.contact}</div>}
      {cv.summary && (
        <>
          <div className="cvp-heading">Professional Summary</div>
          <p className="cvp-body">{cv.summary}</p>
        </>
      )}
      {(cv.sections || []).map((s, si) => (
        <div key={si}>
          <div className="cvp-heading">{s.heading}</div>
          {(s.entries || []).map((e, ei) => (
            <div className="cvp-entry" key={ei}>
              {(e.title || e.org || e.dates) && (
                <div className="cvp-entry-head">
                  <span className="cvp-entry-title">
                    {[e.title, e.org].filter(Boolean).join(" — ")}
                  </span>
                  {e.dates && <span className="cvp-entry-dates">{e.dates}</span>}
                </div>
              )}
              {(e.bullets || []).map((b, bi) => (
                <div className="cvp-bullet" key={bi}><span>•</span><span>{b}</span></div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Utilities ──────────────────────────────────────────────────────────── */

function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function fmtPosted(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "Posted today";
  if (d === 1) return "Posted yesterday";
  if (d < 7) return `Posted ${d}d ago`;
  if (d < 30) return `Posted ${Math.floor(d / 7)}w ago`;
  return `Posted ${new Date(iso).toLocaleDateString()}`;
}

// ATS sources = the job lives on the employer's own applicant-tracking system,
// so applying goes straight to them (not a second-hand board repost).
const DIRECT_ATS = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "teamtailor", "breezy"];

// Flatten a structured CV to plain text for the "Copy text" fallback.
function cvToText(cv) {
  const out = [];
  if (cv.name) out.push(cv.name);
  if (cv.contact) out.push(cv.contact);
  if (cv.summary) out.push("\nPROFESSIONAL SUMMARY\n" + cv.summary);
  for (const sec of cv.sections || []) {
    out.push("\n" + (sec.heading || "").toUpperCase());
    for (const e of sec.entries || []) {
      const head = [e.title, e.org, e.dates].filter(Boolean).join(" · ");
      if (head) out.push(head);
      for (const b of e.bullets || []) out.push("• " + b);
    }
  }
  return out.join("\n");
}

/**
 * An HONEST "is this worth your effort?" read, computed only from data we
 * actually have: how fresh the posting is, and whether it's a direct-employer
 * post. No fake applicant counts — inventing numbers would poison the trust
 * the whole product is built on. Returns one short line, or null if we can't
 * say anything useful.
 *
 * Research basis: roles get 200-400 applications in the first 48h while
 * recruiters are still reading; freshness is the single most actionable signal.
 */
function applySignal(job) {
  const src = (job.ats_source || job.source || "").toLowerCase();
  const direct = DIRECT_ATS.some((a) => src.includes(a));
  let ageDays = null;
  if (job.posted_at) ageDays = Math.floor((Date.now() - new Date(job.posted_at).getTime()) / 86400000);

  // Freshness drives the headline read.
  if (ageDays != null && ageDays <= 2) {
    return { tone: "hot", text: direct ? "Fresh + direct to employer — strong time to apply" : "Just posted — recruiters are still reading" };
  }
  if (ageDays != null && ageDays <= 7) {
    return { tone: "warm", text: direct ? "Recent + applies direct to employer" : "Posted this week — still worth a tailored application" };
  }
  if (ageDays != null && ageDays >= 30) {
    return { tone: "cool", text: "Older posting — apply only if it's a strong match" };
  }
  // Middle-aged: only surface the direct-employer advantage if present.
  if (direct) return { tone: "warm", text: "Applies direct to the employer's system" };
  return null;
}

function buildRefineChips(lastResult) {
  const f = lastResult?.activeFilters || {};
  const chips = [];
  if (!f.salFloor)        { chips.push("Only above $60k"); chips.push("Only above $80k"); }
  if (!f.seniorityFilter)   chips.push("Senior roles only");
  if (!f.maxAgeDays)        chips.push("Posted this week");
  return chips.slice(0, 4);
}
