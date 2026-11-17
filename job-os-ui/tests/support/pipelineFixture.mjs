const fakeClient=`
const user='00000000-0000-4000-8000-000000000001';
let rows=[],serial=100;
const stamp=()=>new Date().toISOString();
const make=(id,title,status,extra={})=>({id:'application-'+id,user_id:user,job_id:'job-'+id,job_title:title,company:'Synthetic QA',status,applied_at:['applied','interview','offer','closed'].includes(status)?stamp():null,apply_clicked_at:new Date(Date.now()-20000).toISOString(),apply_outcome:null,created_at:stamp(),updated_at:stamp(),nudge_count:0,apply_url:'https://example.invalid/apply',...extra});
export const qa={reset(){rows=[make('saved','Saved intentionally','saved',{apply_outcome:'not_yet'}),make('applied','Submitted application','applied',{apply_outcome:'applied'}),make('interview','Interview underway','interview',{apply_outcome:'applied'}),make('offer','Offer received','offer',{apply_outcome:'applied'}),make('closed','Genuine closed application','closed',{apply_outcome:'applied'}),make('legacy','Old false Closed','closed',{applied_at:null,apply_outcome:'abandoned',outcome_reason:'location'}),make('viewed','Viewed only','applied_intent')];},rows:()=>structuredClone(rows)};
qa.reset();
export const supabase={from(table){let op='get',payload,options={},filters=[],single=false,sort=null,limit=null;const q={
 select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},neq(k,v){filters.push(r=>r[k]!==v);return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},not(k,op,v){filters.push(r=>(r[k]??null)!==v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},order(k,o){sort=[k,o];return q;},limit(n){limit=n;return q;},update(p){op='update';payload=p;return q;},upsert(p,o){op='upsert';payload=p;options=o;return q;},insert(p){op='insert';payload=p;return q;},delete(){op='delete';return q;},maybeSingle(){single=true;return run();},then(a,b){return run().then(a,b);}};
 async function run(){if(table!=='applications')return {data:[],error:null};let data=rows.filter(r=>filters.every(f=>f(r)));
 if(op==='upsert'){const old=rows.find(r=>r.user_id===payload.user_id&&r.job_id===payload.job_id);if(old&&options.ignoreDuplicates)data=[];else if(old){Object.assign(old,payload);data=[old];}else{const r=make(String(serial++),payload.job_title,payload.status,{...payload,applied_at:payload.applied_at||null});rows.push(r);data=[r];}}
 if(op==='update'){for(const r of data)Object.assign(r,payload,{updated_at:stamp()});}
 if(op==='delete')rows=rows.filter(r=>!data.includes(r));
 if(sort){const [k,o]=sort;data.sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(o.ascending===false?-1:1));}if(limit)data=data.slice(0,limit);
 return {data:structuredClone(single?data[0]||null:data),error:null};}return q;}};
export const authEnabled=true;
`;
const entry=`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Pipeline from '/src/views/Pipeline.jsx';import ReturnNudge from '/src/ReturnNudge.jsx';
import {qa} from 'qa-client';import '/src/theme.css';
const user={id:'00000000-0000-4000-8000-000000000001'};
function Test(){const [version,setVersion]=useState(0),[toast,setToast]=useState('');
 window.__pipelineQA={rows:qa.rows,reset:()=>{qa.reset();setToast('');setVersion(v=>v+1);}};
 return <><Pipeline key={'pipeline'+version} active={true} shared={{user,requireAuth:()=>true,showToast:setToast,setView:()=>{}}}/><ReturnNudge key={'nudge'+version} user={user} showToast={setToast}/><div id="qa-toast">{toast}</div></>;
}createRoot(document.getElementById('root')).render(<Test/>);
`;

// Compile the real components with an isolated data client; no production
// credentials, browser auth state or application data are loaded by this test.
const plugin={name:'isolated-pipeline-qa',enforce:'pre',
 resolveId(id){
  if(/(?:^|\/)supabaseClient(?:\.js)?$/.test(id)||id==='qa-client')return '\0qa-client';
  if(id==='/__qa_entry.jsx')return id;
 },
 load(id){if(id==='\0qa-client')return fakeClient;if(id==='/__qa_entry.jsx')return entry;},
};
export {plugin};
