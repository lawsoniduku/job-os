insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('hiring-cvs','hiring-cvs',false,5242880,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
 on conflict(id) do nothing;
create table public.hiring_documents (
 submission_id uuid primary key,
 org_id uuid not null,
 path text not null unique,
 filename text not null,
 mime text not null check(mime in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain')),
 size integer not null check(size between 1 and 5242880),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 uploaded_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 foreign key(submission_id,org_id) references public.posting_submissions(id,org_id) on delete cascade
);
alter table public.hiring_documents enable row level security;
revoke all on public.hiring_documents from public,anon,authenticated;
grant select,insert,update,delete on public.hiring_documents to service_role;
-- No Storage policies: originals are accessed only through tenant-scoped API routes.
create function public.add_hiring_upload(p_org uuid,p_actor uuid,p_posting uuid,p_text text,p_filename text)
 returns table(id uuid,added boolean) language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 if not exists(select 1 from public.employer_members where org_id=p_org and user_id=p_actor) then raise exception 'Membership required' using errcode='42501'; end if;
 if not exists(select 1 from public.job_postings p where p.id=p_posting and p.org_id=p_org) then raise exception 'Posting not found' using errcode='P0002'; end if;
 if p_text is null or length(btrim(p_text))<80 or length(p_text)>50000 then raise exception 'Unreadable CV' using errcode='23514'; end if;
 -- Serialize this posting's import so concurrent retries cannot duplicate a CV.
 perform pg_advisory_xact_lock(hashtextextended(p_posting::text,0));
 select s.id into v_id from public.posting_submissions s where s.posting_id=p_posting and s.org_id=p_org and s.source='upload'
  and regexp_replace(lower(s.cv_text),'\s+','','g')=regexp_replace(lower(p_text),'\s+','','g') order by s.created_at limit 1;
 if found then return query select v_id,false; return; end if;
 insert into public.posting_submissions(posting_id,org_id,source,cv_text,cv_filename,uploaded_by,stage,score_status)
  values(p_posting,p_org,'upload',p_text,left(p_filename,200),p_actor,'new','pending') returning posting_submissions.id into v_id;
 return query select v_id,true;
end; $$;
revoke all on function public.add_hiring_upload(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.add_hiring_upload(uuid,uuid,uuid,text,text) to service_role;
create function public.hiring_posting_counts(p_org uuid,p_actor uuid)
 returns table(posting_id uuid,counts jsonb) language sql security invoker set search_path='' as $$
 select s.posting_id,jsonb_build_object('total',count(*),'awaiting',count(*) filter(where s.stage in ('new','screening')),
  'new',count(*) filter(where s.stage='new'),'screening',count(*) filter(where s.stage='screening'),
  'shortlisted',count(*) filter(where s.stage='shortlisted'),'interview',count(*) filter(where s.stage='interview'),
  'offer',count(*) filter(where s.stage='offer'),'hired',count(*) filter(where s.stage='hired'))
 from public.posting_submissions s where s.org_id=p_org and exists(select 1 from public.employer_members m where m.org_id=p_org and m.user_id=p_actor)
 group by s.posting_id;
$$;
revoke all on function public.hiring_posting_counts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.hiring_posting_counts(uuid,uuid) to service_role;
