// Discovery policy only: saved jobs/application history are not deleted.
export const MAX_DISCOVERY_AGE_DAYS = 180;
const DAY = 86400000;
export function publicationIsDiscoverable(job, now = Date.now()) {
  if (!job.posted_at) return true; // Unknown date is not evidence of expiry.
  const posted = Date.parse(job.posted_at);
  return Number.isFinite(posted) && posted >= now - MAX_DISCOVERY_AGE_DAYS * DAY && posted <= now + DAY;
}
export function publicationFilter(now = Date.now()) {
  return `posted_at.is.null,and(posted_at.gte.${new Date(now - MAX_DISCOVERY_AGE_DAYS * DAY).toISOString()},posted_at.lte.${new Date(now + DAY).toISOString()})`;
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
