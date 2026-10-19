import { eligibilityConfidence } from '../../../shared/jobTrust.js';

// Keep persisted verdict keys backward compatible; labels describe confidence.
export function verdictOf(job) {
  const {key, label} = eligibilityConfidence(job);
  return {key, label};
}
export { availabilityOf, jobTrust, inferenceAudit } from '../../../shared/jobTrust.js';
