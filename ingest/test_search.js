import test from "node:test";
import assert from "node:assert/strict";
import { parseIntent, scoreJobLocally, extractEligibilitySignals, SIGNALS_VERSION, getAliasesForCluster } from "../api/roleIntelligence.js";
import { titlePattern, applyRoleQuery, fetchCandidates, rankCandidates, matchesFilters, compareSearchResults } from "../api/searchCandidates.js";

const intent = parseIntent("virtual assistant jobs open to nigeria");
const job = (title, extra = {}) => ({ id: title, title, company: "Example", location: "Lagos, Nigeria", description: "Administrative support for our team in Nigeria.", posted_at: new Date().toISOString(), ...extra });
const unrelated = [
  "Head, Commercial Finance and Procurement", "Head of Air Freight", "Research Assistant - Kaduna",
  "Research Assistant - Oyo", "Research Assistant - Sokoto", "Assistant Valuation Manager, Transaction Services",
  "Head of Projects & Infrastructure", "Greaser", "Quality Platform Lead",
  "Apigee Engineer for Global Consumer Food Company", "Senior Manager, Customer Success Management - EMEA/APJ",
  "Senior Manager, Deal Desk, EMEA", "Demo Architect, EMEA", "Dealer Account Manager", "Lead Actuary",
  "Principal Project Manager", "Technical Preparation Engineer", "Datacentre Deployment Lead",
  "Security Research Engineer", "Deployment Lead - ERP Solutions", "FR - Tech Lead Coremedia",
  "Growth and Demand Gen Lead", "Instrumentation & Controls Engineering Senior Consultant - Nuclear",
  "Partner Manager, Automattic for Agencies", "Senior Strategist - Healthcare Advertising",
  "Field Agent - Contractor (Reading, PA)", "Field Agent - Contractor(Lancaster/York PA)",
  "Field Agent - Contractor (Scranton, PA)",
  "CMO East (CT, DE, DC, FL, GA, ME, MD, MA, NH, NJ, NY, NC, PA, RI, SC, VT, VA, WV)",
  "CSO East (CT, DE, DC, FL, GA, ME, MD, MA, NH, NJ, NY, NC, PA, RI, SC, VT, VA, WV)",
  "EA Sports Software Engineer",
];
for (const title of unrelated) test(`VA excludes ${title} even with a stale VA label`, () => {
  const row = job(title, { role_cluster: "Virtual Assistant", salary_min: 100000 });
  for (const candidate of [row, { ...row, description: undefined, elig_signals: extractEligibilitySignals(row) }]) {
    assert.equal(scoreJobLocally(candidate, intent).offTarget, true);
  }
});
for (const title of ["Virtual Assistant", "Personal Assistant to the Managing Director", "Administrative Assistant IV", "Executive Assistant", "Assistant, Executive", "VA", "EA", "PA"]) {
  test(`VA keeps ${title}`, () => assert.equal(scoreJobLocally(job(title), intent).offTarget, false));
}

test("short aliases match words, not valuation/head/preparation substrings", () => {
  const pattern = new RegExp(titlePattern(["va", "ea", "pa", "virtual assistant"]).replaceAll("\\m", "(?:^|[^a-z0-9])").replaceAll("\\M", "(?=$|[^a-z0-9])").replaceAll("[:alnum:]", "a-zA-Z0-9"), "i");
  for (const title of ["Head of Air Freight", "Assistant Valuation Manager", "Technical Preparation Engineer"]) assert.equal(pattern.test(title), false);
  for (const title of ["VA", "EA / Office Support", "Senior Virtual Assistant"]) assert.equal(pattern.test(title), true);
});

test("query values cannot alter PostgREST OR grammar", () => {
  let filter;
  applyRoleQuery({ or: (v) => { filter = v; } }, { cluster: 'untrusted"),id.gt.0' });
  assert.match(filter, /^role_cluster\.eq\."untrusted\\"\),id.gt.0"/);
});

test("unknown roles require all requested title words", () => {
  const query = parseIntent("ornithologist research jobs nigeria");
  assert.equal(scoreJobLocally(job("Research Assistant"), query).offTarget, true);
  assert.equal(scoreJobLocally(job("Research Ornithologist"), query).offTarget, false);
});

test("rank removes duplicate posts without merging different locations", () => {
  const result = rankCandidates([
    job("Virtual Assistant", { id: "1", apply_url: "https://example.com/job/1" }),
    job("Virtual Assistant", { id: "2", apply_url: "https://mirror.com/job/1" }),
    job("Virtual Assistant", { id: "3", location: "Abuja, Nigeria", apply_url: "https://example.com/job/3" }),
    job("Greaser", { id: "4" }),
  ], intent);
  assert.equal(result.results.length, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(result.excluded, 1);
  assert.equal(result.evaluated, 4);
});

test("senior-only is a filter, not a ranking bonus", () => {
  assert.equal(matchesFilters(job("Executive Assistant"), { seniorityFilter: "senior" }), false);
  assert.equal(matchesFilters(job("Junior Executive Assistant", { seniority: "senior" }), { seniorityFilter: "senior" }), false);
  assert.equal(matchesFilters(job("Senior Executive Assistant"), { seniorityFilter: "senior" }), true);
});

test("combined refinement preserves salary, date, seniority and ATS constraints", () => {
  const f = { seniorityFilter: "senior", salFloor: 60000, maxAgeDays: 7, sourceFilter: "lever" };
  const row = job("Senior Executive Assistant", { salary_max: 80000, source: "jobhive", ats_source: "lever" });
  assert.equal(matchesFilters(row, f), true);
  assert.equal(matchesFilters({ ...row, salary_max: 50000 }, f), false);
  assert.equal(matchesFilters({ ...row, posted_at: null }, f), false);
  assert.equal(matchesFilters({ ...row, ats_source: "greenhouse" }, f), false);
});

// A PostgREST-shaped fake verifies page boundaries AND visibility constraints.
function fakeDatabase(rows) {
  const requests = [];
  return { requests, from: () => {
    const request = { after: null, limit: Infinity, ors: [], ids: null };
    const q = {
      select: (v) => { request.columns = v; return q; },
      or: (v) => { request.ors.push(v); return q; },
      filter: () => q,
      gt: (_, v) => { request.after = v; return q; },
      gte: (_, v) => { request.lower = v; return q; },
      lt: (_, v) => { request.upper = v; return q; },
      order: () => q,
      limit: (v) => { request.limit = v; return q; },
      in: (_, ids) => { request.ids = ids; return q; },
      then: (resolve) => {
        requests.push(request);
        const result = rows.filter((r) => (!request.after || r.id > request.after) && (!request.lower || r.id >= request.lower) && (!request.upper || r.id < request.upper) && (!request.ids || request.ids.includes(r.id)));
        resolve({ data: result.slice(0, request.limit), error: null });
      },
    };
    return q;
  } };
}

test("retrieval exhausts more than 600 candidates and applies visibility to every page", async () => {
  const rows = Array.from({ length: 1205 }, (_, i) => job("Virtual Assistant", { id: String(i).padStart(4, "0"), eligibility_region: i % 2 ? "US" : null, elig_signals: { v: SIGNALS_VERSION } }));
  const db = fakeDatabase(rows);
  const got = await fetchCandidates({ db, intent, columns: "id,title", lean: true, hasLiveness: true, suppressed: new Set(["0000"]) });
  assert.equal(got.length, 1204);
  assert.equal(got.at(-1).id, "1204");
  assert.ok(db.requests.length >= 16);
  for (const request of db.requests) {
    assert.ok(request.ors.some((s) => s.includes("last_seen_at.gte.")));
    assert.ok(request.ors.includes("link_status.is.null,link_status.neq.dead"));
    assert.ok(request.ors.some((s) => /title\.|role_cluster\./.test(s)));
  }
});

test("lean retrieval hydrates descriptions for stale and missing signals", async () => {
  const rows = [job("Virtual Assistant", { id: "1", elig_signals: null }), job("Executive Assistant", { id: "2", elig_signals: { v: 1 } })];
  const db = fakeDatabase(rows);
  const got = await fetchCandidates({ db, intent, columns: "id,title", lean: true, hasLiveness: false });
  assert.equal(db.requests.length, 17);
  assert.equal(db.requests.at(-1).columns, "id,description");
  assert.deepEqual(db.requests.at(-1).ids, ["1", "2"]);
  assert.ok(got.every((j) => j.description));
});

test("retrieval failures are surfaced instead of reporting a partial total", async () => {
  const db = { from: () => {
    const q = { select: () => q, or: () => q, gte: () => q, lt: () => q, order: () => q, limit: () => Promise.resolve({ error: { message: "database unavailable" } }) };
    return q;
  } };
  await assert.rejects(fetchCandidates({ db, intent, columns: "id" }), /database unavailable/);
});


test("recent matches precede older higher-scoring matches from the reported search", () => {
  const rows = [
    job("Secretary & Admin Assistant", { id: "old", company: "Older", posted_at: "2026-09-17T16:13:26Z" }),
    job("Executive Assistant / Corporate Administrator", { id: "new", company: "Newer", location: "EMEA", posted_at: "2026-10-04T05:30:42Z" }),
  ];
  const ranked = rankCandidates(rows, intent);
  assert.ok(ranked.results.find((j) => j.id === "old").score > ranked.results.find((j) => j.id === "new").score);
  assert.deepEqual(ranked.results.map((j) => j.id), ["new", "old"]);
});

test("unknown and invalid posting dates stay last despite recent import dates", () => {
  const rows = [
    { id: "unknown", posted_at: null, created_at: "2026-10-15", score: 100 },
    { id: "invalid", posted_at: "invalid", created_at: "2026-10-15", score: 99 },
    { id: "known", posted_at: "2026-09-01", score: 30 },
  ];
  assert.deepEqual(rows.sort(compareSearchResults).map((j) => j.id), ["known", "unknown", "invalid"]);
});

test("same-date matches use score then stable ID for pagination", () => {
  const rows = [
    { id: "b", posted_at: "2026-10-14", score: 75 },
    { id: "c", posted_at: "2026-10-14", score: 90 },
    { id: "a", posted_at: "2026-10-14", score: 75 },
  ];
  assert.deepEqual(rows.sort(compareSearchResults).map((j) => j.id), ["c", "a", "b"]);
});

test("score-only model changes cannot restore an older-first ordering", () => {
  const rows = [
    { id: "old", posted_at: "2026-09-01", score: 100 },
    { id: "new", posted_at: "2026-10-14", score: 40 },
  ];
  assert.equal(rows.sort(compareSearchResults)[0].id, "new");
});

test("refinement filters preserve newest-first ordering", () => {
  const rows = [
    job("Senior Executive Assistant", { id: "old", company: "Old", posted_at: "2026-10-10", salary_max: 90000 }),
    job("Senior Executive Assistant", { id: "new", company: "New", posted_at: "2026-10-14", salary_max: 70000 }),
    job("Senior Executive Assistant", { id: "low", company: "Low", posted_at: "2026-10-15", salary_max: 10000 }),
  ];
  assert.deepEqual(rankCandidates(rows, intent, { seniorityFilter: "senior", salFloor: 60000 }).results.map((j) => j.id), ["new", "old"]);
});

test("a recent import without a publication date earns no freshness bonus", () => {
  const row = job("Virtual Assistant", { posted_at: null, created_at: new Date().toISOString() });
  assert.equal(scoreJobLocally(row, intent).breakdown.bonus, 0);
});

test("deduplication keeps the newest matching copy", () => {
  const rows = [
    job("Virtual Assistant", { id: "old", posted_at: "2026-09-01", salary_max: 100000 }),
    job("Virtual Assistant", { id: "new", posted_at: "2026-10-14" }),
  ];
  const result = rankCandidates(rows, intent);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, "new");
});
