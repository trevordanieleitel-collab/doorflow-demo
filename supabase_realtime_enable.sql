-- DoorFlow Supabase Realtime Enable Script
-- Run this once in Supabase SQL Editor if devices still do not update live after deploying v6.
-- It safely adds DoorFlow tables to the Supabase realtime publication if they are not already included.

alter table if exists public.guests replica identity full;
alter table if exists public.groups replica identity full;
alter table if exists public.check_in_logs replica identity full;
alter table if exists public.shift_notes replica identity full;
alter table if exists public.service_days replica identity full;
alter table if exists public.staff_profiles replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'guests'
  ) then
    execute 'alter publication supabase_realtime add table public.guests';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'groups'
  ) then
    execute 'alter publication supabase_realtime add table public.groups';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'check_in_logs'
  ) then
    execute 'alter publication supabase_realtime add table public.check_in_logs';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_notes'
  ) then
    execute 'alter publication supabase_realtime add table public.shift_notes';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_days'
  ) then
    execute 'alter publication supabase_realtime add table public.service_days';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_profiles'
  ) then
    execute 'alter publication supabase_realtime add table public.staff_profiles';
  end if;
end $$;
