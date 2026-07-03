-- 003b_prune_execute.sql
-- ======================
-- THE ACTUAL DELETE. Run this ONLY after:
--   1. 003_prune_stale.sql has been run (column added + backfilled)
--   2. The pipeline has run AT LEAST ONCE since, stamping live jobs fresh
--      (you should see "🕒 last_seen refreshed: [thousands]" — NOT 0)
--
-- ⚠️ This permanently deletes rows. PREVIEW FIRST (query below), then delete.

-- ── STEP 1: PREVIEW — how many would be deleted, and a sample. Run this alone first.
-- SELECT count(*) FROM public.jobs WHERE last_seen_at < now() - interval '45 days';
--
-- SELECT title, company, source, last_seen_at
--   FROM public.jobs
--   WHERE last_seen_at < now() - interval '45 days'
--   ORDER BY last_seen_at ASC
--   LIMIT 25;

-- ── STEP 2: DELETE — only run once the preview count looks right.
-- Uses a 45-day window: a job not seen in any feed for 45 days is treated as gone.
-- Adjust the interval if you want a tighter (30d) or looser (60d) window.

DELETE FROM public.jobs
  WHERE last_seen_at < now() - interval '45 days';

-- ── STEP 3: verify what's left
-- SELECT count(*) AS remaining FROM public.jobs;
