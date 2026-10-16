import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationIsDiscoverable, publicationFilter, parseRecencyDays} from '../api/jobFreshness.js';
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
