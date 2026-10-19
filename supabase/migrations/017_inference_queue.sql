-- Service-role-only, newest-first pending inference queue. Apply before WS1 CLI.
-- SQL performs cheap conservative selection; needsInference remains the final
-- authority in JavaScript. No prompt, verdict or INFER_VERSION changes here.
begin;

create index if not exists jobs_inference_queue_order_idx
  on public.jobs ((coalesce(posted_at, created_at)) desc, id desc)
  where char_length(coalesce(description, '')) >= 200
    and coalesce(link_status, 'unknown') <> 'dead'
    and lower(btrim(coalesce(location, ''))) in ('', 'remote', 'remote,',
      'remote job', 'n/a', '-', 'not specified',
      'fully remote', 'global');

create or replace function public.pending_inference_jobs(
  p_sources text[], p_infer_version integer, p_signals_version integer,
  p_since timestamptz, p_until timestamptz,
  p_cursor_at timestamptz default null, p_cursor_id uuid default null,
  p_limit integer default 500
) returns setof public.jobs
language plpgsql stable security invoker
set search_path = public, pg_temp
as $function$
begin
  if p_until is null or p_limit is null or p_limit not between 1 and 1000
    or p_infer_version is null or p_infer_version < 1
    or p_signals_version is null or p_signals_version < 1
    or coalesce(array_length(p_sources, 1), 0) not between 1 and 32
    or (p_since is not null and p_since > p_until)
    or ((p_cursor_at is null) <> (p_cursor_id is null)) then
    raise exception 'Invalid inference queue parameters';
  end if;

  return query
    select j.* from public.jobs j
    where j.source = any(p_sources)
      and coalesce(j.link_status, 'unknown') <> 'dead'
      and coalesce(j.elig_signals #>> '{verification,status}', '') <> 'dead'
      and coalesce(j.elig_signals #>> '{verification,last_known,status}', '') <> 'dead'
      and char_length(coalesce(j.description, '')) >= 200
      and lower(btrim(coalesce(j.location, ''))) in ('', 'remote', 'remote,',
        'remote job', 'n/a', '-', 'not specified',
        'fully remote', 'global')
      and (j.elig_signals #>> '{infer,v}') is distinct from p_infer_version::text
      -- Never use stale cached eligibility flags to drop a candidate.
      and (coalesce(j.elig_signals ->> 'v', '') <> p_signals_version::text or (
        coalesce(j.elig_signals ->> 'hardExclusion', '') = ''
        and coalesce(j.elig_signals ->> 'nonEnglishMarkers', 'false') <> 'true'
        and coalesce(j.elig_signals ->> 'nonEnglishLocal', 'false') <> 'true'
        and coalesce(j.elig_signals ->> 'restricted', 'false') <> 'true'
        and coalesce(j.elig_signals ->> 'onsiteRequired', '') = ''
        and coalesce(j.elig_signals -> 'jurisdiction', 'null'::jsonb) = 'null'::jsonb
        and coalesce(j.elig_signals -> 'tiedCountries', '[]'::jsonb) in ('[]'::jsonb, 'null'::jsonb)
        and coalesce(j.elig_signals ->> 'worldwideDesc', 'false') <> 'true'
        and not (coalesce(j.elig_signals -> 'hiringScopes', '[]'::jsonb) @> '[{"required":true}]'::jsonb)
      ))
      -- Stable run boundary. Rows arriving after this snapshot belong to the
      -- next run, not an endlessly moving first page.
      and coalesce(j.created_at, j.posted_at) <= p_until
      and coalesce(j.posted_at, j.created_at) <= p_until
      and (
        p_since is null or j.posted_at is null or j.posted_at >= p_since
        -- Search also admits older current-year postings backed by recent
        -- open evidence. A broad eight-day date prefilter tolerates timestamp
        -- offsets/precision; JS applies the exact shared seven-day gate.
        or (j.posted_at >= date_trunc('year', p_until at time zone 'UTC') at time zone 'UTC'
          and (
            (j.elig_signals #>> '{verification,status}' = 'ok'
              and left(j.elig_signals #>> '{verification,checked_at}', 10) >= to_char((p_until - interval '8 days') at time zone 'UTC', 'YYYY-MM-DD'))
            or (j.elig_signals #>> '{verification,last_known,status}' = 'ok'
              and left(j.elig_signals #>> '{verification,last_known,checked_at}', 10) >= to_char((p_until - interval '8 days') at time zone 'UTC', 'YYYY-MM-DD'))
          ))
      )
      and (p_cursor_at is null or
        (coalesce(j.posted_at, j.created_at), j.id) < (p_cursor_at, p_cursor_id))
    order by coalesce(j.posted_at, j.created_at) desc, j.id desc
    limit p_limit;
end;
$function$;

revoke all on function public.pending_inference_jobs(text[], integer, integer,
  timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.pending_inference_jobs(text[], integer, integer,
  timestamptz, timestamptz, timestamptz, uuid, integer) to service_role;

comment on function public.pending_inference_jobs(text[], integer, integer,
  timestamptz, timestamptz, timestamptz, uuid, integer) is
  'Bounded service-role inference candidate queue. JS needsInference is authoritative.';

-- Body-based compare-and-swap: no full description is placed in a URL filter.
-- The expected JSON snapshot is compared atomically even if a legacy writer
-- changes posting text without changing the precomputed eligibility signals.
create or replace function public.write_job_inference(
  p_id uuid, p_expected jsonb, p_infer jsonb, p_flags jsonb
) returns table(id uuid)
language plpgsql security invoker
set search_path = public, pg_temp
as $function$
declare
  flags jsonb := '{}'::jsonb;
  field text;
begin
  if p_id is null or jsonb_typeof(p_expected) is distinct from 'object'
    or not (p_expected ?& array['title','company','location','description','source','apply_url','link_status','elig_signals'])
    or jsonb_typeof(p_infer) is distinct from 'object'
    or jsonb_typeof(p_flags) is distinct from 'object'
    or coalesce(p_infer->>'at','') = '' or coalesce(p_infer->>'model','') = '' then
    raise exception 'Invalid inference write snapshot or missing audit metadata';
  end if;
  -- Accept deterministic flags only. Never let a caller's flag payload replace
  -- source, availability, inference or any other shared metadata namespace.
  foreach field in array array['v','hardExclusion','hardExclusions','hiringScopes',
    'descriptionMissing','nonEnglishMarkers','nonEnglishLocal','restricted',
    'tiedCountries','worldwideDesc','descMentionsForeign','insuranceLicensing',
    'onsiteRequired','jurisdiction','tzFriction','remoteWords'] loop
    if p_flags ? field then flags := flags || jsonb_build_object(field,p_flags->field); end if;
  end loop;

  return query update public.jobs j
    set elig_signals = coalesce(j.elig_signals,'{}'::jsonb) || flags || jsonb_build_object('infer',p_infer)
    where j.id = p_id
      and j.title is not distinct from (p_expected->>'title')
      and j.company is not distinct from (p_expected->>'company')
      and j.location is not distinct from (p_expected->>'location')
      and j.description is not distinct from (p_expected->>'description')
      and j.source is not distinct from (p_expected->>'source')
      and j.apply_url is not distinct from (p_expected->>'apply_url')
      and j.link_status is not distinct from (p_expected->>'link_status')
      and coalesce(j.elig_signals,'null'::jsonb) is not distinct from (p_expected->'elig_signals')
    returning j.id;
end;
$function$;

revoke all on function public.write_job_inference(uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.write_job_inference(uuid,jsonb,jsonb,jsonb) to service_role;
comment on function public.write_job_inference(uuid,jsonb,jsonb,jsonb) is
  'Service-role atomic inference write; text and evidence snapshots compare in the POST body.';
commit;
