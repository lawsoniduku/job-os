/**
 * lib/llm.js — LLM client with provider switch (Groq / Ollama)
 * ==============================================================
 * Single source of truth for every model call in JobCopilot.
 *
 * PROVIDER SWITCH:
 *   LLM_PROVIDER=groq    -> production. Hosted inference via Groq's
 *                           OpenAI-compatible API. Fast (100s of tokens/sec),
 *                           cheap, and works from any cloud host (Render,
 *                           Vercel, etc.) with no local model required.
 *   LLM_PROVIDER=ollama  -> local dev. Talks to a local Ollama instance.
 *                           Free, but slow on CPU and only reachable from
 *                           your own machine.
 *
 *   Default is "ollama" so local development is unaffected unless you
 *   explicitly opt in to Groq via .env. Set LLM_PROVIDER=groq in production.
 *
 * Both providers expose the exact same two functions — generateText() and
 * generateJSON() — so nothing in server.js needs to know which provider is
 * active.
 *
 * Fixes carried over from the Ollama-only version:
 *   1. JSON mode is enforced natively by both providers.
 *   2. Balanced-brace extractor as a backup parser (handles stray prose).
 *   3. One automatic retry at temperature 0 before giving up.
 *   4. A single health gate, cached briefly.
 */

import axios from "axios";

// ── Provider selection ────────────────────────────────────────────────────
const PROVIDER = (process.env.LLM_PROVIDER || "ollama").toLowerCase();

// ── Ollama config (local dev) ───────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3:4b";

// ── Groq config (production) ────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// llama-3.3-70b-versatile: strong quality, supports JSON mode, generous free tier.
// For even faster/cheaper, llama-3.1-8b-instant also works well for these tasks.
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export const llmConfig = {
  provider: PROVIDER,
  url: PROVIDER === "groq" ? GROQ_URL : OLLAMA_URL,
  model: PROVIDER === "groq" ? GROQ_MODEL : OLLAMA_MODEL,
};

// Surfaces WHY the last structured call failed: "timeout" | "unparseable" | "no_api_key" | error msg | null.
export const llmState = { lastError: null };

// --- rough token estimate so we can size Ollama's num_ctx without a tokenizer ---
function estTokens(str = "") {
  return Math.ceil(str.length / 3.5);
}
function pickNumCtx(promptText, headroom = 1024) {
  const need = estTokens(promptText) + headroom;
  if (need <= 2048) return 2048;
  if (need <= 4096) return 4096;
  if (need <= 8192) return 8192;
  return 16384;
}

// --- health, cached for 5s ---
let _healthCache = { ok: false, at: 0 };
export async function isLLMHealthy(maxAgeMs = 5000) {
  const now = Date.now();
  if (now - _healthCache.at < maxAgeMs) return _healthCache.ok;

  if (PROVIDER === "groq") {
    // Health = "do we have a key configured". We don't ping Groq on every
    // health check (avoids burning rate limit); a missing key is the only
    // thing that would make every call fail anyway.
    _healthCache = { ok: !!GROQ_API_KEY, at: now };
    return _healthCache.ok;
  }

  try {
    const r = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 2000 });
    _healthCache = { ok: r.status === 200, at: now };
  } catch {
    _healthCache = { ok: false, at: now };
  }
  return _healthCache.ok;
}

/**
 * Robust JSON extraction. Tries:
 *   1. direct JSON.parse
 *   2. strip ``` fences then parse
 *   3. balanced-brace scan (finds the first complete {...} object)
 */
export function extractJSON(text) {
  if (!text || typeof text !== "string") return null;
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

  let direct = tryParse(text.trim());
  if (direct) return direct;

  const defenced = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  let fenced = tryParse(defenced);
  if (fenced) return fenced;

  const src = defenced;
  let depth = 0, start = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = src.slice(start, i + 1);
        const parsed = tryParse(candidate);
        if (parsed) return parsed;
        start = -1;
      }
    }
  }
  return null;
}

// ============================================================
// GROQ provider — OpenAI-compatible chat completions API
// ============================================================
async function groqGenerate(prompt, { timeoutMs, temperature, json }) {
  if (!GROQ_API_KEY) {
    llmState.lastError = "no_api_key";
    throw new Error("GROQ_API_KEY is not set");
  }
  const body = {
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: temperature ?? 0.2,
  };
  if (json) body.response_format = { type: "json_object" };

  const res = await axios.post(GROQ_URL, body, {
    timeout: timeoutMs || 30000,
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  return res.data?.choices?.[0]?.message?.content || "";
}

// ============================================================
// OLLAMA provider — local streaming generate
// ============================================================
// Streaming so a slow local model doesn't time out just because the full
// response takes a while. inactivityMs = max ms to wait for the NEXT token.
async function ollamaGenerate(prompt, { timeoutMs, numCtx, format, temperature, inactivityMs = 12000 }) {
  const body = {
    model: OLLAMA_MODEL,
    prompt,
    stream: true,
    options: { num_ctx: numCtx, temperature: temperature ?? 0.2 },
  };
  if (format === "json") body.format = "json";

  const deadline = Date.now() + (timeoutMs || 90000);
  let lastToken = Date.now();

  const res = await axios.post(`${OLLAMA_URL}/api/generate`, body, {
    timeout: timeoutMs,
    responseType: "stream",
  });

  return new Promise((resolve, reject) => {
    let text = "";
    let buf = "";

    const inactivityTimer = setInterval(() => {
      if (Date.now() - lastToken > inactivityMs || Date.now() > deadline) {
        clearInterval(inactivityTimer);
        res.data.destroy();
        resolve(text.trim() || null);
      }
    }, 500);

    res.data.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.response) { text += obj.response; lastToken = Date.now(); }
          if (obj.done) {
            clearInterval(inactivityTimer);
            res.data.destroy();
            resolve(text.trim() || null);
            return;
          }
        } catch { /* partial JSON line, skip */ }
      }
    });

    res.data.on("end", () => { clearInterval(inactivityTimer); resolve(text.trim() || null); });
    res.data.on("error", (e) => { clearInterval(inactivityTimer); reject(e); });
  });
}

// ============================================================
// PUBLIC API — same signatures regardless of provider
// ============================================================

/**
 * generateText — free-form generation (chat, CV sections, summaries).
 */
export async function generateText(prompt, opts = {}) {
  const { timeoutMs = 30000, temperature = 0.3 } = opts;
  try {
    if (PROVIDER === "groq") {
      return (await groqGenerate(prompt, { timeoutMs, temperature, json: false })) || null;
    }
    const numCtx = opts.numCtx || pickNumCtx(prompt);
    return await ollamaGenerate(prompt, { timeoutMs, numCtx, temperature });
  } catch (err) {
    const isTimeout = err.code === "ECONNABORTED" || /timeout/i.test(err.message || "");
    llmState.lastError = isTimeout ? "timeout" : err.message;
    console.error("[llm.generateText]", err.message);
    return null;
  }
}

/**
 * generateJSON — guaranteed-structured generation.
 * Returns a parsed object, or null after all retries fail.
 */
export async function generateJSON(prompt, opts = {}) {
  const { timeoutMs = 35000, retries = 1 } = opts;
  llmState.lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const temperature = attempt === 0 ? 0.2 : 0.0;
      let text;
      if (PROVIDER === "groq") {
        text = await groqGenerate(prompt, { timeoutMs, temperature, json: true });
      } else {
        const numCtx = opts.numCtx || pickNumCtx(prompt);
        text = await ollamaGenerate(prompt, { timeoutMs, numCtx, format: "json", temperature });
      }
      const parsed = extractJSON(text);
      if (parsed) { llmState.lastError = null; return parsed; }
      llmState.lastError = "unparseable";
      console.warn(`[llm.generateJSON] unparseable on attempt ${attempt + 1}`);
    } catch (err) {
      const isTimeout = err.code === "ECONNABORTED" || /timeout/i.test(err.message || "");
      llmState.lastError = isTimeout ? "timeout" : err.message;
      console.error(`[llm.generateJSON] attempt ${attempt + 1}:`, err.message);
      if (err.message === "GROQ_API_KEY is not set") break; // no point retrying
    }
  }
  return null;
}
