-- DoorFlow Phase 2.2A Data Integrity / venue_id Autofill
--
-- REVIEW ONLY.
-- Review this file before running it in the live Supabase SQL Editor.
--
-- This script is intentionally limited to data-integrity trigger functions and
-- triggers for operational DoorFlow tables. It does not enable/disable RLS,
-- create/drop/alter RLS policies, change doorflow_has_role, or touch billing,
-- branding, subscription, or SaaS admin tables.
--
-- Goal:
-- Keep venue_id populated on new/updated operational rows when the current app
-- writes parent IDs but does not explicitly write venue_id.


-- groups.venue_id
-- If a group is inserted/updated without venue_id, derive it from the linked
-- service_days.venue_id via groups.service_day_id. If the parent row cannot be
-- found, leave NEW.venue_id unchanged so this trigger does not block the write.
create or replace function public.doorflow_autofill_group_venue_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.venue_id is null and new.service_day_id is not null then
    select service_day.venue_id
      into new.venue_id
    from public.service_days service_day
    where service_day.id = new.service_day_id
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists doorflow_autofill_group_venue_id_trigger on public.groups;

create trigger doorflow_autofill_group_venue_id_trigger
before insert or update on public.groups
for each row
execute function public.doorflow_autofill_group_venue_id();


-- guests.venue_id
-- If a guest is inserted/updated without venue_id, derive it from the linked
-- groups.venue_id via guests.group_id. If the parent row cannot be found, leave
-- NEW.venue_id unchanged so this trigger does not block the write.
create or replace function public.doorflow_autofill_guest_venue_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.venue_id is null and new.group_id is not null then
    select guest_group.venue_id
      into new.venue_id
    from public.groups guest_group
    where guest_group.id = new.group_id
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists doorflow_autofill_guest_venue_id_trigger on public.guests;

create trigger doorflow_autofill_guest_venue_id_trigger
before insert or update on public.guests
for each row
execute function public.doorflow_autofill_guest_venue_id();


-- check_in_logs.venue_id
-- If a log is inserted/updated without venue_id, derive it from guests.venue_id
-- when guest_id is present. If that is unavailable, derive it from
-- groups.venue_id via group_id. If no parent venue_id can be found, leave
-- NEW.venue_id unchanged so this trigger does not block the write.
create or replace function public.doorflow_autofill_check_in_log_venue_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.venue_id is null and new.guest_id is not null then
    select guest.venue_id
      into new.venue_id
    from public.guests guest
    where guest.id = new.guest_id
    limit 1;
  end if;

  if new.venue_id is null and new.group_id is not null then
    select guest_group.venue_id
      into new.venue_id
    from public.groups guest_group
    where guest_group.id = new.group_id
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists doorflow_autofill_check_in_log_venue_id_trigger on public.check_in_logs;

create trigger doorflow_autofill_check_in_log_venue_id_trigger
before insert or update on public.check_in_logs
for each row
execute function public.doorflow_autofill_check_in_log_venue_id();


-- shift_notes.venue_id
-- If a shift note is inserted/updated without venue_id, derive it from the
-- linked service_days.venue_id via shift_notes.service_day_id. If the parent row
-- cannot be found, leave NEW.venue_id unchanged so this trigger does not block
-- the write.
create or replace function public.doorflow_autofill_shift_note_venue_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.venue_id is null and new.service_day_id is not null then
    select service_day.venue_id
      into new.venue_id
    from public.service_days service_day
    where service_day.id = new.service_day_id
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists doorflow_autofill_shift_note_venue_id_trigger on public.shift_notes;

create trigger doorflow_autofill_shift_note_venue_id_trigger
before insert or update on public.shift_notes
for each row
execute function public.doorflow_autofill_shift_note_venue_id();


-- Read-only post-check queries for manual review after running this file:
--
-- select 'groups' as table_name, count(*) as missing_venue_id
-- from public.groups
-- where venue_id is null
-- union all
-- select 'guests', count(*)
-- from public.guests
-- where venue_id is null
-- union all
-- select 'check_in_logs', count(*)
-- from public.check_in_logs
-- where venue_id is null
-- union all
-- select 'shift_notes', count(*)
-- from public.shift_notes
-- where venue_id is null;
--
-- select count(*) as mismatched_group_venue_ids
-- from public.groups item
-- join public.service_days service_day on service_day.id = item.service_day_id
-- where item.venue_id is distinct from service_day.venue_id;
--
-- select count(*) as mismatched_guest_venue_ids
-- from public.guests item
-- join public.groups guest_group on guest_group.id = item.group_id
-- where item.venue_id is distinct from guest_group.venue_id;
--
-- select count(*) as mismatched_shift_note_venue_ids
-- from public.shift_notes item
-- join public.service_days service_day on service_day.id = item.service_day_id
-- where item.venue_id is distinct from service_day.venue_id;
--
-- select count(*) as mismatched_check_in_log_guest_venue_ids
-- from public.check_in_logs item
-- join public.guests guest on guest.id = item.guest_id
-- where item.venue_id is distinct from guest.venue_id;
--
-- select count(*) as mismatched_check_in_log_group_venue_ids
-- from public.check_in_logs item
-- join public.groups guest_group on guest_group.id = item.group_id
-- where item.guest_id is null
--   and item.venue_id is distinct from guest_group.venue_id;
