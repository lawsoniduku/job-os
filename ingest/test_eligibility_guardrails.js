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
  ['German customer market does not hide an unspecified remote job', 'nigeria', { description: 'Build reports for our customers in Germany.' }, 'possible'],
  ['Germany headquarters does not contradict worldwide location', 'nigeria', { location: 'Worldwide', description: 'Our headquarters are based in Germany. Build reports for our customers.' }, 'certain'],
  ['Germany headquarters does not contradict worldwide hiring', 'nigeria', { description: 'Our headquarters are based in Germany. Work from anywhere.' }, 'certain'],
  ['Germany-based company is not German applicant residency', 'nigeria', { description: 'We are a Germany-based software company serving customers internationally.' }, 'possible'],
  ['Company office metadata is not an applicant requirement', 'nigeria', { location: 'Worldwide', description: 'Our office is in Germany and our customer market is the UK.' }, 'certain'],
  ['Company location metadata is not a job location', 'nigeria', { location: 'Worldwide', description: 'Our headquarters location: Germany. Work from anywhere.' }, 'certain'],
  ['An incidental only cannot harden a hiring invitation', 'nigeria', { location: 'Worldwide', description: 'Open to candidates in Germany and support our customers in Nigeria only.' }, 'possible'],
  ['Worldwide business marketing does not prove worldwide hiring', 'nigeria', { description: 'We serve customers worldwide from our headquarters in Germany.' }, 'possible'],
  ['Required country within phrasing remains excluded', 'nigeria', { location: 'Worldwide', description: 'Candidates must be based within Germany.' }, 'excluded'],
  ['Role geography remains excluded for a foreign applicant', 'nigeria', { location: 'Worldwide', description: 'This role is based in Germany.' }, 'excluded'],
  ['Applicant future geography remains excluded', 'nigeria', { location: 'Worldwide', description: 'You will be based in Germany.' }, 'excluded'],
  ['Applicant country statement remains excluded', 'nigeria', { location: 'Worldwide', description: 'Candidates are based in Germany.' }, 'excluded'],
  ['Applicant authorization remains excluded', 'nigeria', { location: 'Worldwide', description: 'You must be authorised to work in Germany.' }, 'excluded'],
  ['Resident of requirement remains excluded', 'nigeria', { location: 'Worldwide', description: 'You must be a resident of Mexico.' }, 'excluded'],
  ['An own-country requirement accepts the local applicant', 'germany', { description: 'Candidates must be based within Germany.' }, 'certain'],
  ['An own-country future location accepts the local applicant', 'nigeria', { description: 'You will be based in Nigeria.' }, 'certain'],
  ['US or Nigeria residency alternatives admit Nigeria', 'nigeria', { description: 'Applicants must reside in the US or Nigeria.' }, 'certain'],
  ['US or Nigeria based alternatives admit Nigeria', 'nigeria', { description: 'Candidates must be based in the US or Nigeria.' }, 'certain'],
  ['Legacy UK requirement accepts the UK applicant', 'uk', { description: 'Candidates must be based in the UK.' }, 'certain'],
  ['Customer geography cannot expand a required applicant list', 'germany', { description: 'Applicants must reside in Nigeria and support customers in Germany.' }, 'excluded'],
  ['Customer geography cannot narrow an own-country requirement', 'nigeria', { description: 'Applicants must reside in Nigeria and support customers in Germany.' }, 'certain'],
  ['A separate foreign-only restriction still wins', 'nigeria', { description: 'Applicants must reside in Nigeria. US only.' }, 'excluded'],
  ['A separate clearance requirement still wins', 'nigeria', { description: 'Applicants must reside in Nigeria. Active security clearance required.' }, 'excluded'],
  ['Country alternatives cannot bypass a later clearance requirement', 'nigeria', { description: 'Candidates must be based in the UK or Nigeria. Active security clearance required.' }, 'excluded'],
  ['Country alternatives cannot bypass a separate foreign-only statement', 'nigeria', { description: 'Candidates must be based in the UK or Nigeria. US only.' }, 'excluded'],
  ['A soft invitation cannot override a foreign residency requirement', 'nigeria', { description: 'Candidates must reside in the US. Open to Nigeria.' }, 'excluded'],
  ['Eligibility residents-only heading excludes foreign applicants', 'nigeria', { location: 'Worldwide', description: 'Eligibility: Residents of Germany only.' }, 'excluded'],
  ['Eligibility residents-only heading accepts local applicants', 'germany', { location: 'Worldwide', description: 'Eligibility: Residents of Germany only.' }, 'certain'],
  ['Residents-only requirement accepts its own legacy country', 'canada', { location: 'Worldwide', description: 'Eligibility: Residents of Canada only.' }, 'certain'],
  ['Required based-in heading excludes foreign applicants', 'nigeria', { location: 'Worldwide', description: 'Requirements: Based in Germany.' }, 'excluded'],
  ['Required based-in heading accepts local applicants', 'germany', { location: 'Worldwide', description: 'Requirements: Based in Germany.' }, 'certain'],
  ['Multiline requirements heading remains a requirement', 'nigeria', { location: 'Worldwide', description: 'Requirements\n• Based in Germany.' }, 'excluded'],
  ['Company based-in prose remains incidental', 'nigeria', { location: 'Worldwide', description: 'Our company is based in Germany.' }, 'certain'],
  ['German-based customers remain incidental', 'nigeria', { location: 'Worldwide', description: 'Support our Germany-based customers.' }, 'certain'],
  ['Must-be-in requirement excludes foreign applicants', 'nigeria', { location: 'Worldwide', description: 'Candidates must be in Germany.' }, 'excluded'],
  ['Must-be-in requirement accepts local applicants', 'germany', { location: 'Worldwide', description: 'Candidates must be in Germany.' }, 'certain'],
  ['Candidate work authorization excludes foreign applicants', 'nigeria', { location: 'Worldwide', description: 'Applicants need work authorization in Germany.' }, 'excluded'],
  ['Candidate work authorization accepts local applicants', 'germany', { location: 'Worldwide', description: 'Applicants need work authorization in Germany.' }, 'certain'],
  ['Authorization requirement heading remains enforced', 'nigeria', { location: 'Worldwide', description: 'Requirements: Work authorization in Germany.' }, 'excluded'],
  ['Authorized candidate statement remains enforced', 'nigeria', { location: 'Worldwide', description: 'You are legally authorized to work in Germany.' }, 'excluded'],
  ['Em dash remote location excludes foreign applicants', 'nigeria', { location: 'Worldwide', description: 'Location: Remote — United States.' }, 'excluded'],
  ['Em dash remote location accepts local applicants', 'us', { location: 'Worldwide', description: 'Location: Remote — United States.' }, 'certain'],
  ['Plural Locations metadata remains enforced', 'nigeria', { location: 'Worldwide', description: 'Locations: Germany or the UK.' }, 'excluded'],
  ['Plural Locations metadata accepts either listed country', 'uk', { location: 'Worldwide', description: 'Locations: Germany or the UK.' }, 'certain'],
  ['Remote country label remains enforced without Location prefix', 'nigeria', { location: 'Worldwide', description: 'Fully remote — Germany.' }, 'excluded'],
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

test('JobHive Recruitee Remote job label reaches normal eligibility checks', () => {
  for (const [description, eligible, confidence] of [
    ['Build useful software. Work from anywhere.', true, 'certain'],
    ['Build useful software.', true, 'possible'],
    ['Candidates must reside in the United States.', false, 'excluded'],
    ['Applicants must be based in Kenya.', false, 'excluded'],
    ['This is an on-site position.', false, 'excluded'],
  ]) {
    const raw={title:'Software Engineer',location:'Remote job',description};
    for(const candidate of [raw,{...raw,description:undefined,elig_signals:extractEligibilitySignals(raw)}]) {
      const result=checkEligibility(candidate,'nigeria');
      assert.equal(result.eligible,eligible,description);
      assert.equal(result.confidence,confidence,description);
    }
  }
  assert.equal(checkEligibility({title:'Software Engineer', location:'Remote job, United States', description:'Build software.'},'nigeria').eligible,false);
});
