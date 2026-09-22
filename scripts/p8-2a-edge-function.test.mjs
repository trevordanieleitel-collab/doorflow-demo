import test from "node:test";
import assert from "node:assert/strict";

import {
  createRepairInvitationAuditRpcAdapter,
  createStaffInvitationsHandler,
  normalizeEmail,
  redactDetails,
  resolveSupabaseServerKeys,
  sha256Hex,
  validateDecisionRpcResult,
  validateSupabaseProjectConfiguration
} from "../supabase/functions/staff-invitations/core.ts";

const VENUE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENUE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const INVITEE_ID = "33333333-3333-4333-8333-333333333333";
const UNEXPECTED_INVITEE_ID = "66666666-6666-4666-8666-666666666666";
const IDEMPOTENCY_A = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_B = "55555555-5555-4555-8555-555555555555";
const USER_TOKEN = "header.payload.signature";
const OTHER_TOKEN = "other.payload.signature";
const ORIGIN = "https://doorflow.example";

function fictionalLegacyJwt(role, ref = "fictionalprojectref", overrides = {}) {
  const header = { alg:"HS256", typ:"JWT", ...(overrides.header || {}) };
  const payload = {
    ref,
    role,
    exp:2_000_000_000,
    ...(overrides.payload || {})
  };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode(header)}.${encode(payload)}.fictionalsignaturevalue`;
}

function makeHarness(options = {}) {
  let nowMs = Date.parse("2026-09-17T16:00:00.000Z");
  let sequence = 0;
  const invitations = new Map();
  const profiles = new Map();
  const authUsers = new Map();
  const operationAttempts = new Map();
  const audits = [];
  const auditCalls = [];
  const inviteCalls = [];
  const claimCalls = [];
  const dispatchAuthorizationCalls = [];
  const providerOutcomeCalls = [];
  const profileFinalizationCalls = [];
  const reconciliationCalls = [];
  const dispatchRecoveryCalls = [];
  const repairInvitationAuditCalls = [];
  const fallbackInvitationUpdateCalls = [];
  const fallbackAuditAppendCalls = [];
  const safeLogs = [];
  const verifiedTokens = new Map([
    [USER_TOKEN, { id:ADMIN_ID, email:"admin@example.com" }],
    [OTHER_TOKEN, { id:OTHER_ADMIN_ID, email:"other-admin@example.com" }]
  ]);

  profiles.set(ADMIN_ID, {
    id:ADMIN_ID,
    full_name:"Admin One",
    role:options.actorRole || "admin",
    active:options.actorActive !== false,
    venue_id:options.actorVenue || VENUE_A
  });
  profiles.set(OTHER_ADMIN_ID, {
    id:OTHER_ADMIN_ID,
    full_name:"Admin Two",
    role:"admin",
    active:true,
    venue_id:options.otherActorVenue || VENUE_B
  });

  const nextInvitationId = () => {
    sequence += 1;
    return `90000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  };

  function findAuthByEmail(email) {
    const normalized = normalizeEmail(email);
    return [...authUsers.values()].find(user => normalizeEmail(user.email) === normalized) || null;
  }

  function leaseError() {
    return Object.assign(new Error("invitation_lease_lost"), { code:"invitation_lease_lost", status:409 });
  }

  function currentAdmin(actorUserId, venueId) {
    const profile = profiles.get(actorUserId);
    return Boolean(
      profile
      && profile.active
      && profile.role === "admin"
      && profile.venue_id === venueId
    );
  }

  function retryAfter(timestamp, cooldownSeconds) {
    if (!timestamp) return 0;
    return Math.max(0, Math.ceil(
      (Date.parse(timestamp) + cooldownSeconds * 1000 - nowMs) / 1000
    ));
  }

  let mutationRevision = 0;
  function versionStamp() {
    mutationRevision += 1;
    return new Date(nowMs + mutationRevision).toISOString();
  }

  async function auditIdFor(row, operationToken, eventType, classification) {
    if (eventType === "accepted_reconciled" && classification === "verified_auth") return row.id;
    const digest = (await sha256Hex(
      `doorflow-staff-invitation-audit\n${row.id}\n${operationToken || "legacy"}\n${eventType}\n${classification}`
    )).slice(0, 32).split("");
    digest[12] = "5";
    digest[16] = ((Number.parseInt(digest[16], 16) & 3) | 8).toString(16);
    const hex = digest.join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function claimDecision(decisionCode, row, retryAfterSeconds = 0) {
    return {
      decisionCode,
      code:decisionCode,
      claimed:decisionCode === "claimed",
      record:row ? { ...row } : null,
      invitation:row ? { ...row } : null,
      retryAfterSeconds
    };
  }

  function appendAuditEntries(entries) {
    const staged = [];
    for (const entry of entries) {
      auditCalls.push(structuredClone(entry));
      if (options.auditFailureEvent === entry.event_type || options.auditFailure?.(entry)) {
        throw new Error("audit unavailable secret-token");
      }
      if (
        entry.id
        && (
          audits.some(item => item.id === entry.id)
          || staged.some(item => item.id === entry.id)
        )
      ) {
        throw Object.assign(new Error("duplicate audit"), { code:"23505" });
      }
      staged.push({ ...entry, created_at:new Date(nowMs).toISOString() });
    }
    audits.push(...staged);
    return staged;
  }

  function appendAuditEntry(entry) {
    return appendAuditEntries([entry])[0];
  }

  function canonicalRepairAuditMatches(existing, expected) {
    return Boolean(
      existing
      && existing.id === expected.id
      && existing.invitation_id === expected.invitation_id
      && existing.venue_id === expected.venue_id
      && existing.operation_token === expected.operation_token
      && existing.event_type === expected.event_type
      && existing.classification === expected.classification
      && existing.originating_actor_user_id === expected.originating_actor_user_id
      && existing.request_id === expected.request_id
      && JSON.stringify(existing.details || {}) === JSON.stringify(expected.details || {})
    );
  }

  async function repairAuditDecisionRpc(name, args, label) {
    repairInvitationAuditCalls.push({ name, args:structuredClone(args), label });
    if (name !== "doorflow_repair_staff_invitation_audit") {
      throw new Error("unexpected repair RPC");
    }
    const row = invitations.get(args.p_invitation_id);
    if (!row) return { decision_code:"not_found", record:null };
    if (!currentAdmin(args.p_actor_user_id, row.venue_id)) {
      return { decision_code:"forbidden", record:null };
    }

    const eventType = row.pending_audit_event_type;
    const classification = row.pending_audit_classification;
    const originatingActorUserId = row.pending_audit_originating_actor_user_id;
    const originatingRequestId = row.pending_audit_originating_request_id;
    const operationToken = row.pending_audit_operation_token;
    const details = row.pending_audit_details;
    if (
      !eventType
      || !classification
      || !originatingActorUserId
      || !originatingRequestId
      || !operationToken
      || details === null
      || details === undefined
    ) {
      return { decision_code:"no_pending_audit", record:{ ...row } };
    }

    const auditId = await auditIdFor(row, operationToken, eventType, classification);
    const entry = {
      id:auditId,
      invitation_id:row.id,
      actor_user_id:args.p_actor_user_id,
      originating_actor_user_id:originatingActorUserId,
      venue_id:row.venue_id,
      operation_token:operationToken,
      repair_operation_token:args.p_repair_operation_token,
      event_type:eventType,
      classification,
      request_id:originatingRequestId,
      recorded_request_id:args.p_request_id,
      details:structuredClone(details)
    };
    try {
      appendAuditEntry(entry);
    } catch (error) {
      const existing = audits.find(item => item.id === auditId) || null;
      if (error?.code !== "23505" || !canonicalRepairAuditMatches(existing, entry)) {
        return { decision_code:"audit_id_collision", record:{ ...row } };
      }
    }
    if (options.repairAuditCleanupFailure?.(entry, row)) {
      throw new Error("simulated repair RPC cleanup interruption");
    }

    const expectedPendingAudit = {
      pending_audit_event_type:eventType,
      pending_audit_classification:classification,
      pending_audit_originating_actor_user_id:originatingActorUserId,
      pending_audit_originating_request_id:originatingRequestId,
      pending_audit_operation_token:operationToken,
      pending_audit_details:details
    };
    for (const [key, value] of Object.entries(expectedPendingAudit)) {
      if (row[key] !== value) return { decision_code:"operation_lost", record:{ ...row } };
    }
    Object.assign(row, {
      processing_started_at:null,
      pending_audit_event_type:null,
      pending_audit_classification:null,
      pending_audit_originating_actor_user_id:null,
      pending_audit_originating_request_id:null,
      pending_audit_operation_token:null,
      pending_audit_details:null,
      failure_code:[
        "provider_audit_pending",
        "profile_audit_pending",
        "provisioning_audit_pending",
        "accepted_audit_pending"
      ].includes(row.failure_code) ? null : row.failure_code,
      failure_message:[
        "provider_audit_pending",
        "profile_audit_pending",
        "provisioning_audit_pending",
        "accepted_audit_pending"
      ].includes(row.failure_code) ? null : row.failure_message,
      last_actor_user_id:args.p_actor_user_id
    }, { updated_at:new Date(nowMs).toISOString() });
    return { decision_code:"audit_repaired", record:{ ...row } };
  }

  const deps = {
    now:() => new Date(nowMs),
    randomUUID:() => `60000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    operationUUID:() => `70000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    claimIncludesAudit:false,
    logSafeError:value => safeLogs.push(value),
    verifyUserToken:async token => {
      if (options.rejectTokens?.includes(token) || !verifiedTokens.has(token)) throw new Error("invalid token secret-value");
      return verifiedTokens.get(token);
    },
    getStaffProfile:async userId => profiles.get(userId) || null,
    createStaffProfile:async profile => {
      if (options.profileFailure?.()) throw new Error("database secret payload");
      if (profiles.has(profile.id)) throw Object.assign(new Error("duplicate"), { code:"23505" });
      profiles.set(profile.id, { ...profile, created_at:new Date(nowMs).toISOString() });
      return profiles.get(profile.id);
    },
    reserveInvitation:async record => {
      if (!currentAdmin(record.invited_by_user_id, record.venue_id)) {
        return { inserted:false, code:"forbidden", record:null };
      }
      const sameKey = [...invitations.values()].find(item => (
        item.invited_by_user_id === record.invited_by_user_id
        && item.idempotency_key === record.idempotency_key
      ));
      if (sameKey) {
        if (sameKey.venue_id !== record.venue_id) {
          return { inserted:false, code:"idempotency_conflict", record:null };
        }
        if (sameKey.request_fingerprint !== record.request_fingerprint) {
          return { inserted:false, code:"idempotency_conflict", record:{ ...sameKey } };
        }
        return { inserted:false, code:"replay", record:{ ...sameKey } };
      }
      const sameEmail = [...invitations.values()].find(item => (
        item.normalized_email === record.normalized_email
      ));
      if (sameEmail) {
        return sameEmail.venue_id === record.venue_id
          ? { inserted:false, code:"email_reserved", record:{ ...sameEmail } }
          : { inserted:false, code:"identity_unavailable", record:null };
      }
      const timestamp = new Date(nowMs).toISOString();
      const inserted = {
        id:nextInvitationId(),
        auth_user_id:null,
        attempt_count:0,
        last_attempt_at:null,
        last_sent_at:null,
        processing_started_at:null,
        failure_code:null,
        failure_message:null,
        pending_audit_event_type:null,
        pending_audit_classification:null,
        pending_audit_actor_user_id:null,
        pending_audit_request_id:null,
        pending_audit_originating_actor_user_id:null,
        pending_audit_originating_request_id:null,
        pending_audit_operation_token:null,
        pending_audit_details:null,
        operation_token:null,
        operation_state:null,
        operation_action:null,
        operation_actor_user_id:null,
        operation_request_id:null,
        operation_requires_provider_dispatch:null,
        operation_completed_at:null,
        lease_expires_at:null,
        dispatch_authorized_at:null,
        last_provider_attempt_at:null,
        accepted_at:null,
        created_at:timestamp,
        updated_at:timestamp,
        ...record
      };
      invitations.set(inserted.id, inserted);
      return { inserted:true, record:{ ...inserted } };
    },
    getInvitationById:async id => invitations.has(id) ? { ...invitations.get(id) } : null,
    listInvitations:async venueId => [...invitations.values()]
      .filter(item => item.venue_id === venueId)
      .map(item => ({ ...item })),
    claimInvitation:async (...args) => {
      if (typeof args[0] !== "object" || args[0] === null || Array.isArray(args[0])) {
        const [id, actorId, staleBefore] = args;
        const row = invitations.get(id);
        if (!row || row.status === "accepted") return null;
        if (row.processing_started_at && Date.parse(row.processing_started_at) >= Date.parse(staleBefore)) return null;
        const stamp = new Date(nowMs).toISOString();
        Object.assign(row, {
          status:"processing",
          last_actor_user_id:actorId,
          attempt_count:Number(row.attempt_count || 0) + 1,
          last_attempt_at:stamp,
          processing_started_at:stamp,
          updated_at:stamp
        });
        return { ...row };
      }

      const claim = structuredClone(args[0]);
      claimCalls.push(claim);
      const {
        invitationId,
        actorUserId,
        action,
        operationToken,
        cooldownSeconds = 300,
        leaseSeconds = 300,
        requestId
      } = claim;
      const row = invitations.get(invitationId);
      if (!row) return claimDecision("invitation_not_found", null);
      if (!currentAdmin(actorUserId, row.venue_id)) return claimDecision("forbidden", row);
      const existingAttempt = operationAttempts.get(operationToken);
      if (existingAttempt) {
        if (
          existingAttempt.invitationId === row.id
          && existingAttempt.actorUserId === actorUserId
          && existingAttempt.action === action
          && existingAttempt.requestId === requestId
        ) {
          const retryAfterSeconds = Math.max(0, Math.ceil(
            (Date.parse(existingAttempt.leaseExpiresAt) - nowMs) / 1000
          ));
          return {
            decision_code:"operation_replay",
            retry_after_seconds:retryAfterSeconds,
            requires_provider_dispatch:existingAttempt.requiresProviderDispatch,
            record:{ ...row }
          };
        }
        return {
          decision_code:"operation_token_conflict",
          retry_after_seconds:0,
          record:null
        };
      }
      const acceptedProfileRecovery = action === "retry"
        && Boolean(row.accepted_at)
        && row.status === "profile_pending"
        && row.profile_state === "failed"
        && row.failure_code === "accepted_profile_missing";
      if ((row.accepted_at || row.status === "accepted") && !acceptedProfileRecovery) {
        return claimDecision("already_accepted", row);
      }
      if (row.pending_audit_event_type || row.pending_audit_classification) {
        return claimDecision("audit_repair_required", row);
      }
      if (["dispatch_authorized", "provider_unknown", "provider_outcome_unknown"].includes(row.operation_state)) {
        return claimDecision("provider_outcome_unknown", row);
      }

      if (row.processing_started_at) {
        const leaseRemaining = Math.ceil(
          (Date.parse(row.processing_started_at) + leaseSeconds * 1000 - nowMs) / 1000
        );
        if (leaseRemaining > 0) return claimDecision("attempt_in_progress", row, leaseRemaining);
      }

      const cooldownAnchor = row.last_provider_attempt_at || row.last_sent_at;
      if (action === "resend") {
        const remaining = retryAfter(cooldownAnchor, cooldownSeconds);
        if (remaining > 0) return claimDecision("resend_cooldown", row, remaining);
      }
      if (action === "retry" && (row.failure_code === "rate_limited" || (row.send_state === "failed" && row.auth_user_id))) {
        const remaining = retryAfter(cooldownAnchor || row.last_attempt_at, cooldownSeconds);
        if (remaining > 0) return claimDecision("retry_cooldown", row, remaining);
      }

      const stamp = new Date(nowMs).toISOString();
      const requiresProviderDispatch = action === "invite"
        || action === "resend"
        || !(
          action === "retry"
          && row.send_state === "provider_accepted"
          && Boolean(row.auth_user_id)
          && (row.status === "profile_pending" || ["pending", "failed"].includes(row.profile_state))
        );
      const leaseExpiresAt = new Date(nowMs + leaseSeconds * 1000).toISOString();
      Object.assign(row, {
        status:"processing",
        last_actor_user_id:actorUserId,
        attempt_count:Number(row.attempt_count || 0) + 1,
        last_attempt_at:stamp,
        processing_started_at:stamp,
        operation_token:operationToken,
        operation_state:"claimed",
        operation_action:action,
        operation_actor_user_id:actorUserId,
        operation_request_id:requestId,
        operation_requires_provider_dispatch:requiresProviderDispatch,
        operation_completed_at:null,
        lease_expires_at:leaseExpiresAt,
        dispatch_authorized_at:null,
        updated_at:stamp
      });
      operationAttempts.set(operationToken, {
        invitationId:row.id,
        actorUserId,
        action,
        requestId,
        state:"claimed",
        expectedAuthUserId:row.auth_user_id || null,
        requiresProviderDispatch,
        leaseExpiresAt
      });
      return claimDecision("claimed", row);
    },
    authorizeInvitationDispatch:async input => {
      const call = structuredClone(input);
      dispatchAuthorizationCalls.push(call);
      const row = invitations.get(input.invitationId);
      if (!row) return { decisionCode:"operation_lost", record:null };
      if (!currentAdmin(input.actorUserId, row.venue_id)) {
        return { decisionCode:"forbidden", record:{ ...row } };
      }
      if (row.operation_token !== input.operationToken || row.operation_actor_user_id !== input.actorUserId) {
        return { decisionCode:"operation_lost", record:{ ...row } };
      }
      if (["dispatch_authorized", "provider_unknown", "provider_outcome_unknown"].includes(row.operation_state)) {
        return { decisionCode:"provider_outcome_unknown", record:{ ...row } };
      }
      if (row.operation_state !== "claimed" || row.processing_started_at !== input.expectedLease) {
        return { decisionCode:"operation_lost", record:{ ...row } };
      }
      const stamp = new Date(nowMs).toISOString();
      Object.assign(row, {
        operation_state:"dispatch_authorized",
        dispatch_authorized_at:stamp,
        dispatch_started_at:stamp,
        last_provider_attempt_at:stamp,
        updated_at:stamp
      });
      const attempt = operationAttempts.get(input.operationToken);
      if (attempt) attempt.state = "dispatch_authorized";
      return { decisionCode:"authorized", record:{ ...row } };
    },
    recordInvitationProviderOutcome:async input => {
      const call = structuredClone(input);
      providerOutcomeCalls.push(call);
      const row = invitations.get(input.invitationId);
      if (!row || row.operation_token !== input.operationToken) {
        return { decisionCode:"operation_lost", record:row ? { ...row } : null };
      }
      if (row.operation_state === "provider_accepted") {
        return { decisionCode:"accepted", record:{ ...row } };
      }
      if (!["dispatch_authorized", "provider_unknown", "provider_outcome_unknown"].includes(row.operation_state)) {
        return { decisionCode:"operation_lost", record:{ ...row } };
      }

      const outcomeKind = typeof input.outcome === "string"
        ? input.outcome
        : String(input.outcome?.kind || input.outcome?.code || "provider_outcome_unknown");
      const expectedAuthUserId = row.auth_user_id || null;
      const identityMismatch = outcomeKind === "identity_mismatch" || (
        outcomeKind === "accepted" && (
          !input.providerAuthUserId
          || normalizeEmail(input.providerNormalizedEmail) !== row.normalized_email
          || (expectedAuthUserId && input.providerAuthUserId !== expectedAuthUserId)
        )
      );
      const stamp = new Date(nowMs).toISOString();

      if (identityMismatch) {
        try {
          appendAuditEntry({
            id:input.operationToken,
            invitation_id:row.id,
            actor_user_id:input.actorUserId,
            venue_id:row.venue_id,
            event_type:"reconciliation_required",
            classification:expectedAuthUserId ? "resend_identity_mismatch" : "provider_identity_mismatch",
            request_id:input.requestId,
            details:{}
          });
        } catch {
          // The dispatch remains unresolved when its required evidence cannot
          // commit; no identity or prior send evidence is changed.
          return { decisionCode:"provider_outcome_unknown", record:{ ...row } };
        }
        Object.assign(row, {
          status:"reconciliation_required",
          operation_state:"provider_identity_mismatch",
          processing_started_at:null,
          last_actor_user_id:input.actorUserId,
          failure_code:expectedAuthUserId ? "resend_identity_mismatch" : "provider_identity_mismatch",
          failure_message:"The provider returned an unexpected identity. Reconciliation is required.",
          updated_at:stamp
        });
        const attempt = operationAttempts.get(input.operationToken);
        if (attempt) attempt.state = "identity_mismatch";
        return { decisionCode:"provider_identity_mismatch", record:{ ...row } };
      }

      if (outcomeKind !== "accepted") {
        const ambiguous = ["unknown", "ambiguous", "provider_outcome_unknown", "provider_timeout"].includes(outcomeKind);
        try {
          appendAuditEntry({
            id:input.operationToken,
            invitation_id:row.id,
            actor_user_id:input.actorUserId,
            venue_id:row.venue_id,
            event_type:ambiguous ? "reconciliation_required" : "attempt_failed",
            classification:ambiguous ? "provider_outcome_unknown" : outcomeKind,
            request_id:input.requestId,
            details:{}
          });
        } catch {
          return { decisionCode:"provider_outcome_unknown", record:{ ...row } };
        }
        Object.assign(row, {
          status:ambiguous ? "reconciliation_required" : "failed",
          send_state:ambiguous ? "unknown" : "failed",
          operation_state:ambiguous ? "provider_outcome_unknown" : "completed",
          processing_started_at:null,
          last_actor_user_id:input.actorUserId,
          failure_code:ambiguous ? "provider_outcome_unknown" : outcomeKind,
          failure_message:ambiguous
            ? "The provider outcome is unknown and requires reconciliation."
            : "The provider rejected the invitation request.",
          updated_at:stamp
        });
        const attempt = operationAttempts.get(input.operationToken);
        if (attempt) attempt.state = ambiguous ? "provider_unknown" : "provider_rejected";
        return {
          decisionCode:ambiguous ? "provider_outcome_unknown" : outcomeKind,
          record:{ ...row }
        };
      }

      try {
        appendAuditEntry({
          id:input.operationToken,
          invitation_id:row.id,
          actor_user_id:input.actorUserId,
          venue_id:row.venue_id,
          event_type:"provider_accepted",
          classification:"provider_accepted",
          request_id:input.requestId,
          details:{}
        });
      } catch {
        return { decisionCode:"provider_outcome_unknown", record:{ ...row } };
      }
      Object.assign(row, {
        auth_user_id:expectedAuthUserId || input.providerAuthUserId,
        status:"profile_pending",
        send_state:"provider_accepted",
        profile_state:"pending",
        operation_state:"provider_accepted",
        last_sent_at:stamp,
        last_actor_user_id:input.actorUserId,
        failure_code:null,
        failure_message:null,
        updated_at:stamp
      });
      const attempt = operationAttempts.get(input.operationToken);
      if (attempt) attempt.state = "provider_accepted";
      return { decisionCode:"accepted", record:{ ...row } };
    },
    finalizeInvitationProfile:async input => {
      const call = {
        ...structuredClone(input),
        authUser:input.authUser ? { ...input.authUser } : null
      };
      profileFinalizationCalls.push(call);
      const row = invitations.get(input.invitationId);
      const profileOnlyRecovery = row?.operation_state === "claimed"
        && row?.send_state === "provider_accepted"
        && Boolean(row?.auth_user_id && row?.last_sent_at);
      if (
        !row
        || row.operation_token !== input.operationToken
        || (row.operation_state !== "provider_accepted" && !profileOnlyRecovery)
      ) {
        return { decisionCode:"operation_lost", record:row ? { ...row } : null, profile:null };
      }
      if (!currentAdmin(input.actorUserId, row.venue_id)) {
        return { decisionCode:"forbidden", record:{ ...row }, profile:null };
      }
      if (!input.authUser?.id || input.authUser.id !== row.auth_user_id || normalizeEmail(input.authUser.email) !== row.normalized_email) {
        return { decisionCode:"provider_identity_mismatch", record:{ ...row }, profile:null };
      }

      const existing = profiles.get(input.authUser.id) || null;
      const conflict = existing
        ? (existing.venue_id !== row.venue_id
          ? "existing_account_other_venue"
          : (!existing.active
            ? "existing_account_inactive"
            : (existing.role !== row.requested_role ? "existing_account_role_conflict" : null)))
        : null;
      if (conflict) return { decisionCode:conflict, record:{ ...row }, profile:{ ...existing } };

      let profile = existing ? { ...existing } : null;
      let state = "existing";
      const accepted = Boolean(row.accepted_at || input.authUser.email_confirmed_at);
      const profileAuditEntries = [];
      if (!profile) {
        if (options.profileFailure?.()) {
          const stamp = versionStamp();
          Object.assign(row, {
            status:"profile_pending",
            profile_state:"failed",
            processing_started_at:null,
            operation_state:"completed",
            last_actor_user_id:input.actorUserId,
            failure_code:"profile_write_failed",
            failure_message:"The invitation provider accepted the email, but the staff profile still needs setup.",
            updated_at:stamp
          });
          const attempt = operationAttempts.get(input.operationToken);
          if (attempt) attempt.state = "completed";
          try {
            appendAuditEntry({
              id:await auditIdFor(row, input.operationToken, "profile_failed", "profile_write_failed"),
              invitation_id:row.id,
              actor_user_id:input.actorUserId,
              venue_id:row.venue_id,
              event_type:"profile_failed",
              classification:"profile_write_failed",
              request_id:input.requestId,
              details:{}
            });
          } catch {
            // The row is the authoritative recoverable profile-only failure.
          }
          return { decisionCode:"profile_write_failed", record:{ ...row }, profile:null };
        }
        const candidate = {
          id:input.authUser.id,
          full_name:row.full_name,
          role:row.requested_role,
          active:true,
          venue_id:row.venue_id,
          created_at:new Date(nowMs).toISOString()
        };
        profileAuditEntries.push({
          invitation_id:row.id,
          actor_user_id:input.actorUserId,
          venue_id:row.venue_id,
          event_type:"profile_created",
          classification:"created",
          request_id:input.requestId,
          details:{}
        });
        profile = { ...candidate };
        state = "created";
      }

      profileAuditEntries.push({
        invitation_id:row.id,
        actor_user_id:input.actorUserId,
        venue_id:row.venue_id,
        event_type:"provisioning_completed",
        classification:accepted ? "accepted" : "sent",
        request_id:input.requestId,
        details:{}
      });
      if (row.operation_action === "resend") {
        profileAuditEntries.push({
          invitation_id:row.id,
          actor_user_id:input.actorUserId,
          venue_id:row.venue_id,
          event_type:"invitation_resent",
          classification:"provider_accepted",
          request_id:input.requestId,
          details:{}
        });
      } else if (row.operation_action === "retry" && row.dispatch_authorized_at) {
        profileAuditEntries.push({
          invitation_id:row.id,
          actor_user_id:input.actorUserId,
          venue_id:row.venue_id,
          event_type:"invitation_send_retried",
          classification:"provider_accepted",
          request_id:input.requestId,
          details:{}
        });
      }
      try {
        appendAuditEntries(profileAuditEntries);
      } catch {
        return { decisionCode:"profile_audit_failed", record:{ ...row }, profile:null };
      }
      if (!existing) profiles.set(profile.id, { ...profile });

      const stamp = new Date(nowMs).toISOString();
      Object.assign(row, {
        status:accepted ? "accepted" : "sent",
        profile_state:state,
        processing_started_at:null,
        operation_state:"completed",
        operation_completed_at:stamp,
        lease_expires_at:null,
        last_actor_user_id:input.actorUserId,
        failure_code:null,
        failure_message:null,
        accepted_at:accepted ? (row.accepted_at || stamp) : row.accepted_at,
        updated_at:stamp
      });
      const attempt = operationAttempts.get(input.operationToken);
      if (attempt) attempt.state = "completed";
      return { decisionCode:state, record:{ ...row }, profile };
    },
    recoverInvitationDispatch:async input => {
      dispatchRecoveryCalls.push(structuredClone(input));
      const row = invitations.get(input.invitationId);
      const attempt = operationAttempts.get(input.operationToken);
      if (!row || !attempt) return { decisionCode:"operation_lost", record:row ? { ...row } : null };
      if (!currentAdmin(input.actorUserId, row.venue_id)) {
        return { decisionCode:"forbidden", record:null };
      }
      if (row.updated_at !== input.expectedUpdatedAt) {
        return { decisionCode:"version_conflict", record:{ ...row } };
      }
      if (
        row.operation_token !== input.operationToken
        || attempt.invitationId !== row.id
        || !["dispatch_authorized", "provider_unknown"].includes(attempt.state)
        || !["dispatch_authorized", "provider_unknown", "provider_outcome_unknown"].includes(row.operation_state)
      ) {
        return { decisionCode:"operation_lost", record:{ ...row } };
      }
      if (row.pending_audit_event_type || row.pending_audit_classification) {
        return { decisionCode:"audit_repair_required", record:{ ...row } };
      }
      if (attempt.state === "dispatch_authorized" && Date.parse(attempt.leaseExpiresAt) > nowMs) {
        return {
          decisionCode:"attempt_in_progress",
          retryAfterSeconds:Math.ceil((Date.parse(attempt.leaseExpiresAt) - nowMs) / 1000),
          record:{ ...row }
        };
      }

      const alreadyUnknown = attempt.state === "provider_unknown";
      Object.assign(attempt, {
        state:"provider_unknown",
        providerOutcome:"unknown",
        failureCode:"provider_outcome_unknown",
        recoveryCheckedAt:new Date(nowMs).toISOString(),
        recoveryActorUserId:input.actorUserId,
        recoveryRequestId:input.requestId,
        recoveryOperationToken:input.recoveryOperationToken,
        lookupComplete:input.lookupComplete === true,
        observedAuthUserId:input.observedAuthUserId || null,
        observedNormalizedEmail:input.observedNormalizedEmail || null,
        observedEmailConfirmedAt:input.observedEmailConfirmedAt || null,
        observedInvitedAt:input.observedInvitedAt || null
      });
      if (alreadyUnknown) {
        return { decisionCode:"provider_outcome_unknown", record:{ ...row } };
      }
      Object.assign(row, {
        status:"reconciliation_required",
        send_state:"unknown",
        operation_state:"provider_unknown",
        processing_started_at:null,
        lease_expires_at:null,
        last_actor_user_id:input.actorUserId,
        failure_code:"provider_outcome_unknown",
        failure_message:"The provider outcome is unresolved; do not dispatch another invitation.",
        updated_at:versionStamp()
      });
      const auditId = await auditIdFor(row, input.operationToken, "reconciliation_required", "provider_outcome_unknown");
      try {
        appendAuditEntry({
          id:auditId,
          invitation_id:row.id,
          actor_user_id:input.actorUserId,
          originating_actor_user_id:attempt.actorUserId,
          venue_id:row.venue_id,
          operation_token:input.operationToken,
          repair_operation_token:input.recoveryOperationToken,
          event_type:"reconciliation_required",
          classification:"provider_outcome_unknown",
          originating_request_id:attempt.requestId,
          request_id:input.requestId,
          details:{}
        });
      } catch {
        Object.assign(row, {
          pending_audit_event_type:"reconciliation_required",
          pending_audit_classification:"provider_outcome_unknown",
          pending_audit_originating_actor_user_id:attempt.actorUserId,
          pending_audit_originating_request_id:attempt.requestId,
          pending_audit_operation_token:input.operationToken,
          pending_audit_details:{}
        });
        return { decisionCode:"audit_repair_required", record:{ ...row } };
      }
      return { decisionCode:"provider_outcome_unknown", record:{ ...row } };
    },
    reconcileInvitation:async input => {
      reconciliationCalls.push(structuredClone(input));
      const row = invitations.get(input.invitationId);
      if (!row) return { decisionCode:"not_found", record:null };
      if (!currentAdmin(input.actorUserId, row.venue_id)) {
        return { decisionCode:"forbidden", record:null };
      }
      if (row.updated_at !== input.expectedUpdatedAt) {
        return { decisionCode:"version_conflict", record:{ ...row } };
      }
      if (row.pending_audit_event_type || row.pending_audit_classification) {
        return { decisionCode:"audit_repair_required", record:{ ...row } };
      }
      if (["dispatch_authorized", "provider_unknown", "provider_outcome_unknown"].includes(row.operation_state)) {
        return { decisionCode:"provider_outcome_unknown", record:{ ...row } };
      }

      const observedEmail = normalizeEmail(input.observedNormalizedEmail || "");
      let eventType;
      let classification;
      if (!row.auth_user_id) {
        eventType = "reconciliation_required";
        if (!input.observedAuthUserId) {
          classification = "exact_auth_lookup_unavailable";
        } else if (observedEmail !== row.normalized_email) {
          classification = "unowned_auth_identity_mismatch";
        } else {
          const observedProfile = profiles.get(input.observedAuthUserId) || null;
          if (observedProfile?.venue_id !== undefined && observedProfile.venue_id !== row.venue_id) {
            classification = "existing_account_other_venue";
          } else if (observedProfile && !observedProfile.active) {
            classification = "existing_account_inactive";
          } else if (observedProfile && observedProfile.role !== row.requested_role) {
            classification = "existing_account_role_conflict";
          } else if (observedProfile) {
            classification = "existing_account_active";
          } else if (input.observedEmailConfirmedAt) {
            classification = "confirmed_account_unlinked";
          } else if (input.observedInvitedAt) {
            classification = "unowned_pending_auth_account";
          } else {
            classification = "preexisting_unowned_auth_identity";
          }
        }
        Object.assign(row, {
          status:"reconciliation_required",
          profile_state:profiles.has(input.observedAuthUserId) ? "failed" : row.profile_state,
          failure_code:classification,
          failure_message:"An exact pre-existing Auth identity requires operator reconciliation and was not changed."
        });
      } else if (!input.observedAuthUserId) {
        eventType = "reconciliation_required";
        classification = "stored_auth_user_missing";
        Object.assign(row, {
          status:"reconciliation_required",
          failure_code:classification,
          failure_message:"The stored Auth identity could not be verified and was preserved for review."
        });
      } else if (
        input.observedAuthUserId !== row.auth_user_id
        || observedEmail !== row.normalized_email
      ) {
        eventType = "reconciliation_required";
        classification = "stored_auth_identity_mismatch";
        Object.assign(row, {
          status:"reconciliation_required",
          failure_code:classification,
          failure_message:"Stored Auth identity evidence did not match and was preserved for review."
        });
      } else if (!input.observedEmailConfirmedAt) {
        eventType = "reconciliation_checked";
        classification = "not_accepted";
      } else {
        const profile = profiles.get(row.auth_user_id) || null;
        eventType = "accepted_profile_conflict";
        if (!profile) classification = "accepted_profile_missing";
        else if (!profile.active) classification = "accepted_profile_inactive";
        else if (profile.venue_id !== row.venue_id) classification = "accepted_profile_other_venue";
        else if (profile.role !== row.requested_role) classification = "accepted_profile_role_conflict";
        else {
          eventType = "accepted_reconciled";
          classification = "verified_auth";
        }

        if (classification === "verified_auth") {
          Object.assign(row, {
            status:"accepted",
            profile_state:["created", "existing"].includes(row.profile_state) ? row.profile_state : "existing",
            accepted_at:input.observedEmailConfirmedAt,
            failure_code:null,
            failure_message:null
          });
        } else if (classification === "accepted_profile_missing") {
          Object.assign(row, {
            status:"profile_pending",
            profile_state:"failed",
            accepted_at:input.observedEmailConfirmedAt,
            failure_code:classification,
            failure_message:"Auth acceptance is verified; the staff profile is missing."
          });
        } else {
          Object.assign(row, {
            status:"failed",
            profile_state:"failed",
            accepted_at:input.observedEmailConfirmedAt,
            failure_code:classification,
            failure_message:"Auth acceptance is verified; the existing profile was preserved for review."
          });
        }
      }

      const stamp = versionStamp();
      Object.assign(row, {
        operation_token:input.operationToken,
        operation_action:"reconcile",
        operation_state:"completed",
        operation_actor_user_id:input.actorUserId,
        operation_request_id:input.requestId,
        processing_started_at:null,
        dispatch_authorized_at:null,
        last_actor_user_id:input.actorUserId,
        updated_at:stamp
      });

      const auditId = await auditIdFor(row, input.operationToken, eventType, classification);
      try {
        appendAuditEntry({
          id:auditId,
          invitation_id:row.id,
          actor_user_id:input.actorUserId,
          venue_id:row.venue_id,
          event_type:eventType,
          classification,
          request_id:input.requestId,
          details:{}
        });
      } catch {
        Object.assign(row, {
          pending_audit_event_type:eventType,
          pending_audit_classification:classification,
          pending_audit_actor_user_id:input.actorUserId,
          pending_audit_request_id:input.requestId,
          pending_audit_originating_actor_user_id:input.actorUserId,
          pending_audit_originating_request_id:input.requestId,
          pending_audit_operation_token:input.operationToken,
          pending_audit_details:{},
          failure_code:eventType === "accepted_reconciled" ? "accepted_audit_pending" : row.failure_code,
          failure_message:eventType === "accepted_reconciled"
            ? "Acceptance is preserved; required audit evidence needs repair."
            : row.failure_message,
          updated_at:versionStamp()
        });
        return { decisionCode:"audit_repair_required", record:{ ...row } };
      }

      return { decisionCode:classification, record:{ ...row } };
    },
    repairInvitationAudit:createRepairInvitationAuditRpcAdapter(repairAuditDecisionRpc),
    updateInvitation:async (id, changes, expectedLease = undefined, expectedState = undefined) => {
      fallbackInvitationUpdateCalls.push({
        id,
        changes:structuredClone(changes),
        expectedLease,
        expectedState:structuredClone(expectedState)
      });
      const row = invitations.get(id);
      if (!row) throw new Error("missing invitation");
      if (typeof expectedLease === "string" && row.processing_started_at !== expectedLease) throw leaseError();
      if (expectedLease === null && row.processing_started_at !== null) throw leaseError();
      if (expectedState) {
        for (const [key, value] of Object.entries(expectedState)) {
          if (row[key] !== value) throw leaseError();
        }
      }
      Object.assign(row, changes, { updated_at:new Date(nowMs).toISOString() });
      return { ...row };
    },
    appendAudit:async entry => {
      fallbackAuditAppendCalls.push(structuredClone(entry));
      appendAuditEntry(entry);
    },
    getAuditById:async id => {
      const audit = audits.find(item => item.id === id);
      return audit ? { ...audit } : null;
    },
    getAuthUserById:async id => authUsers.has(id) ? { ...authUsers.get(id) } : null,
    findAuthUserByEmail:async email => ({
      user:options.authScanIncomplete ? null : findAuthByEmail(email),
      complete:!options.authScanIncomplete
    }),
    lookupAuthUserByEmail:async email => ({
      user:options.authScanIncomplete ? null : findAuthByEmail(email),
      complete:!options.authScanIncomplete
    }),
    inviteUserByEmail:async (email, invitationOptions) => {
      inviteCalls.push({ email, options:structuredClone(invitationOptions) });
      if (options.inviteFailure?.()) throw options.inviteFailureValue || Object.assign(new Error("provider rejected"), { status:422, code:"email_address_invalid" });
      const existing = findAuthByEmail(email);
      if (existing?.email_confirmed_at) {
        throw Object.assign(new Error("email exists"), { status:422, code:"email_exists" });
      }
      if (existing) return { ...existing };
      const user = {
        id:options.inviteeId || INVITEE_ID,
        email,
        invited_at:new Date(nowMs).toISOString(),
        email_confirmed_at:null,
        user_metadata:structuredClone(invitationOptions?.data || {})
      };
      authUsers.set(user.id, user);
      return { ...user };
    }
  };

  const config = {
    enabled:options.enabled !== false,
    environment:"production",
    redirectUrl:"https://doorflow.example/auth/",
    allowedOrigins:[ORIGIN],
    cooldownSeconds:300,
    leaseSeconds:300,
    providerTimeoutMs:30_000
  };

  return {
    deps,
    config,
    invitations,
    profiles,
    authUsers,
    operationAttempts,
    audits,
    auditCalls,
    inviteCalls,
    claimCalls,
    dispatchAuthorizationCalls,
    providerOutcomeCalls,
    profileFinalizationCalls,
    reconciliationCalls,
    dispatchRecoveryCalls,
    repairInvitationAuditCalls,
    fallbackInvitationUpdateCalls,
    fallbackAuditAppendCalls,
    safeLogs,
    advance(seconds) { nowMs += seconds * 1000; },
    handler:createStaffInvitationsHandler(deps, config)
  };
}

function request(method, token = USER_TOKEN, body = undefined, extras = {}) {
  const headers = new Headers({ origin:ORIGIN, ...extras.headers });
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request("https://project.supabase.co/functions/v1/staff-invitations", {
    method,
    headers,
    ...(body !== undefined ? { body:JSON.stringify(body) } : {})
  });
}

function streamedRequest(bytes, extras = {}) {
  const chunks = extras.chunks || [bytes];
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
  const headers = new Headers({
    origin:ORIGIN,
    authorization:`Bearer ${extras.token || USER_TOKEN}`,
    "content-type":extras.contentType || "application/json",
    ...extras.headers
  });
  return new Request(
    "https://project.supabase.co/functions/v1/staff-invitations",
    { method:"POST", headers, body, duplex:"half" }
  );
}

function inviteBody(overrides = {}) {
  return {
    action:"invite",
    full_name:"Alex Employee",
    email:" Alex.Employee@example.com ",
    role:"door",
    idempotency_key:IDEMPOTENCY_A,
    ...overrides
  };
}

async function invoke(harness, req) {
  const response = await harness.handler(req);
  return { response, payload:await response.json() };
}

async function successfulInvite(harness, overrides = {}) {
  const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody(overrides)));
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return result.payload.invitation;
}

async function seedReservedInvitation(harness, overrides = {}) {
  const body = inviteBody(overrides);
  const normalizedEmail = normalizeEmail(body.email);
  const fullName = String(body.full_name).trim().replace(/\s+/g, " ");
  const fingerprint = await sha256Hex(`${normalizedEmail}\n${fullName}\n${body.role}`);
  return await harness.deps.reserveInvitation({
    invited_by_user_id:ADMIN_ID,
    last_actor_user_id:ADMIN_ID,
    venue_id:VENUE_A,
    email:String(body.email).trim(),
    normalized_email:normalizedEmail,
    full_name:fullName,
    requested_role:body.role,
    status:"reserved",
    send_state:"not_attempted",
    profile_state:"pending",
    idempotency_key:body.idempotency_key,
    request_fingerprint:fingerprint
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

test("active same-venue Admin provisions the exact Auth ID and records provider acceptance", async () => {
  const harness = makeHarness();
  const { response, payload } = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));

  assert.equal(response.status, 201);
  assert.equal(payload.ok, true);
  assert.equal(payload.invitation.status, "sent");
  assert.equal(payload.invitation.send_state, "provider_accepted");
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(harness.inviteCalls[0].email, "Alex.Employee@example.com");
  assert.equal(harness.inviteCalls[0].options.redirectTo, "https://doorflow.example/auth/");
  const committed = [...harness.invitations.values()][0];
  const creationMarker = await sha256Hex(
    `doorflow-staff-invitation-provider-creation\n${committed.operation_token}`
  );
  assert.deepEqual(harness.inviteCalls[0].options.data, {
    full_name:"Alex Employee",
    doorflow_invitation_creation_marker:creationMarker
  });
  assert.notEqual(creationMarker, committed.operation_token);
  assert.equal("role" in harness.inviteCalls[0].options.data, false);
  assert.equal("venue_id" in harness.inviteCalls[0].options.data, false);
  assert.equal(harness.authUsers.get(INVITEE_ID).user_metadata.doorflow_invitation_creation_marker, creationMarker);
  assert.equal(JSON.stringify(payload).includes(creationMarker), false);
  assert.equal(JSON.stringify(harness.audits).includes(creationMarker), false);
  assert.equal(JSON.stringify(harness.safeLogs).includes(creationMarker), false);
  assert.deepEqual(harness.profiles.get(INVITEE_ID), {
    id:INVITEE_ID,
    full_name:"Alex Employee",
    role:"door",
    active:true,
    venue_id:VENUE_A,
    created_at:"2026-09-17T16:00:00.000Z"
  });
  assert.ok(harness.audits.some(item => item.event_type === "provider_accepted"));
  assert.ok(!JSON.stringify(harness.audits).match(/access_token|refresh_token|password|https:\/\/doorflow\.example\/auth\//i));
});

for (const [role, active] of [["manager", true], ["door", true], ["viewer", true], ["admin", false]]) {
  test(`rejects ${active ? role : "inactive Admin"} before Auth administration`, async () => {
    const harness = makeHarness({ actorRole:role, actorActive:active });
    const { response, payload } = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "forbidden");
    assert.equal(harness.inviteCalls.length, 0);
  });
}

test("rejects missing, expired/forged, and API-key-only credentials", async t => {
  const cases = [
    ["missing", null, 401, "missing_credentials"],
    ["forged", "forged.payload.signature", 401, "invalid_credentials"],
    ["expired", "expired.payload.signature", 401, "invalid_credentials"],
    ["API key", "sb_publishable_not_a_user", 401, "invalid_credentials"]
  ];
  for (const [label, token, status, code] of cases) {
    await t.test(label, async () => {
      const harness = makeHarness();
      const result = await invoke(harness, request("POST", token, inviteBody()));
      assert.equal(result.response.status, status);
      assert.equal(result.payload.error.code, code);
      assert.equal(harness.inviteCalls.length, 0);
    });
  }
});

test("rejects actor, venue, redirect, Admin-flag, and invalid-role spoofing", async t => {
  const spoofed = [
    { actor_id:OTHER_ADMIN_ID },
    { venue_id:VENUE_B },
    { redirect_url:"https://evil.example/" },
    { is_admin:true },
    { role:"owner" }
  ];
  for (const extra of spoofed) {
    await t.test(Object.keys(extra)[0], async () => {
      const harness = makeHarness();
      const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody(extra)));
      assert.equal(result.response.status, 400);
      assert.equal(harness.inviteCalls.length, 0);
    });
  }
});

test("same-key replay and same-email concurrency never duplicate sends", async () => {
  const harness = makeHarness();
  await successfulInvite(harness);

  const replay = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.invitation.status, "sent");
  assert.equal(harness.inviteCalls.length, 1);

  const duplicate = await invoke(harness, request("POST", USER_TOKEN, inviteBody({ idempotency_key:IDEMPOTENCY_B })));
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.error.code, "invitation_exists");
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(harness.invitations.size, 1);
});

test("simultaneous double-submit is serialized by the durable reservation and lease", async () => {
  const harness = makeHarness();
  const [first, second] = await Promise.all([
    invoke(harness, request("POST", USER_TOKEN, inviteBody())),
    invoke(harness, request("POST", USER_TOKEN, inviteBody()))
  ]);

  assert.equal(harness.invitations.size, 1);
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(harness.profiles.get(INVITEE_ID).id, INVITEE_ID);
  assert.ok([first, second].some(result => result.payload.invitation?.status === "sent"));
  assert.ok([first.response.status, second.response.status].every(status => [200, 201, 202, 409].includes(status)));
});

test("simultaneous different-key requests for one email create one invitation and one send", async () => {
  const harness = makeHarness();
  const [first, second] = await Promise.all([
    invoke(harness, request("POST", USER_TOKEN, inviteBody({ idempotency_key:IDEMPOTENCY_A }))),
    invoke(harness, request("POST", USER_TOKEN, inviteBody({ idempotency_key:IDEMPOTENCY_B })))
  ]);

  assert.equal(harness.invitations.size, 1);
  assert.equal(harness.inviteCalls.length, 1);
  assert.ok([first, second].some(result => result.payload.invitation?.status === "sent"));
  assert.ok([first, second].some(result => result.payload.error?.code === "invitation_exists"));
});

test("a live durable lease blocks a concurrent retry", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  const row = harness.invitations.get(invitation.id);
  row.status = "processing";
  row.processing_started_at = "2026-09-17T16:00:00.000Z";

  const result = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:invitation.id }));
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.error.code, "attempt_in_progress");
  assert.equal(result.payload.invitation.can_retry, false);
  assert.equal(result.payload.invitation.retry_after_seconds, 300);
  assert.equal(harness.inviteCalls.length, 1);

  harness.advance(301);
  const listed = await invoke(harness, request("GET"));
  assert.equal(listed.payload.invitations[0].can_retry, true);
  const recovered = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:invitation.id }));
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.payload.invitation.status, "sent");
  assert.equal(harness.inviteCalls.length, 1);
});

test("existing active, inactive, role-conflicting, cross-venue, and confirmed accounts are not overwritten", async t => {
  const scenarios = [
    ["active", { active:true, venue_id:VENUE_A, role:"door" }, null, "existing_account_active"],
    ["inactive", { active:false, venue_id:VENUE_A, role:"door" }, null, "existing_account_inactive"],
    ["role conflict", { active:true, venue_id:VENUE_A, role:"manager" }, null, "existing_account_role_conflict"],
    ["other venue", { active:true, venue_id:VENUE_B, role:"door" }, null, "identity_unavailable"],
    ["confirmed unlinked", null, "2026-09-01T00:00:00.000Z", "confirmed_account_unlinked"]
  ];

  for (const [label, profile, confirmedAt, expectedCode] of scenarios) {
    await t.test(label, async () => {
      const harness = makeHarness();
      harness.authUsers.set(INVITEE_ID, {
        id:INVITEE_ID,
        email:"alex.employee@example.com",
        invited_at:"2026-08-01T00:00:00.000Z",
        email_confirmed_at:confirmedAt
      });
      if (profile) harness.profiles.set(INVITEE_ID, { id:INVITEE_ID, full_name:"Existing", ...profile });
      const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      assert.equal(result.response.status, 409);
      assert.equal(result.payload.error.code, expectedCode);
      assert.equal(harness.inviteCalls.length, 0);
      if (profile) assert.equal(harness.profiles.get(INVITEE_ID).role, profile.role);
      if (label === "other venue") {
        const committed = [...harness.invitations.values()][0];
        assert.equal(committed.failure_code, "existing_account_other_venue");
        assert.equal(result.payload.invitation, undefined);
        assert.equal(JSON.stringify(result.payload).includes(VENUE_B), false);
        assert.equal(JSON.stringify(result.payload).includes("another venue"), false);
      }
    });
  }
});

test("an unowned pending Auth account produces reconciliation-required without resending", async () => {
  const harness = makeHarness();
  harness.authUsers.set(INVITEE_ID, {
    id:INVITEE_ID,
    email:"alex.employee@example.com",
    invited_at:"2026-09-01T00:00:00.000Z",
    email_confirmed_at:null
  });
  const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.error.code, "unowned_pending_auth_account");
  assert.equal(result.payload.invitation.status, "reconciliation_required");
  assert.equal(harness.inviteCalls.length, 0);
});

test("an unowned pending Auth identity appearing after an empty exact lookup is never adopted", async () => {
  const harness = makeHarness();
  const originalLookupAuthUserByEmail = harness.deps.lookupAuthUserByEmail;
  const emptyLookupCaptured = deferred();
  const releaseEmptyLookup = deferred();
  let lookupCalls = 0;
  harness.deps.lookupAuthUserByEmail = async (...args) => {
    const observed = await originalLookupAuthUserByEmail(...args);
    lookupCalls += 1;
    if (lookupCalls === 1) {
      assert.deepEqual(observed, { user:null, complete:true });
      emptyLookupCaptured.resolve();
      await releaseEmptyLookup.promise;
    }
    return observed;
  };

  const pendingFirst = invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  await emptyLookupCaptured.promise;
  harness.authUsers.set(UNEXPECTED_INVITEE_ID, {
    id:UNEXPECTED_INVITEE_ID,
    email:"alex.employee@example.com",
    invited_at:"2026-09-17T15:59:59.000Z",
    email_confirmed_at:null,
    user_metadata:{ source:"out_of_band" }
  });
  releaseEmptyLookup.resolve();
  const first = await pendingFirst;
  const row = [...harness.invitations.values()][0];
  const creationMarker = harness.inviteCalls[0].options.data.doorflow_invitation_creation_marker;

  assert.deepEqual({
    classification:`${first.response.status}:${first.payload.error?.code || "ok"}`,
    publicStatus:first.payload.invitation?.status || null,
    providerCallCount:harness.inviteCalls.length,
    committedAuthUserId:row.auth_user_id,
    committedSendState:row.send_state,
    committedLastSentAt:row.last_sent_at,
    committedVenueId:row.venue_id,
    committedRole:row.requested_role,
    profileExists:harness.profiles.has(UNEXPECTED_INVITEE_ID),
    existingMetadata:harness.authUsers.get(UNEXPECTED_INVITEE_ID).user_metadata
  }, {
    classification:"502:provider_identity_mismatch",
    publicStatus:"reconciliation_required",
    providerCallCount:1,
    committedAuthUserId:null,
    committedSendState:"not_attempted",
    committedLastSentAt:null,
    committedVenueId:VENUE_A,
    committedRole:"door",
    profileExists:false,
    existingMetadata:{ source:"out_of_band" }
  });
  assert.equal(typeof creationMarker, "string");
  assert.equal(creationMarker.length, 64);
  assert.equal(JSON.stringify(first.payload).includes(creationMarker), false);
  assert.equal(JSON.stringify(harness.audits).includes(creationMarker), false);
  assert.equal(JSON.stringify(harness.safeLogs).includes(creationMarker), false);
  assert.doesNotMatch(first.payload.error.message, /another venue|existing account/i);

  const retry = await invoke(
    harness,
    request("POST", USER_TOKEN, { action:"retry", invitation_id:row.id })
  );
  const resend = await invoke(
    harness,
    request("POST", USER_TOKEN, { action:"resend", invitation_id:row.id })
  );
  assert.equal(`${retry.response.status}:${retry.payload.error.code}`, "409:retry_not_available");
  assert.equal(`${resend.response.status}:${resend.payload.error.code}`, "409:resend_not_available");
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(harness.invitations.get(row.id).auth_user_id, null);
  assert.equal(harness.profiles.has(UNEXPECTED_INVITEE_ID), false);
});

test("recorded pre-existing identities never become workflow-owned on refresh or retry", async t => {
  await t.test("confirmed account", async () => {
    const harness = makeHarness();
    harness.authUsers.set(INVITEE_ID, {
      id:INVITEE_ID,
      email:"alex.employee@example.com",
      invited_at:"2026-08-01T00:00:00.000Z",
      email_confirmed_at:"2026-09-01T00:00:00.000Z"
    });
    const first = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
    assert.equal(first.payload.error.code, "confirmed_account_unlinked");
    assert.equal(first.payload.invitation.status, "reconciliation_required");
    const listed = await invoke(harness, request("GET"));
    assert.equal(listed.payload.invitations[0].status, "reconciliation_required");
    assert.equal(listed.payload.invitations[0].failure_code, "confirmed_account_unlinked");
    assert.equal(listed.payload.invitations[0].can_retry, false);
    const retried = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:first.payload.invitation.id }));
    assert.equal(retried.response.status, 409);
    assert.equal(retried.payload.error.code, "retry_not_available");
    assert.equal(harness.profiles.has(INVITEE_ID), false);
    assert.equal(harness.inviteCalls.length, 0);
  });

  await t.test("unowned pending account later confirmed", async () => {
    const harness = makeHarness();
    harness.authUsers.set(INVITEE_ID, {
      id:INVITEE_ID,
      email:"alex.employee@example.com",
      invited_at:"2026-08-01T00:00:00.000Z",
      email_confirmed_at:null
    });
    const first = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
    assert.equal(first.payload.error.code, "unowned_pending_auth_account");
    harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
    const listed = await invoke(harness, request("GET"));
    assert.equal(listed.payload.invitations[0].status, "reconciliation_required");
    const retried = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:first.payload.invitation.id }));
    assert.equal(retried.response.status, 409);
    assert.equal(retried.payload.error.code, "retry_not_available");
    assert.equal(harness.profiles.has(INVITEE_ID), false);
    assert.equal(harness.inviteCalls.length, 0);
  });
});

test("idempotent replay cannot cross the Admin's current venue", async () => {
  const harness = makeHarness();
  await successfulInvite(harness);
  harness.profiles.get(ADMIN_ID).venue_id = VENUE_B;
  const replay = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  assert.equal(replay.response.status, 409);
  assert.equal(replay.payload.error.code, "idempotency_conflict");
  assert.equal("invitation" in replay.payload, false);
  assert.equal(harness.inviteCalls.length, 1);
});

test("direct actions cannot bypass server-owned retry and resend states", async t => {
  await t.test("sent invitation requires resend, not retry", async () => {
    const harness = makeHarness();
    const invitation = await successfulInvite(harness);
    const result = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:invitation.id }));
    assert.equal(result.response.status, 409);
    assert.equal(result.payload.error.code, "retry_not_available");
    assert.equal(harness.inviteCalls.length, 1);
  });

  await t.test("a provider API error preserves uncertainty and permits neither retry nor resend", async () => {
    const harness = makeHarness({
      inviteFailure:() => true,
      inviteFailureValue:Object.assign(new Error("invalid address"), { status:422, code:"email_address_invalid" })
    });
    const first = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
    assert.equal(first.response.status, 502);
    assert.equal(first.payload.error.code, "provider_outcome_unknown");
    assert.equal(first.payload.invitation.status, "reconciliation_required");
    assert.equal(first.payload.invitation.send_state, "unknown");
    const result = await invoke(harness, request("POST", USER_TOKEN, { action:"resend", invitation_id:first.payload.invitation.id }));
    assert.equal(result.response.status, 409);
    assert.equal(result.payload.error.code, "resend_not_available");
    assert.equal(harness.inviteCalls.length, 1);
  });
});

test("provider API rate-limit errors remain uncertain and are not blindly retried", async () => {
  let failures = 1;
  const harness = makeHarness({
    inviteFailure:() => failures-- > 0,
    inviteFailureValue:Object.assign(new Error("too many emails"), { status:429, code:"over_email_send_rate_limit" })
  });
  const first = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  assert.equal(first.response.status, 502);
  assert.equal(first.payload.error.code, "provider_outcome_unknown");
  assert.equal(first.payload.invitation.send_state, "unknown");
  assert.equal(first.payload.invitation.status, "reconciliation_required");

  const tooSoon = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:first.payload.invitation.id }));
  assert.equal(tooSoon.response.status, 409);
  assert.equal(harness.inviteCalls.length, 1);

  harness.advance(301);
  const retried = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:first.payload.invitation.id }));
  assert.equal(retried.response.status, 409);
  assert.equal(harness.inviteCalls.length, 1);
});

test("an ambiguous provider outcome is never blindly retried", async () => {
  const harness = makeHarness({
    inviteFailure:() => true,
    inviteFailureValue:Object.assign(new Error("network timeout after send"), { status:503, code:"request_timeout" })
  });
  const first = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  assert.equal(first.response.status, 502);
  assert.equal(first.payload.error.code, "provider_outcome_unknown");
  assert.equal(first.payload.invitation.status, "reconciliation_required");

  const retry = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:first.payload.invitation.id }));
  assert.equal(retry.response.status, 409);
  assert.equal(harness.inviteCalls.length, 1);
});

test("profile failure after provider acceptance preserves Auth identity and retry does not resend", async () => {
  let profileFailures = 1;
  const harness = makeHarness({ profileFailure:() => profileFailures-- > 0 });
  const first = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  assert.equal(first.response.status, 502);
  assert.equal(first.payload.error.code, "profile_write_failed");
  assert.equal(first.payload.invitation.status, "profile_pending");
  assert.equal(first.payload.invitation.send_state, "provider_accepted");
  assert.ok(harness.authUsers.has(INVITEE_ID));
  assert.equal(harness.inviteCalls.length, 1);

  const retried = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:first.payload.invitation.id }));
  assert.equal(retried.response.status, 200);
  assert.equal(retried.payload.invitation.status, "sent");
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(harness.profiles.get(INVITEE_ID).id, INVITEE_ID);
});

test("resend reauthorizes venue, enforces cooldown, preserves role, and uses the invite API", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness, { role:"manager" });

  const tooSoon = await invoke(harness, request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id }));
  assert.equal(tooSoon.response.status, 429);
  assert.equal(harness.inviteCalls.length, 1);

  const otherVenue = await invoke(harness, request("POST", OTHER_TOKEN, { action:"resend", invitation_id:invitation.id }));
  assert.equal(otherVenue.response.status, 404);
  assert.equal(harness.inviteCalls.length, 1);

  harness.advance(301);
  const resent = await invoke(harness, request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id }));
  assert.equal(resent.response.status, 200);
  assert.equal(resent.payload.invitation.role, "manager");
  assert.equal(harness.inviteCalls.length, 2);
  assert.equal(harness.inviteCalls[1].email, "Alex.Employee@example.com");
  assert.deepEqual(harness.inviteCalls[1].options.data, { full_name:"Alex Employee" });
  assert.ok(!JSON.stringify(harness.inviteCalls[1]).match(/password|recovery|signup/i));
});

test("a resend API error preserves uncertainty and cannot trigger another send", async () => {
  let failSend = false;
  const harness = makeHarness({
    inviteFailure:() => failSend,
    inviteFailureValue:Object.assign(new Error("provider rejected resend"), { status:422, code:"provider_rejected" })
  });
  const invitation = await successfulInvite(harness);
  harness.advance(301);
  failSend = true;
  const failed = await invoke(harness, request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id }));
  assert.equal(failed.response.status, 502);
  assert.equal(failed.payload.error.code, "provider_outcome_unknown");
  assert.equal(failed.payload.invitation.status, "reconciliation_required");
  assert.equal(failed.payload.invitation.send_state, "unknown");
  assert.equal(failed.payload.invitation.can_retry, false);
  assert.equal(harness.inviteCalls.length, 2);

  failSend = false;
  const tooSoon = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:invitation.id }));
  assert.equal(tooSoon.response.status, 409);
  assert.equal(harness.inviteCalls.length, 2);

  harness.advance(301);
  const stillBlocked = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:invitation.id }));
  assert.equal(stillBlocked.response.status, 409);
  assert.equal(harness.inviteCalls.length, 2);
  assert.equal(harness.profiles.get(INVITEE_ID).id, INVITEE_ID);
});

test("retry and resend cannot change or reactivate an existing profile", async t => {
  for (const [label, mutate, expected] of [
    ["role", profile => { profile.role = "viewer"; }, "existing_account_role_conflict"],
    ["active", profile => { profile.active = false; }, "existing_account_inactive"],
    ["venue", profile => { profile.venue_id = VENUE_B; }, "identity_unavailable"]
  ]) {
    await t.test(label, async () => {
      const harness = makeHarness();
      const invitation = await successfulInvite(harness);
      mutate(harness.profiles.get(INVITEE_ID));
      harness.advance(301);
      const result = await invoke(harness, request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id }));
      assert.equal(result.response.status, 409);
      assert.equal(result.payload.error.code, expected);
      assert.equal(harness.inviteCalls.length, 1);
    });
  }
});

test("process-path acceptance audit failure is repaired by an action without reopening provisioning", async () => {
  let acceptedAuditFailures = 1;
  const harness = makeHarness({
    auditFailure:entry => entry.event_type === "accepted_reconciled" && acceptedAuditFailures-- > 0
  });
  const invitation = await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
  harness.advance(301);

  const failedAudit = await invoke(
    harness,
    request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id })
  );
  assert.equal(failedAudit.response.status, 502);
  assert.equal(failedAudit.payload.error.code, "accepted_audit_pending");
  assert.equal(failedAudit.payload.invitation.status, "accepted");
  assert.equal(failedAudit.payload.invitation.failure_code, "accepted_audit_pending");
  assert.equal(failedAudit.payload.invitation.can_retry, false);
  assert.equal(failedAudit.payload.invitation.can_resend, false);
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(harness.invitations.get(invitation.id).processing_started_at, null);
  const acceptedSemantics = ((row) => ({
    status:row.status,
    auth_user_id:row.auth_user_id,
    venue_id:row.venue_id,
    requested_role:row.requested_role,
    send_state:row.send_state,
    profile_state:row.profile_state,
    last_sent_at:row.last_sent_at,
    accepted_at:row.accepted_at
  }))(harness.invitations.get(invitation.id));
  const profileBeforeRepair = structuredClone(harness.profiles.get(INVITEE_ID));
  const repairCallsBefore = harness.repairInvitationAuditCalls.length;
  const fallbackUpdatesBefore = harness.fallbackInvitationUpdateCalls.length;
  const fallbackAuditAppendsBefore = harness.fallbackAuditAppendCalls.length;

  const repairedByAction = await invoke(
    harness,
    request("POST", USER_TOKEN, { action:"retry", invitation_id:invitation.id })
  );
  assert.equal(repairedByAction.response.status, 409);
  assert.equal(repairedByAction.payload.error.code, "already_accepted");
  assert.equal(repairedByAction.payload.invitation.status, "accepted");
  assert.equal(repairedByAction.payload.invitation.failure_code, null);
  assert.equal(harness.inviteCalls.length, 1);
  assert.deepEqual(((row) => ({
    status:row.status,
    auth_user_id:row.auth_user_id,
    venue_id:row.venue_id,
    requested_role:row.requested_role,
    send_state:row.send_state,
    profile_state:row.profile_state,
    last_sent_at:row.last_sent_at,
    accepted_at:row.accepted_at
  }))(harness.invitations.get(invitation.id)), acceptedSemantics);
  assert.deepEqual(harness.profiles.get(INVITEE_ID), profileBeforeRepair);
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_reconciled").length, 1);
  assert.equal(harness.audits.find(item => item.event_type === "accepted_reconciled").id, invitation.id);
  assert.equal(harness.repairInvitationAuditCalls.length, repairCallsBefore + 1);
  assert.equal(harness.repairInvitationAuditCalls.at(-1).name, "doorflow_repair_staff_invitation_audit");
  assert.equal(harness.fallbackInvitationUpdateCalls.length, fallbackUpdatesBefore);
  assert.equal(harness.fallbackAuditAppendCalls.length, fallbackAuditAppendsBefore);

  const acceptedAuditCallCount = harness.auditCalls.filter(item => item.event_type === "accepted_reconciled").length;
  await invoke(harness, request("GET"));
  assert.equal(
    harness.auditCalls.filter(item => item.event_type === "accepted_reconciled").length,
    acceptedAuditCallCount
  );
});

test("GET-path acceptance audit failure remains accepted and repairs exactly once", async () => {
  let acceptedAuditFailures = 1;
  const harness = makeHarness({
    auditFailure:entry => entry.event_type === "accepted_reconciled" && acceptedAuditFailures-- > 0
  });
  const invitation = await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";

  const pending = await invoke(harness, request("GET"));
  assert.equal(pending.response.status, 200);
  assert.equal(pending.payload.invitations[0].status, "accepted");
  assert.equal(pending.payload.invitations[0].failure_code, "accepted_audit_pending");
  assert.equal(pending.payload.invitations[0].can_retry, false);
  assert.equal(pending.payload.invitations[0].can_resend, false);
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_reconciled").length, 0);
  assert.equal(harness.invitations.get(invitation.id).processing_started_at, null);

  const repaired = await invoke(harness, request("GET"));
  assert.equal(repaired.response.status, 200);
  assert.equal(repaired.payload.invitations[0].status, "accepted");
  assert.equal(repaired.payload.invitations[0].failure_code, null);
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_reconciled").length, 1);
  assert.equal(harness.audits.find(item => item.event_type === "accepted_reconciled").id, invitation.id);
  assert.equal(harness.repairInvitationAuditCalls.length, 1);
  assert.equal(harness.repairInvitationAuditCalls[0].name, "doorflow_repair_staff_invitation_audit");

  const acceptedAuditCallCount = harness.auditCalls.filter(item => item.event_type === "accepted_reconciled").length;
  await invoke(harness, request("GET"));
  assert.equal(
    harness.auditCalls.filter(item => item.event_type === "accepted_reconciled").length,
    acceptedAuditCallCount
  );
  assert.equal(harness.inviteCalls.length, 1);
});

test("accepted audit repair deduplicates a crash after insert and before marker cleanup", async () => {
  let acceptedAuditFailures = 1;
  let repairCleanupInterruptions = 1;
  const harness = makeHarness({
    auditFailure:entry => entry.event_type === "accepted_reconciled" && acceptedAuditFailures-- > 0,
    repairAuditCleanupFailure:entry => (
      entry.event_type === "accepted_reconciled" && repairCleanupInterruptions-- > 0
    )
  });
  const invitation = await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";

  const pending = await invoke(harness, request("GET"));
  assert.equal(pending.response.status, 200);
  assert.equal(pending.payload.invitations[0].failure_code, "accepted_audit_pending");
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_reconciled").length, 0);

  const interrupted = await invoke(harness, request("GET"));
  assert.equal(interrupted.response.status, 500);
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_reconciled").length, 1);
  assert.equal(harness.invitations.get(invitation.id).failure_code, "accepted_audit_pending");
  assert.equal(harness.invitations.get(invitation.id).processing_started_at, null);
  assert.equal(harness.repairInvitationAuditCalls.length, 1);

  const repaired = await invoke(harness, request("GET"));
  assert.equal(repaired.response.status, 200);
  assert.equal(repaired.payload.invitations[0].status, "accepted");
  assert.equal(repaired.payload.invitations[0].failure_code, null);
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_reconciled").length, 1);
  assert.equal(harness.auditCalls.filter(item => item.event_type === "accepted_reconciled").length, 3);
  assert.equal(harness.repairInvitationAuditCalls.length, 2);

  await invoke(harness, request("GET"));
  assert.equal(harness.auditCalls.filter(item => item.event_type === "accepted_reconciled").length, 3);
  assert.equal(harness.inviteCalls.length, 1);
});

test("a colliding deterministic audit ID is accepted only when its canonical fields match", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
  harness.audits.push({
    id:invitation.id,
    invitation_id:"99999999-9999-4999-8999-999999999999",
    actor_user_id:OTHER_ADMIN_ID,
    venue_id:VENUE_B,
    event_type:"accepted_reconciled",
    classification:"verified_auth",
    request_id:"collision",
    details:{},
    created_at:"2026-09-17T15:00:00.000Z"
  });
  const auditCountBeforeRepair = harness.audits.length;

  const first = await invoke(harness, request("GET"));
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.invitations[0].status, "accepted");
  assert.equal(first.payload.invitations[0].failure_code, "accepted_audit_pending");
  assert.equal(first.payload.invitations[0].can_retry, false);
  assert.equal(first.payload.invitations[0].can_resend, false);
  assert.equal(harness.invitations.get(invitation.id).pending_audit_event_type, "accepted_reconciled");
  assert.equal(harness.invitations.get(invitation.id).processing_started_at, null);

  const second = await invoke(harness, request("GET"));
  assert.equal(second.response.status, 500);
  assert.equal(second.payload.error.code, "audit_id_collision");
  assert.equal(second.payload.invitation.failure_code, "accepted_audit_pending");
  assert.equal(harness.audits.length, auditCountBeforeRepair);
  assert.equal(harness.audits.filter(item => item.id === invitation.id).length, 1);
  assert.equal(harness.auditCalls.filter(item => item.event_type === "accepted_reconciled").length, 2);
  assert.equal(harness.repairInvitationAuditCalls.length, 1);
  assert.equal(harness.inviteCalls.length, 1);
});

test("malformed pending-audit markers fail closed and cannot unlock retry or resend", async t => {
  const cases = [
    ["partial", row => { row.pending_audit_event_type = "accepted_reconciled"; }],
    ["unknown", row => {
      row.pending_audit_event_type = "unexpected_event";
      row.pending_audit_classification = "unexpected_classification";
    }],
    ["wrong state", row => {
      row.pending_audit_event_type = "accepted_reconciled";
      row.pending_audit_classification = "verified_auth";
    }]
  ];

  for (const [label, mutate] of cases) {
    await t.test(label, async () => {
      const harness = makeHarness();
      const invitation = await successfulInvite(harness);
      mutate(harness.invitations.get(invitation.id));

      const listed = await invoke(harness, request("GET"));
      assert.equal(listed.response.status, 409);
      assert.equal(listed.payload.error.code, "audit_state_invalid");
      assert.equal(listed.payload.invitation.can_retry, false);
      assert.equal(listed.payload.invitation.can_resend, false);

      const action = await invoke(
        harness,
        request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id })
      );
      assert.equal(action.response.status, 409);
      assert.equal(action.payload.error.code, "audit_state_invalid");
      assert.equal(action.payload.invitation.can_retry, false);
      assert.equal(action.payload.invitation.can_resend, false);
      assert.equal(harness.inviteCalls.length, 1);
    });
  }
});

test("a stale GET cannot downgrade acceptance completed by a concurrent POST", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
  harness.advance(301);

  const originalReconcileInvitation = harness.deps.reconcileInvitation;
  const reconciliationStarted = deferred();
  const releaseReconciliation = deferred();
  let blocked = false;
  harness.deps.reconcileInvitation = async input => {
    if (!blocked) {
      blocked = true;
      reconciliationStarted.resolve();
      await releaseReconciliation.promise;
    }
    return await originalReconcileInvitation(input);
  };

  const staleGetPromise = invoke(harness, request("GET"));
  await reconciliationStarted.promise;
  const completedPost = await invoke(
    harness,
    request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id })
  );
  assert.equal(completedPost.response.status, 200);
  assert.equal(completedPost.payload.invitation.status, "accepted");
  releaseReconciliation.resolve();
  const staleGet = await staleGetPromise;

  assert.equal(staleGet.response.status, 200);
  assert.equal(staleGet.payload.invitations[0].status, "accepted");
  assert.equal(harness.invitations.get(invitation.id).status, "accepted");
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_reconciled").length, 1);
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_profile_conflict").length, 0);
  assert.equal(harness.inviteCalls.length, 1);
});

test("interleaved GET reconciliation uses CAS and emits one conflict audit", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
  harness.profiles.get(INVITEE_ID).role = "viewer";

  const originalReconcileInvitation = harness.deps.reconcileInvitation;
  const reconciliationStarted = deferred();
  const releaseReconciliation = deferred();
  let blocked = false;
  harness.deps.reconcileInvitation = async input => {
    if (!blocked) {
      blocked = true;
      reconciliationStarted.resolve();
      await releaseReconciliation.promise;
    }
    return await originalReconcileInvitation(input);
  };

  const staleGetPromise = invoke(harness, request("GET"));
  await reconciliationStarted.promise;
  const winningGet = await invoke(harness, request("GET"));
  assert.equal(winningGet.response.status, 200);
  assert.equal(winningGet.payload.invitations[0].failure_code, "accepted_profile_role_conflict");
  releaseReconciliation.resolve();
  const staleGet = await staleGetPromise;

  assert.equal(staleGet.response.status, 200);
  assert.equal(staleGet.payload.invitations[0].status, "failed");
  assert.equal(staleGet.payload.invitations[0].failure_code, "accepted_profile_role_conflict");
  assert.equal(harness.invitations.get(invitation.id).failure_code, "accepted_profile_role_conflict");
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_profile_conflict").length, 1);
  assert.equal(harness.auditCalls.filter(item => item.event_type === "accepted_profile_conflict").length, 1);
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_reconciled").length, 0);
  assert.equal(harness.inviteCalls.length, 1);
});

test("each accepted-profile conflict durably repairs audit failure and cleanup interruption", async t => {
  const scenarios = [
    ["inactive", profile => { profile.active = false; }, "accepted_profile_inactive", "failed", "accepted_profile_inactive"],
    ["role", profile => { profile.role = "viewer"; }, "accepted_profile_role_conflict", "failed", "accepted_profile_role_conflict"],
    ["venue", profile => { profile.venue_id = VENUE_B; }, "accepted_profile_other_venue", "failed", "identity_unavailable"],
    ["missing", (_profile, harness) => { harness.profiles.delete(INVITEE_ID); }, "accepted_profile_missing", "profile_pending", "accepted_profile_missing"]
  ];

  for (const [label, mutate, expectedCode, expectedStatus, publicCode] of scenarios) {
    await t.test(label, async () => {
      let auditFailures = 1;
      let repairCleanupInterruptions = 1;
      const harness = makeHarness({
        auditFailure:entry => entry.event_type === "accepted_profile_conflict" && auditFailures-- > 0,
        repairAuditCleanupFailure:entry => (
          entry.event_type === "accepted_profile_conflict" && repairCleanupInterruptions-- > 0
        )
      });
      const invitation = await successfulInvite(harness);
      const profile = harness.profiles.get(INVITEE_ID);
      mutate(profile, harness);
      harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
      const profileBefore = harness.profiles.has(INVITEE_ID)
        ? structuredClone(harness.profiles.get(INVITEE_ID))
        : null;
      const authBefore = structuredClone(harness.authUsers.get(INVITEE_ID));

      const failedAudit = await invoke(harness, request("GET"));
      assert.equal(failedAudit.response.status, 200);
      assert.equal(failedAudit.payload.invitations[0].status, expectedStatus);
      assert.equal(failedAudit.payload.invitations[0].failure_code, publicCode);
      assert.equal(failedAudit.payload.invitations[0].can_retry, false);
      assert.equal(failedAudit.payload.invitations[0].can_resend, false);
      assert.equal(harness.invitations.get(invitation.id).pending_audit_event_type, "accepted_profile_conflict");
      assert.equal(harness.invitations.get(invitation.id).pending_audit_classification, expectedCode);
      assert.equal(harness.invitations.get(invitation.id).processing_started_at, null);
      assert.equal(harness.audits.filter(item => item.event_type === "accepted_profile_conflict").length, 0);

      const interrupted = await invoke(harness, request("GET"));
      assert.equal(interrupted.response.status, 500);
      assert.equal(harness.invitations.get(invitation.id).failure_code, expectedCode);
      assert.equal(harness.invitations.get(invitation.id).pending_audit_classification, expectedCode);
      assert.equal(harness.invitations.get(invitation.id).processing_started_at, null);
      assert.equal(harness.audits.filter(item => item.event_type === "accepted_profile_conflict").length, 1);
      assert.equal(harness.repairInvitationAuditCalls.length, 1);

      const repaired = await invoke(harness, request("GET"));
      assert.equal(repaired.response.status, 200);
      assert.equal(repaired.payload.invitations[0].status, expectedStatus);
      assert.equal(repaired.payload.invitations[0].failure_code, publicCode);
      assert.equal(harness.invitations.get(invitation.id).pending_audit_event_type, null);
      assert.equal(harness.invitations.get(invitation.id).pending_audit_classification, null);
      assert.equal(harness.invitations.get(invitation.id).processing_started_at, null);
      const conflictAudits = harness.audits.filter(item => item.event_type === "accepted_profile_conflict");
      assert.equal(conflictAudits.length, 1);
      assert.equal(conflictAudits[0].classification, expectedCode);
      assert.notEqual(conflictAudits[0].id, invitation.id);
      assert.equal(harness.auditCalls.filter(item => item.event_type === "accepted_profile_conflict").length, 3);
      assert.equal(harness.repairInvitationAuditCalls.length, 2);

      const auditCallCount = harness.auditCalls.length;
      const stable = await invoke(harness, request("GET"));
      assert.equal(stable.response.status, 200);
      assert.equal(stable.payload.invitations[0].failure_code, publicCode);
      assert.equal(harness.auditCalls.length, auditCallCount);
      assert.equal(harness.inviteCalls.length, 1);
      assert.deepEqual(harness.authUsers.get(INVITEE_ID), authBefore);
      assert.deepEqual(
        harness.profiles.has(INVITEE_ID) ? harness.profiles.get(INVITEE_ID) : null,
        profileBefore
      );
    });
  }
});

test("an action that repairs a missing-profile conflict audit does not also provision", async () => {
  let auditFailures = 1;
  const harness = makeHarness({
    auditFailure:entry => entry.event_type === "accepted_profile_conflict" && auditFailures-- > 0
  });
  const invitation = await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
  harness.profiles.delete(INVITEE_ID);

  const pending = await invoke(harness, request("GET"));
  assert.equal(pending.payload.invitations[0].failure_code, "accepted_profile_missing");
  assert.equal(pending.payload.invitations[0].can_retry, false);

  const repaired = await invoke(
    harness,
    request("POST", USER_TOKEN, { action:"retry", invitation_id:invitation.id })
  );
  assert.equal(repaired.response.status, 409);
  assert.equal(repaired.payload.error.code, "audit_repair_completed");
  assert.equal(repaired.payload.invitation.failure_code, "accepted_profile_missing");
  assert.equal(repaired.payload.invitation.can_retry, true);
  assert.equal(harness.profiles.has(INVITEE_ID), false);
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_profile_conflict").length, 1);
  assert.equal(harness.repairInvitationAuditCalls.length, 1);

  const profileRetry = await invoke(
    harness,
    request("POST", USER_TOKEN, { action:"retry", invitation_id:invitation.id })
  );
  assert.equal(profileRetry.response.status, 200);
  assert.equal(profileRetry.payload.invitation.status, "accepted");
  assert.equal(harness.profiles.get(INVITEE_ID).id, INVITEE_ID);
  assert.equal(harness.inviteCalls.length, 1);
});

test("GET marks accepted only from verified server Auth evidence", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
  const result = await invoke(harness, request("GET"));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.invitations[0].status, "accepted");
  assert.ok(result.payload.invitations[0].accepted_at);
});

test("GET acceptance repairs a stale failed profile_state when the exact profile now exists", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  const row = harness.invitations.get(invitation.id);
  Object.assign(row, {
    status:"profile_pending",
    profile_state:"failed",
    failure_code:"profile_write_failed",
    failure_message:"Earlier profile write failed."
  });
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";

  const result = await invoke(harness, request("GET"));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.invitations[0].status, "accepted");
  assert.equal(result.payload.invitations[0].profile_state, "existing");
  assert.equal(result.payload.invitations[0].failure_code, null);
  assert.equal(harness.invitations.get(invitation.id).profile_state, "existing");
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_reconciled").length, 1);
  assert.equal(harness.inviteCalls.length, 1);
});

test("GET never accepts a stored Auth identity whose current email mismatches", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  const profileBefore = structuredClone(harness.profiles.get(INVITEE_ID));
  Object.assign(harness.authUsers.get(INVITEE_ID), {
    email:"different-person@example.com",
    email_confirmed_at:"2026-09-17T16:05:00.000Z"
  });

  const result = await invoke(harness, request("GET"));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.invitations[0].status, "reconciliation_required");
  assert.equal(result.payload.invitations[0].failure_code, "stored_auth_identity_mismatch");
  assert.equal(result.payload.invitations[0].accepted_at, null);
  assert.equal(result.payload.invitations[0].can_retry, false);
  assert.equal(result.payload.invitations[0].can_resend, false);
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_reconciled").length, 0);
  assert.equal(harness.audits.filter(item => item.event_type === "accepted_profile_conflict").length, 0);
  assert.equal(
    harness.audits.filter(item => (
      item.event_type === "reconciliation_required"
      && item.classification === "stored_auth_identity_mismatch"
    )).length,
    1
  );
  assert.deepEqual(harness.profiles.get(INVITEE_ID), profileBefore);
  assert.equal(harness.inviteCalls.length, 1);

  await invoke(harness, request("GET"));
  assert.equal(
    harness.audits.filter(item => item.classification === "stored_auth_identity_mismatch").length,
    1
  );
  assert.equal(harness.invitations.get(invitation.id).status, "reconciliation_required");
});

test("phone-only confirmation is never treated as email-invitation acceptance", async () => {
  const harness = makeHarness();
  await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).confirmed_at = "2026-09-17T16:05:00.000Z";
  const result = await invoke(harness, request("GET"));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.invitations[0].status, "sent");
  assert.equal(result.payload.invitations[0].accepted_at, null);
});

test("accepted Auth evidence records later profile role and venue conflicts without overwriting", async t => {
  for (const [label, mutate, expectedCode] of [
    ["role", profile => { profile.role = "viewer"; }, "accepted_profile_role_conflict"],
    ["venue", profile => { profile.venue_id = VENUE_B; }, "identity_unavailable"]
  ]) {
    await t.test(label, async () => {
      const harness = makeHarness();
      await successfulInvite(harness);
      mutate(harness.profiles.get(INVITEE_ID));
      harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
      const result = await invoke(harness, request("GET"));
      assert.equal(result.response.status, 200);
      assert.equal(result.payload.invitations[0].status, "failed");
      assert.equal(result.payload.invitations[0].failure_code, expectedCode);
      assert.ok(result.payload.invitations[0].accepted_at);
      assert.equal(result.payload.invitations[0].can_retry, false);
      assert.equal(result.payload.invitations[0].can_resend, false);
      assert.ok(harness.audits.some(item => item.event_type === "accepted_profile_conflict"));
    });
  }
});

test("accepted invitation with missing profile permits only profile retry", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
  harness.profiles.delete(INVITEE_ID);

  const listed = await invoke(harness, request("GET"));
  assert.equal(listed.payload.invitations[0].status, "profile_pending");
  assert.equal(listed.payload.invitations[0].can_retry, true);
  assert.equal(listed.payload.invitations[0].can_resend, false);

  const resent = await invoke(harness, request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id }));
  assert.equal(resent.response.status, 409);
  const retried = await invoke(harness, request("POST", USER_TOKEN, { action:"retry", invitation_id:invitation.id }));
  assert.equal(retried.response.status, 200);
  assert.equal(retried.payload.invitation.status, "accepted");
  assert.equal(harness.inviteCalls.length, 1);
});

test("configuration validation fails closed before every mutation", async t => {
  const validProduction = {
    enabled:true,
    environment:"production",
    redirectUrl:"https://doorflow.example/auth/",
    allowedOrigins:[ORIGIN],
    cooldownSeconds:300,
    leaseSeconds:300,
    providerTimeoutMs:30_000
  };
  const invalidCases = [
    ["missing environment", { environment:undefined }],
    ["unknown environment", { environment:"staging" }],
    ["missing cooldown", { cooldownSeconds:undefined }],
    ["missing lease", { leaseSeconds:undefined }],
    ["missing provider timeout", { providerTimeoutMs:undefined }],
    ["wildcard origin", { allowedOrigins:[ORIGIN, "https://*.example.com"] }],
    ["encoded wildcard origin", { allowedOrigins:[ORIGIN, "https://%2A.example.com"] }],
    ["trailing-dot origin", { allowedOrigins:["https://doorflow.example."], redirectUrl:"https://doorflow.example./auth/" }],
    ["redirect query", { redirectUrl:"https://doorflow.example/auth/?next=%2F" }],
    ["redirect fragment", { redirectUrl:"https://doorflow.example/auth/#invite" }],
    ["redirect credentials", { redirectUrl:"https://user:pass@doorflow.example/auth/" }],
    ["redirect wrong path", { redirectUrl:"https://doorflow.example/login/" }],
    ["production HTTP", {
      redirectUrl:"http://127.0.0.1:54321/auth/",
      allowedOrigins:[ORIGIN, "http://127.0.0.1:54321"]
    }],
    ["development non-loopback HTTP", {
      environment:"development",
      redirectUrl:"http://doorflow.test/auth/",
      allowedOrigins:[ORIGIN, "http://doorflow.test"]
    }],
    ["NaN cooldown", { cooldownSeconds:Number.NaN }],
    ["cooldown below minimum", { cooldownSeconds:59 }],
    ["cooldown above maximum", { cooldownSeconds:86_401 }],
    ["NaN lease", { leaseSeconds:Number.NaN }],
    ["lease below minimum", { leaseSeconds:29 }],
    ["lease above maximum", { leaseSeconds:601 }],
    ["NaN provider timeout", { providerTimeoutMs:Number.NaN }],
    ["provider timeout below minimum", { providerTimeoutMs:999 }],
    ["provider timeout above maximum", { providerTimeoutMs:120_001 }]
  ];

  for (const [label, overrides] of invalidCases) {
    await t.test(label, async () => {
      const harness = makeHarness();
      const handler = createStaffInvitationsHandler(harness.deps, {
        ...validProduction,
        ...overrides
      });
      const invalidConfigRequest = request("POST", USER_TOKEN, inviteBody());
      invalidConfigRequest.headers.delete("origin");
      const response = await handler(invalidConfigRequest);
      const payload = await response.json();
      assert.equal(response.status, 503);
      assert.equal(payload.error.code, "configuration_invalid");
      assert.equal(harness.inviteCalls.length, 0);
      assert.equal(harness.invitations.size, 0);
      assert.equal(harness.audits.length, 0);
    });
  }
});

test("audit repair adapter uses the deployed RPC name and argument mapping", async () => {
  const calls = [];
  const expectedResult = { decision_code:"audit_repaired", record:{ id:"fixture" } };
  const adapter = createRepairInvitationAuditRpcAdapter(async (name, args, label) => {
    calls.push({ name, args, label });
    return expectedResult;
  });
  const result = await adapter({
    invitationId:"90000000-0000-4000-8000-000000000001",
    actorUserId:ADMIN_ID,
    operationToken:"70000000-0000-4000-8000-000000000001",
    requestId:"60000000-0000-4000-8000-000000000001"
  });

  assert.equal(result, expectedResult);
  assert.deepEqual(calls, [{
    name:"doorflow_repair_staff_invitation_audit",
    args:{
      p_invitation_id:"90000000-0000-4000-8000-000000000001",
      p_actor_user_id:ADMIN_ID,
      p_repair_operation_token:"70000000-0000-4000-8000-000000000001",
      p_request_id:"60000000-0000-4000-8000-000000000001"
    },
    label:"invitation_audit_repair_failed"
  }]);
});

test("Supabase server keys are selected as one project-bound pair", () => {
  const publishable = "sb_publishable_fictionalkey12345";
  const secret = "sb_secret_fictionalkey123456789";
  const dictionaries = {
    publishableDictionary:JSON.stringify({ default:publishable }),
    secretDictionary:JSON.stringify({ default:secret }),
    selector:"default",
    projectRef:"fictionalprojectref"
  };

  assert.deepEqual(resolveSupabaseServerKeys(dictionaries), {
    publishableKey:publishable,
    secretKey:secret,
    source:"platform_dictionary"
  });
  assert.throws(() => resolveSupabaseServerKeys({
    ...dictionaries,
    secretDictionary:JSON.stringify({ privileged:secret })
  }), /both dictionaries/);
  assert.throws(() => resolveSupabaseServerKeys({
    ...dictionaries,
    publishableDictionary:`{"default":"${publishable}","de\\u0066ault":"${publishable}"}`
  }), /Invalid platform key dictionary/);
  assert.throws(() => resolveSupabaseServerKeys({
    ...dictionaries,
    secretDictionary:""
  }), /Incomplete platform key dictionaries/);
  assert.throws(() => resolveSupabaseServerKeys({
    ...dictionaries,
    publishableDictionary:JSON.stringify({ default:{ key:publishable } })
  }), /Invalid platform key dictionary/);

  assert.deepEqual(resolveSupabaseServerKeys({
    directPublishable:publishable,
    directSecret:secret,
    directProjectRef:"fictionalprojectref",
    projectRef:"fictionalprojectref"
  }), {
    publishableKey:publishable,
    secretKey:secret,
    source:"doorflow_direct"
  });
  assert.throws(() => resolveSupabaseServerKeys({
    directPublishable:publishable,
    directSecret:secret,
    directProjectRef:"anotherproject",
    projectRef:"fictionalprojectref"
  }), /mismatched direct Supabase key configuration/);
  assert.throws(() => resolveSupabaseServerKeys({
    legacyPublishable:"header.payload.signature",
    legacySecret:"header.payload.signature"
  }), /Missing required server key configuration/);
  const legacyBase = {
    legacyPublishable:fictionalLegacyJwt("anon"),
    legacySecret:fictionalLegacyJwt("service_role"),
    projectRef:"fictionalprojectref",
    nowSeconds:1_900_000_000,
    allowLegacy:true
  };
  assert.deepEqual(resolveSupabaseServerKeys(legacyBase), {
    publishableKey:legacyBase.legacyPublishable,
    secretKey:legacyBase.legacySecret,
    source:"legacy_platform"
  });
  for (const invalid of [
    { legacyPublishable:fictionalLegacyJwt("service_role") },
    { legacySecret:fictionalLegacyJwt("anon") },
    { legacyPublishable:fictionalLegacyJwt("anon", "anotherproject") },
    { legacySecret:fictionalLegacyJwt("service_role", "anotherproject") },
    { legacyPublishable:fictionalLegacyJwt("anon", "fictionalprojectref", { header:{ alg:"none" } }) },
    { legacySecret:fictionalLegacyJwt("service_role", "fictionalprojectref", { payload:{ exp:1_800_000_000 } }) },
    { legacySecret:"not.a.valid-jwt" }
  ]) {
    assert.throws(() => resolveSupabaseServerKeys({ ...legacyBase, ...invalid }), /Invalid legacy Supabase key configuration/);
  }
});

test("Supabase project URL, environment, and project ref are one fail-closed configuration", () => {
  assert.deepEqual(validateSupabaseProjectConfiguration({
    environment:"production",
    supabaseUrl:"https://fictionalprojectref.supabase.co",
    projectRef:"fictionalprojectref"
  }), {
    environment:"production",
    supabaseUrl:"https://fictionalprojectref.supabase.co",
    projectRef:"fictionalprojectref"
  });
  assert.deepEqual(validateSupabaseProjectConfiguration({
    environment:"development",
    supabaseUrl:"http://127.0.0.1:54321",
    projectRef:"local"
  }), {
    environment:"development",
    supabaseUrl:"http://127.0.0.1:54321",
    projectRef:"local"
  });

  for (const config of [
    { environment:"development", supabaseUrl:"https://fictionalprojectref.supabase.co", projectRef:"fictionalprojectref" },
    { environment:"development", supabaseUrl:"https://localhost:54321", projectRef:"local" },
    { environment:"development", supabaseUrl:"http://localhost.evil:54321", projectRef:"local" },
    { environment:"development", supabaseUrl:"http://127.1:54321", projectRef:"local" },
    { environment:"production", supabaseUrl:"https://otherproject.supabase.co", projectRef:"fictionalprojectref" },
    { environment:"production", supabaseUrl:"https://fictionalprojectref.supabase.co:444", projectRef:"fictionalprojectref" },
    { environment:"production", supabaseUrl:"https://fictionalprojectref.supabase.co.evil", projectRef:"fictionalprojectref" },
    { environment:"production", supabaseUrl:"https://*.supabase.co", projectRef:"fictionalprojectref" },
    { environment:"production", supabaseUrl:"https://fictionalprojectref.supabase.co.", projectRef:"fictionalprojectref" }
  ]) {
    assert.throws(() => validateSupabaseProjectConfiguration(config));
  }
});

test("valid production HTTPS and explicit development loopback controls remain usable", async t => {
  await t.test("production HTTPS", async () => {
    const harness = makeHarness();
    const handler = createStaffInvitationsHandler(harness.deps, {
      enabled:true,
      environment:"production",
      redirectUrl:"https://doorflow.example/auth/",
      allowedOrigins:[ORIGIN],
      cooldownSeconds:300,
      leaseSeconds:300,
      providerTimeoutMs:30_000
    });
    const response = await handler(request("POST", USER_TOKEN, inviteBody()));
    assert.equal(response.status, 201);
    assert.equal(harness.inviteCalls.length, 1);
  });

  await t.test("development HTTP loopback", async () => {
    const loopbackOrigin = "http://127.0.0.1:54321";
    const harness = makeHarness();
    const handler = createStaffInvitationsHandler(harness.deps, {
      enabled:true,
      environment:"development",
      redirectUrl:`${loopbackOrigin}/auth/`,
      allowedOrigins:[loopbackOrigin],
      cooldownSeconds:300,
      leaseSeconds:300,
      providerTimeoutMs:30_000
    });
    const response = await handler(request("POST", USER_TOKEN, inviteBody(), {
      headers:{ origin:loopbackOrigin }
    }));
    assert.equal(response.status, 201);
    assert.equal(harness.inviteCalls.length, 1);
    assert.equal(harness.inviteCalls[0].options.redirectTo, `${loopbackOrigin}/auth/`);
  });
});

test("disabled backend and disallowed Origin fail closed before privileged work", async t => {
  await t.test("disabled", async () => {
    const harness = makeHarness({ enabled:false });
    const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
    assert.equal(result.response.status, 503);
    assert.equal(result.payload.error.code, "provisioning_disabled");
    assert.equal(harness.inviteCalls.length, 0);
  });
  await t.test("origin", async () => {
    const harness = makeHarness();
    const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody(), { headers:{ origin:"https://evil.example" } }));
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.error.code, "origin_not_allowed");
    assert.equal(harness.inviteCalls.length, 0);
  });
});

test("errors and safe logs contain no credentials or provider internals", async () => {
  const harness = makeHarness({
    inviteFailure:() => true,
    inviteFailureValue:Object.assign(new Error("network access_token=secret refresh_token=secret"), { status:503 })
  });
  const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  const serialized = JSON.stringify(result.payload);
  assert.doesNotMatch(serialized, /access_token|refresh_token|secret|stack/i);
  assert.deepEqual(Object.keys(harness.safeLogs.at(-1)).sort(), ["code", "request_id", "status"]);
});

test("a stale worker cannot finalize after a newer lease claim", async () => {
  const harness = makeHarness();
  const reservation = await harness.deps.reserveInvitation({
    invited_by_user_id:ADMIN_ID,
    last_actor_user_id:ADMIN_ID,
    venue_id:VENUE_A,
    email:"lease@example.com",
    normalized_email:"lease@example.com",
    full_name:"Lease Test",
    requested_role:"door",
    status:"reserved",
    send_state:"not_attempted",
    profile_state:"pending",
    idempotency_key:IDEMPOTENCY_A,
    request_fingerprint:"fingerprint"
  });
  const first = await harness.deps.claimInvitation(reservation.record.id, ADMIN_ID, "2026-09-17T15:55:00.000Z");
  harness.advance(301);
  const second = await harness.deps.claimInvitation(reservation.record.id, OTHER_ADMIN_ID, "2026-09-17T16:00:01.000Z");
  assert.notEqual(first.processing_started_at, second.processing_started_at);
  await assert.rejects(
    harness.deps.updateInvitation(first.id, { status:"sent" }, first.processing_started_at),
    error => error.code === "invitation_lease_lost"
  );
});

test("concurrent resend claims recheck the authoritative cooldown after a delayed second claim", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  harness.advance(301);

  const originalGetInvitationById = harness.deps.getInvitationById;
  const bothSnapshotsRead = deferred();
  const releaseSnapshots = deferred();
  let snapshotReads = 0;
  harness.deps.getInvitationById = async id => {
    const snapshot = await originalGetInvitationById(id);
    snapshotReads += 1;
    if (snapshotReads === 2) bothSnapshotsRead.resolve();
    await releaseSnapshots.promise;
    return snapshot;
  };

  const originalClaimInvitation = harness.deps.claimInvitation;
  const secondClaimReached = deferred();
  const releaseSecondClaim = deferred();
  let claimCalls = 0;
  harness.deps.claimInvitation = async (...args) => {
    claimCalls += 1;
    if (claimCalls === 2) {
      secondClaimReached.resolve();
      await releaseSecondClaim.promise;
    }
    return await originalClaimInvitation(...args);
  };

  const firstPromise = invoke(
    harness,
    request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id })
  );
  const secondPromise = invoke(
    harness,
    request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id })
  );

  await bothSnapshotsRead.promise;
  releaseSnapshots.resolve();
  await secondClaimReached.promise;
  const firstCompleted = await Promise.race([firstPromise, secondPromise]);
  assert.equal(firstCompleted.response.status, 200);
  const committedAfterFirst = structuredClone(harness.invitations.get(invitation.id));

  harness.advance(1);
  releaseSecondClaim.resolve();
  const results = await Promise.all([firstPromise, secondPromise]);
  const finalRow = harness.invitations.get(invitation.id);
  const responseClassifications = results
    .map(result => `${result.response.status}:${result.payload.error?.code || "ok"}`)
    .sort();

  assert.deepEqual({
    responseClassifications,
    providerCallCount:harness.inviteCalls.length,
    committedStatus:finalRow.status,
    committedAuthUserId:finalRow.auth_user_id,
    committedAttemptCount:finalRow.attempt_count,
    lastSentAtUnchanged:finalRow.last_sent_at === committedAfterFirst.last_sent_at,
    profileIdentity:harness.profiles.get(INVITEE_ID)?.id || null,
    resendAuditCount:harness.audits.filter(entry => entry.event_type === "invitation_resent").length
  }, {
    responseClassifications:["200:ok", "429:resend_cooldown"],
    providerCallCount:2,
    committedStatus:"sent",
    committedAuthUserId:INVITEE_ID,
    committedAttemptCount:2,
    lastSentAtUnchanged:true,
    profileIdentity:INVITEE_ID,
    resendAuditCount:1
  });
});

test("a worker that loses its processing lease before dispatch cannot call the provider", async () => {
  const harness = makeHarness();
  const originalLookupAuthUserByEmail = harness.deps.lookupAuthUserByEmail;
  const firstLookupCaptured = deferred();
  const releaseFirstLookup = deferred();
  let lookupCalls = 0;
  harness.deps.lookupAuthUserByEmail = async email => {
    const snapshot = await originalLookupAuthUserByEmail(email);
    lookupCalls += 1;
    if (lookupCalls === 1) {
      firstLookupCaptured.resolve();
      await releaseFirstLookup.promise;
    }
    return snapshot;
  };
  const originalInviteUserByEmail = harness.deps.inviteUserByEmail;
  const dispatchLeaseSnapshots = [];
  harness.deps.inviteUserByEmail = async (...args) => {
    const current = [...harness.invitations.values()][0];
    dispatchLeaseSnapshots.push(current?.processing_started_at || null);
    return await originalInviteUserByEmail(...args);
  };

  const firstPromise = invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  await firstLookupCaptured.promise;
  const invitation = [...harness.invitations.values()][0];
  const lostLease = invitation.processing_started_at;

  harness.advance(301);
  const replacement = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  assert.equal(replacement.response.status, 200);
  assert.notEqual(harness.invitations.get(invitation.id).last_attempt_at, lostLease);
  assert.equal(harness.inviteCalls.length, 1);

  releaseFirstLookup.resolve();
  const staleWorker = await firstPromise;
  const finalRow = harness.invitations.get(invitation.id);

  assert.deepEqual({
    staleWorkerClassification:`${staleWorker.response.status}:${staleWorker.payload.error?.code || "ok"}`,
    providerCallCount:harness.inviteCalls.length,
    dispatchLeaseSnapshots,
    committedStatus:finalRow.status,
    committedAuthUserId:finalRow.auth_user_id,
    profileIdentity:harness.profiles.get(INVITEE_ID)?.id || null,
    providerAcceptedAuditCount:harness.audits.filter(entry => entry.event_type === "provider_accepted").length
  }, {
    staleWorkerClassification:"409:operation_lost",
    providerCallCount:1,
    dispatchLeaseSnapshots:[harness.invitations.get(invitation.id).last_attempt_at],
    committedStatus:"sent",
    committedAuthUserId:INVITEE_ID,
    profileIdentity:INVITEE_ID,
    providerAcceptedAuditCount:1
  });
});

test("resend provider identity mismatch preserves the original Auth identity", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  const originalIdentity = harness.invitations.get(invitation.id).auth_user_id;
  const originalProfile = structuredClone(harness.profiles.get(originalIdentity));
  const originalLastSentAt = harness.invitations.get(invitation.id).last_sent_at;
  harness.advance(301);

  harness.deps.inviteUserByEmail = async (email, invitationOptions) => {
    harness.inviteCalls.push({ email, options:structuredClone(invitationOptions) });
    return {
      id:UNEXPECTED_INVITEE_ID,
      email,
      invited_at:"2026-09-17T16:05:01.000Z",
      email_confirmed_at:null
    };
  };

  const result = await invoke(
    harness,
    request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id })
  );
  const finalRow = harness.invitations.get(invitation.id);

  assert.deepEqual({
    responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
    providerCallCount:harness.inviteCalls.length,
    committedStatus:finalRow.status,
    committedSendState:finalRow.send_state,
    committedFailureCode:finalRow.failure_code,
    committedAuthUserId:finalRow.auth_user_id,
    previousSendEvidencePreserved:finalRow.last_sent_at === originalLastSentAt,
    originalProfilePreserved:JSON.stringify(harness.profiles.get(originalIdentity)) === JSON.stringify(originalProfile),
    unexpectedProfileExists:harness.profiles.has(UNEXPECTED_INVITEE_ID),
    providerAcceptedAuditCount:harness.audits.filter(entry => entry.event_type === "provider_accepted").length,
    mismatchAuditCount:harness.audits.filter(entry => entry.classification === "resend_identity_mismatch").length
  }, {
    responseClassification:"502:resend_identity_mismatch",
    providerCallCount:2,
    committedStatus:"reconciliation_required",
    committedSendState:"provider_accepted",
    committedFailureCode:"resend_identity_mismatch",
    committedAuthUserId:originalIdentity,
    previousSendEvidencePreserved:true,
    originalProfilePreserved:true,
    unexpectedProfileExists:false,
    providerAcceptedAuditCount:1,
    mismatchAuditCount:1
  });
});

test("profile creation followed by audit failure preserves an explicit repair condition", async () => {
  let profileAuditFailures = 1;
  const harness = makeHarness({
    auditFailure:entry => entry.event_type === "profile_created" && profileAuditFailures-- > 0
  });
  // Exercise the supported fallback adapter directly: the primary transactional
  // finalizer rolls profile creation back with its audit, while this path covers
  // the reported case where the profile has already committed independently.
  harness.deps.finalizeInvitationProfile = undefined;

  const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  const invitation = [...harness.invitations.values()][0];

  assert.deepEqual({
    responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
    providerCallCount:harness.inviteCalls.length,
    committedStatus:invitation.status,
    committedSendState:invitation.send_state,
    committedProfileState:invitation.profile_state,
    committedAuthUserId:invitation.auth_user_id,
    profileIdentity:harness.profiles.get(INVITEE_ID)?.id || null,
    pendingAuditEventType:invitation.pending_audit_event_type,
    pendingAuditClassification:invitation.pending_audit_classification,
    profileCreatedAuditAttempts:harness.auditCalls.filter(entry => entry.event_type === "profile_created").length,
    profileCreatedAuditCount:harness.audits.filter(entry => entry.event_type === "profile_created").length,
    provisioningCompletedAuditCount:harness.audits.filter(entry => entry.event_type === "provisioning_completed").length
  }, {
    responseClassification:"502:profile_audit_pending",
    providerCallCount:1,
    committedStatus:"profile_pending",
    committedSendState:"provider_accepted",
    committedProfileState:"created",
    committedAuthUserId:INVITEE_ID,
    profileIdentity:INVITEE_ID,
    pendingAuditEventType:"profile_created",
    pendingAuditClassification:"created",
    profileCreatedAuditAttempts:1,
    profileCreatedAuditCount:0,
    provisioningCompletedAuditCount:0
  });
});

test("Admin authorization is rechecked after reservation before privileged dispatch", async t => {
  const scenarios = [
    ["deactivated", profile => { profile.active = false; }],
    ["demoted", profile => { profile.role = "manager"; }],
    ["reassigned", profile => { profile.venue_id = VENUE_B; }]
  ];

  for (const [label, revoke] of scenarios) {
    await t.test(label, async () => {
      const harness = makeHarness();
      const originalGetStaffProfile = harness.deps.getStaffProfile;
      harness.deps.getStaffProfile = async userId => {
        const profile = await originalGetStaffProfile(userId);
        return profile ? { ...profile } : null;
      };

      const originalReserveInvitation = harness.deps.reserveInvitation;
      const reservationCommitted = deferred();
      const releaseReservation = deferred();
      harness.deps.reserveInvitation = async record => {
        const reservation = await originalReserveInvitation(record);
        reservationCommitted.resolve();
        await releaseReservation.promise;
        return reservation;
      };

      const pending = invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      await reservationCommitted.promise;
      revoke(harness.profiles.get(ADMIN_ID));
      releaseReservation.resolve();
      const result = await pending;
      const invitation = [...harness.invitations.values()][0];

      assert.deepEqual({
        responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        providerCallCount:harness.inviteCalls.length,
        authDirectorySize:harness.authUsers.size,
        inviteeProfileExists:harness.profiles.has(INVITEE_ID),
        committedStatus:invitation.status,
        committedVenueId:invitation.venue_id,
        committedRole:invitation.requested_role,
        committedAuthUserId:invitation.auth_user_id,
        committedSendState:invitation.send_state,
        committedAttemptCount:invitation.attempt_count,
        privilegedAuditCount:harness.audits.filter(entry => [
          "attempt_started",
          "provider_accepted",
          "profile_created",
          "provisioning_completed"
        ].includes(entry.event_type)).length
      }, {
        responseClassification:"403:forbidden",
        providerCallCount:0,
        authDirectorySize:0,
        inviteeProfileExists:false,
        committedStatus:"reserved",
        committedVenueId:VENUE_A,
        committedRole:"door",
        committedAuthUserId:null,
        committedSendState:"not_attempted",
        committedAttemptCount:0,
        privilegedAuditCount:0
      });
    });
  }
});

test("streamed JSON over 16 KiB is rejected without relying on Content-Length", async () => {
  const harness = makeHarness();
  const encoded = new TextEncoder().encode(`${JSON.stringify(inviteBody())}${" ".repeat(17000)}`);
  const splitAt = 8192;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded.slice(0, splitAt));
      controller.enqueue(encoded.slice(splitAt));
      controller.close();
    }
  });
  const headers = new Headers({
    origin:ORIGIN,
    authorization:`Bearer ${USER_TOKEN}`,
    "content-type":"application/json"
  });
  const oversizedRequest = new Request(
    "https://project.supabase.co/functions/v1/staff-invitations",
    { method:"POST", headers, body, duplex:"half" }
  );
  assert.equal(oversizedRequest.headers.get("content-length"), null);
  assert.ok(encoded.byteLength > 16384);

  const result = await invoke(harness, oversizedRequest);

  assert.deepEqual({
    responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
    providerCallCount:harness.inviteCalls.length,
    invitationCount:harness.invitations.size,
    inviteeProfileExists:harness.profiles.has(INVITEE_ID),
    auditCount:harness.audits.length,
    safeLogCode:harness.safeLogs.at(-1)?.code || null
  }, {
    responseClassification:"413:request_too_large",
    providerCallCount:0,
    invitationCount:0,
    inviteeProfileExists:false,
    auditCount:0,
    safeLogCode:"request_too_large"
  });
});

test("same invitation request replay is idempotent before, during, and after completion", async t => {
  await t.test("before processing", async () => {
    const harness = makeHarness();
    await seedReservedInvitation(harness);

    const first = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
    const after = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));

    assert.deepEqual({
      firstClassification:`${first.response.status}:${first.payload.error?.code || "ok"}`,
      afterClassification:`${after.response.status}:${after.payload.error?.code || "ok"}`,
      invitationCount:harness.invitations.size,
      providerCallCount:harness.inviteCalls.length,
      committedStatus:[...harness.invitations.values()][0].status,
      committedAuthUserId:[...harness.invitations.values()][0].auth_user_id,
      profileIdentity:harness.profiles.get(INVITEE_ID)?.id || null
    }, {
      firstClassification:"200:ok",
      afterClassification:"200:ok",
      invitationCount:1,
      providerCallCount:1,
      committedStatus:"sent",
      committedAuthUserId:INVITEE_ID,
      profileIdentity:INVITEE_ID
    });
  });

  await t.test("during and after provider completion", async () => {
    const harness = makeHarness();
    const originalInviteUserByEmail = harness.deps.inviteUserByEmail;
    const providerEntered = deferred();
    const releaseProvider = deferred();
    let dispatchEntries = 0;
    harness.deps.inviteUserByEmail = async (...args) => {
      dispatchEntries += 1;
      if (dispatchEntries === 1) {
        providerEntered.resolve();
        await releaseProvider.promise;
      }
      return await originalInviteUserByEmail(...args);
    };

    const firstPromise = invoke(harness, request("POST", USER_TOKEN, inviteBody()));
    await providerEntered.promise;
    const during = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
    assert.ok([202, 409].includes(during.response.status));
    assert.equal(dispatchEntries, 1);

    releaseProvider.resolve();
    const first = await firstPromise;
    const after = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));

    assert.deepEqual({
      firstClassification:`${first.response.status}:${first.payload.error?.code || "ok"}`,
      duringClassification:`${during.response.status}:${during.payload.error?.code || "ok"}`,
      afterClassification:`${after.response.status}:${after.payload.error?.code || "ok"}`,
      providerDispatchCount:dispatchEntries,
      providerCallCount:harness.inviteCalls.length,
      invitationCount:harness.invitations.size,
      profileIdentity:harness.profiles.get(INVITEE_ID)?.id || null
    }, {
      firstClassification:"201:ok",
      duringClassification:"202:ok",
      afterClassification:"200:ok",
      providerDispatchCount:1,
      providerCallCount:1,
      invitationCount:1,
      profileIdentity:INVITEE_ID
    });
  });
});

test("SQL operation_replay resumes only safe work and never duplicates provider dispatch", async t => {
  const replayRequestId = "88888888-8888-4888-8888-888888888888";
  const replayOperationToken = "77777777-7777-4777-8777-777777777777";
  const claimedAt = "2026-09-17T16:00:00.000Z";
  const leaseExpiresAt = "2026-09-17T16:05:00.000Z";

  async function replayFixture(stage) {
    const harness = makeHarness();
    const reservation = await seedReservedInvitation(harness);
    const row = harness.invitations.get(reservation.record.id);
    const staleEligibleSnapshot = structuredClone(row);
    const providerAccepted = ["provider_accepted", "completed"].includes(stage);
    const completed = stage === "completed";

    Object.assign(row, {
      status:completed ? "sent" : (providerAccepted ? "profile_pending" : "processing"),
      send_state:providerAccepted ? "provider_accepted" : "not_attempted",
      profile_state:completed ? "created" : "pending",
      auth_user_id:providerAccepted ? INVITEE_ID : null,
      attempt_count:1,
      last_attempt_at:claimedAt,
      last_provider_attempt_at:stage === "dispatch_authorized" || providerAccepted ? claimedAt : null,
      last_sent_at:providerAccepted ? claimedAt : null,
      processing_started_at:completed ? null : claimedAt,
      lease_expires_at:completed ? null : leaseExpiresAt,
      operation_token:replayOperationToken,
      operation_state:stage,
      operation_action:"retry",
      operation_actor_user_id:ADMIN_ID,
      operation_request_id:replayRequestId,
      operation_requires_provider_dispatch:true,
      operation_completed_at:completed ? claimedAt : null,
      dispatch_authorized_at:stage === "dispatch_authorized" || providerAccepted ? claimedAt : null,
      updated_at:claimedAt
    });
    if (providerAccepted) {
      harness.authUsers.set(INVITEE_ID, {
        id:INVITEE_ID,
        email:row.email,
        invited_at:claimedAt,
        email_confirmed_at:null
      });
    }
    if (completed) {
      harness.profiles.set(INVITEE_ID, {
        id:INVITEE_ID,
        full_name:row.full_name,
        role:row.requested_role,
        active:true,
        venue_id:row.venue_id,
        created_at:claimedAt
      });
    }
    harness.operationAttempts.set(replayOperationToken, {
      invitationId:row.id,
      actorUserId:ADMIN_ID,
      action:"retry",
      requestId:replayRequestId,
      state:stage,
      requiresProviderDispatch:true,
      leaseExpiresAt
    });

    harness.deps.randomUUID = () => replayRequestId;
    harness.deps.operationUUID = () => replayOperationToken;
    harness.deps.claimIncludesAudit = true;
    const getInvitationById = harness.deps.getInvitationById;
    let servedStaleSnapshot = false;
    harness.deps.getInvitationById = async id => {
      if (!servedStaleSnapshot && id === row.id) {
        servedStaleSnapshot = true;
        return structuredClone(staleEligibleSnapshot);
      }
      return await getInvitationById(id);
    };
    const claimInvitation = harness.deps.claimInvitation;
    const claimResults = [];
    harness.deps.claimInvitation = async input => {
      const result = await claimInvitation(input);
      claimResults.push(structuredClone(result));
      return result;
    };

    return { harness, row, claimResults };
  }

  function assertReplayFixture(result, stage) {
    assert.deepEqual(Object.keys(result).sort(), [
      "decision_code",
      "record",
      "requires_provider_dispatch",
      "retry_after_seconds"
    ]);
    assert.equal(result.decision_code, "operation_replay");
    assert.equal(result.retry_after_seconds, 300);
    assert.equal(result.requires_provider_dispatch, true);
    assert.equal(result.record.operation_token, replayOperationToken);
    assert.equal(result.record.operation_request_id, replayRequestId);
    assert.equal(result.record.operation_actor_user_id, ADMIN_ID);
    assert.equal(result.record.operation_action, "retry");
    assert.equal(result.record.operation_state, stage);
  }

  await t.test("claimed replay continues once", async () => {
    const { harness, row, claimResults } = await replayFixture("claimed");
    const result = await invoke(
      harness,
      request("POST", USER_TOKEN, { action:"retry", invitation_id:row.id })
    );

    assertReplayFixture(claimResults[0], "claimed");
    assert.deepEqual({
      responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
      providerCallCount:harness.inviteCalls.length,
      attemptCount:harness.invitations.get(row.id).attempt_count,
      committedStatus:harness.invitations.get(row.id).status,
      committedOperationState:harness.invitations.get(row.id).operation_state,
      profileIdentity:harness.profiles.get(INVITEE_ID)?.id || null
    }, {
      responseClassification:"200:ok",
      providerCallCount:1,
      attemptCount:1,
      committedStatus:"sent",
      committedOperationState:"completed",
      profileIdentity:INVITEE_ID
    });
  });

  await t.test("dispatch-authorized replay preserves uncertainty without another provider call", async () => {
    const { harness, row, claimResults } = await replayFixture("dispatch_authorized");
    const result = await invoke(
      harness,
      request("POST", USER_TOKEN, { action:"retry", invitation_id:row.id })
    );

    assertReplayFixture(claimResults[0], "dispatch_authorized");
    assert.deepEqual({
      responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
      providerCallCount:harness.inviteCalls.length,
      outcomeRecordCount:harness.providerOutcomeCalls.length,
      committedOperationState:harness.invitations.get(row.id).operation_state,
      committedSendState:harness.invitations.get(row.id).send_state
    }, {
      responseClassification:"409:provider_outcome_unknown",
      providerCallCount:0,
      outcomeRecordCount:0,
      committedOperationState:"dispatch_authorized",
      committedSendState:"not_attempted"
    });
  });

  await t.test("provider-accepted replay performs profile-only completion", async () => {
    const { harness, row, claimResults } = await replayFixture("provider_accepted");
    const result = await invoke(
      harness,
      request("POST", USER_TOKEN, { action:"retry", invitation_id:row.id })
    );

    assertReplayFixture(claimResults[0], "provider_accepted");
    assert.deepEqual({
      responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
      providerCallCount:harness.inviteCalls.length,
      profileFinalizationCount:harness.profileFinalizationCalls.length,
      committedStatus:harness.invitations.get(row.id).status,
      committedOperationState:harness.invitations.get(row.id).operation_state,
      profileIdentity:harness.profiles.get(INVITEE_ID)?.id || null
    }, {
      responseClassification:"200:ok",
      providerCallCount:0,
      profileFinalizationCount:1,
      committedStatus:"sent",
      committedOperationState:"completed",
      profileIdentity:INVITEE_ID
    });
  });

  await t.test("completed replay returns the committed state idempotently", async () => {
    const { harness, row, claimResults } = await replayFixture("completed");
    const before = structuredClone(harness.invitations.get(row.id));
    const result = await invoke(
      harness,
      request("POST", USER_TOKEN, { action:"retry", invitation_id:row.id })
    );

    assertReplayFixture(claimResults[0], "completed");
    assert.deepEqual({
      responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
      providerCallCount:harness.inviteCalls.length,
      dispatchAuthorizationCount:harness.dispatchAuthorizationCalls.length,
      outcomeRecordCount:harness.providerOutcomeCalls.length,
      profileFinalizationCount:harness.profileFinalizationCalls.length,
      auditWriteCount:harness.auditCalls.length,
      committedStateUnchanged:JSON.stringify(harness.invitations.get(row.id)) === JSON.stringify(before)
    }, {
      responseClassification:"200:ok",
      providerCallCount:0,
      dispatchAuthorizationCount:0,
      outcomeRecordCount:0,
      profileFinalizationCount:0,
      auditWriteCount:0,
      committedStateUnchanged:true
    });
  });
});

test("same idempotency key with a different payload never changes the intended invitation", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  const before = structuredClone(harness.invitations.get(invitation.id));

  const conflict = await invoke(harness, request("POST", USER_TOKEN, inviteBody({
    full_name:"Different Person",
    email:"different.person@example.com",
    role:"admin"
  })));
  const after = harness.invitations.get(invitation.id);

  assert.deepEqual({
    responseClassification:`${conflict.response.status}:${conflict.payload.error?.code || "ok"}`,
    providerCallCount:harness.inviteCalls.length,
    invitationCount:harness.invitations.size,
    committedEmail:after.normalized_email,
    committedName:after.full_name,
    committedRole:after.requested_role,
    committedVenue:after.venue_id,
    committedAuthUserId:after.auth_user_id,
    identityUnchanged:after.normalized_email === before.normalized_email
      && after.full_name === before.full_name
      && after.requested_role === before.requested_role
      && after.venue_id === before.venue_id
      && after.auth_user_id === before.auth_user_id
  }, {
    responseClassification:"409:idempotency_conflict",
    providerCallCount:1,
    invitationCount:1,
    committedEmail:"alex.employee@example.com",
    committedName:"Alex Employee",
    committedRole:"door",
    committedVenue:VENUE_A,
    committedAuthUserId:INVITEE_ID,
    identityUnchanged:true
  });
});

test("concurrent normalized-email requests from different Admins cannot duplicate or disclose cross-venue work", async t => {
  await t.test("same venue", async () => {
    const harness = makeHarness({ otherActorVenue:VENUE_A });
    const originalInviteUserByEmail = harness.deps.inviteUserByEmail;
    const providerEntered = deferred();
    const releaseProvider = deferred();
    let providerEntries = 0;
    harness.deps.inviteUserByEmail = async (...args) => {
      providerEntries += 1;
      if (providerEntries === 1) {
        providerEntered.resolve();
        await releaseProvider.promise;
      }
      return await originalInviteUserByEmail(...args);
    };

    const firstPromise = invoke(harness, request("POST", USER_TOKEN, inviteBody()));
    await providerEntered.promise;
    const second = await invoke(harness, request("POST", OTHER_TOKEN, inviteBody({
      email:"alex.employee@EXAMPLE.com",
      idempotency_key:IDEMPOTENCY_B
    })));
    releaseProvider.resolve();
    const first = await firstPromise;

    assert.deepEqual({
      firstClassification:`${first.response.status}:${first.payload.error?.code || "ok"}`,
      secondClassification:`${second.response.status}:${second.payload.error?.code || "ok"}`,
      providerEntryCount:providerEntries,
      providerCallCount:harness.inviteCalls.length,
      invitationCount:harness.invitations.size,
      profileIdentity:harness.profiles.get(INVITEE_ID)?.id || null
    }, {
      firstClassification:"201:ok",
      secondClassification:"409:invitation_exists",
      providerEntryCount:1,
      providerCallCount:1,
      invitationCount:1,
      profileIdentity:INVITEE_ID
    });
  });

  await t.test("cross venue", async () => {
    const harness = makeHarness();
    const originalInviteUserByEmail = harness.deps.inviteUserByEmail;
    const providerEntered = deferred();
    const releaseProvider = deferred();
    let providerEntries = 0;
    harness.deps.inviteUserByEmail = async (...args) => {
      providerEntries += 1;
      if (providerEntries === 1) {
        providerEntered.resolve();
        await releaseProvider.promise;
      }
      return await originalInviteUserByEmail(...args);
    };

    const firstPromise = invoke(harness, request("POST", USER_TOKEN, inviteBody()));
    await providerEntered.promise;
    const second = await invoke(harness, request("POST", OTHER_TOKEN, inviteBody({
      email:"alex.employee@EXAMPLE.com",
      idempotency_key:IDEMPOTENCY_B
    })));
    const serializedSecond = JSON.stringify(second.payload);
    releaseProvider.resolve();
    const first = await firstPromise;
    const venueBInvitation = [...harness.invitations.values()].find(row => row.venue_id === VENUE_B);

    assert.deepEqual({
      firstClassification:`${first.response.status}:${first.payload.error?.code || "ok"}`,
      secondClassification:`${second.response.status}:${second.payload.error?.code || "ok"}`,
      providerEntryCount:providerEntries,
      providerCallCount:harness.inviteCalls.length,
      invitationCount:harness.invitations.size,
      leakedVenueA:serializedSecond.includes(VENUE_A),
      leakedAdminId:serializedSecond.includes(ADMIN_ID),
      leakedOtherInvitationId:serializedSecond.includes(first.payload.invitation?.id || "not-present"),
      venueBAuthUserId:venueBInvitation?.auth_user_id || null,
      venueBSendState:venueBInvitation?.send_state || null
    }, {
      firstClassification:"201:ok",
      secondClassification:"409:identity_unavailable",
      providerEntryCount:1,
      providerCallCount:1,
      invitationCount:1,
      leakedVenueA:false,
      leakedAdminId:false,
      leakedOtherInvitationId:false,
      venueBAuthUserId:null,
      venueBSendState:null
    });
  });
});

test("an in-flight provider call remains unresolved and cannot authorize a replacement dispatch", async () => {
  const harness = makeHarness();
  const originalInviteUserByEmail = harness.deps.inviteUserByEmail;
  const providerEntered = deferred();
  const releaseProvider = deferred();
  let providerEntries = 0;
  harness.deps.inviteUserByEmail = async (...args) => {
    providerEntries += 1;
    if (providerEntries === 1) {
      providerEntered.resolve();
      await releaseProvider.promise;
    }
    return await originalInviteUserByEmail(...args);
  };

  const firstPromise = invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  await providerEntered.promise;
  const invitation = [...harness.invitations.values()][0];
  assert.equal(invitation.operation_state, "dispatch_authorized");

  harness.advance(301);
  const replay = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  assert.deepEqual({
    replayClassification:`${replay.response.status}:${replay.payload.error?.code || "ok"}`,
    providerEntryCount:providerEntries,
    providerCallCount:harness.inviteCalls.length,
    operationState:harness.invitations.get(invitation.id).operation_state,
    committedAuthUserId:harness.invitations.get(invitation.id).auth_user_id
  }, {
    replayClassification:"409:provider_outcome_unknown",
    providerEntryCount:1,
    providerCallCount:0,
    operationState:"dispatch_authorized",
    committedAuthUserId:null
  });

  releaseProvider.resolve();
  const first = await firstPromise;
  assert.equal(first.response.status, 201);
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(harness.invitations.get(invitation.id).status, "sent");
  assert.equal(harness.profiles.get(INVITEE_ID).id, INVITEE_ID);
});

test("provider success interrupted before outcome persistence cannot become permission to resend", async () => {
  const harness = makeHarness();
  const originalRecordOutcome = harness.deps.recordInvitationProviderOutcome;
  const outcomeReached = deferred();
  const releaseOutcome = deferred();
  let acceptedOutcomes = 0;
  harness.deps.recordInvitationProviderOutcome = async input => {
    if (input.outcome === "accepted") {
      acceptedOutcomes += 1;
      if (acceptedOutcomes === 1) {
        outcomeReached.resolve();
        await releaseOutcome.promise;
      }
    }
    return await originalRecordOutcome(input);
  };

  const firstPromise = invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  await outcomeReached.promise;
  const invitation = [...harness.invitations.values()][0];
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(invitation.operation_state, "dispatch_authorized");
  assert.equal(invitation.auth_user_id, null);

  harness.advance(301);
  const replay = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  assert.deepEqual({
    replayClassification:`${replay.response.status}:${replay.payload.error?.code || "ok"}`,
    providerCallCount:harness.inviteCalls.length,
    acceptedOutcomeAttempts:acceptedOutcomes,
    operationState:harness.invitations.get(invitation.id).operation_state,
    committedAuthUserId:harness.invitations.get(invitation.id).auth_user_id,
    profileExists:harness.profiles.has(INVITEE_ID)
  }, {
    replayClassification:"409:provider_outcome_unknown",
    providerCallCount:1,
    acceptedOutcomeAttempts:1,
    operationState:"dispatch_authorized",
    committedAuthUserId:null,
    profileExists:false
  });

  releaseOutcome.resolve();
  const first = await firstPromise;
  assert.equal(first.response.status, 201);
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(harness.invitations.get(invitation.id).auth_user_id, INVITEE_ID);
  assert.equal(harness.profiles.get(INVITEE_ID).id, INVITEE_ID);
});

test("outcome persistence rejection remains provider-unknown and never permits a duplicate dispatch", async t => {
  for (const [label, options] of [
    ["provider accepted", {}],
    ["provider call rejected", {
      inviteFailure:() => true,
      inviteFailureValue:Object.assign(new Error("fictional provider failure"), { status:503 })
    }]
  ]) {
    await t.test(label, async () => {
      const harness = makeHarness(options);
      harness.deps.recordInvitationProviderOutcome = async () => {
        throw Object.assign(new Error("fictional outcome persistence failure"), {
          code:"outcome_persistence_unavailable"
        });
      };

      const first = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      const invitation = [...harness.invitations.values()][0];
      assert.deepEqual({
        classification:`${first.response.status}:${first.payload.error?.code || "ok"}`,
        providerCallCount:harness.inviteCalls.length,
        operationState:invitation.operation_state,
        committedAuthUserId:invitation.auth_user_id,
        profileExists:harness.profiles.has(INVITEE_ID)
      }, {
        classification:"502:provider_outcome_unknown",
        providerCallCount:1,
        operationState:"dispatch_authorized",
        committedAuthUserId:null,
        profileExists:false
      });

      harness.advance(301);
      const replay = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      assert.equal(`${replay.response.status}:${replay.payload.error?.code || "ok"}`, "409:provider_outcome_unknown");
      assert.equal(harness.inviteCalls.length, 1);
    });
  }
});

test("expired dispatch ownership is recovered into audited uncertainty without adopting observed identity", async () => {
  const harness = makeHarness();
  harness.deps.recordInvitationProviderOutcome = async () => {
    throw Object.assign(new Error("fictional process interruption before outcome persistence"), {
      code:"outcome_persistence_unavailable"
    });
  };

  const first = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  const invitation = [...harness.invitations.values()][0];
  const originalToken = invitation.operation_token;
  assert.equal(`${first.response.status}:${first.payload.error?.code}`, "502:provider_outcome_unknown");
  assert.equal(harness.inviteCalls.length, 1);
  assert.equal(invitation.operation_state, "dispatch_authorized");
  assert.equal(invitation.auth_user_id, null);
  assert.equal(harness.authUsers.has(INVITEE_ID), true);

  harness.advance(301);
  const recovered = await invoke(harness, request("GET"));
  const committed = harness.invitations.get(invitation.id);
  const attempt = harness.operationAttempts.get(originalToken);
  assert.deepEqual({
    responseStatus:recovered.response.status,
    operationState:committed.operation_state,
    status:committed.status,
    sendState:committed.send_state,
    committedAuthUserId:committed.auth_user_id,
    profileExists:harness.profiles.has(INVITEE_ID),
    providerCallCount:harness.inviteCalls.length,
    recoveryCallCount:harness.dispatchRecoveryCalls.length,
    observedAuthUserId:attempt.observedAuthUserId,
    lookupComplete:attempt.lookupComplete,
    recoveryAuditCount:harness.audits.filter(item => (
      item.event_type === "reconciliation_required"
      && item.classification === "provider_outcome_unknown"
      && item.operation_token === originalToken
    )).length
  }, {
    responseStatus:200,
    operationState:"provider_unknown",
    status:"reconciliation_required",
    sendState:"unknown",
    committedAuthUserId:null,
    profileExists:false,
    providerCallCount:1,
    recoveryCallCount:1,
    observedAuthUserId:INVITEE_ID,
    lookupComplete:true,
    recoveryAuditCount:1
  });

  const replay = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  assert.equal(`${replay.response.status}:${replay.payload.error?.code}`, "409:provider_outcome_unknown");
  assert.equal(harness.inviteCalls.length, 1);
});

test("dispatch recovery is idempotent, preserves attribution, and accepts only a late exact-token result", async () => {
  const harness = makeHarness({ otherActorVenue:VENUE_A });
  const originalRecordOutcome = harness.deps.recordInvitationProviderOutcome;
  harness.deps.recordInvitationProviderOutcome = async () => {
    throw Object.assign(new Error("fictional process interruption"), { code:"outcome_persistence_unavailable" });
  };
  await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
  const invitation = [...harness.invitations.values()][0];
  const originalToken = invitation.operation_token;
  harness.advance(301);

  const firstRecovery = await invoke(harness, request("GET", OTHER_TOKEN));
  const secondRecovery = await invoke(harness, request("GET", OTHER_TOKEN));
  const recoveryAudits = harness.audits.filter(item => (
    item.event_type === "reconciliation_required"
    && item.classification === "provider_outcome_unknown"
    && item.operation_token === originalToken
  ));
  assert.deepEqual({
    firstStatus:firstRecovery.response.status,
    secondStatus:secondRecovery.response.status,
    providerCallCount:harness.inviteCalls.length,
    recoveryCallCount:harness.dispatchRecoveryCalls.length,
    recoveryAuditCount:recoveryAudits.length,
    recorder:recoveryAudits[0]?.actor_user_id,
    originator:recoveryAudits[0]?.originating_actor_user_id,
    committedAuthUserId:invitation.auth_user_id,
    operationState:invitation.operation_state
  }, {
    firstStatus:200,
    secondStatus:200,
    providerCallCount:1,
    recoveryCallCount:2,
    recoveryAuditCount:1,
    recorder:OTHER_ADMIN_ID,
    originator:ADMIN_ID,
    committedAuthUserId:null,
    operationState:"provider_unknown"
  });

  const late = await originalRecordOutcome({
    invitationId:invitation.id,
    actorUserId:ADMIN_ID,
    operationToken:originalToken,
    outcome:"accepted",
    providerAuthUserId:INVITEE_ID,
    providerNormalizedEmail:"alex.employee@example.com",
    requestId:"88888888-8888-4888-8888-888888888888"
  });
  assert.equal(late.decisionCode, "accepted");
  assert.equal(invitation.auth_user_id, INVITEE_ID);
  assert.equal(invitation.operation_state, "provider_accepted");
  assert.equal(harness.profiles.has(INVITEE_ID), false);
  assert.equal(harness.inviteCalls.length, 1);
});

test("dispatch recovery reauthorizes after the identity observation wait", async t => {
  for (const [label, revoke] of [
    ["deactivated", profile => { profile.active = false; }],
    ["demoted", profile => { profile.role = "manager"; }],
    ["reassigned", profile => { profile.venue_id = VENUE_B; }]
  ]) {
    await t.test(label, async () => {
      const harness = makeHarness();
      harness.deps.recordInvitationProviderOutcome = async () => {
        throw Object.assign(new Error("fictional process interruption"), { code:"outcome_persistence_unavailable" });
      };
      await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      const invitation = [...harness.invitations.values()][0];
      harness.advance(301);

      const originalLookup = harness.deps.lookupAuthUserByEmail;
      const lookupEntered = deferred();
      const releaseLookup = deferred();
      harness.deps.lookupAuthUserByEmail = async (...args) => {
        lookupEntered.resolve();
        await releaseLookup.promise;
        return await originalLookup(...args);
      };
      const pending = invoke(harness, request("GET", USER_TOKEN));
      await lookupEntered.promise;
      revoke(harness.profiles.get(ADMIN_ID));
      releaseLookup.resolve();
      const result = await pending;

      assert.deepEqual({
        classification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        operationState:invitation.operation_state,
        committedAuthUserId:invitation.auth_user_id,
        providerCallCount:harness.inviteCalls.length,
        profileExists:harness.profiles.has(INVITEE_ID),
        recoveryCallCount:harness.dispatchRecoveryCalls.length
      }, {
        classification:"403:forbidden",
        operationState:"dispatch_authorized",
        committedAuthUserId:null,
        providerCallCount:1,
        profileExists:false,
        recoveryCallCount:0
      });
    });
  }
});

test("authorization changes are enforced atomically at dispatch and profile boundaries", async t => {
  const revocations = [
    ["deactivated", profile => { profile.active = false; }],
    ["demoted", profile => { profile.role = "manager"; }],
    ["reassigned", profile => { profile.venue_id = VENUE_B; }]
  ];

  for (const [label, revoke] of revocations) {
    await t.test(`${label} before dispatch`, async () => {
      const harness = makeHarness();
      const originalAuthorize = harness.deps.authorizeInvitationDispatch;
      const authorizationReached = deferred();
      const releaseAuthorization = deferred();
      harness.deps.authorizeInvitationDispatch = async input => {
        authorizationReached.resolve();
        await releaseAuthorization.promise;
        return await originalAuthorize(input);
      };

      const pending = invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      await authorizationReached.promise;
      revoke(harness.profiles.get(ADMIN_ID));
      releaseAuthorization.resolve();
      const result = await pending;
      const invitation = [...harness.invitations.values()][0];

      assert.deepEqual({
        responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        providerCallCount:harness.inviteCalls.length,
        authUserCount:harness.authUsers.size,
        inviteeProfileExists:harness.profiles.has(INVITEE_ID),
        committedAuthUserId:invitation.auth_user_id,
        committedSendState:invitation.send_state,
        dispatchDecision:harness.dispatchAuthorizationCalls.at(-1) ? "checked" : "missing"
      }, {
        responseClassification:"403:forbidden",
        providerCallCount:0,
        authUserCount:0,
        inviteeProfileExists:false,
        committedAuthUserId:null,
        committedSendState:"not_attempted",
        dispatchDecision:"checked"
      });
    });

    await t.test(`${label} before profile creation`, async () => {
      const harness = makeHarness();
      const originalFinalize = harness.deps.finalizeInvitationProfile;
      const finalizationReached = deferred();
      const releaseFinalization = deferred();
      harness.deps.finalizeInvitationProfile = async input => {
        finalizationReached.resolve();
        await releaseFinalization.promise;
        return await originalFinalize(input);
      };

      const pending = invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      await finalizationReached.promise;
      revoke(harness.profiles.get(ADMIN_ID));
      releaseFinalization.resolve();
      const result = await pending;
      const invitation = [...harness.invitations.values()][0];

      assert.deepEqual({
        responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        providerCallCount:harness.inviteCalls.length,
        inviteeProfileExists:harness.profiles.has(INVITEE_ID),
        committedAuthUserId:invitation.auth_user_id,
        committedSendState:invitation.send_state,
        committedOperationState:invitation.operation_state,
        providerOutcomeCount:harness.providerOutcomeCalls.length,
        profileFinalizationCount:harness.profileFinalizationCalls.length
      }, {
        responseClassification:"403:forbidden",
        providerCallCount:1,
        inviteeProfileExists:false,
        committedAuthUserId:INVITEE_ID,
        committedSendState:"provider_accepted",
        committedOperationState:"provider_accepted",
        providerOutcomeCount:1,
        profileFinalizationCount:1
      });
    });
  }
});

test("request parsing enforces actual byte limits and rejects misleading Content-Length", async t => {
  const oversizedText = `${JSON.stringify(inviteBody())}${" ".repeat(17000)}`;
  const oversizedBytes = new TextEncoder().encode(oversizedText);

  await t.test("under-declared streamed body", async () => {
    const harness = makeHarness();
    const result = await invoke(harness, streamedRequest(oversizedBytes, {
      chunks:[oversizedBytes.slice(0, 7000), oversizedBytes.slice(7000)],
      headers:{ "content-length":"1" }
    }));
    assert.deepEqual({
      classification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
      providerCalls:harness.inviteCalls.length,
      invitations:harness.invitations.size
    }, {
      classification:"413:request_too_large",
      providerCalls:0,
      invitations:0
    });
  });

  await t.test("over-declared body", async () => {
    const harness = makeHarness();
    const bytes = new TextEncoder().encode(JSON.stringify(inviteBody()));
    const result = await invoke(harness, streamedRequest(bytes, {
      headers:{ "content-length":"20000" }
    }));
    assert.equal(result.response.status, 413);
    assert.equal(result.payload.error.code, "request_too_large");
    assert.equal(harness.inviteCalls.length, 0);
  });

  await t.test("malformed declared length", async () => {
    const harness = makeHarness();
    const bytes = new TextEncoder().encode(JSON.stringify(inviteBody()));
    const result = await invoke(harness, streamedRequest(bytes, {
      headers:{ "content-length":"not-a-number" }
    }));
    assert.equal(result.response.status, 400);
    assert.equal(result.payload.error.code, "invalid_content_length");
    assert.equal(harness.inviteCalls.length, 0);
  });

  await t.test("multi-byte UTF-8 is counted as bytes", async () => {
    const harness = makeHarness();
    const bytes = new TextEncoder().encode(JSON.stringify(inviteBody({
      full_name:"é".repeat(8200)
    })));
    assert.ok(bytes.byteLength > 16384);
    const result = await invoke(harness, streamedRequest(bytes, {
      chunks:[bytes.slice(0, 9000), bytes.slice(9000)]
    }));
    assert.equal(result.response.status, 413);
    assert.equal(result.payload.error.code, "request_too_large");
    assert.equal(harness.inviteCalls.length, 0);
  });
});

test("request parsing rejects malformed JSON, unsupported media, and non-object bodies", async t => {
  await t.test("malformed JSON", async () => {
    const harness = makeHarness();
    const result = await invoke(
      harness,
      streamedRequest(new TextEncoder().encode('{"action":"invite"'))
    );
    assert.equal(result.response.status, 400);
    assert.equal(result.payload.error.code, "invalid_json");
    assert.equal(harness.invitations.size, 0);
  });

  await t.test("unsupported content type", async () => {
    const harness = makeHarness();
    const result = await invoke(
      harness,
      streamedRequest(new TextEncoder().encode(JSON.stringify(inviteBody())), {
        contentType:"text/plain"
      })
    );
    assert.equal(result.response.status, 415);
    assert.equal(result.payload.error.code, "invalid_content_type");
    assert.equal(harness.invitations.size, 0);
  });

  for (const [label, value] of [
    ["array", []],
    ["null", null],
    ["string", "invite"]
  ]) {
    await t.test(label, async () => {
      const harness = makeHarness();
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const result = await invoke(harness, streamedRequest(bytes));
      assert.equal(result.response.status, 400);
      assert.equal(result.payload.error.code, "invalid_field_type");
      assert.equal(harness.inviteCalls.length, 0);
      assert.equal(harness.invitations.size, 0);
    });
  }
});

test("request fields require exact scalar types and reject unexpected structures", async t => {
  const invalidBodies = [
    ["action", inviteBody({ action:["invite"] })],
    ["full_name", inviteBody({ full_name:["Alex Employee"] })],
    ["email", inviteBody({ email:["alex.employee@example.com"] })],
    ["role", inviteBody({ role:["door"] })],
    ["idempotency_key", inviteBody({ idempotency_key:[IDEMPOTENCY_A] })]
  ];

  for (const [label, body] of invalidBodies) {
    await t.test(label, async () => {
      const harness = makeHarness();
      const result = await invoke(harness, request("POST", USER_TOKEN, body));
      assert.equal(result.response.status, 400);
      assert.equal(result.payload.error.code, "invalid_field_type");
      assert.equal(harness.inviteCalls.length, 0);
      assert.equal(harness.invitations.size, 0);
    });
  }

  await t.test("unexpected nested field", async () => {
    const harness = makeHarness();
    const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody({
      metadata:{ nested:{ access_token:"fictional-secret" } }
    })));
    const serialized = JSON.stringify(result.payload);
    assert.equal(result.response.status, 400);
    assert.equal(result.payload.error.code, "unexpected_field");
    assert.doesNotMatch(serialized, /fictional-secret/i);
    assert.equal(harness.inviteCalls.length, 0);
  });
});

test("audit metadata uses an explicit bounded scalar allowlist", () => {
  assert.deepEqual(redactDetails({ attempt_count:2 }, "attempt_started"), { attempt_count:2 });
  assert.throws(
    () => redactDetails({ attempt_count:2, context:{ access_token:"fictional-secret" } }, "attempt_started"),
    error => error?.code === "invalid_audit_metadata"
  );
  assert.throws(
    () => redactDetails({ attempt_count:-1 }, "attempt_started"),
    error => error?.code === "invalid_audit_metadata"
  );
  assert.throws(
    () => redactDetails({ provider_payload:"x".repeat(1000) }),
    error => error?.code === "invalid_audit_metadata"
  );
});

test("unexpected field names cannot expand or contaminate safe error output", async () => {
  const harness = makeHarness();
  const untrustedField = `authorization_${"x".repeat(5000)}`;
  const body = { ...inviteBody(), [untrustedField]:"fictional-secret" };
  const result = await invoke(harness, request("POST", USER_TOKEN, body));
  const serialized = JSON.stringify(result.payload);

  assert.equal(result.response.status, 400);
  assert.equal(result.payload.error.code, "unexpected_field");
  assert.ok(serialized.length < 1024);
  assert.doesNotMatch(serialized, /fictional-secret|authorization_x{20}/i);
  assert.equal(harness.inviteCalls.length, 0);
});

test("accepted, inactive, and conflicting accounts receive no unauthorized resend or account mutation", async t => {
  await t.test("accepted", async () => {
    const harness = makeHarness();
    const invitation = await successfulInvite(harness);
    const row = harness.invitations.get(invitation.id);
    row.status = "accepted";
    row.accepted_at = "2026-09-17T16:10:00.000Z";
    const authBefore = structuredClone(harness.authUsers.get(INVITEE_ID));
    const profileBefore = structuredClone(harness.profiles.get(INVITEE_ID));

    const result = await invoke(
      harness,
      request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id })
    );

    assert.equal(result.response.status, 409);
    assert.equal(result.payload.error.code, "already_accepted");
    assert.equal(harness.inviteCalls.length, 1);
    assert.deepEqual(harness.authUsers.get(INVITEE_ID), authBefore);
    assert.deepEqual(harness.profiles.get(INVITEE_ID), profileBefore);
  });

  for (const [label, mutate, expectedCode] of [
    ["inactive", profile => { profile.active = false; }, "existing_account_inactive"],
    ["role conflict", profile => { profile.role = "viewer"; }, "existing_account_role_conflict"],
    ["venue conflict", profile => { profile.venue_id = VENUE_B; }, "identity_unavailable"]
  ]) {
    await t.test(label, async () => {
      const harness = makeHarness();
      const invitation = await successfulInvite(harness);
      mutate(harness.profiles.get(INVITEE_ID));
      const authBefore = structuredClone(harness.authUsers.get(INVITEE_ID));
      const profileBefore = structuredClone(harness.profiles.get(INVITEE_ID));
      const identityBefore = {
        auth_user_id:harness.invitations.get(invitation.id).auth_user_id,
        venue_id:harness.invitations.get(invitation.id).venue_id,
        requested_role:harness.invitations.get(invitation.id).requested_role,
        last_sent_at:harness.invitations.get(invitation.id).last_sent_at
      };
      harness.advance(301);

      const result = await invoke(
        harness,
        request("POST", USER_TOKEN, { action:"resend", invitation_id:invitation.id })
      );
      const finalRow = harness.invitations.get(invitation.id);

      assert.deepEqual({
        responseClassification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        providerCallCount:harness.inviteCalls.length,
        authUnchanged:JSON.stringify(harness.authUsers.get(INVITEE_ID)) === JSON.stringify(authBefore),
        profileUnchanged:JSON.stringify(harness.profiles.get(INVITEE_ID)) === JSON.stringify(profileBefore),
        authoritativeIdentityUnchanged:finalRow.auth_user_id === identityBefore.auth_user_id
          && finalRow.venue_id === identityBefore.venue_id
          && finalRow.requested_role === identityBefore.requested_role
          && finalRow.last_sent_at === identityBefore.last_sent_at
      }, {
        responseClassification:`409:${expectedCode}`,
        providerCallCount:1,
        authUnchanged:true,
        profileUnchanged:true,
        authoritativeIdentityUnchanged:true
      });
    });
  }
});

test("disabled provisioning prevents mutation-capable GET reconciliation", async () => {
  const harness = makeHarness();
  const invitation = await successfulInvite(harness);
  harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
  const rowBefore = structuredClone(harness.invitations.get(invitation.id));
  const profileBefore = structuredClone(harness.profiles.get(INVITEE_ID));
  const auditBefore = structuredClone(harness.audits);
  const disabled = createStaffInvitationsHandler(harness.deps, {
    ...harness.config,
    enabled:false
  });

  const response = await disabled(request("GET"));
  const payload = await response.json();

  assert.deepEqual({
    classification:`${response.status}:${payload.error?.code || "ok"}`,
    rowUnchanged:JSON.stringify(harness.invitations.get(invitation.id)) === JSON.stringify(rowBefore),
    profileUnchanged:JSON.stringify(harness.profiles.get(INVITEE_ID)) === JSON.stringify(profileBefore),
    auditsUnchanged:JSON.stringify(harness.audits) === JSON.stringify(auditBefore),
    providerCallCount:harness.inviteCalls.length
  }, {
    classification:"503:provisioning_disabled",
    rowUnchanged:true,
    profileUnchanged:true,
    auditsUnchanged:true,
    providerCallCount:1
  });
});

const malformedDecisionVariants = [
  ["missing", row => ({ record:structuredClone(row) })],
  ["unknown", row => ({ decisionCode:"unsupported_database_decision", record:structuredClone(row) })]
];

test("production RPC adapter rejects missing, unknown, and contradictory decisions", () => {
  const rpc = "doorflow_authorize_staff_invitation_dispatch";
  const row = { id:"90000000-0000-4000-8000-000000000001" };
  assert.deepEqual(
    validateDecisionRpcResult(rpc, { decision_code:"dispatch_authorized", record:row }),
    { decision_code:"dispatch_authorized", record:row }
  );
  for (const decision of [
    { record:row },
    { decision_code:"unsupported_database_decision", record:row },
    { decision_code:"dispatch_authorized", decisionCode:"forbidden", record:row }
  ]) {
    assert.throws(
      () => validateDecisionRpcResult(rpc, decision),
      error => error.code === "invalid_database_contract"
    );
  }
});

test("row-bearing malformed dispatch decisions fail closed before the provider boundary", async t => {
  for (const [label, malformedDecision] of malformedDecisionVariants) {
    await t.test(label, async () => {
      const harness = makeHarness();
      harness.deps.authorizeInvitationDispatch = async input => malformedDecision(
        harness.invitations.get(input.invitationId)
      );

      const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      const row = [...harness.invitations.values()][0];
      assert.deepEqual({
        classification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        providerCallCount:harness.inviteCalls.length,
        committedAuthUserId:row.auth_user_id,
        committedOperationState:row.operation_state,
        profileExists:harness.profiles.has(INVITEE_ID)
      }, {
        classification:"500:invalid_database_contract",
        providerCallCount:0,
        committedAuthUserId:null,
        committedOperationState:"claimed",
        profileExists:false
      });
    });
  }
});

test("row-bearing malformed provider-outcome decisions never authorize identity adoption", async t => {
  for (const [label, malformedDecision] of malformedDecisionVariants) {
    await t.test(label, async () => {
      const harness = makeHarness();
      harness.deps.recordInvitationProviderOutcome = async input => malformedDecision(
        harness.invitations.get(input.invitationId)
      );

      const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      const row = [...harness.invitations.values()][0];
      assert.deepEqual({
        classification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        providerCallCount:harness.inviteCalls.length,
        committedAuthUserId:row.auth_user_id,
        committedOperationState:row.operation_state,
        profileExists:harness.profiles.has(INVITEE_ID)
      }, {
        classification:"500:invalid_database_contract",
        providerCallCount:1,
        committedAuthUserId:null,
        committedOperationState:"dispatch_authorized",
        profileExists:false
      });
    });
  }
});

test("row-bearing malformed profile-finalization decisions never complete provisioning", async t => {
  for (const [label, malformedDecision] of malformedDecisionVariants) {
    await t.test(label, async () => {
      const harness = makeHarness();
      harness.deps.finalizeInvitationProfile = async input => ({
        ...malformedDecision(harness.invitations.get(input.invitationId)),
        profile:{
          id:INVITEE_ID,
          full_name:"Alex Employee",
          role:"door",
          active:true,
          venue_id:VENUE_A
        }
      });

      const result = await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      const row = [...harness.invitations.values()][0];
      assert.deepEqual({
        classification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        providerCallCount:harness.inviteCalls.length,
        committedAuthUserId:row.auth_user_id,
        committedOperationState:row.operation_state,
        committedStatus:row.status,
        profileExists:harness.profiles.has(INVITEE_ID)
      }, {
        classification:"500:invalid_database_contract",
        providerCallCount:1,
        committedAuthUserId:INVITEE_ID,
        committedOperationState:"provider_accepted",
        committedStatus:"profile_pending",
        profileExists:false
      });
    });
  }
});

test("row-bearing malformed reconciliation decisions never become successful GET reconciliation", async t => {
  for (const [label, malformedDecision] of malformedDecisionVariants) {
    await t.test(label, async () => {
      const harness = makeHarness();
      const invitation = await successfulInvite(harness);
      harness.authUsers.get(INVITEE_ID).email_confirmed_at = "2026-09-17T16:05:00.000Z";
      const auditCount = harness.audits.length;
      harness.deps.reconcileInvitation = async input => malformedDecision(
        harness.invitations.get(input.invitationId)
      );

      const result = await invoke(harness, request("GET"));
      const row = harness.invitations.get(invitation.id);
      assert.deepEqual({
        classification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        committedStatus:row.status,
        committedAcceptedAt:row.accepted_at,
        auditCount:harness.audits.length
      }, {
        classification:"500:invalid_database_contract",
        committedStatus:"sent",
        committedAcceptedAt:null,
        auditCount
      });
    });
  }
});

test("row-bearing malformed dispatch-recovery decisions preserve the unresolved fence", async t => {
  for (const [label, malformedDecision] of malformedDecisionVariants) {
    await t.test(label, async () => {
      const harness = makeHarness();
      harness.deps.recordInvitationProviderOutcome = async () => {
        throw Object.assign(new Error("fictional process interruption"), {
          code:"outcome_persistence_unavailable"
        });
      };
      await invoke(harness, request("POST", USER_TOKEN, inviteBody()));
      const row = [...harness.invitations.values()][0];
      harness.advance(301);
      harness.deps.recoverInvitationDispatch = async input => malformedDecision(
        harness.invitations.get(input.invitationId)
      );

      const result = await invoke(harness, request("GET"));
      assert.deepEqual({
        classification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        providerCallCount:harness.inviteCalls.length,
        committedAuthUserId:row.auth_user_id,
        committedOperationState:row.operation_state,
        committedSendState:row.send_state,
        profileExists:harness.profiles.has(INVITEE_ID)
      }, {
        classification:"500:invalid_database_contract",
        providerCallCount:1,
        committedAuthUserId:null,
        committedOperationState:"dispatch_authorized",
        committedSendState:"not_attempted",
        profileExists:false
      });
    });
  }
});

test("row-bearing malformed audit-repair decisions never clear pending evidence", async t => {
  for (const [label, malformedDecision] of malformedDecisionVariants) {
    await t.test(label, async () => {
      const harness = makeHarness();
      const invitation = await successfulInvite(harness);
      const row = harness.invitations.get(invitation.id);
      Object.assign(row, {
        status:"accepted",
        accepted_at:"2026-09-17T16:05:00.000Z",
        failure_code:"accepted_audit_pending",
        failure_message:"Acceptance is verified, but its audit evidence still needs repair.",
        pending_audit_event_type:"accepted_reconciled",
        pending_audit_classification:"verified_auth",
        pending_audit_originating_actor_user_id:ADMIN_ID,
        pending_audit_originating_request_id:"88888888-8888-4888-8888-888888888888",
        pending_audit_operation_token:row.operation_token,
        pending_audit_details:{}
      });
      harness.deps.repairInvitationAudit = async input => malformedDecision(
        harness.invitations.get(input.invitationId)
      );

      const result = await invoke(harness, request("GET"));
      assert.deepEqual({
        classification:`${result.response.status}:${result.payload.error?.code || "ok"}`,
        pendingEvent:row.pending_audit_event_type,
        pendingClassification:row.pending_audit_classification,
        failureCode:row.failure_code,
        providerCallCount:harness.inviteCalls.length
      }, {
        classification:"500:invalid_database_contract",
        pendingEvent:"accepted_reconciled",
        pendingClassification:"verified_auth",
        failureCode:"accepted_audit_pending",
        providerCallCount:1
      });
    });
  }
});
