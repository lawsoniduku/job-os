import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationIsDiscoverable, publicationFilter, parseRecencyDays, publicationMayBeImported, sourceVisibilityFilter} from '../api/jobFreshness.js';
import {checkEligibility, extractEligibilitySignals} from '../api/roleIntelligence.js';
const now = Date.parse('2026-10-16T12:00:00Z');
test('publication age boundary is shared by ingestion and discovery', () => {
  assert.equal(publicationIsDiscoverable({posted_at: new Date(now - 180 * 864e5).toISOString()}, now), true);
  assert.equal(publicationIsDiscoverable({posted_at: new Date(now - 180 * 864e5 - 1).toISOString()}, now), false);
  assert.equal(publicationIsDiscoverable({posted_at: null}, now), true);
  assert.match(publicationFilter(now), /posted_at.is.null,and\(posted_at.gte./);
});
test('initial search and refinement share deterministic recency parsing', () => {
  assert.equal(parseRecencyDays('Data analyst jobs in Nigeria posted this week'), 7);
  assert.equal(parseRecencyDays('Posted today'), 1);
  assert.equal(parseRecencyDays('Posted in the last 14 days'), 14);
  assert.equal(parseRecencyDays('Remote data analyst'), null);
});
for (const [location, target, eligible] of [
  ['Anywhere in France', 'nigeria', false],
  ['Anywhere in France', 'france', true],
  ['Anywhere within South Africa', 'nigeria', false],
  ['Anywhere across Africa', 'nigeria', true],
  ['Anywhere in the world', 'nigeria', true],
  ['Worldwide', 'nigeria', true],
  ['Remote', 'nigeria', true],
]) test(`${location} eligibility for ${target}: ${eligible}`, () => {
  const job = {title:'Data Analyst', location, description:'Analyze data and build reports for our team.', eligibility_region:'Global'};
  assert.equal(checkEligibility(job, target).eligible, eligible);
  job.elig_signals = extractEligibilitySignals(job);
  delete job.description;
  assert.equal(checkEligibility(job, target).eligible, eligible);
});

test('older current-year jobs require recent open employer evidence; previous-year jobs stay hidden', () => {
  const open={status:'ok',checked_at:'2026-10-15T12:00:00Z'};
  assert.equal(publicationIsDiscoverable({posted_at:'2026-02-01',elig_signals:{verification:open}},now),true);
  assert.equal(publicationIsDiscoverable({posted_at:'2026-02-01'},now),false);
  assert.equal(publicationIsDiscoverable({posted_at:'2025-12-01',elig_signals:{verification:open}},now),false);
  assert.equal(publicationIsDiscoverable({posted_at:'2026-02-01',elig_signals:{verification:{...open,checked_at:'2026-10-01T00:00:00Z'}}},now),false);
  assert.equal(publicationIsDiscoverable({posted_at:'2026-02-01',elig_signals:{verification:{...open,status:'dead'}}},now),false);
  assert.equal(publicationIsDiscoverable({posted_at:'2026-02-01',elig_signals:{verification:open},verification:{status:'dead'}},now),false);
});

test('an upstream deadline overrides recent publication and open evidence', () => {
  const job={posted_at:'2026-10-15',elig_signals:{source:{application_deadline:'2026-10-16T11:59:59Z'},verification:{status:'ok',checked_at:'2026-10-16T11:00:00Z'}}};
  assert.equal(publicationIsDiscoverable(job,now),false);
  job.elig_signals.source.application_deadline='2026-10-17T00:00:00Z';
  assert.equal(publicationIsDiscoverable(job,now),true);
});


test('bounded admission can recheck older current-year observations without making them discoverable', () => {
  const job={posted_at:'2026-02-01',elig_signals:{source:{fetched_at:'2026-10-15T00:00:00Z'}}};
  assert.equal(publicationMayBeImported(job,now),true);
  assert.equal(publicationIsDiscoverable(job,now),false);
  assert.equal(publicationMayBeImported({...job,posted_at:'2025-12-01'},now),false);
  assert.equal(publicationMayBeImported({...job,elig_signals:{source:{fetched_at:'2026-09-01'}}},now),false);
  assert.match(publicationFilter(now),/posted_at.gte.2026-01-01/);
  assert.match(publicationFilter(now),/elig_signals->verification->>status.eq.ok/);
  assert.match(sourceVisibilityFilter(now),/last_seen_at.gte./);
  assert.match(sourceVisibilityFilter(now),/elig_signals->verification->>checked_at.gte./);
});
