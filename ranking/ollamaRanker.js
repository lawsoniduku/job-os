import axios from "axios";

/**
 * Call local Ollama model
 */
async function callOllama(prompt) {
  try {
    const res = await axios.post("http://localhost:11434/api/generate", {
      model: "qwen2:7b",
      prompt,
      stream: false
    });

    return res.data.response;
  } catch (err) {
    console.log("❌ Ollama error:", err.message);
    return null;
  }
}

/**
 * Extract structured JSON safely
 */
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * MAIN RANKING FUNCTION
 */
export async function rankJobsWithOllama(query, jobs) {
  console.log("🧠 Ollama ranking started...");

  const limitedJobs = jobs.slice(0, 30); // control cost/latency

  const results = [];

  for (const job of limitedJobs) {
    const prompt = `
You are a job matching engine.

User query:
${query}

Job:
Title: ${job.title}
Company: ${job.company}
Description: ${job.description?.slice(0, 1000)}

Return ONLY valid JSON:
{
  "score": number (0-100),
  "reason": "short reason"
}
`;

    const response = await callOllama(prompt);

    const parsed = safeParse(response);

    results.push({
      ...job,
      ai_score: parsed?.score ?? 0,
      ai_reason: parsed?.reason ?? "no reasoning"
    });
  }

  return results.sort((a, b) => b.ai_score - a.ai_score);
}