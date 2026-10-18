import { updateJobSignals, mergePostingObservation } from './jobSignalsWriter.js';
// Save each observation atomically: evidence and liveness must agree.
// Separate DB concurrency from outbound posting-check concurrency.
export async function persistVerifications(db, rows, {
  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  concurrency = 4,
  attempts = 4,
  now = () => new Date().toISOString(),
} = {}) {
  const queue = [...rows], failedIds = [];
  let saved = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const row = queue.shift();
      const result = await updateJobSignals(db,row.id,current=>({...current,
        verification:mergePostingObservation(current.verification,row.verification)}), {
        snapshot:{id:row.id,elig_signals:row.elig_signals},attempts,sleep,
        patch:(_latest,signals)=>({link_status:signals.verification.status || row.status,
          link_checked_at:signals.verification.checked_at || now()}),
      });
      const success=result.saved;
      if (success) saved++;
      else failedIds.push(row.id);
    }
  }));
  return { saved, failedIds };
}
