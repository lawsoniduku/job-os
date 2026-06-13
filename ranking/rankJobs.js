import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// -------------------------------------
// SIMPLE SCORING ENGINE (v1)
// -------------------------------------
function computeScore(job) {
  let score = 0;

  const text = `${job.title} ${job.description}`.toLowerCase();

  // -----------------------------
  // ROLE BOOSTS
  // -----------------------------
  const roleBoosts = {
    data: 25,
    "data analyst": 30,
    "data scientist": 35,
    analytics: 25,

    hr: 20,
    "people ops": 25,
    "people operations": 25,
    "people analytics": 30,

    customer: 15,
    "customer support": 20,

    "virtual assistant": 18,
    admin: 10,

    marketing: 20,
    "social media": 22,

    developer: 30,
    engineer: 35,
    software: 30
  };

  for (const [key, value] of Object.entries(roleBoosts)) {
    if (text.includes(key)) score += value;
  }

  // -----------------------------
  // REMOTE BOOST
  // -----------------------------
  if (job.remote) score += 20;

  // -----------------------------
  // FRESHNESS BOOST
  // -----------------------------
  if (job.created_at) {
    const days =
      (Date.now() - new Date(job.created_at)) /
      (1000 * 60 * 60 * 24);

    if (days < 3) score += 20;
    else if (days < 7) score += 10;
  }

  // -----------------------------
  // TITLE QUALITY BOOST
  // -----------------------------
  if (job.title?.length < 60) score += 5;

  return score;
}

// -------------------------------------
// MAIN
// -------------------------------------
async function runRanking() {
  console.log("🚀 RANKING ENGINE STARTED");

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*");

  if (error) {
    console.log("❌ Fetch error:", error.message);
    return;
  }

  console.log(`📊 Jobs loaded: ${jobs.length}`);

  let updated = 0;

  for (const job of jobs) {
    const score = computeScore(job);

    const { error: updateError } = await supabase
      .from("jobs")
      .update({ score })
      .eq("apply_url", job.apply_url);

    if (updateError) {
      console.log(`❌ Failed scoring ${job.title}`);
    } else {
      updated++;
    }
  }

  console.log(`✅ Ranked jobs: ${updated}`);
}

runRanking();