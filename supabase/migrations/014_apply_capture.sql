-- ============================================================
-- 014 — APPLY CAPTURE (close the outbound leak)
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- THE LEAK. Four places open an employer's apply URL — the Copilot result
-- card, the tailor modal, the Pipeline card, the Briefing row — and all four
-- are a plain <a target="_blank">. Nothing is recorded. A job only ever
-- enters the pipeline if the user opens Tailor & apply AND then explicitly
-- clicks "Save for later" or "Mark as applied", so every user who applies
-- the obvious way (click through, apply on Greenhouse) is invisible to us.
--
-- THE FIX, IN TWO HALVES. Record the INTENT at click time — the click is the
-- signal, and waiting to find out whether they applied throws it away. Then
-- confirm the OUTCOME when they come back. The first half needs no user
-- cooperation at all and is where most of the value is; the second half
-- upgrades a guess into a fact.
--
-- WHY THIS MATTERS BEYOND THE PIPELINE: rung 2 of 012's verification ladder
-- ("genuinely applying to this kind of role") is the only rung that needs no
-- vendor and no user effort, and it is currently starved of data for want of
-- one timestamp.
-- ============================================================


-- ── 1. INTENT AND OUTCOME ────────────────────────────────────────────────
-- apply_clicked_at is the load-bearing column. It is set the instant the
-- user leaves for the employer's site, before we know anything about what
-- happened there, and it is what the return nudge keys off.
--
-- apply_outcome is deliberately separate from status. status is where the
-- card sits on the board (user-controlled, they can drag it anywhere);
-- apply_outcome is what we asked and what they answered. Collapsing the two
-- would mean a user tidying their board silently rewrites our evidence.
alter table public.applications
  add column if not exists apply_clicked_at timestamptz,
  add column if not exists apply_outcome    text,
  add column if not exists outcome_reason   text,
  add column if not exists outcome_at       timestamptz;

alter table public.applications
  drop constraint if exists applications_apply_outcome_check;

alter table public.applications
  add constraint applications_apply_outcome_check
  check (apply_outcome is null or apply_outcome in (
    'applied',      -- confirmed: they said yes
    'not_yet',      -- intend to, haven't
    'abandoned'     -- clicked through, decided against it (outcome_reason says why)
  ));


-- ── 2. NUDGE BUDGET ──────────────────────────────────────────────────────
-- The cap is the feature. An unanswered nudge that keeps reappearing costs
-- more trust than the missing row is worth, so the asking code checks these
-- before it renders anything: two asks per application, then silence forever.
alter table public.applications
  add column if not exists nudge_count integer not null default 0,
  add column if not exists nudged_at   timestamptz;


-- ── 3. 'applied_intent' JOINS THE LIFECYCLE ──────────────────────────────
-- Restates the full list from 006 because a check constraint cannot be
-- extended in place. The only addition is applied_intent, which sits between
-- cv_tailored and applied: we know they went to the employer's site, we do
-- not yet know whether they submitted anything.
--
-- Pipeline.jsx maps it into the Applied column, rendered as unconfirmed with
-- the confirm prompt on the card itself — that is where the user is already
-- looking at the job, so it is where the question belongs. It deliberately
-- does NOT get a sixth column; an unconfirmed application is a state of an
-- application, not a stage of a search.
alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check
  check (status in (
    'interested','saved','shortlist','cv_tailored',
    'applied_intent',
    'applied','assessment','interview','in_process',
    'offer','rejected','archived','closed'
  ));


-- ── 4. INDEX ─────────────────────────────────────────────────────────────
-- Serves exactly one query, run on every app focus: "does this user have an
-- unresolved apply intent?". Partial on the null outcome so it stays small —
-- rows resolve and leave the index, which is the opposite of how the table
-- itself grows.
create index if not exists applications_open_intent_idx
  on public.applications (user_id, apply_clicked_at desc)
  where apply_outcome is null and apply_clicked_at is not null;


-- ── 5. A NOTE ON WHAT THIS EVIDENCE IS WORTH ─────────────────────────────
-- apply_outcome = 'applied' is SELF-REPORTED. We know the user clicked
-- through (that part is observed) and we know they told us they applied
-- (that part is not). It is strong enough to drive the candidate's own
-- pipeline and their follow-up reminders. It is NOT proof of application and
-- must never be presented to an employer as one — 012 draws this line and
-- the product copy has to stay behind it.
--
-- The honest employer-facing claim from this data is about PATTERN, not
-- individual events: "applied to 6 Data Analytics roles in the last 90 days"
-- is defensible; "verified applicant" is not.


-- ── VERIFY ───────────────────────────────────────────────────────────────
-- The funnel this unlocks — each step should be smaller than the last:
--   select
--     count(*)                                            as intents,
--     count(*) filter (where apply_outcome is not null)   as answered,
--     count(*) filter (where apply_outcome = 'applied')   as confirmed,
--     count(*) filter (where apply_outcome = 'abandoned') as abandoned
--   from public.applications where apply_clicked_at is not null;
--
-- Why people bail after clicking through — feeds the eligibility guardrail:
--   select outcome_reason, count(*)
--     from public.applications
--    where apply_outcome = 'abandoned' and outcome_reason is not null
--    group by 1 order by 2 desc;
--
-- Nudge health. If answered/asked drops below ~40%, the copy is wrong or we
-- are asking at the wrong moment — do not respond by asking more often:
--   select sum(nudge_count) as asked,
--          count(*) filter (where apply_outcome is not null) as answered
--     from public.applications where nudge_count > 0;
