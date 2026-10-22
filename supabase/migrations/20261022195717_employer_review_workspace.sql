-- Recruiter review state is private, separate from candidate-readable submissions.
alter table public.job_postings add column if not exists screening_criteria jsonb not null default '[]'::jsonb
  check (jsonb_typeof(screening_criteria)='array' and jsonb_array_length(screening_criteria)<=12);
alter table public.posting_submissions
  add column if not exists assessment jsonb,
  add column if not exists stage_entered_at timestamptz,
  add column if not exists score_claimed_at timestamptz,
  add column if not exists score_claim_token uuid;
-- Preserve the last known decision/application date for existing applicants.
update public.posting_submissions set stage_entered_at=coalesce(decided_at,created_at) where stage_entered_at is null;
alter table public.posting_submissions alter column stage_entered_at set default now();
alter table public.posting_submissions alter column stage_entered_at set not null;
create unique index if not exists posting_submissions_id_org_key on public.posting_submissions(id,org_id);
create table if not exists public.hiring_reviews (
  submission_id uuid primary key,
  org_id uuid not null,
  next_action text not null default '' check (length(next_action)<=300),
  due_at timestamptz,
  scorecard jsonb,
  ai_review jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (submission_id,org_id) references public.posting_submissions(id,org_id) on delete cascade
);
create table if not exists public.hiring_activity (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  org_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('stage','note','scorecard','task')),
  body jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (submission_id,org_id) references public.posting_submissions(id,org_id) on delete cascade
);
create index if not exists hiring_activity_submission_time_idx on public.hiring_activity(org_id,submission_id,created_at desc);
create index if not exists hiring_reviews_due_idx on public.hiring_reviews(org_id,due_at) where next_action<>'';
alter table public.hiring_reviews enable row level security;
alter table public.hiring_activity enable row level security;
revoke all on public.hiring_reviews,public.hiring_activity from public,anon,authenticated;
grant select,insert,update,delete on public.hiring_reviews,public.hiring_activity to service_role;

create or replace function public.track_hiring_stage() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_entered_at=now();
    insert into public.hiring_activity(submission_id,org_id,actor_id,kind,body)
      values(new.id,new.org_id,new.decided_by,'stage',jsonb_build_object('from',old.stage,'to',new.stage));
  end if;
  return new;
end; $$;
revoke all on function public.track_hiring_stage() from public,anon,authenticated;
grant execute on function public.track_hiring_stage() to service_role;
drop trigger if exists track_hiring_stage on public.posting_submissions;
create trigger track_hiring_stage before update of stage on public.posting_submissions
  for each row execute function public.track_hiring_stage();

-- One atomic operation: the stage, private review state and activity agree.
create or replace function public.save_hiring_review(p_org uuid,p_actor uuid,p_submission uuid,p_expected timestamptz,p_review jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.posting_submissions;
begin
  if not exists(select 1 from public.employer_members where org_id=p_org and user_id=p_actor) then
    raise exception 'Not an organisation member' using errcode='42501';
  end if;
  select * into s from public.posting_submissions where id=p_submission and org_id=p_org for update;
  if not found then raise exception 'Applicant not found' using errcode='P0002'; end if;
  if p_expected is null or s.updated_at<>p_expected then raise exception 'Applicant changed; reload before saving' using errcode='40001'; end if;
  if s.stage in ('rejected','withdrawn','hired') and p_review ? 'stage' then
    raise exception 'Final decisions cannot be reopened here' using errcode='23514';
  end if;
  if p_review ? 'stage' and (p_review->>'stage') not in ('new','screening','shortlisted','interview','offer') then
    raise exception 'Use decision controls for final decisions' using errcode='23514';
  end if;
  if length(coalesce(p_review->>'note',''))>4000 or length(coalesce(p_review->>'next_action',''))>300 then
    raise exception 'Review text is too long' using errcode='23514';
  end if;
  if p_review ? 'stage' then
    update public.posting_submissions set stage=p_review->>'stage',decided_by=p_actor,decided_at=now() where id=s.id and org_id=p_org;
  else
    -- Advance the optimistic version for private edits as well.
    update public.posting_submissions set updated_at=now() where id=s.id and org_id=p_org;
  end if;
  insert into public.hiring_reviews(submission_id,org_id,updated_by) values(s.id,p_org,p_actor)
    on conflict(submission_id) do nothing;
  if p_review ? 'next_action' then
    update public.hiring_reviews set next_action=p_review->>'next_action',due_at=nullif(p_review->>'due_at','')::timestamptz,
      updated_by=p_actor,updated_at=now() where submission_id=s.id and org_id=p_org;
    insert into public.hiring_activity(submission_id,org_id,actor_id,kind,body)
      values(s.id,p_org,p_actor,'task',jsonb_build_object('next_action',p_review->>'next_action','due_at',p_review->>'due_at'));
  end if;
  if p_review ? 'scorecard' then
    update public.hiring_reviews set scorecard=p_review->'scorecard',updated_by=p_actor,updated_at=now() where submission_id=s.id and org_id=p_org;
    insert into public.hiring_activity(submission_id,org_id,actor_id,kind,body) values(s.id,p_org,p_actor,'scorecard',p_review->'scorecard');
  end if;
  if coalesce(p_review->>'note','')<>'' then
    insert into public.hiring_activity(submission_id,org_id,actor_id,kind,body) values(s.id,p_org,p_actor,'note',jsonb_build_object('text',p_review->>'note'));
  end if;
  return s.id;
end; $$;
revoke all on function public.save_hiring_review(uuid,uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.save_hiring_review(uuid,uuid,uuid,timestamptz,jsonb) to service_role;

-- Durable, bounded leases: a restarted process can recover work after 5 minutes.
create or replace function public.claim_posting_scores(p_posting uuid)
returns table(id uuid,cv_text text,claim_token uuid) language sql security invoker set search_path='' as $$
  with due as (
    select s.id from public.posting_submissions s
    where s.posting_id=p_posting and (s.score_status='pending' or
      (s.score_status='scoring' and coalesce(s.score_claimed_at,s.updated_at)<now()-interval '5 minutes'))
    order by s.created_at,s.id for update skip locked limit 1
  )
  update public.posting_submissions s set score_status='scoring',score_claimed_at=now(),score_claim_token=gen_random_uuid()
  from due where s.id=due.id returning s.id,s.cv_text,s.score_claim_token;
$$;
revoke all on function public.claim_posting_scores(uuid) from public,anon,authenticated;
grant execute on function public.claim_posting_scores(uuid) to service_role;

create or replace function public.invalidate_hiring_assessments() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.screening_criteria is distinct from old.screening_criteria then
    update public.posting_submissions set assessment=null,match_score=null,match_reason=null,summary=null,
      score_status='pending',scored_at=null,score_claim_token=null,score_claimed_at=null where posting_id=new.id and org_id=new.org_id;
  end if;
  return new;
end; $$;
revoke all on function public.invalidate_hiring_assessments() from public,anon,authenticated;
grant execute on function public.invalidate_hiring_assessments() to service_role;
drop trigger if exists invalidate_hiring_assessments on public.job_postings;
create trigger invalidate_hiring_assessments after update of screening_criteria on public.job_postings
  for each row execute function public.invalidate_hiring_assessments();
notify pgrst,'reload schema';

-- An application and employer submission commit together. Repeating a submit
-- returns the original receipt and cannot reset a recruiter's decision.
create or replace function public.submit_employer_application(p_posting uuid,p_candidate uuid,p_cv text)
returns table(submission_id uuid,already_applied boolean)
language plpgsql security invoker set search_path='' as $$
declare j public.job_postings; existing_id uuid; application_uuid uuid; submission_uuid uuid; p public.profiles; company_name text;
begin
  select * into j from public.job_postings where id=p_posting for update;
  if not found or j.status<>'open' then raise exception 'Role is not accepting applications' using errcode='P0002'; end if;
  select id into existing_id from public.posting_submissions where posting_id=j.id and candidate_id=p_candidate;
  if found then return query select existing_id,true; return; end if;
  if p_cv is null or length(trim(p_cv))=0 or length(p_cv)>50000 then raise exception 'A readable CV is required' using errcode='23514'; end if;
  select * into p from public.profiles where id=p_candidate;
  select name into company_name from public.employer_orgs where id=j.org_id;
  insert into public.applications(user_id,job_id,job_title,company,location,salary_min,salary_max,source,status,role_cluster,applied_at,apply_clicked_at,apply_outcome,outcome_at)
    values(p_candidate,j.job_id,j.title,company_name,j.location,j.salary_min,j.salary_max,'employer','applied',j.role_cluster,now(),now(),'applied',now()) returning id into application_uuid;
  insert into public.posting_submissions(posting_id,org_id,candidate_id,application_id,cv_text,cv_skills,cv_years,country,availability,stage,source,score_status)
    values(j.id,j.org_id,p_candidate,application_uuid,p_cv,coalesce(p.cv_skills,'{}'),p.cv_years,p.country,p.availability,'new','platform','pending') returning id into submission_uuid;
  return query select submission_uuid,false;
end; $$;
revoke all on function public.submit_employer_application(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.submit_employer_application(uuid,uuid,text) to service_role;

-- Stage and in-app feedback are a single transaction. Uploaded CVs receive
-- a private decision only; no email or candidate account is invented.
create or replace function public.record_hiring_decision(p_org uuid,p_actor uuid,p_ids uuid[],p_decision text,p_reason text,p_note text,p_hold boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.posting_submissions; target text; moved integer=0; notified integer=0; uncontactable integer=0; found_count integer;
begin
  if not exists(select 1 from public.employer_members where org_id=p_org and user_id=p_actor) then raise exception 'Not a member' using errcode='42501'; end if;
  if p_decision not in ('advanced','rejected','hired') or cardinality(p_ids)<1 or cardinality(p_ids)>200 then raise exception 'Invalid decision' using errcode='23514'; end if;
  if p_decision='rejected' and (p_reason is null or p_reason not in ('experience_level','missing_skill','location_eligibility','cv_presentation','role_filled','role_closed','stronger_candidates')) then raise exception 'A rejection reason is required' using errcode='23514'; end if;
  select count(*) into found_count from public.posting_submissions where id=any(p_ids) and org_id=p_org;
  if found_count<>(select count(distinct x) from unnest(p_ids) as x) then raise exception 'Applicant not found' using errcode='P0002'; end if;
  target=case p_decision when 'advanced' then 'shortlisted' when 'hired' then 'hired' else 'rejected' end;
  for s in select * from public.posting_submissions where id=any(p_ids) and org_id=p_org order by id for update loop
    if s.stage=target then continue; end if;
    if s.stage in ('withdrawn','hired','rejected') or (p_decision='advanced' and s.stage in ('interview','offer')) then raise exception 'Applicant has already moved; refresh the queue' using errcode='40001'; end if;
    if s.source='platform' and s.candidate_id is not null then
      insert into public.candidate_feedback(submission_id,posting_id,org_id,candidate_id,decision,reason_code,note,created_by,sent_at)
        values(s.id,s.posting_id,p_org,s.candidate_id,p_decision,p_reason,nullif(left(trim(p_note),2000),''),p_actor,case when coalesce(p_hold,false) then null else now() end);
      notified=notified+1;
    else uncontactable=uncontactable+1;
    end if;
    update public.posting_submissions set stage=target,decided_by=p_actor,decided_at=now() where id=s.id and org_id=p_org;
    if p_reason is not null then
      insert into public.hiring_activity(submission_id,org_id,actor_id,kind,body) values(s.id,p_org,p_actor,'note',jsonb_build_object('text','Decision: '||p_decision||'; reason: '||p_reason));
    end if;
    moved=moved+1;
  end loop;
  return jsonb_build_object('sent',case when coalesce(p_hold,false) then 0 else notified end,'recorded',notified,'held',coalesce(p_hold,false),'uncontactable',uncontactable,'moved',moved);
end; $$;
revoke all on function public.record_hiring_decision(uuid,uuid,uuid[],text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.record_hiring_decision(uuid,uuid,uuid[],text,text,text,boolean) to service_role;
notify pgrst,'reload schema';

-- RLS controls rows; column grants control what a candidate may change.
-- A candidate can acknowledge feedback, never rewrite the employer decision.
revoke update on public.candidate_feedback from public,anon,authenticated;
grant update(seen_at) on public.candidate_feedback to authenticated;
revoke update on public.intro_requests from public,anon,authenticated;
grant update(status,responded_at) on public.intro_requests to authenticated;
notify pgrst,'reload schema';
