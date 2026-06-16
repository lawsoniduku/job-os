-- ============================================================
-- JobCopilot — User Accounts Migration
-- ============================================================
-- Run this in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE where possible).
--
-- This adds:
--   1. profiles          — one row per user (name, country, etc.)
--   2. saved_cvs         — each user's stored CV text (one per user)
--   3. saved_searches    — search history a user chose to save
--   4. saved_jobs        — bookmarked job postings
--   5. RLS policies       — users can ONLY read/write their OWN rows
--   6. a trigger          — auto-creates a profile row on signup
--
-- IMPORTANT — CHECK THIS BEFORE RUNNING:
--   saved_jobs.job_id must match the type of your existing jobs.id column.
--   To check: Table Editor -> jobs -> click the "id" column -> see its type.
--   Most Supabase tables default to "int8" (bigint) for an auto id, OR "uuid".
--   The line below assumes bigint. If your jobs.id is uuid, change
--   `job_id bigint` to `job_id uuid` in the saved_jobs table definition.
-- ============================================================

-- ── 1. PROFILES ──────────────────────────────────────────────────────────
-- One row per authenticated user, keyed to Supabase's built-in auth.users.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  -- country code matching the keys used by the search engine's
  -- COUNTRY_TERMS map, e.g. "nigeria", "kenya", "india", "us", "uk".
  -- Stored lowercase. NULL = no preference set yet.
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);


-- ── 2. AUTO-CREATE PROFILE ON SIGNUP ────────────────────────────────────
-- When someone signs up via Supabase Auth, automatically create their
-- profiles row so the app never has to handle "profile doesn't exist yet".
-- We also read country + full_name from the signup metadata (raw_user_meta_data),
-- which the frontend passes via supabase.auth.signUp({ options: { data: {...} } }).
-- This runs as SECURITY DEFINER, so it works even before email confirmation
-- (when there is no session and RLS would otherwise block the write).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, country, full_name)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'country', ''),
    nullif(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ── 3. SAVED CVS ─────────────────────────────────────────────────────────
-- One CV per user (overwritten on each save — simplest for now).
create table if not exists public.saved_cvs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cv_text text not null,
  filename text,
  updated_at timestamptz not null default now()
);

alter table public.saved_cvs enable row level security;

drop policy if exists "saved_cvs_select_own" on public.saved_cvs;
create policy "saved_cvs_select_own" on public.saved_cvs
  for select using (auth.uid() = user_id);

drop policy if exists "saved_cvs_upsert_own" on public.saved_cvs;
create policy "saved_cvs_upsert_own" on public.saved_cvs
  for insert with check (auth.uid() = user_id);

drop policy if exists "saved_cvs_update_own" on public.saved_cvs;
create policy "saved_cvs_update_own" on public.saved_cvs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "saved_cvs_delete_own" on public.saved_cvs;
create policy "saved_cvs_delete_own" on public.saved_cvs
  for delete using (auth.uid() = user_id);


-- ── 4. SAVED SEARCHES ────────────────────────────────────────────────────
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  created_at timestamptz not null default now()
);

create index if not exists saved_searches_user_idx on public.saved_searches(user_id, created_at desc);

alter table public.saved_searches enable row level security;

drop policy if exists "saved_searches_select_own" on public.saved_searches;
create policy "saved_searches_select_own" on public.saved_searches
  for select using (auth.uid() = user_id);

drop policy if exists "saved_searches_insert_own" on public.saved_searches;
create policy "saved_searches_insert_own" on public.saved_searches
  for insert with check (auth.uid() = user_id);

drop policy if exists "saved_searches_delete_own" on public.saved_searches;
create policy "saved_searches_delete_own" on public.saved_searches
  for delete using (auth.uid() = user_id);


-- ── 5. SAVED / BOOKMARKED JOBS ───────────────────────────────────────────
-- ⚠️ CHECK jobs.id TYPE BEFORE RUNNING — see note at top of file.
create table if not exists public.saved_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id bigint not null,  -- change to `uuid` if your jobs.id is uuid
  created_at timestamptz not null default now(),
  unique(user_id, job_id)
);

create index if not exists saved_jobs_user_idx on public.saved_jobs(user_id, created_at desc);

alter table public.saved_jobs enable row level security;

drop policy if exists "saved_jobs_select_own" on public.saved_jobs;
create policy "saved_jobs_select_own" on public.saved_jobs
  for select using (auth.uid() = user_id);

drop policy if exists "saved_jobs_insert_own" on public.saved_jobs;
create policy "saved_jobs_insert_own" on public.saved_jobs
  for insert with check (auth.uid() = user_id);

drop policy if exists "saved_jobs_delete_own" on public.saved_jobs;
create policy "saved_jobs_delete_own" on public.saved_jobs
  for delete using (auth.uid() = user_id);


-- ── 6. AUTO-REFRESH updated_at ───────────────────────────────────────────
-- Keep updated_at honest (default now() only sets it on insert).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_profiles on public.profiles;
create trigger touch_profiles before update on public.profiles
  for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_saved_cvs on public.saved_cvs;
create trigger touch_saved_cvs before update on public.saved_cvs
  for each row execute procedure public.touch_updated_at();


-- ============================================================
-- DONE. Verify:
--   Table Editor should now show: profiles, saved_cvs, saved_searches, saved_jobs
--   Each table should show a "RLS enabled" badge.
-- ============================================================
