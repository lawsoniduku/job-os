// Transactional applicant mail. Tests inject fetch; startup never sends without config.
export function emailAddress(value) {
 const s=String(value || '').trim();
 return s.length<=254&&/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(s)?s.toLowerCase():null;
}
export function hiringMailConfig(env=process.env) {
 const key=env.RESEND_API_KEY?.trim() || '',from=(env.HIRING_FROM_ADDRESS || env.DIGEST_FROM_ADDRESS || '').trim();
 const sender=emailAddress(from.match(/<([^<>]+)>$/)?.[1] || from);
 const configured=!!key&&!!sender&&!/[\r\n]/.test(from)&&!sender.endsWith('@resend.dev');
 return {key,from,sender,configured,reason:configured?null:'Recruiter email needs RESEND_API_KEY and HIRING_FROM_ADDRESS on the API, using a verified sending domain.'};
}
const escape=value=>String(value || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ical=value=>String(value || '').replace(/\\/g,'\\\\').replace(/\r?\n|\r/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const stamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
export function foldIcal(line) {
 let out='',current='',bytes=0;
 for(const char of line){const n=Buffer.byteLength(char);if(bytes+n>75){out+=current+'\r\n';current=' ';bytes=1;}current+=char;bytes+=n;}
 return out+current;
}
export function buildInterviewCalendar(message) {
 const p=message.payload,e=p.event,cancel=p.kind==='cancel',organizer=emailAddress(e.organizer_email),attendee=emailAddress(e.attendee_email);
 if(!organizer||!attendee)throw Error('Invalid calendar recipient');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//JobCopilot//Recruiting//EN','CALSCALE:GREGORIAN',`METHOD:${cancel?'CANCEL':'REQUEST'}`,'BEGIN:VEVENT',`UID:${e.id}@jobcopilot.app`,`SEQUENCE:${e.sequence}`,`DTSTAMP:${stamp(message.created_at)}`,`DTSTART:${stamp(e.starts_at)}`,`DTEND:${stamp(e.ends_at)}`,`SUMMARY:${ical(p.company+' · '+p.role+' interview')}`,`DESCRIPTION:${ical([p.note,`Timezone: ${e.timezone}`,`Reply to ${p.reply_to} with questions.`].filter(Boolean).join('\n'))}`,`LOCATION:${ical(e.location)}`,`ORGANIZER;SENT-BY="mailto:${emailAddress(p.from.match(/<([^<>]+)>$/)?.[1] || p.from)}":mailto:${organizer}`,`ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee}`,`STATUS:${cancel?'CANCELLED':'CONFIRMED'}`,'TRANSP:OPAQUE','END:VEVENT','END:VCALENDAR'];
 return lines.map(foldIcal).join('\r\n')+'\r\n';
}
export function buildHiringEmail(message) {
 const p=message.payload,stage=p.stage[0].toUpperCase()+p.stage.slice(1),event=p.event;
 const subject=String(p.kind==='cancel'?`Interview cancelled · ${p.role}`:event?`Interview invitation · ${p.role}`:`Application update · ${p.role}`).replace(/[\r\n]/g,' ').slice(0,250);
 const detail=event?`Your interview with ${p.company} for ${p.role} ${p.kind==='cancel'?'has been cancelled.':'is scheduled for '+new Date(event.starts_at).toLocaleString('en-GB',{timeZone:event.timezone,dateStyle:'full',timeStyle:'short'})+' ('+event.timezone+'). Duration: '+Math.round((Date.parse(event.ends_at)-Date.parse(event.starts_at))/60000)+' minutes.'}`:`Your application for ${p.role} at ${p.company} has moved to ${stage}.`;
 const text=['Hello,',detail,event?.location&&p.kind!=='cancel'?'Location / meeting link: '+event.location:null,p.note||null,event&&p.kind!=='cancel'?'Open the attached calendar invitation to add the interview to your calendar. Your calendar may ask you to accept it.':null,`Questions? Reply to this email to reach ${p.company}'s hiring team.`,'Sent by the hiring team through JobCopilot.'].filter(Boolean).join('\n\n');
 const body={from:p.from,to:[p.to],reply_to:p.reply_to,subject,text,html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:28px;color:#403348"><p style="font-size:12px;color:#8c759d">JOBCOPILOT · HIRING UPDATE</p><h1 style="font-size:23px">${escape(subject)}</h1>${text.split('\n\n').map(line=>`<p style="line-height:1.8">${escape(line)}</p>`).join('')}</div>`};
 if(p.copy_to&&emailAddress(p.copy_to)&&p.copy_to!==p.to)body.cc=[p.copy_to];
 if(event)body.attachments=[{filename:p.kind==='cancel'?'interview-cancelled.ics':'interview.ics',content:Buffer.from(buildInterviewCalendar(message)).toString('base64'),content_type:`text/calendar; charset=utf-8; method=${p.kind==='cancel'?'CANCEL':'REQUEST'}`}];
 return body;
}
export async function deliverHiringMessages(db,{config=hiringMailConfig(),fetcher=fetch,limit=20,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 const result={sent:0,failed:0,deferred:0,configured:config.configured};if(!config.configured)return result;
 for(let i=0;i<limit;i++) {
  const {data,error}=await db.rpc('claim_hiring_message',{});if(error)throw error;const row=data?.[0];if(!row)break;
  let patch;
  if(now()-Date.parse(row.first_attempt_at)>23*3600000)patch={status:'failed',last_error:'delivery_uncertain_check_provider'};
  else try {
   const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json','Idempotency-Key':'hiring/'+row.id},body:JSON.stringify(buildHiringEmail(row)),signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Object.assign(Error('provider_rejected'),{status:response.status,retryAfter:response.headers?.get('retry-after')});
   const payload=await response.json();if(typeof payload.id!=='string'||!payload.id)throw Error('invalid_provider_receipt');
   patch={status:'sent',provider_id:payload.id,sent_at:new Date(now()).toISOString(),last_error:null};result.sent++;
  }catch(e) {
   const retry=(!e.status||e.status===429||e.status>=500)&&row.attempts<4;
   const retryHeader=Number(e.retryAfter),delay=Math.max(60000*3**Math.min(row.attempts,4),Number.isFinite(retryHeader)?retryHeader*1000:0);
   patch={status:retry?'queued':'failed',next_attempt_at:new Date(now()+Math.min(delay,22*3600000)).toISOString(),last_error:e.status?'provider_http_'+e.status:'delivery_temporarily_unavailable'};
   if(retry)result.deferred++;else result.failed++;
  }
  const {error:save}=await db.from('hiring_messages').update({...patch,claim_token:null,claimed_at:null}).eq('id',row.id).eq('org_id',row.org_id).eq('claim_token',row.claim_token);
  if(save)throw save; // A lost acknowledgement keeps the lease recoverable with the same key.
  if(patch.last_error==='delivery_uncertain_check_provider')result.failed++;
  if(i+1<limit)await sleep(600);
 }
 return result;
}
export function startHiringMailRecovery(db) {
 let active=false;
 const run=async()=>{if(active||!hiringMailConfig().configured)return;active=true;try{const r=await deliverHiringMessages(db);if(r.sent||r.failed||r.deferred)console.log('[hiring-mail]',JSON.stringify(r));}catch(e){console.error('[hiring-mail]',e.code || 'delivery_worker_error');}finally{active=false;}};
 void run();const timer=setInterval(run,30000);timer.unref?.();return()=>clearInterval(timer);
}
