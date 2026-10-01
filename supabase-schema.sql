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

create table if not exists public.calendar_attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  event_key text not null,
  status text not null check (status in ('present', 'absent')),
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
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
alter table public.calendar_attendance enable row level security;

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

drop policy if exists "Users can view their own calendar attendance" on public.calendar_attendance;
create policy "Users can view their own calendar attendance"
on public.calendar_attendance
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own calendar attendance" on public.calendar_attendance;
create policy "Users can insert their own calendar attendance"
on public.calendar_attendance
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.subjects s
    where s.id = calendar_attendance.subject_id
      and s.user_id = auth.uid()
  )
);

create or replace function public.mark_calendar_attendance(
  p_subject_id uuid,
  p_event_key text,
  p_status text
)
returns table (
  subject_id uuid,
  subject_name text,
  total_classes integer,
  attended_classes integer,
  target_percentage numeric,
  attendance_status text,
  inserted boolean
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_inserted boolean := false;
  v_status text;
  v_subject public.subjects%rowtype;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to mark attendance.';
  end if;

  if p_status not in ('present', 'absent') then
    raise exception 'Attendance status must be present or absent.';
  end if;

  if p_event_key is null or length(trim(p_event_key)) = 0 then
    raise exception 'A calendar event key is required.';
  end if;

  insert into public.calendar_attendance (user_id, subject_id, event_key, status)
  values (v_user_id, p_subject_id, p_event_key, p_status)
  on conflict (user_id, event_key) do nothing
  returning true into v_inserted;

  if coalesce(v_inserted, false) then
    update public.subjects as subject
    set total_classes = subject.total_classes + 1,
        attended_classes = subject.attended_classes
          + case when p_status = 'present' then 1 else 0 end
    where subject.id = p_subject_id
      and subject.user_id = v_user_id
    returning subject.* into v_subject;

    if not found then
      raise exception 'Subject not found or not owned by the signed-in user.';
    end if;

    v_status := p_status;
  else
    select ca.status
    into v_status
    from public.calendar_attendance ca
    where ca.user_id = v_user_id
      and ca.event_key = p_event_key
      and ca.subject_id = p_subject_id;

    if not found then
      raise exception 'This calendar class was already recorded for a different subject.';
    end if;

    select s.*
    into v_subject
    from public.subjects s
    where s.id = p_subject_id
      and s.user_id = v_user_id;

    if not found then
      raise exception 'Subject not found or not owned by the signed-in user.';
    end if;
  end if;

  return query
  select
    v_subject.id,
    v_subject.subject_name,
    v_subject.total_classes,
    v_subject.attended_classes,
    v_subject.target_percentage,
    v_status,
    coalesce(v_inserted, false);
end;
$$;

grant execute on function public.mark_calendar_attendance(uuid, text, text) to authenticated;

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
