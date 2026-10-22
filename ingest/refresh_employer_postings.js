// Rebuild existing open employer mirrors using the same normal publication
// writer. Default is read-only. Never deletes applications or external jobs.
import dotenv from 'dotenv';
import {createClient} from '@supabase/supabase-js';
dotenv.config();
const {mirrorToJobs}=await import('../api/employer.js');
const apply=process.argv.includes('--apply');
const appOrigin=process.env.APP_URL;
if(!appOrigin || new URL(appOrigin).protocol!=='https:')throw Error('Set APP_URL to the canonical HTTPS candidate-site origin before refreshing mirrors.');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_KEY);
let after=null,selected=0,updated=0,failed=0;
for(let page=0;page<20;page++) {
 let query=db.from('job_postings').select('*,employer_orgs(name)').eq('status','open').order('id').limit(50);
 if(after)query=query.gt('id',after);
 const {data,error}=await query;if(error)throw error;
 if(!data?.length)break;
 for(const p of data) {
  selected++;
  if(!apply)continue;
  try {
   const jobId=await mirrorToJobs(db,p,p.employer_orgs,p.job_id);
   if(jobId!==p.job_id){const {error:linkError}=await db.from('job_postings').update({job_id:jobId}).eq('id',p.id).eq('org_id',p.org_id).eq('status','open');if(linkError)throw linkError;}
   updated++;
  }catch(e){failed++;console.error('Employer mirror refresh failed:',e.code || 'write_failed');}
 }
 after=data.at(-1).id;
 if(data.length<50)break;
 if(page===19)throw Error('Safety limit reached; remaining employer postings were not scanned.');
}
console.log(JSON.stringify({dry_run:!apply,selected,updated,failed}));
if(failed)process.exitCode=1;
