-- ============================================================
-- 013 — PROFILE COMPLETENESS (makes 012's columns reachable)
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- 012 added the consent flag and the cv_* columns and then nothing wrote to
-- them, because the write paths it assumed were never built. This migration
-- adds the last three things those paths need, and the indexes the employer
-- query will need on day one. The code changes that fill everything ship
-- alongside it — see api/server.js (/ai/cv-extract), lib/profile.js and
-- views/You.jsx.
--
-- Deliberately NOT added here: any column the CV parse can already derive
-- (headline, years_experience, skills) or that 006 already declared
-- (work_authorization, target_salary_min, preferences). Those exist and are
-- empty for want of a writer, not for want of a column. Adding more empty
-- columns is how 012 ended up needing this file.
-- ============================================================


-- ── 1. AVAILABILITY ──────────────────────────────────────────────────────
-- The single filter an employer applies that nothing on file can infer.
-- Skills come from the CV, eligibility comes from work_authorization, but
-- "can this person start inside my hiring window" is unknowable until asked.
-- Its own column rather than a preferences key because employers filter on
-- it, and a jsonb key can't be indexed usefully at this size.
alter table public.profiles
  add column if not exists availability text;

alter table public.profiles
  drop constraint if exists profiles_availability_check;

alter table public.profiles
  add constraint profiles_availability_check
  check (availability is null or availability in (
    'immediately','2_weeks','1_month','2_months','3_months_plus'
  ));


-- ── 2. RAW EXTRACTION ────────────────────────────────────────────────────
-- cv_skills / cv_titles / cv_years are the DERIVED, queryable projection of
-- an LLM pass. This column keeps the full parse that produced them.
--
-- Two reasons it earns its place. First, the user edits the derived values
-- (they remove a skill the parser hallucinated) and we must not lose what
-- the document actually said — that distinction is the whole basis for
-- showing employers "claimed" vs "confirmed" honestly. Second, when the
-- extraction prompt improves, this lets us re-derive the columns from stored
-- parses instead of re-running the model over every CV.
alter table public.profiles
  add column if not exists cv_extract jsonb default '{}'::jsonb;


-- ── 3. COMPLETION MOMENT ─────────────────────────────────────────────────
-- Set once, when a profile first crosses the "employer-ready" bar. Not a
-- score — a score is derived state and would be stale the moment the bar
-- moves. This is just the timestamp, which lets us answer "how long does it
-- take a new signup to become employer-ready", the only funnel question that
-- matters for the employer side.
alter table public.profiles
  add column if not exists profile_completed_at timestamptz;


-- ── 4. INDEXES FOR THE EMPLOYER QUERY ────────────────────────────────────
-- The shortlist query in 012 filters on country + consent (already indexed
-- there) but the actual search an employer runs is "who knows React". That's
-- an array containment test, and without GIN it's a sequential scan over
-- every opted-in profile. Cheap to add now, painful to add under load.
create index if not exists profiles_cv_skills_gin
  on public.profiles using gin (cv_skills)
  where visible_to_employers;

create index if not exists profiles_skills_gin
  on public.profiles using gin (skills)
  where visible_to_employers;

-- Employers filter on years and availability together far more often than
-- either alone ("mid-level, can start this month").
create index if not exists profiles_employer_facets_idx
  on public.profiles (cv_years, availability)
  where visible_to_employers;


-- ── 5. RLS — STILL DELIBERATELY UNCHANGED ────────────────────────────────
-- Same reasoning as 012 §5, restated because it is the rule most likely to
-- be broken by accident later: profiles stays owner-read-only. Nothing here
-- opens another user's row to the client, and the /ai/cv-extract endpoint
-- shipped with this migration writes NOTHING — it returns the extraction and
-- the browser persists it under the user's own RLS policy.
--
-- That is a deliberate choice, not an oversight. The API server holds the
-- ANON key (see .env.example), so a server-side write to profiles would
-- either be blocked by RLS or, if it accepted a user_id from the request
-- body, would let any caller overwrite any profile. The service_role key
-- gets introduced when the employer READ endpoint is built, which is the
-- first thing that genuinely cannot work without it.


-- ── VERIFY ───────────────────────────────────────────────────────────────
-- Extraction coverage — should climb as users upload CVs:
--   select count(*) filter (where cv_parsed_at is not null) as parsed,
--          count(*)                                          as with_cv
--     from public.profiles p
--     join public.saved_cvs c on c.user_id = p.id;
--
-- Where profiles stall — tells you which prompt to improve next:
--   select
--     count(*)                                            as total,
--     count(*) filter (where country is not null)         as has_country,
--     count(*) filter (where cv_parsed_at is not null)    as has_cv_parse,
--     count(*) filter (where array_length(skills,1) > 0)  as has_confirmed_skills,
--     count(*) filter (where work_authorization ? 'residence') as has_work_auth,
--     count(*) filter (where availability is not null)    as has_availability,
--     count(*) filter (where visible_to_employers)        as opted_in,
--     count(*) filter (where profile_completed_at is not null) as completed
--   from public.profiles;
--
-- Time from signup to employer-ready:
--   select avg(profile_completed_at - created_at) as avg_time_to_ready
--     from public.profiles where profile_completed_at is not null;
