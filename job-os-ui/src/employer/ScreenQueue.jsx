import {useState,useEffect,useCallback,useRef} from 'react';
import {listSubmissions,sendFeedback,uploadCandidates,rescanApplicants,REASON_OPTIONS,REASON_LABELS,STAGE_LABELS} from '../lib/employerApi';
import {collectCvFiles} from '../lib/cvArchive';
import {extractTextFromFile} from '../lib/extractText';
import {compareHiringCandidates} from '../../../shared/hiringWorkflow.js';
import ReviewDesk from './ReviewDesk';
export default function ScreenQueue({postingId,initialReviewId,showToast,onChanged}) {
 const [subs,setSubs]=useState([]),[criteria,setCriteria]=useState([]),[reviewing,setReviewing]=useState(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[query,setQuery]=useState(''),[sort,setSort]=useState('match');
 const [pageSize,setPageSize]=useState(50);
 const [filter,setFilter]=useState('all'),[selected,setSelected]=useState(new Set()),[rejecting,setRejecting]=useState(null);
 const [upload,setUpload]=useState(null),[report,setReport]=useState(null),[dragging,setDragging]=useState(false),[busy,setBusy]=useState(false);
 const fileRef=useRef(null),openedInitial=useRef(null);
 const load=useCallback(async()=>{try{const r=await listSubmissions(postingId);setSubs(r.submissions);setCriteria(r.posting.screening_criteria || []);setError('');}catch(e){setError(e.message);}finally{setLoading(false);}},[postingId]);
 useEffect(()=>{let cancelled=false;listSubmissions(postingId).then(r=>{if(!cancelled){setSubs(r.submissions);setCriteria(r.posting.screening_criteria || []);setError('');}}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[postingId]);
 useEffect(()=>{if(initialReviewId&&subs.length&&openedInitial.current!==initialReviewId){openedInitial.current=initialReviewId;setReviewing(subs.find(s=>s.id===initialReviewId)||null);}},[initialReviewId,subs]);
 const pending=subs.filter(s=>['pending','scoring'].includes(s.score_status)).length;
 useEffect(()=>{if(!pending)return;const deferred=subs.filter(s=>['pending','scoring'].includes(s.score_status)).every(s=>s.score_retry_at&&Date.parse(s.score_retry_at)>Date.now());const t=setInterval(()=>{if(document.visibilityState==='visible')load(true);},deferred?60000:5000);return()=>clearInterval(t);},[pending,subs,load]);
 const counts=Object.fromEntries(['new','screening','shortlisted','interview','offer','hired','rejected'].map(stage=>[stage,subs.filter(s=>s.stage===stage).length]));
 const visible=subs.filter(s=>filter==='all'||(filter==='upload'||filter==='platform'?s.source===filter:s.stage===filter)).filter(s=>!query.trim()||[s.candidate_ref,s.summary,...s.cv_skills || []].some(v=>String(v || '').toLowerCase().includes(query.trim().toLowerCase()))).sort(sort==='match'?compareHiringCandidates:sort==='newest'?(a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at):(a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
 async function reject(reason_code,note){if(busy)return;setBusy(true);try{const r=await sendFeedback({submission_ids:rejecting.ids,decision:'rejected',reason_code,note});showToast(describeSend(r,'rejected'));setRejecting(null);setSelected(new Set());await load(true);onChanged?.();}catch(e){showToast(e.message);throw e;}finally{setBusy(false);}}
 async function handleFiles(input){
  if(upload)return;setReport(null);setUpload({phase:'Opening files',done:0,total:1});
  const parsed=[],issues=[];
  try {
   const collected=await collectCvFiles([...input]);const files=collected.files,ignored=collected.skipped;
   for(let i=0;i<files.length;i++){
    setUpload({phase:'Reading CVs',done:i,total:files.length});
    try{const text=await extractTextFromFile(files[i]);if(text.trim().length<80)throw Error('Not enough readable text. A scanned PDF needs a text layer.');parsed.push({filename:files[i].name,text,file:files[i]});}catch(e){issues.push({filename:files[i].name,error:e.message,file:files[i]});}
   }
   let result={added:0,skipped:0,errors:[]};
   if(parsed.length)result=await uploadCandidates(postingId,parsed,(done,total)=>setUpload({phase:'Saving CVs and originals',done,total}));
   setReport({added:result.added,skipped:result.skipped,ignored,issues:[...issues,...result.errors]});
   await load(true);onChanged?.();
   showToast(`${result.added} CVs added. Assessments run automatically.`);
  }catch(e){setError(e.message);}finally{setUpload(null);}
 }
 function toggle(id){setSelected(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next;});}
 if(loading)return <div className="emp-loading" role="status">Preparing your candidate workspace…</div>;
 return <div className={`emp-queue ${dragging?'dragging':''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);handleFiles(e.dataTransfer.files);}}>
  <div className="emp-role-stats">{[[subs.length,'Total applicants','01'],[counts.shortlisted,'Shortlisted','02'],[counts.interview,'In interview','03'],[counts.offer,'At offer','04']].map(([value,label,n])=><article key={label}><div><span>{label}</span><small>{n}</small></div><strong>{value}<span>{label==='Total applicants'?' people in your pipeline':''}</span></strong></article>)}</div>
  <section className="emp-import-banner"><span className="emp-import-icon" aria-hidden="true">↥</span><div><h3>Great people. One organised shortlist.</h3><p>Drop a ZIP of CVs or upload individual files. JobCopilot assesses everyone against the same role criteria.</p><small>Up to 50 CVs · ZIP, PDF, DOCX, TXT · 5 MB per CV</small></div><button className="btn primary" disabled={!!upload} onClick={()=>fileRef.current?.click()}>＋ Import CVs</button><input ref={fileRef} type="file" multiple hidden accept=".zip,.pdf,.docx,.txt,.md" onChange={e=>{handleFiles(e.target.files);e.target.value='';}}/></section>
  {error&&<div className="emp-error" role="alert">{error} <button className="btn" onClick={()=>{setError('');load(true);}}>Retry</button></div>}
  {upload&&<div className="emp-progress" role="status"><div className="emp-progress-bar"><span style={{width:`${100*upload.done/Math.max(upload.total,1)}%`}}/></div>{upload.phase} · {upload.done} of {upload.total}</div>}
  {report&&<details className="emp-import-report" open><summary>Import complete · {report.added} added · {report.skipped} already present · {report.issues.length} need attention{report.ignored.length?` · ${report.ignored.length} unsupported files skipped`:''}</summary>{report.issues.map((issue,i)=><p key={i}><strong>{issue.filename}</strong> · {issue.error}</p>)}{report.issues.length>0&&<button className="btn" onClick={()=>handleFiles(report.issues.map(i=>i.file))}>Retry these files</button>}</details>}
  <div className="emp-candidates-heading"><div><span className="eyebrow">YOUR TALENT PIPELINE</span><h2>Candidates <span>{subs.length}</span></h2></div><p>Evidence first. Your decision, always.</p></div>
  <div className="emp-stage-tabs" aria-label="Filter applicants by stage">{[['all','All candidates',subs.length],...['new','screening','shortlisted','interview','offer','hired','rejected'].map(s=>[s,STAGE_LABELS[s],counts[s]])].map(([value,label,count])=><button key={value} className={filter===value?'active':''} aria-pressed={filter===value} onClick={()=>{setFilter(value);setSelected(new Set());}}>{label}<span>{count}</span></button>)}</div>
  <div className="emp-search-tools"><label className="emp-search-box"><span aria-hidden="true">⌕</span><input aria-label="Search candidates" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search candidates, skills or evidence…"/></label><select aria-label="Sort candidates" value={sort} onChange={e=>setSort(e.target.value)}><option value="match">Best role match</option><option value="newest">Newest first</option><option value="oldest">Waiting longest</option></select><select aria-label="Candidate source" value={['platform','upload'].includes(filter)?filter:''} onChange={e=>setFilter(e.target.value || 'all')}><option value="">All sources</option><option value="platform">Direct applications</option><option value="upload">CV imports</option></select></div>
  {!criteria.length&&<div className="emp-nudge">Set the role’s screening criteria in Edit to enable match scores. CVs are ready for your review.</div>}
  {pending>0&&<div className="emp-assessment-notice" role="status"><span className="emp-pulse"/>{pending} assessment{pending===1?'':'s'} queued or running. You can open the originals now.{subs.some(s=>s.score_retry_reason==='capacity')?' AI capacity is temporarily full; queued CVs retry automatically.':''}</div>}
  {subs.some(s=>s.score_status==='failed')&&<div className="emp-nudge">Some assessments need a retry. <button className="btn" onClick={async()=>{try{await rescanApplicants(postingId);await load(true);}catch(e){showToast(e.message);}}}>Retry assessments</button></div>}
  {selected.size>0&&<div className="emp-bulk"><strong>{selected.size} selected</strong><button className="btn" disabled={busy} onClick={()=>setReviewing(subs.find(s=>selected.has(s.id)))}>Review selected</button><button className="btn danger" disabled={busy} onClick={()=>setRejecting({ids:[...selected],subs:subs.filter(s=>selected.has(s.id))})}>Reject with a reason</button><button className="btn ghost" onClick={()=>setSelected(new Set())}>Clear</button></div>}
  <div className="emp-candidate-table"><div className="emp-candidate-table-head"><span/><span>Candidate & role evidence</span><span>Role match</span><span>Stage</span><span>Received</span><span>Review</span></div>
   {!visible.length&&<div className="emp-empty"><span className="emp-empty-symbol">⌘</span><h2>{subs.length?'No candidates in this view':'Your next great hire starts here.'}</h2><p>{subs.length?'Try another stage or search term.':'Share the live posting or import a ZIP of CVs. We’ll bring the evidence into one shortlist.'}</p>{!subs.length&&<button className="btn primary" onClick={()=>fileRef.current?.click()}>Import your first CVs</button>}</div>}
   {visible.slice(0,pageSize).map((s,i)=><article className={`emp-candidate-row ${selected.has(s.id)?'selected':''}`} key={s.id}>
    <input type="checkbox" checked={selected.has(s.id)} onChange={()=>toggle(s.id)} aria-label={`Select ${s.candidate_ref}`}/>
    <button className="emp-candidate-identity" onClick={()=>setReviewing(s)}><span className={`emp-avatar tone-${i%4}`}>{s.source==='platform'?'JC':s.candidate_ref.replace(/\.[^.]+$/,'').split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}</span><span><strong>{s.candidate_ref}</strong><small>{s.source==='upload'?'CV import':'Direct application'} · {STAGE_LABELS[s.stage]}{s.country?` · ${cap(s.country)}`:''}</small><span className="emp-candidate-summary">{s.summary || 'Assessment queued. Open the original CV to begin your review.'}</span></span></button>
    <div className="emp-match-cell"><Score value={s.assessment?.method==='semantic_role_match'?s.match_score:null} status={s.score_status}/><small>{s.assessment?.method==='semantic_role_match'?'documented fit':'not yet assessed'}</small>{s.match_score!=null&&s.assessment?.method==='semantic_role_match'&&<span className="emp-match-track"><span style={{width:`${s.match_score}%`}}/></span>}</div>
    <div><span className={`emp-stage st-${s.stage}`}>{STAGE_LABELS[s.stage]}</span></div><time dateTime={s.created_at}>{ago(s.created_at)}</time><button className="emp-review-arrow" onClick={()=>setReviewing(s)} aria-label={`Review ${s.candidate_ref}`}>↗</button>
   </article>)}
  </div>{visible.length>pageSize&&<button className="btn emp-more-candidates" onClick={()=>setPageSize(n=>n+50)}>Show more candidates ({visible.length-pageSize} remaining)</button>}<p className="emp-rank-note">Ranked by evidence against your required and preferred criteria. A match score is not a prediction of performance. Review the CV before deciding.</p>
  {reviewing&&<ReviewDesk submission={subs.find(s=>s.id===reviewing.id) || reviewing} criteria={criteria} onClose={()=>setReviewing(null)} onSaved={()=>{load(true);onChanged?.();}} showToast={showToast}/>}
  {rejecting&&<RejectDialog subs={rejecting.subs} onCancel={()=>setRejecting(null)} onSend={reject}/>}
 </div>;
}
/* -- The reason picker --------------------------------------------------
   Deliberately has no "skip" button. The whole product claim is that people
   hear back with something they can use; an escape hatch here would be
   taken every time, and the claim would quietly stop being true. */
function RejectDialog({ subs, onCancel, onSend }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const count = subs.length;
  const uncontactable = subs.filter((s) => s.source === "upload").length;

  return (
    <div className="emp-modal-backdrop" onClick={onCancel}>
      <div className="emp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Why {count === 1 ? "this person isn't" : `these ${count} aren't`} moving forward</h3>
        <p className="emp-modal-sub">
          They'll see this. Pick the closest reason — it's the difference between a
          rejection someone can learn from and one that teaches them nothing.
        </p>

        {uncontactable > 0 && (
          <div className="emp-warn">
            {uncontactable === count
              ? count === 1
                ? "This CV was uploaded by you, so there's no account here to deliver feedback to. They'll be marked rejected in your queue only."
                : `All ${count} of these were uploaded by you, so there are no accounts here to deliver feedback to. They'll be marked rejected in your queue only.`
              : `${uncontactable} of these ${uncontactable === 1 ? "was" : "were"} uploaded by you and can't be sent feedback — only marked rejected. The other ${count - uncontactable} will hear from you.`}
          </div>
        )}

        <div className="emp-reasons">
          {REASON_OPTIONS.map((o) => (
            <button
              key={o.code}
              className={`emp-reason-opt ${reason === o.code ? "active" : ""}`}
              onClick={() => setReason(o.code)}
            >
              {o.label}
            </button>
          ))}
        </div>

        {reason && <div className="emp-reason-preview">They'll read: "{REASON_LABELS[reason]}"</div>}

        <label className="field">
          <span className="field-label">Anything to add <em>optional, and they'll see it</em></span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={count === 1
              ? "Strong on the data side, but we needed someone who'd shipped Kafka in production."
              : "One line that applies to everyone you're rejecting here."} />
        </label>

        <div className="emp-modal-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!reason || busy} onClick={async () => { setBusy(true); try{await onSend(reason, note);}catch{/* The queue displays the failure and keeps this dialog open. */}finally{setBusy(false);} }}>
            {busy ? "Sending..." : count === 1 ? "Send and reject" : `Send to all ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// A score that hasn't happened yet must not look like a score of zero -
// thirty CVs uploaded at once are all unscored for a minute, and rendering
// them as 0 would read as the product being wrong about thirty people.
function Score({ value, status }) {
  if (status === "pending" || status === "scoring") {
    return <span className="emp-score pending" title="Scanning CV evidence for your screening criteria.">scanning</span>;
  }
  if (status === "failed") {
    return <span className="emp-score none" title="The model couldn't read this CV. Open it to judge yourself.">unranked</span>;
  }
  if (value == null) return <span className="emp-score none" title="Not scored.">—</span>;
  const band = value >= 70 ? "hi" : value >= 45 ? "mid" : "lo";
  return <span className={`emp-score ${band}`}>{value}%</span>;
}

// The API reports how many were actually notified vs merely moved, and the
// toast repeats it exactly. Saying "30 people have been told" when eleven
// of them have no account to be told through is the kind of small lie that
// makes the rest of the product's claims worth less.
function describeSend(r, verb) {
  const sent = r.sent || 0;
  const un = r.uncontactable || 0;
  if (!un) return sent === 1 ? `Done — they've been told.` : `${sent} ${verb} and notified.`;
  if (!sent) return `${un} marked ${verb} in your queue. Uploaded CVs have no account here to notify.`;
  return `${sent} notified · ${un} marked ${verb} only (uploaded, no account to notify).`;
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function ago(iso) {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

