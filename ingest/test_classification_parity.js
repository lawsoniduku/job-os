import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ROLE_TAXONOMY,detectCluster,classifyJob} from '../api/roleIntelligence.js';

// Fingerprint the established classifier before adding the literal prefilter
// and short-title cache. Cover every taxonomy phrase, boundary/case variants,
// inverted real-world titles and full-description fallback, without copying
// the classifier into the test or requiring a production database download.
const realTitles=[
  'Backend / API Engineer, Billing','Business Intelligence (BI) Analyst',
  'Manager, Customer Success','Head, Human Resources','Lead, Data Engineering',
  'Assistant, Executive','EA Sports Software Engineer','Research Assistant - Kaduna',
  'Field Agent - Contractor (Reading, PA)','Senior Manager, Deal Desk, EMEA',
  'Software Engineer (C++)','Senior C# Developer','Senior HRIS & People Analytics Analyst',
  'Technical Support Engineer','Compensation & Analytics Partner','Head of BI & Analytics',
];
// Keep the original optimization corpus stable. New combined HR aliases have
// explicit positive and adversarial regressions in test_discovery_recall.js.
const addedAliases=new Set(['people and talent operations','people & talent operations',
  'performance and talent development','performance & talent development']);
const phrases=[...new Set(ROLE_TAXONOMY.flatMap(role=>[...role.aliases,...role.keywords]))].filter(p=>!addedAliases.has(p));
const corpus=[...new Set([...phrases.flatMap(phrase=>[
  phrase,phrase.toUpperCase(),`(${phrase})`,`prefix${phrase}suffix`,
]),...realTitles])];

function fingerprint() {
  const hash=createHash('sha256');
  for(const query of corpus) {
    hash.update(JSON.stringify([query,detectCluster(query),classifyJob(query)]));
  }
  for(const description of [
    'Build distributed systems using Java and Python.',
    'Design performance management systems with OKR cycles and 360 feedback.',
    'The company operates a performance management system for all staff.',
    'Own workforce analytics and SQL reporting for our people team.',
  ]) hash.update(JSON.stringify(classifyJob('Team Member',description)));
  return hash.digest('hex');
}

test('classification optimization preserves all taxonomy and boundary verdicts',()=>{
  assert.equal(fingerprint(),'956c395a8ab61e194e86fee7014434dd62e8365afe7a014b3afe03960dcf575a');
});

test('cached classification results cannot be mutated by another caller',()=>{
  const expected=detectCluster('Senior Data Analyst');
  const first=detectCluster('Senior Data Analyst');
  first.cluster='Changed by a caller';
  first.all['Data Analytics']=-1;
  first.all['Invented cluster']=999;
  assert.deepEqual(detectCluster('Senior Data Analyst'),expected);
});

export {fingerprint,corpus};
