-- DoorFlow Phase 2.2C Venue-Aware Policy Review
--
-- REVIEW ONLY - DO NOT RUN AS A MIGRATION.
--
-- This file is intentionally review-first. The active SQL in this file is
-- limited to SELECT-only inspection and verification queries. Proposed policy
-- replacement SQL is commented out so an accidental full paste into Supabase
-- cannot drop, create, or alter live RLS policies.
--
-- Do not use this file to:
-- - enable or disable RLS
-- - create, drop, or alter live policies automatically
-- - modify Supabase Auth users
-- - change app.js or index.html behavior
-- - add organization, billing, branding, subscription, or multi-venue access
--
-- Current authority model for this review:
-- - staff_profiles.id = auth.users.id
-- - staff_profiles.venue_id is the venue authority
-- - current live venue is EVE
-- - known EVE venue_id: 623503e3-7647-46b3-9810-b808be3102f1
-- - venue-aware helpers from Phase 2.2B are already applied


/* -------------------------------------------------------------------------- */
/* 1. SELECT-ONLY INSPECTION: CURRENT POLICIES                                */
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
    'venues',
    'service_days',
    'groups',
    'guests',
    'check_in_logs',
    'shift_notes',
    'staff_profiles'
  )
order by tablename, policyname, cmd;

-- Generates commented DROP POLICY lines for manual review only.
-- Copy reviewed output into a separate quiet-window rollout script only after
-- confirming each current broad role-based policy should be replaced.
select
  format(
    '-- drop policy if exists %I on %I.%I;',
    policyname,
    schemaname,
    tablename
  ) as commented_drop_policy_for_review
from pg_policies
where schemaname = 'public'
  and tablename in (
    'venues',
    'service_days',
    'groups',
    'guests',
    'check_in_logs',
    'shift_notes',
    'staff_profiles'
  )
order by tablename, policyname;


/* -------------------------------------------------------------------------- */
/* 2. SELECT-ONLY VERIFICATION: HELPER FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

select
  'doorflow_current_staff_profile()' as helper,
  to_regprocedure('public.doorflow_current_staff_profile()') is not null as exists
union all
select
  'doorflow_current_role()',
  to_regprocedure('public.doorflow_current_role()') is not null
union all
select
  'doorflow_current_venue_id()',
  to_regprocedure('public.doorflow_current_venue_id()') is not null
union all
select
  'doorflow_is_active_staff()',
  to_regprocedure('public.doorflow_is_active_staff()') is not null
union all
select
  'doorflow_has_venue_access(uuid)',
  to_regprocedure('public.doorflow_has_venue_access(uuid)') is not null
union all
select
  'doorflow_has_venue_role(uuid,text[])',
  to_regprocedure('public.doorflow_has_venue_role(uuid,text[])') is not null;

-- Runtime helper check. In the Supabase SQL Editor this may return false/null
-- because auth.uid() may not be populated like it is for browser sessions.
select
  public.doorflow_is_active_staff() as current_session_is_active_staff,
  public.doorflow_current_role() as current_role,
  public.doorflow_current_venue_id() as current_venue_id;

select
  id,
  name,
  public.doorflow_has_venue_access(id) as current_session_has_venue_access,
  public.doorflow_has_venue_role(id, array['admin', 'manager', 'door', 'viewer']) as current_session_has_any_app_role
from public.venues
where id = '623503e3-7647-46b3-9810-b808be3102f1'::uuid;


/* -------------------------------------------------------------------------- */
/* 3. SELECT-ONLY VERIFICATION: NULL venue_id COUNTS                          */
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

select count(*) as mismatched_group_venue_ids
from public.groups item
join public.service_days service_day on service_day.id = item.service_day_id
where item.venue_id is distinct from service_day.venue_id;

select count(*) as mismatched_guest_venue_ids
from public.guests item
join public.groups guest_group on guest_group.id = item.group_id
where item.venue_id is distinct from guest_group.venue_id;

select count(*) as mismatched_shift_note_venue_ids
from public.shift_notes item
join public.service_days service_day on service_day.id = item.service_day_id
where item.venue_id is distinct from service_day.venue_id;

select count(*) as mismatched_check_in_log_guest_venue_ids
from public.check_in_logs item
join public.guests guest on guest.id = item.guest_id
where item.venue_id is distinct from guest.venue_id;

select count(*) as mismatched_check_in_log_group_venue_ids
from public.check_in_logs item
join public.groups guest_group on guest_group.id = item.group_id
where item.guest_id is null
  and item.venue_id is distinct from guest_group.venue_id;


/* -------------------------------------------------------------------------- */
/* 4. PROPOSED VENUE-AWARE POLICY REPLACEMENT - COMMENTED REVIEW DRAFT        */
/* -------------------------------------------------------------------------- */

-- IMPORTANT:
-- Every policy statement below is commented out on purpose.
-- Review current policy names using the inspection query above, then prepare a
-- separate quiet-window rollout script. Do not run this review file as DDL.


/* venues
Application note:
- Current app selects EVE by name, then falls back to the oldest venue.
- Live EVE already exists, so this draft keeps venue visibility scoped to the
  current active staff venue.
- Do not add cross-venue or organization-level visibility yet.

Rollback note:
- Restore the previous venues SELECT policy from the policy inventory captured
  before rollout.
*/

-- Proposed replacement DDL for venues:
-- drop policy if exists "<existing_venues_select_policy>" on public.venues;
-- create policy "doorflow venues select own venue"
-- on public.venues
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_access(id)
-- );


/* service_days
Application note:
- DoorFlow loads service_days by venue_id and service_date.
- Admin and manager need INSERT access because the app can open/create dates.
- Door and viewer should be read-only for their venue.

Rollback note:
- Restore the previous service_days policies captured before rollout.
*/

-- Proposed replacement DDL for service_days:
-- drop policy if exists "<existing_service_days_select_policy>" on public.service_days;
-- drop policy if exists "<existing_service_days_insert_policy>" on public.service_days;
-- drop policy if exists "<existing_service_days_update_policy>" on public.service_days;
-- create policy "doorflow service_days select own venue"
-- on public.service_days
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager', 'door', 'viewer'])
-- );
-- create policy "doorflow service_days insert managers own venue"
-- on public.service_days
-- for insert
-- to authenticated
-- with check (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- );
-- create policy "doorflow service_days update managers own venue"
-- on public.service_days
-- for update
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- )
-- with check (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- );


/* groups
Application note:
- DoorFlow loads groups by service_day_id.
- Phase 2.2A triggers should populate groups.venue_id from service_days.
- Admin and manager need INSERT/UPDATE/DELETE for party/group management.
- Door and viewer should be read-only.

Rollback note:
- Restore previous groups policies from the policy inventory.
*/

-- Proposed replacement DDL for groups:
-- drop policy if exists "<existing_groups_select_policy>" on public.groups;
-- drop policy if exists "<existing_groups_insert_policy>" on public.groups;
-- drop policy if exists "<existing_groups_update_policy>" on public.groups;
-- drop policy if exists "<existing_groups_delete_policy>" on public.groups;
-- create policy "doorflow groups select own venue"
-- on public.groups
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager', 'door', 'viewer'])
-- );
-- create policy "doorflow groups insert managers own venue"
-- on public.groups
-- for insert
-- to authenticated
-- with check (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- );
-- create policy "doorflow groups update managers own venue"
-- on public.groups
-- for update
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- )
-- with check (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- );
-- create policy "doorflow groups delete managers own venue"
-- on public.groups
-- for delete
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- );


/* guests
Application note:
- DoorFlow loads guests by group_id and uses them for door check-in.
- Phase 2.2A triggers should populate guests.venue_id from groups.
- Admin and manager need full venue-scoped CRUD.
- Door staff need venue-scoped UPDATE to keep current check-in/undo behavior.
- Viewer should be read-only.
- RLS cannot limit door users to specific columns; that remains a known risk
  until check-in is moved behind RPCs or column privileges are tightened.

Rollback note:
- Restore previous guests policies from the policy inventory.
*/

-- Proposed replacement DDL for guests:
-- drop policy if exists "<existing_guests_select_policy>" on public.guests;
-- drop policy if exists "<existing_guests_insert_policy>" on public.guests;
-- drop policy if exists "<existing_guests_update_policy>" on public.guests;
-- drop policy if exists "<existing_guests_delete_policy>" on public.guests;
-- create policy "doorflow guests select own venue"
-- on public.guests
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager', 'door', 'viewer'])
-- );
-- create policy "doorflow guests insert managers own venue"
-- on public.guests
-- for insert
-- to authenticated
-- with check (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- );
-- create policy "doorflow guests update operational own venue"
-- on public.guests
-- for update
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager', 'door'])
-- )
-- with check (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager', 'door'])
-- );
-- create policy "doorflow guests delete managers own venue"
-- on public.guests
-- for delete
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- );


/* check_in_logs
Application note:
- DoorFlow loads recent logs by group_id.
- Door, manager, and admin need INSERT for check-in/undo logging.
- Viewer should be read-only.
- Phase 2.2A triggers should populate check_in_logs.venue_id from guests/groups.
- No client UPDATE/DELETE is proposed.

Rollback note:
- Restore previous check_in_logs policies from the policy inventory.
*/

-- Proposed replacement DDL for check_in_logs:
-- drop policy if exists "<existing_check_in_logs_select_policy>" on public.check_in_logs;
-- drop policy if exists "<existing_check_in_logs_insert_policy>" on public.check_in_logs;
-- create policy "doorflow check_in_logs select own venue"
-- on public.check_in_logs
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager', 'door', 'viewer'])
-- );
-- create policy "doorflow check_in_logs insert operational own venue"
-- on public.check_in_logs
-- for insert
-- to authenticated
-- with check (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager', 'door'])
-- );


/* shift_notes
Application note:
- This replaces broad shift_notes role policies with venue-aware policies.
- Door and viewer can read shift notes for their venue.
- Admin and manager can create/update/delete shift notes for their venue.
- Phase 2.2A triggers should populate shift_notes.venue_id from service_days.

Rollback note:
- Restore previous shift_notes policies from the policy inventory.
*/

-- Proposed replacement DDL for shift_notes:
-- drop policy if exists "<existing_shift_notes_select_policy>" on public.shift_notes;
-- drop policy if exists "<existing_shift_notes_insert_policy>" on public.shift_notes;
-- drop policy if exists "<existing_shift_notes_update_policy>" on public.shift_notes;
-- drop policy if exists "<existing_shift_notes_delete_policy>" on public.shift_notes;
-- create policy "doorflow shift_notes select own venue"
-- on public.shift_notes
-- for select
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager', 'door', 'viewer'])
-- );
-- create policy "doorflow shift_notes insert managers own venue"
-- on public.shift_notes
-- for insert
-- to authenticated
-- with check (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- );
-- create policy "doorflow shift_notes update managers own venue"
-- on public.shift_notes
-- for update
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- )
-- with check (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- );
-- create policy "doorflow shift_notes delete managers own venue"
-- on public.shift_notes
-- for delete
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin', 'manager'])
-- );


/* staff_profiles
Application note:
- Login depends on each user being able to SELECT their own active row where
  staff_profiles.id = auth.uid().
- Admin needs venue-scoped staff profile read/update for the staff management UI.
- Do not expose other venues.
- Do not add client INSERT/DELETE yet; staff creation remains manual in Supabase.

Rollback note:
- Restore previous staff_profiles self-read/admin policies from the policy
  inventory. If login breaks, this table is the first rollback target.
*/

-- Proposed replacement DDL for staff_profiles:
-- drop policy if exists "<existing_staff_profiles_select_policy>" on public.staff_profiles;
-- drop policy if exists "<existing_staff_profiles_update_policy>" on public.staff_profiles;
-- create policy "doorflow staff_profiles select self or own venue admins"
-- on public.staff_profiles
-- for select
-- to authenticated
-- using (
--   id = auth.uid()
--   or public.doorflow_has_venue_role(venue_id, array['admin'])
-- );
-- create policy "doorflow staff_profiles update own venue admins"
-- on public.staff_profiles
-- for update
-- to authenticated
-- using (
--   public.doorflow_has_venue_role(venue_id, array['admin'])
-- )
-- with check (
--   public.doorflow_has_venue_role(venue_id, array['admin'])
-- );


/* -------------------------------------------------------------------------- */
/* 5. POST-APPLICATION SMOKE TEST QUERIES FOR A SEPARATE ROLLOUT SCRIPT       */
/* -------------------------------------------------------------------------- */

-- Run after a reviewed quiet-window policy rollout, not from this review file:
--
-- select
--   public.doorflow_is_active_staff() as active_staff,
--   public.doorflow_current_role() as role,
--   public.doorflow_current_venue_id() as venue_id;
--
-- select count(*) as visible_venues
-- from public.venues;
--
-- select count(*) as visible_service_days
-- from public.service_days
-- where venue_id = public.doorflow_current_venue_id();
--
-- select count(*) as visible_groups
-- from public.groups
-- where venue_id = public.doorflow_current_venue_id();
--
-- select count(*) as visible_guests
-- from public.guests
-- where venue_id = public.doorflow_current_venue_id();
--
-- select count(*) as visible_check_in_logs
-- from public.check_in_logs
-- where venue_id = public.doorflow_current_venue_id();
--
-- select count(*) as visible_shift_notes
-- from public.shift_notes
-- where venue_id = public.doorflow_current_venue_id();
--
-- select count(*) as visible_staff_profiles
-- from public.staff_profiles
-- where venue_id = public.doorflow_current_venue_id();


/* -------------------------------------------------------------------------- */
/* 6. FRONT-END TEST CHECKLIST FOR QUIET-WINDOW ROLLOUT                       */
/* -------------------------------------------------------------------------- */

-- Admin:
-- - Log in
-- - Load today's date
-- - Open Staff Management and refresh staff list
-- - Create party/group
-- - Add guest
-- - Adjust plus ones
-- - Add/edit/delete shift note
-- - Export CSV and preview close-out report
--
-- Manager:
-- - Log in
-- - Load today's date
-- - Create party/group
-- - Add individual guest
-- - Bulk paste/import guests
-- - Check in and undo a guest
-- - Add/edit/delete shift note
--
-- Door:
-- - Log in
-- - Load guest list
-- - Search guest list
-- - Check in guest
-- - Undo guest check-in
-- - Confirm shift notes are visible
-- - Confirm manager-only UI remains unavailable
--
-- Viewer:
-- - Log in
-- - Confirm reports load
-- - Confirm no management/check-in/staff actions are available
--
-- Negative tests:
-- - Inactive staff cannot use the app
-- - Auth user without staff_profiles row cannot use the app
-- - A future non-EVE venue user cannot see EVE rows
