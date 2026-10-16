import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEligibility, extractEligibilitySignals, parseIntent, scoreJobLocally, SIGNALS_VERSION } from '../api/roleIntelligence.js';
import { verdictOf } from '../job-os-ui/src/lib/eligibility.js';

const job = (extra = {}) => ({ title: 'Data Analyst', company: 'Acme', location: 'Remote', description: 'Analyse data and build reports.', ...extra });

const scenarios = [
  ['Nigeria invitation is not worldwide', 'uk', { description: 'Open to Nigeria.' }, 'possible'],
  ['Africa invitation is not worldwide', 'canada', { description: 'Open to candidates in Africa.' }, 'possible'],
  ['Africa invitation accepts Kenya', 'kenya', { description: 'Open to candidates in Africa.' }, 'certain'],
  ['Nigeria invitation accepts Nigeria', 'nigeria', { description: 'Open to Nigeria.' }, 'certain'],
  ['Kenya residency outranks worldwide tag', 'nigeria', { location: 'Worldwide', description: 'Applicants must reside in Kenya.' }, 'excluded'],
  ['Kenya residency accepts Kenya', 'kenya', { description: 'Applicants must reside in Kenya.' }, 'certain'],
  ['Ghana residency outranks worldwide tag', 'nigeria', { location: 'Worldwide', description: 'Candidates must be located in Ghana.' }, 'excluded'],
  ['Country alternatives allow either location', 'nigeria', { description: 'Applicants must reside in Kenya or Nigeria.' }, 'certain'],
  ['Country alternatives still exclude outsiders', 'canada', { description: 'Applicants must reside in Kenya or Nigeria.' }, 'excluded'],
  ['South Africa is not the whole continent', 'nigeria', { location: 'Worldwide', description: 'Applicants must reside in South Africa.' }, 'excluded'],
  ['South Africa accepts its own residents', 'southafrica', { description: 'Applicants must reside in South Africa.' }, 'certain'],
  ['Nigeria title cannot bypass India requirement', 'nigeria', { title: 'Data Analyst - Nigeria', location: 'Worldwide', description: 'Applicants must be based in India.' }, 'excluded'],
  ['Nigeria title cannot bypass legacy UK restriction', 'nigeria', { title: 'Data Analyst - Nigeria', description: 'Location: UK.' }, 'excluded'],
  ['A generated Nigeria tag is not location evidence', 'nigeria', { location: 'Nairobi, Kenya', eligibility_region: 'Nigeria' }, 'excluded'],
  ['A headquarters is not candidate residency', 'nigeria', { location: 'Worldwide', description: 'Our headquarters are in Kenya. We hire globally.' }, 'certain'],
  ['Customer markets are not candidate residency', 'nigeria', { location: 'Worldwide', description: 'We serve customers across Africa.' }, 'certain'],
  ['Negated residency does not exclude', 'nigeria', { location: 'Worldwide', description: 'You are not required to reside in Kenya.' }, 'certain'],
  ['Worldwide remains available', 'nigeria', { description: 'Open to candidates worldwide.' }, 'certain'],
  ['EMEA invitation reaches Nigeria', 'nigeria', { description: 'Open to candidates in EMEA.' }, 'certain'],
  ['EMEA invitation is not global', 'canada', { description: 'Open to candidates in EMEA.' }, 'possible'],
  ['Worldwide tag with narrower invitation is uncertain', 'canada', { location: 'Worldwide', description: 'Open to candidates in Africa.' }, 'possible'],
  ['Missing description cannot prove worldwide eligibility', 'nigeria', { location: 'Worldwide', description: '' }, 'possible'],
  ['Missing description cannot prove title eligibility', 'nigeria', { title: 'Data Analyst - Nigeria', description: '' }, 'possible'],
];

for (const [name, country, extra, expected] of scenarios) {
  test(name, () => {
    const raw = job(extra);
    const direct = checkEligibility(raw, country);
    assert.equal(direct.confidence, expected, direct.reason);
    assert.equal(direct.eligible, expected !== 'excluded');
    // Production's lean path has no description. Both representations must agree.
    const cached = { ...raw, elig_signals: extractEligibilitySignals(raw) };
    delete cached.description;
    assert.deepEqual(checkEligibility(cached, country), direct);
    // Version bumps must not keep the old worldwide verdict alive.
    assert.deepEqual(checkEligibility({ ...raw, elig_signals: { v: SIGNALS_VERSION - 1, worldwideDesc: true } }, country), direct);
  });
}

test('stale signals without description stay unconfirmed', () => {
  const result = checkEligibility(job({ location: 'Worldwide', description: undefined, elig_signals: { v: SIGNALS_VERSION - 1, worldwideDesc: true } }), 'nigeria');
  assert.equal(result.confidence, 'possible');
});

test('guest remote searches do not claim personalized eligibility', () => {
  const result = scoreJobLocally(job({ remote: true, description: 'Applicants must reside in Kenya.' }), parseIntent('remote data analyst'));
  assert.equal(result.eligibility.confidence, 'possible');
});

for (const [name, input, label] of [
  ['absent verdict', {}, 'Unconfirmed'],
  ['unknown confidence', { eligibility: { eligible: true, confidence: 'unexpected' } }, 'Unconfirmed'],
  ['excluded verdict', { eligibility: { eligible: false, confidence: 'excluded' } }, 'Not eligible'],
  ['contradictory excluded verdict', { eligibility: { eligible: false, confidence: 'certain' } }, 'Not eligible'],
  ['inferred verdict', { eligibility: { eligible: true, confidence: 'likely' } }, 'Likely eligible'],
  ['certain verdict', { eligibility: { eligible: true, confidence: 'certain' } }, 'Eligible'],
]) {
  test(`badge: ${name}`, () => assert.equal(verdictOf(input).label, label));
}

test('HTML policy URL geography does not exclude a remote candidate', () => {
  const raw = {title:'Customer Success Manager', location:'Remote', description:
    '<p>Support customers and build product adoption.</p><a href=&quot;https://about.gitlab.com/handbook/people-policies/inc-usa/#equal-employment-opportunity-policy&quot;>Equal opportunity policy</a>'};
  const signals = extractEligibilitySignals(raw);
  assert.equal(signals.descMentionsForeign, false);
  assert.equal(checkEligibility(raw, 'nigeria').confidence, 'possible');
  assert.equal(checkEligibility({...raw, description:undefined, elig_signals:signals}, 'nigeria').confidence, 'possible');
  const restricted = {...raw, description:raw.description + '<p>Candidates must reside in the United States.</p>'};
  assert.equal(checkEligibility(restricted, 'nigeria').eligible, false);
});

test('an old HTML-derived exclusion is recomputed from visible text', () => {
  const raw = {title:'Data Analyst', location:'Remote', description:
    '<p>Analyze product data.</p><a href="https://example.com/usa/policy">Privacy policy</a>',
    elig_signals:{v:SIGNALS_VERSION-1, descMentionsForeign:true}};
  assert.equal(checkEligibility(raw, 'nigeria').eligible, true);
  assert.equal(checkEligibility(raw, 'nigeria').confidence, 'possible');
});
