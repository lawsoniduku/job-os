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
export function detectEligibilityRegion(description = "", location = "", regionHint = null, countryIso = null) {
  if (regionHint) return regionHint; // connector already knew (e.g. African seed)
  const loc = location.toLowerCase();
  const t = `${description} ${location}`.toLowerCase();

  // explicit Nigeria — major cities. Checked against LOCATION only (not full
  // description) to avoid false positives from generic company-marketing copy
  // ("we serve customers across Nigeria...") — same deliberate precision as
  // the original 2-city list, just extended to cover far more of the country.
  if (any(loc, [
    "nigeria", "lagos", "abuja", "ibadan", "kano", "port harcourt", "benin city",
    "kaduna", "enugu", "aba", "jos", "ilorin", "onitsha", "warri", "calabar",
    "uyo", "abeokuta", "akure", "owerri", "zaria", "bauchi", "sokoto",
    "maiduguri", "makurdi", "lokoja", "gombe", "katsina", "osogbo", "minna",
  ])) return "Nigeria";

  // A concrete foreign LOCATION field beats a free-text "Africa" mention in
  // the DESCRIPTION body — checked here, before any body-text African check,
  // so a structured signal always wins over marketing copy. Real example
  // this fixes: "Nordics Technical Sales Manager" / "Poland Technical Sales
  // Manager" etc. (location: a specific European city) were coming out as
  // eligibility_region=Africa — shown to Nigerian candidates as eligible —
  // because the company's boilerplate ("we distribute across EMEA and
  // Africa") happened to contain the word "africa" somewhere in the JD body,
  // and that body-text check used to run before this location check ever did.
  if (any(loc, ["united states", "usa", "u.s.", "us-remote", "new york", "san francisco", "austin", "chicago", "remote, us", "remote - us"])) return "US";
  if (any(loc, ["united kingdom", "london", "uk", "england", "manchester"])) return "UK";
  if (any(loc, ["china", "shanghai", "guangzhou", "beijing", "shenzhen", "hong kong"])) return "China";
  if (any(loc, ["korea", "seoul", "japan", "tokyo", "singapore", "india", "bangalore", "mumbai", "philippines", "vietnam", "indonesia"])) return "Asia";
  if (any(loc, ["canada", "toronto", "vancouver"])) return "Canada";
  if (any(loc, ["europe", "berlin", "paris", "amsterdam", "madrid", "dublin", "ireland", "north america", "latam", "latin america",
    "nordics", "benelux", "greece", "romania", "poland", "germany", "france", "spain", "italy", "portugal",
    "netherlands", "belgium", "austria", "switzerland", "sweden", "norway", "denmark", "finland"])) return "Regional";

  // A SPECIFIC non-Nigeria African country/city — checked BEFORE the generic
  // pan-African check below, deliberately. "africa" as a bare substring
  // appears INSIDE "South Africa", so checking the generic bucket first was
  // itself a bug: "General Manager of South Africa and Kenya" and Tanzania
  // postings ("HQ Country Tanzania") were still coming out as "Africa"
  // (pan-African, Nigeria included) even after specific-country names were
  // added below, because the broad "africa"/"sub-saharan" match fired first
  // and short-circuited before this block ever ran. Most-specific-first.
  //
  // A named single country means the role is restricted to THAT country, not
  // open pan-African — conflating it with the "Africa" bucket was the
  // original bug: a job explicitly "remote, Algeria only" was being shown to
  // Nigerian candidates as eligible, because both "Algeria" and genuine
  // pan-African postings landed in the same "Africa" tag, and the search
  // pre-filter treats "Africa" as blanket-eligible for any African-country
  // search. Route these to "Regional" instead — the same honest,
  // excluded-from-eligibility bucket already used for a named Europe/LatAm/
  // Oceania location (see the `any(loc, [...])` block below).
  // Deliberately EXCLUDES city names that collide with well-known non-African
  // places (e.g. no bare "Alexandria" — also a US city; no bare "Georgia" —
  // also a US state) to avoid false positives; country names are used instead
  // since they're far less ambiguous.
  if (any(t, [
    // countries (AU member states)
    "kenya", "ghana", "south africa", "rwanda", "algeria", "angola", "benin",
    "botswana", "burkina faso", "burundi", "cabo verde", "cape verde", "cameroon",
    "central african republic", "chad", "comoros", "democratic republic of the congo",
    "republic of the congo", "cote d'ivoire", "ivory coast", "djibouti", "egypt",
    "equatorial guinea", "eritrea", "eswatini", "swaziland", "ethiopia", "gabon",
    "gambia", "guinea-bissau", "guinea", "lesotho", "liberia", "libya", "madagascar",
    "malawi", "mali", "mauritania", "mauritius", "morocco", "mozambique", "namibia",
    "niger", "sao tome", "senegal", "seychelles", "sierra leone", "somalia",
    "south sudan", "sudan", "tanzania", "togo", "tunisia", "uganda", "zambia", "zimbabwe",
    // major cities unambiguous enough to be safe on their own
    "nairobi", "mombasa", "accra", "kumasi", "kigali", "johannesburg", "cape town",
    "pretoria", "durban", "cairo", "casablanca", "rabat", "tunis", "addis ababa",
    "dar es salaam", "kampala", "dakar", "lusaka", "harare", "yaounde", "douala",
    "abidjan", "luanda", "maputo", "gaborone", "windhoek", "algiers", "tripoli",
    "khartoum", "kinshasa", "lome", "conakry", "bamako", "niamey", "ndjamena",
    "antananarivo", "bujumbura", "freetown", "monrovia", "banjul",
  ])) return "Regional";

  // TRUE pan-African language only — these genuinely mean "open across the
  // continent" (so Nigeria is included). Checked against full text (t), and
  // only reached once we know no single specific country matched above.
  if (any(t, [
    "africa", "sub-saharan", "west africa", "east africa", "north africa", "southern africa",
  ])) return "Africa";

  // worldwide ONLY when it's in the LOCATION (not company marketing copy)
  if (any(loc, ["worldwide", "anywhere in the world", "anywhere", "globally distributed",
    "work from anywhere", "global remote", "remote - global", "remote global",
    "remote, global", "all countries", "any country", "location independent"])) return "Global";

  if (any(loc, ["emea"])) return "EMEA";

  // restriction phrases in body
  if (any(t, ["us only", "united states only", "authorized to work in the united states"])) return "US Only";
  if (any(t, ["uk only", "united kingdom only"])) return "UK Only";
  if (any(t, ["eu only", "europe only"])) return "EU Only";

  if (any(t, ["worldwide", "work from anywhere", "globally distributed", "any country"])) return "Global";

  // STRUCTURED FALLBACK — only reached when the text gave us nothing decisive.
  // Sources like jobhive provide a validated country_iso column; a job with
  // location:"Remote" + country_iso:"US" matched none of the location-keyword
  // checks above and would otherwise land in the ambiguous "Remote" bucket
  // (rendered as "region unconfirmed"), which is the dominant, least useful
  // outcome. Deliberately placed AFTER every Global/worldwide check so a
  // genuinely open role posted by a US company is still correctly Global —
  // we only name the country when nothing else identified the job.
  if (countryIso) {
    const iso = countryIso.toUpperCase();
    if (iso === "US") return "US";
    if (iso === "GB") return "UK";
    if (iso === "CA") return "Canada";
    if (["CN", "HK", "TW"].includes(iso)) return "China";
    if (["JP", "KR", "SG", "IN", "PH", "VN", "ID", "MY", "TH", "PK", "BD"].includes(iso)) return "Asia";
    // Everything else concrete and non-African (Europe, LatAm, Oceania, ME…)
    // -> "Regional": honestly named, and excluded by the eligibility filter.
    if (iso.length === 2) return "Regional";
  }

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
    eligibility_region: detectEligibilityRegion(job.description, job.location, job._region_hint, job.country_iso),
  };
}
