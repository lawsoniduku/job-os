-- ============================================================
-- JobCopilot — Search performance indexes
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run (IF NOT EXISTS). These speed up search as the jobs
-- table grows. No data is changed — indexes only.
--
-- Why each one:
--   role_cluster : the search filters `where role_cluster = '...'` — this
--                  turns a full-table scan into an index lookup.
--   posted_at    : results are effectively recency-biased; lets Postgres
--                  order/limit by date without sorting the whole table.
--   apply_url    : the ingestion upsert uses onConflict: "apply_url"; a
--                  unique index makes dedup-on-insert fast (and correct).
--   title trigram: the search also does `title ILIKE '%kw%'`. A normal index
--                  can't help a leading-wildcard LIKE, but a trigram (GIN)
--                  index can. Requires the pg_trgm extension.
-- ============================================================

-- enable trigram matching (for ILIKE '%...%' on title)
create extension if not exists pg_trgm;

create index if not exists jobs_role_cluster_idx
  on public.jobs (role_cluster);

create index if not exists jobs_posted_at_idx
  on public.jobs (posted_at desc);

-- index on apply_url supports the upsert's onConflict lookup.
-- NOTE: kept as a plain (non-unique) index so it can't fail if the table
-- already contains duplicate apply_url values from earlier runs.
create index if not exists jobs_apply_url_idx
  on public.jobs (apply_url);

-- trigram index makes `title ILIKE '%word%'` fast even with a leading wildcard
create index if not exists jobs_title_trgm_idx
  on public.jobs using gin (title gin_trgm_ops);

-- Optional: if you filter by eligibility_region anywhere, this helps too.
create index if not exists jobs_eligibility_region_idx
  on public.jobs (eligibility_region);

-- ============================================================
-- After running, the first search may still be ~normal speed while
-- Postgres warms its caches, then subsequent searches should be noticeably
-- faster. Indexes help most as the table keeps growing.
-- ============================================================
