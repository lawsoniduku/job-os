import {useState,useEffect,useRef} from 'react';
import {getHiringReview,saveHiringReview,getSubmissionCv,requestAiHiringReview,STAGE_LABELS} from '../lib/employerApi';
const active=['new','screening','shortlisted','interview','offer'];
export default function ReviewDesk({submission,criteria,onClose,onSaved,showToast}) {
 const [data,setData]=useState(null),[cv,setCv]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [note,setNote]=useState(''),[stage,setStage]=useState(submission.stage),[savedStage,setSavedStage]=useState(submission.stage);
 const [action,setAction]=useState(''),[due,setDue]=useState('');
 const [recommendation,setRecommendation]=useState('undecided'),[ratings,setRatings]=useState({});
 const dialog=useRef(null);
 useEffect(()=>{
  let cancelled=false;
  const previous=document.activeElement;
  dialog.current?.querySelector('button')?.focus();
  Promise.all([getHiringReview(submission.id),getSubmissionCv(submission.id)]).then(([review,text])=>{
   if(cancelled)return;
   setData(review);setStage(review.stage || submission.stage);setSavedStage(review.stage || submission.stage);setCv(text.cv_text || 'No readable CV on file.');
   setAction(review.review?.next_action || '');
   if(review.review?.due_at){const date=new Date(review.review.due_at);setDue(new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16));}
   if(review.review?.scorecard){setRecommendation(review.review.scorecard.recommendation);setRatings(Object.fromEntries(review.review.scorecard.ratings.map(r=>[r.criterion_id,r.rating])));}
  }).catch(e=>{if(!cancelled)setError(e.message);});
  return ()=>{cancelled=true;previous?.focus();};
 },[submission.id,submission.stage]);
 async function analyze() {
  if(busy)return;setBusy(true);setError('');
  try{await requestAiHiringReview(submission.id);setData(await getHiringReview(submission.id));showToast('AI review ready. Check the quotes before deciding.');}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function save(body,after) {
  if(busy || !data)return;setBusy(true);setError('');
  try {
   await saveHiringReview(submission.id,{...body,expected_updated_at:data.updated_at});
   const updated=await getHiringReview(submission.id);setData(updated);if(updated.stage){setStage(updated.stage);setSavedStage(updated.stage);}
   after?.();onSaved();showToast('Review saved.');
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 function keydown(e) {
  if(e.key==='Escape'&&!busy){e.stopPropagation();onClose();}
  if(e.key==='Tab') {
   const nodes=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')];
   if(!nodes.length)return;
   if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus();}
   else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus();}
  }
 }
 return <div className="emp-review-backdrop" onKeyDown={keydown}>
  <section ref={dialog} className="emp-review-desk" role="dialog" aria-modal="true" aria-labelledby="review-title">
   <header className="emp-review-header"><div><span className="eyebrow">CANDIDATE REVIEW</span><h2 id="review-title">{submission.candidate_ref}</h2><p>{STAGE_LABELS[savedStage]} · {submission.source==='upload'?'Private CV upload':'Applied through JobCopilot'}</p></div><button className="btn" onClick={onClose} disabled={busy} aria-label="Close candidate review">Close ×</button></header>
   {error&&<div role="alert" className="emp-error">{error}</div>}
   {!data&&!error&&<p className="emp-loading">Loading CV and review…</p>}
   {data&&<div className="emp-review-columns">
    <div className="emp-review-evidence">
     <h3>CV evidence</h3><p className="field-hint">A mention is a claim, not verified proficiency. Missing evidence is a question to ask.</p>
     {submission.assessment?.criteria?.length ? submission.assessment.criteria.map(c=><div className={`emp-evidence ${c.status}`} key={c.id}><div><strong>{c.label}</strong><span>{c.importance} · {c.status==='mentioned'?'Mention found':'Needs your review'}</span></div>{c.evidence?<blockquote>{c.evidence}</blockquote>:<p>The CV does not explicitly mention this criterion. Ask the candidate.</p>}</div>):<p className="emp-nudge">No criteria scan yet. Add criteria in the job editor, or review this CV yourself.</p>}
     <section className="emp-ai-review"><h3>Look beyond exact wording</h3><p className="field-hint">Request an AI review of equivalent skills and experience. It uses the configured AI provider and returns CV quotes and questions for you to assess. It never moves a candidate.</p><button className="btn" disabled={busy||!criteria.length} onClick={analyze}>{busy?'Working…':data.ai_review?'Refresh AI review':'Review with AI'}</button>
      {data.ai_review&&<><p className="field-hint">AI-assisted · {data.ai_review.model} · {new Date(data.ai_review.at).toLocaleString()}{data.ai_review.partial?' · Partial CV review: first 14,000 characters':''}</p>{data.ai_review.criteria.map(c=><div className="emp-evidence" key={c.criterion_id}><strong>{c.label}</strong><p>{c.status==='evidence_found'?'AI suggested evidence — check the quote':'Needs your review'}</p>{c.evidence&&<blockquote>{c.evidence}</blockquote>}<p>Ask: {c.question}</p></div>)}</>}
     </section>
     <details open><summary>Submitted CV text</summary><pre className="emp-cv">{cv}</pre></details>
    </div>
    <div className="emp-review-actions">
     <section><h3>Next step</h3><p className="field-hint">Private planning for your hiring team. Saving here does not send a message.</p>
      {active.includes(savedStage)&&<form onSubmit={e=>{e.preventDefault();save({stage});}} className="emp-inline-form"><label>Pipeline stage<select value={stage} onChange={e=>setStage(e.target.value)}>{active.map(s=><option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select></label><button className="btn" disabled={busy}>Save stage</button></form>}
      <form onSubmit={e=>{e.preventDefault();save({next_action:action,due_at:due?new Date(due).toISOString():null});}}>
       <label>What needs to happen?<input maxLength={300} value={action} onChange={e=>setAction(e.target.value)} placeholder="Arrange a 30-minute screening call"/></label>
       <label>Due date · your local time<input type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/></label>
       <button className="btn primary" disabled={busy}>Save next step</button>
      </form>
     </section>
     <section><h3>Structured scorecard</h3><form onSubmit={e=>{e.preventDefault();save({scorecard:{recommendation,ratings:criteria.map(c=>({criterion_id:c.id,rating:ratings[c.id]??null}))}});}}>
      {criteria.map(c=><label className="emp-rating" key={c.id}>{c.label}<select value={ratings[c.id]??''} onChange={e=>setRatings({...ratings,[c.id]:e.target.value?Number(e.target.value):null})}><option value="">Not assessed</option><option value="1">1 · Below requirement</option><option value="2">2 · Some evidence</option><option value="3">3 · Meets requirement</option><option value="4">4 · Strong evidence</option></select></label>)}
      <label>Your recommendation<select value={recommendation} onChange={e=>setRecommendation(e.target.value)}><option value="undecided">Undecided</option><option value="strong_yes">Strong yes</option><option value="yes">Yes</option><option value="no">No</option><option value="strong_no">Strong no</option></select></label>
      <button className="btn" disabled={busy}>Save scorecard</button><p className="field-hint">A recommendation records your assessment. It does not advance or reject this person.</p>
     </form></section>
     <section><h3>Private notes</h3><form onSubmit={e=>{e.preventDefault();save({note},()=>setNote(''));}}><label className="sr-only" htmlFor="review-note">Private review note</label><textarea id="review-note" rows={4} maxLength={4000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Evidence, questions for the interview, or context for your team…"/><button className="btn" disabled={busy||!note.trim()}>Add note</button></form></section>
     <section><h3>Activity</h3>{!data.activity.length&&<p className="field-hint">No review activity yet.</p>}<ol className="emp-activity">{data.activity.map(a=><li key={a.id}><time>{new Date(a.created_at).toLocaleString()}</time><strong>{a.kind==='stage'?`${STAGE_LABELS[a.body.from]} → ${STAGE_LABELS[a.body.to]}`:a.kind==='note'?'Note':a.kind==='task'?'Next step updated':'Scorecard saved'}</strong>{a.kind==='note'&&<p>{a.body.text}</p>}{a.kind==='task'&&<p>{a.body.next_action||'Next step cleared'}</p>}{a.kind==='scorecard'&&<p>{a.body.recommendation.replaceAll('_',' ')}</p>}</li>)}</ol></section>
    </div>
   </div>}
  </section>
 </div>;
}
