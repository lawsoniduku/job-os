// Discovery uses source publication age plus recent conclusive employer evidence.
// Saved jobs/application history are never deleted by these policies.
export const MAX_DISCOVERY_AGE_DAYS = 180;
export const LIVE_EVIDENCE_MAX_AGE_DAYS = 7;
export const SOURCE_MAX_AGE_DAYS = 28;
const DAY = 86400000;
const recent = (value, days, now) => {
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now && at >= now - days * DAY;
};
export function sourceDeadlineExpired(job, now = Date.now()) {
  const at = Date.parse(job.elig_signals?.source?.application_deadline);
  return Number.isFinite(at) && at <= now;
}
export function hasRecentOpenEvidence(job, now = Date.now()) {
  const persisted = job.elig_signals?.verification;
  const live = job.verification;
  // A confirmed closure always beats a positive source record.
  if (live?.status === 'dead' || persisted?.status === 'dead' || persisted?.last_known?.status === 'dead') return false;
  const evidence = [live, persisted, persisted?.last_known];
  return evidence.some(v => v?.status === 'ok' && !(Date.parse(job.elig_signals?.source?.changed_at) > Date.parse(v.evidence_checked_at || v.checked_at)) && recent(v.evidence_checked_at || v.checked_at, LIVE_EVIDENCE_MAX_AGE_DAYS, now));
}
function publicationBounds(job, now) {
  if (!job.posted_at) return {unknown:true};
  const at = Date.parse(job.posted_at);
  return {at, valid:Number.isFinite(at) && at <= now + DAY};
}
export function publicationIsDiscoverable(job, now = Date.now()) {
  if (sourceDeadlineExpired(job, now)) return false;
  const fetchedAt=job.elig_signals?.source?.fetched_at;
  if (fetchedAt && !recent(fetchedAt,SOURCE_MAX_AGE_DAYS,now) && !hasRecentOpenEvidence(job,now)) return false;
  const p = publicationBounds(job, now);
  if (p.unknown) return true;
  if (!p.valid) return false;
  if (p.at >= now - MAX_DISCOVERY_AGE_DAYS * DAY) return true;
  // Restore older current-year roles only when the employer was recently checked.
  const currentYear = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  return p.at >= currentYear && hasRecentOpenEvidence(job, now);
}
export function publicationMayBeImported(job, now = Date.now()) {
  const fetchedAt=job.elig_signals?.source?.fetched_at;
  if (fetchedAt && !recent(fetchedAt,SOURCE_MAX_AGE_DAYS,now)) return false;
  if (publicationIsDiscoverable(job, now)) return true;
  if (sourceDeadlineExpired(job, now)) return false;
  const p = publicationBounds(job, now);
  const currentYear = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  // Bounded JobHive admission permits recent upstream observations to be rechecked;
  // this is not proof of liveness and does not grant discovery by itself.
  return p.valid && p.at >= currentYear && recent(job.elig_signals?.source?.fetched_at, SOURCE_MAX_AGE_DAYS, now);
}
export function recentEvidenceFilter(now = Date.now()) {
  const since = new Date(now - LIVE_EVIDENCE_MAX_AGE_DAYS * DAY).toISOString();
  const until = new Date(now).toISOString();
  const check = path => `and(${path}->>status.eq.ok,${path}->>checked_at.gte.${since},${path}->>checked_at.lte.${until})`;
  return [check('elig_signals->verification'), check('elig_signals->verification->last_known')].join(',');
}
export function sourceVisibilityFilter(now = Date.now()) {
  return `last_seen_at.is.null,last_seen_at.gte.${new Date(now - SOURCE_MAX_AGE_DAYS * DAY).toISOString()},${recentEvidenceFilter(now)}`;
}
export function publicationFilter(now = Date.now()) {
  const recentDate = new Date(now - MAX_DISCOVERY_AGE_DAYS * DAY).toISOString();
  const tomorrow = new Date(now + DAY).toISOString();
  const currentYear = new Date(Date.UTC(new Date(now).getUTCFullYear(), 0, 1)).toISOString();
  return `posted_at.is.null,and(posted_at.gte.${recentDate},posted_at.lte.${tomorrow}),and(posted_at.gte.${currentYear},posted_at.lte.${tomorrow},or(${recentEvidenceFilter(now)}))`;
}
export function parseRecencyDays(text = '') {
  const r = String(text).toLowerCase();
  if (/\b(today|24 hours)\b/.test(r)) return 1;
  if (/\b(this week|last 7|past week)\b/.test(r)) return 7;
  if (/\b(last 3 days|past 3)\b/.test(r)) return 3;
  if (/\b(last 14|two weeks|past two)\b/.test(r)) return 14;
  if (/\b(this month|last 30|past month)\b/.test(r)) return 30;
  return null;
}
