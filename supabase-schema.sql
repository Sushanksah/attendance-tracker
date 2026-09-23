-- Attendance Tracker database schema for Supabase
-- Run this in the Supabase SQL editor

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  prn_number text,
  university_email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists prn_number text;
alter table public.profiles add column if not exists university_email text;
alter table public.profiles add column if not exists avatar_url text;

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_name text not null,
  total_classes integer not null check (total_classes > 0),
  attended_classes integer not null default 0 check (attended_classes >= 0),
  target_percentage numeric(5,2) not null default 75 check (target_percentage >= 0 and target_percentage <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  action text not null check (action in ('add', 'update', 'delete')),
  attended_classes integer not null default 0,
  total_classes integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do update
    set full_name = excluded.full_name,
        updated_at = now();

  return new;
end;
$$;

create or replace trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trigger_profiles_updated_at on public.profiles;
create trigger trigger_profiles_updated_at
before update on public.profiles
for each row execute procedure public.update_updated_at();

drop trigger if exists trigger_subjects_updated_at on public.subjects;
create trigger trigger_subjects_updated_at
before update on public.subjects
for each row execute procedure public.update_updated_at();

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.attendance_logs enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "Users can view their own subjects" on public.subjects;
create policy "Users can view their own subjects"
on public.subjects
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own subjects" on public.subjects;
create policy "Users can insert their own subjects"
on public.subjects
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own subjects" on public.subjects;
create policy "Users can update their own subjects"
on public.subjects
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own subjects" on public.subjects;
create policy "Users can delete their own subjects"
on public.subjects
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can view their own attendance logs" on public.attendance_logs;
create policy "Users can view their own attendance logs"
on public.attendance_logs
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own attendance logs" on public.attendance_logs;
create policy "Users can insert their own attendance logs"
on public.attendance_logs
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own attendance logs" on public.attendance_logs;
create policy "Users can update their own attendance logs"
on public.attendance_logs
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own attendance logs" on public.attendance_logs;
create policy "Users can delete their own attendance logs"
on public.attendance_logs
for delete
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "Users can upload their own profile photo" on storage.objects;
create policy "Users can upload their own profile photo"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users can update their own profile photo" on storage.objects;
create policy "Users can update their own profile photo"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users can view their own profile photo" on storage.objects;
create policy "Users can view their own profile photo"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users can delete their own profile photo" on storage.objects;
create policy "Users can delete their own profile photo"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- Optional helper view for easy dashboard usage
create or replace view public.user_subject_summary as
select
  s.user_id,
  s.id as subject_id,
  s.subject_name,
  s.total_classes,
  s.attended_classes,
  round((s.attended_classes::numeric / s.total_classes) * 100, 2) as attendance_percentage,
  s.target_percentage,
  case
    when ((s.attended_classes::numeric / s.total_classes) * 100) >= s.target_percentage then 'Safe'
    when ((s.attended_classes::numeric / s.total_classes) * 100) >= (s.target_percentage - 5) then 'Warning'
    else 'Below target'
  end as status
from public.subjects s;
