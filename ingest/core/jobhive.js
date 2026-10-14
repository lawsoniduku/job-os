// JobHive conversion and import policy, kept pure for offline regression tests.
export const JOBHIVE_KEEP_REGIONS = new Set(["Africa", "Nigeria", "Global", "Remote", "EMEA"]);

export function parseRemoteFlag(value) {
  const flag = String(value ?? "").trim();
  if (/^(true|1|yes)$/i.test(flag)) return true;
  if (/^(false|0|no)$/i.test(flag)) return false;
  return undefined; // Missing or unfamiliar is not affirmative evidence of on-site work.
}

export function rowToRaw(record) {
  const g = (name) => (record[name] || "").trim();
  // REAL jobhive v2.0 schema (from manifest stats.schema_columns):
  //   url, title, company, ats_type, ats_id, location, is_remote, salary_min,
  //   salary_max, salary_currency, salary_period, salary_summary,
  //   employment_type, department, team, description, posted_at,
  //   requisition_id, apply_url, commitment, raw, country_iso
  return {
    title: g("title"),
    company: g("company"),
    location: g("location"),
    description: g("description"),
    // apply_url is the employer's real link; url is jobhive's canonical. Prefer apply_url.
    apply_url: g("apply_url") || g("url"),
    posted_at: g("posted_at"),
    created_at: g("posted_at"),
    employment_type: g("employment_type") || g("commitment") || null,
    department: g("department") || null,
    salary_min: g("salary_min") || null,
    salary_max: g("salary_max") || null,
    isRemote: parseRemoteFlag(g("is_remote")),
    _country_iso: g("country_iso").toUpperCase(),
  };
}

// African ISO-3166 alpha-2 codes retained by the existing regional import policy.
const AFRICAN_ISO = new Set([
  "NG","GH","KE","ZA","EG","MA","TZ","UG","RW","ET","SN","CI","CM","DZ","TN",
  "ZM","ZW","BW","NA","MZ","AO","MU","MW","LY","SD","SS","BJ","BF","ML","NE",
  "TD","SO","SL","LR","TG","GA","GN","GM","GW","CV","CG","CD","CF","DJ","ER",
  "SZ","LS","MG","KM","ST","SC","MR","BI",
]);

/**
 * Cheap pre-filter before the expensive normalize+tag step. Streaming 726K rows
 * means we want to reject the obvious bulk (in-office roles in the US/EU/Asia)
 * without running the full classifier on each one.
 *
 * Deliberately conservative: we only fast-reject when a job has a CONCRETE
 * non-African country AND is explicitly non-remote. Unknown flags or countries
 * still go through region classification — because
 * "Remote, country_iso=US" might be genuinely global, and only
 * detectEligibilityRegion can judge that from the text.
 */
export function fastReject(raw) {
  const iso = raw._country_iso;
  if (!iso) return false;                    // unknown country -> let the engine decide
  if (AFRICAN_ISO.has(iso)) return false;    // African -> always evaluate
  if (raw.isRemote !== false) return false;  // remote or unknown -> evaluate
  return true;                                // concrete foreign + on-site -> drop
}

