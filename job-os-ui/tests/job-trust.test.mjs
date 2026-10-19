import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { availabilityOf, jobTrust, inferenceAudit, verdictOf } from '../src/lib/eligibility.js';
import { JobTrustDetails } from '../src/components/JobTrustDetails.js';
import { compareSearchResults, rankCandidates } from '../../api/searchCandidates.js';
import { parseIntent } from '../../api/roleIntelligence.js';
import { loadBriefingFeed } from '../src/lib/briefingFeed.mjs';

const now = Date.parse('2026-10-19T12:00:00Z');
const url = 'https://example.recruitee.com/o/virtual-assistant';
const proof = {v:4,status:'ok',provider:'employer',identity:'exact',evidence_url:url,
  checked_url:'https://example.recruitee.com/api/offers/virtual-assistant',http_status:200,checked_at:'2026-10-19T11:00:00Z'};
const row = (id, extra={}) => ({id,apply_url:url,posted_at:'2026-10-18T00:00:00Z',
  eligibility:{eligible:true,confidence:'certain',reason:'Location mentions Nigeria'},...extra});

test('eligibility confidence cannot be inferred from availability or an incomplete verdict', () => {
  assert.deepEqual(verdictOf(row('high')), {key:'eligible',label:'High'});
  assert.deepEqual(verdictOf(row('good',{eligibility:{eligible:true,confidence:'likely'}})), {key:'conditional',label:'Good'});
  assert.deepEqual(verdictOf(row('missing',{eligibility:null,verification:proof})), {key:'conditional',label:'Unconfirmed'});
  assert.deepEqual(verdictOf(row('false',{eligibility:{eligible:false,confidence:'certain'}})), {key:'conditional',label:'Not eligible'});
  assert.equal(verdictOf(row('contradictory',{eligibility:{confidence:'certain'}})).label,'Unconfirmed');
});

test('current exact employer or retained MyJobMag proof earns availability Verified independently', () => {
  for (const provider of ['employer','jobboard']) {
    const j=row(provider,{eligibility:{eligible:true,confidence:'possible'},verification:{...proof,provider}});
    assert.equal(availabilityOf(j,now).label,'Verified');
    assert.equal(verdictOf(j).label,'Unconfirmed');
  }
  assert.equal(availabilityOf(row('high'),now).label,'Unverified');
});

test('availability rejects unproven identity, stale checks, source changes and unsafe or mismatched URLs', () => {
  const adversaries = [
    {v:3}, {identity:undefined}, {provider:'structured posting'}, {evidence_url:undefined},
    {evidence_url:url+'-different'}, {evidence_url:url+'?different=1'},
    {evidence_url:'http://example.recruitee.com/o/virtual-assistant'},
    {checked_url:'https://user:secret@example.recruitee.com/api/offers/virtual-assistant'},
    {checked_url:'http://example.recruitee.com/api/offers/virtual-assistant'},
    {checked_url:undefined}, {http_status:undefined}, {http_status:403}, {http_status:404},
    {checked_at:'2026-10-12T11:59:59Z'}, {checked_at:'2026-10-19T12:00:01Z'}, {checked_at:'invalid'},
  ];
  for (const override of adversaries)
    assert.equal(availabilityOf(row('bad',{verification:{...proof,...override}}),now).key,'unverified',JSON.stringify(override));
  assert.equal(availabilityOf(row('changed',{verification:proof,elig_signals:{source:{changed_at:'2026-10-19T11:01:00Z'}}}),now).key,'unverified');
  assert.equal(availabilityOf(row('boundary',{verification:{...proof,checked_at:'2026-10-12T12:00:00Z'}}),now).key,'verified');
});

test('a timeout or pending check never borrows a last-known open availability label', () => {
  for (const status of ['unknown','pending'])
    assert.equal(availabilityOf(row(status,{verification:{status,checked_at:proof.checked_at,last_known:proof}}),now).key,'unverified');
  assert.equal(availabilityOf(row('closed',{verification:{status:'unknown',last_known:{status:'dead',reason:'Posting removed'}}}),now).key,'closed');
  assert.equal(availabilityOf(row('reopened',{verification:{...proof,last_known:{status:'dead'}}}),now).key,'verified');
});

test('every Unconfirmed card has a visible one-line reason and a separate availability state', () => {
  for (const eligibility of [undefined,{eligible:true,confidence:'possible'},{eligible:true,confidence:'possible',reason:'Remote — region unconfirmed'}]) {
    const j=row('uncertain',{eligibility});
    const html=renderToStaticMarkup(React.createElement(JobTrustDetails,{job:j,trust:jobTrust(j,now)}));
    assert.match(html,/Why unconfirmed:/);
    assert.match(html,/country can be hired|does not say which countries it can hire from/);
    assert.match(html,/Availability: Unverified/);
    assert.doesNotMatch(html,/Availability: Verified/);
  }
});

test('model verdicts quote evidence and audit metadata, without inventing missing legacy metadata', () => {
  const evidence='We hire across Africa';
  const j=row('model',{eligibility:{eligible:true,confidence:'likely',reason:`Open to your region — "${evidence}"`},
    elig_signals:{infer:{evidence,model:'openai/gpt-oss-120b',at:'2026-10-19T10:30:00Z'}}});
  const html=renderToStaticMarkup(React.createElement(JobTrustDetails,{job:j,trust:jobTrust(j,now)}));
  assert.match(html,/<blockquote[^>]*>.*We hire across Africa/);
  assert.match(html,/openai\/gpt-oss-120b/);
  assert.match(html,/dateTime="2026-10-19T10:30:00Z"/i);
  const legacy={...j,elig_signals:{infer:{evidence}}};
  const legacyHtml=renderToStaticMarkup(React.createElement(JobTrustDetails,{job:legacy,trust:jobTrust(legacy,now)}));
  assert.match(legacyHtml,/Model not recorded/);
  assert.match(legacyHtml,/Check time not recorded/);
  assert.equal(inferenceAudit({...j,eligibility:{eligible:true,confidence:'certain',reason:'Location mentions Nigeria'}}),null);
});

test('posting text and model metadata render as escaped text, never markup', () => {
  const evidence='<img src=x onerror=alert(1)>';
  const j=row('escape',{eligibility:{eligible:true,confidence:'likely',reason:`Open worldwide — "${evidence}"`},elig_signals:{infer:{evidence,model:'<script>alert(1)</script>'}}});
  const html=renderToStaticMarkup(React.createElement(JobTrustDetails,{job:j,trust:jobTrust(j,now)}));
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img|<script/);
});

test('trust leads recency and scores, while recency orders jobs within each trust bucket', () => {
  const rows=[
    row('neither',{score:100,posted_at:'2026-10-19T11:59:00Z',eligibility:{eligible:true,confidence:'possible'}}),
    row('both-old',{score:10,posted_at:'2026-10-01T00:00:00Z',verification:proof}),
    row('eligible-only',{score:95,posted_at:'2026-10-19T10:00:00Z'}),
    row('availability-only',{score:90,posted_at:'2026-10-18T10:00:00Z',eligibility:{eligible:true,confidence:'possible'},verification:proof}),
    row('both-new',{score:1,posted_at:'2026-10-18T00:00:00Z',verification:proof}),
  ];
  assert.deepEqual(rows.sort((a,b)=>compareSearchResults(a,b,now)).map(j=>j.id),['both-new','both-old','eligible-only','availability-only','neither']);
});

test('trust cannot rescue excluded, closed or previous-year postings from search gates', () => {
  const intent=parseIntent('virtual assistant jobs open to nigeria');
  const base={source:'jobhive',company:'Example',title:'Virtual Assistant',location:'Nigeria',description:'Virtual assistant support for the team in Nigeria.',posted_at:'2026-10-18T00:00:00Z'};
  const result=rankCandidates([
    {...base,id:'old',posted_at:'2025-12-01T00:00:00Z',apply_url:url,verification:proof},
    {...base,id:'closed',apply_url:url,verification:{status:'dead'}},
    {...base,id:'restricted',location:'United States',apply_url:url+'-restricted'},
  ],intent,{},now);
  assert.equal(result.results.length,0);
});

test('Briefing preserves trust priority when combining independent searches', async () => {
  const jobs=[row('unconfirmed-new',{company:'New',title:'Assistant',posted_at:'2026-10-19T00:00:00Z',eligibility:null}),
    row('confirmed-old',{company:'Old',title:'Assistant',posted_at:'2026-10-01T00:00:00Z',apply_url:url+'-old',verification:{...proof,evidence_url:url+'-old'}})];
  const result=await loadBriefingFeed({queries:['new','old'],country:'Nigeria',now,search:async ({q})=>({data:[jobs[q==='new'?0:1]]})});
  assert.deepEqual(result.jobs.map(j=>j.id),['confirmed-old','unconfirmed-new']);
});

test('generic engine uncertainty becomes a useful display reason without changing raw or model evidence', () => {
  const rawReason='Remote — region unconfirmed';
  const job=row('fallback',{eligibility:{eligible:true,confidence:'possible',reason:rawReason}});
  assert.equal(jobTrust(job,now).eligibility.reason,'The posting does not say which countries it can hire from.');
  assert.equal(job.eligibility.reason,rawReason);
  const evidence='Hiring looks tied to the United States';
  const modelReason=`Hiring looks tied to us — "${evidence}" — worth confirming before you apply`;
  const inferred=row('model-uncertain',{eligibility:{eligible:true,confidence:'possible',reason:modelReason},elig_signals:{infer:{evidence}}});
  assert.equal(jobTrust(inferred,now).eligibility.reason,modelReason);
  assert.equal(inferenceAudit(inferred).evidence,evidence);
  assert.equal(jobTrust(row('certain-text',{eligibility:{eligible:true,confidence:'certain',reason:rawReason}}),now).eligibility.reason,rawReason);
});
