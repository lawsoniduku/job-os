-- ============================================================
-- 015 — EMPLOYER SIDE (post · screen · feedback · match)
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- 008 captured employer demand. 012 put consent and structured candidate
-- data in place. 013 gave those columns a writer. 014 started recording
-- what candidates actually do. This file is the other side of the market.
--
-- FOUR VERBS, and every table below exists to serve one of them:
--   post      — an employer publishes a role into the same jobs table the
--               candidate side already searches (job_postings)
--   screen    — the people who applied arrive in a ranked queue
--               (posting_submissions)
--   feedback  — a rejection carries a reason, and the candidate sees it
--               (candidate_feedback)
--   match     — 012's shortlist query, run against opted-in profiles
--               (intro_requests)
--
-- ONE THING TO BE HONEST ABOUT UP FRONT. As of this migration there is 1
-- profile opted in to employer visibility, 1 with a parsed CV, and 3 rows
-- on the employer waitlist. The `match` verb is therefore built correct but
-- near-empty; it gets useful as opt-in take-up rises, and the schema is not
-- what's holding it back. `post` and `screen` work on day one, because a
-- posting creates its own applicant flow and doesn't depend on the existing
-- pool at all. That is the argument for building posting first.
-- ============================================================


-- ── 1. ORGS AND MEMBERS ──────────────────────────────────────────────────
-- An employer account is an ORG, not a person. Hiring is a team act — the
-- recruiter who posts is rarely the manager who screens — and 008 already
-- keys demand on `company` rather than on the individual who signed up.
-- Getting this wrong means a painful migration the first time two people at
-- one company both want in.
create table if not exists public.employer_orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  website     text,
  country     text,                       -- lowercase, same vocabulary as profiles.country
  size        text,
  -- verified_at is set by a human, out of band, after confirming the
  -- company is real. It is NOT a signup step. Candidate-facing UI may say
  -- "verified employer" only when this is non-null; everything else is an
  -- unverified stranger with a company name they typed themselves.
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

alter table public.employer_members
  drop constraint if exists employer_members_role_check;
alter table public.employer_members
  add constraint employer_members_role_check check (role in ('owner','member'));

create index if not exists employer_members_user_idx on public.employer_members(user_id);

-- NOTE ON THE SIGNUP TRIGGER (001). handle_new_user() still creates a
-- profiles row for everyone, employers included. That row stays empty and
-- harmless: it is never opted in (visible_to_employers defaults false), so
-- an employer can never appear in another employer's shortlist. Membership
-- in employer_members is what makes an account an employer, and the two are
-- not mutually exclusive on purpose — a founder hiring their first engineer
-- is plausibly both.


-- ── 2. POSTINGS ──────────────────────────────────────────────────────────
-- Deliberately NOT just a row in `jobs`. Three reasons:
--   1. A draft must not be searchable, and `jobs` has no concept of draft.
--   2. `jobs` is the ingest mirror — prune_stale.js deletes from it on
--      last_seen_at alone. A posting must outlive that (see §7).
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
  -- Countries this employer can legally engage someone in. This is the
  -- single most important field on the table: it is rung 1 of 012's
  -- verification ladder, and it is the only filter that can honestly be
  -- called a CHECK rather than a guess. Empty means "not stated", which
  -- the matching code must treat as unknown, never as "anywhere".
  eligible_countries text[] default '{}',
  status          text not null default 'draft',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  published_at    timestamptz,
  closed_at       timestamptz
);

alter table public.job_postings
  drop constraint if exists job_postings_status_check;
alter table public.job_postings
  add constraint job_postings_status_check
  check (status in ('draft','open','paused','closed'));

create index if not exists job_postings_org_idx    on public.job_postings(org_id, created_at desc);
create index if not exists job_postings_status_idx on public.job_postings(status) where status = 'open';
create index if not exists job_postings_job_idx    on public.job_postings(job_id);


-- ── 3. SUBMISSIONS (the screening queue) ─────────────────────────────────
-- SEPARATE FROM `applications`, for exactly the reason 014 kept apply_outcome
-- separate from status: these are two parties' records of the same event,
-- and neither may silently rewrite the other's.
--
-- `applications` is the CANDIDATE's board. They drag cards, archive things,
-- change their mind — it is theirs and it should stay theirs. This table is
-- the EMPLOYER's queue, and its `stage` is the employer's decision. If they
-- were one row, a candidate archiving a card would erase a rejection the
-- employer had issued, and an employer rejecting someone would move a card
-- on a board they do not own.
--
-- application_id is a nullable convenience link, not the source of truth:
-- a candidate can delete their own application row, and that must not
-- cascade into the employer losing their record of having screened them.
create table if not exists public.posting_submissions (
  id             uuid primary key default gen_random_uuid(),
  posting_id     uuid not null references public.job_postings(id) on delete cascade,
  org_id         uuid not null references public.employer_orgs(id) on delete cascade,
  candidate_id   uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,

  -- Snapshotted at submit time, for the same reason applications snapshots
  -- job_title/company: the profile keeps changing after they apply, and the
  -- employer must be able to see what they actually submitted.
  cv_text        text,
  cv_skills      text[] default '{}',
  cv_years       integer,
  country        text,
  availability   text,

  -- Ranking, computed once at submit time by the same LLM pass the
  -- candidate side already runs for cv-match. Stored rather than computed
  -- per page-load because the screening queue is read far more often than
  -- it is written, and because a score that drifts between refreshes is
  -- indefensible to the person being scored.
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

create index if not exists posting_submissions_queue_idx
  on public.posting_submissions(posting_id, stage, match_score desc nulls last);
create index if not exists posting_submissions_candidate_idx
  on public.posting_submissions(candidate_id, created_at desc);


-- ── 4. FEEDBACK (the actual differentiator) ──────────────────────────────
-- Being ghosted is the default experience of applying for work, and it is
-- worse for exactly the candidates this product serves — a Lagos applicant
-- to a remote European role usually never hears anything at all.
--
-- The design decision that makes this shippable is that feedback is a
-- REASON CODE plus an optional note, not a free-text essay. An employer
-- rejecting 40 people will not write 40 paragraphs, so a product that
-- requires paragraphs gets silence. A product that requires one click gets
-- 40 answered candidates. The note is where a human adds more if they want.
--
-- sent_at is separate from created_at because feedback is composed and then
-- released. Nothing is visible to the candidate until sent_at is set, which
-- gives an employer room to reject in bulk and review before it goes out.
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

alter table public.candidate_feedback
  drop constraint if exists candidate_feedback_decision_check;
alter table public.candidate_feedback
  add constraint candidate_feedback_decision_check
  check (decision in ('advanced','rejected','hired'));

-- A closed vocabulary, chosen so every code is ACTIONABLE by the candidate.
-- "not_a_fit" is deliberately absent: it tells the person nothing they can
-- use, and its availability would make it the only code anyone ever picks.
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

create index if not exists candidate_feedback_candidate_idx
  on public.candidate_feedback(candidate_id, sent_at desc) where sent_at is not null;
create index if not exists candidate_feedback_posting_idx
  on public.candidate_feedback(posting_id, created_at desc);


-- ── 5. INTRO REQUESTS (the match verb, and its consent checkpoint) ───────
-- Proactive outreach: the employer found someone in the shortlist who never
-- applied. That person opted in to being VISIBLE, which is not the same as
-- consenting to be contacted, so this table is the gap between the two.
--
-- Nothing here reveals identity. The employer sees an anonymous card and
-- sends a request; the candidate reads it and decides. Contact details are
-- released by the server only when status = 'accepted'. Storing it as a
-- row rather than sending an email directly is the whole point — it makes
-- the candidate's answer the gate, and leaves evidence of what was asked.
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
  -- Re-asking after a decline is harassment with extra steps. One live
  -- request per org per candidate per posting; the server refuses to
  -- recreate one that was declined.
  unique (org_id, candidate_id, posting_id)
);

alter table public.intro_requests
  drop constraint if exists intro_requests_status_check;
alter table public.intro_requests
  add constraint intro_requests_status_check
  check (status in ('pending','accepted','declined','expired'));

create index if not exists intro_requests_candidate_idx
  on public.intro_requests(candidate_id, status, created_at desc);
create index if not exists intro_requests_org_idx
  on public.intro_requests(org_id, created_at desc);


-- ── 6. RLS ───────────────────────────────────────────────────────────────
-- The rule from 012 §5 holds and is extended here: EMPLOYER TABLES ARE
-- CLOSED TO THE CLIENT. No select policy is written for employer_orgs,
-- job_postings, posting_submissions or intro_requests, because every
-- employer read is authorisation-dependent ("rows for MY org") and the anon
-- key cannot be trusted to assert which org it belongs to. Those reads run
-- server-side, through an endpoint that resolves the org from a verified
-- JWT and filters by it. See api/employer.js.
--
-- The only client-side policies are the CANDIDATE's own rows — the two
-- places where the employer side reaches back into the candidate app, and
-- where the existing frontend already talks to Supabase directly.
alter table public.employer_orgs        enable row level security;
alter table public.employer_members     enable row level security;
alter table public.job_postings         enable row level security;
alter table public.posting_submissions  enable row level security;
alter table public.candidate_feedback   enable row level security;
alter table public.intro_requests       enable row level security;

-- A member may read their own membership rows. This is how the frontend
-- answers "is this account an employer" without a server round-trip; it
-- exposes nothing but org ids the user is already in.
drop policy if exists "employer_members_select_own" on public.employer_members;
create policy "employer_members_select_own" on public.employer_members
  for select using (auth.uid() = user_id);

-- Candidates read feedback addressed to them, once it has been sent.
drop policy if exists "candidate_feedback_select_own" on public.candidate_feedback;
create policy "candidate_feedback_select_own" on public.candidate_feedback
  for select using (auth.uid() = candidate_id and sent_at is not null);

-- ...and may mark it seen. The column-level restriction is enforced in the
-- app rather than by RLS (Postgres policies cannot limit which columns an
-- UPDATE touches); the with-check clause at least pins the row's ownership
-- and guarantees an unsent item can never be made visible by the client.
drop policy if exists "candidate_feedback_seen_own" on public.candidate_feedback;
create policy "candidate_feedback_seen_own" on public.candidate_feedback
  for update using (auth.uid() = candidate_id and sent_at is not null)
  with check (auth.uid() = candidate_id and sent_at is not null);

-- Candidates read intro requests addressed to them and answer them. The
-- answer is the consent gate, so it must be the candidate's own write.
drop policy if exists "intro_requests_select_own" on public.intro_requests;
create policy "intro_requests_select_own" on public.intro_requests
  for select using (auth.uid() = candidate_id);

drop policy if exists "intro_requests_respond_own" on public.intro_requests;
create policy "intro_requests_respond_own" on public.intro_requests
  for update using (auth.uid() = candidate_id)
  with check (auth.uid() = candidate_id);

-- Candidates read their own submissions (so the Pipeline can show "this one
-- is being reviewed"). They cannot write: stage belongs to the employer.
drop policy if exists "posting_submissions_select_own" on public.posting_submissions;
create policy "posting_submissions_select_own" on public.posting_submissions
  for select using (auth.uid() = candidate_id);


-- ── 7. KEEP PRUNE OFF EMPLOYER POSTINGS ──────────────────────────────────
-- ingest/prune_stale.js deletes from `jobs` on last_seen_at alone, with no
-- source filter. An employer's own posting has no feed to refresh it, so it
-- would be deleted 28 days after publishing — the one kind of row on the
-- table we are certain is real. The script is fixed to exclude source =
-- 'employer'; this index makes that exclusion cheap, and the comment here
-- exists so the next person to touch either file finds the other.
create index if not exists jobs_source_last_seen_idx
  on public.jobs (source, last_seen_at);


-- ── 8. updated_at ────────────────────────────────────────────────────────
drop trigger if exists touch_employer_orgs on public.employer_orgs;
create trigger touch_employer_orgs before update on public.employer_orgs
  for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_job_postings on public.job_postings;
create trigger touch_job_postings before update on public.job_postings
  for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_posting_submissions on public.posting_submissions;
create trigger touch_posting_submissions before update on public.posting_submissions
  for each row execute procedure public.touch_updated_at();


-- ============================================================
-- VERIFY
--   Tables + RLS badges:
--     select tablename, rowsecurity from pg_tables
--      where schemaname='public'
--        and tablename in ('employer_orgs','employer_members','job_postings',
--                          'posting_submissions','candidate_feedback','intro_requests');
--
--   The screening queue (server-side; org_id comes from a verified JWT):
--     select s.*, f.decision
--       from posting_submissions s
--       left join candidate_feedback f on f.submission_id = s.id
--      where s.posting_id = $1
--      order by (s.stage = 'new') desc, s.match_score desc nulls last;
--
--   Ghost rate — the number this product exists to move. Every submission
--   older than 14 days whose candidate was never told anything:
--     select count(*) filter (where f.id is null) as unanswered,
--            count(*) as total
--       from posting_submissions s
--       left join candidate_feedback f
--              on f.submission_id = s.id and f.sent_at is not null
--      where s.created_at < now() - interval '14 days';
-- ============================================================
