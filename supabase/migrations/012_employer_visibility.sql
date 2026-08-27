-- ============================================================
-- 012 — EMPLOYER VISIBILITY + STRUCTURED CANDIDATE PROFILE
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- Groundwork for the employer side ("Hire pre-verified African talent").
-- Adds nothing user-visible on its own — it exists so that consent and
-- structured profile data are in place BEFORE any employer feature is built.
--
-- WHY NOW, WITH ONLY 2 WAITLISTED EMPLOYERS: consent cannot be retrofitted.
-- Surfacing a candidate to an employer without affirmative opt-in is a real
-- exposure under Nigeria's NDPR (and GDPR the moment one EU-based employer
-- touches the data). Retrofitting means going back to every existing user to
-- ask; anyone you can't re-reach becomes permanently unusable. The column
-- costs nothing today and is expensive to add later.
--
-- WHAT "VERIFIED" CAN HONESTLY MEAN. Four rungs, and only the first two are
-- free because the evidence already exists:
--   1. eligibility  — this employer can legally engage this person   (shippable)
--   2. behavioural  — genuinely applying to this kind of role         (shippable)
--   3. structured   — claimed skills, machine-queryable (this file)   (needs CV parsing)
--   4. attested     — identity/history confirmed by a third party     (vendor, not now)
-- Everything below supports rungs 1-3. Nothing here proves rung 4, and the
-- product copy should not imply it does.
-- ============================================================


-- ── 1. CONSENT ───────────────────────────────────────────────────────────
-- DEFAULT false is the entire point: visibility is an action the candidate
-- takes, never an inherited state. visibility_updated_at exists so we can
-- show them when they granted it, and evidence it if ever challenged.
alter table public.profiles
  add column if not exists visible_to_employers  boolean not null default false,
  add column if not exists visibility_updated_at timestamptz;


-- ── 2. STRUCTURED PROFILE (rung 3) ───────────────────────────────────────
-- saved_cvs.cv_text is a raw blob; you cannot query "React, 4+ years, Lagos"
-- against it, which is why profiles.skills / years_experience are still 100%
-- empty in production. These are populated by an LLM pass over the CV AT
-- UPLOAD (the same extraction the tailoring flow already performs, moved
-- earlier so it runs once and benefits both sides of the product).
--
-- Named cv_* deliberately, and kept separate from the existing self-reported
-- profiles.skills: these are CLAIMS PARSED FROM A CV. Tidier self-reporting,
-- not verification. Do not let the employer UI present them as confirmed.
alter table public.profiles
  add column if not exists cv_skills    text[] default '{}',
  add column if not exists cv_titles    text[] default '{}',
  add column if not exists cv_years     integer,
  add column if not exists cv_parsed_at timestamptz;


-- ── 3. BEHAVIOURAL EVIDENCE (rung 2) ─────────────────────────────────────
-- applications snapshots job_title/company/verdict on purpose, so a record
-- survives its source row being pruned. role_cluster was missing from that
-- snapshot, so "candidates who applied to Data Analytics roles" could only be
-- answered by joining back to jobs — which fails for exactly the pruned rows
-- the snapshot exists to outlive. Store it at apply time like the others.
alter table public.applications
  add column if not exists role_cluster text;

-- Backfill note: existing rows can be filled by running job_title through
-- classifyJob() in api/roleIntelligence.js. 14 rows today — not worth a
-- script; the next code change that writes an application should set it.


-- ── 4. INDEXES ───────────────────────────────────────────────────────────
-- Partial index: employer queries only ever touch opted-in rows, so the index
-- only carries those. Stays tiny while opt-in is rare.
create index if not exists profiles_visible_to_employers_idx
  on public.profiles (country, visible_to_employers)
  where visible_to_employers;

create index if not exists applications_cluster_recent_idx
  on public.applications (role_cluster, applied_at desc)
  where role_cluster is not null;


-- ── 5. RLS — DELIBERATELY UNCHANGED ──────────────────────────────────────
-- No new SELECT policy is added here, and that is intentional.
--
-- profiles is currently owner-read-only ("profiles_select_own"). Adding a
-- policy that lets one authenticated user read another's profile would expose
-- every profile to anyone holding the anon key — including profiles that
-- never opted in — which is precisely the failure this migration exists to
-- prevent.
--
-- Employer-facing reads MUST run server-side through the service_role key, in
-- an endpoint that applies `visible_to_employers = true` itself. Consent is
-- enforced in the query, and the table stays closed to the client.


-- ── VERIFY ───────────────────────────────────────────────────────────────
-- Opt-in take-up:
--   select count(*) filter (where visible_to_employers) as opted_in,
--          count(*) as total
--   from public.profiles;
--
-- CV extraction coverage:
--   select count(*) filter (where cv_parsed_at is not null) as parsed,
--          count(*) as with_cv
--   from public.profiles p join public.saved_cvs c on c.user_id = p.id;
--
-- The employer shortlist query itself (run with service_role only).
-- NOTE: profiles keys on `id`, not `user_id` — it references auth.users(id).
--   select p.id, p.country, p.cv_skills, p.cv_years,
--          count(a.id)                          as applications_90d,
--          max(coalesce(a.applied_at, a.created_at)) as last_active
--     from public.profiles p
--     join public.applications a on a.user_id = p.id
--    where p.visible_to_employers = true
--      and p.country = any($1)        -- countries the employer can legally pay
--      and a.role_cluster = $2
--      and coalesce(a.applied_at, a.created_at) > now() - interval '90 days'
--    group by p.id, p.country, p.cv_skills, p.cv_years
--   having count(a.id) >= 2           -- one application is noise
--    order by last_active desc;
