// Isolated fixtures only. Never reads env vars or connects to a remote database.
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
export const fixtureId=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function createHiringDb() {
 const db=new PGlite();
 await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role bypassrls;
 create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
 create table public.profiles(id uuid primary key,cv_skills text[],cv_years integer,country text,availability text);
 create table public.jobs(id uuid primary key default gen_random_uuid(),source text,ats_source text,company text,title text,description text,location text,apply_url text unique,remote boolean,remote_type text,role_cluster text,seniority text,employment_type text,salary_min integer,salary_max integer,posted_at timestamptz,last_seen_at timestamptz,link_status text,link_checked_at timestamptz,elig_signals jsonb);
 create table public.applications(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),job_id uuid references public.jobs(id),job_title text,company text,location text,salary_min integer,salary_max integer,source text,status text,role_cluster text,applied_at timestamptz,apply_clicked_at timestamptz,apply_outcome text,outcome_at timestamptz);
 create table public.saved_cvs(user_id uuid primary key references auth.users(id),cv_text text,filename text);
 create function public.touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;`);
 for(const path of ['015a_employer_tables.sql','015b_employer_constraints.sql','015c_employer_rls.sql','016_ats_drafting_and_uploads.sql','20261022195717_employer_review_workspace.sql','20261022213129_recruiter_semantic_matching.sql','20261022212959_recruiter_candidate_documents.sql']) {
  await db.exec(await readFile(new URL('../../supabase/migrations/'+path,import.meta.url),'utf8'));
 }
 const id=fixtureId;
 await db.query('insert into auth.users(id) values ($1),($2)',[id(1),id(8)]);
 await db.query('insert into profiles(id,cv_skills,cv_years,country,availability) values ($1,$2,3,$3,$4)',[id(8),['SQL'],'nigeria','immediately']);
 await db.query('insert into employer_orgs(id,name,created_by) values ($1,$2,$3),($4,$5,$3)',[id(2),'Example Hiring Team',id(1),id(9),'Other Employer']);
 await db.query('insert into employer_members(org_id,user_id,role) values ($1,$2,$3)',[id(2),id(1),'owner']);
 return db;
}
