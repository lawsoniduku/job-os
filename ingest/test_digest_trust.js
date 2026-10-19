import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDigestFeeds,normalizeDigestPreference,digestPreferenceKey} from './core/digestFeed.js';
const now=Date.parse('2026-10-19T12:00:00Z'),day=86400000;
const pref={country:'Nigeria',roleCluster:'People Analytics'};
const role=(id,patch={})=>({id:String(id).padStart(8,'0'),title:'People Analyst',company:'Company '+id,location:'Worldwide',description:'Open to candidates worldwide. Analyse people data.',source:'jobhive',ats_source:'recruitee',apply_url:'https://example.recruitee.com/o/'+id,posted_at:new Date(now-day).toISOString(),last_seen_at:new Date(now-day).toISOString(),...patch});
function fakeDb(rows,{failPage=0}={}){let reads=0;return {get reads(){return reads;},from(){let after=null,limit;const q={select(){return q;},in(){return q;},gte(){return q;},lte(){return q;},or(){return q;},gt(key,value){assert.equal(key,'id');after=value;return q;},order(key){assert.equal(key,'id');return q;},limit(n){limit=n;return q;},then(resolve,reject){reads++;return Promise.resolve(failPage===reads?{error:{message:'database unavailable'}}:{data:rows.filter(j=>after===null||j.id>after).slice(0,limit),error:null}).then(resolve,reject);}};return q;}};}
const feed=async(rows,preferences=[pref],opts={})=>{const feeds=await buildDigestFeeds({db:fakeDb(rows),preferences,now,...opts});return feeds.get(digestPreferenceKey(preferences[0]));};
test('normalizes supported exact country aliases and refuses unknown/missing countries',()=>{
 assert.equal(normalizeDigestPreference({country:' South Africa '}).country,'southafrica');
 assert.equal(normalizeDigestPreference({country:'USA'}).country,'us');
 assert.equal(normalizeDigestPreference({country:'Nigeria and Canada'}).country,null);
 assert.equal(normalizeDigestPreference({}).country,null);
});
test('Nigeria domestic roles are not emailed as eligible to Canada',async()=>{
 const result=await feed([role('local',{location:'Lagos, Nigeria'})],[{country:'Canada',roleCluster:'People Analytics'}]);
 assert.deepEqual(result.jobs,[]);
});
test('EMEA Nigeria jobs survive coarse Regional tag when deterministic evidence permits',async()=>{
 const result=await feed([role('emea',{location:'EMEA',eligibility_region:'Regional',description:'We serve customers in Kenya. Analyse people data.'})]);
 assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].eligibility.confidence,'likely');
});
test('dead retired expired and stale jobs never enter digest',async()=>{
 const result=await feed([
 role('dead',{link_status:'dead'}),role('retired',{source:'arbeitnow'}),
 role('stale',{last_seen_at:new Date(now-40*day).toISOString()}),
 role('old',{posted_at:new Date(now-40*day).toISOString()}),
 role('expired',{elig_signals:{source:{application_deadline:new Date(now-day).toISOString()}}}),
 role('valid'),]);assert.deepEqual(result.jobs.map(j=>j.company),['Company valid']);
});
test('unclear eligibility and missing country are not labelled eligible',async()=>{
 assert.deepEqual((await feed([role('unknown',{location:'Remote',description:'Analyse people data.'})])).jobs,[]);
 const result=await feed([role('global')],[{country:null}]);assert.deepEqual(result.jobs,[]);assert.match(result.reason,/country/i);
});
test('title relevance prevents stale role labels from polluting preferred roles',async()=>{
 const result=await feed([role('wrong',{title:'Software Engineer',role_cluster:'People Analytics'}),role('right')]);
 assert.deepEqual(result.jobs.map(j=>j.company),['Company right']);
});
test('matching roles after row 500 are found with bounded pages and output',async()=>{
 const rows=Array.from({length:501},(_,i)=>role(i,{title:i===500?'People Analyst':'Software Engineer'}));
 const result=await feed(rows,[pref],{pageSize:100,maxJobs:3});assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].company,'Company 500');
});
test('duplicate preferences share one database scan and failures abort before delivery',async()=>{
 const db=fakeDb([role(1),role(2),role(3)]);const feeds=await buildDigestFeeds({db,preferences:[pref,pref,{country:'Canada'}],now,pageSize:2});
 assert.equal(db.reads,2);assert.equal(feeds.size,2);
 await assert.rejects(()=>buildDigestFeeds({db:fakeDb([role(1),role(2)],{failPage:2}),preferences:[pref],now,pageSize:1}),/database unavailable/);
});
test('all-role preference keeps eligible vacancies without inventing a role match',async()=>{
 const result=await feed([role('all',{title:'Software Engineer'})],[{country:'Nigeria'}]);assert.equal(result.jobs.length,1);
});
import {digestLinks,buildDigestEmail} from './core/digestEmail.js';
test('digest links open the candidate root and unsubscribe through the API',()=>{
 const links=digestLinks({siteUrl:'https://web.example/old/path',apiUrl:'https://api.example/api',unsubscribeToken:'token&x=1'});
 assert.equal(links.site,'https://web.example/');
 const unsubscribe=new URL(links.unsubscribe);assert.equal(unsubscribe.origin,'https://api.example');assert.equal(unsubscribe.pathname,'/digest/unsubscribe');assert.equal(unsubscribe.searchParams.get('token'),'token&x=1');
 assert.throws(()=>digestLinks({apiUrl:'javascript:alert(1)'}),/HTTPS/);
});
test('digest rendering separates location evidence and availability and escapes source content',()=>{
 const html=buildDigestEmail({jobs:[{...role('safe',{title:'People <Analyst>',company:'A&B'}),eligibility:{eligible:true,confidence:'likely',reason:'EMEA region'}}],unsubscribeToken:'abc',now});
 assert.match(html,/People &lt;Analyst&gt;/);assert.match(html,/A&amp;B/);assert.match(html,/Location confidence: Good\. Availability: Unverified\./);assert.match(html,/EMEA region/);assert.doesNotMatch(html,/href="https:\/\/job-os-tau.vercel.app\/digest\/unsubscribe/);
});
test('unsafe application links and invalid role preferences are not delivered',async()=>{
 assert.deepEqual((await feed([role('bad',{apply_url:'javascript:alert(1)'})])).jobs,[]);
 const result=await feed([role('ok')],[{country:'Nigeria',roleCluster:'Unrecognized role'}]);assert.deepEqual(result.jobs,[]);assert.match(result.reason,/role/i);
});
test('output stays bounded after all pages while preserving distinct newest matches',async()=>{
 const rows=Array.from({length:51},(_,i)=>role(i,{posted_at:new Date(now-(51-i)*1000).toISOString()}));
 const result=await feed(rows,[pref],{pageSize:10,maxJobs:3});assert.equal(result.jobs.length,3);assert.deepEqual(result.jobs.map(j=>j.company),['Company 50','Company 49','Company 48']);
});
test('unknown publication dates cannot be promised as new this week',async()=>{
 assert.deepEqual((await feed([role('unknown-publication',{elig_signals:{source:{publication_unknown:true}}})])).jobs,[]);
});
