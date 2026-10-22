import {Router} from 'express';
import {hiringMailConfig,emailAddress,deliverHiringMessages} from './hiringMail.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeHiringAction(body,{config,recipient,organizer,source,now=Date.now()}) {
 if(!['advance','interview','cancel'].includes(body?.kind))throw Error('Choose advance, schedule interview or cancel interview.');
 const email=source==='platform'?recipient:emailAddress(body.email || recipient);
 if(!email)throw Error('Confirm a valid candidate email before sending.');
 if(!emailAddress(organizer))throw Error('Your recruiter account needs an email to receive replies.');
 if(body.note!=null&&(typeof body.note!=='string'||body.note.length>2000))throw Error('Candidate message must be 2,000 characters or fewer.');
 const action={kind:body.kind,email,email_confirmed:source==='platform'||body.email_confirmed===true,note:body.note?.trim() || '',from:config.from,organizer_email:organizer,reply_to:organizer,copy_to:body.copy_me===true?organizer:null};
 if(body.kind==='interview') {
  const start=Date.parse(body.starts_at),duration=Number(body.duration_minutes);
  if(!Number.isFinite(start)||start<=now||start>now+366*86400000||!Number.isInteger(duration)||duration<15||duration>180)throw Error('Choose a future interview time and a duration from 15 to 180 minutes.');
  try{new Intl.DateTimeFormat('en',{timeZone:body.timezone}).format();}catch{throw Error('Choose a valid interview timezone.');}
  if(typeof body.timezone!=='string'||!body.timezone)throw Error('An interview timezone is required.');
  const location=typeof body.location==='string'?body.location.trim():'';
  if(!location||location.length>500||/[\r\n\u0000]/.test(location))throw Error('Add a meeting link or location, at most 500 characters.');
  if(/^\w+:\/\//.test(location)&&!location.startsWith('https://'))throw Error('Use a secure HTTPS meeting link.');
  Object.assign(action,{starts_at:new Date(start).toISOString(),duration_minutes:duration,timezone:body.timezone,location});
 }
 if(body.interview_id){if(!uuid.test(body.interview_id))throw Error('Invalid interview.');action.interview_id=body.interview_id;}
 if(body.kind==='cancel'&&!action.interview_id)throw Error('Choose the interview to cancel.');
 return action;
}
export function hiringCommunicationsRouter({supabase,requireAuth,requireEmployer,searchLimit,mailConfig=hiringMailConfig,dispatch=()=>{}}) {
 const r=Router(),scoped=[requireAuth,requireEmployer];
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 const submission=async req=>{
  if(!uuid.test(req.params.id))return null;
  const {data,error}=await supabase.from('posting_submissions').select('id,org_id,candidate_id,source,applicant_email,stage,updated_at').eq('id',req.params.id).eq('org_id',req.orgId).maybeSingle();if(error)throw error;return data;
 };
 async function contact(s) {
  const {data,error}=await supabase.from('hiring_contacts').select('email').eq('submission_id',s.id).eq('org_id',s.org_id).maybeSingle();if(error)throw error;
  if(data)return data.email;
  if(s.source==='platform') {
   const {data:account,error}=await supabase.auth.admin.getUserById(s.candidate_id);if(error)throw error;
   const email=emailAddress(account?.user?.email);
   if(email){const {error:write}=await supabase.from('hiring_contacts').insert({submission_id:s.id,org_id:s.org_id,email,confirmed_by:s.candidate_id});if(write&&write.code!=='23505')throw write;return email;}
  }
  return null;
 }
 r.get('/employer/communications/status',...scoped,wrap(async(_req,res)=>{const c=mailConfig();res.json({configured:c.configured,reason:c.reason});}));
 r.get('/employer/submissions/:id/communications',...scoped,wrap(async(req,res)=>{
  const s=await submission(req);if(!s)return res.status(404).json({error:'Applicant not found.'});
  const [contacts,messages,interviews]=await Promise.all([
   supabase.from('hiring_contacts').select('email,confirmed_at').eq('submission_id',s.id).eq('org_id',req.orgId).maybeSingle(),
   supabase.from('hiring_messages').select('id,status,created_at,sent_at,last_error,provider_id').eq('submission_id',s.id).eq('org_id',req.orgId).order('created_at',{ascending:false}).limit(30),
   supabase.from('hiring_interviews').select('id,starts_at,ends_at,timezone,location,status').eq('submission_id',s.id).eq('org_id',req.orgId).order('starts_at',{ascending:false}).limit(30),
  ]);if(contacts.error||messages.error||interviews.error)throw contacts.error||messages.error||interviews.error;
  res.set('Cache-Control','no-store').json({source:s.source,email:s.source==='upload'?(contacts.data?.email || s.applicant_email || ''):null,email_confirmed:!!contacts.data,messages:messages.data,interviews:interviews.data,mail:{configured:mailConfig().configured,reason:mailConfig().reason}});
 }));
 r.post('/employer/submissions/:id/communicate',...scoped,searchLimit,wrap(async(req,res)=>{
  const config=mailConfig();if(!config.configured)return res.status(503).json({error:config.reason,code:'mail_not_configured'});
  const s=await submission(req);if(!s)return res.status(404).json({error:'Applicant not found.'});
  if(!uuid.test(req.body?.request_id)||!Number.isFinite(Date.parse(req.body?.expected_updated_at)))return res.status(400).json({error:'Reload the candidate before sending.'});
  let action;try{action=normalizeHiringAction(req.body,{config,source:s.source,recipient:await contact(s),organizer:emailAddress(req.user.email)});}catch(e){return res.status(400).json({error:e.message});}
  const {data,error}=await supabase.rpc('queue_hiring_action',{p_org:req.orgId,p_actor:req.user.id,p_submission:s.id,p_expected:req.body.expected_updated_at,p_request:req.body.request_id,p_action:action});
  if(error)return res.status(error.code==='40001'?409:error.code==='P0002'?404:['23514','42501'].includes(error.code)?400:503).json({error:error.code==='40001'?'This application changed. Reload before sending.':error.code==='23514'?error.message:'Could not queue this action. Reload and retry.'});
  void dispatch();res.status(202).json(data?.[0]?.queue_hiring_action || data);
 }));
 r.post('/employer/messages/:id/retry',...scoped,searchLimit,wrap(async(req,res)=>{
  if(!mailConfig().configured)return res.status(503).json({error:mailConfig().reason});
  if(!uuid.test(req.params.id))return res.status(404).json({error:'Message not found.'});
  const {data:m,error}=await supabase.from('hiring_messages').select('id,status,first_attempt_at,last_error').eq('id',req.params.id).eq('org_id',req.orgId).maybeSingle();if(error)throw error;
  if(!m)return res.status(404).json({error:'Message not found.'});
  if(m.status!=='failed'||m.last_error==='superseded_by_calendar_update'||Date.now()-Date.parse(m.first_attempt_at)>23*3600000)return res.status(409).json({error:'Check the delivery record with your email provider before sending another message.'});
  const {error:write}=await supabase.from('hiring_messages').update({status:'queued',attempts:0,next_attempt_at:new Date().toISOString(),claim_token:null,claimed_at:null}).eq('id',m.id).eq('org_id',req.orgId).eq('status','failed');if(write)throw write;
  void dispatch();res.status(202).json({queued:true});
 }));
 r.use((e,_req,res,next)=>{if(res.headersSent)return next(e);console.error('[hiring-communications]',e.code || 'request_failed');res.status(503).json({error:'Could not load or save candidate communication. Please retry.'});});
 return r;
}
let delivering=null;
export function dispatchHiringMail(db){if(!delivering)delivering=deliverHiringMessages(db).catch(e=>console.error('[hiring-mail]',e.code || 'delivery_failed')).finally(()=>{delivering=null;});return delivering;}
