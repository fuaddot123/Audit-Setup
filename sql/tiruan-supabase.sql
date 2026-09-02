-- Tiruan minimum bagian Supabase yang dipakai schema.sql
create schema if not exists auth;
create schema if not exists storage;
create role anon;
create role authenticated;
create role service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid
);
alter table storage.objects enable row level security;
