\set ON_ERROR_STOP on
-- DESTRUCTIVE LOCAL TEST HARNESS: only a new disposable database whose name
-- starts jobos_retention_test_. Never execute this against a Supabase project.
do $$ begin
  if current_database() !~ '^jobos_retention_test_' then
    raise exception 'Use a new disposable database named jobos_retention_test_<suffix>';
  end if;
  if to_regclass('public.jobs') is not null then
    raise exception 'Fixture requires an empty disposable database';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create table public.jobs (
  id uuid primary key, title text, company text, source text,
  posted_at timestamptz, created_at timestamptz default now(),
  last_seen_at timestamptz, elig_signals jsonb
);
create table public.applications (id uuid primary key, job_id uuid not null, job_title text);
create table public.saved_jobs (id uuid primary key, job_id uuid not null);
create table public.job_postings (id uuid primary key, job_id uuid references public.jobs(id) on delete set null);

insert into public.jobs (id, title, company, source, posted_at, last_seen_at, elig_signals)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'Fixture ' || n, 'Offline fixture', 'jobhive', now() - interval '300 days',
  now() - interval '300 days', '{}'::jsonb from generate_series(1, 9) n;
update public.jobs set source = 'employer' where title = 'Fixture 2';
insert into public.job_postings values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003');
insert into public.saved_jobs values ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004');
update public.jobs set elig_signals = jsonb_build_object('verification', jsonb_build_object('status', 'ok', 'checked_at', now())) where title = 'Fixture 5';
update public.jobs set elig_signals = '{"verification":{"status":"ok","checked_at":"invalid"}}' where title = 'Fixture 6';
update public.jobs set posted_at = now() - interval '1 day' where title = 'Fixture 7';
update public.jobs set last_seen_at = now() where title = 'Fixture 8';
update public.jobs set last_seen_at = null where title = 'Fixture 9';
insert into public.applications values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Application snapshot'),
  ('30000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 'Orphan snapshot');

-- Exercise the fresh-schema path first; this database is disposable and empty.
\ir ../migrations/018_archive_prune.sql
do $$ begin
  if to_regclass('public.jobs_archive') is null then raise exception 'Fresh archive was not created'; end if;
end $$;
drop table public.jobs_archive;
-- Reproduce the legacy flat archive found during the production preflight.
create table public.jobs_archive (id uuid primary key, title text, description text, apply_url text, source text);
insert into public.jobs_archive values ('90000000-0000-0000-0000-000000000001','Historical fixture','Original body','https://example.invalid/old','jobhive');
\ir ../migrations/018_archive_prune.sql
-- The old archive remains intact and private; new events use a separate table.
do $$ begin
  if (select count(*) from public.jobs_archive_legacy_20261019) <> 1
    or (select description from public.jobs_archive_legacy_20261019) <> 'Original body'
    or (select count(*) from public.jobs_archive) <> 0 then
    raise exception 'Legacy archive was lost or mixed with new events';
  end if;
  if has_table_privilege('anon','public.jobs_archive_legacy_20261019','select')
    or has_table_privilege('authenticated','public.jobs_archive_legacy_20261019','select') then
    raise exception 'Legacy archive exposed to clients';
  end if;
end $$;
-- Pruning is blocked until application referential integrity is installed.
do $$ begin
  begin
    perform public.archive_prune_stale_jobs();
    raise exception 'Prune should require 019';
  exception when raise_exception then
    if sqlerrm <> 'Apply and validate migration 019 before pruning' then raise; end if;
  end;
end $$;
\ir ../migrations/019_application_job_fk.sql

do $$
declare n integer;
begin
  if (select job_id from public.applications where job_title = 'Orphan snapshot') is not null then
    raise exception 'Orphan was not set null';
  end if;
  if (select count(*) from public.application_job_reference_repairs) <> 1 then
    raise exception 'Orphan audit missing';
  end if;
  if (public.preview_stale_job_retention() ->> 'selected')::integer <> 1 then
    raise exception 'Retention preview should select only one unowned, unsaved, old/unseen row';
  end if;
  if has_function_privilege('anon', 'public.archive_prune_stale_jobs(integer,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.archive_prune_stale_jobs(integer,integer)', 'execute')
    or has_function_privilege('service_role', 'public.install_job_retention_cron(jsonb,bigint,text)', 'execute') then
    raise exception 'Retention privileges too broad';
  end if;
  n := public.archive_prune_stale_jobs(180, 1);
  if n <> 1 or (select count(*) from public.jobs) <> 8 then raise exception 'Wrong prune result'; end if;
  if (select count(*) from public.jobs_archive) <> 1 then raise exception 'Archive missing'; end if;
  if not exists (select 1 from public.jobs_archive where job_row ->> 'title' = 'Fixture 1'
      and jsonb_array_length(application_refs) = 1) then raise exception 'Full archive/application reference missing'; end if;
  if (select job_id from public.applications where job_title = 'Application snapshot') is not null then
    raise exception 'Deleted job did not SET NULL';
  end if;
  if (select count(*) from public.applications) <> 2 or (select count(*) from public.saved_jobs) <> 1 then
    raise exception 'History was deleted';
  end if;
  begin
    insert into public.applications values ('30000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000098', 'Invalid');
    raise exception 'Dangling application should fail';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Archive failure must roll back the original DELETE, even on a direct path.
create function public.reject_archive_fixture() returns trigger language plpgsql as $$
begin raise exception 'Fixture archive unavailable'; end $$;
create trigger reject_archive_fixture before insert on public.jobs_archive
for each row execute function public.reject_archive_fixture();
do $$ begin
  begin
    delete from public.jobs where title = 'Fixture 2';
    raise exception 'Delete should have failed with archive';
  exception when raise_exception then
    if sqlerrm <> 'Fixture archive unavailable' then raise; end if;
  end;
  if not exists (select 1 from public.jobs where title = 'Fixture 2') then raise exception 'Archive failure lost job'; end if;
end $$;
drop trigger reject_archive_fixture on public.jobs_archive;
delete from public.jobs where title = 'Fixture 2';
do $$ begin
  if not exists (select 1 from public.jobs_archive where job_row ->> 'title' = 'Fixture 2' and delete_reason = 'direct_delete') then
    raise exception 'Direct delete was not archived';
  end if;
end $$;
select 'Local retention integration fixture passed' as result;
-- Drop this disposable DATABASE after review. Roles created above are local
-- cluster roles, not database-scoped; do not remove shared roles blindly.
