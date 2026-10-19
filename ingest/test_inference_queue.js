import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { inferEligibility, needsInference } from '../api/inferEligibility.js';
import { extractEligibilitySignals, INFER_VERSION } from '../api/roleIntelligence.js';
import { MAX_DISCOVERY_AGE_DAYS } from '../api/jobFreshness.js';
import { inferenceOptions, collectInferenceCandidates, enrichInferenceCandidates, encodeInferenceCursor, decodeInferenceCursor, pendingInference } from './core/inferenceQueue.js';
import { inferencePageFetcher, inferenceWriter, runInference } from './infer_pending.js';
import { validateLLMConfig, DEFAULT_GROQ_MODEL } from '../lib/llm.js';
import axios from 'axios';

const now = Date.parse('2026-10-19T12:00:00Z');
const description = 'Build product dashboards and help our teams understand customer behaviour. '.repeat(4);
const job = (n = 1, extra = {}) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, title: 'Data Analyst', company: 'Example', location: 'Remote', description,
  posted_at: new Date(now - n * 1000).toISOString(), created_at: '2026-10-01T00:00:00Z', source: 'jobhive', apply_url: `https://example.bamboohr.com/careers/${n}`, link_status: 'unknown', ...extra });
const signals = row => extractEligibilitySignals(row);

test('queue defaults cover the shared discovery window and validate all bounds', () => {
  const opts = inferenceOptions([], now);
  assert.equal(opts.days, MAX_DISCOVERY_AGE_DAYS);
  assert.equal(Date.parse(opts.from), now - MAX_DISCOVERY_AGE_DAYS * 86400000);
  for (const args of [['--scan','0'], ['--page-size','1001'], ['--limit','NaN'], ['--max-pages','1.5'], ['--cursor','broken'], ['--unknown','1'], ['--days']]) {
    assert.throws(() => inferenceOptions(args, now));
  }
});

test('model queue rejects early deterministic decisions, contrary evidence and already-current inference', () => {
  for (const extra of [
    { title: 'Data Analyst - Mumbai' }, { location: 'Worldwide' },
    { description: `${description} Applicants must reside in Germany.` },
    { description: `${description} Applicants must reside in Nigeria.` },
    { description: `${description} We work from anywhere.` },
    { description: `${description} You must work from our office.` },
    { description: 'Too short' }, { link_status: 'dead' },
    { elig_signals: { ...signals(job()), infer: { v: INFER_VERSION, scope: 'unclear' } } },
    { elig_signals: { ...signals(job()), verification: { status: 'unknown', last_known: { status: 'dead' } } } },
  ]) {
    const row = job(1, extra);
    assert.equal(needsInference(row, row.elig_signals || signals(row)), false, JSON.stringify(extra));
  }
  assert.equal(needsInference(job(), signals(job())), true);
  assert.equal(needsInference(job(1, { location: 'Remote job' }), signals(job())), true);
});

test('pending rechecks stale signals, freshness, source and current contract', () => {
  assert.ok(pendingInference(job(), now));
  assert.ok(pendingInference(job(1, { elig_signals: { v: 1, hardExclusion: 'obsolete' } }), now));
  assert.ok(pendingInference(job(1, { elig_signals: { ...signals(job()), infer: { v: INFER_VERSION - 1 } } }), now));
  assert.equal(pendingInference(job(1, { source: 'arbeitnow' }), now), null);
  assert.equal(pendingInference(job(1, { posted_at: '2025-12-01T00:00:00Z' }), now), null);
  assert.equal(pendingInference(job(1, { elig_signals: { ...signals(job()), source: { application_deadline: '2026-10-18T00:00:00Z' } } }), now), null);
  assert.equal(pendingInference(job(1, { elig_signals: { v:1, verification:{status:'unknown',last_known:{status:'dead'}} } }), now), null);
});

test('cursor pages the pending server result beyond a filtered first page', async () => {
  const rows = [job(1, { title: 'Data Analyst - Mumbai' }), job(2, { description: `${description} Open to candidates worldwide.` }), job(3), job(4)];
  const requests = [];
  const result = await collectInferenceCandidates(async request => {
    requests.push(request);
    const offset = request.cursor ? rows.findIndex(row => row.id === request.cursor.id) + 1 : 0;
    return rows.slice(offset, offset + request.size);
  }, inferenceOptions(['--page-size','2','--limit','2'], now), now);
  assert.equal(result.pages, 2);
  assert.equal(result.scanned, 4);
  assert.deepEqual(result.selected.map(({job: row}) => row.id), [job(3).id, job(4).id]);
  assert.equal(requests[1].cursor.id, job(2).id);
  assert.deepEqual(decodeInferenceCursor(encodeInferenceCursor(result.cursor)), result.cursor);
});

test('scan and page limits stop bounded runs without silently losing the continuation', async () => {
  const rows = [job(1, { description: 'short' }), job(2, { description: 'short' }), job(3)];
  const run = opts => collectInferenceCandidates(async ({cursor,size}) => rows.filter(row => !cursor || row.posted_at < cursor.at).slice(0,size), opts, now);
  const scan = await run(inferenceOptions(['--scan','2','--page-size','1'], now));
  assert.equal(scan.selected.length, 0);
  assert.equal(scan.exhausted, false);
  const next = await run(inferenceOptions(['--cursor', encodeInferenceCursor(scan.cursor)], now));
  assert.equal(next.selected.length, 1);
  const capped = await run(inferenceOptions(['--max-pages','1','--page-size','1'], now));
  assert.equal(capped.scanned, 1);
  assert.equal(capped.exhausted, false);
});

test('duplicate or out-of-order cursor pages fail instead of spinning or skipping', async () => {
  await assert.rejects(() => collectInferenceCandidates(async () => [job(2),job(1)], inferenceOptions(['--page-size','2'], now), now), /advance/);
});

test('model verdicts retain unchanged version and auditable timestamp/model/provider', async () => {
  const result = await inferEligibility(job(), { generate: async () => ({ scope:'region', regions:['EMEA'], countries:[], evidence:'Our team is distributed across EMEA', confidence:'medium' }), now: () => now, config: {provider:'groq',model:'openai/gpt-oss-120b'} });
  assert.equal(result.v, INFER_VERSION);
  assert.equal(result.at, new Date(now).toISOString());
  assert.equal(result.model, 'openai/gpt-oss-120b');
  assert.equal(result.provider, 'groq');
  assert.equal(await inferEligibility(job(), { generate: async () => ({scope:'worldwide',evidence:'',confidence:'high'}) }), null);
});

test('summary distinguishes recovered, unclear and failed, preserving the failed row cursor', async () => {
  const selected = [1,2,3].map(n => ({job:job(n),sig:signals(job(n)),beforeCursor:n===1 ? null : {id:job(n-1).id}}));
  const attempts = new Map();
  const result = await enrichInferenceCandidates(selected, {concurrency:1, infer: async row => {
    const count = (attempts.get(row.id) || 0) + 1; attempts.set(row.id,count);
    if (row.id === job(1).id && count === 1) return null;
    if (row.id === job(3).id) return null;
    return {scope:row.id === job(2).id ? 'unclear' : 'region', confidence:'medium'};
  }, write: async () => ({saved:true})});
  assert.equal(result.selected, 3); assert.equal(result.resolved, 1); assert.equal(result.unclear, 1);
  assert.equal(result.failed, 1); assert.equal(result.recovered, 1); assert.equal(result.written, 2);
  assert.equal(result.calls, 5); assert.equal(result.callFailures, 3);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.retryCursor, selected[2].beforeCursor);
});

test('more than 30 percent failed calls fails a run even when retries recover every posting', async () => {
  let calls = 0;
  const result = await enrichInferenceCandidates([{job:job(),beforeCursor:null}], {
    concurrency:1, infer: async () => ++calls === 1 ? null : {scope:'unclear',confidence:'low'}, write:async () => ({saved:true}),
  });
  assert.equal(result.failed, 0); assert.equal(result.recovered, 1);
  assert.equal(result.failureRate, 0.5); assert.equal(result.exitCode, 1);
});

test('exactly 30 percent failures is tolerated; storage failure still makes a run fail', async () => {
  const selected = Array.from({length:7},(_,i)=>({job:job(i+1),beforeCursor:null}));
  const counts = new Map();
  const result = await enrichInferenceCandidates(selected,{concurrency:1,infer:async row=>{
    const n=(counts.get(row.id)||0)+1; counts.set(row.id,n);
    return row.id <= job(3).id && n===1 ? null : {scope:'unclear',confidence:'low'};
  },write:async()=>({saved:true})});
  assert.equal(result.calls,10); assert.equal(result.callFailures,3); assert.equal(result.exitCode,0);
  const failedWrite = await enrichInferenceCandidates([selected[0]], {infer:async()=>({scope:'unclear',confidence:'low'}),write:async()=>({saved:false,error:{message:'CAS conflict'}})});
  assert.equal(failedWrite.exitCode,1); assert.equal(failedWrite.written,0);
});

test('migration selects pending server-side and keeps privileged access explicit', async () => {
  const sql = await readFile(new URL('../supabase/migrations/017_inference_queue.sql', import.meta.url), 'utf8');
  for (const fragment of ['char_length', "'{infer,v}'", 'p_infer_version', 'p_signals_version', 'p_cursor_id', 'coalesce(j.posted_at, j.created_at)', 'service_role', 'security invoker']) assert.ok(sql.toLowerCase().includes(fragment.toLowerCase()), fragment);
  assert.match(sql, /revoke[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /order by coalesce\(j.posted_at, j.created_at\) desc, j.id desc/i);
  assert.match(sql, /coalesce\(j.created_at, j.posted_at\) <= p_until/);
});

test('Groq startup config has an official production default and actionable invalid-config errors', () => {
  assert.equal(DEFAULT_GROQ_MODEL, 'openai/gpt-oss-120b');
  assert.equal(validateLLMConfig({LLM_PROVIDER:'groq',GROQ_API_KEY:'fixture-only'}).model, DEFAULT_GROQ_MODEL);
  assert.equal(validateLLMConfig({LLM_PROVIDER:'groq',GROQ_API_KEY:'fixture-only',GROQ_MODEL:'qwen/custom-model'}).model, 'qwen/custom-model');
  assert.throws(() => validateLLMConfig({LLM_PROVIDER:'groq'}), /GROQ_API_KEY/);
  assert.throws(() => validateLLMConfig({LLM_PROVIDER:'groq',GROQ_API_KEY:'fixture-only',GROQ_MODEL:'   '}), /GROQ_MODEL/);
  assert.throws(() => validateLLMConfig({LLM_PROVIDER:'groq',GROQ_API_KEY:'fixture-only',GROQ_MODEL:'bad model ID'}), /GROQ_MODEL/);
  assert.throws(() => validateLLMConfig({LLM_PROVIDER:'typo'}), /LLM_PROVIDER/);
});

test('RPC sends pending predicate versions and cursor bounds without a newest-row client scan', async () => {
  let call;
  const db = {rpc:async(name,args)=>{call={name,args};return{data:[job()],error:null};}};
  const opts = inferenceOptions([], now);
  await inferencePageFetcher(db)({size:100,from:opts.from,until:opts.until,cursor:{at:job(2).posted_at,id:job(2).id}});
  assert.equal(call.name, 'pending_inference_jobs');
  assert.equal(call.args.p_limit, 100); assert.equal(call.args.p_cursor_id, job(2).id);
  assert.equal(call.args.p_since, opts.from); assert.equal(call.args.p_infer_version, INFER_VERSION);
  await assert.rejects(() => inferencePageFetcher({rpc:async()=>({error:{message:'does not exist'}})})({size:10}), /017_inference_queue/);
});

function casDb(row, {conflict = null, writeError = null} = {}) {
  let patch,writes=0;
  const db={rpc:async(name,args)=>{
    assert.equal(name,'write_job_inference');
    patch={elig_signals:{...row.elig_signals,...args.p_flags,infer:args.p_infer}};
    return ++writes===1 && conflict ? {data:[],error:null} : {data:writeError?[]:[{id:row.id}],error:writeError};
  },from:table=>{
    assert.equal(table,'jobs');
    const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:conflict||row,error:null})};return q;
  }};
  return{db,getPatch:()=>patch};
}

test('writer preserves source/availability evidence and attaches audited inference atomically', async () => {
  const row = job(1, {elig_signals:{...signals(job()),source:{ats:'bamboohr',fetched_at:new Date(now).toISOString()},verification:{status:'unknown',reason:'timeout'}}});
  const memory = casDb(row);
  const infer = {v:INFER_VERSION,scope:'unclear',confidence:'low',at:new Date(now).toISOString(),model:'fixture',provider:'offline'};
  const result = await inferenceWriter(memory.db,()=>now)({job:row},infer);
  assert.equal(result.saved,true);
  assert.deepEqual(memory.getPatch().elig_signals.source,row.elig_signals.source);
  assert.deepEqual(memory.getPatch().elig_signals.verification,row.elig_signals.verification);
  assert.deepEqual(memory.getPatch().elig_signals.infer,infer);
});

test('CAS reload refuses stale answers after the posting text changes or closes', async () => {
  for (const extra of [{description:`${description} Changed posting.`}, {link_status:'dead'}, {elig_signals:{...signals(job()),verification:{status:'dead'}}}]) {
    const row = job(1, {elig_signals:signals(job())});
    const latest = {...row,...extra};
    const memory = casDb(row,{conflict:latest});
    const result = await inferenceWriter(memory.db,()=>now)({job:row},{v:INFER_VERSION,scope:'unclear'});
    assert.equal(result.saved,false); assert.equal(result.skipped,true);
  }
});

test('complete batch emits honest zero-work and recovered-failure audits offline', async () => {
  const empty = await runInference({db:{rpc:async()=>({data:[],error:null})},options:inferenceOptions([],now),now:()=>now,sleep:async()=>{},infer:async()=>assert.fail('No inference should run')});
  assert.equal(empty.selected,0); assert.equal(empty.calls,0); assert.equal(empty.exitCode,0); assert.equal(empty.exhausted,true);
  let called=0;
  const one = await runInference({db:{rpc:async()=>({data:[job()],error:null})},options:inferenceOptions(['--limit','1'],now),now:()=>now,sleep:async()=>{},
    infer:async()=>++called===1 ? null : {scope:'unclear',confidence:'low'},write:async()=>({saved:true})});
  assert.equal(one.recovered,1); assert.equal(one.selected,1); assert.equal(one.exitCode,1);
  assert.equal(one.failureRate,0.5); assert.equal(one.at,new Date(now).toISOString());
});

test('one selected row in a larger partial page retains its continuation', async () => {
  const result = await collectInferenceCandidates(async()=>[job(1),job(2)],inferenceOptions(['--limit','1','--page-size','500'],now),now);
  assert.equal(result.exhausted,false); assert.equal(result.cursor.id,job(1).id);
});

test('Groq GPT OSS JSON parameters are compatible and never sent to other models', async () => {
  const originalPost = axios.post;
  const before = Object.fromEntries(['LLM_PROVIDER','GROQ_API_KEY','GROQ_MODEL'].map(key=>[key,process.env[key]]));
  const requests = [];
  axios.post = async (url,body) => {requests.push({url,body});return{data:{choices:[{message:{content:'{"scope":"unclear"}'}}]}};};
  try {
    process.env.LLM_PROVIDER='groq'; process.env.GROQ_API_KEY='offline-fixture-only';
    for (const model of [DEFAULT_GROQ_MODEL,'llama-3.1-8b-instant']) {
      process.env.GROQ_MODEL=model;
      const client = await import(`../lib/llm.js?offline-test=${encodeURIComponent(model)}`);
      const value = await client.generateJSON('fixture', {retries:0,reasoningEffort:'low',maxCompletionTokens:4096});
      assert.deepEqual(value,{scope:'unclear'});
    }
    assert.equal(requests[0].body.response_format.type,'json_object');
    assert.equal(requests[0].body.reasoning_format,'hidden');
    assert.equal(requests[0].body.reasoning_effort,'low');
    assert.equal(requests[0].body.max_completion_tokens,4096);
    assert.equal(requests[1].body.reasoning_format,undefined);
    assert.equal(requests[1].body.reasoning_effort,undefined);
    assert.equal(requests[1].body.max_completion_tokens,undefined);
  } finally {
    axios.post=originalPost;
    for (const [key,value] of Object.entries(before)) if (value===undefined) delete process.env[key]; else process.env[key]=value;
  }
});

test('cursor ordering preserves PostgreSQL microseconds rather than tying different instants', async () => {
  const rows = [job(1,{posted_at:'2026-10-19T11:59:59.999900Z'}), job(2,{posted_at:'2026-10-19T11:59:59.999800Z'})];
  assert.equal(Date.parse(rows[0].posted_at), Date.parse(rows[1].posted_at));
  const result = await collectInferenceCandidates(async ({cursor})=>cursor ? [rows[1]] : [rows[0]], inferenceOptions(['--page-size','1','--limit','2'],now),now);
  assert.equal(result.selected.length,2);
  assert.equal(decodeInferenceCursor(encodeInferenceCursor(result.cursor)).at, rows[1].posted_at);
});

test('SQL queue omits exactly positive worldwide locations but retains ambiguous Global', async () => {
  const sql = await readFile(new URL('../supabase/migrations/017_inference_queue.sql',import.meta.url),'utf8');
  assert.doesNotMatch(sql, /'(?:worldwide|anywhere|remote worldwide)'/);
  assert.match(sql, /'global'/);
  assert.ok(pendingInference(job(1,{location:'Global'}),now));
});

test('provider outage trips a bounded circuit without pacing thousands of unattempted postings', async () => {
  const selected=Array.from({length:3000},(_,i)=>({job:job(i+1),beforeCursor:null}));
  let calls=0,pauses=0;
  const checkpoints=[];
  const result=await enrichInferenceCandidates(selected,{concurrency:2,infer:async()=>{calls++;return null;},write:async()=>assert.fail('Unavailable model cannot write'),sleep:async()=>{pauses++;},onProgress:async audit=>checkpoints.push(audit)});
  assert.ok(calls <= 12, `${calls} calls`);
  assert.ok(pauses <= 12, `${pauses} pauses`);
  assert.ok(result.unattempted > 2980);
  assert.match(result.fatal,/circuit/i);
  assert.equal(result.exitCode,1);
  assert.ok(checkpoints.length>0);
});

test('batch inference propagates real permanent HTTP configuration errors only when requested', async () => {
  const originalPost=axios.post;
  const before=Object.fromEntries(['LLM_PROVIDER','GROQ_API_KEY','GROQ_MODEL'].map(key=>[key,process.env[key]]));
  axios.post=async()=>{const error=new Error('Request failed with status code 401');error.response={status:401,data:{error:{code:'invalid_api_key',message:'Invalid API key'}}};throw error;};
  try {
    process.env.LLM_PROVIDER='groq';process.env.GROQ_API_KEY='offline-only';process.env.GROQ_MODEL=DEFAULT_GROQ_MODEL;
    const client=await import('../lib/llm.js?fatal-http-fixture');
    await assert.rejects(()=>inferEligibility(job(),{generate:client.generateJSON,throwFatal:true}), error=>error.fatal && /invalid_api_key|Invalid API key/.test(error.message));
    assert.equal(await inferEligibility(job(),{generate:client.generateJSON}),null);
  } finally {
    axios.post=originalPost;
    for(const[key,value]of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});

test('inference POST write detects text changes despite unchanged signals and supports null locations', async () => {
  const row=job(1,{location:null,description:description.repeat(100),elig_signals:signals(job())});
  const actual={...row,description:`${row.description} Applicants must reside in Germany.`};
  let payload;
  const db={rpc:async(name,args)=>{
    assert.equal(name,'write_job_inference');payload=args;
    const same=Object.entries(args.p_expected).every(([key,value])=>JSON.stringify(actual[key]??null)===JSON.stringify(value));
    if(same)actual.elig_signals={...actual.elig_signals,...args.p_flags,infer:args.p_infer};
    return{data:same?[{id:actual.id}]:[],error:null};
  },from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:actual,error:null})};return q;}};
  const result=await inferenceWriter(db,()=>now,{pause:async()=>{}})({job:row},{v:INFER_VERSION,scope:'unclear',at:new Date(now).toISOString(),model:'offline'});
  assert.equal(result.saved,false);assert.equal(result.skipped,true);assert.equal(actual.elig_signals.infer,undefined);
  assert.equal(payload.p_expected.location,null);
  assert.ok(payload.p_expected.description.length>8000);
});

test('a real SIGTERM leaves an atomic resumable audit while a mocked model call is in flight', {timeout:15000}, async () => {
  const directory=await mkdtemp(join(tmpdir(),'jobos-inference-audit-'));
  const path=join(directory,'audit.json');
  const moduleURL=new URL('./infer_pending.js',import.meta.url).href;
  const row=job(1,{posted_at:new Date(Date.now()-2000).toISOString(),created_at:new Date(Date.now()-3000).toISOString()});
  const source=`
    import axios from 'axios';
    globalThis.fetch=async input=>{
      const url=typeof input==='string'?input:input.url;
      if(!url.startsWith('https://offline.invalid/rest/v1/rpc/pending_inference_jobs'))throw new Error('Forbidden fixture transport: '+url);
      return new Response(JSON.stringify([${JSON.stringify(row)}]),{status:200,headers:{'Content-Type':'application/json'}});
    };
    axios.post=async()=>{process.stdout.write('OFFLINE_MODEL_STARTED\\n');return new Promise(()=>{setInterval(()=>{},1000);});};
    const {main}=await import(${JSON.stringify(moduleURL)});
    await main(['--limit','1','--audit',${JSON.stringify(path)}]);
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:new URL('../',import.meta.url),env:{...process.env,LLM_PROVIDER:'groq',GROQ_API_KEY:'offline-fixture-only',GROQ_MODEL:DEFAULT_GROQ_MODEL,SUPABASE_URL:'https://offline.invalid',SUPABASE_KEY:'offline-fixture-only'},stdio:['ignore','pipe','pipe']});
  let output='';
  try {
    await new Promise((resolve,reject)=>{
      child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('OFFLINE_MODEL_STARTED'))resolve();});
      child.stderr.on('data',chunk=>{output+=chunk;});
      child.once('error',reject);child.once('exit',code=>reject(new Error(`Fixture exited early ${code}: ${output}`)));
    });
    const exit=once(child,'exit');
    child.kill('SIGTERM');
    const [code]=await exit;
    assert.equal(code,143);
    const audit=JSON.parse(await readFile(path,'utf8'));
    assert.equal(audit.stage,'interrupted');assert.equal(audit.calls,1);assert.equal(audit.selected,1);
    assert.equal(audit.in_flight,1);assert.equal(audit.failed_row_retry,true);
    assert.equal(audit.resume_cursor,null);assert.match(audit.fatal,/SIGTERM/);
  } finally {
    if(child.exitCode===null)child.kill('SIGKILL');
    await rm(directory,{recursive:true,force:true});
  }
});

test('production timestamp-without-timezone dates retain UTC microseconds and resumable cursors', async () => {
  const opts=inferenceOptions(['--limit','1','--page-size','2'],now);
  const rows=[job(1,{posted_at:'2026-10-19T11:59:59.123456',created_at:'2026-10-01T00:00:00'}),job(2,{posted_at:'2026-10-19T11:59:59.123455'})];
  const first=await collectInferenceCandidates(async()=>rows,opts,now);
  assert.equal(first.selected.length,1);
  assert.equal(first.cursor.at,'2026-10-19T11:59:59.123456Z');
  const next=decodeInferenceCursor(encodeInferenceCursor(first.cursor));
  const second=await collectInferenceCandidates(async()=>[rows[1]],{...opts,cursor:next},now);
  assert.equal(second.selected[0].job.id,rows[1].id);
  assert.equal(second.cursor.at,'2026-10-19T11:59:59.123455Z');
});
