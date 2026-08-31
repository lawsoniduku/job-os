-- ============================================================
-- 015b - EMPLOYER SIDE, PART 2 of 3: CONSTRAINTS + INDEXES
-- ============================================================
-- Run AFTER 015a. Safe to re-run.
--
-- If this errors with 42P01 "relation does not exist", 015a did not fully
-- apply - go back and check its verify query returns all 6 tables. Note
-- that ALTER TABLE ... DROP CONSTRAINT IF EXISTS still fails if the TABLE
-- is missing; the IF EXISTS covers the constraint, not the table.
-- ============================================================


-- -- 1. MEMBER ROLES ------------------------------------------------------
alter table public.employer_members
  drop constraint if exists employer_members_role_check;
alter table public.employer_members
  add constraint employer_members_role_check check (role in ('owner','member'));

create index if not exists employer_members_user_idx
  on public.employer_members(user_id);


-- -- 2. POSTING LIFECYCLE -------------------------------------------------
alter table public.job_postings
  drop constraint if exists job_postings_status_check;
alter table public.job_postings
  add constraint job_postings_status_check
  check (status in ('draft','open','paused','closed'));

create index if not exists job_postings_org_idx    on public.job_postings(org_id, created_at desc);
create index if not exists job_postings_status_idx on public.job_postings(status) where status = 'open';
create index if not exists job_postings_job_idx    on public.job_postings(job_id);


-- -- 3. SUBMISSION STAGES -------------------------------------------------
alter table public.posting_submissions
  drop constraint if exists posting_submissions_stage_check;
alter table public.posting_submissions
  add constraint posting_submissions_stage_check
  check (stage in ('new','screening','shortlisted','interview','offer','hired','rejected','withdrawn'));

alter table public.posting_submissions
  drop constraint if exists posting_submissions_score_check;
alter table public.posting_submissions
  add constraint posting_submissions_score_check
  check (match_score is null or (match_score >= 0 and match_score <= 100));

-- The queue's exact sort order: undecided first, best match first.
create index if not exists posting_submissions_queue_idx
  on public.posting_submissions(posting_id, stage, match_score desc nulls last);
create index if not exists posting_submissions_candidate_idx
  on public.posting_submissions(candidate_id, created_at desc);


-- -- 4. FEEDBACK VOCABULARY -----------------------------------------------
alter table public.candidate_feedback
  drop constraint if exists candidate_feedback_decision_check;
alter table public.candidate_feedback
  add constraint candidate_feedback_decision_check
  check (decision in ('advanced','rejected','hired'));

-- A closed vocabulary, chosen so every code is ACTIONABLE by the candidate.
-- "not_a_fit" is deliberately absent: it tells the person nothing they can
-- use, and its availability would make it the only code anyone ever picked.
-- api/employer.js keeps the same list in FEEDBACK_REASONS so a bad code
-- returns a readable message instead of a constraint violation.
alter table public.candidate_feedback
  drop constraint if exists candidate_feedback_reason_check;
alter table public.candidate_feedback
  add constraint candidate_feedback_reason_check
  check (reason_code is null or reason_code in (
    'experience_level',      -- more/less senior than the role needs
    'missing_skill',         -- a specific required skill absent from the CV
    'location_eligibility',  -- we cannot legally engage someone there
    'cv_presentation',       -- the CV undersold them; fixable, and worth saying
    'role_filled',           -- nothing to do with them
    'role_closed',           -- we stopped hiring
    'stronger_candidates'    -- honest, and the only vague one we allow
  ));

-- Partial: the candidate-facing query only ever reads sent feedback.
create index if not exists candidate_feedback_candidate_idx
  on public.candidate_feedback(candidate_id, sent_at desc) where sent_at is not null;
create index if not exists candidate_feedback_posting_idx
  on public.candidate_feedback(posting_id, created_at desc);


-- -- 5. INTRO STATUS ------------------------------------------------------
alter table public.intro_requests
  drop constraint if exists intro_requests_status_check;
alter table public.intro_requests
  add constraint intro_requests_status_check
  check (status in ('pending','accepted','declined','expired'));

create index if not exists intro_requests_candidate_idx
  on public.intro_requests(candidate_id, status, created_at desc);
create index if not exists intro_requests_org_idx
  on public.intro_requests(org_id, created_at desc);


-- -- VERIFY - must return 7 rows before you run 015c ----------------------
select conname
  from pg_constraint
 where conname in ('employer_members_role_check','job_postings_status_check',
                   'posting_submissions_stage_check','posting_submissions_score_check',
                   'candidate_feedback_decision_check','candidate_feedback_reason_check',
                   'intro_requests_status_check')
 order by conname;
