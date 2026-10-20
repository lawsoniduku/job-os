import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const added=['jazzhr','rippling','personio','pinpoint','gem','recruiterbox','eightfold',
 'greenhouse','lever','ashby','workable','smartrecruiters','teamtailor','breezy'];
const original=['icims','phenom','recruitee','ycombinator','bamboohr'];
const plan=(sources='')=>spawnSync(process.execPath,['ingest/jobhive_plan.js'],{
 cwd:new URL('../',import.meta.url),encoding:'utf8',env:{...process.env,JOBHIVE_SOURCES:sources,GITHUB_OUTPUT:''}});
test('daily plan covers every original and newly maintained ATS exactly once',()=>{
 const r=plan();assert.equal(r.status,0,r.stderr);
 const rows=JSON.parse(r.stdout).include;
 assert.deepEqual(new Set(rows.map(x=>x.ats)),new Set([...original,...added]));
 assert.equal(rows.length,19);
 for(const row of rows){
  assert.equal(row.max_new_rows,original.includes(row.ats)?500:50);
  assert.equal(row.max_new_bytes,original.includes(row.ats)?10*1024*1024:1024*1024);
  assert.equal(row.prefer_confirmed,!original.includes(row.ats));
 }
 assert.equal(rows.filter(x=>added.includes(x.ats)).reduce((n,x)=>n+x.max_new_rows,0),700);
});
test('manual selection is bounded to maintained ATS names and deduplicates choices',()=>{
 const r=plan('jazzhr, rippling,jazzhr');assert.equal(r.status,0,r.stderr);
 assert.deepEqual(JSON.parse(r.stdout).include.map(x=>x.ats),['jazzhr','rippling']);
 for(const input of ['remoteok','remotive','jazzhr,$(echo injected)','../../other','all,jazzhr',','])
  assert.notEqual(plan(input).status,0,input);
});
test('workflow uses the shared daily plan, passes explicit budgets and keeps failures visible',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/jobhive-import.yml',import.meta.url),'utf8');
 assert.match(workflow,/node ingest\/jobhive_plan\.js/);
 assert.match(workflow,/--max-new-rows/);assert.match(workflow,/--max-new-bytes/);
 assert.match(workflow,/--dry-run/);assert.match(workflow,/max-parallel: 2/);
 assert.match(workflow,/--prefer-confirmed/);
 assert.doesNotMatch(workflow,/continue-on-error: true/);
 assert.match(workflow,/JOBHIVE_SOURCES: \$\{\{ inputs.sources/);
});
