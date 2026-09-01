-- ============================================================
-- 016 - AI DRAFTING + BULK CV UPLOAD
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
-- Requires 015a/b/c. ASCII only, on purpose - see the note in 015a.
--
-- Two capabilities, one table change between them.
--
-- DRAFTING. A recruiter describes the role in plain language and the system
-- either drafts the posting or asks for the few things it must not invent.
-- job_postings.draft_brief keeps what they said and what they answered, so
-- the JD can be redrafted later without interviewing them again.
--
-- BULK UPLOAD. A recruiter drops 30 CVs from their own pipeline and gets
-- them ranked against the role with a short summary each. Those people are
-- NOT platform candidates - they never signed up here, and nothing below
-- adds them to the pool that employers can search. They are one recruiter's
-- private shortlist for one posting, and they stay that way.
-- ============================================================


-- -- 1. SUBMISSIONS COVER BOTH KINDS OF APPLICANT --------------------------
-- One queue, not two. A recruiter comparing candidates wants them ranked
-- against each other, and splitting "applied here" from "CV I uploaded"
-- into separate screens would make the ranking useless at exactly the
-- moment it matters.
--
-- candidate_id becomes nullable because an uploaded CV has no account. The
-- check constraint below is what keeps that from becoming a hole: a
-- platform submission MUST still have one.
alter table public.posting_submissions
  alter column candidate_id drop not null;

alter table public.posting_submissions
  add column if not exists source          text not null default 'platform',
  add column if not exists applicant_name  text,
  add column if not exists applicant_email text,
  add column if not exists cv_filename     text,
  -- The short description the recruiter reads instead of the whole CV.
  -- Written by the same pass that scores, so a card never shows a number
  -- with no explanation behind it.
  add column if not exists summary         text,
  add column if not exists uploaded_by     uuid references auth.users(id) on delete set null,
  -- Bulk scoring is paced and asynchronous, so the UI needs to distinguish
  -- "not scored yet" from "scored badly" from "the model failed". Without
  -- this, thirty CVs uploaded at once all render as score 0 until they
  -- don't, which reads as the product being wrong about people.
  add column if not exists score_status    text not null default 'done',
  add column if not exists scored_at       timestamptz;

alter table public.posting_submissions
  drop constraint if exists posting_submissions_source_check;
alter table public.posting_submissions
  add constraint posting_submissions_source_check
  check (source in ('platform','upload'));

-- The hole-closer: an applicant who came through the platform must be a
-- real account. Only uploads may be accountless.
alter table public.posting_submissions
  drop constraint if exists posting_submissions_identity_check;
alter table public.posting_submissions
  add constraint posting_submissions_identity_check
  check (
    (source = 'platform' and candidate_id is not null)
    or (source = 'upload')
  );

alter table public.posting_submissions
  drop constraint if exists posting_submissions_score_status_check;
alter table public.posting_submissions
  add constraint posting_submissions_score_status_check
  check (score_status in ('pending','scoring','done','failed'));

-- The worker's claim query: oldest pending first, for one posting.
create index if not exists posting_submissions_pending_idx
  on public.posting_submissions(posting_id, score_status, created_at)
  where score_status in ('pending','scoring');


-- -- 2. NOTE ON THE EXISTING UNIQUE CONSTRAINT -----------------------------
-- 015a declared unique (posting_id, candidate_id) to stop someone applying
-- twice. Postgres treats NULLs as distinct, so that constraint now permits
-- any number of uploaded rows on one posting - which is exactly what we
-- want, and is why it needs no change. Duplicate UPLOADS are a different
-- problem (the same CV dropped twice), handled in the API by filename and
-- content, not by the database.


-- -- 3. THE BRIEF BEHIND A POSTING -----------------------------------------
-- What the recruiter typed, the questions we asked, and their answers.
-- Kept because a JD is redrafted more than once - they publish, read it on
-- the live page, and want it tightened - and re-asking the same four
-- questions each time is how a good flow becomes a form.
alter table public.job_postings
  add column if not exists draft_brief jsonb default '{}'::jsonb;

-- Records that a human read the generated text before it went live. The
-- product's claim is that AI drafts and a person approves; this is the
-- column that makes that claim checkable rather than decorative.
alter table public.job_postings
  add column if not exists jd_approved_at timestamptz,
  add column if not exists jd_source      text;

alter table public.job_postings
  drop constraint if exists job_postings_jd_source_check;
alter table public.job_postings
  add constraint job_postings_jd_source_check
  check (jd_source is null or jd_source in ('written','pasted','drafted'));


-- -- 4. TELL POSTGREST ----------------------------------------------------
notify pgrst, 'reload schema';


-- -- VERIFY - expect 9 rows ------------------------------------------------
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'posting_submissions'
         and column_name in ('source','applicant_name','applicant_email',
                             'cv_filename','summary','score_status'))
     or (table_name = 'job_postings'
         and column_name in ('draft_brief','jd_approved_at','jd_source')))
 order by column_name;
