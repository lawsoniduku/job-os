\set ON_ERROR_STOP on
-- Destructive fixture setup is allowed ONLY in this named disposable database.
-- Do not point this test at Supabase, staging or production.
do $guard$
begin
  if current_database() <> 'jobos_inference_test_ci' then
    raise exception 'Refusing fixture setup outside jobos_inference_test_ci';
  end if;
  if to_regclass('public.jobs') is not null then
    raise exception 'Refusing fixture setup: public.jobs already exists';
  end if;
end;
$guard$;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create table public.jobs (
  id uuid primary key, title text, company text, location text, description text,
  source text, apply_url text, link_status text, last_seen_at timestamptz,
  posted_at timestamp without time zone, created_at timestamp without time zone, elig_signals jsonb
);
grant select, update on public.jobs to service_role;

\ir ../supabase/migrations/017_inference_queue.sql
\ir ../supabase/migrations/020_inference_discovery_freshness.sql

begin;
insert into public.jobs(id,title,company,location,description,source,apply_url,link_status,posted_at,created_at,elig_signals)
select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'Data Analyst','Offline fixture','Remote',repeat('Build product dashboards. ',12),
  'jobhive','https://offline.bamboohr.com/careers/'||n,'unknown',
  '2026-10-01T00:00:00Z'::timestamptz,'2026-10-01T00:00:00Z'::timestamptz,
  '{"v":5,"hardExclusion":null,"tiedCountries":[],"hiringScopes":[]}'::jsonb
from generate_series(1,18) n;

-- Different microseconds, increasing IDs: ordering must follow timestamps.
update public.jobs set posted_at='2026-10-19T11:59:59.999900Z' where id='00000000-0000-4000-8000-000000000001';
update public.jobs set posted_at='2026-10-19T11:59:59.999800Z' where id='00000000-0000-4000-8000-000000000002';
update public.jobs set location='Worldwide' where id='00000000-0000-4000-8000-000000000003';
update public.jobs set location='Anywhere' where id='00000000-0000-4000-8000-000000000004';
update public.jobs set location='Remote worldwide' where id='00000000-0000-4000-8000-000000000005';
update public.jobs set location='Global' where id='00000000-0000-4000-8000-000000000006';
update public.jobs set link_status='dead' where id='00000000-0000-4000-8000-000000000007';
update public.jobs set description='short' where id='00000000-0000-4000-8000-000000000008';
update public.jobs set elig_signals=elig_signals||'{"infer":{"v":2}}'::jsonb where id='00000000-0000-4000-8000-000000000009';
update public.jobs set elig_signals=elig_signals||'{"hardExclusion":"US only"}'::jsonb where id='00000000-0000-4000-8000-000000000010';
update public.jobs set posted_at='2025-12-01T00:00:00Z',created_at='2025-12-01T00:00:00Z' where id='00000000-0000-4000-8000-000000000011';
update public.jobs set elig_signals='{"v":4,"hardExclusion":"obsolete"}'::jsonb where id='00000000-0000-4000-8000-000000000012';
update public.jobs set created_at=null where id='00000000-0000-4000-8000-000000000013';
update public.jobs set elig_signals=elig_signals||'{"verification":{"status":"unknown","last_known":{"status":"dead"}}}'::jsonb where id='00000000-0000-4000-8000-000000000014';
update public.jobs set description=repeat('Candidates must reside in United States. ',8),elig_signals=elig_signals||'{"hiringScopes":[{"required":true,"targets":["us"],"evidence":"candidates must reside in united states"}]}'::jsonb where id='00000000-0000-4000-8000-000000000015';
update public.jobs set elig_signals=elig_signals||'{"hiringScopes":[{"required":false,"targets":["germany"],"evidence":"open to germany"}]}'::jsonb where id='00000000-0000-4000-8000-000000000016';
update public.jobs set location=null,description=repeat('Build product dashboards. ',1000),elig_signals=elig_signals||'{"source":{"ats":"bamboohr","marker":"keep"},"verification":{"status":"unknown","reason":"timeout"},"custom_metadata":{"keep":true}}'::jsonb where id='00000000-0000-4000-8000-000000000017';
update public.jobs set posted_at=null,created_at='2025-12-01T00:00:00Z' where id='00000000-0000-4000-8000-000000000018';

do $tests$
declare
  rows uuid[];
  first_row public.jobs;
  second_row public.jobs;
  target public.jobs;
  expected jsonb;
  verdict jsonb := '{"v":2,"scope":"unclear","confidence":"low","at":"2026-10-19T12:00:00Z","model":"offline-fixture"}';
  n integer;
  rejected boolean := false;
begin
  perform set_config('TimeZone','Pacific/Auckland',true);
  select array_agg(id order by id) into rows from public.pending_inference_jobs(
    array['jobhive'],2,5,'2026-04-22T12:00:00Z','2026-10-19T12:00:00Z',null,null,1000);
  if rows is distinct from array[
    '00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-4000-8000-000000000006'::uuid,'00000000-0000-4000-8000-000000000012'::uuid,
    '00000000-0000-4000-8000-000000000013'::uuid,'00000000-0000-4000-8000-000000000016'::uuid,
    '00000000-0000-4000-8000-000000000017'::uuid,'00000000-0000-4000-8000-000000000018'::uuid] then
    raise exception 'Wrong pending server selection: %',rows;
  end if;
  -- Source-stale rows must not consume model calls, while recently checked
  -- current openings retain the same discovery exception as search.
  update public.jobs set last_seen_at='2026-08-01T00:00:00Z' where id='00000000-0000-4000-8000-000000000012';
  if exists(select 1 from public.pending_inference_jobs(array['jobhive'],2,5,'2026-04-22T12:00:00Z','2026-10-19T12:00:00Z',null,null,1000) where id='00000000-0000-4000-8000-000000000012') then raise exception 'Stale source reached model queue'; end if;
  update public.jobs set elig_signals=elig_signals||'{"verification":{"status":"ok","checked_at":"2026-10-19T11:00:00Z"}}'::jsonb where id='00000000-0000-4000-8000-000000000012';
  if not exists(select 1 from public.pending_inference_jobs(array['jobhive'],2,5,'2026-04-22T12:00:00Z','2026-10-19T12:00:00Z',null,null,1000) where id='00000000-0000-4000-8000-000000000012') then raise exception 'Recent employer proof lost source visibility'; end if;
  update public.jobs set last_seen_at=null,elig_signals='{"v":4,"hardExclusion":"obsolete"}'::jsonb where id='00000000-0000-4000-8000-000000000012';
  select * into first_row from public.pending_inference_jobs(array['jobhive'],2,5,'2026-04-22T12:00:00Z','2026-10-19T12:00:00Z',null,null,1);
  select * into second_row from public.pending_inference_jobs(array['jobhive'],2,5,'2026-04-22T12:00:00Z','2026-10-19T12:00:00Z',first_row.posted_at at time zone 'UTC',first_row.id,1);
  if first_row.id <> '00000000-0000-4000-8000-000000000001' or second_row.id <> '00000000-0000-4000-8000-000000000002' then
    raise exception 'Microsecond keyset ordering lost';
  end if;
  begin
    perform public.pending_inference_jobs(array['jobhive'],2,5,null,'2026-10-19T12:00:00Z',null,null,null);
  exception when raise_exception then rejected:=true;
  end;
  if not rejected then raise exception 'NULL page limit did not fail'; end if;
  if has_function_privilege('anon','public.pending_inference_jobs(text[],integer,integer,timestamptz,timestamptz,timestamptz,uuid,integer)','execute')
    or has_function_privilege('authenticated','public.pending_inference_jobs(text[],integer,integer,timestamptz,timestamptz,timestamptz,uuid,integer)','execute')
    or not has_function_privilege('service_role','public.pending_inference_jobs(text[],integer,integer,timestamptz,timestamptz,timestamptz,uuid,integer)','execute')
    or has_function_privilege('anon','public.write_job_inference(uuid,jsonb,jsonb,jsonb)','execute')
    or has_function_privilege('authenticated','public.write_job_inference(uuid,jsonb,jsonb,jsonb)','execute')
    or not has_function_privilege('service_role','public.write_job_inference(uuid,jsonb,jsonb,jsonb)','execute') then
    raise exception 'Inference RPC privileges are incorrect';
  end if;

  select * into target from public.jobs where id='00000000-0000-4000-8000-000000000017';
  expected:=to_jsonb(target);
  select count(*) into n from public.write_job_inference(target.id,expected,verdict,
    '{"v":5,"worldwideDesc":false,"source":null,"verification":null,"custom_metadata":null}'::jsonb);
  if n<>1 then raise exception 'Null-location / long-description CAS did not write'; end if;
  if not exists(select 1 from public.jobs where id=target.id
    and elig_signals->'source'=target.elig_signals->'source'
    and elig_signals->'verification'=target.elig_signals->'verification'
    and elig_signals->'custom_metadata'=target.elig_signals->'custom_metadata'
    and elig_signals->'infer'=verdict) then
    raise exception 'Inference write erased shared metadata or lost audited verdict';
  end if;

  select * into target from public.jobs where id='00000000-0000-4000-8000-000000000013';
  expected:=to_jsonb(target);
  -- Legacy text mutation, deliberately without changing elig_signals.
  update public.jobs set description=description||' Candidates must reside in Germany.' where id=target.id;
  select count(*) into n from public.write_job_inference(target.id,expected,verdict,'{"v":5}'::jsonb);
  if n<>0 then raise exception 'Stale inference attached to changed text'; end if;
  select * into target from public.jobs where id='00000000-0000-4000-8000-000000000012';
  expected:=to_jsonb(target);
  update public.jobs set elig_signals=elig_signals||'{"verification":{"status":"dead"}}'::jsonb where id=target.id;
  select count(*) into n from public.write_job_inference(target.id,expected,verdict,'{"v":5}'::jsonb);
  if n<>0 then raise exception 'Concurrent evidence overwritten by inference'; end if;
  raise notice 'Migration 017 selection, microsecond paging, privileges, NULL bounds and atomic POST writes passed';
end;
$tests$;
rollback;
