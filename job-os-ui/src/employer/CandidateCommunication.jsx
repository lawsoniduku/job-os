import {useState,useEffect,useRef} from 'react';
import {getCandidateCommunications,communicateCandidate,retryCandidateEmail,STAGE_LABELS} from '../lib/employerApi';
const stages=['new','screening','shortlisted','interview','offer','hired'];
export default function CandidateCommunication({submission,stage,updatedAt,onSent,showToast}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[mode,setMode]=useState('advance');
 const [email,setEmail]=useState(''),[confirmed,setConfirmed]=useState(false),[note,setNote]=useState(''),[copy,setCopy]=useState(true);
 const [when,setWhen]=useState(''),[duration,setDuration]=useState(30),[location,setLocation]=useState('');
 const [now,setNow]=useState(Date.now);
 const intent=useRef(null),timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 useEffect(()=>{let cancelled=false;getCandidateCommunications(submission.id).then(r=>{if(!cancelled){setNow(Date.now());setData(r);setEmail(r.email || '');setConfirmed(r.email_confirmed);}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[submission.id]);
 const waiting=data?.messages?.some(m=>['queued','sending'].includes(m.status));
 useEffect(()=>{if(!waiting)return;let cancelled=false;const timer=setInterval(()=>getCandidateCommunications(submission.id).then(r=>{if(!cancelled)setData(r);}).catch(e=>{if(!cancelled)setError(e.message);}),4000);return()=>{cancelled=true;clearInterval(timer);};},[waiting,submission.id]);
 async function refresh(){setNow(Date.now());setData(await getCandidateCommunications(submission.id));}
 async function send(kind,eventId){
  if(busy)return;
  if(submission.source==='upload'&&(!email||!confirmed)){setError('Check and confirm this candidate’s email before sending.');return;}
  const action={kind,email,email_confirmed:confirmed,note,copy_me:copy};
  if(kind==='interview'){
   const date=new Date(when);if(!when||!Number.isFinite(date.getTime())){setError('Choose an interview date and time.');return;}
   Object.assign(action,{starts_at:date.toISOString(),duration_minutes:Number(duration),timezone,location});
  }
  if(eventId)action.interview_id=eventId;
  const key=JSON.stringify(action);
  if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()};
  setBusy(true);setError('');
  try{
   await communicateCandidate(submission.id,{...action,request_id:intent.current.id,expected_updated_at:updatedAt});
   intent.current=null;setNote('');await Promise.all([refresh(),onSent()]);showToast(kind==='cancel'?'Cancellation queued.':kind==='interview'?'Interview and calendar invitation queued.':'Next stage saved. Candidate email queued.');
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const event=data?.interviews?.find(i=>i.status==='scheduled'&&Date.parse(i.ends_at)>now);
 const next=stages[stages.indexOf(stage)+1],final=['hired','rejected','withdrawn'].includes(stage);
 return <section className="emp-communication"><span className="eyebrow">A GREAT CANDIDATE EXPERIENCE</span><h3>Move the conversation forward.</h3>
  {error&&<div className="emp-error" role="alert">{error}</div>}
  {!data&&!error&&<p className="field-hint">Loading candidate communication…</p>}
  {data&&<>
   {!data.mail.configured&&<p className="emp-nudge">Candidate email is not configured yet. An administrator must add the email provider and verified sender to the API. Stage-only updates remain available below.</p>}
   <div className="emp-communication-options"><button type="button" className={mode==='advance'?'active':''} onClick={()=>setMode('advance')}>Next stage</button><button type="button" className={mode==='interview'?'active':''} onClick={()=>{setMode('interview');if(event){setLocation(event.location);setDuration(Math.round((Date.parse(event.ends_at)-Date.parse(event.starts_at))/60000));const d=new Date(event.starts_at);setWhen(new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16));}}}>Book interview</button></div>
   {submission.source==='upload'?<><label>Candidate email<input type="email" value={email} onChange={e=>{setEmail(e.target.value);setConfirmed(false);}} placeholder="candidate@example.com" disabled={busy}/></label><label className="emp-checkbox-label"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>I’ve checked this email belongs to this candidate.</label></>:<p className="field-hint">To: the applicant’s account email. Replies come to your recruiter account.</p>}
   {mode==='advance'&&!final&&next&&<div className="emp-next-stage-preview"><span>{STAGE_LABELS[stage]}</span><span>→</span><strong>{STAGE_LABELS[next]}</strong></div>}
   {mode==='interview'&&!final&&<><label>Date & time<input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)} disabled={busy}/></label><p className="field-hint">Times are in {timezone}. The invitation converts to the candidate’s calendar timezone.</p><label>Duration<select value={duration} onChange={e=>setDuration(e.target.value)} disabled={busy}>{[15,30,45,60,90,120,180].map(n=><option value={n} key={n}>{n} minutes</option>)}</select></label><label>Video link or location<input value={location} maxLength={500} onChange={e=>setLocation(e.target.value)} disabled={busy} placeholder="https://meet.google.com/… or office address"/></label><p className="field-hint">This sends an email with a calendar invitation. It does not check your calendar for conflicts or create a video room.</p></>}
   {!final&&<><label>Message to the candidate <small>optional · they will receive this</small><textarea rows={3} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} disabled={busy} placeholder="What should they prepare? Who will they meet?"/></label><label className="emp-checkbox-label"><input type="checkbox" checked={copy} onChange={e=>setCopy(e.target.checked)} disabled={busy}/>Send me a copy.</label><button type="button" className="btn primary emp-send-next" disabled={busy||!data.mail.configured||!updatedAt||(mode==='advance'&&!next)} onClick={()=>send(mode==='advance'?'advance':'interview',mode==='interview'?event?.id:undefined)}>{busy?'Queueing…':mode==='interview'?event?'Reschedule & send invitation':'Book interview & send invitation':next==='hired'?'Mark hired & email':`Advance to ${STAGE_LABELS[next] || 'next stage'} & email`}</button></>}
   {event&&<article className="emp-scheduled-interview"><strong>Upcoming interview</strong><p>{new Date(event.starts_at).toLocaleString(undefined,{timeZone:event.timezone})} · {event.timezone}</p><p>{event.location}</p><button type="button" className="btn danger" disabled={busy||!data.mail.configured} onClick={()=>send('cancel',event.id)}>Cancel interview & notify candidate</button></article>}
   {!!data.messages.length&&<div className="emp-delivery-list"><h4>Candidate messages</h4>{data.messages.slice(0,6).map(m=><div key={m.id}><span>{m.last_error==='superseded_by_calendar_update'?'Replaced by updated invitation':m.status==='sent'?'Accepted by email provider':m.status==='queued'?'Queued for sending':m.status==='sending'?'Sending…':'Delivery needs attention'}<small>{new Date(m.created_at).toLocaleString()}</small></span>{m.status==='failed'&&m.last_error!=='superseded_by_calendar_update'&&<button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await retryCandidateEmail(m.id);await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}}>Retry</button>}</div>)}</div>}
  </>}
 </section>;
}
