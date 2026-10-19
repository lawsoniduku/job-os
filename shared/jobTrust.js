// Pure display and ordering policy. Eligibility and availability are separate axes.
const DAY = 86400000;
export const AVAILABILITY_EVIDENCE_DAYS = 7;
export const AVAILABILITY_PROOF_VERSION = 4;
const VERIFIED_PROVIDERS = new Set(['employer', 'jobboard']);
const timestamp = value => Date.parse(value);
const text = value => typeof value === 'string' ? value.trim() : '';

export function eligibilityConfidence(job) {
  const e = job?.eligibility;
  if (e?.eligible === false || e?.confidence === 'excluded')
    return { key: 'conditional', level: 'excluded', label: 'Not eligible', positive: false,
      reason: text(e?.reason) || 'The posting has a requirement that excludes your location.' };
  const level = e?.eligible === true && ['certain', 'likely'].includes(e.confidence) ? e.confidence : 'possible';
  const rawReason = text(e?.reason);
  const reason = level === 'possible' && rawReason === 'Remote — region unconfirmed'
    ? 'The posting does not say which countries it can hire from.'
    : rawReason || "The posting doesn't say whether applicants in your country can be hired.";
  return { key: level === 'certain' ? 'eligible' : 'conditional', level,
    label: { certain: 'High', likely: 'Good', possible: 'Unconfirmed' }[level],
    positive: level !== 'possible', reason };
}

function postingUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
    u.hash = ''; // Fragments are not part of the requested posting.
    return u.href;
  } catch { return null; }
}

export function availabilityOf(job, now = Date.now()) {
  const stored = job?.elig_signals?.verification;
  const observation = job?.verification || stored;
  const known = observation?.last_known || stored?.last_known;
  if (observation?.status === 'dead' || (observation?.status !== 'ok' && known?.status === 'dead'))
    return { key: 'closed', label: 'Closed', positive: false,
      reason: text(observation?.status === 'dead' ? observation.reason : known.reason) || 'The posting was confirmed closed.' };
  const checkedAt = observation?.evidence_checked_at || observation?.checked_at;
  const at = timestamp(checkedAt);
  const changedAt = timestamp(job?.elig_signals?.source?.changed_at);
  const provider = text(observation?.provider).toLowerCase();
  const recent = Number.isFinite(at) && at <= now && at >= now - AVAILABILITY_EVIDENCE_DAYS * DAY;
  const current = !(Number.isFinite(changedAt) && changedAt > at);
  const auditable = observation?.status === 'ok' && VERIFIED_PROVIDERS.has(provider)
    && Number.isInteger(observation?.v) && observation.v >= AVAILABILITY_PROOF_VERSION
    && observation.identity === 'exact' && Number.isInteger(observation.http_status)
    && observation.http_status >= 200 && observation.http_status < 300;
  // Most candidates are unknown. Do not parse URLs in the sort comparator until
  // a conclusive proof is otherwise capable of earning the positive label.
  const posting = auditable ? postingUrl(job?.apply_url) : null;
  const exact = auditable && posting && postingUrl(observation.evidence_url) === posting
    && postingUrl(observation.checked_url);
  const verified = observation?.status === 'ok' && VERIFIED_PROVIDERS.has(provider) && exact && recent && current;
  if (verified) return { key: 'verified', label: 'Verified', positive: true, checkedAt,
    provider: observation.provider, evidenceUrl: observation.evidence_url, checkedUrl: observation.checked_url,
    reason: text(observation.reason) || 'A recent check confirmed this exact posting was open.' };
  const reason = !current ? 'The posting changed after its last availability check.'
    : observation?.status === 'ok' && !recent ? 'The availability check is missing a current date or is older than seven days.'
    : observation?.status === 'ok' && (!VERIFIED_PROVIDERS.has(provider) || !exact) ? 'The last check does not contain auditable proof for this exact posting.'
    : text(observation?.reason) || "The posting's current availability has not been confirmed.";
  return { key: 'unverified', label: 'Unverified', positive: false, reason, checkedAt,
    provider: observation?.provider, evidenceUrl: observation?.evidence_url, checkedUrl: observation?.checked_url };
}

// Show model evidence only when it actually appears in the engine's final reason.
// A stored inference must never be presented as the basis of an earlier deterministic verdict.
export function inferenceAudit(job) {
  const infer = job?.elig_signals?.infer;
  const evidence = text(infer?.evidence);
  const reason = text(job?.eligibility?.reason);
  if (!evidence || !reason.includes(`"${evidence}"`)) return null;
  const at = Number.isFinite(timestamp(infer.at)) ? infer.at : null;
  return { evidence, at, model: text(infer.model) || null };
}

export function jobTrust(job, now = Date.now()) {
  const eligibility = eligibilityConfidence(job);
  const availability = availabilityOf(job, now);
  // Both axes supported first, then one, then neither. Neither axis implies the other.
  const bucket = availability.key === 'closed' || eligibility.level === 'excluded' ? 3
    : eligibility.positive && availability.positive ? 0
    : eligibility.positive || availability.positive ? 1 : 2;
  return { eligibility, availability, bucket };
}

// Stable across backend ranking and the merge of independent Briefing searches.
export function compareTrustResults(a, b, now = Date.now()) {
  const postedTime = job => {
    const at = timestamp(job?.posted_at);
    return Number.isFinite(at) ? at : -Infinity;
  };
  return jobTrust(a, now).bucket - jobTrust(b, now).bucket
    || postedTime(b) - postedTime(a) || (b.score || 0) - (a.score || 0)
    || String(a.id).localeCompare(String(b.id));
}
