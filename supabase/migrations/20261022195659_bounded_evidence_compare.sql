-- Keep compare-and-swap filters bounded even when evidence quotes are large.
-- Database-generated from the exact JSONB value; clients treat this as opaque.
-- SHA-256 avoids weakening the concurrency check to a timestamp or partial hash.
alter table public.jobs add column if not exists elig_signals_etag text
  generated always as (encode(extensions.digest(coalesce(elig_signals::text, 'null'), 'sha256'), 'hex')) stored;
notify pgrst, 'reload schema';
