-- Minimal stand-ins for the parts of Supabase that the BuildWise migration depends on, so the real migration file
-- (supabase/migrations/*.sql) can be exercised on a plain PostgreSQL server. Test use only.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant select on auth.users to authenticated;   -- needed for the foreign keys' checks, like on Supabase

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare parts text[]; begin parts := string_to_array(name, '/'); return parts[1:array_length(parts, 1) - 1]; end $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
