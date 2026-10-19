-- 019: preserve application history while preventing new orphan job references.
-- Apply manually AFTER 018. Does not delete applications or rewrite snapshots.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  c record;
  job_att smallint;
begin
  if (select atttypid from pg_attribute where attrelid = 'public.jobs'::regclass
      and attname = 'id' and not attisdropped) is distinct from 'uuid'::regtype
    or (select atttypid from pg_attribute where attrelid = 'public.applications'::regclass
      and attname = 'job_id' and not attisdropped) is distinct from 'uuid'::regtype
    or (select atttypid from pg_attribute where attrelid = 'public.applications'::regclass
      and attname = 'id' and not attisdropped) is distinct from 'uuid'::regtype then
    raise exception '019 requires jobs.id, applications.id and applications.job_id to be uuid; inspect the deployed schema';
  end if;
  if to_regclass('public.jobs_archive') is null then
    raise exception 'Apply migration 018 before 019';
  end if;
  select attnum into job_att from pg_attribute
    where attrelid = 'public.applications'::regclass and attname = 'job_id' and not attisdropped;
  -- Fail safely on an unfamiliar FK rather than silently removing constraints.
  for c in select * from pg_constraint
    where conrelid = 'public.applications'::regclass
      and ((contype = 'f' and job_att = any(conkey)) or conname = 'applications_job_id_fkey')
  loop
    if c.contype <> 'f' or c.conname <> 'applications_job_id_fkey'
      or c.confrelid <> 'public.jobs'::regclass or c.confdeltype <> 'n'
      or c.conkey is distinct from array[job_att]::smallint[]
      or c.confkey is distinct from array[(select attnum from pg_attribute
        where attrelid = 'public.jobs'::regclass and attname = 'id' and not attisdropped)]::smallint[] then
      raise exception 'Unexpected application job FK %; inspect before replacing it', c.conname;
    end if;
  end loop;
end $$;

-- Preserve the previous UUID before clearing an orphan. The observed production
-- count (253) is a baseline, NOT a selection rule or an expected fixed count.
create table if not exists public.application_job_reference_repairs (
  application_id uuid primary key,
  previous_job_id uuid not null,
  repaired_at timestamptz not null default clock_timestamp()
);
alter table public.application_job_reference_repairs enable row level security;
revoke all on public.application_job_reference_repairs from public, anon, authenticated;
grant select on public.application_job_reference_repairs to service_role;

-- NOT VALID starts enforcing new writes immediately; validation follows the
-- targeted repair. A concurrent job delete is archived by 018 and SET NULL here.
alter table public.applications alter column job_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.applications'::regclass and conname = 'applications_job_id_fkey') then
    alter table public.applications add constraint applications_job_id_fkey
      foreign key (job_id) references public.jobs(id) on delete set null not valid;
  end if;
end $$;

-- The single transaction prevents the audit and repair from diverging. FK DDL
-- locks prevent concurrent job/application writes until the repair commits.
insert into public.application_job_reference_repairs (application_id, previous_job_id)
select a.id, a.job_id from public.applications a
where a.job_id is not null and not exists (select 1 from public.jobs j where j.id = a.job_id)
on conflict (application_id) do nothing;

update public.applications a set job_id = null
where a.job_id is not null and not exists (select 1 from public.jobs j where j.id = a.job_id);

create index if not exists applications_job_id_idx on public.applications (job_id)
  where job_id is not null;
alter table public.applications validate constraint applications_job_id_fkey;
notify pgrst, 'reload schema';
commit;
