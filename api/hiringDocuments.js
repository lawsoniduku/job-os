import {Router,raw} from 'express';
import {createHash,randomUUID} from 'node:crypto';
export const CV_BUCKET='hiring-cvs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateOriginal(bytes,filename) {
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>5*1024*1024)throw Error('Use a CV file between 1 byte and 5 MB.');
 const name=String(filename || '').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200);
 const ext=name.split('.').at(-1).toLowerCase();
 const mime={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',md:'text/plain'}[ext];
 if(!mime)throw Error('Use PDF, DOCX or TXT for an original CV.');
 if(ext==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw Error('That file is not a PDF.');
 if(ext==='docx'&&bytes.subarray(0,4).toString('hex')!=='504b0304')throw Error('That file is not a DOCX document.');
 if(['txt','md'].includes(ext)&&bytes.includes(0))throw Error('That file is not readable plain text.');
 return {filename:name,mime,ext,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
}
export function hiringDocumentsRouter({supabase,requireAuth,requireEmployer,searchLimit}) {
 const r=Router();
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 const parser=raw({type:'application/octet-stream',limit:'5mb'});
 const lookup=async(req,candidate=false)=>{
  if(!uuid.test(req.params.id))return null;
  const {data,error}=await supabase.from('posting_submissions').select('id,org_id,posting_id,cv_text')
   .eq('id',req.params.id).eq(candidate?'candidate_id':'org_id',candidate?req.user.id:req.orgId).maybeSingle();
  if(error)throw error;return data;
 };
 const upload=candidate=>wrap(async(req,res)=>{
  const s=await lookup(req,candidate);if(!s)return res.status(404).json({error:'Applicant not found.'});
  let file;try{file=validateOriginal(req.body,decodeURIComponent(req.headers['x-cv-filename'] || ''));}catch(e){return res.status(400).json({error:e.message});}
  const {data:old,error:read}=await supabase.from('hiring_documents').select('sha256').eq('submission_id',s.id).eq('org_id',s.org_id).maybeSingle();
  if(read)throw read;
  if(old)return res.status(old.sha256===file.sha256?200:409).json(old.sha256===file.sha256?{stored:true}:{error:'An original CV is already attached to this application.'});
  const path=`${s.org_id}/${s.posting_id}/${s.id}/${randomUUID()}.${file.ext}`;
  const bucket=supabase.storage.from(CV_BUCKET);
  const {error:stored}=await bucket.upload(path,req.body,{contentType:file.mime,upsert:false});
  if(stored)throw stored;
  const {error:saved}=await supabase.from('hiring_documents').insert({submission_id:s.id,org_id:s.org_id,path,filename:file.filename,mime:file.mime,size:file.size,sha256:file.sha256,uploaded_by:req.user.id});
  if(saved){
   await bucket.remove([path]);
   if(saved.code==='23505') {
    const {data:current}=await supabase.from('hiring_documents').select('sha256').eq('submission_id',s.id).eq('org_id',s.org_id).maybeSingle();
    if(current?.sha256===file.sha256)return res.json({stored:true});
    return res.status(409).json({error:'An original CV was attached in another request. Reload this application.'});
   }
   throw saved;
  }
  res.status(201).json({stored:true});
 });
 r.put('/employer/submissions/:id/document',requireAuth,requireEmployer,searchLimit,parser,upload(false));
 r.put('/candidate/submissions/:id/document',requireAuth,searchLimit,parser,upload(true));
 r.get('/employer/submissions/:id/document',requireAuth,requireEmployer,wrap(async(req,res)=>{
  const s=await lookup(req);if(!s)return res.status(404).json({error:'Applicant not found.'});
  const {data,error}=await supabase.from('hiring_documents').select('path,filename,mime,sha256').eq('submission_id',s.id).eq('org_id',req.orgId).maybeSingle();
  if(error)throw error;
  res.set('Cache-Control','no-store').set('Referrer-Policy','no-referrer');
  if(!data)return res.json({document:null});
  const {data:signed,error:signError}=await supabase.storage.from(CV_BUCKET).createSignedUrl(data.path,300,data.mime==='application/pdf'?{}:{download:data.filename});
  if(signError)throw signError;
  res.json({document:{url:signed.signedUrl,filename:data.filename,mime:data.mime,sha256:data.sha256,expires_in:300}});
 }));
 r.use((e,_req,res,next)=>{if(res.headersSent)return next(e);console.error('[hiring-document]',e.code || e.type || 'storage_error');res.status(e.type==='entity.too.large'?413:503).json({error:e.type==='entity.too.large'?'CV files must be 5 MB or smaller.':'Could not save or load the original CV. Please retry.'});});
 return r;
}
