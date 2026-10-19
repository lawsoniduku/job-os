import {availabilityOf,eligibilityConfidence} from '../../shared/jobTrust.js';
const escapeHtml=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function digestLinks({siteUrl='https://job-os-tau.vercel.app',apiUrl='https://job-os-z27v.onrender.com',unsubscribeToken}={}){
 const site=new URL(siteUrl),api=new URL(apiUrl);
 if(site.protocol!=='https:'||api.protocol!=='https:'||site.username||site.password||api.username||api.password)throw Error('Digest site/API URLs must be HTTPS origins without credentials');
 const unsubscribe=new URL('/digest/unsubscribe',api);
 unsubscribe.searchParams.set('token',String(unsubscribeToken||''));
 return {site:new URL('/',site).href,unsubscribe:unsubscribe.href};
}
export function buildDigestEmail({jobs,unsubscribeToken,siteUrl,apiUrl,now=Date.now()}){
 const links=digestLinks({siteUrl,apiUrl,unsubscribeToken});
 const groups=new Map();
 for(const job of jobs){const cluster=job.role_cluster||'Other';if(!groups.has(cluster))groups.set(cluster,[]);groups.get(cluster).push(job);}
 const sections=[...groups].sort((a,b)=>b[1].length-a[1].length).map(([cluster,list])=>{
  const rows=list.map(job=>`<tr><td style="padding:8px 0;border-bottom:1px solid #eee;">
   <a href="${escapeHtml(job.apply_url)}" style="color:#2563eb;font-weight:600;">${escapeHtml(job.title)}</a>
   <div style="color:#666;font-size:13px;">${escapeHtml(job.company||'')} · ${escapeHtml(job.location||job.eligibility_region||'')}</div>
   <div style="color:#666;font-size:12px;">Location confidence: ${eligibilityConfidence(job).label}. Availability: ${availabilityOf(job,now).label}.</div>
   <div style="color:#666;font-size:12px;">${escapeHtml(job.eligibility.reason)}</div>
   </td></tr>`).join('');
  return `<h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(cluster)} (${list.length})</h3><table style="width:100%;border-collapse:collapse;">${rows}</table>`;
 }).join('');
 const weekOf=new Date(now).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
 return `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <h1 style="font-size:20px;">${jobs.length} new eligible roles this week</h1>
  <p style="color:#666;">Week of ${weekOf} — recent roles with positive location evidence for your country. Check the posting before applying.</p>
  ${sections||'<p>No new eligible roles matched your preferences this week.</p>'}
  <p style="margin-top:32px;font-size:12px;color:#999;"><a href="${escapeHtml(links.site)}">Open JobCopilot</a> to search anytime.<br>
  <a href="${escapeHtml(links.unsubscribe)}">Unsubscribe</a></p></div>`;
}
