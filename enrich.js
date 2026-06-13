/**
 * ENRICHMENT PIPELINE v2
 * ======================
 * Classifies all unenriched jobs in Supabase using the Role Intelligence module.
 * Also attempts to detect:
 * - seniority level
 * - remote type (fully remote / hybrid / on-site)
 * - eligibility region (from description text)
 * - employment type (full-time / contract / part-time)
 *
 * Run: node enrich.js
 * Cron: Every 2 hours after ingestion
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { classifyJob } from "./api/roleIntelligence.js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ============================================================
// SENIORITY DETECTION
// ============================================================
function detectSeniority(title = "", description = "") {
  const text = `${title} ${description}`.toLowerCase();

  if (/(vp|vice president|cpo|cto|cfo|ceo|chief|head of|director)/i.test(title)) return "executive";
  if (/(principal|staff engineer|distinguished)/i.test(title)) return "staff";
  if (/(senior|sr\.|lead|manager|ii|iii|iv)/i.test(title)) return "senior";
  if (/(junior|jr\.|entry.level|graduate|intern|trainee|associate)/i.test(title)) return "junior";
  if (/(mid.level|mid |ii\b|2\+ year)/i.test(text)) return "mid";
  return "mid"; // default
}

// ============================================================
// REMOTE TYPE DETECTION
// ============================================================
function detectRemoteType(location = "", description = "") {
  const text = `${location} ${description}`.toLowerCase();

  if (
    text.includes("fully remote") ||
    text.includes("100% remote") ||
    text.includes("remote first") ||
    text.includes("remote-first") ||
    text.includes("work from anywhere") ||
    text.includes("work from home")
  ) return "fully_remote";

  if (
    text.includes("hybrid") ||
    text.includes("flex") ||
    text.includes("2 days") ||
    text.includes("3 days") ||
    text.includes("office days")
  ) return "hybrid";

  if (
    text.includes("on-site") ||
    text.includes("onsite") ||
    text.includes("in-office") ||
    text.includes("in office") ||
    text.includes("must be in")
  ) return "on_site";

  if (
    location.toLowerCase().includes("remote") ||
    text.includes("remote")
  ) return "fully_remote";

  return "unknown";
}

// ============================================================
// ELIGIBILITY REGION DETECTION
// ============================================================
function detectEligibilityRegion(description = "", location = "") {
  const text = `${description} ${location}`.toLowerCase();

  if (text.includes("nigeria") || text.includes("lagos") || text.includes("abuja")) {
    return "Nigeria";
  }
  if (text.includes("africa") || text.includes("sub-saharan") || text.includes("west africa") || text.includes("east africa")) {
    return "Africa";
  }
  if (text.includes("emea")) return "EMEA";
  if (text.includes("mena")) return "MENA";
  if (text.includes("apac") || text.includes("asia pacific")) return "APAC";
  if (text.includes("latam") || text.includes("latin america")) return "LATAM";

  if (
    text.includes("worldwide") ||
    text.includes("work from anywhere") ||
    text.includes("open to all") ||
    text.includes("global") ||
    (text.includes("remote") && !text.includes("us only") && !text.includes("uk only") && !text.includes("eu only"))
  ) return "Global";

  if (text.includes("us only") || text.includes("must be us") || text.includes("united states only")) return "US Only";
  if (text.includes("uk only") || text.includes("must be uk") || text.includes("united kingdom only")) return "UK Only";
  if (text.includes("eu only") || text.includes("europe only")) return "EU Only";
  if (text.includes("canada")) return "Canada";

  return "Unknown";
}

// ============================================================
// EMPLOYMENT TYPE DETECTION
// ============================================================
function detectEmploymentType(title = "", description = "") {
  const text = `${title} ${description}`.toLowerCase();

  if (text.includes("contract") || text.includes("freelance") || text.includes("contractor")) return "contract";
  if (text.includes("part-time") || text.includes("part time")) return "part_time";
  if (text.includes("internship") || text.includes("intern ")) return "internship";
  if (text.includes("temporary") || text.includes("temp role")) return "temporary";
  return "full_time"; // default
}

// ============================================================
// SALARY PARSING
// ============================================================
function parseSalary(description = "") {
  const text = description.toLowerCase();

  // Look for patterns like $50,000 - $80,000 or £40k-£60k
  const patterns = [
    /\$(\d{1,3})[,.]?(\d{3})?\s*[-–to]+\s*\$(\d{1,3})[,.]?(\d{3})?/i,
    /£(\d{1,3})[,.]?(\d{3})?\s*[-–to]+\s*£(\d{1,3})[,.]?(\d{3})?/i,
    /(\d{2,3})k\s*[-–to]+\s*(\d{2,3})k/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Parse min and max (simplified)
      const nums = match[0].match(/\d{2,3}\.?\d*/g);
      if (nums && nums.length >= 2) {
        const min = parseFloat(nums[0]) * (nums[0].length <= 3 ? 1000 : 1);
        const max = parseFloat(nums[1]) * (nums[1].length <= 3 ? 1000 : 1);
        return { salary_min: min, salary_max: max };
      }
    }
  }

  return { salary_min: null, salary_max: null };
}

// ============================================================
// MAIN ENRICHMENT
// ============================================================
async function enrichJobs() {
  console.log("🚀 ENRICHMENT v2 STARTED");
  console.log("================================");

  // Process jobs missing role_cluster OR enriched more than 7 days ago
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, title, description, location")
    .is("role_cluster", null)
    .limit(500);

  if (error) {
    console.error("❌ Fetch error:", error.message);
    return;
  }

  console.log(`📊 Jobs to enrich: ${jobs.length}`);

  let updated = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const { role_cluster, department } = classifyJob(job.title, job.description);
      const seniority = detectSeniority(job.title, job.description);
      const remote_type = detectRemoteType(job.location, job.description);
      const eligibility_region = detectEligibilityRegion(job.description, job.location);
      const employment_type = detectEmploymentType(job.title, job.description);
      const { salary_min, salary_max } = parseSalary(job.description);

      const { error: updateError } = await supabase
        .from("jobs")
        .update({
          role_cluster,
          department,
          seniority,
          remote_type,
          eligibility_region,
          employment_type,
          salary_min,
          salary_max
        })
        .eq("id", job.id);

      if (updateError) {
        console.error(`❌ ${job.title}: ${updateError.message}`);
        failed++;
      } else {
        updated++;
        if (updated % 50 === 0) {
          console.log(`✔ Progress: ${updated}/${jobs.length}...`);
        }
      }
    } catch (err) {
      console.error(`❌ Exception for ${job.title}: ${err.message}`);
      failed++;
    }
  }

  console.log("=================================");
  console.log(`✅ Enriched: ${updated}`);
  console.log(`❌ Failed: ${failed}`);
  console.log("=================================\n");
}

enrichJobs();
