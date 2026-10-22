import {useState,useEffect,useRef} from 'react';
import {getHiringReview,saveHiringReview,getSubmissionCv,getOriginalCv,STAGE_LABELS} from '../lib/employerApi';
const active=['new','screening','shortlisted','interview','offer'];
export default function ReviewDesk({submission,criteria,onClose,onSaved,showToast}) {
 const [data,setData]=useState(null),[cv,setCv]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [note,setNote]=useState(''),[stage,setStage]=useState(submission.stage),[savedStage,setSavedStage]=useState(submission.stage);
 const [action,setAction]=useState(''),[due,setDue]=useState('');
 const [recommendation,setRecommendation]=useState('undecided'),[ratings,setRatings]=useState({});
 const [original,setOriginal]=useState(null),[originalError,setOriginalError]=useState(''),[tab,setTab]=useState('document');
 const dialog=useRef(null);
 useEffect(()=>{
  let cancelled=false;
  const previous=document.activeElement;
  dialog.current?.querySelector('button')?.focus();
  getOriginalCv(submission.id).then(r=>{if(!cancelled)setOriginal(r.document);}).catch(e=>{if(!cancelled)setOriginalError(e.message);});
  Promise.all([getHiringReview(submission.id),getSubmissionCv(submission.id)]).then(([review,text])=>{
   if(cancelled)return;
   setData(review);setStage(review.stage || submission.stage);setSavedStage(review.stage || submission.stage);setCv(text.cv_text || 'No readable CV on file.');
   setAction(review.review?.next_action || '');
   if(review.review?.due_at){const date=new Date(review.review.due_at);setDue(new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16));}
   if(review.review?.scorecard){setRecommendation(review.review.scorecard.recommendation);setRatings(Object.fromEntries(review.review.scorecard.ratings.map(r=>[r.criterion_id,r.rating])));}
  }).catch(e=>{if(!cancelled)setError(e.message);});
  return ()=>{cancelled=true;previous?.focus();};
 },[submission.id,submission.stage]);
 async function refreshOriginal(){try{const r=await getOriginalCv(submission.id);setOriginal(r.document);setOriginalError('');}catch(e){setOriginalError(e.message);}}
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
   const nodes=[...dialog.current.querySelectorAll('a[href],iframe,button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')];
   if(!nodes.length)return;
   if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus();}
   else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus();}
  }
 }
 return <div className="emp-review-backdrop" onKeyDown={keydown}>
  <section ref={dialog} className="emp-review-desk" role="dialog" aria-modal="true" aria-labelledby="review-title">
   <header className="emp-review-header"><div><span className="eyebrow">CANDIDATE REVIEW</span><h2 id="review-title">{submission.candidate_ref}</h2><p>{STAGE_LABELS[savedStage]} · {submission.source==='upload'?'Private CV upload':'Applied through JobCopilot'}</p></div><div className="emp-dialog-score">{submission.assessment?.method==='semantic_role_match'&&submission.match_score!=null&&<><strong>{submission.match_score}%</strong><span>documented role match</span></>}</div><button className="btn" onClick={onClose} disabled={busy} aria-label="Close candidate review">Close ×</button></header>
   {error&&<div role="alert" className="emp-error">{error}</div>}
   {!data&&!error&&<p className="emp-loading">Loading CV and review…</p>}
   {data&&<div className="emp-review-columns">
    <div className="emp-review-evidence">
     <nav className="emp-document-tabs" aria-label="Candidate review sections"><button className={tab==='document'?'active':''} onClick={()=>setTab('document')}>Original CV</button><button className={tab==='assessment'?'active':''} onClick={()=>setTab('assessment')}>Role assessment</button></nav>
     {tab==='document'&&<><div className="emp-document-toolbar"><span>{original?.filename || submission.cv_filename || 'Submitted CV'}</span><button onClick={refreshOriginal}>Refresh file link ↻</button>{original&&<a href={original.url} target="_blank" rel="noreferrer">{original.mime==='application/pdf'?'Open PDF ↗':'Download original ↗'}</a>}</div>{originalError&&<div className="emp-error">{originalError}</div>}{original?.mime==='application/pdf'?<iframe className="emp-original-pdf" title={`Original CV: ${original.filename}`} src={original.url} referrerPolicy="no-referrer" sandbox="allow-same-origin allow-downloads"/>:<div className="emp-document-text"><p className="field-hint">{original?'Download the original document above. Extracted text is below.':'This application has extracted CV text only. An original document was not attached.'}</p><pre className="emp-cv">{cv}</pre></div>}</>}
     {tab==='assessment'&&<div className="emp-assessment-panel"><span className="eyebrow">EVIDENCE, NOT GUESSWORK</span><h3 className="emp-assessment-title">{submission.assessment?.method==='semantic_role_match'?`${submission.match_score}% documented fit`:'Assessment queued'}</h3><p className="field-hint">{submission.summary}</p><p className="field-hint">Required criteria carry more weight than preferred criteria. Missing evidence is a question to ask, not proof of inability.</p>
      {submission.assessment?.criteria?.length?submission.assessment.criteria.map(c=><article className="emp-evidence" key={c.id || c.criterion_id}><div><strong>{c.label}</strong><span>{c.importance} · {c.status==='evidence_found'?c.strength==='demonstrated'?'Work evidence':c.strength==='mentioned'?'Skill mention':'Related evidence':c.status==='mentioned'?'Mention found':'Clarify in interview'}</span></div>{c.evidence?<blockquote>{c.evidence}</blockquote>:<p>No clear evidence in the CV. Ask the candidate for a concrete example.</p>}{c.question&&<p>Ask: {c.question}</p>}</article>):<p className="emp-nudge">No assessment yet. Set screening criteria in Edit, or review the CV now.</p>}
      {submission.assessment?.model&&<p className="field-hint">AI-assisted · {submission.assessment.model} · {new Date(submission.assessment.at).toLocaleString()}{submission.assessment.partial?' · First 14,000 CV characters':''}. Review the quotes before deciding. This score does not predict future performance.</p>}
      <details><summary>Read extracted CV text</summary><pre className="emp-cv">{cv}</pre></details>
     </div>}
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
