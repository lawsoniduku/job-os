-- ============================================================
-- 007 — JOB REPORTS (the trust feedback loop)
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- This is the instrument for the guardrail metric: the % of shown
-- jobs users flag as "not actually open to me". Every report is a
-- free QA signal that tells us exactly where the eligibility engine
-- is wrong — the same data that lets us drive false positives < 5%.
--
-- Anonymous reports allowed (user_id nullable) so guests can report
-- too — we want the signal even before signup.
-- ============================================================

create table if not exists public.job_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  job_id      bigint,                       -- may be null if the job is gone
  -- snapshot so the report survives job pruning
  job_title   text,
  company     text,
  -- why the user says it's not open to them
  reason      text not null
    check (reason in ('location','visa','experience','salary','expired','other')),
  detail      text,                          -- optional free text
  -- what the engine believed at report time (for triage)
  verdict     text,
  user_country text,
  created_at  timestamptz not null default now()
);

create index if not exists job_reports_reason_idx on public.job_reports(reason, created_at desc);
create index if not exists job_reports_job_idx on public.job_reports(job_id);

alter table public.job_reports enable row level security;

-- Anyone (incl. anonymous) may file a report; nobody reads from the client.
-- Triage happens in the Supabase dashboard / SQL editor.
drop policy if exists "job_reports_insert_any" on public.job_reports;
create policy "job_reports_insert_any" on public.job_reports
  for insert with check (true);

-- ============================================================
-- WEEKLY TRIAGE QUERY (run this in SQL editor each week):
--
--   select reason, count(*) as reports,
--          count(distinct job_id) as jobs,
--          count(distinct user_id) as users
--   from public.job_reports
--   where created_at > now() - interval '7 days'
--   group by reason order by reports desc;
--
-- And to find the worst offending jobs:
--   select job_title, company, reason, count(*)
--   from public.job_reports
--   where created_at > now() - interval '7 days'
--   group by job_title, company, reason
--   having count(*) > 1
--   order by count(*) desc;
-- ============================================================

-- ============================================================
-- DONE. Verify: Table Editor shows "job_reports" with RLS badge.
-- ============================================================
