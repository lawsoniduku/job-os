/**
 * JOB COPILOT API SERVER v3.1 (refactored)
 * ----------------------------------------
 * What changed vs v3:
 *   - All model calls go through lib/llm.js (json mode, retries, ctx sizing).
 *   - Search retrieval uses the boundary-aware role engine + SAFE filters
 *     (no more raw user input interpolated into PostgREST .or()/.ilike()).
 *   - LLM re-rank is ONE batched call instead of N per-job calls
 *     (faster, far more reliable on a local 7B model).
 *   - CV match / rewrite / interview / chat all use generateJSON/generateText,
 *     so "Could not parse analysis" failures are largely eliminated.
 */

// ── Load .env FIRST — must happen before any other import reads process.env ──
// In ES modules all imports are hoisted, so dotenv imported the normal way
// gets called AFTER lib/llm.js has already read process.env.OLLAMA_MODEL.
// The --require trick doesn't work for ESM; instead we use the synchronous
// fs+dotenv approach right here at the top of the entry point.
import { config } from "dotenv";
config(); // populates process.env before the rest of the imports below execute

import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import {
  parseIntent,
  scoreJobLocally,
  getAliasesForCluster,
  ROLE_TAXONOMY,
  LOCATION_INTELLIGENCE,
} from "./roleIntelligence.js";
import { generateJSON, generateText, isLLMHealthy, llmConfig, llmState } from "../lib/llm.js";

// Friendly message for when a structured call comes back empty.
function llmFailMessage(fallback = "The model returned an unreadable response. Please try again.") {
  if (llmState.lastError === "timeout")
    return "The local model ran out of time — it's slow on CPU. Try again, or switch to a faster model (see README: llama3.2:3b).";
  return fallback;
}

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true })); // tighten in prod
app.use(express.json({ limit: "4mb" }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const JOB_COLUMNS =
  "id, title, company, location, description, apply_url, remote, source, ats_source, " +
  "role_cluster, department, seniority, posted_at, created_at, salary_min, " +
  "salary_max, employment_type, remote_type, eligibility_region";

// PostgREST .or()/.ilike() treat , . ( ) * : as structural. Strip them from
// any value we interpolate so a query like "a),b" can't rewrite the filter.
function safeFilterValue(s = "") {
  return s.replace(/[,().*:%\\]/g, " ").replace(/\s+/g, " ").trim();
}

app.get("/health", async (_req, res) => {
  const ok = await isLLMHealthy();
  res.json({ status: "ok", service: "job-copilot-v3.1", model: llmConfig.model, ollama: ok ? "connected" : "offline" });
});

// ============================================================
// SEARCH
// ============================================================
app.get("/ai/search", async (req, res) => {
  try {
    const { q, limit: limitParam = "20", offset: offsetParam = "0", country: profileCountry } = req.query;
    if (!q) return res.status(400).json({ error: "Missing query" });
    const limit = Math.min(parseInt(limitParam) || 20, 50);
    const offset = Math.max(parseInt(offsetParam) || 0, 0);

    const intent = parseIntent(q);

    // If the query itself didn't specify a location, fall back to the
    // logged-in user's profile country (sent by the frontend as ?country=).
    // Explicit query terms always win — this only fills in when locationCountry
    // is null, e.g. "remote data analyst jobs" from a Nigerian user becomes
    // scoped to Nigeria without them typing it every time.
    if (!intent.locationCountry && profileCountry) {
      // Only accept a country that is an actual key in the engine's location map
      // (plus the broad region keys). Anything else is ignored, never trusted raw.
      const VALID = new Set([...Object.keys(LOCATION_INTELLIGENCE), "africa"]);
      if (/^[a-z_]+$/.test(profileCountry) && VALID.has(profileCountry)) {
        intent.locationCountry = profileCountry;
      }
    }

    console.log(`🔍 "${q}" -> cluster=${intent.cluster} country=${intent.locationCountry} remote=${intent.remoteOnly}`);

    // --- retrieval: prefer cluster, fall back to safe keyword ilike ---
    let dbQuery = supabase.from("jobs").select(JOB_COLUMNS);
    if (intent.cluster) {
      const aliases = getAliasesForCluster(intent.cluster).slice(0, 10).map(safeFilterValue).filter(Boolean);
      const titleFilters = aliases.map((a) => `title.ilike.%${a}%`).join(",");
      dbQuery = dbQuery.or(`role_cluster.eq.${safeFilterValue(intent.cluster)},${titleFilters}`);
    } else if (intent.keywords.length > 0) {
      const kw = safeFilterValue(intent.keywords[0]);
      if (kw) dbQuery = dbQuery.ilike("title", `%${kw}%`); // value is parameterized -> safe
    }

    // FRESHNESS GATE — hard 28-day cutoff on posted_at.
    // Jobs with null posted_at pass through (no date field = still included).
    const cutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
    dbQuery = dbQuery.or(`posted_at.is.null,posted_at.gte.${cutoff}`);

    // Eligibility region pre-filter for African country searches.
    // Cuts US/UK/EU-only jobs from the pool before the engine sees them.
    if (intent.locationCountry && intent.locationCountry !== "worldwide") {
      const country = intent.locationCountry.toLowerCase();
      const AFRICAN_COUNTRIES = ["nigeria","kenya","ghana","ethiopia","south africa","egypt",
        "tanzania","uganda","cameroon","senegal","rwanda","ivory coast","zimbabwe","zambia","africa"];
      if (AFRICAN_COUNTRIES.includes(country)) {
        dbQuery = dbQuery.in("eligibility_region", ["Nigeria","Africa","Global","Remote","EMEA","Unknown"]);
      } else {
        dbQuery = dbQuery.in("eligibility_region", ["Global","Remote","Unknown"]);
      }
    }

    // Order by recency BEFORE the limit.
    dbQuery = dbQuery.order("posted_at", { ascending: false, nullsFirst: false });

    const { data: rawJobs, error } = await dbQuery.limit(500);
    if (error) return res.status(500).json({ error: error.message });
    if (!rawJobs?.length) return res.json({ query: q, total: 0, data: [], message: "No jobs found. Try a broader query." });

    // --- local scoring + hard eligibility gate ---
    const scored = rawJobs.map((job) => {
      const r = scoreJobLocally(job, intent);
      return { ...job, score: r.score, eligibility: r.eligibility, offTarget: r.offTarget };
    });
    // drop geo-restricted AND cross-department mismatches (e.g. "Support Engineer"
    // surfacing in a Customer Support search because of a stale stored label).
    const eligible = scored.filter((j) => j.eligibility.eligible !== false && !j.offTarget);
    const excludedCount = scored.length - eligible.length;
    eligible.sort((a, b) => b.score - a.score);
    console.log(`✅ eligible=${eligible.length} ❌ excluded=${excludedCount}`);

    // --- optional ONE-SHOT batched LLM re-rank of the top slice ---
    // OFF by default: the local scorer already ranks well, and an LLM round-trip
    // on every search adds 2-5s of latency. Set LLM_RERANK=on to re-enable.
    const rerankOn = process.env.LLM_RERANK === "on";
    const topN = eligible.slice(0, 8);
    const rest = eligible.slice(8);
    let finalResults = eligible;

    if (rerankOn && topN.length > 1 && (await isLLMHealthy())) {
      const reranked = await batchRerank(q, intent, topN);
      finalResults = [...reranked, ...rest.map((j) => ({ ...j, match_reason: j.eligibility.reason }))];
    } else {
      finalResults = eligible.map((j) => ({ ...j, match_reason: j.eligibility.reason }));
    }

    finalResults.sort((a, b) => b.score - a.score);
    const totalAvailable = finalResults.length;        // how many eligible matches exist in all
    const results = finalResults.slice(offset, offset + limit);
    const hasMore = offset + limit < totalAvailable;   // is there another page after this one?

    const locPart = intent.locationCountry ? ` open to ${intent.locationCountry} candidates`
      : intent.remoteOnly ? " that are remote" : "";
    const filteredPart = excludedCount > 0 ? ` (${excludedCount} geo-restricted filtered out)` : "";
    const summary = totalAvailable === 0
      ? `No results for "${q}". Try broader terms.`
      : `Found ${totalAvailable} ${intent.cluster || "matching"} role${totalAvailable !== 1 ? "s" : ""}${locPart}${filteredPart}.`;

    res.json({
      query: q,
      intent: {
        cluster: intent.cluster,
        locationCountry: intent.locationCountry,
        remoteOnly: intent.remoteOnly,
        seniority: intent.seniority,
        variants: (intent.matchedAliases || []).slice(0, 12),
      },
      total: totalAvailable, offset, limit, has_more: hasMore,
      excluded_count: excludedCount, summary, data: results,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

/**
 * Batched re-rank: ONE model call scores all candidates at once.
 * Returns the candidates with a blended score + reason. On any failure it
 * degrades gracefully to the local score (search never hard-fails on the LLM).
 */
async function batchRerank(query, intent, jobs) {
  const list = jobs.map((j, i) =>
    `${i}. ${j.title} @ ${j.company} | loc: ${j.location || "?"} | ${(j.description || "").slice(0, 120)}`
  ).join("\n");

  const prompt = `You rank job relevance for a candidate.
QUERY: ${query}
WANTED ROLE: ${intent.cluster || "general"} | LOCATION: ${intent.locationCountry || "any"} | REMOTE: ${intent.remoteOnly}

CANDIDATES:
${list}

For each candidate return relevance 0-100 and a 6-word reason.
Return ONLY JSON of shape: {"rankings":[{"i":0,"score":87,"reason":"..."}]}`;

  // fast-fail: one attempt, short timeout, small context. If it can't keep up,
  // search still returns instantly on local scores (graceful fallback below).
  const parsed = await generateJSON(prompt, { timeoutMs: 18000, numCtx: 4096, retries: 0 });
  const rankings = parsed?.rankings;
  if (!Array.isArray(rankings)) {
    return jobs.map((j) => ({ ...j, match_reason: j.eligibility.reason })); // graceful fallback
  }
  const byIdx = new Map(rankings.map((r) => [Number(r.i), r]));
  return jobs.map((j, i) => {
    const r = byIdx.get(i);
    const llmScore = typeof r?.score === "number" ? r.score : j.score;
    const blended = Math.round(j.score * 0.6 + llmScore * 0.4);
    return { ...j, score: blended, match_reason: r?.reason || j.eligibility.reason };
  }).sort((a, b) => b.score - a.score);
}

// ============================================================
// CV MATCH
// ============================================================
app.post("/ai/cv-match", async (req, res) => {
  try {
    const { cvText, jobId } = req.body;
    if (!cvText?.trim()) return res.status(400).json({ error: "Please paste or upload your CV text first." });
    if (!jobId) return res.status(400).json({ error: "Missing jobId" });

    const { data: job, error } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    if (error || !job) return res.status(404).json({ error: "Job not found" });
    if (!(await isLLMHealthy())) return res.status(503).json({ error: "AI model offline. Run: ollama serve" });

    const prompt = `You are an expert ATS analyser. Score this CV against the job.
JOB: ${job.title} at ${job.company}
LOCATION: ${job.location}
DESCRIPTION: ${(job.description || "").slice(0, 1500)}
CV: ${cvText.slice(0, 2500)}

Return ONLY JSON:
{"overall_score":85,"grade":"B","summary":"2-3 sentences","strengths":["s1","s2","s3"],"gaps":["g1","g2","g3"],"missing_keywords":["k1","k2","k3"],"recommendations":["r1","r2","r3"],"likelihood":"High chance of interview"}`;

    const analysis = await generateJSON(prompt, { timeoutMs: 90000 });
    if (!analysis) return res.status(502).json({ error: llmFailMessage("Model returned an unreadable analysis. Please try again.") });
    res.json({ job: { id: job.id, title: job.title, company: job.company }, analysis });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// CV REWRITE — sequential short calls, each fits in CPU budget
// ============================================================
app.post("/ai/cv-rewrite", async (req, res) => {
  try {
    const { cvText, jobId } = req.body;
    if (!cvText?.trim()) return res.status(400).json({ error: "No CV text provided" });
    if (!jobId) return res.status(400).json({ error: "Missing jobId" });

    const { data: job, error } = await supabase.from("jobs")
      .select("title,company,description,location").eq("id", jobId).single();
    if (error || !job) return res.status(404).json({ error: "Job not found" });
    if (!(await isLLMHealthy())) return res.status(503).json({ error: llmFailMessage("AI model offline.") });

    // Full CV + generous JD slice. The old version truncated the CV to 1500
    // chars across 3 fragmented calls and left "[tailor remaining sections]"
    // placeholders — the exact generic output recruiters reject on sight.
    // One strong structured call produces a real, complete, ready-to-send
    // CV AND a matching cover letter, grounded in the candidate's real CV.
    const jd = (job.description || "").slice(0, 6000);
    const cv = cvText.slice(0, 12000);

    const prompt = `You are an expert CV writer and career coach helping a candidate apply for a specific role. Tailor their real CV to this job and write a matching cover letter. Ground everything in their ACTUAL experience — never invent employers, titles, dates, or achievements. Tailoring means re-emphasising and rewording real experience to match the job, not fabricating.

TARGET ROLE: ${job.title} at ${job.company}${job.location ? ` (${job.location})` : ""}

JOB DESCRIPTION:
${jd}

CANDIDATE'S CURRENT CV:
${cv}

Return ONLY valid JSON in this exact shape:
{
  "tailored_cv": {
    "summary": "3-4 sentence professional summary rewritten to target this exact role, using the job's language where the candidate genuinely matches it",
    "sections": [
      {
        "heading": "SECTION NAME (e.g. EXPERIENCE, EDUCATION, SKILLS)",
        "entries": [
          {
            "title": "Job title or qualification (keep the candidate's real one)",
            "org": "Company or institution (real)",
            "dates": "Dates as in the original CV",
            "bullets": ["Achievement bullet reworded to emphasise relevance to the target role, quantified where the original allows"]
          }
        ]
      }
    ]
  },
  "cover_letter": "A genuine 3-paragraph cover letter addressed to the hiring team at ${job.company}. Para 1: why this specific role. Para 2: 2-3 concrete, real achievements from their CV that map to the job's needs. Para 3: brief close. Warm, specific, human — not templated. No placeholders like [Your Name].",
  "keywords_added": ["up to 6 important keywords from the JD woven into the tailored CV"],
  "changes_made": ["up to 4 short notes on what was tailored and why"],
  "match_notes": "1-2 honest sentences: where the candidate is strong for this role, and any gap they should address"
}

Every section, employer, date and qualification from the original CV must be preserved. Do not drop experience. Do not fabricate. Output ONLY the JSON.`;

    const result = await generateJSON(prompt, { timeoutMs: 120000, retries: 1, temperature: 0.35 });
    if (!result || !result.tailored_cv) {
      return res.status(502).json({ error: llmFailMessage("Tailoring timed out. Try again.") });
    }

    res.json({
      job: { title: job.title, company: job.company, location: job.location },
      result: {
        tailored_cv: result.tailored_cv,
        cover_letter: result.cover_letter || "",
        keywords_added: result.keywords_added || [],
        changes_made: result.changes_made || [],
        match_notes: result.match_notes || "",
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// INTERVIEW COACH — sequential small calls, job-aware always
// ============================================================
app.post("/ai/interview-coach", async (req, res) => {
  try {
    const { jobId, cvText, mode = "questions" } = req.body;
    if (!jobId) return res.status(400).json({ error: "Missing jobId" });

    const { data: job, error } = await supabase.from("jobs")
      .select("title,company,description,role_cluster").eq("id", jobId).single();
    if (error || !job) return res.status(404).json({ error: "Job not found" });

    const jd = (job.description || "").slice(0, 600);
    const cluster = job.role_cluster || "General";
    const cv = cvText ? cvText.slice(0, 400) : "";

    if (!(await isLLMHealthy())) {
      return res.json({ job: { title: job.title, company: job.company },
        mode, result: buildFallbackQuestions(job) });
    }

    if (mode === "questions") {
      // CALL 1: 4 specific questions referencing the actual role + JD skills
      const qResult = await generateJSON(
        `You are preparing someone for a ${job.title} interview at ${job.company}.
Role type: ${cluster}
Key skills from JD: ${jd.slice(0, 400)}
${cv ? `Candidate background: ${cv}` : ""}

Write exactly 4 interview questions. Each MUST reference specific skills, tools, or
responsibilities from the JD above. Do NOT write generic questions.
Return ONLY JSON:
{"questions":[
  {"category":"Technical","question":"Based on the JD requirement for [specific skill], how have you...","tip":"what the interviewer is looking for"},
  {"category":"Behavioural","question":"Tell me about a time you...","tip":"use STAR format"},
  {"category":"Situational","question":"If you were asked to...","tip":"show your process"},
  {"category":"Motivational","question":"Why ${job.company} specifically...","tip":"show company research"}
]}`,
        { timeoutMs: 70000, retries: 1 }
      );

      // CALL 2: research tips + questions to ask (separate small call)
      const tipsResult = await generateJSON(
        `Interview at ${job.company} for ${job.title} role.
JD summary: ${jd.slice(0, 300)}
Give 3 specific company research tips and 3 smart questions to ask the interviewer.
Return ONLY JSON:
{"research_tips":["t1","t2","t3"],"questions_to_ask":["q1","q2","q3"]}`,
        { timeoutMs: 50000, retries: 0 }
      );

      const questions = qResult?.questions?.length
        ? qResult.questions
        : [
            { category: "Technical", question: `Walk me through how you would approach the core ${cluster} responsibilities listed in this job description.`, tip: "Reference specific tools and methods from the JD" },
            { category: "Behavioural", question: `Tell me about a time you delivered measurable results in a ${cluster} role. What was the impact?`, tip: "Quantify — numbers make answers memorable" },
            { category: "Situational", question: `${job.title} roles often involve competing priorities. How do you decide what to tackle first?`, tip: "Show a clear prioritisation framework" },
            { category: "Motivational", question: `What specifically about ${job.company} and this ${job.title} role made you apply?`, tip: "Show you researched the company — mention something specific" },
          ];

      res.json({
        job: { title: job.title, company: job.company, cluster },
        mode,
        result: {
          company_research_tips: tipsResult?.research_tips || [
            `Research ${job.company}'s recent product updates, news, and mission statement`,
            "Read employee reviews on Glassdoor to understand the team culture",
            "Look up your interviewers on LinkedIn and note their backgrounds",
          ],
          likely_questions: questions,
          questions_to_ask_them: tipsResult?.questions_to_ask || [
            `What does success look like in the first 90 days as ${job.title}?`,
            "How does the team collaborate across time zones?",
            "What are the biggest challenges you're hoping this hire will solve?",
          ],
          red_flags_to_avoid: [
            "Generic answers that could apply to any company — always reference this specific role",
            "Badmouthing past employers",
            "Not having questions to ask — always prepare at least 3",
          ],
          star_reminder: "STAR = Situation → Task → Action → Result. Always end with a quantified result.",
        },
      });

    } else {
      // tips mode
      const r = await generateJSON(
        `Interview day preparation tips for ${job.title} at ${job.company}.
Skills the role requires: ${jd.slice(0, 350)}
Return ONLY JSON:
{"day_before_tips":["t1","t2","t3"],"day_of_tips":["t1","t2","t3"],
"technical_prep":["a1","a2","a3"],"salary_negotiation":"one paragraph",
"mindset":"one paragraph"}`,
        { timeoutMs: 60000, retries: 1 }
      );
      res.json({ job: { title: job.title, company: job.company, cluster },
        mode, result: r || buildFallbackTips(job) });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// CHAT
// ============================================================
app.post("/ai/chat", async (req, res) => {
  try {
    const { message, history = [], context = {} } = req.body;
    if (!message) return res.status(400).json({ error: "Missing message" });
    if (!(await isLLMHealthy())) {
      return res.json({
        reply: "The AI model is offline. Start it with: ollama serve\n\nYou can still use search directly — just type what role and location you're looking for.",
        searchSuggestion: null
      });
    }

    const historyText = history.slice(-6)
      .map((h) => `${h.role === "user" ? "User" : "JobCopilot"}: ${h.content}`)
      .join("\n");

    const prompt = `You are JobCopilot, an AI career assistant. You help job seekers worldwide find remote roles that are genuinely open to them based on their location.

You understand:
- Role families (people analytics = HR data = workforce intelligence)
- Location eligibility (which remote jobs are actually open to which countries)
- Career advice, CV tips, interview preparation
- Salary expectations by country and role

${context.lastSearchQuery ? `The user's last search was: "${context.lastSearchQuery}"` : ""}
${historyText ? `\nConversation so far:\n${historyText}` : ""}

User: ${message}

Instructions:
- Answer the question directly and helpfully first
- If the user is asking about job types, roles, or career paths, give a real answer with examples
- If the user wants to find jobs, end your reply with exactly: SEARCH: <the best search query>
- If the user is asking a general question (salary, advice, how to apply, CV tips), just answer it — do NOT add a SEARCH line
- Keep replies concise — 3 to 5 sentences maximum
- Never say "I cannot" or "I don't have access" — give your best answer`;

    const text = await generateText(prompt, { timeoutMs: 60000 });
    if (!text) return res.json({
      reply: "I couldn't generate a response right now. Try rephrasing your question or use the Search tab directly.",
      searchSuggestion: null
    });

    // Only extract search suggestion if the model actually included one
    const searchMatch = text.match(/SEARCH:\s*(.+?)(?:\n|$)/i);
    const searchSuggestion = searchMatch?.[1]?.trim() || null;

    // Clean the reply — remove the SEARCH line and any trailing whitespace
    const reply = text
      .replace(/SEARCH:\s*.+?(?:\n|$)/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // If the reply is empty after stripping (model only wrote SEARCH:), give a useful default
    const finalReply = reply.length > 10
      ? reply
      : `I found a relevant search for you${searchSuggestion ? `: "${searchSuggestion}"` : ""}. Click the suggestion below to run it.`;

    res.json({ reply: finalReply, searchSuggestion });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// REFINE — apply a plain-language constraint to a live result set
// ============================================================
// The frontend sends the active intent + current job IDs + the
// refinement phrase. We re-score/filter WITHOUT a new DB round-trip:
// the refinement is parsed on top of the previous intent so context
// is preserved ("only $70k+" knows we were already looking at
// Data Analytics roles in Nigeria).
//
// Refinement types handled deterministically (no LLM needed):
//   salary:     "above $70k", "over 60k", "$80k+"
//   seniority:  "senior only", "junior", "entry level"
//   source:     "lever only", "greenhouse", "ashby"
//   recency:    "this week", "last 3 days", "posted today"
//   employment: "full time only", "contract"
//
// Anything not matched deterministically goes to the LLM to
// produce a new search query (graceful fallback).
// ============================================================
app.post("/ai/refine", async (req, res) => {
  try {
    const { refinement, activeIntent, jobIds = [] } = req.body;
    if (!refinement) return res.status(400).json({ error: "Missing refinement" });
    if (!activeIntent?.cluster && !activeIntent?.keywords?.length) {
      return res.status(400).json({ error: "No active search to refine — run a search first." });
    }

    const r = refinement.toLowerCase().trim();

    // ── Deterministic parsers ──────────────────────────────
    // 1. Salary floor — "$70k", "above 60k", "over $80,000".
    //    Numbers under 1000 are treated as thousands (70 -> 70000)
    //    because salaries in the jobs table are stored as annual figures.
    const salMatch = r.match(/(?:above|over|>\s*|minimum\s*|at least\s*)\$?\s*([\d,]+)\s*k?/);
    let salFloor = null;
    if (salMatch) {
      const n = parseInt(salMatch[1].replace(/,/g, ""), 10);
      if (!Number.isNaN(n)) salFloor = n < 1000 ? n * 1000 : n;
    }

    // 2. Seniority
    let seniorityFilter = null;
    if (/\bsenior\b|\bsr\.?\b|\blead\b|\bprincipal\b/.test(r)) seniorityFilter = "senior";
    else if (/\bjunior\b|\bjr\.?\b|\bentry\b|\bgraduate\b/.test(r)) seniorityFilter = "junior";

    // 3. Source / ATS
    let sourceFilter = null;
    if (/\blever\b/.test(r)) sourceFilter = "lever";
    else if (/\bgreenhouse\b/.test(r)) sourceFilter = "greenhouse";
    else if (/\bashby\b/.test(r)) sourceFilter = "ashby";
    else if (/\bworkable\b/.test(r)) sourceFilter = "workable";

    // 4. Recency (days)
    let maxAgeDays = null;
    if (/today|24 hours/.test(r)) maxAgeDays = 1;
    else if (/this week|last 7|past week/.test(r)) maxAgeDays = 7;
    else if (/last 3 days|past 3/.test(r)) maxAgeDays = 3;
    else if (/last 14|two weeks|past two/.test(r)) maxAgeDays = 14;
    else if (/this month|last 30|past month/.test(r)) maxAgeDays = 30;

    // 5. Employment type
    let employmentFilter = null;
    if (/full.?time/.test(r)) employmentFilter = "full_time";
    else if (/\bcontract\b/.test(r)) employmentFilter = "contract";
    else if (/\bpart.?time\b/.test(r)) employmentFilter = "part_time";

    const isDeterministic = salFloor || seniorityFilter || sourceFilter || maxAgeDays || employmentFilter;

    if (!isDeterministic) {
      // ── LLM fallback: turn the refinement into a new search query ──
      // Merge the refinement with what we know about the active search.
      const mergedQuery = [
        activeIntent.cluster || activeIntent.keywords?.join(" ") || "",
        activeIntent.locationCountry || "",
        refinement,
      ].filter(Boolean).join(" ");

      return res.json({
        type: "new_search",
        query: mergedQuery,
        message: `Searching for: "${mergedQuery}"`,
      });
    }

    // ── Re-fetch + filter ──────────────────────────────────
    // Rebuild the same DB query the search endpoint uses, on top of the
    // PREVIOUS intent — this is what makes refinement conversational:
    // the cluster and country from the original search carry over.
    const baseQ = activeIntent.cluster || activeIntent.keywords?.join(" ") || "";
    const intent = parseIntent(baseQ);
    if (activeIntent.locationCountry) intent.locationCountry = activeIntent.locationCountry;
    if (activeIntent.remoteOnly) intent.remoteOnly = true;
    // Let the explicit refinement override seniority.
    if (seniorityFilter) intent.seniority = seniorityFilter;

    let dbQuery = supabase.from("jobs").select(JOB_COLUMNS);
    if (intent.cluster) {
      const aliases = getAliasesForCluster(intent.cluster).slice(0, 10).map(safeFilterValue).filter(Boolean);
      const titleFilters = aliases.map((a) => `title.ilike.%${a}%`).join(",");
      dbQuery = dbQuery.or(`role_cluster.eq.${safeFilterValue(intent.cluster)},${titleFilters}`);
    } else if (intent.keywords?.length) {
      const kw = safeFilterValue(intent.keywords[0]);
      if (kw) dbQuery = dbQuery.ilike("title", `%${kw}%`);
    }

    if (maxAgeDays) {
      const since = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
      dbQuery = dbQuery.gte("posted_at", since);
    }
    if (sourceFilter) dbQuery = dbQuery.ilike("source", `%${sourceFilter}%`);
    if (employmentFilter) dbQuery = dbQuery.eq("employment_type", employmentFilter);

    dbQuery = dbQuery.order("posted_at", { ascending: false, nullsFirst: false });
    const { data: rawJobs, error } = await dbQuery.limit(500);
    if (error) return res.status(500).json({ error: error.message });

    const scored = (rawJobs || []).map((job) => {
      const r2 = scoreJobLocally(job, intent);
      return { ...job, score: r2.score, eligibility: r2.eligibility, offTarget: r2.offTarget };
    });

    let eligible = scored.filter((j) => j.eligibility.eligible !== false && !j.offTarget);

    // Apply salary floor client-friendly — salary_min or salary_max must reach floor.
    if (salFloor) {
      eligible = eligible.filter((j) =>
        (j.salary_max && j.salary_max >= salFloor) || (j.salary_min && j.salary_min >= salFloor)
      );
    }

    eligible.sort((a, b) => b.score - a.score);
    const results = eligible.slice(0, 20).map((j) => ({ ...j, match_reason: j.eligibility.reason }));

    // Human-readable description of what changed.
    const parts = [];
    if (salFloor) parts.push(`salary reaching $${salFloor >= 1000 ? salFloor / 1000 + "k" : salFloor}+`);
    if (seniorityFilter) parts.push(`${seniorityFilter}-level only`);
    if (sourceFilter) parts.push(`${sourceFilter} applications`);
    if (maxAgeDays) parts.push(`posted in the last ${maxAgeDays} day${maxAgeDays > 1 ? "s" : ""}`);
    if (employmentFilter) parts.push(employmentFilter.replace("_", "-"));
    const description = parts.length ? `Filtered to ${parts.join(", ")}` : "Refined";

    res.json({
      type: "refined",
      description,
      total: eligible.length,
      excluded_count: scored.length - eligible.length,
      data: results,
      filters: { salFloor, seniorityFilter, sourceFilter, maxAgeDays, employmentFilter },
    });
  } catch (err) {
    console.error("/ai/refine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CLARIFY — should the copilot ask a follow-up before searching?
// ============================================================
// Called when intent is ambiguous (no cluster detected, no country).
// Returns { needsClarification: bool, question: string|null,
//           suggestedQuery: string|null }
// Fast: deterministic, no LLM call.
// ============================================================
app.post("/ai/clarify", async (req, res) => {
  try {
    const { q, hasCountry } = req.body;
    if (!q) return res.status(400).json({ error: "Missing q" });

    const intent = parseIntent(q);
    const issues = [];

    // No role cluster AND no meaningful keywords → too vague.
    if (!intent.cluster && intent.keywords.filter((k) => k.length > 3).length < 2) {
      issues.push("role");
    }
    // The copilot doesn't know the user's country from ANY source (query or
    // profile) → it must ask, because eligibility checking is the product.
    // Exception: explicitly worldwide queries.
    const explicitlyWorldwide = /\bworldwide\b|\banywhere\b|\bglobal(ly)?\b/i.test(q);
    if (!intent.locationCountry && !hasCountry && !explicitlyWorldwide) {
      issues.push("location");
    }

    if (issues.length === 0) {
      return res.json({ needsClarification: false, question: null, suggestedQuery: q });
    }

    // Build one targeted question covering the most important gap.
    let question = null;
    if (issues.includes("role") && issues.includes("location")) {
      question = "What kind of role are you looking for, and where are you based?";
    } else if (issues.includes("role")) {
      question = "What kind of role are you looking for? For example: data analyst, product manager, customer success.";
    } else if (issues.includes("location")) {
      question = "Which country are you applying from? I check every job's eligibility against it — e.g. Nigeria, Kenya, Ghana.";
    }

    res.json({ needsClarification: true, question, suggestedQuery: null, detectedIntent: intent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROLE SUGGESTIONS (typeahead)
// ============================================================
app.get("/ai/role-suggestions", (req, res) => {
  const q = (req.query.q || "").toLowerCase().trim();
  if (q.length < 2) return res.json({ clusters: ROLE_TAXONOMY.map((e) => e.cluster), suggestions: [] });
  const suggestions = [];
  for (const entry of ROLE_TAXONOMY) {
    for (const alias of entry.aliases) if (alias.includes(q)) suggestions.push({ label: alias, cluster: entry.cluster });
    if (suggestions.length >= 8) break;
  }
  res.json({ suggestions: suggestions.slice(0, 8) });
});

// --- deterministic fallbacks (unchanged from v3) -----------------
function buildFallbackQuestions(job) {
  return {
    company_research_tips: [
      `Research ${job.company}'s recent news, product, and culture`,
      "Read employee reviews on Glassdoor to understand team dynamics",
      "Review the LinkedIn profiles of your interviewers",
    ],
    likely_questions: [
      { category: "Motivational", question: `Why ${job.company} as a ${job.title}?`, why_asked: "Checks genuine interest", tips: "Be specific about mission and fit" },
      { category: "Behavioural", question: "Tell me about yourself.", why_asked: "Standard opener", tips: "2-min pitch: past → present → why here" },
      { category: "Behavioural", question: "Describe a challenge and how you resolved it.", why_asked: "Problem-solving", tips: "Use STAR" },
      { category: "Situational", question: "How do you handle sudden priority changes?", why_asked: "Adaptability", tips: "Communication + prioritisation" },
      { category: "Technical", question: "Walk me through your relevant experience.", why_asked: "Skill fit", tips: "Map experience to JD requirements" },
      { category: "Behavioural", question: "Tell me about working in a remote team.", why_asked: "Remote readiness", tips: "Name tools + async habits" },
      { category: "Situational", question: "How do you manage work across time zones?", why_asked: "Remote-critical", tips: "Calendaring + proactive updates" },
      { category: "Motivational", question: "Where do you see yourself in 2-3 years?", why_asked: "Career alignment", tips: "Ambition aligned with company growth" },
    ],
    questions_to_ask_them: [
      "What does success look like in the first 90 days?",
      "How does the team stay aligned across time zones?",
      "What are the biggest challenges the team faces now?",
    ],
    red_flags_to_avoid: ["Badmouthing past employers", "No questions prepared", "Vague about achievements"],
    star_reminder: "STAR = Situation → Task → Action → Result. Use it for every behavioural question; quantify the result.",
  };
}
function buildFallbackTips(job) {
  return {
    day_before_tips: [`Re-read the ${job.title} JD and note 3 matching examples`, "Test internet, camera, mic", "Prepare 5 questions to ask"],
    day_of_tips: ["Arrive 5 minutes early", "Keep CV, JD, notes visible", "Speak slowly and pause"],
    technical_prep: ["Review tools/skills in the JD", "Prepare 2 case studies", "Be ready for a practical task"],
    salary_negotiation: "Don't give a number first. Ask their budget; if pushed, give a researched range. Always negotiate.",
    dress_code: "Smart casual for most remote-first companies; one level smarter if unsure.",
    mindset: `You earned this interview. Be specific, stay confident, and remember you're also assessing whether ${job.company} fits your career.`,
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Job Copilot v3.1 → http://localhost:${PORT}`);
  console.log(`🤖 ${llmConfig.model} @ ${llmConfig.url}\n`);
});
