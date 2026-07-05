-- ============================================================
-- 008 — EMPLOYER WAITLIST (demand signal for HiringCopilot)
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- The "Hire talent" CTA on the landing page captures employer interest
-- long before HiringCopilot is built. This is one of the three gates
-- for starting the employer product (Sprint 8): >= 25 waitlisted
-- employers. Every row here is real demand data.
-- ============================================================

create table if not exists public.employer_waitlist (
  id           uuid primary key default gen_random_uuid(),
  company      text,
  email        text not null,
  name         text,
  roles_hiring text,                        -- free text: what they want to hire
  company_size text,
  created_at   timestamptz not null default now()
);

create index if not exists employer_waitlist_email_idx on public.employer_waitlist(email);

alter table public.employer_waitlist enable row level security;

-- Anyone may join the waitlist; nobody reads it from the client.
drop policy if exists "employer_waitlist_insert_any" on public.employer_waitlist;
create policy "employer_waitlist_insert_any" on public.employer_waitlist
  for insert with check (true);

-- ============================================================
-- Check signups:  select count(*), max(created_at) from public.employer_waitlist;
-- The Sprint 8 gate:  >= 25 rows here + >= 500 candidate profiles + trust green
-- ============================================================
