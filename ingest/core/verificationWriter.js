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
      const payload = {
        elig_signals: { ...(row.elig_signals || {}), verification: row.verification },
        link_status: row.status,
        link_checked_at: now(),
      };
      let success = false;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const { error } = await db.from('jobs').update(payload).eq('id', row.id);
          if (error) throw new Error(error.message);
          success = true;
          break;
        } catch {
          if (attempt < attempts) await sleep(1500 * attempt);
        }
      }
      if (success) saved++;
      else failedIds.push(row.id);
    }
  }));
  return { saved, failedIds };
}
