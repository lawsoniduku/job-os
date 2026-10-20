-- Match JobHive inventory keyset reads: equality on source/ATS, ordered by ID.
-- Prevent an empty/new slice from scanning all JobHive heap rows to prove zero.
create index if not exists jobs_source_ats_source_id_idx
  on public.jobs (source, ats_source, id);

analyze public.jobs (source, ats_source);
