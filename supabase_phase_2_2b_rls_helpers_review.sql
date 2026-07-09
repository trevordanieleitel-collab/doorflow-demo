-- DoorFlow Phase 2.2B Venue-Aware RLS Helper Functions
--
-- REVIEW ONLY.
-- Review this file before running it in the live Supabase SQL Editor.
--
-- This script adds helper functions only. It does not enable/disable RLS,
-- create/drop/alter RLS policies, change the existing doorflow_has_role
-- function, or modify app behavior.
--
-- These helpers are intended for future venue-aware policy hardening. For now,
-- staff_profiles.venue_id is the source of truth for venue access.


-- Returns the current active staff_profiles row for auth.uid().
-- SECURITY DEFINER is intentional so future policies can avoid recursive RLS
-- issues when checking staff_profiles from inside policy expressions.
create or replace function public.doorflow_current_staff_profile()
returns public.staff_profiles
language sql
stable
security definer
set search_path = public
as $$
  select staff_profile.*
  from public.staff_profiles staff_profile
  where staff_profile.id = auth.uid()
    and staff_profile.active is true
  limit 1
$$;


-- Returns the current active DoorFlow role, or null when the user is not active
-- staff.
create or replace function public.doorflow_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select staff_profile.role
  from public.staff_profiles staff_profile
  where staff_profile.id = auth.uid()
    and staff_profile.active is true
  limit 1
$$;


-- Returns the current active staff venue_id, or null when the user is not active
-- staff or has no venue assignment.
create or replace function public.doorflow_current_venue_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select staff_profile.venue_id
  from public.staff_profiles staff_profile
  where staff_profile.id = auth.uid()
    and staff_profile.active is true
  limit 1
$$;


-- Returns true when auth.uid() has an active DoorFlow staff profile.
create or replace function public.doorflow_is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles staff_profile
    where staff_profile.id = auth.uid()
      and staff_profile.active is true
  )
$$;


-- Returns true when the current active staff profile is assigned to the target
-- venue. Null target venues are not treated as accessible.
create or replace function public.doorflow_has_venue_access(target_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles staff_profile
    where staff_profile.id = auth.uid()
      and staff_profile.active is true
      and staff_profile.venue_id = target_venue_id
  )
$$;


-- Returns true when the current active staff profile is assigned to the target
-- venue and its role is included in allowed_roles. This is the venue-aware
-- companion to the existing doorflow_has_role helper and is intended for future
-- policy hardening after review.
create or replace function public.doorflow_has_venue_role(
  target_venue_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles staff_profile
    where staff_profile.id = auth.uid()
      and staff_profile.active is true
      and staff_profile.venue_id = target_venue_id
      and staff_profile.role = any(allowed_roles)
  )
$$;


-- Commented test queries for manual review after running this file:
--
-- select public.doorflow_is_active_staff();
-- select public.doorflow_current_role();
-- select public.doorflow_current_venue_id();
-- select (public.doorflow_current_staff_profile()).*;
--
-- select public.doorflow_has_venue_access(
--   public.doorflow_current_venue_id()
-- );
--
-- select public.doorflow_has_venue_role(
--   public.doorflow_current_venue_id(),
--   array['admin', 'manager']
-- );
--
-- select public.doorflow_has_venue_role(
--   public.doorflow_current_venue_id(),
--   array['door', 'viewer']
-- );
--
-- Expected behavior:
-- - Active staff returns true from doorflow_is_active_staff().
-- - Active staff gets their role and venue_id.
-- - Inactive users or Auth users without staff_profiles rows return null/false.
-- - Venue-role checks return true only for matching venue_id and allowed role.
