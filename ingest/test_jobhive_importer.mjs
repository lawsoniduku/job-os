import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const day=86400000;
const date=ms=>new Date(ms).toISOString();
const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
test('streamed CLI dry run recovers worldwide jobs, accounts for negative observations and never accesses the database',()=>{
 const now=Date.now();
 const headers=['title','url','description','location','country_iso','is_remote','posted_at','fetched_at','application_deadline'];
 const common={title:'Software Engineer',description:'Build useful software.',location:'Remote',country_iso:'US',is_remote:'true',posted_at:date(now-2*day),fetched_at:date(now-day)};
 const rows=[
  {...common,url:'https://example.recruitee.com/o/global',description:'Work from anywhere in the world.\nWe serve customers in Kenya and build "useful" software.'},
  {...common,url:'https://example.recruitee.com/o/stale',fetched_at:date(now-40*day)},
  {...common,url:'https://example.recruitee.com/o/expired',application_deadline:date(now-day)},
  {...common,url:'https://example.recruitee.com/o/onsite',is_remote:'false'},
  {...common,url:'https://example.recruitee.com/o/old',posted_at:date(Date.UTC(new Date(now).getUTCFullYear()-1,0,1))},
 ];
 const csv=[headers.join(','),...rows.map(row=>headers.map(h=>quote(row[h])).join(','))].join('\n');
 const preload=`globalThis.fetch=async url=>{if(String(url)!=='https://storage.stapply.ai/jobhive/v1/recruitee/jobs.csv')throw Error('Unexpected network access: '+url);return new Response(${JSON.stringify(csv)},{status:200});};`;
 const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'ingest/import_jobhive.js','recruitee','--dry-run'],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
 assert.match(result.stdout,/scanned:\s+5/);
 assert.match(result.stdout,/KEPT candidates:\s+1/);
 assert.match(result.stdout,/upstream_stale:\s*1/);
 assert.match(result.stdout,/deadline_expired:\s*1/);
 assert.match(result.stdout,/publication_age:\s*1/);
 assert.match(result.stdout,/region:\s*1/); // contradictory Remote+false flag reaches the authority before exclusion
 assert.match(result.stdout,/worldwide candidates recovered before dedup:\s*1/);
 assert.match(result.stdout,/dry run — nothing written/);
});

test('full importer records new foreign restrictions on an owned job without inserting rejected new jobs',()=>{
 const now=Date.now(),url='https://example.recruitee.com/o/existing';
 const existing={id:'00000000-0000-0000-0000-000000000001',source:'jobhive',ats_source:'recruitee',apply_url:url,title:'Software Engineer',location:'Remote',description:'Work from anywhere.',remote:true,country_iso:'US',eligibility_region:'Global',posted_at:date(now-day),elig_signals:{v:5,source:{fetched_at:date(now-2*day)}}};
 const headers=['title','url','description','location','country_iso','is_remote','posted_at','fetched_at'];
 const values={title:'Software Engineer',description:'Applicants must reside in the United States.',location:'New York, United States',country_iso:'US',is_remote:'false',posted_at:date(now-day),fetched_at:date(now-3600000)};
 const rows=[{...values,url},{...values,url:'https://example.recruitee.com/o/new-foreign'}];
 const csv=[headers.join(','),...rows.map(row=>headers.map(h=>quote(row[h])).join(','))].join('\n');
 const preload=`const writes=[];process.on('beforeExit',()=>console.log('QA_WRITES:'+JSON.stringify(writes)));globalThis.fetch=async(input,opts={})=>{const u=String(input);if(u==='https://storage.stapply.ai/jobhive/v1/recruitee/jobs.csv')return new Response(${JSON.stringify(csv)});if(!u.startsWith('https://fixture.supabase.co/rest/v1/jobs'))throw Error('Unexpected network '+u);const method=opts.method||'GET';if(method==='GET')return new Response(JSON.stringify([${JSON.stringify(existing)}]),{headers:{'content-type':'application/json'}});if(method==='PATCH'){writes.push(JSON.parse(opts.body));return new Response(JSON.stringify([{id:${JSON.stringify(existing.id)}}]),{headers:{'content-type':'application/json'}});}throw Error('Unexpected insert or mutation '+method);};`;
 const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'ingest/import_jobhive.js','recruitee','--max-new-rows','0'],{cwd:new URL('..',import.meta.url),env:{...process.env,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_KEY:'fixture-key'},encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
 const line=result.stdout.split('\n').find(x=>x.startsWith('QA_WRITES:'));
 const writes=JSON.parse(line.slice('QA_WRITES:'.length));
 assert.equal(writes.length,1,result.stdout);
 assert.equal(writes[0].location,'New York, United States');
 assert.match(writes[0].description,/must reside/);
 assert.equal(writes[0].source,'jobhive');
});

function runAdmission(rows,{maxNewRows=1}={}) {
 const now=Date.now(),headers=['title','url','company','description','location','country_iso','is_remote','posted_at','fetched_at'];
 const common={title:'People Operations Specialist',company:'Example',description:'Work from anywhere in the world. Build excellent products and support employees.',location:'Worldwide',is_remote:'true',posted_at:date(now-day),fetched_at:date(now-1000)};
 const csv=[headers.join(','),...rows.map(r=>headers.map(h=>quote(({...common,...r})[h])).join(','))].join('\n');
 const preload=`const writes=[];let reads=0;process.on('beforeExit',()=>console.log('QA_ADMISSION:'+JSON.stringify({writes,reads})));globalThis.fetch=async(input,opts={})=>{const u=String(input);if(u==='https://storage.stapply.ai/jobhive/v1/recruitee/jobs.csv')return new Response(${JSON.stringify(csv)});if(!u.startsWith('https://fixture.supabase.co/rest/v1/jobs'))throw Error('Unexpected network '+u);const method=opts.method||'GET';if(method==='GET'){reads++;return new Response('[]',{headers:{'content-type':'application/json'}});}if(method==='POST'){const rows=JSON.parse(opts.body);writes.push(...rows);return new Response(JSON.stringify(rows.map((_,i)=>({id:'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0')}))),{headers:{'content-type':'application/json'}});}throw Error('Unexpected mutation '+method);};`;
 const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'ingest/import_jobhive.js','recruitee','--max-new-rows',String(maxNewRows)],{cwd:new URL('..',import.meta.url),env:{...process.env,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_KEY:'fixture-key'},encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
 return JSON.parse(result.stdout.split('\n').find(x=>x.startsWith('QA_ADMISSION:')).slice('QA_ADMISSION:'.length));
}

test('new-row budget admits a fresh tail job instead of the first older CSV row',()=>{
 const now=Date.now();
 const out=runAdmission([{url:'https://example.recruitee.com/o/old',title:'Old People Operations Specialist',posted_at:date(now-100*day)},{url:'https://example.recruitee.com/o/new',title:'Fresh People Operations Specialist',posted_at:date(now-day)}]);
 assert.equal(out.writes.length,1);
 assert.equal(out.writes[0].apply_url,'https://example.recruitee.com/o/new');
});
test('an ineligible sibling cannot consume content deduplication before eligible intake',()=>{
 const out=runAdmission([{url:'https://example.recruitee.com/o/us',description:'US citizens only. Applicants must reside in the United States.'},{url:'https://example.recruitee.com/o/global'}]);
 assert.equal(out.writes.length,1);
 assert.equal(out.writes[0].apply_url,'https://example.recruitee.com/o/global');
});
test('freshest content-equivalent requisition wins without expanding the row cap',()=>{
 const now=Date.now();
 const out=runAdmission([{url:'https://example.recruitee.com/o/old',posted_at:date(now-100*day)},{url:'https://example.recruitee.com/o/new',posted_at:date(now-day)}]);
 assert.equal(out.writes.length,1);
 assert.equal(out.writes[0].apply_url,'https://example.recruitee.com/o/new');
});
test('a zero new-row budget performs no candidate-by-candidate database reads',()=>{
 const out=runAdmission(Array.from({length:12},(_,i)=>({url:`https://example.recruitee.com/o/new${i}`,title:`People Operations Specialist ${i}`})),{maxNewRows:0});
 assert.equal(out.writes.length,0);
 assert.equal(out.reads,1); // the bounded existing-owned inventory only
});
