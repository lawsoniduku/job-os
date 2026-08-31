-- ============================================================
-- 015a - EMPLOYER SIDE, PART 1 of 3: TABLES
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
-- RUN THIS FIRST, then 015b, then 015c. Each is independently re-runnable.
--
-- WHY THREE FILES. This started as one 394-line migration and failed on its
-- first statement with 42P01 "relation public.employer_orgs does not exist"
-- - the error you get when the CREATE never ran but everything referencing
-- it did, i.e. a partial paste. Three files small enough to paste whole are
-- worth more than one file that documents itself beautifully and doesn't
-- apply. Design commentary lives with the thing it explains.
--
-- CONTEXT. 008 captured employer demand. 012 put consent and structured
-- candidate data in place. 013 gave those columns a writer. 014 recorded
-- what candidates actually do. This is the other side of the market:
--   post . screen . feedback . match
--
-- Honest note: at time of writing 1 profile is opted in to employer
-- visibility and 3 employers are waitlisted. `match` is therefore built
-- correct but near-empty. `post` and `screen` work on day one, because a
-- posting creates its own applicant flow and depends on no existing pool.
-- ============================================================


-- -- 1. ORGS AND MEMBERS --------------------------------------------------
-- An employer account is an ORG, not a person. Hiring is a team act - the
-- recruiter who posts is rarely the manager who screens - and 008 already
-- keys demand on `company` rather than the individual who signed up.
create table if not exists public.employer_orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  website     text,
  country     text,                       -- lowercase, same vocabulary as profiles.country
  size        text,
  -- Set by a human, out of band, after confirming the company is real. NOT
  -- a signup step. Candidate-facing UI may say "verified employer" only
  -- when this is non-null; everything else is an unverified stranger with a
  -- company name they typed themselves.
  verified_at timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.employer_members (
  org_id     uuid not null references public.employer_orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- NOTE ON THE SIGNUP TRIGGER (001). handle_new_user() still creates a
-- profiles row for everyone, employers included. That row stays empty and
-- harmless: it is never opted in (visible_to_employers defaults false), so
-- an employer can never appear in another employer's shortlist. Membership
-- in employer_members is what makes an account an employer, and the two are
-- not mutually exclusive on purpose - a founder hiring their first engineer
-- is plausibly both.


-- -- 2. POSTINGS ----------------------------------------------------------
-- Deliberately NOT just a row in `jobs`. Three reasons:
--   1. A draft must not be searchable, and `jobs` has no concept of draft.
--   2. `jobs` is the ingest mirror - prune_stale.js deletes from it on
--      last_seen_at alone. A posting must outlive that (see 015c sec 3).
--   3. Authorship. `jobs` rows have a `source`, not an owner. Employer
--      writes need an org to authorise against.
--
-- On publish, a posting MIRRORS itself into `jobs` and stores the id here.
-- The posting is the record of authorship and lifecycle; the jobs row is
-- the searchable projection. One writer, one direction, no ambiguity.
create table if not exists public.job_postings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.employer_orgs(id) on delete cascade,
  job_id          uuid references public.jobs(id) on delete set null,
  title           text not null,
  description     text,
  location        text,
  remote_type     text,
  employment_type text,
  salary_min      integer,
  salary_max      integer,
  role_cluster    text,                   -- from classifyJob() in api/roleIntelligence.js
  seniority       text,
  -- The most important field on the table: rung 1 of 012's verification
  -- ladder, and the only filter that can honestly be called a CHECK rather
  -- than a guess. Empty means "not stated", which the matching code must
  -- treat as unknown, never as "anywhere".
  eligible_countries text[] default '{}',
  status          text not null default 'draft',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  published_at    timestamptz,
  closed_at       timestamptz
);


-- -- 3. SUBMISSIONS (the screening queue) ---------------------------------
-- SEPARATE FROM `applications`, for exactly the reason 014 kept
-- apply_outcome separate from status: these are two parties' records of the
-- same event, and neither may silently rewrite the other's.
--
-- `applications` is the CANDIDATE's board - they drag cards, archive
-- things, change their mind. This table is the EMPLOYER's queue, and its
-- `stage` is the employer's decision. If they were one row, a candidate
-- archiving a card would erase a rejection, and an employer rejecting
-- someone would move a card on a board they do not own.
--
-- application_id is a nullable convenience link, not the source of truth: a
-- candidate can delete their own application row, and that must not cascade
-- into the employer losing their record of having screened them.
create table if not exists public.posting_submissions (
  id             uuid primary key default gen_random_uuid(),
  posting_id     uuid not null references public.job_postings(id) on delete cascade,
  org_id         uuid not null references public.employer_orgs(id) on delete cascade,
  candidate_id   uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,

  -- Snapshotted at submit time, for the same reason applications snapshots
  -- job_title/company: the profile keeps changing after they apply, and the
  -- employer must see what was actually submitted.
  cv_text        text,
  cv_skills      text[] default '{}',
  cv_years       integer,
  country        text,
  availability   text,

  -- Computed once at submit time by the same LLM pass the candidate side
  -- runs for cv-match. Stored rather than recomputed per page-load because
  -- the queue is read far more often than written, and because a score that
  -- drifts between refreshes is indefensible to the person being scored.
  match_score    integer,
  match_reason   text,

  stage          text not null default 'new',
  decided_at     timestamptz,
  decided_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One application per person per posting. Re-applying updates the row.
  unique (posting_id, candidate_id)
);


-- -- 4. FEEDBACK (the actual differentiator) ------------------------------
-- Being ghosted is the default experience of applying for work, and it is
-- worse for exactly the candidates this product serves.
--
-- What makes it shippable: feedback is a REASON CODE plus an optional note,
-- not an essay. An employer rejecting 40 people will not write 40
-- paragraphs, so a product that requires paragraphs gets silence. One that
-- requires one click gets 40 answered candidates.
--
-- sent_at is separate from created_at because feedback is composed and then
-- released. Nothing reaches the candidate until sent_at is set, which lets
-- an employer reject in bulk and review before it goes out.
create table if not exists public.candidate_feedback (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid references public.posting_submissions(id) on delete cascade,
  posting_id    uuid not null references public.job_postings(id) on delete cascade,
  org_id        uuid not null references public.employer_orgs(id) on delete cascade,
  candidate_id  uuid not null references auth.users(id) on delete cascade,
  decision      text not null,
  reason_code   text,
  note          text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  seen_at       timestamptz
);


-- -- 5. INTRO REQUESTS (the match verb, and its consent checkpoint) -------
-- Proactive outreach: the employer found someone who never applied. That
-- person opted in to being VISIBLE, which is not the same as consenting to
-- be contacted, so this table is the gap between the two.
--
-- Nothing here reveals identity. The employer sees an anonymous card and
-- sends a request; the candidate decides. Contact details are released by
-- the server only when status = 'accepted'. Storing it as a row rather than
-- sending an email directly is the point - it makes the candidate's answer
-- the gate, and leaves evidence of what was asked.
create table if not exists public.intro_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.employer_orgs(id) on delete cascade,
  posting_id   uuid references public.job_postings(id) on delete set null,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  message      text,
  status       text not null default 'pending',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  -- Re-asking after a decline is harassment with extra steps. Note that
  -- Postgres treats NULLs as distinct here, so this does NOT constrain
  -- posting-less requests - api/employer.js queries for a prior row with
  -- .is("posting_id", null) and refuses there. Both layers are needed.
  unique (org_id, candidate_id, posting_id)
);


-- -- VERIFY - must return 6 rows before you run 015b ----------------------
select tablename
  from pg_tables
 where schemaname = 'public'
   and tablename in ('employer_orgs','employer_members','job_postings',
                     'posting_submissions','candidate_feedback','intro_requests')
 order by tablename;
