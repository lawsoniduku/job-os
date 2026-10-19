// One discovery policy for search, digest and scheduled enrichment.
// Retired records stay in application/saved-job history; they are not deleted.
export const ACTIVE_JOB_SOURCES = Object.freeze([
  'jobhive', 'greenhouse', 'lever', 'ashby', 'workable',
  'smartrecruiters', 'teamtailor', 'breezy', 'employer',
]);
const active = new Set(ACTIVE_JOB_SOURCES);
const retiredHosts = [
  'arbeitnow.com', 'jobicy.com', 'himalayas.app', 'weworkremotely.com',
  'jobspresso.co', 'remotive.com', 'myjobmag.com',
];
export function isActiveJobSource(job) {
  if (!active.has(job.source)) return false;
  try {
    const host = new URL(job.apply_url).hostname.toLowerCase();
    return !retiredHosts.some(board => host === board || host.endsWith('.' + board));
  } catch { return false; }
}
export const activeJobSources = query => query.in('source', ACTIVE_JOB_SOURCES);
