-- ============================================================
-- 005 — CONVERSATION THREADS
-- ============================================================
-- Stores the Copilot conversation so it survives page refresh.
-- Each thread belongs to one user and holds an ordered array
-- of message objects (role, text, kind, jobs snapshot, etc.)
-- stored as JSONB — no separate messages table needed for V1.
-- ============================================================

create table if not exists public.threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- serialised message array: [{role,text,kind,jobs,...}]
  messages    jsonb not null default '[]'::jsonb,
  -- the last raw query the user ran (powers Briefing feed)
  last_query  text,
  -- the last parsed intent from the engine (cluster, country, etc.)
  last_intent jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists threads_user_idx
  on public.threads(user_id, updated_at desc);

alter table public.threads enable row level security;

drop policy if exists "threads_select_own" on public.threads;
create policy "threads_select_own" on public.threads
  for select using (auth.uid() = user_id);

drop policy if exists "threads_insert_own" on public.threads;
create policy "threads_insert_own" on public.threads
  for insert with check (auth.uid() = user_id);

drop policy if exists "threads_update_own" on public.threads;
create policy "threads_update_own" on public.threads
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "threads_delete_own" on public.threads;
create policy "threads_delete_own" on public.threads
  for delete using (auth.uid() = user_id);

drop trigger if exists touch_threads on public.threads;
create trigger touch_threads before update on public.threads
  for each row execute procedure public.touch_updated_at();

-- ============================================================
-- DONE. Verify: Table Editor shows "threads" with RLS badge.
-- ============================================================
