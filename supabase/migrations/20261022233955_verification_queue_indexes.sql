-- Match the verifier's source filter AND complete oldest-first order.
-- The timestamp-only index forced a sort of the large never-checked group
-- (including repeated JSON evidence predicates) before returning a small batch.
-- No discovery, eligibility, availability or retry predicate changes.
create index if not exists jobs_verification_source_order_idx
 on public.jobs(source,link_checked_at asc nulls first,id asc);
analyze public.jobs(source,link_checked_at,id);
