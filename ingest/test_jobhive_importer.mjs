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
 assert.match(result.stdout,/foreign_onsite:\s*1/);
 assert.match(result.stdout,/worldwide candidates recovered before dedup:\s*1/);
 assert.match(result.stdout,/dry run — nothing written/);
});
