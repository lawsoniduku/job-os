alter table public.posting_submissions
  add column if not exists score_retry_at timestamptz,
  add column if not exists score_retry_reason text,
  add column if not exists score_failures integer not null default 0;
drop function public.claim_posting_scores(uuid);
create function public.claim_posting_scores(p_posting uuid)
returns table(id uuid,cv_text text,claim_token uuid,failures integer)
language sql security invoker set search_path='' as $$
 with due as (
  select s.id from public.posting_submissions s where s.posting_id=p_posting and
   ((s.score_status='pending' and (s.score_retry_at is null or s.score_retry_at<=now())) or
    (s.score_status='scoring' and coalesce(s.score_claimed_at,s.updated_at)<now()-interval '5 minutes'))
  order by s.created_at,s.id for update skip locked limit 1
 ) update public.posting_submissions s set score_status='scoring',score_claimed_at=now(),score_claim_token=gen_random_uuid()
 from due where s.id=due.id returning s.id,s.cv_text,s.score_claim_token,s.score_failures;
$$;
revoke all on function public.claim_posting_scores(uuid) from public,anon,authenticated;
grant execute on function public.claim_posting_scores(uuid) to service_role;
create or replace function public.invalidate_hiring_assessments() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.screening_criteria is distinct from old.screening_criteria or new.description is distinct from old.description or new.title is distinct from old.title then
  update public.posting_submissions set assessment=null,match_score=null,match_reason=null,summary=null,
   score_status='pending',scored_at=null,score_claim_token=null,score_claimed_at=null,score_retry_at=null,score_retry_reason=null,score_failures=0
   where posting_id=new.id and org_id=new.org_id;
 end if;
 return new;
end; $$;
drop trigger if exists invalidate_hiring_assessments on public.job_postings;
create trigger invalidate_hiring_assessments after update of screening_criteria,description,title on public.job_postings
 for each row execute function public.invalidate_hiring_assessments();
-- Literal mention coverage is not a semantic match score. Queue a proper assessment.
update public.posting_submissions set match_score=null,score_status='pending',score_retry_at=null
 where assessment->>'method'='literal_cv_evidence' and score_status='done';
