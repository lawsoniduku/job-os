-- ============================================================
-- 010 — JOB LIVENESS (is this listing still real?)
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- WHY: the product promise is "every job you see here, you can actually
-- get". The eligibility engine answers "is this open to me?" — but nothing
-- answered "does this still exist?". That gap is the single most-reported
-- failure: of the first 10 user reports in job_reports, 5 were reason
-- 'expired'. One of them (HR Generalist @ ineventapp) was independently
-- confirmed as a 404 and was STILL being served afterwards, because nothing
-- read the reports table and nothing ever checked a link.
--
-- A dead link is a 100% waste of the user's time and the most visceral way
-- to break trust — worse than a mis-scored match, because there is nothing
-- to salvage at the other end.
--
-- link_status semantics:
--   'ok'      last check reached a live posting
--   'dead'    404/410, or a 200 whose body says the posting is closed
--   'unknown' we could not tell (403 bot-block, 429, 5xx, timeout, DNS).
--             DELIBERATELY not treated as dead — many ATS platforms block
--             automated requests, and hiding a real job because Cloudflare
--             challenged our crawler would be its own trust failure.
--   NULL      never checked yet (treated as visible, same as 'unknown')
-- ============================================================

alter table public.jobs
  add column if not exists link_status text,
  add column if not exists link_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_link_status_check'
  ) then
    alter table public.jobs
      add constraint jobs_link_status_check
      check (link_status is null or link_status in ('ok','dead','unknown'));
  end if;
end $$;

-- Search filters on this on every query: "not dead".
create index if not exists jobs_link_status_idx
  on public.jobs (link_status) where link_status is not null;

-- The checker picks the least-recently-checked rows first.
create index if not exists jobs_link_checked_at_idx
  on public.jobs (link_checked_at nulls first);

-- Verify:
--   select link_status, count(*) from public.jobs group by 1 order by 2 desc;
