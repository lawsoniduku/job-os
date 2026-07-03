-- 003_prune_stale.sql
-- ===================
-- Adds last_seen_at tracking so stale jobs (no longer in any feed) can be pruned.
--
-- SAFE ROLLOUT — this file ONLY sets up the column. It does NOT delete anything.
-- Deletion happens later, manually, AFTER the pipeline has run at least once to
-- stamp fresh timestamps. See STALE_PRUNE_STEPS.txt for the ordered process.

-- 1. Add the column if it doesn't exist.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- 2. Backfill: give every EXISTING row a last_seen_at so nothing is instantly
--    "stale". We seed with created_at when available, else now(). This means
--    old rows start the clock from their creation date — a job created 90 days
--    ago and never re-seen will already be prune-eligible, which is correct.
UPDATE public.jobs
  SET last_seen_at = COALESCE(created_at, now())
  WHERE last_seen_at IS NULL;

-- 3. Index so the nightly prune query is fast.
CREATE INDEX IF NOT EXISTS idx_jobs_last_seen_at ON public.jobs (last_seen_at);

-- Verify:
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE last_seen_at < now() - interval '60 days') AS stale_60d
--   FROM public.jobs;
