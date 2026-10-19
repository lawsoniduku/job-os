/** Pending eligibility inference. Apply migration 017 before running.
 * PowerShell: node --env-file=.env ingest/infer_pending.js --limit 3000 --scan 20000 --page-size 500
 * Importing this module does not access a model or database.
 */
import { pathToFileURL } from 'node:url';
import { writeFile, rename } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { ACTIVE_JOB_SOURCES } from '../api/sourcePolicy.js';
import { extractEligibilitySignals, SIGNALS_VERSION, INFER_VERSION } from '../api/roleIntelligence.js';
import { inferEligibility } from '../api/inferEligibility.js';
import { isLLMHealthy, llmConfig, llmState, validateLLMConfig } from '../lib/llm.js';
import { collectInferenceCandidates, enrichInferenceCandidates, inferenceOptions, encodeInferenceCursor, pendingInference } from './core/inferenceQueue.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (value, fallback, name, min, max) => {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
};

export function inferencePageFetcher(db) {
  return async ({cursor,size,from,until}) => {
    const {data,error} = await db.rpc('pending_inference_jobs', {
      p_sources: ACTIVE_JOB_SOURCES, p_infer_version: INFER_VERSION, p_signals_version: SIGNALS_VERSION,
      p_since: from, p_until: until, p_cursor_at: cursor?.at ?? null, p_cursor_id: cursor?.id ?? null, p_limit:size,
    });
    if (error) throw new Error(`Inference queue failed: ${error.message}. Apply supabase/migrations/017_inference_queue.sql and use a service-role SUPABASE_KEY.`);
    return data;
  };
}

export function inferenceWriter(db, now = Date.now, {attempts=4,pause=sleep} = {}) {
  const identity = ['title','company','location','description','source','apply_url'];
  return async ({job}, infer) => {
    let latest=job,lastError=null;
    for(let attempt=0;attempt<attempts;attempt++) {
      try {
        if(!latest) {
          const read=await db.from('jobs').select('id,title,company,location,description,source,apply_url,posted_at,created_at,link_status,elig_signals').eq('id',job.id).maybeSingle();
          if(read.error)throw new Error(read.error.message);
          if(!read.data)return{saved:false,skipped:true,error:null};
          latest=read.data;
        }
        if(identity.some(key=>latest[key]!==job[key]))return{saved:false,skipped:true,error:null};
        const flags=extractEligibilitySignals(latest);
        if(!pendingInference({...latest,elig_signals:{...latest.elig_signals,...flags}},now()))return{saved:false,skipped:true,error:null};
        // Full text travels in a POST body, never unbounded URL predicates.
        const expected=Object.fromEntries([...identity,'link_status','elig_signals'].map(key=>[key,latest[key]??null]));
        const result=await db.rpc('write_job_inference',{p_id:job.id,p_expected:expected,p_infer:infer,p_flags:flags});
        if(result.error)throw new Error(result.error.message);
        if(result.data?.length)return{saved:true,skipped:false,error:null};
        lastError=new Error('Posting text or evidence changed concurrently');
      } catch(error) {lastError=error;}
      latest=null;
      if(attempt+1<attempts)await pause(Math.min(1500,200*(attempt+1)));
    }
    return{saved:false,skipped:false,error:lastError};
  };
}

export async function runInference({db, options, infer = row=>inferEligibility(row,{throwFatal:true}), write = inferenceWriter(db),
  now = Date.now, sleep:pause = sleep, concurrency = 2, paceMs = 1200, retryMs = 8000,onCheckpoint = async()=>{}} = {}) {
  const metadata = () => ({
    scope:{from:options.from,until:options.until,days:options.days}, provider:llmConfig.provider,model:llmConfig.model,
    infer_version:INFER_VERSION,at:new Date(now()).toISOString(),last_model_error:llmState.lastError});
  const selecting = progress => onCheckpoint({...metadata(),stage:'selecting',...progress,
    resume_cursor:encodeInferenceCursor(options.cursor),failed_row_retry:false});
  await selecting({selected:0,scanned:0,pages:0,calls:0});
  const queue = await collectInferenceCandidates(inferencePageFetcher(db), options, now(),selecting);
  const audit = (results,stage) => ({...results,...metadata(),stage,scanned:queue.scanned,pages:queue.pages,
    queue_exhausted:queue.exhausted,exhausted:queue.exhausted && !results.unattempted && !results.failed,
    resume_cursor:encodeInferenceCursor(results.retryCursor !== undefined ? results.retryCursor : queue.cursor),
    failed_row_retry:results.retryCursor !== undefined});
  const results = await enrichInferenceCandidates(queue.selected, {infer,write,sleep:pause,concurrency,paceMs,retryMs,
    onProgress:results=>onCheckpoint(audit(results,'enriching'))});
  const complete = audit(results,'complete');
  await onCheckpoint(complete);
  return complete;
}

// Serialize checkpoints and atomically rename each complete JSON document.
// A killed process leaves the previous checkpoint readable, never half JSON.
export function createAuditWriter(path) {
  let pending = Promise.resolve();
  const temporary = `${path}.${process.pid}.tmp`;
  return audit => {
    const body = `${JSON.stringify(audit,null,2)}\n`;
    pending = pending.then(async()=>{await writeFile(temporary,body,'utf8');await rename(temporary,path);});
    return pending;
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = inferenceOptions(argv);
  const config = validateLLMConfig(env);
  const concurrency = bounded(env.INFER_CONCURRENCY, 2, 'INFER_CONCURRENCY', 1, 8);
  const paceMs = bounded(env.INFER_PACE_MS, 1200, 'INFER_PACE_MS', 0, 60000);
  const retryMs = bounded(env.INFER_RETRY_MS, 8000, 'INFER_RETRY_MS', 0, 60000);
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) throw new Error('SUPABASE_URL and service-role SUPABASE_KEY are required; nothing was selected or written');
  console.log(`Eligibility inference: ${config.provider}/${config.model}; scope ${options.from || 'all dates'} to ${options.until}`);
  console.log(`Posting limit ${options.limit}; scan ${options.scan}; page size ${options.pageSize}; max pages ${options.maxPages}; each posting may have one retry`);
  if (!(await isLLMHealthy())) throw new Error(`Model configuration/unreachable: ${llmState.lastError || `${config.provider}/${config.model}`}; nothing was selected or written`);
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
  const saveAudit = createAuditWriter(options.auditPath);
  let lastAudit,stopping=false;
  const checkpoint = async audit=>{lastAudit=audit;await saveAudit(audit);};
  const interrupted = signal=>{
    if(stopping)return;
    stopping=true;
    const audit={...lastAudit,stage:'interrupted',fatal:`Run interrupted by ${signal}`,at:new Date().toISOString(),exitCode:1};
    // The last checkpoint rewinds before every in-flight/unattempted row.
    saveAudit(audit).finally(()=>process.exit(signal==='SIGINT'?130:143));
  };
  const sigint=()=>interrupted('SIGINT'),sigterm=()=>interrupted('SIGTERM');
  process.once('SIGINT',sigint);process.once('SIGTERM',sigterm);
  let result;
  try {result=await runInference({db,options,concurrency,paceMs,retryMs,onCheckpoint:checkpoint});}
  finally {process.off('SIGINT',sigint);process.off('SIGTERM',sigterm);}
  console.log(JSON.stringify(result, null, 2));
  if (result.failureRate > 0.3) console.error(`Failed ${(result.failureRate*100).toFixed(1)}% of model calls (>30%); run fails even if retries later recovered some rows.`);
  if (result.writeFailures) console.error(`${result.writeFailures} storage/changed-posting failures; inspect the audit and resume cursor.`);
  if ((result.resume_cursor && !result.exhausted) || result.failed_row_retry) console.log(`More work/retries may remain. Resume with --cursor "${result.resume_cursor || ''}" (empty means restart newest).`);
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => {process.exitCode = code;}).catch(error => {console.error(`Inference startup/run failed: ${error.message}`);process.exitCode = 1;});
}
