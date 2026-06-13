import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { getEmbedding } from "../search/embeddings.js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function run() {
  console.log("🚀 BACKFILL STARTED");

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, title, description")
    .is("embedding", null)
    .limit(200);

  if (error) {
    console.log(error.message);
    return;
  }

  console.log("jobs to embed:", jobs.length);

  for (const job of jobs) {
    const text = `${job.title} ${job.description}`;

    const embedding = await getEmbedding(text);

    if (!embedding) continue;

    const { error } = await supabase
      .from("jobs")
      .update({ embedding })
      .eq("id", job.id);

    if (error) {
      console.log("❌ update failed:", job.id);
    } else {
      console.log("✔ embedded:", job.title);
    }
  }

  console.log("DONE");
}

run();