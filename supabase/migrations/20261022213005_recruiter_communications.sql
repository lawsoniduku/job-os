-- Recruiter-initiated communication only. No automated hiring decisions.
create table public.hiring_contacts (
 submission_id uuid primary key,
 org_id uuid not null,
 email text not null check(email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(email)<=254),
 confirmed_by uuid references auth.users(id) on delete set null,
 confirmed_at timestamptz not null default now(),
 foreign key(submission_id,org_id) references public.posting_submissions(id,org_id) on delete cascade
);
create table public.hiring_interviews (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,
 submission_id uuid not null,
 starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at>starts_at),
 timezone text not null,
 location text not null default '',
 title text not null,
 organizer_email text not null,
 attendee_email text not null,
 sequence integer not null default 0,
 status text not null default 'scheduled' check(status in ('scheduled','cancelled')),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 foreign key(submission_id,org_id) references public.posting_submissions(id,org_id) on delete cascade
);
create index hiring_interviews_submission on public.hiring_interviews(org_id,submission_id,starts_at);
create table public.hiring_messages (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,
 submission_id uuid not null,
 request_id uuid not null,
 action jsonb not null,
 payload jsonb not null,
 created_by uuid references auth.users(id) on delete set null,
 status text not null default 'queued' check(status in ('queued','sending','sent','failed')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 first_attempt_at timestamptz,
 claimed_at timestamptz,
 claim_token uuid,
 provider_id text,
 last_error text,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 unique(org_id,request_id),
 foreign key(submission_id,org_id) references public.posting_submissions(id,org_id) on delete cascade
);
create index hiring_messages_due on public.hiring_messages(next_attempt_at,created_at) where status in ('queued','sending');
create index hiring_messages_submission on public.hiring_messages(org_id,submission_id,created_at desc);
alter table public.hiring_contacts enable row level security;
alter table public.hiring_interviews enable row level security;
alter table public.hiring_messages enable row level security;
revoke all on public.hiring_contacts,public.hiring_interviews,public.hiring_messages from public,anon,authenticated;
grant select,insert,update,delete on public.hiring_contacts,public.hiring_interviews,public.hiring_messages to service_role;

create function public.queue_hiring_action(p_org uuid,p_actor uuid,p_submission uuid,p_expected timestamptz,p_request uuid,p_action jsonb)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.posting_submissions; prior public.hiring_messages; event public.hiring_interviews;
 v_email text; v_stage text; v_title text; v_org_name text; v_payload jsonb; v_id uuid; v_kind text:=p_action->>'kind';
 v_active text[]:=array['new','screening','shortlisted','interview','offer','hired'];
begin
 if not exists(select 1 from public.employer_members m where m.org_id=p_org and m.user_id=p_actor) then raise exception 'Membership required' using errcode='42501'; end if;
 -- The same request can be replayed after a network timeout without moving twice.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||p_request::text,0));
 select * into prior from public.hiring_messages m where m.org_id=p_org and m.request_id=p_request;
 if found then
  if prior.created_by<>p_actor or prior.submission_id<>p_submission or prior.action<>p_action then raise exception 'Idempotency key reused for a different action' using errcode='23514'; end if;
  return jsonb_build_object('message_id',prior.id,'status',prior.status,'already_queued',true);
 end if;
 select * into s from public.posting_submissions where id=p_submission and org_id=p_org for update;
 if not found then raise exception 'Applicant not found' using errcode='P0002'; end if;
 if p_expected is null or s.updated_at is distinct from p_expected then raise exception 'Applicant changed; reload before continuing' using errcode='40001'; end if;
 if v_kind<>'cancel' and s.stage in ('rejected','hired','withdrawn') then raise exception 'Final decision cannot be reopened here' using errcode='23514'; end if;
 if v_kind not in ('advance','interview','cancel') then raise exception 'Unknown hiring action' using errcode='23514'; end if;
 v_email:=p_action->>'email';
 if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'A confirmed email is required' using errcode='23514'; end if;
 if s.source='upload' and coalesce((p_action->>'email_confirmed')::boolean,false)=false and not exists(select 1 from public.hiring_contacts c where c.submission_id=s.id and c.org_id=p_org and c.email=v_email) then raise exception 'Confirm the uploaded candidate email' using errcode='23514'; end if;
 if s.source='platform' and not exists(select 1 from public.hiring_contacts c where c.submission_id=s.id and c.org_id=p_org and c.email=v_email) then raise exception 'Use the applicant account email' using errcode='23514'; end if;
 if v_kind in ('interview','cancel') and exists(select 1 from public.hiring_interviews i where i.submission_id=s.id and i.org_id=p_org and i.status='scheduled' and i.ends_at>now() and i.attendee_email<>v_email) then raise exception 'Use the existing interview email to reschedule or cancel. Cancel before changing the recipient.' using errcode='23514'; end if;
 insert into public.hiring_contacts(submission_id,org_id,email,confirmed_by) values(s.id,p_org,v_email,p_actor)
  on conflict(submission_id) do update set email=excluded.email,confirmed_by=excluded.confirmed_by,confirmed_at=now();
 select title into v_title from public.job_postings where id=s.posting_id and org_id=p_org;
 select name into v_org_name from public.employer_orgs where id=p_org;
 v_stage:=s.stage;
 if v_kind='advance' then
  v_stage:=v_active[array_position(v_active,s.stage)+1];
  if v_stage is null then raise exception 'No next stage is available' using errcode='23514'; end if;
 elsif v_kind='interview' then
  if s.stage='offer' then raise exception 'Cannot move an offer back to interview' using errcode='23514'; end if;
  if (p_action->>'starts_at')::timestamptz<=now() or (p_action->>'starts_at')::timestamptz>now()+interval '1 year' or (p_action->>'duration_minutes')::int not between 15 and 180 then raise exception 'Invalid interview time' using errcode='23514'; end if;
  if p_action->>'interview_id' is not null then
   select * into event from public.hiring_interviews where id=(p_action->>'interview_id')::uuid and submission_id=s.id and org_id=p_org for update;
   if not found or event.status='cancelled' then raise exception 'Interview not found' using errcode='P0002'; end if;
   update public.hiring_interviews set starts_at=(p_action->>'starts_at')::timestamptz,ends_at=(p_action->>'starts_at')::timestamptz+make_interval(mins=>(p_action->>'duration_minutes')::int),timezone=p_action->>'timezone',location=p_action->>'location',sequence=sequence+1 where id=event.id returning * into event;
  else
   if exists(select 1 from public.hiring_interviews where submission_id=s.id and org_id=p_org and status='scheduled' and ends_at>now()) then raise exception 'An interview is already scheduled; reschedule it instead' using errcode='23514'; end if;
   insert into public.hiring_interviews(org_id,submission_id,starts_at,ends_at,timezone,location,title,organizer_email,attendee_email,created_by)
    values(p_org,s.id,(p_action->>'starts_at')::timestamptz,(p_action->>'starts_at')::timestamptz+make_interval(mins=>(p_action->>'duration_minutes')::int),p_action->>'timezone',p_action->>'location',v_title,p_action->>'organizer_email',v_email,p_actor) returning * into event;
  end if;
  v_stage:='interview';
 else
  select * into event from public.hiring_interviews where id=(p_action->>'interview_id')::uuid and submission_id=s.id and org_id=p_org for update;
  if not found or event.status='cancelled' then raise exception 'Interview not found' using errcode='P0002'; end if;
  update public.hiring_interviews set status='cancelled',sequence=sequence+1 where id=event.id returning * into event;
 end if;
 if v_kind='cancel' then
  null; -- Cancellation never changes an applicant's hiring outcome.
 elsif v_stage='hired' then
  perform public.record_hiring_decision(p_org,p_actor,array[s.id],'hired',null,null,false);
 else
  perform public.save_hiring_review(p_org,p_actor,s.id,p_expected,jsonb_build_object('stage',v_stage));
  if s.candidate_id is not null then
   insert into public.candidate_feedback(submission_id,posting_id,org_id,candidate_id,decision,note,created_by,sent_at)
    values(s.id,s.posting_id,p_org,s.candidate_id,'advanced',case when v_kind='cancel' then 'Interview cancelled. The hiring team will follow up.' else 'Your application moved to '||v_stage||'.' end,p_actor,now());
  end if;
 end if;
 if event.id is not null then
  update public.hiring_messages m set status='failed',last_error='superseded_by_calendar_update' where m.org_id=p_org and m.submission_id=s.id and m.status='queued' and m.payload->'event'->>'id'=event.id::text;
 end if;
 v_payload:=jsonb_build_object('kind',v_kind,'to',v_email,'from',p_action->>'from','reply_to',p_action->>'reply_to','copy_to',p_action->>'copy_to','stage',v_stage,'role',v_title,'company',v_org_name,'note',p_action->>'note','event',case when event.id is not null then to_jsonb(event) else null end);
 insert into public.hiring_messages(org_id,submission_id,request_id,action,payload,created_by)
  values(p_org,s.id,p_request,p_action,v_payload,p_actor) returning id into v_id;
 return jsonb_build_object('message_id',v_id,'status','queued','stage',v_stage,'interview_id',event.id,'already_queued',false);
end; $$;
revoke all on function public.queue_hiring_action(uuid,uuid,uuid,timestamptz,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.queue_hiring_action(uuid,uuid,uuid,timestamptz,uuid,jsonb) to service_role;
create function public.claim_hiring_message()
 returns setof public.hiring_messages language sql security invoker set search_path='' as $$
 with due as (
  select m.id from public.hiring_messages m where (m.status='queued' and m.next_attempt_at<=now()) or (m.status='sending' and m.claimed_at<now()-interval '5 minutes')
  order by m.created_at,m.id for update skip locked limit 1
 ) update public.hiring_messages m set status='sending',attempts=m.attempts+1,claimed_at=now(),claim_token=gen_random_uuid(),first_attempt_at=coalesce(m.first_attempt_at,now())
 from due where m.id=due.id returning m.*;
$$;
revoke all on function public.claim_hiring_message() from public,anon,authenticated;
grant execute on function public.claim_hiring_message() to service_role;
notify pgrst,'reload schema';
