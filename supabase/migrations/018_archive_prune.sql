-- 018: reversible job deletion and bounded stale-feed cleanup.
-- Apply manually after the existing employer schema (015). This file does not delete a job or enable a cron.
-- All delete paths (including an existing cron or employer close) archive the
-- complete row in the SAME transaction. An archive failure aborts the delete.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select atttypid from pg_attribute
      where attrelid = 'public.jobs'::regclass and attname = 'id' and not attisdropped)
      is distinct from 'uuid'::regtype then
    raise exception '018 requires public.jobs.id to be uuid; inspect the deployed schema first';
  end if;
end $$;

-- The superseded unbounded SECURITY DEFINER RPC must not remain public.
-- Its original body is preserved for audit; only its owner may invoke it.
do $$
begin
  if to_regprocedure('public.archive_stale_jobs(integer)') is not null then
    revoke all on function public.archive_stale_jobs(integer)
      from public, anon, authenticated, service_role;
  end if;
end $$;

-- Older deployments used a flat jobs-shaped archive. Keep every original row
-- in place, privately, before installing the append-only audited event archive.
-- Never reinterpret, overwrite or discard an unfamiliar existing archive.
do $$
begin
  if to_regclass('public.jobs_archive') is not null
    and not exists (select 1 from pg_attribute where attrelid=to_regclass('public.jobs_archive')
      and attname='job_row' and not attisdropped) then
    if to_regclass('public.jobs_archive_legacy_20261019') is not null then
      raise exception 'Legacy archive preservation target already exists; inspect before applying 018';
    end if;
    if not exists (select 1 from pg_attribute where attrelid=to_regclass('public.jobs_archive')
        and attname='id' and atttypid='uuid'::regtype and not attisdropped)
      or (select count(*) from pg_attribute where attrelid=to_regclass('public.jobs_archive')
        and attname in ('title','description','apply_url','source') and not attisdropped) <> 4 then
      raise exception 'Unrecognized jobs_archive schema; preserve and reconcile it explicitly';
    end if;
    if exists (select 1 from pg_constraint where confrelid=to_regclass('public.jobs_archive')) then
      raise exception 'Legacy archive has foreign-key dependents; review before renaming';
    end if;
    alter table public.jobs_archive rename to jobs_archive_legacy_20261019;
    alter table public.jobs_archive_legacy_20261019 enable row level security;
    revoke all on public.jobs_archive_legacy_20261019 from public, anon, authenticated;
    grant select on public.jobs_archive_legacy_20261019 to service_role;
    comment on table public.jobs_archive_legacy_20261019 is
      'Original flat job archive preserved without row conversion during trust rollout.';
  end if;
end $$;

create table if not exists public.jobs_archive (
  archive_id bigint generated always as identity constraint jobs_archive_events_pkey primary key,
  job_id uuid not null,
  deleted_at timestamptz not null default clock_timestamp(),
  delete_reason text not null,
  job_row jsonb not null check (jsonb_typeof(job_row) = 'object'),
  -- Links survive the ON DELETE SET NULL action installed by 019. These are
  -- identifiers only; candidate CVs, profiles and application content stay out.
  application_refs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(application_refs) = 'array')
);
create index if not exists jobs_archive_job_deleted_idx
  on public.jobs_archive (job_id, deleted_at desc);
create index if not exists jobs_archive_deleted_idx
  on public.jobs_archive (deleted_at);
alter table public.jobs_archive enable row level security;
-- No client policies: job descriptions may contain removed/private content and
-- application identifiers must not become a public side channel.
revoke all on public.jobs_archive from public, anon, authenticated;
revoke all on sequence public.jobs_archive_archive_id_seq from public, anon, authenticated;
grant select on public.jobs_archive to service_role;

create or replace function public.archive_job_before_delete()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare
  refs jsonb := '[]'::jsonb;
begin
  -- Dynamic lookup keeps 018 usable before the application FK is installed.
  if to_regclass('public.applications') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''application_id'', a.id,
               ''job_id'', a.job_id)), ''[]''::jsonb)
             from public.applications a where a.job_id = $1'
      into refs using old.id;
  end if;
  insert into public.jobs_archive (job_id, delete_reason, job_row, application_refs)
  values (old.id,
    coalesce(nullif(current_setting('jobcopilot.archive_reason', true), ''), 'direct_delete'),
    to_jsonb(old), refs);
  return old;
end $$;
revoke all on function public.archive_job_before_delete() from public, anon, authenticated;
drop trigger if exists archive_job_before_delete on public.jobs;
create trigger archive_job_before_delete before delete on public.jobs
  for each row execute function public.archive_job_before_delete();

-- Conservative preservation of positive evidence, including last_known after a
-- timeout. Malformed positive evidence is retained for manual review rather
-- than making a destructive decision from an invalid timestamp.
create or replace function public.retention_has_recent_open_evidence(p_signals jsonb, p_now timestamptz)
returns boolean language plpgsql stable set search_path = pg_catalog
as $$
declare
  evidence jsonb;
  checked timestamptz;
begin
  if p_signals #>> '{verification,status}' = 'dead'
    or p_signals #>> '{verification,last_known,status}' = 'dead' then
    return false;
  end if;
  for evidence in select value from jsonb_array_elements(jsonb_build_array(
    p_signals -> 'verification', p_signals #> '{verification,last_known}'))
  loop
    if evidence ->> 'status' = 'ok' then
      begin
        checked := coalesce(evidence ->> 'evidence_checked_at', evidence ->> 'checked_at')::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        return true;
      end;
      if checked is null or checked >= p_now - interval '7 days' then
        return true;
      end if;
    end if;
  end loop;
  return false;
end $$;
revoke all on function public.retention_has_recent_open_evidence(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.retention_has_recent_open_evidence(jsonb, timestamptz) to service_role;

create or replace function public.assert_job_retention_ready()
returns void language plpgsql stable security definer set search_path = pg_catalog
as $$
begin
  if not exists (select 1 from pg_constraint
      where conrelid = 'public.applications'::regclass
        and conname = 'applications_job_id_fkey' and contype = 'f'
        and confrelid = 'public.jobs'::regclass and confdeltype = 'n' and convalidated
        and conkey = array[(select attnum from pg_attribute where attrelid = 'public.applications'::regclass and attname = 'job_id' and not attisdropped)]::smallint[]
        and confkey = array[(select attnum from pg_attribute where attrelid = 'public.jobs'::regclass and attname = 'id' and not attisdropped)]::smallint[]) then
    raise exception 'Apply and validate migration 019 before pruning';
  end if;
  if exists (select 1 from pg_constraint
      where confrelid = 'public.jobs'::regclass and contype = 'f' and confdeltype = 'c') then
    raise exception 'A cascading FK references jobs; inspect it before enabling retention';
  end if;
end $$;
revoke all on function public.assert_job_retention_ready() from public, anon, authenticated;

-- Exact read-only preview of the same candidate policy used by the bounded RPC.
create or replace function public.preview_stale_job_retention(p_days integer default 180)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  report jsonb;
begin
  if p_days is null or p_days < 180 or p_days > 3650 then
    raise exception 'p_days must be between 180 and 3650';
  end if;
  with candidates as materialized (
    select j.id, j.title, j.company, j.source, j.last_seen_at from public.jobs j
    where j.last_seen_at < now() - make_interval(days => p_days)
      and coalesce(j.posted_at, j.created_at) < now() - make_interval(days => p_days)
      and not public.retention_has_recent_open_evidence(j.elig_signals, now())
      and j.source is distinct from 'employer'
      and not exists (select 1 from public.job_postings p where p.job_id = j.id)
      and not exists (select 1 from public.saved_jobs s where s.job_id = j.id)
  )
  select jsonb_build_object(
    'days', p_days, 'cutoff', now() - make_interval(days => p_days),
    'total', (select count(*) from public.jobs),
    'selected', (select count(*) from candidates),
    'by_source', coalesce((select jsonb_object_agg(source, n) from (
      select coalesce(source, '(unknown)') as source, count(*) as n
      from candidates group by coalesce(source, '(unknown)')) grouped), '{}'::jsonb),
    'sample', coalesce((select jsonb_agg(to_jsonb(sample)) from (
      select * from candidates order by last_seen_at, id limit 12) sample), '[]'::jsonb)
  ) into report;
  return report;
end $$;
revoke all on function public.preview_stale_job_retention(integer) from public, anon, authenticated;
grant execute on function public.preview_stale_job_retention(integer) to service_role;

-- A slow/failed feed is not proof of closure. This is an explicitly invoked
-- retention operation, never a search eligibility verdict. Keep employer-owned
-- rows and all posting mirrors even if a malformed source says otherwise.
create or replace function public.archive_prune_stale_jobs(p_days integer default 180, p_limit integer default 500)
returns integer language plpgsql security definer set search_path = pg_catalog
as $$
declare
  deleted integer;
  previous_reason text := current_setting('jobcopilot.archive_reason', true);
begin
  if p_days is null or p_days < 180 or p_days > 3650 then
    raise exception 'p_days must be between 180 and 3650';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'p_limit must be between 1 and 5000';
  end if;
  perform public.assert_job_retention_ready();
  perform set_config('jobcopilot.archive_reason', 'stale_feed_retention', true);
  with candidates as (
    select j.id from public.jobs j
    where j.last_seen_at < now() - make_interval(days => p_days)
      and coalesce(j.posted_at, j.created_at) < now() - make_interval(days => p_days)
      and not public.retention_has_recent_open_evidence(j.elig_signals, now())
      and j.source is distinct from 'employer'
      and not exists (select 1 from public.job_postings p where p.job_id = j.id)
      and not exists (select 1 from public.saved_jobs s where s.job_id = j.id)
    order by j.last_seen_at, j.id
    limit p_limit for update of j skip locked
  )
  delete from public.jobs j using candidates c where j.id = c.id;
  get diagnostics deleted = row_count;
  perform set_config('jobcopilot.archive_reason', coalesce(previous_reason, ''), true);
  return deleted;
end $$;
revoke all on function public.archive_prune_stale_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.archive_prune_stale_jobs(integer, integer) to service_role;

-- No archive retention/purge is scheduled. Archive size is an explicit tradeoff:
-- it keeps recovery possible and does not reduce total stored data on its own.
-- Canonical cron replacement is installed only by explicit admin invocation below.
-- docs/job-retention-rollout.md explains the inventory and exact-match guard.
-- Cron replacement: inspect exact deployed
-- names/commands, then replace only the one confirmed legacy cleanup job.
-- Admin-only installer; defining this function does NOT schedule anything.
-- A full reviewed inventory is required, so an unseen concurrent cron change
-- cannot be silently combined with a new cleanup schedule.
create or replace function public.install_job_retention_cron(
  p_reviewed_inventory jsonb,
  p_expected_jobid bigint default null,
  p_expected_command text default null
)
returns bigint language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actual_inventory jsonb;
  old_command text;
  old_database text;
  old_username text;
  new_id bigint;
  canonical_command constant text := 'select public.archive_prune_stale_jobs(180, 500);';
begin
  perform public.assert_job_retention_ready();
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not installed; enable it separately after reviewing deployed cleanup';
  end if;
  if p_reviewed_inventory is null or jsonb_typeof(p_reviewed_inventory) <> 'object' then
    raise exception 'Pass the complete reviewed cron inventory from docs/job-retention-rollout.md';
  end if;
  execute 'select coalesce(jsonb_object_agg(jobid::text, to_jsonb(j)), ''{}''::jsonb) from cron.job j'
    into actual_inventory;
  if actual_inventory is distinct from p_reviewed_inventory then
    raise exception 'Cron inventory changed or was not fully reviewed; inspect cron.job again';
  end if;
  if (p_expected_jobid is null) <> (p_expected_command is null) then
    raise exception 'Replacement requires both expected job id and exact command';
  end if;
  -- Catch obvious additional cleanup. Indirect custom functions still require
  -- human review of the complete inventory passed above.
  if exists (select 1 from jsonb_each(actual_inventory) e
    where e.key::bigint is distinct from p_expected_jobid
      and ((e.value ->> 'jobname') ~* '(prun|retention|stale|cleanup)'
        or (e.value ->> 'command') ~* '(archive_prune_stale_jobs|delete[[:space:]]+from[[:space:]]+(public\.)?jobs|prune[^;]*job)')) then
    raise exception 'Additional possible retention job found; consolidate cleanup manually before installing';
  end if;
  if p_expected_jobid is not null then
    execute 'select command, database, username from cron.job where jobid = $1'
      into old_command, old_database, old_username using p_expected_jobid;
    if old_command is distinct from p_expected_command or old_database is distinct from current_database()
      or old_username is distinct from current_user then
      raise exception 'Expected cron id/command/database/owner does not match; nothing replaced';
    end if;
    execute 'select cron.unschedule($1)' using p_expected_jobid;
  end if;
  execute 'select cron.schedule($1, $2, $3)' into new_id
    using 'jobcopilot-archive-stale-jobs', '40 3 * * *', canonical_command;
  return new_id;
end $$;
-- Only the migration owner/database administrator may install or replace cron.
revoke all on function public.install_job_retention_cron(jsonb, bigint, text)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
