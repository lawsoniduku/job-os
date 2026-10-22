// Recruiter tools use only explicit, job-related criteria. Missing CV evidence
// means a question for a person, never an automatic rejection.
export const HIRING_STAGES = ['new','screening','shortlisted','interview','offer','hired','rejected','withdrawn'];
export const ACTIVE_STAGES = HIRING_STAGES.slice(0,5);
const sensitive = /\b(age|aged|gender|sex|female|male|religion|religious|ethnicity|ethnic|race|racial|marital|pregnan\w*|disabilit\w*|sexual|nationality|citizenship|birth|tribe)\b/i;
export function normalizeCriteria(value) {
  if (!Array.isArray(value) || value.length > 12) throw new Error('Use up to 12 job-related screening criteria.');
  return value.map((c,i) => {
    const label = typeof c?.label === 'string' ? c.label.trim().replace(/\s+/g,' ') : '';
    if (label.length < 2 || label.length > 120) throw new Error('Each criterion needs 2–120 characters.');
    if (sensitive.test(label)) throw new Error('Screen on job skills and responsibilities. Record hiring locations separately.');
    if (!['required','preferred'].includes(c.importance)) throw new Error('Choose required or preferred for each criterion.');
    return {id:`criterion_${i+1}`,label,importance:c.importance};
  });
}
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const aliases = {postgresql:['postgresql','postgres'],javascript:['javascript','js'],typescript:['typescript','ts'],'microsoft excel':['microsoft excel','excel'],'customer service':['customer service','customer support']};
export function scanCriteria(cvText, criteria = []) {
  const lines = String(cvText || '').split(/\n|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
  return normalizeCriteria(criteria).map(c => {
    const terms = aliases[normalize(c.label)] || [normalize(c.label)];
    const patterns = terms.map(t=>new RegExp(`(^|[^\\p{L}\\p{N}])${escape(t)}(?=$|[^\\p{L}\\p{N}])`,'u'));
    const evidence = lines.find(line=>patterns.some(p=>p.test(normalize(line))));
    // A quote must be complete enough to inspect. Never fabricate an excerpt
    // around a term beyond the retained range.
    const quote = evidence && evidence.length <= 700 ? evidence : null;
    return {...c,status:quote?'mentioned':'needs_review',evidence:quote};
  });
}
export function validateReview(input = {}) {
  const out = {};
  if ('stage' in input) {
    if (!ACTIVE_STAGES.includes(input.stage)) throw new Error('Use the decision controls to hire or reject a candidate.');
    out.stage=input.stage;
  }
  if ('note' in input) {
    if (typeof input.note !== 'string' || input.note.trim().length > 4000) throw new Error('Notes must be at most 4,000 characters.');
    out.note=input.note.trim();
  }
  if ('next_action' in input) {
    if (typeof input.next_action !== 'string' || input.next_action.trim().length > 300) throw new Error('Next step must be at most 300 characters.');
    out.next_action=input.next_action.trim();
    const due=input.due_at;
    if (due && !Number.isFinite(Date.parse(due))) throw new Error('Choose a valid due date.');
    out.due_at=out.next_action && due ? new Date(due).toISOString() : null;
  }
  if ('scorecard' in input) {
    const card=input.scorecard;
    if (!card || !['strong_yes','yes','undecided','no','strong_no'].includes(card.recommendation)) throw new Error('Choose a scorecard recommendation.');
    if (!Array.isArray(card.ratings) || card.ratings.length>12) throw new Error('Invalid scorecard ratings.');
    out.scorecard={recommendation:card.recommendation,ratings:card.ratings.map(r=>{
      if (typeof r.criterion_id!=='string' || ![null,1,2,3,4].includes(r.rating)) throw new Error('Rate each criterion from 1–4 or leave it unassessed.');
      return {criterion_id:r.criterion_id,rating:r.rating};
    })};
  }
  if (!Object.keys(out).length) throw new Error('Add a note, scorecard or next step.');
  return out;
}
export function hiringMetrics(rows, now=Date.now()) {
  const stages=Object.fromEntries(HIRING_STAGES.map(s=>[s,0]));
  let overdue=0,waiting=0,unreviewed=0;
  for (const r of rows) {
    if(r.stage in stages)stages[r.stage]++;
    if (!ACTIVE_STAGES.includes(r.stage)) continue;
    if (r.stage==='new')unreviewed++;
    if (now-Date.parse(r.stage_entered_at || r.created_at)>7*86400000)waiting++;
    if (r.review?.next_action && Date.parse(r.review.due_at)<now)overdue++;
  }
  return {total:rows.length,stages,overdue,waiting,unreviewed};
}
