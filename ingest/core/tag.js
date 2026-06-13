/**
 * ingest/core/tag.js
 * ==================
 * Pre-computes the fields search reads, AT INGEST, so the search-time eligibility
 * gate becomes a cheap indexed filter instead of re-scanning description text on
 * every query. Reuses the boundary-aware classifier from the role engine.
 */

import { classifyJob } from "../../api/roleIntelligence.js";

function boundary(text, phrase) {
  return new RegExp(`(?:^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i").test(text);
}
const any = (text, arr) => arr.some((p) => boundary(text, p));

export function detectSeniority(title = "", description = "") {
  const t = title.toLowerCase();
  if (any(t, ["vp", "vice president", "cpo", "cto", "cfo", "ceo", "chief", "head of", "director"])) return "executive";
  if (any(t, ["principal", "staff", "distinguished"])) return "staff";
  if (any(t, ["senior", "sr", "lead", "manager"])) return "senior";
  if (any(t, ["junior", "jr", "entry", "graduate", "intern", "trainee", "associate"])) return "junior";
  return "mid";
}

export function detectRemoteType(location = "", description = "") {
  const t = `${location} ${description}`.toLowerCase();
  if (any(t, ["fully remote", "100% remote", "remote first", "remote-first", "work from anywhere", "work from home"])) return "fully_remote";
  if (any(t, ["hybrid", "office days", "2 days", "3 days", "flex"])) return "hybrid";
  if (any(t, ["on-site", "onsite", "on site", "in-office", "in office", "must be in"])) return "on_site";
  if (any(t, ["remote"])) return "fully_remote";
  return "unknown";
}

// Coarse, boundary-aware region label persisted to eligibility_region.
export function detectEligibilityRegion(description = "", location = "", regionHint = null) {
  if (regionHint) return regionHint; // connector already knew (e.g. African seed)
  const loc = location.toLowerCase();
  const t = `${description} ${location}`.toLowerCase();

  // explicit Africa
  if (any(loc, ["nigeria", "lagos", "abuja"])) return "Nigeria";
  if (any(t, ["africa", "sub-saharan", "west africa", "east africa", "nairobi", "kenya", "ghana", "accra", "south africa", "kigali", "rwanda"])) return "Africa";

  // worldwide ONLY when it's in the LOCATION (not company marketing copy)
  if (any(loc, ["worldwide", "anywhere in the world", "anywhere", "globally distributed", "work from anywhere", "global remote", "remote - global"])) return "Global";

  if (any(loc, ["emea"])) return "EMEA";

  // concrete foreign location -> name the region, do NOT call it Global
  if (any(loc, ["united states", "usa", "u.s.", "us-remote", "new york", "san francisco", "austin", "chicago", "remote, us", "remote - us"])) return "US";
  if (any(loc, ["united kingdom", "london", "uk", "england", "manchester"])) return "UK";
  if (any(loc, ["china", "shanghai", "guangzhou", "beijing", "shenzhen", "hong kong"])) return "China";
  if (any(loc, ["korea", "seoul", "japan", "tokyo", "singapore", "india", "bangalore", "mumbai", "philippines", "vietnam", "indonesia"])) return "Asia";
  if (any(loc, ["canada", "toronto", "vancouver"])) return "Canada";
  if (any(loc, ["europe", "berlin", "paris", "amsterdam", "madrid", "dublin", "ireland", "north america", "latam", "latin america"])) return "Regional";

  // restriction phrases in body
  if (any(t, ["us only", "united states only", "authorized to work in the united states"])) return "US Only";
  if (any(t, ["uk only", "united kingdom only"])) return "UK Only";
  if (any(t, ["eu only", "europe only"])) return "EU Only";

  if (any(t, ["worldwide", "work from anywhere", "globally distributed", "any country"])) return "Global";
  if (any(t, ["remote"])) return "Remote";
  return "Unknown";
}

export function tagJob(job) {
  const { role_cluster, department } = classifyJob(job.title, job.description);
  return {
    ...job,
    role_cluster,
    department,
    seniority: detectSeniority(job.title, job.description),
    remote_type: detectRemoteType(job.location, job.description),
    eligibility_region: detectEligibilityRegion(job.description, job.location, job._region_hint),
  };
}
