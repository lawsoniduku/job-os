-- Keep pending AI selection within the source-visible discovery pool.
-- Additive replacement only; no job rows, verdicts or prompt versions change.
begin;
create or replace function public.pending_inference_jobs(
  p_sources text[], p_infer_version integer, p_signals_version integer,
  p_since timestamptz, p_until timestamptz,
  p_cursor_at timestamptz default null, p_cursor_id uuid default null,
  p_limit integer default 500
) returns setof public.jobs
language plpgsql stable security invoker
set search_path = public, pg_temp
set timezone = 'UTC'
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
      -- Match the source-visibility gate search applies before retrieval.
      -- Positive evidence is a broad prefilter; JS applies exact age/currentness.
      and (j.last_seen_at is null or j.last_seen_at >= p_until-interval '28 days' or (
          (j.elig_signals #>> '{verification,status}' = 'ok' and
            left(j.elig_signals #>> '{verification,checked_at}',10) >= to_char((p_until-interval '8 days') at time zone 'UTC','YYYY-MM-DD'))
          or (j.elig_signals #>> '{verification,last_known,status}' = 'ok' and
            left(j.elig_signals #>> '{verification,last_known,checked_at}',10) >= to_char((p_until-interval '8 days') at time zone 'UTC','YYYY-MM-DD'))
        ))
      and (coalesce(j.elig_signals #>> '{source,fetched_at}','') = '' or
        left(j.elig_signals #>> '{source,fetched_at}',10) >= to_char((p_until-interval '29 days') at time zone 'UTC','YYYY-MM-DD') or (
          (j.elig_signals #>> '{verification,status}' = 'ok' and
            left(j.elig_signals #>> '{verification,checked_at}',10) >= to_char((p_until-interval '8 days') at time zone 'UTC','YYYY-MM-DD'))
          or (j.elig_signals #>> '{verification,last_known,status}' = 'ok' and
            left(j.elig_signals #>> '{verification,last_known,checked_at}',10) >= to_char((p_until-interval '8 days') at time zone 'UTC','YYYY-MM-DD'))
        ))
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

notify pgrst, 'reload schema';
commit;
