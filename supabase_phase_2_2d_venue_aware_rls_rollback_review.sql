-- DoorFlow Phase 2.2D Venue-Aware RLS Rollback Review
--
-- REVIEW ONLY - DO NOT RUN AS A MIGRATION.
--
-- This file is intentionally inert for live policy changes. Active executable
-- SQL in this file is SELECT-only. All DROP POLICY, CREATE POLICY, BEGIN,
-- COMMIT, and SET LOCAL statements are commented out on purpose.
--
-- Rollback source:
-- - phase_2_2d_current_policy_snapshot.csv
-- - The snapshot contains exactly 20 current policies.
-- - Original policy definitions below are copied from that snapshot.
--
-- Scope:
-- - This rollback file restores RLS policies only.
-- - It does not reverse application data changes.
-- - The Phase 2.2D rollout is not designed to modify application data.
--
-- To roll back later during a quiet window:
-- 1. Select only the stage for the table that was just rolled out.
-- 2. Remove leading "-- " comments for that one stage only.
-- 3. Run the one stage.
-- 4. Run its inventory query.
-- 5. Browser-test the affected workflow before doing anything else.
--
-- Emergency priority:
-- - If login/bootstrap breaks, run the staff_profiles emergency rollback first.
-- - If venue loading breaks, run the venues rollback next.


/* -------------------------------------------------------------------------- */
/* SELECT-ONLY ROLLBACK PREFLIGHT                                              */
/* -------------------------------------------------------------------------- */

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'staff_profiles',
    'venues',
    'service_days',
    'groups',
    'guests',
    'check_in_logs',
    'shift_notes'
  )
order by tablename, policyname, cmd;

select
  count(*) as old_policy_count_present
from pg_policies
where schemaname = 'public'
  and policyname in (
    'Authenticated users can delete shift notes',
    'Authenticated users can insert shift notes',
    'Authenticated users can read shift notes',
    'Authenticated users can update shift notes',
    'doorflow admins managers can delete check in logs',
    'doorflow admins managers door can insert check in logs',
    'doorflow staff can read check in logs',
    'doorflow admins managers can delete guests',
    'doorflow admins managers can insert guests',
    'doorflow admins managers door can update guests',
    'doorflow staff can read guests',
    'doorflow admins managers can manage groups',
    'doorflow staff can read groups',
    'doorflow admins managers can manage service days',
    'doorflow staff can read service days',
    'doorflow admins managers can manage venues',
    'doorflow staff can read venues',
    'doorflow admins can manage profiles',
    'doorflow admins can read all profiles',
    'doorflow staff can read own profile'
  );

select
  count(*) as new_policy_count_present
from pg_policies
where schemaname = 'public'
  and policyname in (
    'doorflow shift_notes select own venue',
    'doorflow shift_notes insert managers own venue',
    'doorflow shift_notes update managers own venue',
    'doorflow shift_notes delete managers own venue',
    'doorflow check_in_logs select own venue',
    'doorflow check_in_logs insert operational own venue',
    'doorflow guests select own venue',
    'doorflow guests insert managers own venue',
    'doorflow guests update operational own venue',
    'doorflow guests delete managers own venue',
    'doorflow groups select own venue',
    'doorflow groups insert managers own venue',
    'doorflow groups update managers own venue',
    'doorflow groups delete managers own venue',
    'doorflow service_days select own venue',
    'doorflow service_days insert managers own venue',
    'doorflow service_days update managers own venue',
    'doorflow service_days delete managers own venue',
    'doorflow venues select own venue',
    'doorflow staff_profiles select self or own venue admins',
    'doorflow staff_profiles update own venue admins'
  );


/* -------------------------------------------------------------------------- */
/* EMERGENCY ROLLBACK STAGE 1: staff_profiles                                  */
/* -------------------------------------------------------------------------- */

-- Use first if login/bootstrap, helper evaluation, or Staff Management breaks.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow staff_profiles select self or own venue admins" on public.staff_profiles;
-- drop policy if exists "doorflow staff_profiles update own venue admins" on public.staff_profiles;
--
-- drop policy if exists "doorflow admins can manage profiles" on public.staff_profiles;
-- drop policy if exists "doorflow admins can read all profiles" on public.staff_profiles;
-- drop policy if exists "doorflow staff can read own profile" on public.staff_profiles;
--
-- create policy "doorflow admins can manage profiles" on public.staff_profiles as permissive for all to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text]))
-- with check (doorflow_has_role(ARRAY['admin'::text]));
--
-- create policy "doorflow admins can read all profiles" on public.staff_profiles as permissive for select to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text]));
--
-- create policy "doorflow staff can read own profile" on public.staff_profiles as permissive for select to authenticated
-- using ((id = auth.uid()));
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'staff_profiles'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   restored_count integer;
--   replacement_count integer;
--   table_count integer;
-- begin
--   select count(*) into restored_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'staff_profiles'
--     and policyname in (
--       'doorflow admins can manage profiles',
--       'doorflow admins can read all profiles',
--       'doorflow staff can read own profile'
--     );
--
--   select count(*) into replacement_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'staff_profiles'
--     and policyname in (
--       'doorflow staff_profiles select self or own venue admins',
--       'doorflow staff_profiles update own venue admins'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'staff_profiles';
--
--   if restored_count <> 3 or replacement_count <> 0 or table_count <> 3 then
--     raise exception 'staff_profiles rollback policy assertion failed: restored=%, replacement=%, total=%',
--       restored_count, replacement_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser test:
-- - Admin login works.
-- - Manager login works.
-- - Door login works.
-- - Admin Staff Management loads.
-- STOP CONDITION: If this does not restore login, stop and inspect helper functions and staff_profiles data.


/* -------------------------------------------------------------------------- */
/* ROLLBACK STAGE 2: venues                                                    */
/* -------------------------------------------------------------------------- */

-- Use if venue loading or EVE bootstrap breaks after the venues rollout stage.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow venues select own venue" on public.venues;
--
-- drop policy if exists "doorflow admins managers can manage venues" on public.venues;
-- drop policy if exists "doorflow staff can read venues" on public.venues;
--
-- create policy "doorflow admins managers can manage venues" on public.venues as permissive for all to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]))
-- with check (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
--
-- create policy "doorflow staff can read venues" on public.venues as permissive for select to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'venues'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   restored_count integer;
--   replacement_count integer;
--   table_count integer;
-- begin
--   select count(*) into restored_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'venues'
--     and policyname in (
--       'doorflow admins managers can manage venues',
--       'doorflow staff can read venues'
--     );
--
--   select count(*) into replacement_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'venues'
--     and policyname in (
--       'doorflow venues select own venue'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'venues';
--
--   if restored_count <> 2 or replacement_count <> 0 or table_count <> 2 then
--     raise exception 'venues rollback policy assertion failed: restored=%, replacement=%, total=%',
--       restored_count, replacement_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser test:
-- - Logout and login as admin, manager, and door.
-- - Confirm EVE loads.
-- STOP CONDITION: If venue loading still fails, stop and inspect venues data and staff_profiles.venue_id.


/* -------------------------------------------------------------------------- */
/* ROLLBACK STAGE 3: service_days                                              */
/* -------------------------------------------------------------------------- */

-- Use if service date loading or admin/manager date creation breaks.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow service_days select own venue" on public.service_days;
-- drop policy if exists "doorflow service_days insert managers own venue" on public.service_days;
-- drop policy if exists "doorflow service_days update managers own venue" on public.service_days;
-- drop policy if exists "doorflow service_days delete managers own venue" on public.service_days;
--
-- drop policy if exists "doorflow admins managers can manage service days" on public.service_days;
-- drop policy if exists "doorflow staff can read service days" on public.service_days;
--
-- create policy "doorflow admins managers can manage service days" on public.service_days as permissive for all to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]))
-- with check (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
--
-- create policy "doorflow staff can read service days" on public.service_days as permissive for select to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'service_days'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   restored_count integer;
--   replacement_count integer;
--   table_count integer;
-- begin
--   select count(*) into restored_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'service_days'
--     and policyname in (
--       'doorflow admins managers can manage service days',
--       'doorflow staff can read service days'
--     );
--
--   select count(*) into replacement_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'service_days'
--     and policyname in (
--       'doorflow service_days select own venue',
--       'doorflow service_days insert managers own venue',
--       'doorflow service_days update managers own venue',
--       'doorflow service_days delete managers own venue'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'service_days';
--
--   if restored_count <> 2 or replacement_count <> 0 or table_count <> 2 then
--     raise exception 'service_days rollback policy assertion failed: restored=%, replacement=%, total=%',
--       restored_count, replacement_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser test:
-- - Admin/manager can load current date and create a future test date.
-- - Door can load an existing date.
-- STOP CONDITION: If date loading still fails, roll back venues and staff_profiles if they were already rolled out.


/* -------------------------------------------------------------------------- */
/* ROLLBACK STAGE 4: groups                                                    */
/* -------------------------------------------------------------------------- */

-- Use if party/group loading, creation, editing, or deletion breaks.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow groups select own venue" on public.groups;
-- drop policy if exists "doorflow groups insert managers own venue" on public.groups;
-- drop policy if exists "doorflow groups update managers own venue" on public.groups;
-- drop policy if exists "doorflow groups delete managers own venue" on public.groups;
--
-- drop policy if exists "doorflow admins managers can manage groups" on public.groups;
-- drop policy if exists "doorflow staff can read groups" on public.groups;
--
-- create policy "doorflow admins managers can manage groups" on public.groups as permissive for all to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]))
-- with check (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
--
-- create policy "doorflow staff can read groups" on public.groups as permissive for select to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'groups'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   restored_count integer;
--   replacement_count integer;
--   table_count integer;
-- begin
--   select count(*) into restored_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'groups'
--     and policyname in (
--       'doorflow admins managers can manage groups',
--       'doorflow staff can read groups'
--     );
--
--   select count(*) into replacement_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'groups'
--     and policyname in (
--       'doorflow groups select own venue',
--       'doorflow groups insert managers own venue',
--       'doorflow groups update managers own venue',
--       'doorflow groups delete managers own venue'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'groups';
--
--   if restored_count <> 2 or replacement_count <> 0 or table_count <> 2 then
--     raise exception 'groups rollback policy assertion failed: restored=%, replacement=%, total=%',
--       restored_count, replacement_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser test:
-- - Admin/manager can create, edit, and delete a test party.
-- - Door can load party list.
-- STOP CONDITION: If group behavior still fails, roll back service_days if it was already rolled out.


/* -------------------------------------------------------------------------- */
/* ROLLBACK STAGE 5: guests                                                    */
/* -------------------------------------------------------------------------- */

-- Use if guest loading, creation, editing, deletion, check-in, or undo breaks.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow guests select own venue" on public.guests;
-- drop policy if exists "doorflow guests insert managers own venue" on public.guests;
-- drop policy if exists "doorflow guests update operational own venue" on public.guests;
-- drop policy if exists "doorflow guests delete managers own venue" on public.guests;
--
-- drop policy if exists "doorflow admins managers can delete guests" on public.guests;
-- drop policy if exists "doorflow admins managers can insert guests" on public.guests;
-- drop policy if exists "doorflow admins managers door can update guests" on public.guests;
-- drop policy if exists "doorflow staff can read guests" on public.guests;
--
-- create policy "doorflow admins managers can delete guests" on public.guests as permissive for delete to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
--
-- create policy "doorflow admins managers can insert guests" on public.guests as permissive for insert to authenticated
-- with check (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
--
-- create policy "doorflow staff can read guests" on public.guests as permissive for select to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
--
-- create policy "doorflow admins managers door can update guests" on public.guests as permissive for update to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text]))
-- with check (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text]));
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'guests'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   restored_count integer;
--   replacement_count integer;
--   table_count integer;
-- begin
--   select count(*) into restored_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'guests'
--     and policyname in (
--       'doorflow admins managers can delete guests',
--       'doorflow admins managers can insert guests',
--       'doorflow admins managers door can update guests',
--       'doorflow staff can read guests'
--     );
--
--   select count(*) into replacement_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'guests'
--     and policyname in (
--       'doorflow guests select own venue',
--       'doorflow guests insert managers own venue',
--       'doorflow guests update operational own venue',
--       'doorflow guests delete managers own venue'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'guests';
--
--   if restored_count <> 4 or replacement_count <> 0 or table_count <> 4 then
--     raise exception 'guests rollback policy assertion failed: restored=%, replacement=%, total=%',
--       restored_count, replacement_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser test:
-- - Admin/manager can add, edit, and delete a test guest.
-- - Door can Check In 1 and Undo 1.
-- STOP CONDITION: If guest behavior still fails, roll back groups and check_in_logs if either was already rolled out.


/* -------------------------------------------------------------------------- */
/* ROLLBACK STAGE 6: check_in_logs                                             */
/* -------------------------------------------------------------------------- */

-- Use if check-in/undo audit logging or check-in history loading breaks.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow check_in_logs select own venue" on public.check_in_logs;
-- drop policy if exists "doorflow check_in_logs insert operational own venue" on public.check_in_logs;
--
-- drop policy if exists "doorflow admins managers can delete check in logs" on public.check_in_logs;
-- drop policy if exists "doorflow admins managers door can insert check in logs" on public.check_in_logs;
-- drop policy if exists "doorflow staff can read check in logs" on public.check_in_logs;
--
-- create policy "doorflow admins managers can delete check in logs" on public.check_in_logs as permissive for delete to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
--
-- create policy "doorflow admins managers door can insert check in logs" on public.check_in_logs as permissive for insert to authenticated
-- with check (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text]));
--
-- create policy "doorflow staff can read check in logs" on public.check_in_logs as permissive for select to authenticated
-- using (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'check_in_logs'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   restored_count integer;
--   replacement_count integer;
--   table_count integer;
-- begin
--   select count(*) into restored_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'check_in_logs'
--     and policyname in (
--       'doorflow admins managers can delete check in logs',
--       'doorflow admins managers door can insert check in logs',
--       'doorflow staff can read check in logs'
--     );
--
--   select count(*) into replacement_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'check_in_logs'
--     and policyname in (
--       'doorflow check_in_logs select own venue',
--       'doorflow check_in_logs insert operational own venue'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'check_in_logs';
--
--   if restored_count <> 3 or replacement_count <> 0 or table_count <> 3 then
--     raise exception 'check_in_logs rollback policy assertion failed: restored=%, replacement=%, total=%',
--       restored_count, replacement_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser test:
-- - Door can Check In 1 and Undo 1.
-- - Recent check-in history loads after refresh.
-- STOP CONDITION: If logs still fail, roll back guests if it was already rolled out.


/* -------------------------------------------------------------------------- */
/* ROLLBACK STAGE 7: shift_notes                                               */
/* -------------------------------------------------------------------------- */

-- Use if shift note reading, creation, editing, or deletion breaks.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow shift_notes select own venue" on public.shift_notes;
-- drop policy if exists "doorflow shift_notes insert managers own venue" on public.shift_notes;
-- drop policy if exists "doorflow shift_notes update managers own venue" on public.shift_notes;
-- drop policy if exists "doorflow shift_notes delete managers own venue" on public.shift_notes;
--
-- drop policy if exists "Authenticated users can delete shift notes" on public.shift_notes;
-- drop policy if exists "Authenticated users can insert shift notes" on public.shift_notes;
-- drop policy if exists "Authenticated users can read shift notes" on public.shift_notes;
-- drop policy if exists "Authenticated users can update shift notes" on public.shift_notes;
--
-- create policy "Authenticated users can delete shift notes" on public.shift_notes as permissive for delete to authenticated
-- using (true);
--
-- create policy "Authenticated users can insert shift notes" on public.shift_notes as permissive for insert to authenticated
-- with check (true);
--
-- create policy "Authenticated users can read shift notes" on public.shift_notes as permissive for select to authenticated
-- using (true);
--
-- create policy "Authenticated users can update shift notes" on public.shift_notes as permissive for update to authenticated
-- using (true)
-- with check (true);
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'shift_notes'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   restored_count integer;
--   replacement_count integer;
--   table_count integer;
-- begin
--   select count(*) into restored_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'shift_notes'
--     and policyname in (
--       'Authenticated users can delete shift notes',
--       'Authenticated users can insert shift notes',
--       'Authenticated users can read shift notes',
--       'Authenticated users can update shift notes'
--     );
--
--   select count(*) into replacement_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'shift_notes'
--     and policyname in (
--       'doorflow shift_notes select own venue',
--       'doorflow shift_notes insert managers own venue',
--       'doorflow shift_notes update managers own venue',
--       'doorflow shift_notes delete managers own venue'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'shift_notes';
--
--   if restored_count <> 4 or replacement_count <> 0 or table_count <> 4 then
--     raise exception 'shift_notes rollback policy assertion failed: restored=%, replacement=%, total=%',
--       restored_count, replacement_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser test:
-- - Door can read shift notes.
-- - Admin/manager can add, edit, and delete shift notes.
-- STOP CONDITION: If shift notes still fail, stop and inspect shift_notes.service_day_id and venue_id data.


/* -------------------------------------------------------------------------- */
/* POST-ROLLBACK SQL VERIFICATION                                              */
/* -------------------------------------------------------------------------- */

select
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'staff_profiles',
    'venues',
    'service_days',
    'groups',
    'guests',
    'check_in_logs',
    'shift_notes'
  )
order by tablename, policyname, cmd;

select
  policyname as venue_aware_policy_still_present
from pg_policies
where schemaname = 'public'
  and policyname in (
    'doorflow shift_notes select own venue',
    'doorflow shift_notes insert managers own venue',
    'doorflow shift_notes update managers own venue',
    'doorflow shift_notes delete managers own venue',
    'doorflow check_in_logs select own venue',
    'doorflow check_in_logs insert operational own venue',
    'doorflow guests select own venue',
    'doorflow guests insert managers own venue',
    'doorflow guests update operational own venue',
    'doorflow guests delete managers own venue',
    'doorflow groups select own venue',
    'doorflow groups insert managers own venue',
    'doorflow groups update managers own venue',
    'doorflow groups delete managers own venue',
    'doorflow service_days select own venue',
    'doorflow service_days insert managers own venue',
    'doorflow service_days update managers own venue',
    'doorflow service_days delete managers own venue',
    'doorflow venues select own venue',
    'doorflow staff_profiles select self or own venue admins',
    'doorflow staff_profiles update own venue admins'
  )
order by policyname;

select
  count(*) as remaining_venue_aware_policy_count
from pg_policies
where schemaname = 'public'
  and policyname in (
    'doorflow shift_notes select own venue',
    'doorflow shift_notes insert managers own venue',
    'doorflow shift_notes update managers own venue',
    'doorflow shift_notes delete managers own venue',
    'doorflow check_in_logs select own venue',
    'doorflow check_in_logs insert operational own venue',
    'doorflow guests select own venue',
    'doorflow guests insert managers own venue',
    'doorflow guests update operational own venue',
    'doorflow guests delete managers own venue',
    'doorflow groups select own venue',
    'doorflow groups insert managers own venue',
    'doorflow groups update managers own venue',
    'doorflow groups delete managers own venue',
    'doorflow service_days select own venue',
    'doorflow service_days insert managers own venue',
    'doorflow service_days update managers own venue',
    'doorflow service_days delete managers own venue',
    'doorflow venues select own venue',
    'doorflow staff_profiles select self or own venue admins',
    'doorflow staff_profiles update own venue admins'
  );

select
  count(*) as restored_old_policy_count
from pg_policies
where schemaname = 'public'
  and policyname in (
    'Authenticated users can delete shift notes',
    'Authenticated users can insert shift notes',
    'Authenticated users can read shift notes',
    'Authenticated users can update shift notes',
    'doorflow admins managers can delete check in logs',
    'doorflow admins managers door can insert check in logs',
    'doorflow staff can read check in logs',
    'doorflow admins managers can delete guests',
    'doorflow admins managers can insert guests',
    'doorflow admins managers door can update guests',
    'doorflow staff can read guests',
    'doorflow admins managers can manage groups',
    'doorflow staff can read groups',
    'doorflow admins managers can manage service days',
    'doorflow staff can read service days',
    'doorflow admins managers can manage venues',
    'doorflow staff can read venues',
    'doorflow admins can manage profiles',
    'doorflow admins can read all profiles',
    'doorflow staff can read own profile'
  );

-- Successful full rollback expectations:
-- - restored_old_policy_count = 20
-- - remaining_venue_aware_policy_count = 0
