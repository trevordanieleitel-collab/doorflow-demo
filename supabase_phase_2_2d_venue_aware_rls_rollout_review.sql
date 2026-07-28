-- DoorFlow Phase 2.2D Venue-Aware RLS Rollout Review
--
-- REVIEW ONLY - DO NOT RUN AS A MIGRATION.
--
-- This file is intentionally inert for live policy changes. Active executable
-- SQL in this file is SELECT-only. All DROP POLICY, CREATE POLICY, BEGIN,
-- COMMIT, and SET LOCAL statements are commented out on purpose.
--
-- To apply later during a quiet window:
-- 1. Confirm the SELECT-only preflight queries are clean.
-- 2. Copy exactly one table stage into a new SQL Editor tab.
-- 3. Remove the leading "-- " comments for that one stage only.
-- 4. Run that one stage.
-- 5. Run the stage verification query and browser test gate.
-- 6. Stop. Do not continue to the next table until the current table passes.
--
-- Do not use this review file to:
-- - run SQL automatically
-- - enable, disable, or force RLS
-- - change Supabase Auth users
-- - add organization-level or cross-venue access
-- - add venue switching, billing, branding, or subscription behavior
-- - touch SaaS foundation table policies
--
-- Runtime authority:
-- - index.html contains the live inline application code and does not load app.js.
-- - app.js mirrors the same application logic and was inspected for parity.
--
-- Current live venue:
-- - EVE
-- - 623503e3-7647-46b3-9810-b808be3102f1
--
-- Current staff model:
-- - staff_profiles.id = auth.users.id
-- - staff_profiles.venue_id is the venue authority for Phase 2.2D


/* -------------------------------------------------------------------------- */
/* APPLICATION ACCESS MATRIX                                                  */
/* -------------------------------------------------------------------------- */

-- table          | operation | code location / function                         | UI roles allowed       | bootstrap | check-in | proposed RLS coverage
-- venues         | SELECT    | index.html:2709 findVenueByName, 2721 findFallbackVenue; app.js mirror | admin, manager, door, viewer after login | yes | no | own-venue SELECT for active app roles
-- venues         | INSERT    | index.html:2732 ensureVenue fallback only; app.js mirror              | admin, manager if no venue exists | bootstrap fallback only | no | intentionally not preserved in primary rollout; EVE exists
-- service_days   | SELECT    | index.html:2749 ensureServiceDay; app.js mirror                       | admin, manager, door, viewer | yes | indirect | own-venue SELECT
-- service_days   | INSERT    | index.html:2749 ensureServiceDay creates missing date                 | admin, manager          | date bootstrap | no | own-venue INSERT for admin/manager
-- service_days   | UPDATE    | no app-side path found                                                | none in UI              | no | no | preserved as own-venue admin/manager for current ALL compatibility
-- service_days   | DELETE    | no app-side path found                                                | none in UI              | no | no | preserved as own-venue admin/manager for current ALL compatibility
-- groups         | SELECT    | index.html:2849 loadDataForDate, findGeneralGroupForServiceDay        | admin, manager, door, viewer | yes | indirect | own-venue SELECT
-- groups         | INSERT    | index.html:2820 ensureGeneralGroup, 3924 createGroup, 4412 mobileQuickCreateGroup | admin, manager | yes for General Guest List | no | own-venue INSERT for admin/manager
-- groups         | UPDATE    | index.html:3996 updateGroup                                           | admin, manager          | no | no | own-venue UPDATE for admin/manager
-- groups         | DELETE    | index.html:4052 deleteGroup                                           | admin, manager          | no | no | own-venue DELETE for admin/manager
-- guests         | SELECT    | index.html:2849 loadDataForDate                                       | admin, manager, door, viewer | yes | yes | own-venue SELECT
-- guests         | INSERT    | index.html:4084 createGuest, 3328 upsertPartyHostGuest, 4299 mobileQuickAddGuest, bulk import paths | admin, manager | no | no | own-venue INSERT for admin/manager
-- guests         | UPDATE    | index.html:3718 checkInOneGuest, 3817 undoOneGuest, 4967 updateGuest, 5022 savePlusOnes | admin, manager, door for check-in/undo; admin/manager for management | no | yes | own-venue UPDATE for admin/manager/door
-- guests         | DELETE    | index.html:5109 deleteGuest, 5127 clearGeneralGuestList, clearGroupNames | admin, manager | no | no | own-venue DELETE for admin/manager
-- check_in_logs  | SELECT    | index.html:2849 loadDataForDate                                       | admin, manager, door, viewer | no | yes | own-venue SELECT
-- check_in_logs  | INSERT    | index.html:3718 checkInOneGuest, 3817 undoOneGuest, 5022 savePlusOnes | admin, manager, door    | no | yes | own-venue INSERT for admin/manager/door
-- check_in_logs  | DELETE    | no app-side path found                                                | none in UI              | no | no | intentionally not preserved in primary rollout
-- shift_notes    | SELECT    | index.html:2849 loadDataForDate, renderShiftNotesForDoorStaff         | admin, manager, door, viewer | no | no | own-venue SELECT
-- shift_notes    | INSERT    | index.html:5663 createShiftNote, 4502 mobileAddShiftNote              | admin, manager          | no | no | own-venue INSERT for admin/manager
-- shift_notes    | UPDATE    | index.html:5718 updateShiftNote                                       | admin, manager          | no | no | own-venue UPDATE for admin/manager
-- shift_notes    | DELETE    | index.html:5761 deleteShiftNote                                       | admin, manager          | no | no | own-venue DELETE for admin/manager
-- staff_profiles | SELECT    | index.html:2544 loadStaffProfile, 3586 loadStaffProfilesForAdmin      | own profile for login; admin staff view | yes | no | self SELECT plus same-venue admin SELECT
-- staff_profiles | UPDATE    | index.html:3607 updateStaffProfile                                    | admin                  | no | no | same-venue admin UPDATE
-- staff_profiles | INSERT    | no app-side path found                                                | none in UI              | no | no | intentionally not preserved in primary rollout
-- staff_profiles | DELETE    | no app-side path found                                                | none in UI              | no | no | intentionally not preserved in primary rollout

-- Review answers:
-- 1. The app never deletes check_in_logs.
-- 2. Shift notes are read by staff, but create/edit/delete require requirePerm("manage"), which maps to admin and manager.
-- 3. Door users cannot create service_days; ensureServiceDay inserts only when canManageData() is true.
-- 4. Groups are created/updated/deleted by admin and manager UI paths only.
-- 5. Guests are created/updated/deleted by admin and manager; door users only update guests for check-in/undo.
-- 6. The app writes to venues only as a missing-venue bootstrap fallback in ensureVenue; it does not update or delete venues.
-- 7. Staff admin UI selects all visible staff profiles and updates full_name, role, and active. It does not insert or delete staff_profiles.
-- 8. Check-in and undo require guests UPDATE plus check_in_logs INSERT.
-- 9. The optimistic check-in reliability code adds no new database permissions.


/* -------------------------------------------------------------------------- */
/* CURRENT PERMISSIONS PRESERVED IN PRIMARY ROLLOUT                           */
/* -------------------------------------------------------------------------- */

-- - service_days admin/manager INSERT, UPDATE, DELETE are preserved but scoped to venue.
-- - groups admin/manager INSERT, UPDATE, DELETE are preserved but scoped to venue.
-- - guests admin/manager INSERT, UPDATE, DELETE are preserved but scoped to venue.
-- - guests admin/manager/door UPDATE is preserved for check-in and undo.
-- - check_in_logs admin/manager/door INSERT is preserved for check-in, undo, and plus-one audit logs.
-- - all operational SELECT access includes viewer and is scoped to the active staff venue.
-- - staff_profiles self-read remains available for login/bootstrap.
-- - staff_profiles admin read/update remains available for same-venue staff management.


/* -------------------------------------------------------------------------- */
/* INTENTIONAL DIFFERENCES FROM CURRENT POLICIES                               */
/* -------------------------------------------------------------------------- */

-- - check_in_logs admin/manager DELETE is not recreated. No app-side delete path exists.
-- - venues admin/manager ALL is not recreated. The app only selects venues in normal operation; the insert path is a missing-venue bootstrap fallback and EVE already exists.
-- - staff_profiles admin ALL is narrowed to same-venue SELECT and UPDATE. The app has no staff_profiles INSERT or DELETE path.
-- - shift_notes broad authenticated CRUD is replaced with venue-aware SELECT for app roles and venue-aware writes for admin/manager only.
-- - Broad role-only checks using doorflow_has_role(...) are replaced with venue-aware helper checks.
--
-- Future hardening candidates after this rollout:
-- - Replace direct door-user guest UPDATE with RPCs or column privileges so door users can only change check-in fields.
-- - Move venue bootstrap/creation out of the static app before adding multi-venue creation.
-- - Create a viewer test account before validating viewer policies live.


/* -------------------------------------------------------------------------- */
/* SELECT-ONLY PREFLIGHT: CURRENT POLICY INVENTORY                             */
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
    'shift_notes',
    'check_in_logs',
    'guests',
    'groups',
    'service_days',
    'venues',
    'staff_profiles'
  )
order by tablename, policyname, cmd;

select
  count(*) as current_policy_count
from pg_policies
where schemaname = 'public'
  and tablename in (
    'shift_notes',
    'check_in_logs',
    'guests',
    'groups',
    'service_days',
    'venues',
    'staff_profiles'
  );


/* -------------------------------------------------------------------------- */
/* SELECT-ONLY PREFLIGHT: HELPER FUNCTIONS                                     */
/* -------------------------------------------------------------------------- */

select
  helper,
  exists,
  security_definer
from (
  select
    'doorflow_current_staff_profile()' as helper,
    to_regprocedure('public.doorflow_current_staff_profile()') is not null as exists,
    coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.doorflow_current_staff_profile()')), false) as security_definer
  union all
  select
    'doorflow_current_role()',
    to_regprocedure('public.doorflow_current_role()') is not null,
    coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.doorflow_current_role()')), false)
  union all
  select
    'doorflow_current_venue_id()',
    to_regprocedure('public.doorflow_current_venue_id()') is not null,
    coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.doorflow_current_venue_id()')), false)
  union all
  select
    'doorflow_is_active_staff()',
    to_regprocedure('public.doorflow_is_active_staff()') is not null,
    coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.doorflow_is_active_staff()')), false)
  union all
  select
    'doorflow_has_venue_access(uuid)',
    to_regprocedure('public.doorflow_has_venue_access(uuid)') is not null,
    coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.doorflow_has_venue_access(uuid)')), false)
  union all
  select
    'doorflow_has_venue_role(uuid,text[])',
    to_regprocedure('public.doorflow_has_venue_role(uuid,text[])') is not null,
    coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.doorflow_has_venue_role(uuid,text[])')), false)
) helpers
order by helper;

-- SQL Editor runtime context warning:
-- Supabase SQL Editor normally does not run with the authenticated browser
-- auth.uid() context used by the live app. These runtime values may
-- legitimately be false/null in SQL Editor:
-- - doorflow_is_active_staff = false
-- - doorflow_current_role = null
-- - doorflow_current_venue_id = null
-- Do not treat those SQL Editor runtime values as a failed helper preflight.
select
  public.doorflow_is_active_staff() as current_session_is_active_staff,
  public.doorflow_current_role() as current_session_role,
  public.doorflow_current_venue_id() as current_session_venue_id;


/* -------------------------------------------------------------------------- */
/* SELECT-ONLY PREFLIGHT: DATA INTEGRITY                                       */
/* -------------------------------------------------------------------------- */

select 'groups' as table_name, count(*) as missing_venue_id
from public.groups
where venue_id is null
union all
select 'guests', count(*)
from public.guests
where venue_id is null
union all
select 'check_in_logs', count(*)
from public.check_in_logs
where venue_id is null
union all
select 'shift_notes', count(*)
from public.shift_notes
where venue_id is null
union all
select 'staff_profiles', count(*)
from public.staff_profiles
where venue_id is null;

select 'groups_vs_service_days' as check_name, count(*) as mismatch_count
from public.groups item
join public.service_days service_day on service_day.id = item.service_day_id
where item.venue_id is distinct from service_day.venue_id
union all
select 'guests_vs_groups', count(*)
from public.guests item
join public.groups guest_group on guest_group.id = item.group_id
where item.venue_id is distinct from guest_group.venue_id
union all
select 'shift_notes_vs_service_days', count(*)
from public.shift_notes item
join public.service_days service_day on service_day.id = item.service_day_id
where item.venue_id is distinct from service_day.venue_id
union all
select 'check_in_logs_vs_guests', count(*)
from public.check_in_logs item
join public.guests guest on guest.id = item.guest_id
where item.venue_id is distinct from guest.venue_id
union all
select 'check_in_logs_vs_groups_without_guest', count(*)
from public.check_in_logs item
join public.groups guest_group on guest_group.id = item.group_id
where item.guest_id is null
  and item.venue_id is distinct from guest_group.venue_id;


/* -------------------------------------------------------------------------- */
/* SELECT-ONLY VERIFICATION SETS FOR OLD AND NEW POLICY NAMES                 */
/* -------------------------------------------------------------------------- */

select
  tablename,
  policyname,
  cmd
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
  )
order by tablename, policyname;

select
  tablename,
  policyname,
  cmd
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
order by tablename, policyname;


/* -------------------------------------------------------------------------- */
/* ROLLOUT STAGE 1: shift_notes                                                */
/* -------------------------------------------------------------------------- */

-- Application note:
-- - Replaces broad authenticated shift_notes CRUD with venue-aware policies.
-- - Read remains available to admin, manager, door, and viewer.
-- - Write access is admin/manager only, matching requirePerm("manage").
--
-- Rollback:
-- - Use Stage 7 in supabase_phase_2_2d_venue_aware_rls_rollback_review.sql.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "Authenticated users can delete shift notes" on public.shift_notes;
-- drop policy if exists "Authenticated users can insert shift notes" on public.shift_notes;
-- drop policy if exists "Authenticated users can read shift notes" on public.shift_notes;
-- drop policy if exists "Authenticated users can update shift notes" on public.shift_notes;
--
-- create policy "doorflow shift_notes select own venue"
-- on public.shift_notes
-- as permissive
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])
-- );
--
-- create policy "doorflow shift_notes insert managers own venue"
-- on public.shift_notes
-- as permissive
-- for insert
-- to authenticated
-- with check (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- create policy "doorflow shift_notes update managers own venue"
-- on public.shift_notes
-- as permissive
-- for update
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- )
-- with check (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- create policy "doorflow shift_notes delete managers own venue"
-- on public.shift_notes
-- as permissive
-- for delete
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'shift_notes'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   expected_count integer;
--   old_count integer;
--   table_count integer;
-- begin
--   select count(*) into expected_count
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
--   select count(*) into old_count
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
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'shift_notes';
--
--   if expected_count <> 4 or old_count <> 0 or table_count <> 4 then
--     raise exception 'shift_notes rollout policy assertion failed: expected=%, old=%, total=%',
--       expected_count, old_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser gate after commit:
-- - Admin: load app, read shift notes, add/edit/delete one test shift note.
-- - Manager: load app, read shift notes, add/edit/delete one test shift note.
-- - Door: load app and confirm shift notes are visible; no management note controls.
-- - Viewer: not currently live-testable because no viewer account exists; test when account is created.
-- STOP CONDITION: If any role fails, stop rollout and run rollback Stage 7 only.


/* -------------------------------------------------------------------------- */
/* ROLLOUT STAGE 2: check_in_logs                                              */
/* -------------------------------------------------------------------------- */

-- Application note:
-- - Preserves SELECT for all app roles and INSERT for admin/manager/door.
-- - Does not recreate old admin/manager DELETE because no app-side delete path exists.
--
-- Rollback:
-- - Use Stage 6 in supabase_phase_2_2d_venue_aware_rls_rollback_review.sql.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow admins managers can delete check in logs" on public.check_in_logs;
-- drop policy if exists "doorflow admins managers door can insert check in logs" on public.check_in_logs;
-- drop policy if exists "doorflow staff can read check in logs" on public.check_in_logs;
--
-- create policy "doorflow check_in_logs select own venue"
-- on public.check_in_logs
-- as permissive
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])
-- );
--
-- create policy "doorflow check_in_logs insert operational own venue"
-- on public.check_in_logs
-- as permissive
-- for insert
-- to authenticated
-- with check (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text])
-- );
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'check_in_logs'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   expected_count integer;
--   old_count integer;
--   table_count integer;
-- begin
--   select count(*) into expected_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'check_in_logs'
--     and policyname in (
--       'doorflow check_in_logs select own venue',
--       'doorflow check_in_logs insert operational own venue'
--     );
--
--   select count(*) into old_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'check_in_logs'
--     and policyname in (
--       'doorflow admins managers can delete check in logs',
--       'doorflow admins managers door can insert check in logs',
--       'doorflow staff can read check in logs'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'check_in_logs';
--
--   if expected_count <> 2 or old_count <> 0 or table_count <> 2 then
--     raise exception 'check_in_logs rollout policy assertion failed: expected=%, old=%, total=%',
--       expected_count, old_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser gate after commit:
-- - Admin or manager: load guest list and confirm recent check-in history still loads.
-- - Door: Check In 1, Undo 1, re-check-in once.
-- - Confirm no duplicate check_in_logs for the repeated test sequence.
-- - Confirm persisted state after browser refresh.
-- STOP CONDITION: If check-in/undo logging fails, stop rollout and run rollback Stage 6 only.


/* -------------------------------------------------------------------------- */
/* ROLLOUT STAGE 3: guests                                                     */
/* -------------------------------------------------------------------------- */

-- Application note:
-- - Preserves read for all app roles.
-- - Preserves admin/manager guest creation, updates, deletes, imports, and clears.
-- - Preserves door guest UPDATE needed for Check In 1 and Undo 1.
-- - RLS cannot restrict door users to only check-in columns.
--
-- Rollback:
-- - Use Stage 5 in supabase_phase_2_2d_venue_aware_rls_rollback_review.sql.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow admins managers can delete guests" on public.guests;
-- drop policy if exists "doorflow admins managers can insert guests" on public.guests;
-- drop policy if exists "doorflow admins managers door can update guests" on public.guests;
-- drop policy if exists "doorflow staff can read guests" on public.guests;
--
-- create policy "doorflow guests select own venue"
-- on public.guests
-- as permissive
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])
-- );
--
-- create policy "doorflow guests insert managers own venue"
-- on public.guests
-- as permissive
-- for insert
-- to authenticated
-- with check (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- create policy "doorflow guests update operational own venue"
-- on public.guests
-- as permissive
-- for update
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text])
-- )
-- with check (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text])
-- );
--
-- create policy "doorflow guests delete managers own venue"
-- on public.guests
-- as permissive
-- for delete
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'guests'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   expected_count integer;
--   old_count integer;
--   table_count integer;
-- begin
--   select count(*) into expected_count
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
--   select count(*) into old_count
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
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'guests';
--
--   if expected_count <> 4 or old_count <> 0 or table_count <> 4 then
--     raise exception 'guests rollout policy assertion failed: expected=%, old=%, total=%',
--       expected_count, old_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser gate after commit:
-- - Admin/manager: add guest, edit guest, adjust plus ones, delete test guest.
-- - Door: Check In 1, Undo 1, confirm Saving... state and persisted refresh.
-- - Confirm party counts and day stats update.
-- STOP CONDITION: If guest load/write/check-in fails, stop rollout and run rollback Stage 5 only.


/* -------------------------------------------------------------------------- */
/* ROLLOUT STAGE 4: groups                                                     */
/* -------------------------------------------------------------------------- */

-- Application note:
-- - Preserves group read for all app roles.
-- - Preserves group creation/update/delete for admin/manager only.
-- - General Guest List bootstrap remains admin/manager only.
--
-- Rollback:
-- - Use Stage 4 in supabase_phase_2_2d_venue_aware_rls_rollback_review.sql.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow admins managers can manage groups" on public.groups;
-- drop policy if exists "doorflow staff can read groups" on public.groups;
--
-- create policy "doorflow groups select own venue"
-- on public.groups
-- as permissive
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])
-- );
--
-- create policy "doorflow groups insert managers own venue"
-- on public.groups
-- as permissive
-- for insert
-- to authenticated
-- with check (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- create policy "doorflow groups update managers own venue"
-- on public.groups
-- as permissive
-- for update
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- )
-- with check (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- create policy "doorflow groups delete managers own venue"
-- on public.groups
-- as permissive
-- for delete
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'groups'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   expected_count integer;
--   old_count integer;
--   table_count integer;
-- begin
--   select count(*) into expected_count
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
--   select count(*) into old_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'groups'
--     and policyname in (
--       'doorflow admins managers can manage groups',
--       'doorflow staff can read groups'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'groups';
--
--   if expected_count <> 4 or old_count <> 0 or table_count <> 4 then
--     raise exception 'groups rollout policy assertion failed: expected=%, old=%, total=%',
--       expected_count, old_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser gate after commit:
-- - Admin/manager: create party, edit party, delete test party.
-- - Door: load party list, select party, search guests, check-in/undo still works.
-- - Confirm General Guest List still loads for the active date.
-- STOP CONDITION: If party/group load or management fails, stop rollout and run rollback Stage 4 only.


/* -------------------------------------------------------------------------- */
/* ROLLOUT STAGE 5: service_days                                               */
/* -------------------------------------------------------------------------- */

-- Application note:
-- - Preserves service day read for all app roles.
-- - Preserves admin/manager INSERT for date bootstrap.
-- - Preserves admin/manager UPDATE/DELETE venue-scoped for current ALL compatibility, though no UI path was found.
--
-- Rollback:
-- - Use Stage 3 in supabase_phase_2_2d_venue_aware_rls_rollback_review.sql.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow admins managers can manage service days" on public.service_days;
-- drop policy if exists "doorflow staff can read service days" on public.service_days;
--
-- create policy "doorflow service_days select own venue"
-- on public.service_days
-- as permissive
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])
-- );
--
-- create policy "doorflow service_days insert managers own venue"
-- on public.service_days
-- as permissive
-- for insert
-- to authenticated
-- with check (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- create policy "doorflow service_days update managers own venue"
-- on public.service_days
-- as permissive
-- for update
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- )
-- with check (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- create policy "doorflow service_days delete managers own venue"
-- on public.service_days
-- as permissive
-- for delete
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])
-- );
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'service_days'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   expected_count integer;
--   old_count integer;
--   table_count integer;
-- begin
--   select count(*) into expected_count
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
--   select count(*) into old_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'service_days'
--     and policyname in (
--       'doorflow admins managers can manage service days',
--       'doorflow staff can read service days'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'service_days';
--
--   if expected_count <> 4 or old_count <> 0 or table_count <> 4 then
--     raise exception 'service_days rollout policy assertion failed: expected=%, old=%, total=%',
--       expected_count, old_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser gate after commit:
-- - Admin/manager: load current date and a new future test date to verify service_day creation.
-- - Door: load an already-created date; confirm door users cannot create a missing date.
-- - Confirm groups/guests/shift notes still load for current EVE date.
-- STOP CONDITION: If date loading or creation fails, stop rollout and run rollback Stage 3 only.


/* -------------------------------------------------------------------------- */
/* ROLLOUT STAGE 6: venues                                                     */
/* -------------------------------------------------------------------------- */

-- Application note:
-- - Keep this near the end because venue loading affects bootstrap.
-- - Normal app behavior only needs SELECT of the current EVE venue.
-- - This primary rollout intentionally does not preserve venue INSERT/UPDATE/DELETE.
--
-- Rollback:
-- - Use Stage 2 in supabase_phase_2_2d_venue_aware_rls_rollback_review.sql.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow admins managers can manage venues" on public.venues;
-- drop policy if exists "doorflow staff can read venues" on public.venues;
--
-- create policy "doorflow venues select own venue"
-- on public.venues
-- as permissive
-- for select
-- to authenticated
-- using (
--   public.doorflow_is_active_staff()
--   and public.doorflow_has_venue_access(id)
--   and public.doorflow_current_role() = any (ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])
-- );
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'venues'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   expected_count integer;
--   old_count integer;
--   table_count integer;
-- begin
--   select count(*) into expected_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'venues'
--     and policyname in (
--       'doorflow venues select own venue'
--     );
--
--   select count(*) into old_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'venues'
--     and policyname in (
--       'doorflow admins managers can manage venues',
--       'doorflow staff can read venues'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'venues';
--
--   if expected_count <> 1 or old_count <> 0 or table_count <> 1 then
--     raise exception 'venues rollout policy assertion failed: expected=%, old=%, total=%',
--       expected_count, old_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser gate after commit:
-- - Admin, manager, and door: logout, login, confirm EVE loads and guest list opens.
-- - Confirm no app flow attempts to create or update venues.
-- - Viewer: not currently live-testable because no viewer account exists.
-- STOP CONDITION: If login/bootstrap or venue loading fails, stop rollout and run rollback Stage 2 only.


/* -------------------------------------------------------------------------- */
/* ROLLOUT STAGE 7: staff_profiles                                             */
/* -------------------------------------------------------------------------- */

-- Application note:
-- - Keep this last because staff_profiles affects login/bootstrap and helper checks.
-- - Self-read remains available through id = auth.uid().
-- - Admin same-venue staff list and role/active/name updates remain available.
-- - Staff profile INSERT/DELETE are intentionally not preserved because the UI has no such path.
--
-- Rollback:
-- - Use Emergency Stage 1 in supabase_phase_2_2d_venue_aware_rls_rollback_review.sql.
--
-- BEGIN;
-- set local lock_timeout = '5s';
--
-- drop policy if exists "doorflow admins can manage profiles" on public.staff_profiles;
-- drop policy if exists "doorflow admins can read all profiles" on public.staff_profiles;
-- drop policy if exists "doorflow staff can read own profile" on public.staff_profiles;
--
-- create policy "doorflow staff_profiles select self or own venue admins"
-- on public.staff_profiles
-- as permissive
-- for select
-- to authenticated
-- using (
--   id = auth.uid()
--   or public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text])
-- );
--
-- create policy "doorflow staff_profiles update own venue admins"
-- on public.staff_profiles
-- as permissive
-- for update
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text])
-- )
-- with check (
--   venue_id = public.doorflow_current_venue_id()
--   and public.doorflow_current_role() = 'admin'::text
-- );
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'staff_profiles'
-- order by policyname, cmd;
--
-- do $$
-- declare
--   expected_count integer;
--   old_count integer;
--   table_count integer;
-- begin
--   select count(*) into expected_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'staff_profiles'
--     and policyname in (
--       'doorflow staff_profiles select self or own venue admins',
--       'doorflow staff_profiles update own venue admins'
--     );
--
--   select count(*) into old_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'staff_profiles'
--     and policyname in (
--       'doorflow admins can manage profiles',
--       'doorflow admins can read all profiles',
--       'doorflow staff can read own profile'
--     );
--
--   select count(*) into table_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'staff_profiles';
--
--   if expected_count <> 2 or old_count <> 0 or table_count <> 2 then
--     raise exception 'staff_profiles rollout policy assertion failed: expected=%, old=%, total=%',
--       expected_count, old_count, table_count;
--   end if;
-- end
-- $$;
--
-- COMMIT;
--
-- Browser gate after commit:
-- - Admin: logout, login, open Staff Management, refresh list, and verify same-venue staff visibility.
-- - Optional: make and immediately reverse a harmless full_name test edit on a designated test account.
-- - Do not deactivate or change the role of the currently logged-in admin during the first rollout.
-- - Manager: logout, login, confirm app loads and Staff tab is unavailable.
-- - Door: logout, login, confirm door view loads.
-- - Viewer: not currently live-testable because no viewer account exists.
-- STOP CONDITION: If any login/bootstrap or staff management flow fails, run Emergency rollback Stage 1 immediately.


/* -------------------------------------------------------------------------- */
/* POST-APPLICATION SQL VERIFICATION QUERIES                                   */
/* -------------------------------------------------------------------------- */

-- Run after each table stage, filtered to that table, and again after all stages.

select
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'shift_notes',
    'check_in_logs',
    'guests',
    'groups',
    'service_days',
    'venues',
    'staff_profiles'
  )
order by tablename, policyname, cmd;

select
  policyname as old_policy_still_present
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
  )
order by policyname;

select
  count(*) as old_policy_count
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
  count(*) as new_policy_count
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

-- Successful full rollout expectations:
-- - old_policy_count = 0
-- - new_policy_count = 21


/* -------------------------------------------------------------------------- */
/* ROLE-BASED BROWSER TEST CHECKLIST                                           */
/* -------------------------------------------------------------------------- */

-- Admin:
-- - Log in.
-- - Confirm venue loading.
-- - Confirm service day loading and creation on a future test date.
-- - Confirm party loading and creation.
-- - Confirm guest loading and creation.
-- - Check In 1.
-- - Undo 1.
-- - Confirm optimistic Saving... state appears only for the clicked guest.
-- - Refresh and confirm persisted state.
-- - Confirm no duplicate check_in_logs were created by the check-in test.
-- - Confirm shift notes read/write/edit/delete behavior.
-- - Confirm staff management list loads and same-venue updates work.
-- - Log out and log back in.
--
-- Manager:
-- - Log in.
-- - Confirm venue/service day/group/guest loading.
-- - Create service day if testing a future date.
-- - Create party and guest.
-- - Check In 1 and Undo 1.
-- - Confirm shift notes read/write/edit/delete behavior.
-- - Confirm Staff tab is unavailable.
-- - Log out and log back in.
--
-- Door:
-- - Log in.
-- - Confirm venue/service day/group/guest loading for an existing date.
-- - Check In 1.
-- - Undo 1.
-- - Confirm optimistic Saving... state.
-- - Refresh and confirm persisted state.
-- - Confirm no duplicate check_in_logs.
-- - Confirm shift notes are readable.
-- - Confirm management and staff actions are unavailable.
-- - Log out and log back in.
--
-- Viewer:
-- - Not currently live-testable because there is no viewer user.
-- - When available: login, confirm reports/read-only data load, and confirm no check-in, management, shift-note write, or staff actions are available.
