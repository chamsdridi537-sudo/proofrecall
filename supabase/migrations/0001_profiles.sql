-- ProofRecall Day 2: profiles table + signup trigger + RLS
-- Source of truth for the schema. Executed in Supabase SQL Editor on 2026-09-18.
-- This project was created with "Automatically expose new tables" DISABLED,
-- so every table needs explicit grants to the Data API roles.
--
-- The drops at the top make this file re-runnable. The editor's destructive-
-- operations prompt is expected.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.profiles;

-- 1. Profiles: one row per signed-up user
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Keep updated_at accurate automatically
create extension if not exists moddatetime;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function moddatetime(updated_at);

-- 3. Auto-create the profile the moment someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. RLS: the lock. Default = deny everything.
alter table public.profiles enable row level security;

-- Owner can read only their own row
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- Owner can update only their own row
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 5. Explicit grants (required: auto-expose is disabled on this project)
grant usage on schema public to anon, authenticated;
-- anon needs SELECT so anonymous calls return 0 rows (not permission errors);
-- RLS policies still guarantee it never sees a single row.
grant select on public.profiles to anon, authenticated;
-- authenticated users can read + update their own row (enforced by RLS above)
grant select, update on public.profiles to authenticated;
