-- DoorFlow Phase 8.2A.1 staff invitations
-- REVIEW ONLY / UNAPPLIED. DO NOT RUN AGAINST PRODUCTION.
--
-- This installation script is deliberately outside the migration directory.
-- It creates only new DoorFlow invitation objects. It does not alter auth.*,
-- existing operational tables or policies, publications, roles, accounts, or
-- data. The one SECURITY DEFINER function is an exact, read-only auth.users
-- lookup in a non-exposed private schema. Every public entry point is
-- SECURITY INVOKER, has a fixed empty search_path, and is executable only by
-- service_role. Browser roles receive no table, schema, or function access.
--
-- Review and apply only as one transaction after the deployment-guide
-- preflight. All time, cooldown, lease, authorization, and action decisions in
-- the RPCs below use current database state and database time.

begin;

create schema doorflow_invitation_private;

revoke all on schema doorflow_invitation_private
  from public, anon, authenticated, service_role;
grant usage on schema doorflow_invitation_private to service_role;

-- Audit metadata is deliberately a tiny typed envelope. Nested values and
-- arbitrary keys are rejected before they can become durable evidence.
create function doorflow_invitation_private.valid_audit_details(p_details jsonb)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_type text;
  v_text text;
  v_number numeric;
begin
  if pg_catalog.jsonb_typeof(p_details) <> 'object'
     or pg_catalog.pg_column_size(p_details) > 2048 then
    return false;
  end if;

  for v_key, v_value in
    select item.key, item.value
    from pg_catalog.jsonb_each(p_details) as item
  loop
    if v_key not in (
      'action',
      'attempt_count',
      'decision_code',
      'identity_matched',
      'lookup_complete',
      'operation_fence',
      'outcome',
      'prior_status',
      'profile_state',
      'reason_code',
      'repair_result',
      'retry_after_seconds',
      'send_state'
    ) then
      return false;
    end if;

    v_type := pg_catalog.jsonb_typeof(v_value);
    if v_type in ('array', 'object') then
      return false;
    end if;

    if v_key in ('attempt_count', 'operation_fence', 'retry_after_seconds') then
      if v_type <> 'number' then
        return false;
      end if;
      v_number := (v_value #>> '{}')::numeric;
      if v_number <> pg_catalog.trunc(v_number)
         or v_number < 0
         or v_number > 1000000 then
        return false;
      end if;
    elsif v_key in ('identity_matched', 'lookup_complete') then
      if v_type <> 'boolean' then
        return false;
      end if;
    elsif v_type = 'string' then
      v_text := v_value #>> '{}';
      if v_text <> pg_catalog.btrim(v_text)
         or pg_catalog.char_length(v_text) not between 1 and 100
         or v_text !~ '^[A-Za-z0-9_.:-]+$' then
        return false;
      end if;
    elsif v_type <> 'null' then
      return false;
    end if;
  end loop;

  return true;
end
$$;

create function doorflow_invitation_private.event_uuid(
  p_invitation_id uuid,
  p_operation_token uuid,
  p_event_type text,
  p_classification text
)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_hex text;
begin
  v_hex := pg_catalog.md5(
    p_invitation_id::text || E'\n'
    || coalesce(p_operation_token::text, 'reservation') || E'\n'
    || p_event_type || E'\n'
    || p_classification
  );
  return (
    pg_catalog.substr(v_hex, 1, 8) || '-' ||
    pg_catalog.substr(v_hex, 9, 4) || '-' ||
    pg_catalog.substr(v_hex, 13, 4) || '-' ||
    pg_catalog.substr(v_hex, 17, 4) || '-' ||
    pg_catalog.substr(v_hex, 21, 12)
  )::uuid;
end
$$;

create table public.staff_invitations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  invited_by_user_id uuid not null,
  last_actor_user_id uuid not null,
  venue_id uuid not null references public.venues(id) on delete restrict,
  email text not null,
  normalized_email text not null,
  full_name text not null,
  requested_role text not null,
  auth_user_id uuid,
  status text not null default 'reserved',
  send_state text not null default 'not_attempted',
  profile_state text not null default 'pending',
  idempotency_key text not null,
  request_fingerprint text not null,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  last_provider_attempt_at timestamptz,
  last_sent_at timestamptz,

  -- Current operation snapshot. operation_fence increases monotonically;
  -- operation_token is globally unique and is the authoritative CAS token.
  operation_fence bigint not null default 0,
  operation_token uuid,
  operation_action text,
  operation_state text not null default 'idle',
  operation_actor_user_id uuid,
  operation_request_id uuid,
  operation_started_at timestamptz,
  processing_started_at timestamptz,
  lease_expires_at timestamptz,
  dispatch_authorized_at timestamptz,
  dispatch_started_at timestamptz,
  operation_completed_at timestamptz,
  expected_auth_user_id uuid,

  failure_code text,
  failure_message text,

  -- Exact repair provenance. All fields are null together or populated
  -- together. The original actor/request/operation survive later repair.
  pending_audit_event_type text,
  pending_audit_classification text,
  pending_audit_originating_actor_user_id uuid,
  pending_audit_originating_request_id uuid,
  pending_audit_operation_token uuid,
  pending_audit_details jsonb,

  accepted_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint staff_invitations_email_trimmed_check
    check (email = pg_catalog.btrim(email) and pg_catalog.char_length(email) between 3 and 320),
  constraint staff_invitations_normalized_email_check
    check (
      normalized_email = pg_catalog.lower(pg_catalog.btrim(email))
      and pg_catalog.char_length(normalized_email) between 3 and 320
    ),
  constraint staff_invitations_full_name_check
    check (full_name = pg_catalog.btrim(full_name) and pg_catalog.char_length(full_name) between 2 and 120),
  constraint staff_invitations_requested_role_check
    check (requested_role in ('admin', 'manager', 'door', 'viewer')),
  constraint staff_invitations_status_check
    check (
      status in (
        'reserved', 'processing', 'profile_pending', 'sent', 'accepted',
        'failed', 'reconciliation_required'
      )
    ),
  constraint staff_invitations_send_state_check
    check (send_state in ('not_attempted', 'provider_accepted', 'failed', 'unknown')),
  constraint staff_invitations_profile_state_check
    check (profile_state in ('pending', 'created', 'existing', 'failed')),
  constraint staff_invitations_idempotency_key_check
    check (
      idempotency_key = pg_catalog.btrim(idempotency_key)
      and pg_catalog.char_length(idempotency_key) between 1 and 200
    ),
  constraint staff_invitations_request_fingerprint_check
    check (
      request_fingerprint = pg_catalog.btrim(request_fingerprint)
      and pg_catalog.char_length(request_fingerprint) between 1 and 200
    ),
  constraint staff_invitations_attempt_count_check check (attempt_count >= 0),
  constraint staff_invitations_operation_fence_check check (operation_fence >= 0),
  constraint staff_invitations_operation_action_check
    check (operation_action is null or operation_action in ('invite', 'retry', 'resend', 'reconcile', 'audit_repair')),
  constraint staff_invitations_operation_state_check
    check (
      operation_state in (
        'idle', 'claimed', 'dispatch_authorized', 'provider_accepted',
        'provider_unknown', 'provider_rejected', 'identity_mismatch',
        'profile_finalizing', 'reconciling', 'completed',
        'abandoned_before_dispatch'
      )
    ),
  constraint staff_invitations_operation_identity_check
    check (
      (operation_state = 'idle'
        and operation_token is null
        and operation_action is null
        and operation_actor_user_id is null
        and operation_request_id is null
        and operation_started_at is null)
      or
      (operation_state <> 'idle'
        and operation_token is not null
        and operation_action is not null
        and operation_actor_user_id is not null
        and operation_request_id is not null
        and operation_started_at is not null)
    ),
  constraint staff_invitations_lease_check
    check (
      (processing_started_at is null and lease_expires_at is null)
      or
      (processing_started_at is not null
        and lease_expires_at is not null
        and lease_expires_at > processing_started_at)
    ),
  constraint staff_invitations_dispatch_check
    check (
      (
        (dispatch_authorized_at is null and dispatch_started_at is null)
        or
        (dispatch_authorized_at is not null
          and dispatch_started_at is not null
          and dispatch_started_at >= dispatch_authorized_at
          and last_provider_attempt_at is not null)
      )
      and (
        operation_state not in (
          'dispatch_authorized', 'provider_accepted', 'provider_unknown',
          'provider_rejected', 'identity_mismatch'
        )
        or dispatch_started_at is not null
      )
    ),
  constraint staff_invitations_send_identity_check
    check (
      send_state <> 'provider_accepted'
      or (auth_user_id is not null and last_sent_at is not null)
    ),
  constraint staff_invitations_terminal_profile_check
    check (
      (
        status <> 'sent'
        or (
          send_state = 'provider_accepted'
          and auth_user_id is not null
          and profile_state in ('created', 'existing')
        )
      )
      and (
        status <> 'accepted'
        or (
          auth_user_id is not null
          and last_sent_at is not null
          and profile_state in ('created', 'existing')
        )
      )
    ),
  constraint staff_invitations_failure_code_check
    check (
      failure_code is null
      or (
        failure_code = pg_catalog.btrim(failure_code)
        and pg_catalog.char_length(failure_code) between 1 and 100
        and failure_code ~ '^[a-z0-9_:-]+$'
      )
    ),
  constraint staff_invitations_failure_message_check
    check (failure_message is null or pg_catalog.char_length(failure_message) <= 500),
  constraint staff_invitations_pending_audit_check
    -- A marker is either absent or complete and repairable. CHECK normally
    -- accepts SQL NULL; IS TRUE makes every incomplete envelope fail closed.
    check ((
      (
        pending_audit_event_type is null
        and pending_audit_classification is null
        and pending_audit_originating_actor_user_id is null
        and pending_audit_originating_request_id is null
        and pending_audit_operation_token is null
        and pending_audit_details is null
      )
      or
      (
        pending_audit_event_type in (
          'provider_accepted', 'provider_outcome_recorded',
          'reconciliation_required', 'reconciliation_checked',
          'profile_created', 'profile_verified', 'profile_failed',
          'provisioning_completed', 'profile_conflict',
          'accepted_reconciled', 'accepted_profile_conflict'
        )
        and pending_audit_classification is not null
        and pending_audit_classification = pg_catalog.btrim(pending_audit_classification)
        and pg_catalog.char_length(pending_audit_classification) between 1 and 100
        and pending_audit_classification ~ '^[a-z0-9_:-]+$'
        and pending_audit_originating_actor_user_id is not null
        and pending_audit_originating_request_id is not null
        and pending_audit_operation_token is not null
        and pending_audit_details is not null
        and pending_audit_details = '{}'::jsonb
        and doorflow_invitation_private.valid_audit_details(pending_audit_details)
        and (
          (
            pending_audit_event_type = 'provider_accepted'
            and pending_audit_classification in ('provider_accepted', 'invitation_resent')
            and send_state = 'provider_accepted'
            and auth_user_id is not null
          )
          or (
            pending_audit_event_type = 'provider_outcome_recorded'
            and pending_audit_classification in ('provider_rejected_verified', 'rate_limited_verified')
            and send_state = 'failed'
          )
          or (
            pending_audit_event_type = 'reconciliation_required'
            and status = 'reconciliation_required'
            and pending_audit_classification in (
              'provider_outcome_unknown', 'provider_identity_mismatch',
              'resend_identity_mismatch', 'stored_auth_identity_mismatch',
              'stored_auth_user_missing', 'unowned_auth_identity_mismatch',
              'exact_auth_lookup_unavailable', 'existing_account_active',
              'existing_account_inactive', 'existing_account_role_conflict',
              'existing_account_other_venue', 'confirmed_account_unlinked',
              'unowned_pending_auth_account'
            )
          )
          or (
            pending_audit_event_type = 'reconciliation_checked'
            and pending_audit_classification = 'not_accepted'
            and auth_user_id is not null
            and accepted_at is null
          )
          or (
            (
              (pending_audit_event_type = 'profile_created' and pending_audit_classification = 'created')
              or (pending_audit_event_type = 'profile_verified' and pending_audit_classification = 'existing')
            )
            and profile_state = pending_audit_classification
            and auth_user_id is not null
            -- The existing repair chain must be able to set sent/accepted.
            -- Accepted-profile recovery may retain a failed/unknown send state.
            and last_sent_at is not null
            and (accepted_at is not null or send_state = 'provider_accepted')
          )
          or (
            pending_audit_event_type = 'profile_failed'
            and pending_audit_classification = 'profile_write_failed'
            and status = 'profile_pending'
            and profile_state = 'failed'
            and auth_user_id is not null
          )
          or (
            pending_audit_event_type = 'provisioning_completed'
            and pending_audit_classification = 'profile_ready'
            and profile_state in ('created', 'existing')
            and status in ('sent', 'accepted')
          )
          or (
            pending_audit_event_type = 'profile_conflict'
            and pending_audit_classification in (
              'existing_account_inactive', 'existing_account_role_conflict',
              'existing_account_other_venue'
            )
            and status = 'failed'
            and profile_state = 'failed'
          )
          or (
            pending_audit_event_type = 'accepted_reconciled'
            and pending_audit_classification = 'verified_auth'
            and status = 'accepted'
            and accepted_at is not null
          )
          or (
            pending_audit_event_type = 'accepted_profile_conflict'
            and pending_audit_classification in (
              'accepted_profile_missing', 'accepted_profile_inactive',
              'accepted_profile_role_conflict', 'accepted_profile_other_venue'
            )
            and status in ('failed', 'profile_pending')
            and profile_state = 'failed'
            and accepted_at is not null
          )
        )
      )
    ) is true),
  constraint staff_invitations_acceptance_check
    check (status <> 'accepted' or accepted_at is not null)
);

comment on table public.staff_invitations is
  'Server-owned Phase 8.2A.1 invitation state. Browser roles have no access.';
comment on column public.staff_invitations.normalized_email is
  'Globally unique lower(btrim(email)); prevents cross-venue invitation races without exposing the owning venue.';
comment on column public.staff_invitations.operation_token is
  'Unique fencing token for the current operation; a timestamp alone is never ownership proof.';
comment on column public.staff_invitations.dispatch_started_at is
  'Durable dispatch boundary. Once set, lease expiry alone never permits another invitation dispatch.';
comment on column public.staff_invitations.pending_audit_operation_token is
  'Original operation whose exact required evidence must be repaired; not replaced by the repairing actor or request.';

create unique index staff_invitations_normalized_email_unique
  on public.staff_invitations (normalized_email);
create unique index staff_invitations_actor_idempotency_unique
  on public.staff_invitations (invited_by_user_id, idempotency_key);
create unique index staff_invitations_auth_user_unique
  on public.staff_invitations (auth_user_id) where auth_user_id is not null;
create unique index staff_invitations_operation_token_unique
  on public.staff_invitations (operation_token) where operation_token is not null;
create index staff_invitations_venue_status_idx
  on public.staff_invitations (venue_id, status, updated_at desc);
create index staff_invitations_pending_audit_idx
  on public.staff_invitations (venue_id, pending_audit_event_type)
  where pending_audit_event_type is not null;

create table public.staff_invitation_attempts (
  operation_token uuid primary key,
  invitation_id uuid not null references public.staff_invitations(id) on delete restrict,
  venue_id uuid not null references public.venues(id) on delete restrict,
  operation_fence bigint not null,
  action text not null,
  state text not null,
  actor_user_id uuid not null,
  originating_request_id uuid not null,
  expected_auth_user_id uuid,
  normalized_email text not null,
  requested_role text not null,
  requires_provider_dispatch boolean not null,
  claimed_at timestamptz not null,
  lease_expires_at timestamptz not null,
  dispatch_authorized_at timestamptz,
  dispatch_started_at timestamptz,
  provider_completed_at timestamptz,
  completed_at timestamptz,
  provider_outcome text,
  failure_code text,
  recovery_checked_at timestamptz,
  recovery_lookup_complete boolean,
  recovery_actor_user_id uuid,
  recovery_operation_token uuid,
  recovery_request_id uuid,
  observed_auth_user_id uuid,
  observed_normalized_email text,
  observed_email_confirmed_at timestamptz,
  observed_invited_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint staff_invitation_attempts_fence_check check (operation_fence > 0),
  constraint staff_invitation_attempts_action_check
    check (action in ('invite', 'retry', 'resend', 'reconcile', 'audit_repair')),
  constraint staff_invitation_attempts_state_check
    check (
      state in (
        'claimed', 'dispatch_authorized', 'provider_accepted',
        'provider_unknown', 'provider_rejected', 'identity_mismatch',
        'profile_finalizing', 'reconciling', 'completed',
        'abandoned_before_dispatch'
      )
    ),
  constraint staff_invitation_attempts_email_check
    check (
      normalized_email = pg_catalog.lower(pg_catalog.btrim(normalized_email))
      and pg_catalog.char_length(normalized_email) between 3 and 320
    ),
  constraint staff_invitation_attempts_role_check
    check (requested_role in ('admin', 'manager', 'door', 'viewer')),
  constraint staff_invitation_attempts_lease_check check (lease_expires_at > claimed_at),
  constraint staff_invitation_attempts_dispatch_check
    check (
      (
        (dispatch_authorized_at is null and dispatch_started_at is null)
        or
        (requires_provider_dispatch
          and dispatch_authorized_at is not null
          and dispatch_started_at is not null
          and dispatch_started_at >= dispatch_authorized_at)
      )
      and (
        state not in (
          'dispatch_authorized', 'provider_accepted', 'provider_unknown',
          'provider_rejected', 'identity_mismatch'
        )
        or dispatch_started_at is not null
      )
    ),
  constraint staff_invitation_attempts_outcome_check
    -- CHECK otherwise accepts UNKNOWN. Outcome-bearing states require their
    -- explicit outcome; pre-result/profile-only states retain the NULL arm.
    check ((
      (state = 'provider_accepted' and provider_outcome = 'accepted')
      or (state = 'provider_unknown' and provider_outcome = 'unknown')
      or (state = 'provider_rejected' and provider_outcome = 'rejected')
      or (state = 'identity_mismatch' and provider_outcome = 'identity_mismatch')
      or (
        state not in (
          'provider_accepted', 'provider_unknown', 'provider_rejected',
          'identity_mismatch'
        )
        and (provider_outcome is null or provider_outcome = 'accepted')
      )
    ) is true),
  constraint staff_invitation_attempts_completion_check
    check (
      (state in ('provider_rejected', 'identity_mismatch', 'completed', 'abandoned_before_dispatch'))
      = (completed_at is not null)
    ),
  constraint staff_invitation_attempts_provider_completion_check
    check (
      state not in ('provider_accepted', 'provider_rejected', 'identity_mismatch')
      or provider_completed_at is not null
    ),
  constraint staff_invitation_attempts_failure_code_check
    check (
      failure_code is null
      or (
        failure_code = pg_catalog.btrim(failure_code)
        and pg_catalog.char_length(failure_code) between 1 and 100
        and failure_code ~ '^[a-z0-9_:-]+$'
      )
    ),
  constraint staff_invitation_attempts_recovery_observation_check
    check (
      (
        recovery_checked_at is null
        and recovery_lookup_complete is null
        and recovery_actor_user_id is null
        and recovery_operation_token is null
        and recovery_request_id is null
        and observed_auth_user_id is null
        and observed_normalized_email is null
        and observed_email_confirmed_at is null
        and observed_invited_at is null
      )
      or
      (
        recovery_checked_at is not null
        and recovery_lookup_complete is not null
        and recovery_actor_user_id is not null
        and recovery_operation_token is not null
        and recovery_request_id is not null
        and dispatch_started_at is not null
        and recovery_checked_at >= dispatch_started_at
        and (
          (
            recovery_lookup_complete is false
            and observed_auth_user_id is null
            and observed_normalized_email is null
            and observed_email_confirmed_at is null
            and observed_invited_at is null
          )
          or
          (
            recovery_lookup_complete is true
            and (
              (
                observed_auth_user_id is null
                and observed_normalized_email is null
                and observed_email_confirmed_at is null
                and observed_invited_at is null
              )
              or
              (
                observed_auth_user_id is not null
                and observed_normalized_email = pg_catalog.lower(pg_catalog.btrim(observed_normalized_email))
                and pg_catalog.char_length(observed_normalized_email) between 3 and 320
              )
            )
          )
        )
      )
    )
);

comment on table public.staff_invitation_attempts is
  'Durable fenced operation lifecycle. dispatch_authorized/provider_unknown rows remain unresolved regardless of coordination-lease age.';

create unique index staff_invitation_attempts_invitation_fence_unique
  on public.staff_invitation_attempts (invitation_id, operation_fence);
create unique index staff_invitation_attempts_unresolved_dispatch_idx
  on public.staff_invitation_attempts (invitation_id)
  where state in ('dispatch_authorized', 'provider_unknown') and completed_at is null;
create unique index staff_invitation_attempts_recovery_operation_unique
  on public.staff_invitation_attempts (recovery_operation_token)
  where recovery_operation_token is not null;

create table public.staff_invitation_audit (
  id uuid primary key,
  invitation_id uuid not null references public.staff_invitations(id) on delete restrict,
  actor_user_id uuid not null,
  originating_actor_user_id uuid not null,
  venue_id uuid not null references public.venues(id) on delete restrict,
  operation_token uuid,
  repair_operation_token uuid,
  event_type text not null,
  classification text not null,
  request_id uuid not null,
  recorded_request_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint staff_invitation_audit_event_type_check
    check (
      event_type = pg_catalog.btrim(event_type)
      and pg_catalog.char_length(event_type) between 1 and 100
      and event_type ~ '^[a-z0-9_:-]+$'
    ),
  constraint staff_invitation_audit_classification_check
    check (
      classification = pg_catalog.btrim(classification)
      and pg_catalog.char_length(classification) between 1 and 100
      and classification ~ '^[a-z0-9_:-]+$'
    ),
  constraint staff_invitation_audit_details_check
    check (doorflow_invitation_private.valid_audit_details(details))
);

comment on table public.staff_invitation_audit is
  'Append-only invitation evidence. actor_user_id is the recorder; originating_actor_user_id/request_id/operation_token preserve original attribution during repair.';
comment on column public.staff_invitation_audit.details is
  'Bounded, allowlisted, flat metadata only. Raw provider objects, credentials, links, tokens, and user-submitted prose are structurally rejected.';

create unique index staff_invitation_audit_canonical_event_unique
  on public.staff_invitation_audit (
    invitation_id,
    (coalesce(operation_token, invitation_id)),
    event_type,
    classification
  );
create index staff_invitation_audit_invitation_created_idx
  on public.staff_invitation_audit (invitation_id, created_at desc);
create index staff_invitation_audit_venue_created_idx
  on public.staff_invitation_audit (venue_id, created_at desc);
create index staff_invitation_audit_request_idx
  on public.staff_invitation_audit (request_id);

alter table public.staff_invitations enable row level security;
alter table public.staff_invitations force row level security;
alter table public.staff_invitation_attempts enable row level security;
alter table public.staff_invitation_attempts force row level security;
alter table public.staff_invitation_audit enable row level security;
alter table public.staff_invitation_audit force row level security;

revoke all privileges on table public.staff_invitations
  from public, anon, authenticated, service_role;
revoke all privileges on table public.staff_invitation_attempts
  from public, anon, authenticated, service_role;
revoke all privileges on table public.staff_invitation_audit
  from public, anon, authenticated, service_role;

-- No DELETE grant exists. Audit has no UPDATE grant and remains append-only.
grant select, insert, update on table public.staff_invitations to service_role;
grant select, insert, update on table public.staff_invitation_attempts to service_role;
grant select, insert on table public.staff_invitation_audit to service_role;

-- Canonical audit insertion. A unique conflict is accepted only after the
-- deterministic ID and all immutable canonical fields are read and verified.
create function doorflow_invitation_private.append_audit(
  p_invitation_id uuid,
  p_venue_id uuid,
  p_actor_user_id uuid,
  p_originating_actor_user_id uuid,
  p_operation_token uuid,
  p_repair_operation_token uuid,
  p_event_type text,
  p_classification text,
  p_request_id uuid,
  p_recorded_request_id uuid,
  p_details jsonb
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_inserted integer;
  v_existing public.staff_invitation_audit%rowtype;
begin
  v_id := doorflow_invitation_private.event_uuid(
    p_invitation_id, p_operation_token, p_event_type, p_classification
  );

  begin
    insert into public.staff_invitation_audit (
      id, invitation_id, actor_user_id, originating_actor_user_id, venue_id,
      operation_token, repair_operation_token, event_type, classification,
      request_id, recorded_request_id, details
    ) values (
      v_id, p_invitation_id, p_actor_user_id, p_originating_actor_user_id,
      p_venue_id, p_operation_token, p_repair_operation_token, p_event_type,
      p_classification, p_request_id, p_recorded_request_id,
      coalesce(p_details, '{}'::jsonb)
    )
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
  exception when others then
    return false;
  end;

  if v_inserted = 1 then
    return true;
  end if;

  select audit.*
    into v_existing
  from public.staff_invitation_audit as audit
  where audit.id = v_id;

  return found
    and v_existing.invitation_id = p_invitation_id
    and v_existing.venue_id = p_venue_id
    and v_existing.operation_token is not distinct from p_operation_token
    and v_existing.event_type = p_event_type
    and v_existing.classification = p_classification
    and v_existing.originating_actor_user_id = p_originating_actor_user_id
    and v_existing.request_id = p_request_id
    and v_existing.details = coalesce(p_details, '{}'::jsonb);
end
$$;

-- Reservation is a guarded database-only mutation. A cross-venue email
-- collision returns no record or owning venue. Identity, venue, role, and
-- request intent on an existing reservation are never overwritten.
create function public.doorflow_reserve_staff_invitation(
  p_actor_user_id uuid,
  p_venue_id uuid,
  p_email text,
  p_normalized_email text,
  p_full_name text,
  p_requested_role text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_actor public.staff_profiles%rowtype;
  v_row public.staff_invitations%rowtype;
  v_id uuid := pg_catalog.gen_random_uuid();
  v_audit_ok boolean;
begin
  if p_actor_user_id is null
     or p_venue_id is null
     or p_email is null
     or p_normalized_email is null
     or p_full_name is null
     or p_requested_role is null
     or p_idempotency_key is null
     or p_request_fingerprint is null
     or p_request_id is null
     or p_normalized_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
     or p_requested_role not in ('admin', 'manager', 'door', 'viewer') then
    return pg_catalog.jsonb_build_object('decision_code', 'invalid_request', 'record', null);
  end if;

  -- Actor-only privileged paths lock the actor profile FOR SHARE before the
  -- invitation/attempt. Paths that may use a target profile take a harmless
  -- invitation identity peek, lock all existing actor/target profiles in UUID
  -- order, validate the actor, then lock and re-read invitation/attempt state.
  -- FOR SHARE conflicts with profile UPDATE/DELETE through the transaction.
  select profile.* into v_actor
  from public.staff_profiles as profile
  where profile.id = p_actor_user_id
  for share;
  if not found
     or v_actor.active is not true
     or v_actor.role <> 'admin'
     or v_actor.venue_id is distinct from p_venue_id then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null);
  end if;

  select invitation.* into v_row
  from public.staff_invitations as invitation
  where invitation.invited_by_user_id = p_actor_user_id
    and invitation.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_row.venue_id <> p_venue_id then
      return pg_catalog.jsonb_build_object('decision_code', 'idempotency_conflict', 'record', null);
    end if;
    if v_row.request_fingerprint <> p_request_fingerprint then
      return pg_catalog.jsonb_build_object('decision_code', 'idempotency_conflict', 'record', pg_catalog.to_jsonb(v_row));
    end if;
    return pg_catalog.jsonb_build_object('decision_code', 'replay', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  select invitation.* into v_row
  from public.staff_invitations as invitation
  where invitation.normalized_email = p_normalized_email
  for update;

  if found then
    if v_row.venue_id <> p_venue_id then
      return pg_catalog.jsonb_build_object('decision_code', 'identity_unavailable', 'record', null);
    end if;
    return pg_catalog.jsonb_build_object('decision_code', 'email_reserved', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  begin
    insert into public.staff_invitations (
      id, invited_by_user_id, last_actor_user_id, venue_id, email,
      normalized_email, full_name, requested_role, idempotency_key,
      request_fingerprint
    ) values (
      v_id, p_actor_user_id, p_actor_user_id, p_venue_id,
      pg_catalog.btrim(p_email), p_normalized_email, pg_catalog.btrim(p_full_name),
      p_requested_role, pg_catalog.btrim(p_idempotency_key),
      pg_catalog.btrim(p_request_fingerprint)
    ) returning * into v_row;
  exception when unique_violation then
    select invitation.* into v_row
    from public.staff_invitations as invitation
    where invitation.invited_by_user_id = p_actor_user_id
      and invitation.idempotency_key = p_idempotency_key
    for update;
    if found then
      if v_row.venue_id <> p_venue_id then
        return pg_catalog.jsonb_build_object('decision_code', 'idempotency_conflict', 'record', null);
      end if;
      if v_row.request_fingerprint <> p_request_fingerprint then
        return pg_catalog.jsonb_build_object('decision_code', 'idempotency_conflict', 'record', pg_catalog.to_jsonb(v_row));
      end if;
      return pg_catalog.jsonb_build_object('decision_code', 'replay', 'record', pg_catalog.to_jsonb(v_row));
    end if;

    select invitation.* into v_row
    from public.staff_invitations as invitation
    where invitation.normalized_email = p_normalized_email
    for update;
    if found and v_row.venue_id = p_venue_id then
      return pg_catalog.jsonb_build_object('decision_code', 'email_reserved', 'record', pg_catalog.to_jsonb(v_row));
    end if;
    return pg_catalog.jsonb_build_object('decision_code', 'identity_unavailable', 'record', null);
  end;

  v_audit_ok := doorflow_invitation_private.append_audit(
    v_row.id, v_row.venue_id, p_actor_user_id, p_actor_user_id, null, null,
    'invitation_reserved', 'reserved', p_request_id, p_request_id, '{}'::jsonb
  );
  if not v_audit_ok then
    raise exception 'required reservation audit could not be recorded';
  end if;

  return pg_catalog.jsonb_build_object('decision_code', 'reserved', 'record', pg_catalog.to_jsonb(v_row));
end
$$;

-- Authoritative claim. This row lock, current Admin lookup, action decision,
-- cooldown calculation, fencing-token install, attempt insert, and
-- attempt_started audit all share one transaction and database timestamp.
create function public.doorflow_claim_staff_invitation(
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_operation_token uuid,
  p_cooldown_seconds integer,
  p_lease_seconds integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_actor public.staff_profiles%rowtype;
  v_row public.staff_invitations%rowtype;
  v_existing_attempt public.staff_invitation_attempts%rowtype;
  v_requires_dispatch boolean := false;
  v_last_provider timestamptz;
  v_retry_after integer := 0;
  v_new_fence bigint;
  v_audit_ok boolean;
begin
  if p_action is null
     or p_action not in ('invite', 'retry', 'resend')
     or p_operation_token is null
     or p_request_id is null
     or p_cooldown_seconds is null
     or p_lease_seconds is null
     or p_cooldown_seconds not between 60 and 86400
     or p_lease_seconds not between 30 and 600 then
    return pg_catalog.jsonb_build_object('decision_code', 'invalid_claim', 'retry_after_seconds', 0, 'record', null);
  end if;

  select profile.* into v_actor
  from public.staff_profiles as profile
  where profile.id = p_actor_user_id
  for share;
  if not found
     or v_actor.active is not true
     or v_actor.role <> 'admin'
     or v_actor.venue_id is null then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'retry_after_seconds', 0, 'record', null);
  end if;

  select invitation.* into v_row
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'retry_after_seconds', 0, 'record', null);
  end if;

  -- Refresh only after the authoritative row lock; a request may have waited
  -- behind another worker and must not make lease/cooldown decisions using its
  -- pre-wait timestamp.
  v_now := pg_catalog.clock_timestamp();

  if v_actor.venue_id <> v_row.venue_id then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'retry_after_seconds', 0, 'record', null);
  end if;

  select attempt.* into v_existing_attempt
  from public.staff_invitation_attempts as attempt
  where attempt.operation_token = p_operation_token;
  if found then
    if v_existing_attempt.invitation_id = v_row.id
       and v_existing_attempt.actor_user_id = p_actor_user_id
       and v_existing_attempt.action = p_action
       and v_existing_attempt.originating_request_id = p_request_id then
      return pg_catalog.jsonb_build_object(
        'decision_code', 'operation_replay',
        'retry_after_seconds', greatest(0, pg_catalog.ceil(extract(epoch from (v_existing_attempt.lease_expires_at - v_now)))::integer),
        'requires_provider_dispatch', v_existing_attempt.requires_provider_dispatch,
        'record', pg_catalog.to_jsonb(v_row)
      );
    end if;
    return pg_catalog.jsonb_build_object('decision_code', 'operation_token_conflict', 'retry_after_seconds', 0, 'record', null);
  end if;

  if v_row.pending_audit_event_type is not null then
    return pg_catalog.jsonb_build_object('decision_code', 'audit_repair_required', 'retry_after_seconds', 0, 'record', pg_catalog.to_jsonb(v_row));
  end if;

  if exists (
    select 1 from public.staff_invitation_attempts as attempt
    where attempt.invitation_id = v_row.id
      and attempt.state in ('dispatch_authorized', 'provider_unknown')
      and attempt.completed_at is null
  ) then
    return pg_catalog.jsonb_build_object('decision_code', 'provider_outcome_unknown', 'retry_after_seconds', 0, 'record', pg_catalog.to_jsonb(v_row));
  end if;

  if v_row.operation_state = 'claimed'
     and v_row.lease_expires_at is not null
     and v_row.lease_expires_at > v_now then
    v_retry_after := greatest(1, pg_catalog.ceil(extract(epoch from (v_row.lease_expires_at - v_now)))::integer);
    return pg_catalog.jsonb_build_object('decision_code', 'attempt_in_progress', 'retry_after_seconds', v_retry_after, 'record', pg_catalog.to_jsonb(v_row));
  end if;

  if v_row.operation_state = 'claimed'
     and v_row.operation_token is not null
     and v_row.lease_expires_at <= v_now then
    update public.staff_invitation_attempts
    set state = 'abandoned_before_dispatch', completed_at = v_now,
        updated_at = v_now, failure_code = 'coordination_lease_expired'
    where operation_token = v_row.operation_token
      and state = 'claimed'
      and dispatch_started_at is null;
    v_audit_ok := doorflow_invitation_private.append_audit(
      v_row.id, v_row.venue_id, p_actor_user_id,
      v_row.operation_actor_user_id, v_row.operation_token, null,
      'attempt_abandoned', 'coordination_lease_expired',
      v_row.operation_request_id, p_request_id,
      pg_catalog.jsonb_build_object('operation_fence', v_row.operation_fence)
    );
    if not v_audit_ok then
      raise exception 'required abandoned-attempt audit could not be recorded';
    end if;
  end if;

  if v_row.accepted_at is not null then
    if p_action <> 'retry'
       or v_row.status not in ('profile_pending', 'accepted')
       or v_row.auth_user_id is null
       or v_row.last_sent_at is null
       or v_row.profile_state <> 'failed'
       or v_row.failure_code not in ('accepted_profile_missing', 'profile_write_failed') then
      return pg_catalog.jsonb_build_object('decision_code', 'accepted_terminal', 'retry_after_seconds', 0, 'record', pg_catalog.to_jsonb(v_row));
    end if;
    v_requires_dispatch := false;
  elsif p_action = 'invite' then
    if v_row.status <> 'reserved' or v_row.send_state <> 'not_attempted' then
      return pg_catalog.jsonb_build_object('decision_code', 'invite_not_eligible', 'retry_after_seconds', 0, 'record', pg_catalog.to_jsonb(v_row));
    end if;
    v_requires_dispatch := true;
  elsif p_action = 'resend' then
    if v_row.auth_user_id is null
       or v_row.send_state <> 'provider_accepted'
       or v_row.status <> 'sent'
       or v_row.profile_state not in ('created', 'existing') then
      return pg_catalog.jsonb_build_object('decision_code', 'resend_not_eligible', 'retry_after_seconds', 0, 'record', pg_catalog.to_jsonb(v_row));
    end if;
    v_requires_dispatch := true;
  else
    if v_row.status = 'reconciliation_required' or v_row.send_state = 'unknown' then
      return pg_catalog.jsonb_build_object('decision_code', 'reconciliation_required', 'retry_after_seconds', 0, 'record', pg_catalog.to_jsonb(v_row));
    elsif v_row.send_state = 'provider_accepted'
          and v_row.auth_user_id is not null
          and (v_row.status = 'profile_pending' or v_row.profile_state in ('pending', 'failed')) then
      v_requires_dispatch := false;
    elsif v_row.send_state in ('not_attempted', 'failed') then
      v_requires_dispatch := true;
    else
      return pg_catalog.jsonb_build_object('decision_code', 'retry_not_eligible', 'retry_after_seconds', 0, 'record', pg_catalog.to_jsonb(v_row));
    end if;
  end if;

  if v_row.operation_state = 'provider_accepted'
     and v_row.operation_token is not null then
    update public.staff_invitation_attempts
    set state = 'completed', completed_at = v_now,
        failure_code = 'profile_completion_reclaimed', updated_at = v_now
    where operation_token = v_row.operation_token
      and state = 'provider_accepted';
  end if;

  if v_requires_dispatch and p_action <> 'invite' then
    v_last_provider := v_row.last_provider_attempt_at;
    if v_last_provider is not null
       and v_last_provider + (p_cooldown_seconds * interval '1 second') > v_now then
      v_retry_after := greatest(
        1,
        pg_catalog.ceil(extract(epoch from (
          v_last_provider + (p_cooldown_seconds * interval '1 second') - v_now
        )))::integer
      );
      return pg_catalog.jsonb_build_object(
        'decision_code', case when p_action = 'resend' then 'resend_cooldown' else 'retry_cooldown' end,
        'retry_after_seconds', v_retry_after,
        'record', pg_catalog.to_jsonb(v_row)
      );
    end if;
  end if;

  v_new_fence := v_row.operation_fence + 1;
  insert into public.staff_invitation_attempts (
    operation_token, invitation_id, venue_id, operation_fence, action, state,
    actor_user_id, originating_request_id, expected_auth_user_id,
    normalized_email, requested_role, requires_provider_dispatch,
    claimed_at, lease_expires_at
  ) values (
    p_operation_token, v_row.id, v_row.venue_id, v_new_fence, p_action,
    'claimed', p_actor_user_id, p_request_id, v_row.auth_user_id,
    v_row.normalized_email, v_row.requested_role, v_requires_dispatch,
    v_now, v_now + (p_lease_seconds * interval '1 second')
  );

  update public.staff_invitations
  set last_actor_user_id = p_actor_user_id,
      status = 'processing',
      attempt_count = attempt_count + 1,
      last_attempt_at = v_now,
      operation_fence = v_new_fence,
      operation_token = p_operation_token,
      operation_action = p_action,
      operation_state = 'claimed',
      operation_actor_user_id = p_actor_user_id,
      operation_request_id = p_request_id,
      operation_started_at = v_now,
      processing_started_at = v_now,
      lease_expires_at = v_now + (p_lease_seconds * interval '1 second'),
      dispatch_authorized_at = null,
      dispatch_started_at = null,
      operation_completed_at = null,
      expected_auth_user_id = auth_user_id,
      updated_at = v_now
  where id = v_row.id
  returning * into v_row;

  v_audit_ok := doorflow_invitation_private.append_audit(
    v_row.id, v_row.venue_id, p_actor_user_id, p_actor_user_id,
    p_operation_token, null, 'attempt_started', p_action,
    p_request_id, p_request_id,
    pg_catalog.jsonb_build_object(
      'action', p_action,
      'attempt_count', v_row.attempt_count,
      'operation_fence', v_new_fence
    )
  );
  if not v_audit_ok then
    raise exception 'required attempt-start audit could not be recorded';
  end if;

  return pg_catalog.jsonb_build_object(
    'decision_code', 'claimed',
    'retry_after_seconds', 0,
    'requires_provider_dispatch', v_requires_dispatch,
    'record', pg_catalog.to_jsonb(v_row)
  );
end
$$;

-- This is the durable dispatch boundary. It reauthorizes with current profile
-- state and atomically verifies the exact operation token/actor/live lease.
-- After it commits, the provider may have been called; lease expiry never
-- authorizes a replacement dispatch.
create function public.doorflow_authorize_staff_invitation_dispatch(
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_operation_token uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_actor public.staff_profiles%rowtype;
  v_target_profile public.staff_profiles%rowtype;
  v_target_profile_valid boolean := true;
  v_peek_auth_user_id uuid;
  v_lock_profile_id uuid;
  v_row public.staff_invitations%rowtype;
  v_attempt public.staff_invitation_attempts%rowtype;
  v_audit_ok boolean;
begin
  if p_invitation_id is null
     or p_actor_user_id is null
     or p_operation_token is null
     or p_request_id is null then
    return pg_catalog.jsonb_build_object('decision_code', 'invalid_request', 'record', null);
  end if;

  -- Discover the possible target without relying on this snapshot for a
  -- decision. Lock every existing profile participating in the boundary in
  -- UUID order, then re-read and fence the invitation below. This preserves
  -- actor reauthorization while preventing reciprocal Admin/target lock
  -- inversion across concurrent invitations.
  select invitation.auth_user_id into v_peek_auth_user_id
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'record', null);
  end if;

  for v_lock_profile_id in
    select profile.id
    from public.staff_profiles as profile
    where profile.id = p_actor_user_id
       or profile.id = v_peek_auth_user_id
    order by profile.id
  loop
    perform 1
    from public.staff_profiles as profile
    where profile.id = v_lock_profile_id
    for share;
  end loop;

  select profile.* into v_actor
  from public.staff_profiles as profile
  where profile.id = p_actor_user_id
  for share;
  if not found
     or v_actor.active is not true
     or v_actor.role <> 'admin'
     or v_actor.venue_id is null then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null);
  end if;

  select invitation.* into v_row
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'record', null);
  end if;

  if v_actor.venue_id <> v_row.venue_id then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null);
  end if;

  if v_row.auth_user_id is distinct from v_peek_auth_user_id then
    return pg_catalog.jsonb_build_object('decision_code', 'operation_lost', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  select attempt.* into v_attempt
  from public.staff_invitation_attempts as attempt
  where attempt.operation_token = p_operation_token
  for update;

  if not found
     or v_attempt.invitation_id <> v_row.id
     or v_attempt.venue_id <> v_row.venue_id
     or v_attempt.normalized_email <> v_row.normalized_email
     or v_attempt.requested_role <> v_row.requested_role
     or v_attempt.operation_fence <> v_row.operation_fence
     or v_attempt.actor_user_id <> p_actor_user_id
     or v_attempt.originating_request_id <> p_request_id
     or not v_attempt.requires_provider_dispatch
     or v_attempt.state <> 'claimed'
     or v_row.operation_token is distinct from p_operation_token
     or v_row.operation_action is distinct from v_attempt.action
     or v_row.operation_state <> 'claimed' then
    return pg_catalog.jsonb_build_object('decision_code', 'operation_lost', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  if v_attempt.action in ('resend', 'retry')
     and v_row.auth_user_id is not null then
    select profile.* into v_target_profile
    from public.staff_profiles as profile
    where profile.id = v_row.auth_user_id
    for share;
    v_target_profile_valid := found
      and v_target_profile.active is true
      and v_target_profile.venue_id is not distinct from v_row.venue_id
      and v_target_profile.role = v_row.requested_role;
  end if;

  -- Actor, invitation, attempt, and any target profile are now locked.
  v_now := pg_catalog.clock_timestamp();

  if v_attempt.lease_expires_at <= v_now then
    return pg_catalog.jsonb_build_object('decision_code', 'coordination_lease_expired', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  if v_row.pending_audit_event_type is not null
     or v_row.accepted_at is not null
     or v_row.auth_user_id is distinct from v_attempt.expected_auth_user_id
     or v_row.status <> 'processing'
     or (
       v_attempt.action = 'invite'
       and (v_row.send_state <> 'not_attempted' or v_row.auth_user_id is not null)
     )
     or (
       v_attempt.action = 'resend'
       and (
         v_row.send_state <> 'provider_accepted'
         or v_row.auth_user_id is null
         or v_row.profile_state not in ('created', 'existing')
       )
     )
     or (
       v_attempt.action = 'retry'
       and v_row.send_state not in ('not_attempted', 'failed')
     )
     or (
       v_attempt.action in ('resend', 'retry')
       and v_row.auth_user_id is not null
       and v_target_profile_valid is not true
     ) then
    return pg_catalog.jsonb_build_object('decision_code', 'dispatch_not_eligible', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  update public.staff_invitation_attempts
  set state = 'dispatch_authorized', dispatch_authorized_at = v_now,
      dispatch_started_at = v_now, updated_at = v_now
  where operation_token = p_operation_token;

  update public.staff_invitations
  set operation_state = 'dispatch_authorized',
      dispatch_authorized_at = v_now,
      dispatch_started_at = v_now,
      last_provider_attempt_at = v_now,
      updated_at = v_now
  where id = v_row.id
  returning * into v_row;

  v_audit_ok := doorflow_invitation_private.append_audit(
    v_row.id, v_row.venue_id, p_actor_user_id, p_actor_user_id,
    p_operation_token, null, 'dispatch_authorized', v_row.operation_action,
    p_request_id, p_request_id,
    pg_catalog.jsonb_build_object('action', v_row.operation_action, 'operation_fence', v_row.operation_fence)
  );
  if not v_audit_ok then
    raise exception 'required dispatch-authorization audit could not be recorded';
  end if;

  return pg_catalog.jsonb_build_object('decision_code', 'dispatch_authorized', 'record', pg_catalog.to_jsonb(v_row));
end
$$;

-- Truthful provider finalization. No current-Admin recheck is required here:
-- this RPC grants no new work and only records the result of an already
-- authorized dispatch. Exact attempt identity remains mandatory. A late result
-- may finalize provider_unknown. Identity mismatch never overwrites the stored
-- Auth ID, venue, role, or earlier send evidence.
create function public.doorflow_record_staff_invitation_provider_outcome(
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_operation_token uuid,
  p_outcome text,
  p_provider_auth_user_id uuid,
  p_provider_normalized_email text,
  p_request_id uuid,
  p_failure_code text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.staff_invitations%rowtype;
  v_attempt public.staff_invitation_attempts%rowtype;
  v_event text;
  v_classification text;
  v_audit_ok boolean;
begin
  if p_invitation_id is null
     or p_actor_user_id is null
     or p_operation_token is null
     or p_outcome is null
     or p_outcome not in ('accepted', 'unknown', 'identity_mismatch', 'rejected')
     or p_request_id is null then
    return pg_catalog.jsonb_build_object('decision_code', 'invalid_outcome', 'record', null);
  end if;
  if p_outcome = 'rejected'
     and coalesce(p_failure_code, 'provider_rejected_verified') not in (
       'provider_rejected_verified', 'rate_limited_verified'
     ) then
    return pg_catalog.jsonb_build_object('decision_code', 'invalid_failure_code', 'record', null);
  end if;

  select invitation.* into v_row
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'record', null);
  end if;

  v_now := pg_catalog.clock_timestamp();

  select attempt.* into v_attempt
  from public.staff_invitation_attempts as attempt
  where attempt.operation_token = p_operation_token
  for update;
  if not found
     or v_attempt.invitation_id <> v_row.id
     or v_attempt.venue_id <> v_row.venue_id
     or v_attempt.normalized_email <> v_row.normalized_email
     or v_attempt.requested_role <> v_row.requested_role
     or v_attempt.operation_fence <> v_row.operation_fence
     or v_attempt.actor_user_id <> p_actor_user_id
     or v_attempt.state not in ('dispatch_authorized', 'provider_unknown')
     or v_attempt.dispatch_started_at is null
     or v_row.operation_token is distinct from p_operation_token
     or v_row.operation_action is distinct from v_attempt.action
     or v_row.operation_state not in ('dispatch_authorized', 'provider_unknown') then
    return pg_catalog.jsonb_build_object('decision_code', 'operation_lost', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  -- A late exact-token result must not overwrite a missing earlier unknown-
  -- outcome audit. Repair that one canonical event first as a continuation of
  -- the already-authorized operation; no new provider/profile authority is
  -- granted. Other pending evidence still requires the separately authorized
  -- repair RPC.
  if v_row.pending_audit_event_type is not null then
    if v_row.pending_audit_event_type <> 'reconciliation_required'
       or v_row.pending_audit_classification <> 'provider_outcome_unknown'
       or v_row.pending_audit_originating_actor_user_id <> v_attempt.actor_user_id
       or v_row.pending_audit_originating_request_id <> v_attempt.originating_request_id
       or v_row.pending_audit_operation_token <> p_operation_token
       or v_row.pending_audit_details <> '{}'::jsonb then
      return pg_catalog.jsonb_build_object('decision_code', 'audit_repair_required', 'record', pg_catalog.to_jsonb(v_row));
    end if;
    v_audit_ok := doorflow_invitation_private.append_audit(
      v_row.id, v_row.venue_id, v_attempt.actor_user_id,
      v_row.pending_audit_originating_actor_user_id,
      p_operation_token, null,
      v_row.pending_audit_event_type, v_row.pending_audit_classification,
      v_row.pending_audit_originating_request_id, p_request_id,
      v_row.pending_audit_details
    );
    if not v_audit_ok then
      return pg_catalog.jsonb_build_object('decision_code', 'audit_repair_required', 'record', pg_catalog.to_jsonb(v_row));
    end if;
    update public.staff_invitations
    set pending_audit_event_type = null,
        pending_audit_classification = null,
        pending_audit_originating_actor_user_id = null,
        pending_audit_originating_request_id = null,
        pending_audit_operation_token = null,
        pending_audit_details = null,
        updated_at = v_now
    where id = v_row.id
    returning * into v_row;
  end if;

  if p_outcome = 'accepted' and (
    p_provider_auth_user_id is null
    or p_provider_normalized_email is null
    or pg_catalog.lower(pg_catalog.btrim(p_provider_normalized_email)) <> v_row.normalized_email
    or (v_attempt.expected_auth_user_id is not null and p_provider_auth_user_id <> v_attempt.expected_auth_user_id)
    or (v_row.auth_user_id is not null and p_provider_auth_user_id <> v_row.auth_user_id)
  ) then
    p_outcome := 'identity_mismatch';
  end if;

  if p_outcome = 'accepted' then
    update public.staff_invitation_attempts
    set state = 'provider_accepted', provider_outcome = 'accepted',
        provider_completed_at = v_now, updated_at = v_now
    where operation_token = p_operation_token;
    update public.staff_invitations
    set auth_user_id = coalesce(auth_user_id, p_provider_auth_user_id),
        status = 'profile_pending', send_state = 'provider_accepted',
        profile_state = 'pending', operation_state = 'provider_accepted',
        last_sent_at = v_now, processing_started_at = null,
        lease_expires_at = null, failure_code = null, failure_message = null,
        updated_at = v_now
    where id = v_row.id
    returning * into v_row;
    v_event := 'provider_accepted';
    v_classification := case
      when v_attempt.action = 'resend' then 'invitation_resent'
      else 'provider_accepted'
    end;
  elsif p_outcome = 'unknown' then
    update public.staff_invitation_attempts
    set state = 'provider_unknown', provider_outcome = 'unknown',
        failure_code = 'provider_outcome_unknown', updated_at = v_now
    where operation_token = p_operation_token;
    update public.staff_invitations
    set status = 'reconciliation_required', send_state = 'unknown',
        operation_state = 'provider_unknown', processing_started_at = null,
        lease_expires_at = null, failure_code = 'provider_outcome_unknown',
        failure_message = 'The provider outcome is unresolved; do not dispatch another invitation.',
        updated_at = v_now
    where id = v_row.id
    returning * into v_row;
    v_event := 'reconciliation_required';
    v_classification := 'provider_outcome_unknown';
  elsif p_outcome = 'identity_mismatch' then
    v_classification := case
      when v_attempt.expected_auth_user_id is not null then 'resend_identity_mismatch'
      else 'provider_identity_mismatch'
    end;
    update public.staff_invitation_attempts
    set state = 'identity_mismatch', provider_outcome = 'identity_mismatch',
        provider_completed_at = v_now, completed_at = v_now,
        failure_code = v_classification, updated_at = v_now
    where operation_token = p_operation_token;
    update public.staff_invitations
    set status = 'reconciliation_required',
        send_state = case
          when v_attempt.expected_auth_user_id is not null then send_state
          else 'unknown'
        end,
        operation_state = 'identity_mismatch', operation_completed_at = v_now,
        processing_started_at = null, lease_expires_at = null,
        failure_code = v_classification,
        failure_message = 'The provider returned an unexpected identity; stored identity evidence was preserved.',
        updated_at = v_now
    where id = v_row.id
    returning * into v_row;
    v_event := 'reconciliation_required';
  else
    v_classification := coalesce(p_failure_code, 'provider_rejected_verified');
    update public.staff_invitation_attempts
    set state = 'provider_rejected', provider_outcome = 'rejected',
        provider_completed_at = v_now, completed_at = v_now,
        failure_code = v_classification, updated_at = v_now
    where operation_token = p_operation_token;
    update public.staff_invitations
    set status = 'failed', send_state = 'failed',
        operation_state = 'provider_rejected', operation_completed_at = v_now,
        processing_started_at = null, lease_expires_at = null,
        failure_code = v_classification,
        failure_message = 'The provider definitively rejected the authorized dispatch.',
        updated_at = v_now
    where id = v_row.id
    returning * into v_row;
    v_event := 'provider_outcome_recorded';
  end if;

  v_audit_ok := doorflow_invitation_private.append_audit(
    v_row.id, v_row.venue_id, v_attempt.actor_user_id, v_attempt.actor_user_id,
    p_operation_token, null, v_event, v_classification,
    v_attempt.originating_request_id, p_request_id, '{}'::jsonb
  );

  if not v_audit_ok then
    update public.staff_invitations
    set pending_audit_event_type = v_event,
        pending_audit_classification = v_classification,
        pending_audit_originating_actor_user_id = v_attempt.actor_user_id,
        pending_audit_originating_request_id = v_attempt.originating_request_id,
        pending_audit_operation_token = p_operation_token,
        pending_audit_details = '{}'::jsonb,
        failure_code = case when p_outcome = 'accepted' then 'provider_audit_pending' else failure_code end,
        failure_message = case when p_outcome = 'accepted' then 'Provider acceptance is preserved; required audit evidence needs repair.' else failure_message end,
        updated_at = v_now
    where id = v_row.id
    returning * into v_row;
    return pg_catalog.jsonb_build_object('decision_code', 'audit_repair_required', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  return pg_catalog.jsonb_build_object('decision_code', v_classification, 'record', pg_catalog.to_jsonb(v_row));
end
$$;

-- Recover a dispatch boundary whose worker can no longer persist its provider
-- result. This operation never dispatches, adopts an observed Auth identity,
-- creates a profile, or makes retry/resend eligible. It only converts the
-- durable boundary to explicit provider uncertainty, retains a bounded exact
-- lookup observation on the original attempt, and records who performed the
-- recovery while preserving the original actor/request/operation attribution.
-- A late result may still be recorded by the exact original operation token.
create function public.doorflow_recover_staff_invitation_dispatch(
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_operation_token uuid,
  p_recovery_operation_token uuid,
  p_request_id uuid,
  p_expected_updated_at timestamptz,
  p_lookup_complete boolean,
  p_observed_auth_user_id uuid,
  p_observed_normalized_email text,
  p_observed_email_confirmed_at timestamptz,
  p_observed_invited_at timestamptz
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_actor public.staff_profiles%rowtype;
  v_row public.staff_invitations%rowtype;
  v_attempt public.staff_invitation_attempts%rowtype;
  v_peek_auth_user_id uuid;
  v_lock_profile_id uuid;
  v_identity_matched boolean := false;
  v_retry_after integer := 0;
  v_audit_ok boolean;
begin
  if p_invitation_id is null
     or p_actor_user_id is null
     or p_operation_token is null
     or p_recovery_operation_token is null
     or p_recovery_operation_token = p_operation_token
     or p_request_id is null
     or p_expected_updated_at is null
     or p_lookup_complete is null
     or (
       p_lookup_complete is false
       and (
         p_observed_auth_user_id is not null
         or p_observed_normalized_email is not null
         or p_observed_email_confirmed_at is not null
         or p_observed_invited_at is not null
       )
     )
     or (
       p_lookup_complete is true
       and p_observed_auth_user_id is null
       and (
         p_observed_normalized_email is not null
         or p_observed_email_confirmed_at is not null
         or p_observed_invited_at is not null
       )
     )
     or (
       p_observed_auth_user_id is not null
       and (
         p_observed_normalized_email is null
         or p_observed_normalized_email <> pg_catalog.lower(pg_catalog.btrim(p_observed_normalized_email))
         or pg_catalog.char_length(p_observed_normalized_email) not between 3 and 320
       )
     ) then
    return pg_catalog.jsonb_build_object('decision_code', 'invalid_recovery', 'record', null);
  end if;

  -- Follow the shared lock order: existing actor/target profile UUIDs,
  -- invitation, then attempt. The initial invitation read is only an identity
  -- peek and is verified again after the profile locks are held.
  select invitation.auth_user_id into v_peek_auth_user_id
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'record', null);
  end if;

  for v_lock_profile_id in
    select profile.id
    from public.staff_profiles as profile
    where profile.id = p_actor_user_id
       or profile.id = v_peek_auth_user_id
       or profile.id = p_observed_auth_user_id
    order by profile.id
  loop
    perform 1
    from public.staff_profiles as profile
    where profile.id = v_lock_profile_id
    for share;
  end loop;

  select profile.* into v_actor
  from public.staff_profiles as profile
  where profile.id = p_actor_user_id
  for share;
  if not found
     or v_actor.active is not true
     or v_actor.role <> 'admin'
     or v_actor.venue_id is null then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null);
  end if;

  select invitation.* into v_row
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'record', null);
  end if;
  if v_actor.venue_id <> v_row.venue_id then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null);
  end if;
  if v_row.auth_user_id is distinct from v_peek_auth_user_id then
    return pg_catalog.jsonb_build_object('decision_code', 'version_conflict', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  select attempt.* into v_attempt
  from public.staff_invitation_attempts as attempt
  where attempt.operation_token = p_operation_token
  for update;
  if not found
     or v_attempt.invitation_id <> v_row.id
     or v_attempt.venue_id <> v_row.venue_id
     or v_attempt.normalized_email <> v_row.normalized_email
     or v_attempt.requested_role <> v_row.requested_role
     or v_attempt.operation_fence <> v_row.operation_fence
     or v_attempt.expected_auth_user_id is distinct from v_row.auth_user_id
     or v_attempt.state not in ('dispatch_authorized', 'provider_unknown')
     or v_attempt.completed_at is not null
     or v_attempt.dispatch_started_at is null
     or v_row.operation_token is distinct from p_operation_token
     or v_row.operation_action is distinct from v_attempt.action
     or v_row.operation_state not in ('dispatch_authorized', 'provider_unknown') then
    return pg_catalog.jsonb_build_object('decision_code', 'operation_lost', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  -- Provider uncertainty is already durable and remains immediately
  -- idempotent. Recovery never starts a replacement coordination lease.
  if v_attempt.state = 'provider_unknown' then
    return pg_catalog.jsonb_build_object(
      'decision_code', 'provider_outcome_unknown',
      'retry_after_seconds', 0,
      'record', pg_catalog.to_jsonb(v_row)
    );
  end if;

  -- Refresh database time only after all authoritative locks. A live worker
  -- still owns this dispatch coordination window, so recovery must not change
  -- state, audit, or observations until that lease has actually expired.
  v_now := pg_catalog.clock_timestamp();
  if v_attempt.lease_expires_at > v_now then
    v_retry_after := least(
      600::numeric,
      greatest(
        1::numeric,
        pg_catalog.ceil(
          extract(epoch from (v_attempt.lease_expires_at - v_now))
        )
      )
    )::integer;
    return pg_catalog.jsonb_build_object(
      'decision_code', 'attempt_in_progress',
      'retry_after_seconds', v_retry_after,
      'record', pg_catalog.to_jsonb(v_row)
    );
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    return pg_catalog.jsonb_build_object('decision_code', 'version_conflict', 'record', pg_catalog.to_jsonb(v_row));
  end if;
  if v_row.pending_audit_event_type is not null then
    return pg_catalog.jsonb_build_object('decision_code', 'audit_repair_required', 'record', pg_catalog.to_jsonb(v_row));
  end if;
  if exists (
    select 1
    from public.staff_invitation_attempts as attempt
    where attempt.operation_token = p_recovery_operation_token
       or (
         attempt.recovery_operation_token = p_recovery_operation_token
         and attempt.operation_token <> p_operation_token
       )
  ) then
    return pg_catalog.jsonb_build_object('decision_code', 'operation_token_conflict', 'record', null);
  end if;

  v_identity_matched := p_lookup_complete
    and p_observed_auth_user_id is not null
    and p_observed_normalized_email = v_attempt.normalized_email
    and (
      v_attempt.expected_auth_user_id is null
      or p_observed_auth_user_id = v_attempt.expected_auth_user_id
    );

  update public.staff_invitation_attempts
  set state = 'provider_unknown',
      provider_outcome = 'unknown',
      failure_code = 'provider_outcome_unknown',
      recovery_checked_at = v_now,
      recovery_lookup_complete = p_lookup_complete,
      recovery_actor_user_id = p_actor_user_id,
      recovery_operation_token = p_recovery_operation_token,
      recovery_request_id = p_request_id,
      observed_auth_user_id = p_observed_auth_user_id,
      observed_normalized_email = p_observed_normalized_email,
      observed_email_confirmed_at = p_observed_email_confirmed_at,
      observed_invited_at = p_observed_invited_at,
      updated_at = v_now
  where operation_token = p_operation_token;

  update public.staff_invitations
  set status = 'reconciliation_required',
      operation_state = 'provider_unknown',
      processing_started_at = null,
      lease_expires_at = null,
      last_actor_user_id = p_actor_user_id,
      failure_code = 'provider_outcome_unknown',
      failure_message = 'The authorized provider dispatch has no durable result; do not dispatch another invitation.',
      updated_at = v_now
  where id = v_row.id
  returning * into v_row;

  v_audit_ok := doorflow_invitation_private.append_audit(
    v_row.id, v_row.venue_id, p_actor_user_id, v_attempt.actor_user_id,
    p_operation_token, p_recovery_operation_token,
    'reconciliation_checked', 'provider_outcome_unknown',
    v_attempt.originating_request_id, p_request_id,
    pg_catalog.jsonb_build_object(
      'identity_matched', v_identity_matched,
      'lookup_complete', p_lookup_complete
    )
  );
  if not v_audit_ok then
    -- Required recovery evidence is transactional. Raising rolls back both
    -- state updates, leaving the unresolved dispatch safely fenced for retry.
    raise exception 'required dispatch-recovery audit could not be recorded';
  end if;

  return pg_catalog.jsonb_build_object(
    'decision_code', 'provider_outcome_unknown',
    'record', pg_catalog.to_jsonb(v_row)
  );
end
$$;

-- Profile creation/finalization is database-only and atomic with current Admin
-- authorization and required evidence. It never upserts, updates, reactivates,
-- changes role/venue, or deletes an existing profile.
create function public.doorflow_finalize_staff_invitation_profile(
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_operation_token uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_actor public.staff_profiles%rowtype;
  v_row public.staff_invitations%rowtype;
  v_attempt public.staff_invitation_attempts%rowtype;
  v_profile public.staff_profiles%rowtype;
  v_peek_auth_user_id uuid;
  v_lock_profile_id uuid;
  v_profile_state text;
  v_profile_event text;
  v_conflict text;
  v_audit_ok boolean;
  v_inserted integer;
begin
  if p_invitation_id is null
     or p_actor_user_id is null
     or p_operation_token is null
     or p_request_id is null then
    return pg_catalog.jsonb_build_object('decision_code', 'invalid_request', 'record', null, 'profile', null);
  end if;

  select invitation.auth_user_id into v_peek_auth_user_id
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'record', null);
  end if;

  for v_lock_profile_id in
    select profile.id
    from public.staff_profiles as profile
    where profile.id = p_actor_user_id
       or profile.id = v_peek_auth_user_id
    order by profile.id
  loop
    perform 1
    from public.staff_profiles as profile
    where profile.id = v_lock_profile_id
    for share;
  end loop;

  select profile.* into v_actor
  from public.staff_profiles as profile
  where profile.id = p_actor_user_id
  for share;
  if not found
     or v_actor.active is not true
     or v_actor.role <> 'admin'
     or v_actor.venue_id is null then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null, 'profile', null);
  end if;

  select invitation.* into v_row
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'record', null);
  end if;

  if v_actor.venue_id <> v_row.venue_id then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null);
  end if;

  if v_row.auth_user_id is distinct from v_peek_auth_user_id then
    return pg_catalog.jsonb_build_object('decision_code', 'operation_lost', 'record', pg_catalog.to_jsonb(v_row), 'profile', null);
  end if;

  v_now := pg_catalog.clock_timestamp();

  select attempt.* into v_attempt
  from public.staff_invitation_attempts as attempt
  where attempt.operation_token = p_operation_token
  for update;
  if not found
     or v_attempt.invitation_id <> v_row.id
     or v_attempt.venue_id <> v_row.venue_id
     or v_attempt.normalized_email <> v_row.normalized_email
     or v_attempt.requested_role <> v_row.requested_role
     or v_attempt.operation_fence <> v_row.operation_fence
     or v_attempt.actor_user_id <> p_actor_user_id
     or v_row.operation_token is distinct from p_operation_token
     or v_row.operation_action is distinct from v_attempt.action
     or v_attempt.state not in ('claimed', 'provider_accepted')
     or v_row.operation_state not in ('claimed', 'provider_accepted')
     or v_row.auth_user_id is null
     or (v_row.accepted_at is null and v_row.send_state <> 'provider_accepted')
     or (v_row.accepted_at is not null and v_row.last_sent_at is null)
     or (
       v_attempt.state = 'claimed'
       and (v_attempt.requires_provider_dispatch or v_row.status <> 'processing')
     )
     or (
       v_attempt.state = 'provider_accepted'
       and v_row.status <> 'profile_pending'
     )
     or (v_attempt.expected_auth_user_id is not null and v_attempt.expected_auth_user_id <> v_row.auth_user_id) then
    return pg_catalog.jsonb_build_object('decision_code', 'operation_lost', 'record', pg_catalog.to_jsonb(v_row));
  end if;
  if v_attempt.state = 'claimed' and v_attempt.lease_expires_at <= v_now then
    return pg_catalog.jsonb_build_object('decision_code', 'coordination_lease_expired', 'record', pg_catalog.to_jsonb(v_row));
  end if;
  if v_row.pending_audit_event_type is not null then
    return pg_catalog.jsonb_build_object('decision_code', 'audit_repair_required', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  update public.staff_invitation_attempts
  set state = 'profile_finalizing', updated_at = v_now
  where operation_token = p_operation_token;
  update public.staff_invitations
  set operation_state = 'profile_finalizing', processing_started_at = v_now,
      lease_expires_at = greatest(lease_expires_at, v_now + interval '60 seconds'),
      updated_at = v_now
  where id = v_row.id
  returning * into v_row;

  select profile.* into v_profile
  from public.staff_profiles as profile
  where profile.id = v_row.auth_user_id
  for share;

  if not found then
    begin
      insert into public.staff_profiles (id, full_name, role, active, venue_id)
      values (v_row.auth_user_id, v_row.full_name, v_row.requested_role, true, v_row.venue_id)
      on conflict (id) do nothing;
      get diagnostics v_inserted = row_count;
    exception when others then
      update public.staff_invitation_attempts
      set state = 'completed', completed_at = v_now,
          failure_code = 'profile_write_failed', updated_at = v_now
      where operation_token = p_operation_token;
      update public.staff_invitations
      set status = 'profile_pending', profile_state = 'failed',
          operation_state = 'completed', operation_completed_at = v_now,
          processing_started_at = null, lease_expires_at = null,
          failure_code = 'profile_write_failed',
          failure_message = 'The profile write failed; provider and acceptance evidence were preserved.',
          updated_at = v_now
      where id = v_row.id returning * into v_row;
      v_audit_ok := doorflow_invitation_private.append_audit(
        v_row.id, v_row.venue_id, p_actor_user_id, v_attempt.actor_user_id,
        p_operation_token, null, 'profile_failed', 'profile_write_failed',
        v_attempt.originating_request_id, p_request_id, '{}'::jsonb
      );
      if not v_audit_ok then
        update public.staff_invitations
        set pending_audit_event_type = 'profile_failed',
            pending_audit_classification = 'profile_write_failed',
            pending_audit_originating_actor_user_id = v_attempt.actor_user_id,
            pending_audit_originating_request_id = v_attempt.originating_request_id,
            pending_audit_operation_token = p_operation_token,
            pending_audit_details = '{}'::jsonb,
            updated_at = v_now
        where id = v_row.id returning * into v_row;
      end if;
      return pg_catalog.jsonb_build_object(
        'decision_code', case when v_audit_ok then 'profile_write_failed' else 'audit_repair_required' end,
        'record', pg_catalog.to_jsonb(v_row),
        'profile', null
      );
    end;
    select profile.* into v_profile
    from public.staff_profiles as profile
    where profile.id = v_row.auth_user_id
    for share;
    if not found then
      raise exception 'profile insert reported no row and no exact profile exists';
    end if;
    v_profile_state := case when v_inserted = 1 then 'created' else 'existing' end;
  else
    v_profile_state := 'existing';
  end if;
  v_profile_event := case when v_profile_state = 'created' then 'profile_created' else 'profile_verified' end;

  if v_profile.venue_id is distinct from v_row.venue_id then
    v_conflict := 'existing_account_other_venue';
  elsif v_profile.active is not true then
    v_conflict := 'existing_account_inactive';
  elsif v_profile.role <> v_row.requested_role then
    v_conflict := 'existing_account_role_conflict';
  end if;

  if v_conflict is not null then
    update public.staff_invitation_attempts
    set state = 'completed', completed_at = v_now, failure_code = v_conflict,
        updated_at = v_now
    where operation_token = p_operation_token;
    update public.staff_invitations
    set status = 'failed', profile_state = 'failed', operation_state = 'completed',
        operation_completed_at = v_now, processing_started_at = null,
        lease_expires_at = null, failure_code = v_conflict,
        failure_message = 'The existing staff profile was preserved and requires operator review.',
        updated_at = v_now
    where id = v_row.id
    returning * into v_row;
    v_audit_ok := doorflow_invitation_private.append_audit(
      v_row.id, v_row.venue_id, p_actor_user_id, v_attempt.actor_user_id,
      p_operation_token, null, 'profile_conflict', v_conflict,
      v_attempt.originating_request_id, p_request_id, '{}'::jsonb
    );
    if not v_audit_ok then
      update public.staff_invitations
      set pending_audit_event_type = 'profile_conflict',
          pending_audit_classification = v_conflict,
          pending_audit_originating_actor_user_id = v_attempt.actor_user_id,
          pending_audit_originating_request_id = v_attempt.originating_request_id,
          pending_audit_operation_token = p_operation_token,
          pending_audit_details = '{}'::jsonb,
          updated_at = v_now
      where id = v_row.id returning * into v_row;
      return pg_catalog.jsonb_build_object(
        'decision_code', 'audit_repair_required',
        'conflict_code', v_conflict,
        'record', pg_catalog.to_jsonb(v_row),
        'profile', null
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'decision_code', 'conflict',
      'conflict_code', v_conflict,
      'record', pg_catalog.to_jsonb(v_row),
      'profile', null
    );
  end if;

  v_audit_ok := doorflow_invitation_private.append_audit(
    v_row.id, v_row.venue_id, p_actor_user_id, v_attempt.actor_user_id,
    p_operation_token, null, v_profile_event, v_profile_state,
    v_attempt.originating_request_id, p_request_id, '{}'::jsonb
  );
  if not v_audit_ok then
    update public.staff_invitation_attempts
    set state = 'completed', completed_at = v_now,
        failure_code = 'profile_audit_pending', updated_at = v_now
    where operation_token = p_operation_token;
    update public.staff_invitations
    set status = case when accepted_at is null then 'profile_pending' else 'accepted' end,
        profile_state = v_profile_state,
        operation_state = 'completed', operation_completed_at = v_now,
        processing_started_at = null, lease_expires_at = null,
        pending_audit_event_type = v_profile_event,
        pending_audit_classification = v_profile_state,
        pending_audit_originating_actor_user_id = v_attempt.actor_user_id,
        pending_audit_originating_request_id = v_attempt.originating_request_id,
        pending_audit_operation_token = p_operation_token,
        pending_audit_details = '{}'::jsonb,
        failure_code = 'profile_audit_pending',
        failure_message = 'The profile is preserved; required profile audit evidence needs repair.',
        updated_at = v_now
    where id = v_row.id returning * into v_row;
    return pg_catalog.jsonb_build_object(
      'decision_code', 'profile_audit_pending',
      'record', pg_catalog.to_jsonb(v_row),
      'profile', pg_catalog.to_jsonb(v_profile)
    );
  end if;

  v_audit_ok := doorflow_invitation_private.append_audit(
    v_row.id, v_row.venue_id, p_actor_user_id, v_attempt.actor_user_id,
    p_operation_token, null, 'provisioning_completed', 'profile_ready',
    v_attempt.originating_request_id, p_request_id, '{}'::jsonb
  );

  update public.staff_invitation_attempts
  set state = 'completed', completed_at = v_now, updated_at = v_now
  where operation_token = p_operation_token;
  update public.staff_invitations
  set status = case when accepted_at is null then 'sent' else 'accepted' end,
      profile_state = v_profile_state, operation_state = 'completed',
      operation_completed_at = v_now, processing_started_at = null,
      lease_expires_at = null,
      pending_audit_event_type = case when v_audit_ok then null else 'provisioning_completed' end,
      pending_audit_classification = case when v_audit_ok then null else 'profile_ready' end,
      pending_audit_originating_actor_user_id = case when v_audit_ok then null else v_attempt.actor_user_id end,
      pending_audit_originating_request_id = case when v_audit_ok then null else v_attempt.originating_request_id end,
      pending_audit_operation_token = case when v_audit_ok then null else p_operation_token end,
      pending_audit_details = case when v_audit_ok then null else '{}'::jsonb end,
      failure_code = case when v_audit_ok then null else 'provisioning_audit_pending' end,
      failure_message = case when v_audit_ok then null else 'Provisioning is preserved; completion audit evidence needs repair.' end,
      updated_at = v_now
  where id = v_row.id
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'decision_code', case when v_audit_ok then v_profile_state else 'audit_repair_required' end,
    'record', pg_catalog.to_jsonb(v_row),
    'profile', pg_catalog.to_jsonb(v_profile)
  );
end
$$;

-- CAS reconciliation for an exact stored Auth identity. The Edge Function must
-- first verify these Auth observations with getUserById; this RPC reauthorizes,
-- locks the invitation, checks the expected updated_at, and derives the profile
-- classification from current database state. It never sends or changes a
-- profile.
create function public.doorflow_reconcile_staff_invitation(
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_operation_token uuid,
  p_request_id uuid,
  p_expected_updated_at timestamptz,
  p_observed_auth_user_id uuid,
  p_observed_normalized_email text,
  p_observed_email_confirmed_at timestamptz,
  p_observed_invited_at timestamptz
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_actor public.staff_profiles%rowtype;
  v_row public.staff_invitations%rowtype;
  v_attempt public.staff_invitation_attempts%rowtype;
  v_profile public.staff_profiles%rowtype;
  v_peek_auth_user_id uuid;
  v_peek_target_user_id uuid;
  v_lock_profile_id uuid;
  v_event text;
  v_classification text;
  v_audit_ok boolean;
  v_fence bigint;
  v_originating_actor uuid;
  v_originating_request uuid;
begin
  if p_invitation_id is null
     or p_actor_user_id is null
     or p_operation_token is null
     or p_request_id is null
     or p_expected_updated_at is null then
    return pg_catalog.jsonb_build_object('decision_code', 'invalid_request', 'record', null);
  end if;

  select invitation.auth_user_id into v_peek_auth_user_id
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'record', null);
  end if;
  v_peek_target_user_id := coalesce(v_peek_auth_user_id, p_observed_auth_user_id);

  for v_lock_profile_id in
    select profile.id
    from public.staff_profiles as profile
    where profile.id = p_actor_user_id
       or profile.id = v_peek_target_user_id
    order by profile.id
  loop
    perform 1
    from public.staff_profiles as profile
    where profile.id = v_lock_profile_id
    for share;
  end loop;

  select profile.* into v_actor
  from public.staff_profiles as profile
  where profile.id = p_actor_user_id
  for share;
  if not found
     or v_actor.active is not true
     or v_actor.role <> 'admin'
     or v_actor.venue_id is null then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null);
  end if;

  select invitation.* into v_row
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'record', null);
  end if;

  if v_actor.venue_id <> v_row.venue_id then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null);
  end if;

  if v_row.auth_user_id is distinct from v_peek_auth_user_id then
    return pg_catalog.jsonb_build_object('decision_code', 'version_conflict', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_row.updated_at is distinct from p_expected_updated_at then
    return pg_catalog.jsonb_build_object('decision_code', 'version_conflict', 'record', pg_catalog.to_jsonb(v_row));
  end if;
  if v_row.pending_audit_event_type is not null then
    return pg_catalog.jsonb_build_object('decision_code', 'audit_repair_required', 'record', pg_catalog.to_jsonb(v_row));
  end if;
  if exists (
    select 1 from public.staff_invitation_attempts as attempt
    where attempt.invitation_id = v_row.id
      and attempt.state in ('dispatch_authorized', 'provider_unknown')
      and attempt.completed_at is null
  ) then
    return pg_catalog.jsonb_build_object('decision_code', 'provider_outcome_unknown', 'record', pg_catalog.to_jsonb(v_row));
  end if;
  select attempt.* into v_attempt
  from public.staff_invitation_attempts as attempt
  where attempt.operation_token = p_operation_token
  for update;
  if found then
    if v_attempt.invitation_id <> v_row.id
       or v_attempt.venue_id <> v_row.venue_id
       or v_attempt.normalized_email <> v_row.normalized_email
       or v_attempt.requested_role <> v_row.requested_role
       or v_attempt.operation_fence <> v_row.operation_fence
       or v_attempt.actor_user_id <> p_actor_user_id
       or v_row.operation_token is distinct from p_operation_token
       or v_row.operation_action is distinct from v_attempt.action
       or v_attempt.state not in ('claimed', 'provider_accepted', 'reconciling') then
      return pg_catalog.jsonb_build_object('decision_code', 'operation_token_conflict', 'record', null);
    end if;
    v_fence := v_attempt.operation_fence;
    v_originating_actor := v_attempt.actor_user_id;
    v_originating_request := v_attempt.originating_request_id;
    update public.staff_invitation_attempts
    set state = 'reconciling', updated_at = v_now
    where operation_token = p_operation_token;
  else
    if v_row.operation_state = 'claimed' then
      return pg_catalog.jsonb_build_object(
        'decision_code', 'attempt_in_progress',
        'record', pg_catalog.to_jsonb(v_row)
      );
    end if;
    if v_row.operation_state = 'provider_accepted'
       and v_row.operation_token is not null then
      update public.staff_invitation_attempts
      set state = 'completed', completed_at = v_now,
          updated_at = v_now
      where operation_token = v_row.operation_token
        and state = 'provider_accepted';
    end if;
    v_fence := v_row.operation_fence + 1;
    v_originating_actor := p_actor_user_id;
    v_originating_request := p_request_id;
    insert into public.staff_invitation_attempts (
      operation_token, invitation_id, venue_id, operation_fence, action, state,
      actor_user_id, originating_request_id, expected_auth_user_id,
      normalized_email, requested_role, requires_provider_dispatch,
      claimed_at, lease_expires_at
    ) values (
      p_operation_token, v_row.id, v_row.venue_id, v_fence,
      'reconcile', 'reconciling', p_actor_user_id, p_request_id,
      v_row.auth_user_id, v_row.normalized_email, v_row.requested_role, false,
      v_now, v_now + interval '60 seconds'
    );
  end if;

  if v_row.auth_user_id is null then
    if p_observed_auth_user_id is null then
      v_event := 'reconciliation_required';
      v_classification := 'exact_auth_lookup_unavailable';
    elsif pg_catalog.lower(pg_catalog.btrim(coalesce(p_observed_normalized_email, ''))) <> v_row.normalized_email then
      v_event := 'reconciliation_required';
      v_classification := 'unowned_auth_identity_mismatch';
    else
      select profile.* into v_profile
      from public.staff_profiles as profile
      where profile.id = p_observed_auth_user_id
      for share;
      if found and v_profile.venue_id is distinct from v_row.venue_id then
        v_classification := 'existing_account_other_venue';
      elsif found and v_profile.active is not true then
        v_classification := 'existing_account_inactive';
      elsif found and v_profile.role <> v_row.requested_role then
        v_classification := 'existing_account_role_conflict';
      elsif found then
        v_classification := 'existing_account_active';
      elsif p_observed_email_confirmed_at is not null then
        v_classification := 'confirmed_account_unlinked';
      else
        -- Preserve the Phase 8.2A public classification regardless of whether
        -- the provider populated invited_at. Neither observation grants
        -- ownership of the unlinked Auth identity.
        v_classification := 'unowned_pending_auth_account';
      end if;
      v_event := 'reconciliation_required';
    end if;

    update public.staff_invitations
    set status = 'reconciliation_required',
        profile_state = case when v_profile.id is null then profile_state else 'failed' end,
        failure_code = v_classification,
        failure_message = 'An exact pre-existing Auth identity requires operator reconciliation and was not changed.',
        updated_at = v_now
    where id = v_row.id returning * into v_row;
  elsif p_observed_auth_user_id is null then
    v_event := 'reconciliation_required';
    v_classification := 'stored_auth_user_missing';
    update public.staff_invitations
    set status = 'reconciliation_required', failure_code = v_classification,
        failure_message = 'The stored Auth identity could not be verified and was preserved for review.',
        updated_at = v_now
    where id = v_row.id returning * into v_row;
  elsif p_observed_auth_user_id <> v_row.auth_user_id
     or pg_catalog.lower(pg_catalog.btrim(coalesce(p_observed_normalized_email, ''))) <> v_row.normalized_email then
    v_event := 'reconciliation_required';
    v_classification := 'stored_auth_identity_mismatch';
    update public.staff_invitations
    set status = 'reconciliation_required', failure_code = v_classification,
        failure_message = 'Stored Auth identity evidence did not match and was preserved for review.',
        updated_at = v_now
    where id = v_row.id returning * into v_row;
  elsif p_observed_email_confirmed_at is null then
    v_event := 'reconciliation_checked';
    v_classification := 'not_accepted';
  else
    select profile.* into v_profile
    from public.staff_profiles as profile
    where profile.id = v_row.auth_user_id
    for share;
    if not found then
      v_event := 'accepted_profile_conflict';
      v_classification := 'accepted_profile_missing';
      update public.staff_invitations
      set status = 'profile_pending', profile_state = 'failed',
          accepted_at = p_observed_email_confirmed_at,
          failure_code = v_classification,
          failure_message = 'Auth acceptance is verified; the staff profile is missing.',
          updated_at = v_now
      where id = v_row.id returning * into v_row;
    elsif v_profile.active is not true then
      v_event := 'accepted_profile_conflict';
      v_classification := 'accepted_profile_inactive';
    elsif v_profile.venue_id is distinct from v_row.venue_id then
      v_event := 'accepted_profile_conflict';
      v_classification := 'accepted_profile_other_venue';
    elsif v_profile.role <> v_row.requested_role then
      v_event := 'accepted_profile_conflict';
      v_classification := 'accepted_profile_role_conflict';
    else
      v_event := 'accepted_reconciled';
      v_classification := 'verified_auth';
    end if;

    if v_classification <> 'accepted_profile_missing' then
      update public.staff_invitations
      set status = case when v_event = 'accepted_reconciled' then 'accepted' else 'failed' end,
          profile_state = case
            when v_event = 'accepted_reconciled'
              then case when profile_state in ('created', 'existing') then profile_state else 'existing' end
            else 'failed'
          end,
          accepted_at = p_observed_email_confirmed_at,
          failure_code = case when v_event = 'accepted_reconciled' then null else v_classification end,
          failure_message = case when v_event = 'accepted_reconciled' then null else 'Auth acceptance is verified; the existing profile was preserved for review.' end,
          updated_at = v_now
      where id = v_row.id returning * into v_row;
    end if;
  end if;

  update public.staff_invitations
  set last_actor_user_id = p_actor_user_id,
      operation_fence = v_fence,
      operation_token = p_operation_token,
      operation_action = coalesce(v_attempt.action, 'reconcile'),
      operation_state = 'completed',
      operation_actor_user_id = v_originating_actor,
      operation_request_id = v_originating_request,
      operation_started_at = coalesce(v_attempt.claimed_at, v_now),
      operation_completed_at = v_now, processing_started_at = null,
      lease_expires_at = null, dispatch_authorized_at = null,
      dispatch_started_at = null, expected_auth_user_id = v_row.auth_user_id,
      updated_at = v_now
  where id = v_row.id returning * into v_row;
  update public.staff_invitation_attempts
  set state = 'completed', completed_at = v_now, updated_at = v_now
  where operation_token = p_operation_token;

  v_audit_ok := doorflow_invitation_private.append_audit(
    v_row.id, v_row.venue_id, p_actor_user_id, v_originating_actor,
    p_operation_token, null, v_event, v_classification,
    v_originating_request, p_request_id, '{}'::jsonb
  );
  if not v_audit_ok then
    update public.staff_invitations
    set pending_audit_event_type = v_event,
        pending_audit_classification = v_classification,
        pending_audit_originating_actor_user_id = v_originating_actor,
        pending_audit_originating_request_id = v_originating_request,
        pending_audit_operation_token = p_operation_token,
        pending_audit_details = '{}'::jsonb,
        failure_code = case when v_event = 'accepted_reconciled' then 'accepted_audit_pending' else failure_code end,
        failure_message = case when v_event = 'accepted_reconciled' then 'Acceptance is preserved; required audit evidence needs repair.' else failure_message end,
        updated_at = v_now
    where id = v_row.id returning * into v_row;
    return pg_catalog.jsonb_build_object('decision_code', 'audit_repair_required', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  return pg_catalog.jsonb_build_object('decision_code', v_classification, 'record', pg_catalog.to_jsonb(v_row));
end
$$;

-- Repair the exact pending evidence. It reauthorizes, preserves original
-- attribution, and verifies deterministic-ID conflicts canonically. Repairing
-- a pending profile-created/verified event also finishes its skipped canonical
-- provisioning-completed event and terminal status; it never sends or changes
-- identity/profile data. A different actor/request is recorded only as the
-- recorder of the repair.
create function public.doorflow_repair_staff_invitation_audit(
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_repair_operation_token uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_actor public.staff_profiles%rowtype;
  v_row public.staff_invitations%rowtype;
  v_audit_ok boolean;
  v_chain_provisioning_completion boolean := false;
begin
  if p_invitation_id is null
     or p_actor_user_id is null
     or p_repair_operation_token is null
     or p_request_id is null then
    return pg_catalog.jsonb_build_object('decision_code', 'invalid_request', 'record', null);
  end if;

  select profile.* into v_actor
  from public.staff_profiles as profile
  where profile.id = p_actor_user_id
  for share;
  if not found
     or v_actor.active is not true
     or v_actor.role <> 'admin'
     or v_actor.venue_id is null then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null);
  end if;

  select invitation.* into v_row
  from public.staff_invitations as invitation
  where invitation.id = p_invitation_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'not_found', 'record', null);
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_actor.venue_id <> v_row.venue_id then
    return pg_catalog.jsonb_build_object('decision_code', 'forbidden', 'record', null);
  end if;
  if v_row.pending_audit_event_type is null
     or v_row.pending_audit_classification is null
     or v_row.pending_audit_originating_actor_user_id is null
     or v_row.pending_audit_originating_request_id is null
     or v_row.pending_audit_operation_token is null
     or v_row.pending_audit_details is null then
    return pg_catalog.jsonb_build_object('decision_code', 'no_pending_audit', 'record', pg_catalog.to_jsonb(v_row));
  end if;
  if p_repair_operation_token is null
     or p_request_id is null
     or not (
       (
         v_row.pending_audit_event_type = 'provider_accepted'
         and v_row.pending_audit_classification in ('provider_accepted', 'invitation_resent')
         and v_row.send_state = 'provider_accepted'
         and v_row.auth_user_id is not null
       )
       or (
         v_row.pending_audit_event_type = 'provider_outcome_recorded'
         and v_row.pending_audit_classification in ('provider_rejected_verified', 'rate_limited_verified')
         and v_row.send_state = 'failed'
       )
       or (
         v_row.pending_audit_event_type = 'reconciliation_required'
         and v_row.status = 'reconciliation_required'
         and v_row.pending_audit_classification in (
           'provider_outcome_unknown', 'provider_identity_mismatch',
           'resend_identity_mismatch', 'stored_auth_identity_mismatch',
           'stored_auth_user_missing', 'unowned_auth_identity_mismatch',
           'exact_auth_lookup_unavailable', 'existing_account_active',
           'existing_account_inactive', 'existing_account_role_conflict',
           'existing_account_other_venue', 'confirmed_account_unlinked',
           'unowned_pending_auth_account'
         )
       )
       or (
         v_row.pending_audit_event_type = 'reconciliation_checked'
         and v_row.pending_audit_classification = 'not_accepted'
         and v_row.auth_user_id is not null
         and v_row.accepted_at is null
       )
       or (
         v_row.pending_audit_event_type in ('profile_created', 'profile_verified')
         and v_row.pending_audit_classification in ('created', 'existing')
         and v_row.profile_state = v_row.pending_audit_classification
         and v_row.auth_user_id is not null
       )
       or (
         v_row.pending_audit_event_type = 'profile_failed'
         and v_row.pending_audit_classification = 'profile_write_failed'
         and v_row.status = 'profile_pending'
         and v_row.profile_state = 'failed'
         and v_row.auth_user_id is not null
       )
       or (
         v_row.pending_audit_event_type = 'provisioning_completed'
         and v_row.pending_audit_classification = 'profile_ready'
         and v_row.profile_state in ('created', 'existing')
         and v_row.status in ('sent', 'accepted')
       )
       or (
         v_row.pending_audit_event_type = 'profile_conflict'
         and v_row.pending_audit_classification in (
           'existing_account_inactive', 'existing_account_role_conflict',
           'existing_account_other_venue'
         )
         and v_row.status = 'failed'
         and v_row.profile_state = 'failed'
       )
       or (
         v_row.pending_audit_event_type = 'accepted_reconciled'
         and v_row.pending_audit_classification = 'verified_auth'
         and v_row.status = 'accepted'
         and v_row.accepted_at is not null
       )
       or (
         v_row.pending_audit_event_type = 'accepted_profile_conflict'
         and v_row.pending_audit_classification in (
           'accepted_profile_missing', 'accepted_profile_inactive',
           'accepted_profile_role_conflict', 'accepted_profile_other_venue'
         )
         and v_row.status in ('failed', 'profile_pending')
         and v_row.profile_state = 'failed'
         and v_row.accepted_at is not null
       )
     ) then
    return pg_catalog.jsonb_build_object('decision_code', 'audit_state_invalid', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  v_audit_ok := doorflow_invitation_private.append_audit(
    v_row.id, v_row.venue_id, p_actor_user_id,
    v_row.pending_audit_originating_actor_user_id,
    v_row.pending_audit_operation_token, p_repair_operation_token,
    v_row.pending_audit_event_type, v_row.pending_audit_classification,
    v_row.pending_audit_originating_request_id, p_request_id,
    v_row.pending_audit_details
  );
  if not v_audit_ok then
    return pg_catalog.jsonb_build_object('decision_code', 'audit_id_collision', 'record', pg_catalog.to_jsonb(v_row));
  end if;

  -- Profile finalization requires two canonical events. If the first profile
  -- event originally failed, repair it and the skipped completion event as one
  -- ordered chain using the same original and repair provenance. A failure of
  -- the second append advances, rather than clears, the durable marker.
  v_chain_provisioning_completion :=
    v_row.pending_audit_event_type in ('profile_created', 'profile_verified')
    and v_row.pending_audit_classification in ('created', 'existing')
    and v_row.profile_state = v_row.pending_audit_classification;

  if v_chain_provisioning_completion then
    v_audit_ok := doorflow_invitation_private.append_audit(
      v_row.id, v_row.venue_id, p_actor_user_id,
      v_row.pending_audit_originating_actor_user_id,
      v_row.pending_audit_operation_token, p_repair_operation_token,
      'provisioning_completed', 'profile_ready',
      v_row.pending_audit_originating_request_id, p_request_id,
      '{}'::jsonb
    );

    if not v_audit_ok then
      update public.staff_invitations
      set status = case when accepted_at is null then 'sent' else 'accepted' end,
          pending_audit_event_type = 'provisioning_completed',
          pending_audit_classification = 'profile_ready',
          pending_audit_originating_actor_user_id = v_row.pending_audit_originating_actor_user_id,
          pending_audit_originating_request_id = v_row.pending_audit_originating_request_id,
          pending_audit_operation_token = v_row.pending_audit_operation_token,
          pending_audit_details = '{}'::jsonb,
          failure_code = 'provisioning_audit_pending',
          failure_message = 'Provisioning is preserved; completion audit evidence needs repair.',
          last_actor_user_id = p_actor_user_id,
          updated_at = v_now
      where id = v_row.id
        and pending_audit_event_type = v_row.pending_audit_event_type
        and pending_audit_classification = v_row.pending_audit_classification
        and pending_audit_originating_actor_user_id = v_row.pending_audit_originating_actor_user_id
        and pending_audit_originating_request_id = v_row.pending_audit_originating_request_id
        and pending_audit_operation_token = v_row.pending_audit_operation_token
        and pending_audit_details = v_row.pending_audit_details
      returning * into v_row;

      if not found then
        return pg_catalog.jsonb_build_object('decision_code', 'version_conflict', 'record', null);
      end if;
      return pg_catalog.jsonb_build_object('decision_code', 'audit_repair_required', 'record', pg_catalog.to_jsonb(v_row));
    end if;
  end if;

  update public.staff_invitations
  set status = case
        when v_chain_provisioning_completion
          then case when accepted_at is null then 'sent' else 'accepted' end
        else status
      end,
      pending_audit_event_type = null,
      pending_audit_classification = null,
      pending_audit_originating_actor_user_id = null,
      pending_audit_originating_request_id = null,
      pending_audit_operation_token = null,
      pending_audit_details = null,
      failure_code = case when failure_code in (
        'provider_audit_pending', 'profile_audit_pending',
        'provisioning_audit_pending', 'accepted_audit_pending'
      ) then null else failure_code end,
      failure_message = case when failure_code in (
        'provider_audit_pending', 'profile_audit_pending',
        'provisioning_audit_pending', 'accepted_audit_pending'
      ) then null else failure_message end,
      last_actor_user_id = p_actor_user_id,
      updated_at = v_now
  where id = v_row.id
    and pending_audit_event_type = v_row.pending_audit_event_type
    and pending_audit_classification = v_row.pending_audit_classification
    and pending_audit_originating_actor_user_id = v_row.pending_audit_originating_actor_user_id
    and pending_audit_originating_request_id = v_row.pending_audit_originating_request_id
    and pending_audit_operation_token = v_row.pending_audit_operation_token
    and pending_audit_details = v_row.pending_audit_details
  returning * into v_row;

  if not found then
    return pg_catalog.jsonb_build_object('decision_code', 'version_conflict', 'record', null);
  end if;
  return pg_catalog.jsonb_build_object('decision_code', 'audit_repaired', 'record', pg_catalog.to_jsonb(v_row));
end
$$;

-- Exact server-only Auth lookup. The private SECURITY DEFINER function is the
-- only object that reads auth.users. It authorizes the current Admin and
-- requires an exact invitation owned by that same venue before returning only
-- the four necessary identity fields. It never changes auth.*.
create function doorflow_invitation_private.lookup_auth_user_by_email(
  p_actor_user_id uuid,
  p_venue_id uuid,
  p_normalized_email text
)
returns table (
  id uuid,
  email text,
  email_confirmed_at timestamptz,
  invited_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_profiles%rowtype;
  v_invitation_id uuid;
begin
  if p_normalized_email is null
     or p_actor_user_id is null
     or p_venue_id is null
     or p_normalized_email <> pg_catalog.lower(pg_catalog.btrim(p_normalized_email)) then
    raise exception 'lookup_not_authorized' using errcode = '42501';
  end if;

  select profile.* into v_actor
  from public.staff_profiles as profile
  where profile.id = p_actor_user_id
  for share;
  if not found
     or v_actor.active is not true
     or v_actor.role <> 'admin'
     or v_actor.venue_id is distinct from p_venue_id then
    raise exception 'lookup_not_authorized' using errcode = '42501';
  end if;

  select invitation.id into v_invitation_id
  from public.staff_invitations as invitation
  where invitation.venue_id = p_venue_id
    and invitation.normalized_email = p_normalized_email
    and invitation.auth_user_id is null
  for share;
  if not found then
    raise exception 'lookup_not_authorized' using errcode = '42501';
  end if;

  return query
  select auth_user.id, auth_user.email, auth_user.email_confirmed_at,
         auth_user.invited_at
  from auth.users as auth_user
  where pg_catalog.lower(pg_catalog.btrim(auth_user.email)) = p_normalized_email
  order by auth_user.id
  limit 2;
end
$$;

create function public.doorflow_lookup_staff_invitation_auth_user(
  p_actor_user_id uuid,
  p_venue_id uuid,
  p_normalized_email text
)
returns table (
  id uuid,
  email text,
  email_confirmed_at timestamptz,
  invited_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select lookup.id, lookup.email, lookup.email_confirmed_at, lookup.invited_at
  from doorflow_invitation_private.lookup_auth_user_by_email(
    p_actor_user_id, p_venue_id, p_normalized_email
  ) as lookup
$$;

-- PostgreSQL grants function EXECUTE to PUBLIC by default. Revoke that default
-- on every new function, including private helpers, then grant only what the
-- SECURITY INVOKER RPC call graph requires.
revoke all on function doorflow_invitation_private.valid_audit_details(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function doorflow_invitation_private.event_uuid(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function doorflow_invitation_private.append_audit(uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function doorflow_invitation_private.lookup_auth_user_by_email(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function doorflow_invitation_private.valid_audit_details(jsonb) to service_role;
grant execute on function doorflow_invitation_private.event_uuid(uuid, uuid, text, text) to service_role;
grant execute on function doorflow_invitation_private.append_audit(uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, uuid, jsonb) to service_role;
grant execute on function doorflow_invitation_private.lookup_auth_user_by_email(uuid, uuid, text) to service_role;

revoke all on function public.doorflow_reserve_staff_invitation(uuid, uuid, text, text, text, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.doorflow_claim_staff_invitation(uuid, uuid, text, uuid, integer, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.doorflow_authorize_staff_invitation_dispatch(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.doorflow_record_staff_invitation_provider_outcome(uuid, uuid, uuid, text, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.doorflow_recover_staff_invitation_dispatch(uuid, uuid, uuid, uuid, uuid, timestamptz, boolean, uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.doorflow_finalize_staff_invitation_profile(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.doorflow_reconcile_staff_invitation(uuid, uuid, uuid, uuid, timestamptz, uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.doorflow_repair_staff_invitation_audit(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.doorflow_lookup_staff_invitation_auth_user(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.doorflow_reserve_staff_invitation(uuid, uuid, text, text, text, text, text, text, uuid) to service_role;
grant execute on function public.doorflow_claim_staff_invitation(uuid, uuid, text, uuid, integer, integer, uuid) to service_role;
grant execute on function public.doorflow_authorize_staff_invitation_dispatch(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.doorflow_record_staff_invitation_provider_outcome(uuid, uuid, uuid, text, uuid, text, uuid, text) to service_role;
grant execute on function public.doorflow_recover_staff_invitation_dispatch(uuid, uuid, uuid, uuid, uuid, timestamptz, boolean, uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.doorflow_finalize_staff_invitation_profile(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.doorflow_reconcile_staff_invitation(uuid, uuid, uuid, uuid, timestamptz, uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.doorflow_repair_staff_invitation_audit(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.doorflow_lookup_staff_invitation_auth_user(uuid, uuid, text) to service_role;

commit;

-- Verification and destructive-test prerequisites are in
-- docs/PHASE_8_2A_STAFF_INVITATIONS_DEPLOYMENT.md. This file has not been run.
