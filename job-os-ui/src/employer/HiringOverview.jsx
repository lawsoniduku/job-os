import {useEffect,useState} from 'react';
import {getHiringOverview,STAGE_LABELS} from '../lib/employerApi';
export default function HiringOverview({postings,onSelect}) {
 const [now,setNow]=useState(Date.now);
 const [data,setData]=useState(null),[error,setError]=useState('');
 function load(){setNow(Date.now());setError('');getHiringOverview().then(setData).catch(e=>setError(e.message));}
 useEffect(()=>{let cancelled=false;getHiringOverview().then(r=>{if(!cancelled)setData(r);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[]);
 return <div className="emp-overview"><header className="emp-head"><div><span className="eyebrow">YOUR HIRING DESK</span><h1>Keep good people moving.</h1><p>Start with the applicants and next steps that need your attention.</p></div><button className="btn" onClick={load}>Refresh</button></header>
  {error&&<div className="emp-error" role="alert">{error}</div>}
  {!data&&!error&&<p className="emp-loading">Loading hiring overview…</p>}
  {data&&<><div className="emp-stat-grid">{[[postings.filter(p=>p.status==='open').length,'Open roles'],[data.metrics.unreviewed,'New applicants'],[data.metrics.waiting,'Waiting over 7 days'],[data.metrics.overdue,'Overdue next steps']].map(([n,label])=><article key={label}><strong>{n}</strong><span>{label}</span></article>)}</div>
   <section className="emp-overview-section"><h2>Hiring pipeline</h2><div className="emp-pipeline-counts">{Object.entries(data.metrics.stages).map(([s,n])=><div key={s}><span>{STAGE_LABELS[s]}</span><strong>{n}</strong></div>)}</div><p className="field-hint">Current applicant counts by stage, including uploaded CVs. These are counts, not conversion rates.</p></section>
   <section className="emp-overview-section"><h2>Next steps</h2>{!data.tasks.length&&<p>No next steps set. Open an applicant review to add one.</p>}{data.tasks.map(t=>{const p=postings.find(p=>p.id===t.posting_id);return <button key={t.submission_id} className="emp-task-item" onClick={()=>onSelect(t.posting_id,t.submission_id)}><span><strong>{t.next_action}</strong><small>{p?.title||'Role'}</small></span><time className={Date.parse(t.due_at)<now?'overdue':''}>{t.due_at?new Date(t.due_at).toLocaleString():'No due date'}</time></button>;})}<p className="field-hint">Showing up to {data.task_limit} upcoming tasks, earliest due first.</p></section>
  </>}
 </div>;
}
