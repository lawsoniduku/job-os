export function createJobhiveWriter(supabase, { dryRun = false, repairMode = false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  // Postgres/PostgREST error messages that mean "this DATA is malformed" —
  // retrying the exact same batch will fail identically every time. Better to
  // isolate which single row is bad and skip just that one, keeping the rest
  // of the batch instead of losing it all to one problem row.
  const DATA_ERROR_PATTERNS = [
    "invalid input syntax", "violates not-null constraint", "violates check constraint",
    "value too long", "invalid byte sequence", "violates foreign key constraint",
  ];
  function isDataError(message = "") {
    const m = message.toLowerCase();
    return DATA_ERROR_PATTERNS.some((p) => m.includes(p));
  }

  // Insert exactly one row, swallowing (and logging) a data error rather than
  // letting one malformed row block its neighbors. Used only as a fallback
  // when a whole batch fails with a clear data/schema error, not for normal
  // transient network retries.
  async function upsertOneRow(row) {
    try {
      const { error } = await supabase
        .from("jobs")
        .upsert([row], { onConflict: "apply_url", ignoreDuplicates: !repairMode });
      if (error) throw new Error(error.message);
      return true;
    } catch (e) {
      console.log(`  ❌ dropped one malformed row ("${(row.title || "?").slice(0, 40)}"): ${e.message.slice(0, 100)}`);
      return false;
    }
  }

  async function upsertBatch(batch, attempt = 1) {
    if (dryRun || batch.length === 0) return { accepted: batch.length, failedRows: [] };
    try {
      const { error } = await supabase
        .from("jobs")
        // repairMode=false (normal imports): ignoreDuplicates=true — never touch
        //   a row we already have, just add genuinely new ones. Safe, cheap.
        // repairMode=true (one-off fix): ignoreDuplicates=false — a REAL upsert,
        //   overwriting existing rows with freshly computed values (including
        //   the now-correct eligibility_region). This is what actually fixes
        //   historical rows; simply re-running a normal import does nothing to
        //   them because ignoreDuplicates:true silently skips existing apply_urls.
        .upsert(batch, { onConflict: "apply_url", ignoreDuplicates: !repairMode });
      if (error) throw new Error(error.message);
      return { accepted: batch.length, failedRows: [] };
    } catch (e) {
      if (isDataError(e.message) && batch.length > 1) {
        // Don't burn retries on data that will never become valid. Isolate:
        // insert one row at a time so only the actually-bad row(s) get
        // dropped, instead of losing the whole batch to one problem row.
        console.log(`  ⚠️  Batch has malformed data (${e.message.slice(0, 80)}) — isolating row-by-row...`);
        let accepted = 0;
        const failedRows = [];
        for (const row of batch) {
          const ok = await upsertOneRow(row);
          if (ok) accepted++; else failedRows.push(row);
        }
        return { accepted, failedRows };
      }
      // Retry transient write failures with bounded backoff.
      if (attempt < 5) { await sleep(2000 * attempt); return upsertBatch(batch, attempt + 1); }
      console.log(`  ❌ batch failed after ${attempt} tries: ${e.message}`);
      return { accepted: 0, failedRows: batch };
    }
  }

  return upsertBatch;
}
