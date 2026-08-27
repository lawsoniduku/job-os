-- ============================================================
-- 011 — PRECOMPUTED ELIGIBILITY SIGNALS
-- ============================================================
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- WHY: search was shipping every candidate job's full description to the API
-- on every request, purely to re-derive eligibility facts. Measured: 600-1000
-- rows is 1.3-2.2 MB on the wire and 4-13s of latency, while the scoring
-- itself is only ~1.6ms/job. The description IS the payload.
--
-- The verdict can't be precomputed (it depends on the user's target country),
-- but every check that needs the DESCRIPTION is country-independent: is the
-- posting non-English, does it name a 401(k)/FLSA, which countries does the
-- body tie itself to, does it demand an incompatible timezone. Those reduce
-- to a ~200-byte blob — roughly 13x smaller than the description it replaces.
--
-- Shape (see extractEligibilitySignals in api/roleIntelligence.js):
--   { v, hardExclusion, nonEnglishMarkers, nonEnglishLocal, restricted,
--     tiedCountries[], worldwideDesc, descMentionsForeign,
--     insuranceLicensing, jurisdiction{country,marker}, tzFriction,
--     remoteWords }
--
-- `v` is a logic version. checkEligibility ignores a blob whose v doesn't
-- match the current SIGNALS_VERSION and recomputes from the description
-- instead, so changing the extraction logic can never be silently served
-- from stale precomputed data.
--
-- BACKFILL after running this:
--   node --env-file=.env ingest/reclassify.js
-- Verify parity before relying on it:
--   node --env-file=.env ingest/test_signals_parity.js
-- ============================================================

alter table public.jobs
  add column if not exists elig_signals jsonb;

-- Lets the backfill find rows that still need signals, cheaply.
create index if not exists jobs_elig_signals_missing_idx
  on public.jobs ((elig_signals is null)) where elig_signals is null;

-- Verify:
--   select count(*) filter (where elig_signals is null) as missing,
--          count(*) filter (where elig_signals is not null) as done
--   from public.jobs;
