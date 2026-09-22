// Pure validation of the review-only SQL response contract. No SDK, I/O,
// recovery action, or authority is supplied by this module. Type-only imports
// do not execute core.ts. A null parse result says nothing about commit status.
import type {
  AuthIdentity, DecisionRpcName, InvitationAction, InvitationRecord, InvitationReservationInput,
  ProviderOutcome, StaffProfile
} from "./core.ts";

export interface RpcExpectation {
  actorUserId: string;
  requestId: string;
  invitationId?: string;
  operationToken?: string | null;
  action?: InvitationAction;
  previous?: InvitationRecord;
  reservation?: InvitationReservationInput;
  provider?: { outcome: ProviderOutcome; authUserId: string | null; normalizedEmail: string | null };
  authUser?: { id: string; email: string };
  observation?: { authUserId: string | null; normalizedEmail: string | null; emailConfirmedAt: string | null };
}
export interface ValidatedRpcReply {
  decision_code: string;
  record: InvitationRecord | null;
  profile?: StaffProfile | null;
  retry_after_seconds?: number;
  requires_provider_dispatch?: boolean;
  conflict_code?: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown) => value === null || text(value);
// SQL UUID identity columns cannot encode "missing" as an empty string. Core
// branches on identity truthiness, so that representation must not pass as ID.
const nullableAuthIdentity = (value: unknown) => value === null || (text(value) && value.trim().length > 0);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const member = (values: readonly string[]) => (value: unknown) => text(value) && values.includes(value);
const roles = member(["admin", "manager", "door", "viewer"]);
const emptyObject = (value: unknown) => object(value) && Object.keys(value).length === 0;

// The reviewed helper RETURNS TABLE (four columns), without single/maybeSingle.
// Absence requires an empty, complete successful table response, not falsey JSON.
export function parseAuthLookupReply(
  reply: unknown, transport: { status: number; contentRange: string | null }, normalizedEmail: string
): { user: AuthIdentity | null; complete: true } | null {
  if (!object(reply) || reply.error !== null || reply.status !== 200 || transport.status !== 200
      || !Array.isArray(reply.data) || reply.data.length > 1
      || reply.count !== reply.data.length
      || transport.contentRange !== (reply.data.length === 0 ? "*/0" : "0-0/1")) return null;
  if (reply.data.length === 0) return { user:null, complete:true };
  const row: unknown = reply.data[0];
  if (!object(row) || !text(row.id) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id)
      || !text(row.email) || row.email.trim().toLowerCase() !== normalizedEmail
      || !Object.hasOwn(row, "email_confirmed_at") || !Object.hasOwn(row, "invited_at")
      || !(row.email_confirmed_at === null || (text(row.email_confirmed_at) && Number.isFinite(Date.parse(row.email_confirmed_at))))
      || !(row.invited_at === null || (text(row.invited_at) && Number.isFinite(Date.parse(row.invited_at))))) return null;
  return { user:{ id:row.id, email:row.email, email_confirmed_at:row.email_confirmed_at, invited_at:row.invited_at }, complete:true };
}

// The mapped type makes omission of a shared record field a compile error.
// Nullable SQL columns must be present, rather than silently defaulted.
const invitationFields: { [K in keyof InvitationRecord]: (value: unknown) => boolean } = {
  id:text, invited_by_user_id:text, last_actor_user_id:text, venue_id:text,
  email:text, normalized_email:text, full_name:text, requested_role:roles,
  auth_user_id:nullableAuthIdentity,
  status:member(["reserved", "processing", "profile_pending", "sent", "accepted", "failed", "reconciliation_required"]),
  send_state:member(["not_attempted", "provider_accepted", "failed", "unknown"]),
  profile_state:member(["pending", "created", "existing", "failed"]),
  idempotency_key:text, request_fingerprint:text, attempt_count:count,
  last_attempt_at:nullableText, last_provider_attempt_at:nullableText, last_sent_at:nullableText,
  operation_fence:count, operation_token:nullableText,
  operation_action:value => value === null || member(["invite", "retry", "resend", "reconcile", "audit_repair"])(value),
  operation_state:member(["idle", "claimed", "dispatch_authorized", "provider_accepted", "provider_unknown", "provider_rejected", "identity_mismatch", "profile_finalizing", "reconciling", "completed", "abandoned_before_dispatch"]),
  operation_actor_user_id:nullableText, operation_request_id:nullableText,
  operation_started_at:nullableText, processing_started_at:nullableText,
  lease_expires_at:nullableText, dispatch_authorized_at:nullableText,
  dispatch_started_at:nullableText, operation_completed_at:nullableText,
  expected_auth_user_id:nullableAuthIdentity, failure_code:nullableText, failure_message:nullableText,
  pending_audit_event_type:value => value === null || member(["provider_accepted", "provider_outcome_recorded", "reconciliation_required", "reconciliation_checked", "profile_created", "profile_verified", "profile_failed", "provisioning_completed", "profile_conflict", "accepted_reconciled", "accepted_profile_conflict"])(value),
  pending_audit_classification:nullableText, pending_audit_originating_actor_user_id:nullableText,
  pending_audit_originating_request_id:nullableText, pending_audit_operation_token:nullableText,
  pending_audit_details:value => value === null || emptyObject(value),
  accepted_at:nullableText, created_at:text, updated_at:text
};

export function isInvitationRecord(value: unknown): value is InvitationRecord {
  if (!object(value) || !Object.entries(invitationFields).every(([key, check]) =>
    Object.hasOwn(value, key) && check(value[key]))) return false;
  const identity = [value.operation_token, value.operation_action, value.operation_actor_user_id,
    value.operation_request_id, value.operation_started_at];
  if (value.operation_state === "idle" ? identity.some(item => item !== null) : identity.some(item => item === null)) return false;
  if ((value.processing_started_at === null) !== (value.lease_expires_at === null)) return false;
  if ((value.dispatch_authorized_at === null) !== (value.dispatch_started_at === null)) return false;
  if (value.dispatch_started_at !== null && value.last_provider_attempt_at === null) return false;
  if (["dispatch_authorized", "provider_accepted", "provider_unknown", "provider_rejected", "identity_mismatch"].some(state => state === value.operation_state)
      && value.dispatch_started_at === null) return false;
  if (value.send_state === "provider_accepted" && (value.auth_user_id === null || value.last_sent_at === null)) return false;
  // The outcome RPC sets these together. Recovery uses provider_unknown and
  // may preserve other send states; it must not be subjected to this rule.
  if (value.operation_state === "provider_accepted" && value.send_state !== "provider_accepted") return false;
  const profileReady = value.profile_state === "created" || value.profile_state === "existing";
  if (value.status === "sent" && (value.send_state !== "provider_accepted" || value.auth_user_id === null || !profileReady)) return false;
  if (value.status === "accepted" && (value.auth_user_id === null || value.last_sent_at === null || value.accepted_at === null || !profileReady)) return false;
  const pending = [value.pending_audit_classification, value.pending_audit_originating_actor_user_id,
    value.pending_audit_originating_request_id, value.pending_audit_operation_token, value.pending_audit_details];
  if (value.pending_audit_event_type === null ? pending.some(item => item !== null) : pending.some(item => item === null)) return false;
  return true;
}

function isProfile(value: unknown): value is StaffProfile {
  return object(value) && text(value.id) && text(value.full_name) && roles(value.role)
    && typeof value.active === "boolean" && nullableText(value.venue_id);
}
type RowRule = { none: readonly string[]; optional?: readonly string[]; required: readonly string[] };
// These branch-specific rules follow SQL return statements, not test fixtures.
const rowRules: Record<DecisionRpcName, RowRule> = {
  doorflow_reserve_staff_invitation:{
    none:["invalid_request", "forbidden", "identity_unavailable"], optional:["idempotency_conflict"],
    required:["reserved", "replay", "email_reserved"]
  },
  doorflow_claim_staff_invitation:{
    none:["invalid_claim", "forbidden", "not_found", "operation_token_conflict"],
    required:["operation_replay", "audit_repair_required", "provider_outcome_unknown", "attempt_in_progress", "accepted_terminal", "invite_not_eligible", "resend_not_eligible", "reconciliation_required", "retry_not_eligible", "resend_cooldown", "retry_cooldown", "claimed"]
  },
  doorflow_authorize_staff_invitation_dispatch:{
    none:["invalid_request", "not_found", "forbidden"],
    required:["operation_lost", "coordination_lease_expired", "dispatch_not_eligible", "dispatch_authorized"]
  },
  doorflow_record_staff_invitation_provider_outcome:{
    none:["invalid_outcome", "invalid_failure_code", "not_found"],
    required:["operation_lost", "audit_repair_required", "provider_accepted", "invitation_resent", "provider_outcome_unknown", "provider_identity_mismatch", "resend_identity_mismatch", "provider_rejected_verified", "rate_limited_verified"]
  },
  doorflow_recover_staff_invitation_dispatch:{
    none:["invalid_recovery", "not_found", "forbidden", "operation_token_conflict"],
    required:["version_conflict", "operation_lost", "provider_outcome_unknown", "attempt_in_progress", "audit_repair_required"]
  },
  doorflow_finalize_staff_invitation_profile:{
    none:["invalid_request", "not_found", "forbidden"],
    required:["operation_lost", "coordination_lease_expired", "audit_repair_required", "profile_write_failed", "conflict", "profile_audit_pending", "created", "existing"]
  },
  doorflow_reconcile_staff_invitation:{
    none:["invalid_request", "not_found", "forbidden", "operation_token_conflict"],
    required:["version_conflict", "audit_repair_required", "provider_outcome_unknown", "attempt_in_progress", "exact_auth_lookup_unavailable", "unowned_auth_identity_mismatch", "existing_account_other_venue", "existing_account_inactive", "existing_account_role_conflict", "existing_account_active", "confirmed_account_unlinked", "unowned_pending_auth_account", "stored_auth_user_missing", "stored_auth_identity_mismatch", "not_accepted", "accepted_profile_missing", "accepted_profile_inactive", "accepted_profile_other_venue", "accepted_profile_role_conflict", "verified_auth"]
  },
  doorflow_repair_staff_invitation_audit:{
    none:["invalid_request", "forbidden", "not_found", "version_conflict"],
    required:["no_pending_audit", "audit_state_invalid", "audit_id_collision", "audit_repair_required", "audit_repaired"]
  }
};
const immutableFields = ["id", "venue_id", "invited_by_user_id", "email", "normalized_email", "full_name", "requested_role", "idempotency_key", "request_fingerprint"] as const;
const conflictCodes = ["existing_account_other_venue", "existing_account_inactive", "existing_account_role_conflict"];
// SQL serializes timestamptz with an offset; Auth commonly uses Z. Compare the
// supplied observation, not one invented spelling or a new date-format policy.
function sameObservedTime(left: string, right: string): boolean {
  return left === right || (!Number.isNaN(Date.parse(left)) && Date.parse(left) === Date.parse(right));
}
function confirmedObservationMatches(row: InvitationRecord, expected: RpcExpectation): boolean {
  const observed = expected.observation;
  return observed !== undefined && observed.authUserId !== null && observed.authUserId === row.auth_user_id
    && observed.normalizedEmail === row.normalized_email && observed.emailConfirmedAt !== null
    && row.accepted_at !== null && sameObservedTime(row.accepted_at, observed.emailConfirmedAt);
}

function claimedStateMatches(row: InvitationRecord, action: InvitationAction | undefined, requiresDispatch: boolean | undefined): boolean {
  // Claim SQL resets only coordination fields; its eligibility decision uses
  // current locked state, never the earlier request-local display snapshot.
  if (row.status !== "processing" || row.processing_started_at === null
      || row.operation_fence < 1 || row.attempt_count < 1
      || row.expected_auth_user_id !== row.auth_user_id || row.pending_audit_event_type !== null
      || row.dispatch_authorized_at !== null || row.dispatch_started_at !== null
      || row.operation_completed_at !== null) return false;
  // Accepted-profile recovery is evaluated BEFORE ordinary retry eligibility
  // in SQL. In particular, it may legitimately retain send_state unknown.
  if (row.accepted_at !== null) return action === "retry" && requiresDispatch === false
    && row.auth_user_id !== null && row.last_sent_at !== null && row.profile_state === "failed"
    && ["accepted_profile_missing", "profile_write_failed"].some(code => code === row.failure_code);
  if (action === "invite") return requiresDispatch === true && row.send_state === "not_attempted";
  if (action === "resend") return requiresDispatch === true && row.send_state === "provider_accepted"
    && row.auth_user_id !== null && ["created", "existing"].includes(row.profile_state);
  if (action === "retry") return row.send_state === "provider_accepted"
    ? requiresDispatch === false && row.auth_user_id !== null
    : requiresDispatch === true && ["not_attempted", "failed"].includes(row.send_state);
  return false;
}

function relationships(name: DecisionRpcName, code: string, row: InvitationRecord, expected: RpcExpectation, requiresDispatch: boolean | undefined): boolean {
  if (expected.invitationId !== undefined && row.id.toLowerCase() !== expected.invitationId.toLowerCase()) return false;
  const prior = expected.previous;
  if (prior && immutableFields.some(key => row[key] !== prior[key])) return false;
  // An existing authoritative Auth ID must never be replaced by a reply.
  if (prior?.auth_user_id && row.auth_user_id !== prior.auth_user_id) return false;
  const sameOperation = row.operation_token === expected.operationToken;
  if (name === "doorflow_reserve_staff_invitation") {
    const input = expected.reservation;
    if (!input || row.venue_id !== input.venue_id) return false;
    if (code === "email_reserved") return row.normalized_email === input.normalized_email;
    if (row.invited_by_user_id !== input.invited_by_user_id || row.idempotency_key !== input.idempotency_key) return false;
    if (code === "idempotency_conflict") return row.request_fingerprint !== input.request_fingerprint;
    if (row.request_fingerprint !== input.request_fingerprint || row.normalized_email !== input.normalized_email
        || row.full_name !== input.full_name.trim() || row.requested_role !== input.requested_role) return false;
    return code !== "reserved" || (row.email === input.email.trim() && row.status === "reserved" && row.operation_state === "idle"
      && row.send_state === "not_attempted" && row.profile_state === "pending" && row.auth_user_id === null);
  }
  if (name === "doorflow_claim_staff_invitation" && code === "claimed") {
    if (!sameOperation || row.operation_action !== expected.action || row.operation_actor_user_id !== expected.actorUserId
        || row.operation_request_id !== expected.requestId || row.operation_state !== "claimed"
        || !claimedStateMatches(row, expected.action, requiresDispatch)) return false;
  }
  if (name === "doorflow_claim_staff_invitation" && code === "operation_replay" && sameOperation
      && row.operation_action === expected.action && row.operation_actor_user_id === expected.actorUserId
      && row.operation_request_id === expected.requestId && row.operation_state === "claimed"
      && !claimedStateMatches(row, expected.action, requiresDispatch)) return false;
  // Replay may return a NEWER owner's current row alongside the OLD attempt's
  // dispatch flag. Do not bind that flag to another owner or a progressed row;
  // core retains its operation-lost/uncertainty handling for those replies.
  if (name === "doorflow_authorize_staff_invitation_dispatch" && code === "dispatch_authorized") {
    if (!sameOperation || row.operation_state !== "dispatch_authorized" || row.status !== "processing"
        || row.operation_actor_user_id !== expected.actorUserId || row.operation_request_id !== expected.requestId
        || row.pending_audit_event_type !== null) return false;
    if (prior && (row.auth_user_id !== prior.auth_user_id || row.expected_auth_user_id !== prior.expected_auth_user_id
        || row.operation_action !== prior.operation_action || row.operation_fence !== prior.operation_fence)) return false;
  }
  if (name === "doorflow_record_staff_invitation_provider_outcome" && code !== "operation_lost") {
    if (!sameOperation || row.operation_actor_user_id !== expected.actorUserId) return false;
    const provider = expected.provider;
    if (["provider_accepted", "invitation_resent"].includes(code)) {
      if (row.operation_state !== "provider_accepted" || row.send_state !== "provider_accepted" || row.status !== "profile_pending"
          || row.profile_state !== "pending" || row.auth_user_id === null) return false;
      if (provider && (provider.outcome !== "accepted" || row.auth_user_id !== provider.authUserId || row.normalized_email !== provider.normalizedEmail)) return false;
      if ((code === "invitation_resent") !== (row.operation_action === "resend")) return false;
    }
    if (code === "provider_outcome_unknown" && (row.operation_state !== "provider_unknown" || row.send_state !== "unknown"
        || row.status !== "reconciliation_required" || (provider && provider.outcome !== "unknown"))) return false;
    if (["provider_identity_mismatch", "resend_identity_mismatch"].includes(code)) {
      if (row.operation_state !== "identity_mismatch" || row.status !== "reconciliation_required"
          || (provider && provider.outcome === "unknown")) return false;
      if ((code === "resend_identity_mismatch") !== (row.expected_auth_user_id !== null)) return false;
    }
    if (["provider_rejected_verified", "rate_limited_verified"].includes(code)) {
      // SQL also supports explicitly verified rejection, but this adapter never
      // submits that outcome. It cannot be a reply to accepted/unknown/mismatch.
      if (provider || row.operation_state !== "provider_rejected" || row.send_state !== "failed" || row.status !== "failed") return false;
    }
    if (code === "audit_repair_required") {
      if (row.pending_audit_event_type === null) return false;
      if (row.operation_state === "provider_accepted" && provider
          && (provider.outcome !== "accepted" || row.auth_user_id !== provider.authUserId || row.normalized_email !== provider.normalizedEmail)) return false;
    }
    if (prior && row.operation_state !== "provider_accepted" && row.auth_user_id !== prior.auth_user_id) return false;
  }
  if (name === "doorflow_recover_staff_invitation_dispatch" && !["version_conflict", "operation_lost"].includes(code)) {
    // Recovery records observations without acquiring the observed Auth user or
    // replacing the dispatch's original attribution with the repairing actor.
    if (prior && ["auth_user_id", "expected_auth_user_id", "operation_token", "operation_action",
      "operation_actor_user_id", "operation_request_id", "operation_fence", "operation_started_at"].some(key =>
        !object(row) || !object(prior) || row[key] !== prior[key])) return false;
    if (code === "provider_outcome_unknown"
        && (!sameOperation || row.operation_state !== "provider_unknown" || row.status !== "reconciliation_required")) return false;
  }
  if (name === "doorflow_finalize_staff_invitation_profile" && !["operation_lost", "coordination_lease_expired"].includes(code)) {
    if (!sameOperation) return false;
    if (expected.authUser && (row.auth_user_id !== expected.authUser.id || row.normalized_email !== expected.authUser.email)) return false;
    if (["created", "existing"].includes(code) && (row.operation_state !== "completed"
        || !["sent", "accepted"].includes(row.status) || row.profile_state !== code || row.pending_audit_event_type !== null)) return false;
    if (code === "profile_audit_pending" && (row.operation_state !== "completed" || row.pending_audit_event_type === null)) return false;
  }
  if (name === "doorflow_reconcile_staff_invitation" && code !== "version_conflict" && prior
      && row.accepted_at !== prior.accepted_at) {
    // Audit-pending is also a potentially committed reconciliation outcome.
    // It cannot invent confirmation, or erase a previously observed one.
    if (row.accepted_at === null || ((prior.accepted_at === null
        || !sameObservedTime(row.accepted_at, prior.accepted_at)) && !confirmedObservationMatches(row, expected))) return false;
  }
  if (name === "doorflow_reconcile_staff_invitation"
      && !["version_conflict", "audit_repair_required", "provider_outcome_unknown", "attempt_in_progress"].includes(code)) {
    if (!sameOperation || row.operation_state !== "completed") return false;
    if (prior && row.auth_user_id !== prior.auth_user_id) return false;
    if (code === "verified_auth" && row.status !== "accepted") return false;
    if (["verified_auth", "accepted_profile_missing", "accepted_profile_inactive", "accepted_profile_other_venue", "accepted_profile_role_conflict", "not_accepted"].includes(code)) {
      const observed = expected.observation;
      if (!observed || observed.authUserId === null || observed.authUserId !== row.auth_user_id
          || observed.normalizedEmail !== row.normalized_email) return false;
      if (code === "not_accepted") {
        if (observed.emailConfirmedAt !== null) return false;
      } else if (!confirmedObservationMatches(row, expected)) return false;
    }
  }
  if (name === "doorflow_repair_staff_invitation_audit" && ["audit_repaired", "no_pending_audit"].includes(code)
      && row.pending_audit_event_type !== null) return false;
  return true;
}

export function parseRpcReply(name: DecisionRpcName, data: unknown, expected: RpcExpectation): ValidatedRpcReply | null {
  // Keep the prior singleton-wrapper compatibility, but never discard extra rows.
  const value: unknown = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!object(value)) return null;
  const snake = value.decision_code;
  const camel = value.decisionCode;
  if (snake !== undefined && camel !== undefined && snake !== camel) return null;
  const code = snake === undefined ? camel : snake;
  if (!text(code)) return null;
  const rules = rowRules[name];
  if (!rules) return null;
  const needsRow = rules.required.includes(code);
  const optionalRow = rules.optional?.includes(code) === true;
  if (!needsRow && !optionalRow && !rules.none.includes(code)) return null;
  const rawRow = value.record;
  let row: InvitationRecord | null = null;
  if (rawRow !== null && rawRow !== undefined) {
    if ((!needsRow && !optionalRow) || !isInvitationRecord(rawRow)) return null;
    row = rawRow;
  } else if (needsRow) return null;

  // These are not harmless extras: core also recognizes them as row aliases.
  if (value.invitation !== undefined && value.invitation !== null) {
    const alias = value.invitation;
    if (!row || !isInvitationRecord(alias) || Object.keys(invitationFields).some(key => {
      // Both validated records have this own field; inspect via object guards,
      // not a cast that promises an unvalidated value's type.
      return !object(row) || !object(alias) || JSON.stringify(row[key]) !== JSON.stringify(alias[key]);
    })) return null;
  }
  if (value.id !== undefined && (!row || value.id !== row.id)) return null;

  const retry = value.retry_after_seconds === undefined ? value.retryAfterSeconds : value.retry_after_seconds;
  if (value.retry_after_seconds !== undefined && value.retryAfterSeconds !== undefined
      && value.retry_after_seconds !== value.retryAfterSeconds) return null;
  if (retry !== undefined && !count(retry)) return null;
  if (name === "doorflow_claim_staff_invitation" && retry === undefined) return null;
  if (name === "doorflow_recover_staff_invitation_dispatch" && code === "attempt_in_progress" && retry === undefined) return null;
  const dispatch = value.requires_provider_dispatch;
  if (dispatch !== undefined && typeof dispatch !== "boolean") return null;
  if (name === "doorflow_claim_staff_invitation" && ["claimed", "operation_replay"].includes(code) && dispatch === undefined) return null;
  const conflict = value.conflict_code === undefined ? value.conflictCode : value.conflict_code;
  if (value.conflict_code !== undefined && value.conflictCode !== undefined && value.conflict_code !== value.conflictCode) return null;
  if (conflict !== undefined && (!text(conflict) || !conflictCodes.includes(conflict))) return null;
  if (code === "conflict" && conflict === undefined) return null;

  const rawProfile = value.profile;
  let profile: StaffProfile | null | undefined;
  if (rawProfile !== undefined && rawProfile !== null) {
    if (!isProfile(rawProfile) || !row || name !== "doorflow_finalize_staff_invitation_profile"
        || !["created", "existing", "profile_audit_pending", "audit_repair_required"].includes(code)) return null;
    if (rawProfile.id !== row.auth_user_id || rawProfile.venue_id !== row.venue_id
        || rawProfile.role !== row.requested_role || !rawProfile.active) return null;
    profile = rawProfile;
  } else profile = rawProfile;
  if (name === "doorflow_finalize_staff_invitation_profile" && ["created", "existing", "profile_audit_pending"].includes(code) && !profile) return null;
  if (row && !relationships(name, code, row, expected, dispatch)) return null;
  // Project only checked fields. Unknown harmless extras are accepted, not
  // copied into alternate core representations or accidentally reflected.
  return {
    decision_code:code, record:row,
    ...(profile === undefined ? {} : { profile }),
    ...(typeof retry === "number" ? { retry_after_seconds:retry } : {}),
    ...(typeof dispatch === "boolean" ? { requires_provider_dispatch:dispatch } : {}),
    ...(typeof conflict === "string" ? { conflict_code:conflict } : {})
  };
}
