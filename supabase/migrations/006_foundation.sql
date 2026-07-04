-- ============================================================
-- 006 — FOUNDATION (analytics + talent graph + fixes)
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- Four things, each chosen for long-term leverage:
--
--  1. EVENTS — lightweight, privacy-respecting product analytics.
--     No third-party vendor, no cookies, data stays in our Supabase.
--     Powers: funnel analysis (search -> shortlist -> apply), feature
--     usage, drop-off points. Later feeds HiringCopilot demand signals.
--
--  2. SAVED_SEARCHES unique constraint — fixes a real bug: the app
--     upserts on (user_id, query) but no unique index existed.
--
--  3. APPLICATIONS richer stages — the DB now accepts the full
--     lifecycle (interested/saved/cv_tailored/applied/assessment/
--     interview/offer/rejected/archived) while the UI keeps its
--     5-column kanban. Zero refactoring later when the UI grows.
--
--  4. PROFILES talent-graph fields — the seed of the candidate side
--     of the talent graph. HiringCopilot will query these to match
--     employers to candidates. Structured now = no migration pain later.
-- ============================================================

-- ── 1. EVENTS ─────────────────────────────────────────────────
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  name       text not null,            -- e.g. 'search', 'refine', 'shortlist'
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_name_idx on public.events(name, created_at desc);
create index if not exists events_user_idx on public.events(user_id, created_at desc);

alter table public.events enable row level security;

-- Users can insert their own events; nobody can read them from the client.
-- (Reads happen in the Supabase dashboard / SQL editor with the service key.)
drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own" on public.events
  for insert with check (auth.uid() = user_id);

-- ── 2. SAVED_SEARCHES unique (user_id, query) ─────────────────
-- Remove duplicates first (keep the most recent), then add the index.
delete from public.saved_searches a
using public.saved_searches b
where a.user_id = b.user_id
  and a.query   = b.query
  and a.created_at < b.created_at;

create unique index if not exists saved_searches_user_query_uq
  on public.saved_searches(user_id, query);

-- ── 3. APPLICATIONS — richer lifecycle stages ─────────────────
-- The UI maps these into its 5 kanban columns:
--   Shortlist  = interested | saved | shortlist | cv_tailored
--   Applied    = applied
--   In process = assessment | interview | in_process
--   Offer      = offer
--   Closed     = rejected | archived | closed
alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check
  check (status in (
    'interested','saved','shortlist','cv_tailored',
    'applied','assessment','interview','in_process',
    'offer','rejected','archived','closed'
  ));

-- ── 4. PROFILES — talent-graph seed fields ────────────────────
-- All nullable; the product fills them progressively through
-- conversation, never through a giant form.
alter table public.profiles add column if not exists headline           text;
alter table public.profiles add column if not exists years_experience   integer;
alter table public.profiles add column if not exists skills             text[] default '{}';
alter table public.profiles add column if not exists target_roles       text[] default '{}';   -- role clusters
alter table public.profiles add column if not exists target_salary_min  integer;
alter table public.profiles add column if not exists work_authorization jsonb default '{}'::jsonb;
  -- shape: { "citizenship": "nigeria", "residence": "nigeria",
  --          "authorizations": ["nigeria"], "needs_sponsorship": true,
  --          "timezone": "Africa/Lagos" }
alter table public.profiles add column if not exists preferences        jsonb default '{}'::jsonb;
  -- shape: { "remote_only": true, "industries": ["fintech"],
  --          "company_stage": "growth", "employment_types": ["full_time"] }

-- ============================================================
-- DONE. Verify:
--   - Table Editor shows "events" with RLS badge
--   - profiles has the new columns
--   - applications accepts status 'interview' (try an update)
-- ============================================================
