// The searchable mirror must carry the same declared geography as the public
// posting. Keep the shared engine in charge; do not manufacture a verdict.
export function employerSearchDescription(posting) {
 const countries=(posting.eligible_countries || []).map(c=>String(c).trim()).filter(Boolean);
 if(!countries.length)return posting.description || '';
 const global=countries.some(c=>/^(worldwide|global|anywhere|all countries)$/i.test(c));
 const scope=global?'Hiring worldwide. Candidates may work from anywhere in the world.'
   :`Hiring candidates from ${countries.join(' or ')} only.`;
 return [posting.description,'EMPLOYER-DECLARED HIRING LOCATIONS\n'+scope].filter(Boolean).join('\n\n');
}
