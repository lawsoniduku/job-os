-- ============================================================
-- 015c - EMPLOYER SIDE, PART 3 of 3: RLS, TRIGGERS, PRUNE GUARD
-- ============================================================
-- Run AFTER 015a and 015b. Safe to re-run.
--
-- This is the part that decides who can read what. Read sec 1 before changing
-- anything in it.
-- ============================================================


-- -- 1. THE RULE ----------------------------------------------------------
-- 012 sec 5 established it and this extends it: EMPLOYER TABLES ARE CLOSED TO
-- THE CLIENT. No select policy is written for employer_orgs, job_postings,
-- posting_submissions (employer side) or intro_requests (employer side),
-- because every employer read is authorisation-dependent - "rows for MY
-- org" - and the anon key cannot be trusted to assert which org it belongs
-- to. Those reads run server-side through an endpoint that resolves the org
-- from a verified JWT and filters by it. See api/auth.js and api/employer.js.
--
-- AND NOTE WHAT THAT MEANS FOR THE SERVER. The API process holds a
-- service_role key (verified: SUPABASE_KEY decodes to role=service_role),
-- so RLS does not apply to it at all. The .eq("org_id", ...) in each query IS
-- the access control. There is no second line of defence.
--
-- The only client-side policies below are the CANDIDATE's own rows - the
-- places where the employer side reaches back into the candidate app, and
-- where the frontend already talks to Supabase directly.
alter table public.employer_orgs        enable row level security;
alter table public.employer_members     enable row level security;
alter table public.job_postings         enable row level security;
alter table public.posting_submissions  enable row level security;
alter table public.candidate_feedback   enable row level security;
alter table public.intro_requests       enable row level security;


-- -- 2. CANDIDATE-OWNED READS ---------------------------------------------
-- How the frontend answers "is this account an employer" without a server
-- round-trip. Exposes nothing but org ids the user is already in.
drop policy if exists "employer_members_select_own" on public.employer_members;
create policy "employer_members_select_own" on public.employer_members
  for select using (auth.uid() = user_id);

-- Feedback addressed to them, once it has actually been sent.
drop policy if exists "candidate_feedback_select_own" on public.candidate_feedback;
create policy "candidate_feedback_select_own" on public.candidate_feedback
  for select using (auth.uid() = candidate_id and sent_at is not null);

-- ...and may mark it seen. Postgres policies cannot restrict WHICH columns
-- an UPDATE touches, so the column-level limit is enforced in the app; the
-- with-check clause pins ownership and guarantees an unsent item can never
-- be made visible by the client.
drop policy if exists "candidate_feedback_seen_own" on public.candidate_feedback;
create policy "candidate_feedback_seen_own" on public.candidate_feedback
  for update using (auth.uid() = candidate_id and sent_at is not null)
  with check (auth.uid() = candidate_id and sent_at is not null);

-- Intro requests addressed to them, and their answer. The answer is the
-- consent gate, so it must be the candidate's own write.
drop policy if exists "intro_requests_select_own" on public.intro_requests;
create policy "intro_requests_select_own" on public.intro_requests
  for select using (auth.uid() = candidate_id);

drop policy if exists "intro_requests_respond_own" on public.intro_requests;
create policy "intro_requests_respond_own" on public.intro_requests
  for update using (auth.uid() = candidate_id)
  with check (auth.uid() = candidate_id);

-- Their own submissions, so Pipeline can show "this one is being reviewed"
-- and join through to the feedback. Read only: stage belongs to the employer.
drop policy if exists "posting_submissions_select_own" on public.posting_submissions;
create policy "posting_submissions_select_own" on public.posting_submissions
  for select using (auth.uid() = candidate_id);


-- -- 3. KEEP PRUNE OFF EMPLOYER POSTINGS ----------------------------------
-- ingest/prune_stale.js deleted from `jobs` on last_seen_at alone, with no
-- source filter. An employer's own posting has no feed to refresh it, so it
-- would be deleted 28 days after publishing - the one kind of row on that
-- table we are certain is real. The script now excludes source='employer'
-- via a single stale() helper; this index makes that exclusion cheap, and
-- this comment exists so whoever touches either one finds the other.
create index if not exists jobs_source_last_seen_idx
  on public.jobs (source, last_seen_at);


-- -- 4. updated_at --------------------------------------------------------
-- touch_updated_at() comes from 001. If this section errors, 001 was never
-- run against this database.
drop trigger if exists touch_employer_orgs on public.employer_orgs;
create trigger touch_employer_orgs before update on public.employer_orgs
  for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_job_postings on public.job_postings;
create trigger touch_job_postings before update on public.job_postings
  for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_posting_submissions on public.posting_submissions;
create trigger touch_posting_submissions before update on public.posting_submissions
  for each row execute procedure public.touch_updated_at();


-- -- 5. TELL POSTGREST ----------------------------------------------------
-- Supabase's API layer caches the schema. New tables usually appear within
-- seconds, but a stale cache reports PGRST205 "Could not find the table in
-- the schema cache" - which reads exactly like the table not existing. This
-- forces the reload so the API works the moment this finishes.
notify pgrst, 'reload schema';


-- -- VERIFY - all 6 should show rowsecurity = true ------------------------
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
   and tablename in ('employer_orgs','employer_members','job_postings',
                     'posting_submissions','candidate_feedback','intro_requests')
 order by tablename;
