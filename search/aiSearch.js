import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import ollama from "ollama";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// --------------------------------------
// QUERY UNDERSTANDING
// --------------------------------------
export async function parseQuery(query) {
  try {
    const prompt = `
You are a job search parser.

Convert this query into JSON.

Query:
${query}

Return ONLY valid JSON.

{
  "role_cluster": string|null,
  "remote": boolean|null,
  "keywords": string[],
  "seniority": string|null,
  "department": string|null
}
`;

    const response = await ollama.chat({
      model: "qwen2:7b",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const text = response.message.content.trim();

    return JSON.parse(text);
  } catch (err) {
    console.log("Parser failed:", err.message);

    return {
      role_cluster: null,
      remote: null,
      keywords: query.split(" "),
      seniority: null,
      department: null
    };
  }
}

// --------------------------------------
// JOB SEARCH
// --------------------------------------
export async function searchJobs(query) {
  console.log("🔍 AI SEARCH:", query);

  const parsed = await parseQuery(query);

  console.log("🧠 PARSED:", parsed);

  let dbQuery = supabase
    .from("jobs")
    .select("*");

  if (parsed.remote === true) {
    dbQuery = dbQuery.eq("remote", true);
  }

  if (parsed.role_cluster) {
    dbQuery = dbQuery.ilike(
      "role_cluster",
      `%${parsed.role_cluster}%`
    );
  }

  if (parsed.department) {
    dbQuery = dbQuery.ilike(
      "department",
      `%${parsed.department}%`
    );
  }

  const { data, error } = await dbQuery.limit(500);

  if (error) {
    console.log(error.message);
    return [];
  }

  const scored = data.map(job => {
    let score = 0;

    const text = `
      ${job.title}
      ${job.description}
      ${job.role_cluster}
      ${job.department}
    `.toLowerCase();

    for (const keyword of parsed.keywords || []) {
      if (
        text.includes(keyword.toLowerCase())
      ) {
        score += 10;
      }
    }

    return {
      ...job,
      ai_score: score
    };
  });

  return scored.sort(
    (a, b) => b.ai_score - a.ai_score
  );
}