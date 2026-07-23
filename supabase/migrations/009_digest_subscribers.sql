-- 009_digest_subscribers.sql
-- ===========================
-- Weekly job digest — email subscriber storage.
--
-- Deliberately a STANDALONE table, not tied to auth.users. Most digest
-- signups are top-of-funnel (someone lands on the site, wants roles emailed
-- to them, isn't ready to create a full account yet). Requiring login first
-- would lose most of that signal. No password, no auth — just an email +
-- lightweight preferences + an unsubscribe token.

create table if not exists public.digest_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  -- optional targeting, same vocab as the search engine / profiles.country
  country text,              -- e.g. "nigeria" — null = no preference (send everyone-eligible roles)
  role_cluster text,         -- e.g. "Software Engineering" — null = all clusters
  unsubscribe_token uuid not null default gen_random_uuid(),
  confirmed boolean not null default true,  -- reserved for future double opt-in
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);

-- One subscription per email (re-signup just updates preferences, doesn't duplicate)
create unique index if not exists digest_subscribers_email_idx
  on public.digest_subscribers (lower(email));

create index if not exists digest_subscribers_country_idx
  on public.digest_subscribers (country) where country is not null;

alter table public.digest_subscribers enable row level security;

-- No public read/write policy — this table is written ONLY via the backend's
-- service_role key (the /digest/subscribe endpoint), never directly from the
-- client. Keeps subscriber emails from being scrapeable via the anon key.
