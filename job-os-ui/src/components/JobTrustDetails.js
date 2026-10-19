import { createElement as h } from 'react';
import { inferenceAudit, jobTrust } from '../lib/eligibility.js';

// Plain text only: employer/model strings are never interpreted as HTML.
export function JobTrustDetails({ job, trust = jobTrust(job) }) {
  const { eligibility, availability } = trust;
  const audit = inferenceAudit(job);
  return h('div', { className: 'jc-trust-details' },
    h('p', { className: 'jc-trust-why' },
      h('strong', null, eligibility.level === 'possible' ? 'Why unconfirmed: ' : 'Eligibility: '), eligibility.reason),
    h('div', { className: 'jc-availability' },
      h('span', { className: `availability ${availability.key}`, title: availability.reason }, `Availability: ${availability.label}`),
      h('span', { className: 'jc-availability-reason' }, availability.reason)),
    audit && h('div', { className: 'jc-model-evidence' },
      h('span', null, 'Model evidence from the posting:'),
      h('blockquote', null, `“${audit.evidence}”`),
      h('small', null, audit.model || 'Model not recorded', ' · ',
        audit.at ? h('time', { dateTime: audit.at }, new Date(audit.at).toISOString()) : 'Check time not recorded')));
}
