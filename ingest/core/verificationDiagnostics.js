// Read-only summaries of observations already made by the scheduled checker.
export function recordVerificationSummary(summary, row, verification) {
  const key = [row.source || 'unknown', row.ats_source || 'unspecified'].join('/');
  const group = summary[key] ||= {checked:0,ok:0,dead:0,unknown:0,reasons:{}};
  const status = ['ok','dead'].includes(verification.status) ? verification.status : 'unknown';
  group.checked++;
  group[status]++;
  if(status==='unknown') {
    const reason=verification.reason || 'No diagnostic reason recorded';
    group.reasons[reason]=(group.reasons[reason] || 0)+1;
  }
  return summary;
}
export function printVerificationSummary(summary, log=console.log) {
  for(const [source,group] of Object.entries(summary).sort(([a],[b])=>a.localeCompare(b))) {
    const share=group.checked?group.unknown/group.checked:0;
    log(`${source}: ${group.checked} checked; ${group.ok} verified; ${group.dead} closed; ${group.unknown} unverified (${(share*100).toFixed(1)}%)`);
    for(const [reason,count] of Object.entries(group.reasons).sort((a,b)=>b[1]-a[1])) log(`  ${count}: ${reason}`);
    if(share>0.3) log('  ABOVE 30% UNVERIFIED: investigate these reasons; uncertainty is retained. See docs/availability-trust.md.');
  }
}
