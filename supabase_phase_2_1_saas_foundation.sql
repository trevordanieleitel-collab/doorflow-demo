-- DoorFlow Phase 2.1 SaaS Foundation
-- Run manually in the Supabase SQL Editor.
-- This script is intentionally additive: no RLS, billing logic, UI-facing data
-- switches, renames, deletes, or service_days schema changes.

create extension if not exists pgcrypto;

-- SaaS foundation tables

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'DoorFlow Legacy Organization',
  slug text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  display_name text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.venue_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'viewer',
  display_name text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.venue_settings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  timezone text not null default 'America/New_York',
  default_door_location text not null default 'Front Door',
  service_day_rollover_time time not null default '04:00',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.venue_branding (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  app_name text not null default 'DoorFlow',
  short_name text not null default 'DoorFlow',
  logo_url text,
  dark_logo_url text,
  icon_192_url text,
  icon_512_url text,
  primary_color text,
  accent_color text,
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  status text not null default 'legacy',
  plan_key text not null default 'legacy',
  provider text not null default 'manual',
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing table additions. service_days already has venue_id and is not modified.

alter table if exists public.groups
  add column if not exists venue_id uuid references public.venues(id) on delete set null;

alter table if exists public.guests
  add column if not exists venue_id uuid references public.venues(id) on delete set null;

alter table if exists public.check_in_logs
  add column if not exists venue_id uuid references public.venues(id) on delete set null;

alter table if exists public.shift_notes
  add column if not exists venue_id uuid references public.venues(id) on delete set null;

alter table if exists public.staff_profiles
  add column if not exists venue_id uuid references public.venues(id) on delete set null;

-- New table indexes

create unique index if not exists organizations_slug_unique
  on public.organizations (lower(slug))
  where slug is not null;

create index if not exists organization_memberships_user_id_idx
  on public.organization_memberships (user_id);

create index if not exists organization_memberships_organization_id_idx
  on public.organization_memberships (organization_id);

create unique index if not exists organization_memberships_organization_user_unique
  on public.organization_memberships (organization_id, user_id);

create index if not exists venue_memberships_user_id_idx
  on public.venue_memberships (user_id);

create index if not exists venue_memberships_organization_id_idx
  on public.venue_memberships (organization_id);

create index if not exists venue_memberships_venue_id_idx
  on public.venue_memberships (venue_id);

create unique index if not exists venue_memberships_venue_user_unique
  on public.venue_memberships (venue_id, user_id);

create unique index if not exists venue_settings_venue_id_unique
  on public.venue_settings (venue_id);

create unique index if not exists venue_branding_venue_id_unique
  on public.venue_branding (venue_id);

create index if not exists subscription_accounts_organization_id_idx
  on public.subscription_accounts (organization_id);

create index if not exists subscription_accounts_status_idx
  on public.subscription_accounts (status);

create unique index if not exists subscription_accounts_provider_customer_unique
  on public.subscription_accounts (provider, provider_customer_id)
  where provider_customer_id is not null;

create unique index if not exists subscription_accounts_provider_subscription_unique
  on public.subscription_accounts (provider, provider_subscription_id)
  where provider_subscription_id is not null;

-- Existing table venue indexes

create index if not exists groups_venue_id_idx
  on public.groups (venue_id);

create index if not exists guests_venue_id_idx
  on public.guests (venue_id);

create index if not exists check_in_logs_venue_id_idx
  on public.check_in_logs (venue_id);

create index if not exists shift_notes_venue_id_idx
  on public.shift_notes (venue_id);

create index if not exists staff_profiles_venue_id_idx
  on public.staff_profiles (venue_id);

-- Safe SaaS defaults. These do not change the active venue or app behavior.

insert into public.organizations (name, slug, status)
select 'DoorFlow Legacy Organization', 'doorflow-legacy', 'active'
where not exists (
  select 1 from public.organizations
  where lower(coalesce(slug, '')) = 'doorflow-legacy'
);

insert into public.subscription_accounts (organization_id, status, plan_key, provider)
select org.id, 'legacy', 'legacy', 'manual'
from public.organizations org
where lower(coalesce(org.slug, '')) = 'doorflow-legacy'
  and not exists (
    select 1
    from public.subscription_accounts account
    where account.organization_id = org.id
  );

insert into public.venue_settings (venue_id)
select venue.id
from public.venues venue
where not exists (
  select 1
  from public.venue_settings settings
  where settings.venue_id = venue.id
);

insert into public.venue_branding (venue_id)
select venue.id
from public.venues venue
where not exists (
  select 1
  from public.venue_branding branding
  where branding.venue_id = venue.id
);

-- Backfill venue_id on existing operational data.
-- Prefer the existing EVE venue. If EVE is not present, use the oldest venue.

update public.groups item
set venue_id = service_day.venue_id
from public.service_days service_day
where item.venue_id is null
  and item.service_day_id = service_day.id
  and service_day.venue_id is not null;

update public.shift_notes item
set venue_id = service_day.venue_id
from public.service_days service_day
where item.venue_id is null
  and item.service_day_id = service_day.id
  and service_day.venue_id is not null;

update public.guests item
set venue_id = guest_group.venue_id
from public.groups guest_group
where item.venue_id is null
  and item.group_id = guest_group.id
  and guest_group.venue_id is not null;

update public.check_in_logs item
set venue_id = guest.venue_id
from public.guests guest
where item.venue_id is null
  and item.guest_id = guest.id
  and guest.venue_id is not null;

update public.check_in_logs item
set venue_id = guest_group.venue_id
from public.groups guest_group
where item.venue_id is null
  and item.group_id = guest_group.id
  and guest_group.venue_id is not null;

with selected_venue as (
  select id
  from public.venues
  order by
    case when name = 'EVE' then 0 else 1 end,
    created_at asc
  limit 1
)
update public.groups item
set venue_id = selected_venue.id
from selected_venue
where item.venue_id is null;

with selected_venue as (
  select id
  from public.venues
  order by
    case when name = 'EVE' then 0 else 1 end,
    created_at asc
  limit 1
)
update public.guests item
set venue_id = selected_venue.id
from selected_venue
where item.venue_id is null;

with selected_venue as (
  select id
  from public.venues
  order by
    case when name = 'EVE' then 0 else 1 end,
    created_at asc
  limit 1
)
update public.check_in_logs item
set venue_id = selected_venue.id
from selected_venue
where item.venue_id is null;

with selected_venue as (
  select id
  from public.venues
  order by
    case when name = 'EVE' then 0 else 1 end,
    created_at asc
  limit 1
)
update public.shift_notes item
set venue_id = selected_venue.id
from selected_venue
where item.venue_id is null;

with selected_venue as (
  select id
  from public.venues
  order by
    case when name = 'EVE' then 0 else 1 end,
    created_at asc
  limit 1
)
update public.staff_profiles item
set venue_id = selected_venue.id
from selected_venue
where item.venue_id is null;