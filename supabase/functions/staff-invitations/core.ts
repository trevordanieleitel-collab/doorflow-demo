// These describe the server adapter contract and the review-only invitation SQL.
// They are not runtime validation of database or provider responses.
export type InvitationAction = "invite" | "retry" | "resend";
export interface InvitationRecord {
  id: string;
  invited_by_user_id: string;
  last_actor_user_id: string;
  venue_id: string;
  email: string;
  normalized_email: string;
  full_name: string;
  requested_role: string;
  auth_user_id: string | null;
  status: string;
  send_state: string;
  profile_state: string;
  idempotency_key: string;
  request_fingerprint: string;
  attempt_count: number;
  last_attempt_at: string | null;
  last_provider_attempt_at: string | null;
  last_sent_at: string | null;
  operation_fence: number;
  operation_token: string | null;
  operation_action: InvitationAction | "reconcile" | "audit_repair" | null;
  operation_state: string;
  operation_actor_user_id: string | null;
  operation_request_id: string | null;
  operation_started_at: string | null;
  processing_started_at: string | null;
  lease_expires_at: string | null;
  dispatch_authorized_at: string | null;
  dispatch_started_at: string | null;
  operation_completed_at: string | null;
  expected_auth_user_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  pending_audit_event_type: string | null;
  pending_audit_classification: string | null;
  pending_audit_originating_actor_user_id: string | null;
  pending_audit_originating_request_id: string | null;
  pending_audit_operation_token: string | null;
  pending_audit_details: unknown;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type InvitationChanges = Partial<InvitationRecord>;
export type InvitationExpectedState = Partial<Pick<InvitationRecord,
  "accepted_at" | "status" | "operation_state" | "updated_at"
  | "pending_audit_event_type" | "pending_audit_classification"
>> & { operation_token?: string; pending_audit_operation_token?: string };
export interface StaffProfile {
  id: string;
  full_name: string;
  role: string;
  active: boolean;
  venue_id: string | null;
}
export interface AuthIdentity {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  invited_at?: string | null;
  user_metadata?: unknown;
}
export interface AuditDetails {
  attempt_count?: number;
  original_actor_user_id?: string;
  repairing_actor_user_id?: string;
}
export interface AuditEntry {
  id?: string;
  invitation_id: string;
  actor_user_id: string;
  venue_id: string;
  event_type: string;
  classification: string;
  request_id: string;
  details: unknown;
}
export interface InvitationReservationInput {
  invited_by_user_id: string;
  last_actor_user_id: string;
  venue_id: string;
  email: string;
  normalized_email: string;
  full_name: string;
  requested_role: string;
  status: "reserved";
  send_state: "not_attempted";
  profile_state: "pending";
  idempotency_key: string;
  request_fingerprint: string;
  request_id: string;
}
// A successful reservation must supply the row. The adapter remains responsible
// for proving this contract before its untrusted RPC output can satisfy it.
export type InvitationReservationResult = {
  inserted: true;
  record: InvitationRecord;
  code?: string;
  decision_code?: string;
} | {
  inserted: false;
  record: InvitationRecord | null;
  code?: string;
  decision_code?: string;
};
export interface DecisionEnvelope {
  decisionCode?: unknown;
  decision_code?: unknown;
  record?: InvitationRecord | null;
  invitation?: InvitationRecord | null;
  retryAfterSeconds?: unknown;
  retry_after_seconds?: unknown;
  conflictCode?: unknown;
  conflict_code?: unknown;
  profile?: StaffProfile | null;
}
export interface UntrustedDecisionEnvelope {
  decisionCode?: string;
  decision_code?: string;
  record?: unknown;
  invitation?: unknown;
  profile?: unknown;
  id?: unknown;
  retryAfterSeconds?: unknown;
  retry_after_seconds?: unknown;
  conflictCode?: unknown;
  conflict_code?: unknown;
}
export type DecisionResult = DecisionEnvelope & (InvitationRecord | { id?: never });
export type DecisionRpcName = keyof typeof RPC_DECISION_CODES;
export type DecisionRpc = (
  name: "doorflow_repair_staff_invitation_audit",
  args: { p_invitation_id: string; p_actor_user_id: string; p_repair_operation_token: string; p_request_id: string },
  label: string
) => Promise<DecisionResult>;
export interface InvitationOperation {
  invitationId: string;
  actorUserId: string;
  operationToken: string | null;
  requestId: string;
}
export interface InvitationRepairOperation extends InvitationOperation {
  operationToken: string;
}
export interface InvitationObservation extends InvitationOperation {
  expectedUpdatedAt: string;
  observedAuthUserId: string | null;
  observedNormalizedEmail: string | null;
  observedEmailConfirmedAt: string | null;
  observedInvitedAt: string | null;
}
export interface InviteProviderOptions {
  redirectTo: string;
  data: { full_name: string; doorflow_invitation_creation_marker?: string | null };
}
export interface ProviderOperationContext {
  expectedAuthUserId: string | null;
  operationToken: string | null;
}
export type ProviderOutcome = "accepted" | "identity_mismatch" | "unknown";
export interface StaffInvitationDependencies {
  reserveIncludesAudit?: boolean;
  claimIncludesAudit?: boolean;
  now(): Date;
  randomUUID(): string;
  operationUUID?(): string;
  logSafeError?(entry: { request_id: string; code: string; status: number }): void;
  verifyUserToken(token: string): Promise<AuthIdentity | null>;
  getStaffProfile(userId: string): Promise<StaffProfile | null>;
  createStaffProfile(profile: StaffProfile): Promise<StaffProfile | null>;
  reserveInvitation(record: InvitationReservationInput): Promise<InvitationReservationResult>;
  getInvitationById(invitationId: string): Promise<InvitationRecord | null>;
  listInvitations(venueId: string): Promise<InvitationRecord[]>;
  claimInvitation(claim: InvitationRepairOperation & {
    action: InvitationAction; cooldownSeconds: number; leaseSeconds: number;
  }): Promise<DecisionResult>;
  authorizeInvitationDispatch?(operation: InvitationOperation & {
    expectedLease: string | null;
  }): Promise<DecisionResult>;
  recordInvitationProviderOutcome?(operation: InvitationOperation & {
    outcome: ProviderOutcome; providerAuthUserId: string | null; providerNormalizedEmail: string | null;
  }): Promise<DecisionResult>;
  recoverInvitationDispatch?(operation: InvitationObservation & {
    recoveryOperationToken: string; lookupComplete: boolean;
  }): Promise<DecisionResult>;
  finalizeInvitationProfile?(operation: InvitationOperation & {
    authUser: { id: string; email: string };
  }): Promise<DecisionResult>;
  repairInvitationAudit?(operation: InvitationRepairOperation): Promise<DecisionResult>;
  reconcileInvitation?(operation: InvitationObservation): Promise<DecisionResult>;
  updateInvitation(
    invitationId: string, changes: InvitationChanges, expectedLease?: string | null,
    expectedState?: InvitationExpectedState
  ): Promise<InvitationRecord>;
  appendAudit(entry: AuditEntry): Promise<void>;
  getAuditById(auditId: string): Promise<AuditEntry | null>;
  getAuthUserById(userId: string): Promise<AuthIdentity | null>;
  lookupAuthUserByEmail?(normalizedEmail: string, actorUserId: string, venueId: string): Promise<{
    user: AuthIdentity | null; complete: boolean;
  }>;
  inviteUserByEmail(
    email: string, options: InviteProviderOptions, operationContext: ProviderOperationContext
  ): Promise<AuthIdentity | null>;
}
export interface StaffInvitationConfigInput {
  environment?: unknown;
  allowedOrigins?: unknown;
  cooldownSeconds?: unknown;
  leaseSeconds?: unknown;
  providerTimeoutMs?: unknown;
  redirectUrl?: unknown;
  enabled?: unknown;
}
export interface StaffInvitationConfig {
  valid: boolean;
  enabled: boolean;
  environment: string;
  redirectUrl: string;
  allowedOrigins: ReadonlySet<string | null>;
  cooldownSeconds: number;
  leaseSeconds: number;
  providerTimeoutMs: number;
}
interface ServerKeysInput {
  publishableDictionary?: unknown;
  secretDictionary?: unknown;
  selector?: unknown;
  directPublishable?: unknown;
  directSecret?: unknown;
  projectRef?: unknown;
  directProjectRef?: unknown;
  allowLegacy?: unknown;
  nowSeconds?: unknown;
  legacyPublishable?: unknown;
  legacySecret?: unknown;
}
interface InvitationRequestFields {
  action?: unknown;
  full_name?: unknown;
  email?: unknown;
  role?: unknown;
  idempotency_key?: unknown;
  invitation_id?: unknown;
}
interface AuditSpec { eventType: string; classification: string }
interface ActorIdentity { user: Pick<AuthIdentity, "id"> }
interface Actor extends ActorIdentity { profile: StaffProfile & { venue_id: string }; token: string }
type ErrorCodeView = { code?: unknown } | null | undefined;
// Named message dictionaries intentionally return undefined for unlisted codes.
type MessageDictionary<K extends string = never> = Readonly<Record<string, string | undefined> & Record<K, string>>;

const ROLE_VALUES = new Set(["admin", "manager", "door", "viewer"]);
const INVITATION_STATES = new Set([
  "reserved",
  "processing",
  "profile_pending",
  "sent",
  "accepted",
  "failed",
  "reconciliation_required"
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_FIELDS = new Set(["action", "full_name", "email", "role", "idempotency_key"]);
const EXISTING_FIELDS = new Set(["action", "invitation_id"]);
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_AUDIT_DETAILS_BYTES = 2048;
const MAX_KEY_DICTIONARY_BYTES = 32 * 1024;
const MAX_KEY_DICTIONARY_ENTRIES = 64;
const PROVIDER_CREATION_MARKER_KEY = "doorflow_invitation_creation_marker";
const ACCEPTED_AUDIT_PENDING_CODE = "accepted_audit_pending";
const ACCEPTED_AUDIT_PENDING_MESSAGE = "Acceptance is verified, but its audit evidence still needs repair.";
const PROFILE_AUDIT_PENDING_CODE = "profile_audit_pending";
const PROFILE_AUDIT_PENDING_MESSAGE = "The staff profile exists, but its audit evidence still needs repair.";
const ACCEPTED_PROFILE_AUDIT_CLASSIFICATIONS = new Set([
  "accepted_profile_inactive",
  "accepted_profile_role_conflict",
  "accepted_profile_other_venue",
  "accepted_profile_missing"
]);
const REPAIRABLE_AUDIT_EVENTS = new Set([
  "provider_accepted",
  "provider_outcome_recorded",
  "reconciliation_required",
  "reconciliation_checked",
  "profile_created",
  "profile_failed",
  "profile_verified",
  "provisioning_completed",
  "profile_conflict",
  "accepted_reconciled",
  "accepted_profile_conflict"
]);

const decisionSet = (...codes: string[]) => new Set(codes);

const RPC_DECISION_CODES = Object.freeze({
  doorflow_reserve_staff_invitation:decisionSet(
    "invalid_request", "forbidden", "idempotency_conflict", "replay",
    "identity_unavailable", "email_reserved", "reserved"
  ),
  doorflow_claim_staff_invitation:decisionSet(
    "invalid_claim", "forbidden", "not_found", "operation_replay",
    "operation_token_conflict", "audit_repair_required", "provider_outcome_unknown",
    "attempt_in_progress", "accepted_terminal", "invite_not_eligible",
    "resend_not_eligible", "reconciliation_required", "retry_not_eligible",
    "resend_cooldown", "retry_cooldown", "claimed"
  ),
  doorflow_authorize_staff_invitation_dispatch:decisionSet(
    "invalid_request", "not_found", "forbidden", "operation_lost",
    "coordination_lease_expired", "dispatch_not_eligible", "dispatch_authorized"
  ),
  doorflow_record_staff_invitation_provider_outcome:decisionSet(
    "invalid_outcome", "invalid_failure_code", "not_found", "operation_lost",
    "audit_repair_required", "provider_accepted", "invitation_resent",
    "provider_outcome_unknown", "provider_identity_mismatch",
    "resend_identity_mismatch", "provider_rejected_verified", "rate_limited_verified"
  ),
  doorflow_recover_staff_invitation_dispatch:decisionSet(
    "invalid_recovery", "not_found", "forbidden", "version_conflict",
    "operation_lost", "provider_outcome_unknown", "attempt_in_progress",
    "audit_repair_required", "operation_token_conflict"
  ),
  doorflow_finalize_staff_invitation_profile:decisionSet(
    "invalid_request", "not_found", "forbidden", "operation_lost",
    "coordination_lease_expired", "audit_repair_required", "profile_write_failed",
    "conflict", "profile_audit_pending", "created", "existing"
  ),
  doorflow_reconcile_staff_invitation:decisionSet(
    "invalid_request", "not_found", "forbidden", "version_conflict",
    "audit_repair_required", "provider_outcome_unknown", "operation_token_conflict",
    "attempt_in_progress", "exact_auth_lookup_unavailable",
    "unowned_auth_identity_mismatch", "existing_account_other_venue",
    "existing_account_inactive", "existing_account_role_conflict",
    "existing_account_active", "confirmed_account_unlinked",
    "unowned_pending_auth_account", "stored_auth_user_missing",
    "stored_auth_identity_mismatch", "not_accepted", "accepted_profile_missing",
    "accepted_profile_inactive", "accepted_profile_other_venue",
    "accepted_profile_role_conflict", "verified_auth"
  ),
  doorflow_repair_staff_invitation_audit:decisionSet(
    "invalid_request", "forbidden", "not_found", "no_pending_audit",
    "audit_state_invalid", "audit_id_collision", "version_conflict",
    "audit_repair_required", "audit_repaired"
  )
});

const CLAIM_DECISION_CODES = decisionSet(
  ...RPC_DECISION_CODES.doorflow_claim_staff_invitation,
  "authorized"
);
const DISPATCH_DECISION_CODES = decisionSet(
  ...RPC_DECISION_CODES.doorflow_authorize_staff_invitation_dispatch,
  "authorized"
);
const PROVIDER_OUTCOME_DECISION_CODES = decisionSet(
  ...RPC_DECISION_CODES.doorflow_record_staff_invitation_provider_outcome,
  "accepted", "identity_mismatch", "unknown"
);
const PROFILE_DECISION_CODES = RPC_DECISION_CODES.doorflow_finalize_staff_invitation_profile;
const PROFILE_CONFLICT_CODES = decisionSet(
  "existing_account_other_venue", "existing_account_inactive",
  "existing_account_role_conflict"
);
const RECONCILIATION_DECISION_CODES = decisionSet(
  ...RPC_DECISION_CODES.doorflow_reconcile_staff_invitation,
  "preexisting_unowned_auth_identity"
);
const RECOVERY_DECISION_CODES = RPC_DECISION_CODES.doorflow_recover_staff_invitation_dispatch;
const AUDIT_REPAIR_DECISION_CODES = RPC_DECISION_CODES.doorflow_repair_staff_invitation_audit;

export class StaffInvitationError extends Error {
  declare code: string;
  declare status: number;
  declare retryAfterSeconds: number;
  declare invitation: InvitationRecord | null;

  constructor(code: string, message: string, status = 400, options: {
    retryAfterSeconds?: number; invitation?: InvitationRecord | null;
  } = {}) {
    super(message);
    this.name = "StaffInvitationError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds || 0;
    this.invitation = options.invitation || null;
  }
}

function databaseContractError() {
  return new StaffInvitationError(
    "invalid_database_contract",
    "The invitation service received an invalid database response.",
    500
  );
}

function requireDecisionCode(result: unknown, supportedCodes: ReadonlySet<string>): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw databaseContractError();
  }
  const camel = (result as { decisionCode?: unknown }).decisionCode;
  const snake = (result as { decision_code?: unknown }).decision_code;
  if (camel !== undefined && snake !== undefined && camel !== snake) {
    throw databaseContractError();
  }
  const code = camel !== undefined ? camel : snake;
  if (typeof code !== "string" || !supportedCodes.has(code)) {
    throw databaseContractError();
  }
  return code;
}

export function validateDecisionRpcResult<T>(rpcName: DecisionRpcName, result: T): T & UntrustedDecisionEnvelope {
  const supportedCodes = RPC_DECISION_CODES[rpcName];
  if (!supportedCodes) throw databaseContractError();
  requireDecisionCode(result, supportedCodes);
  return result as T & UntrustedDecisionEnvelope;
}

export function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeFullName(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function parseJsonString(raw: string, start: number): { value: unknown; next: number } {
  if (raw[start] !== '"') throw new Error("Invalid platform key dictionary");
  let index = start + 1;
  while (index < raw.length) {
    const code = raw.charCodeAt(index);
    if (code < 0x20) throw new Error("Invalid platform key dictionary");
    if (raw[index] === '"') {
      const token = raw.slice(start, index + 1);
      let value: unknown;
      try {
        value = JSON.parse(token);
      } catch {
        throw new Error("Invalid platform key dictionary");
      }
      return { value, next:index + 1 };
    }
    if (raw[index] === "\\") {
      index += 1;
      if (index >= raw.length || !/^["\\/bfnrtu]$/.test(raw[index])) {
        throw new Error("Invalid platform key dictionary");
      }
      if (raw[index] === "u") {
        if (!/^[0-9a-fA-F]{4}$/.test(raw.slice(index + 1, index + 5))) {
          throw new Error("Invalid platform key dictionary");
        }
        index += 4;
      }
    }
    index += 1;
  }
  throw new Error("Invalid platform key dictionary");
}

function parseStrictStringDictionary(rawValue: unknown) {
  const raw = typeof rawValue === "string" ? rawValue : "";
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_KEY_DICTIONARY_BYTES) {
    throw new Error("Invalid platform key dictionary");
  }
  let index = 0;
  const skipWhitespace = () => {
    while (index < raw.length && /^[\u0009\u000a\u000d\u0020]$/.test(raw[index])) index += 1;
  };
  const entries = new Map<string, string>();
  skipWhitespace();
  if (raw[index] !== "{") throw new Error("Invalid platform key dictionary");
  index += 1;
  skipWhitespace();
  if (raw[index] === "}") throw new Error("Invalid platform key dictionary");

  while (index < raw.length) {
    const keyToken = parseJsonString(raw, index);
    const key = keyToken.value;
    index = keyToken.next;
    if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(key) || entries.has(key)) {
      throw new Error("Invalid platform key dictionary");
    }
    skipWhitespace();
    if (raw[index] !== ":") throw new Error("Invalid platform key dictionary");
    index += 1;
    skipWhitespace();
    const valueToken = parseJsonString(raw, index);
    const value = valueToken.value;
    index = valueToken.next;
    if (typeof value !== "string" || !value || value.length > 4096) {
      throw new Error("Invalid platform key dictionary");
    }
    entries.set(key, value);
    if (entries.size > MAX_KEY_DICTIONARY_ENTRIES) throw new Error("Invalid platform key dictionary");
    skipWhitespace();
    if (raw[index] === "}") {
      index += 1;
      skipWhitespace();
      if (index !== raw.length) throw new Error("Invalid platform key dictionary");
      return entries;
    }
    if (raw[index] !== ",") throw new Error("Invalid platform key dictionary");
    index += 1;
    skipWhitespace();
  }
  throw new Error("Invalid platform key dictionary");
}

function modernKey(value: unknown, prefix: string) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!new RegExp(`^${prefix}[A-Za-z0-9_-]{8,2000}$`).test(key)) {
    throw new Error("Invalid Supabase server key configuration");
  }
  return key;
}

function parseLegacyJwtPart(segment: unknown) {
  if (typeof segment !== "string" || segment.length < 2 || segment.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error("Invalid legacy Supabase key configuration");
  }
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal:true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid jwt object");
    return value as { alg?: unknown; typ?: unknown; ref?: unknown; role?: unknown; exp?: unknown };
  } catch {
    throw new Error("Invalid legacy Supabase key configuration");
  }
}

function legacyKey(value: unknown, projectRef: string, expectedRole: string, nowSeconds: number) {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error("Invalid legacy Supabase key configuration");
  }
  const [headerSegment, payloadSegment, signatureSegment] = key.split(".");
  if (signatureSegment.length < 16) throw new Error("Invalid legacy Supabase key configuration");
  const header = parseLegacyJwtPart(headerSegment);
  const payload = parseLegacyJwtPart(payloadSegment);
  if (
    header.alg !== "HS256"
    || (header.typ !== undefined && header.typ !== "JWT")
    || payload.ref !== projectRef
    || payload.role !== expectedRole
    || !Number.isSafeInteger(payload.exp)
    || (payload.exp as number) <= nowSeconds
  ) {
    throw new Error("Invalid legacy Supabase key configuration");
  }
  return key;
}

export function resolveSupabaseServerKeys(rawConfig: ServerKeysInput = {}) {
  const publishableDictionary = typeof rawConfig.publishableDictionary === "string"
    ? rawConfig.publishableDictionary.trim()
    : "";
  const secretDictionary = typeof rawConfig.secretDictionary === "string"
    ? rawConfig.secretDictionary.trim()
    : "";

  if (publishableDictionary || secretDictionary) {
    if (!publishableDictionary || !secretDictionary) {
      throw new Error("Incomplete platform key dictionaries");
    }
    const selector = typeof rawConfig.selector === "string" ? rawConfig.selector.trim() : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(selector)) {
      throw new Error("Missing platform key selector");
    }
    const publishableKeys = parseStrictStringDictionary(publishableDictionary);
    const secretKeys = parseStrictStringDictionary(secretDictionary);
    if (!publishableKeys.has(selector) || !secretKeys.has(selector)) {
      throw new Error("Configured platform key name was not found in both dictionaries");
    }
    return {
      publishableKey:modernKey(publishableKeys.get(selector), "sb_publishable_"),
      secretKey:modernKey(secretKeys.get(selector), "sb_secret_"),
      source:"platform_dictionary"
    };
  }

  const directPublishable = typeof rawConfig.directPublishable === "string"
    ? rawConfig.directPublishable.trim()
    : "";
  const directSecret = typeof rawConfig.directSecret === "string" ? rawConfig.directSecret.trim() : "";
  if (directPublishable || directSecret) {
    const projectRef = typeof rawConfig.projectRef === "string" ? rawConfig.projectRef.trim() : "";
    const keyProjectRef = typeof rawConfig.directProjectRef === "string"
      ? rawConfig.directProjectRef.trim()
      : "";
    if (!directPublishable || !directSecret || !projectRef || keyProjectRef !== projectRef) {
      throw new Error("Incomplete or mismatched direct Supabase key configuration");
    }
    return {
      publishableKey:modernKey(directPublishable, "sb_publishable_"),
      secretKey:modernKey(directSecret, "sb_secret_"),
      source:"doorflow_direct"
    };
  }

  if (rawConfig.allowLegacy !== true) throw new Error("Missing required server key configuration");
  const projectRef = typeof rawConfig.projectRef === "string" ? rawConfig.projectRef.trim() : "";
  const nowSeconds = rawConfig.nowSeconds === undefined
    ? Math.floor(Date.now() / 1000)
    : Number(rawConfig.nowSeconds);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(projectRef) || !Number.isSafeInteger(nowSeconds)) {
    throw new Error("Invalid legacy Supabase key configuration");
  }
  return {
    publishableKey:legacyKey(rawConfig.legacyPublishable, projectRef, "anon", nowSeconds),
    secretKey:legacyKey(rawConfig.legacySecret, projectRef, "service_role", nowSeconds),
    source:"legacy_platform"
  };
}

export function createRepairInvitationAuditRpcAdapter(decisionRpc: DecisionRpc) {
  if (typeof decisionRpc !== "function") {
    throw new TypeError("A decision RPC function is required");
  }
  return async (operation: InvitationRepairOperation) => await decisionRpc("doorflow_repair_staff_invitation_audit", {
    p_invitation_id:operation.invitationId,
    p_actor_user_id:operation.actorUserId,
    p_repair_operation_token:operation.operationToken,
    p_request_id:operation.requestId
  }, "invitation_audit_repair_failed");
}

function isLoopbackHost(hostname: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function validateSupabaseProjectConfiguration(rawConfig: {
  environment?: unknown; supabaseUrl?: unknown; projectRef?: unknown;
} = {}) {
  const environment = typeof rawConfig.environment === "string" ? rawConfig.environment.trim() : "";
  const supabaseUrl = typeof rawConfig.supabaseUrl === "string" ? rawConfig.supabaseUrl.trim() : "";
  const projectRef = typeof rawConfig.projectRef === "string" ? rawConfig.projectRef.trim() : "";
  if (
    !["production", "development"].includes(environment)
    || supabaseUrl.length < 1
    || supabaseUrl.length > 512
    || supabaseUrl.includes("*")
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(projectRef)
  ) {
    throw new Error("Invalid Supabase project configuration");
  }

  let url;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error("Invalid Supabase project configuration");
  }
  if (
    url.origin !== supabaseUrl
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== "/"
    || url.hostname.includes("*")
    || url.hostname.endsWith(".")
  ) {
    throw new Error("Invalid Supabase project configuration");
  }

  if (environment === "production") {
    if (url.protocol !== "https:" || url.port || isLoopbackHost(url.hostname) || url.hostname !== `${projectRef}.supabase.co`) {
      throw new Error("Supabase project configuration does not match");
    }
  } else if (url.protocol !== "http:" || !isLoopbackHost(url.hostname)) {
    throw new Error("Development Supabase must use an explicit HTTP loopback URL");
  }

  return { environment, supabaseUrl:url.origin, projectRef };
}

export function sanitizeCode(value: unknown, fallback = "operation_failed") {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9_:-]/g, "_").slice(0, 80);
  return normalized || fallback;
}

export function redactDetails(value: unknown, eventType = ""): AuditDetails {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new StaffInvitationError("invalid_audit_metadata", "Audit metadata is invalid.", 500);
  }

  const allowed = eventType === "attempt_started"
    ? new Set(["attempt_count"])
    : eventType === "audit_repaired"
      ? new Set(["original_actor_user_id", "repairing_actor_user_id"])
      : new Set();
  const output: AuditDetails = {};
  for (const [key, item] of Object.entries(value) as [string, unknown][]) {
    if (!allowed.has(key)) {
      throw new StaffInvitationError("invalid_audit_metadata", "Audit metadata contains an unsupported field.", 500);
    }
    if (key === "attempt_count") {
      if (!Number.isSafeInteger(item) || (item as number) < 1 || (item as number) > 1_000_000) {
        throw new StaffInvitationError("invalid_audit_metadata", "Audit metadata is invalid.", 500);
      }
      output[key] = item as number;
      continue;
    }
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
      throw new StaffInvitationError("invalid_audit_metadata", "Audit metadata is invalid.", 500);
    }
    output[key as "original_actor_user_id" | "repairing_actor_user_id"] = item;
  }
  if (new TextEncoder().encode(JSON.stringify(output)).byteLength > MAX_AUDIT_DETAILS_BYTES) {
    throw new StaffInvitationError("invalid_audit_metadata", "Audit metadata is too large.", 500);
  }
  return output;
}

export function bearerToken(request: Request) {
  const header = String(request.headers.get("authorization") || "");
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match) throw new StaffInvitationError("missing_credentials", "A signed-in staff session is required.", 401);

  const token = match[1];
  if (token.startsWith("sb_") || token.split(".").length !== 3) {
    throw new StaffInvitationError("invalid_credentials", "A valid signed-in user token is required.", 401);
  }
  return token;
}

export function validateInvitationInput(body: unknown) {
  rejectUnexpectedFields(body, INVITE_FIELDS);
  if (
    typeof body.full_name !== "string"
    || typeof body.email !== "string"
    || typeof body.role !== "string"
    || typeof body.idempotency_key !== "string"
    || body.action !== "invite"
  ) {
    throw new StaffInvitationError("invalid_field_type", "Invitation fields must use the required string types.");
  }
  const fullName = normalizeFullName(body.full_name);
  const email = body.email.trim();
  const normalizedEmail = normalizeEmail(email);
  const role = body.role;
  const idempotencyKey = body.idempotency_key;

  if (fullName.length < 2 || fullName.length > 120) {
    throw new StaffInvitationError("invalid_full_name", "Enter a full name between 2 and 120 characters.");
  }
  if (email.length > 320 || !EMAIL_PATTERN.test(email) || normalizedEmail.includes("..")) {
    throw new StaffInvitationError("invalid_email", "Enter a valid email address.");
  }
  if (!ROLE_VALUES.has(role)) {
    throw new StaffInvitationError("invalid_role", "Select a valid DoorFlow role.");
  }
  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw new StaffInvitationError("invalid_idempotency_key", "Start a new invitation and try again.");
  }

  return { fullName, email, normalizedEmail, role, idempotencyKey };
}

export function validateExistingInput(body: unknown): { action: "retry" | "resend"; invitationId: string } {
  rejectUnexpectedFields(body, EXISTING_FIELDS);
  if (typeof body.action !== "string" || typeof body.invitation_id !== "string") {
    throw new StaffInvitationError("invalid_field_type", "Invitation action fields must use the required string types.");
  }
  const action = body.action;
  const invitationId = body.invitation_id;
  if (action !== "retry" && action !== "resend") {
    throw new StaffInvitationError("invalid_action", "Choose a supported invitation action.");
  }
  if (!UUID_PATTERN.test(invitationId)) {
    throw new StaffInvitationError("invalid_invitation", "Choose a valid invitation.");
  }
  return { action, invitationId };
}

export async function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function rejectUnexpectedFields(body: unknown, allowed: ReadonlySet<string>): asserts body is InvitationRequestFields {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new StaffInvitationError("invalid_request", "Send a JSON request body.");
  }
  const unexpected = Object.keys(body).find(key => !allowed.has(key));
  if (unexpected) {
    throw new StaffInvitationError("unexpected_field", "The request contains an unsupported field.");
  }
}

function asTime(value: string | null | undefined) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function isConfirmed(user: AuthIdentity | null | undefined) {
  // Invitation acceptance is an email event. The legacy confirmed_at field can
  // also reflect phone confirmation, so it is not sufficient evidence here.
  return Boolean(user?.email_confirmed_at);
}

function providerCreationMarker(user: AuthIdentity | null | undefined) {
  const metadata = user?.user_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  if (!Object.hasOwn(metadata, PROVIDER_CREATION_MARKER_KEY)) return "";
  const marker = (metadata as { doorflow_invitation_creation_marker?: unknown })[PROVIDER_CREATION_MARKER_KEY];
  return typeof marker === "string" ? marker : "";
}

function profileConflict(profile: StaffProfile | null, venueId: string, role: string) {
  if (!profile) return null;
  if (String(profile.venue_id || "") !== venueId) return "existing_account_other_venue";
  if (!profile.active) return "existing_account_inactive";
  if (String(profile.role || "") !== role) return "existing_account_role_conflict";
  return "existing_account_active";
}

const CROSS_VENUE_IDENTITY_CODE = "existing_account_other_venue";
const PUBLIC_IDENTITY_UNAVAILABLE_CODE = "identity_unavailable";
const PUBLIC_IDENTITY_UNAVAILABLE_MESSAGE = "This invitation could not be completed for the requested identity.";

function isCrossVenueIdentityFailure(code: unknown) {
  return code === CROSS_VENUE_IDENTITY_CODE || code === "accepted_profile_other_venue";
}

function pendingAuditState(row: InvitationRecord): { kind: "pending" | "none" | "invalid"; spec: AuditSpec | null } {
  const rawEventType = row?.pending_audit_event_type;
  const rawClassification = row?.pending_audit_classification;
  const hasEventType = rawEventType !== null && rawEventType !== undefined;
  const hasClassification = rawClassification !== null && rawClassification !== undefined;
  const eventType = hasEventType ? String(rawEventType) : "";
  const classification = hasClassification ? String(rawClassification) : "";
  const acceptedState = row?.status === "accepted"
    && Boolean(row?.accepted_at)
    && row?.failure_code === ACCEPTED_AUDIT_PENDING_CODE;

  // Preserve repairability for an accepted_audit_pending row created by the
  // earlier accepted-only implementation before explicit marker columns.
  if (!hasEventType && !hasClassification && acceptedState) {
    return {
      kind:"pending",
      spec:{ eventType:"accepted_reconciled", classification:"verified_auth" }
    };
  }
  if (!hasEventType && !hasClassification) return { kind:"none", spec:null };

  if (hasEventType !== hasClassification) return { kind:"invalid", spec:null };
  if (
    !REPAIRABLE_AUDIT_EVENTS.has(eventType)
    || !/^[a-z0-9_:-]{1,80}$/.test(classification)
  ) return { kind:"invalid", spec:null };

  const provenance = [
    row?.pending_audit_originating_actor_user_id,
    row?.pending_audit_originating_request_id,
    row?.pending_audit_operation_token
  ];
  const populatedProvenance = provenance.filter(value => value !== null && value !== undefined && value !== "");
  if (populatedProvenance.length > 0) {
    if (populatedProvenance.length !== provenance.length || !provenance.every(value => UUID_PATTERN.test(String(value)))) {
      return { kind:"invalid", spec:null };
    }
    const details = row?.pending_audit_details;
    if (
      details !== null
      && details !== undefined
      && (
        typeof details !== "object"
        || Array.isArray(details)
        || Object.keys(details).length !== 0
        || new TextEncoder().encode(JSON.stringify(details)).byteLength > MAX_AUDIT_DETAILS_BYTES
      )
    ) return { kind:"invalid", spec:null };
    return { kind:"pending", spec:{ eventType, classification } };
  }

  if (
    eventType === "accepted_reconciled"
    && classification === "verified_auth"
    && acceptedState
  ) {
    return { kind:"pending", spec:{ eventType, classification } };
  }
  if (
    eventType === "accepted_profile_conflict"
    && ACCEPTED_PROFILE_AUDIT_CLASSIFICATIONS.has(classification)
    && Boolean(row?.accepted_at)
    && ["failed", "profile_pending"].includes(row?.status)
    && row?.profile_state === "failed"
    && row?.failure_code === classification
  ) {
    return { kind:"pending", spec:{ eventType, classification } };
  }
  if (
    eventType === "profile_created"
    && classification === "created"
    && row?.status === "profile_pending"
    && row?.send_state === "provider_accepted"
    && row?.profile_state === "created"
    && Boolean(row?.auth_user_id)
    && Boolean(row?.last_sent_at)
    && row?.failure_code === PROFILE_AUDIT_PENDING_CODE
  ) {
    return { kind:"pending", spec:{ eventType, classification } };
  }
  return { kind:"invalid", spec:null };
}

function pendingAuditSpec(row: InvitationRecord) {
  const state = pendingAuditState(row);
  if (state.kind === "invalid") {
    throw new StaffInvitationError(
      "audit_state_invalid",
      "The invitation has an invalid pending-audit state and requires operator review.",
      409,
      { invitation:row }
    );
  }
  return state.spec;
}

function pendingAuditBlocks(row: InvitationRecord) {
  return pendingAuditState(row).kind !== "none";
}

function retryActionAllowed(row: InvitationRecord) {
  if (pendingAuditBlocks(row)) return false;
  if (["dispatch_authorized", "provider_unknown"].includes(row.operation_state) || row.send_state === "unknown") return false;
  const recoverableFailure = row.send_state === "failed"
    && !([
      "existing_account_other_venue",
      "existing_account_inactive",
      "existing_account_role_conflict",
      "existing_account_active",
      "confirmed_account_unlinked"
    ] as readonly (string | null)[]).includes(row.failure_code);
  return row.status !== "accepted"
    && (
      ["reserved", "processing", "profile_pending"].includes(row.status)
      || (row.status === "failed" && (recoverableFailure || row.failure_code === "accepted_profile_missing"))
    );
}

function resendActionAllowed(row: InvitationRecord) {
  return !pendingAuditBlocks(row)
    && !["dispatch_authorized", "provider_unknown"].includes(row.operation_state)
    && !row.accepted_at
    && row.status !== "accepted"
    && row.send_state === "provider_accepted"
    && row.profile_state !== "failed"
    && ["sent", "failed"].includes(row.status);
}

function isFailedOwnedSend(row: InvitationRecord) {
  return row.send_state === "failed" && Boolean(row.auth_user_id && row.last_sent_at);
}

function publicInvitation(row: InvitationRecord, now: Date, cooldownSeconds: number, leaseSeconds = 300) {
  const sentAt = asTime(row.last_sent_at);
  const resendRemaining = sentAt
    ? Math.max(0, Math.ceil((sentAt + cooldownSeconds * 1000 - now.getTime()) / 1000))
    : 0;
  const providerAttemptAt = Math.max(asTime(row.last_provider_attempt_at), asTime(row.last_sent_at));
  const rateLimitRemaining = row.failure_code === "rate_limited" && providerAttemptAt
    ? Math.max(0, Math.ceil((providerAttemptAt + cooldownSeconds * 1000 - now.getTime()) / 1000))
    : 0;
  const failedSendRetryRemaining = isFailedOwnedSend(row)
    ? Math.max(0, Math.ceil((
      providerAttemptAt
        + cooldownSeconds * 1000
        - now.getTime()
    ) / 1000))
    : 0;
  const retryRemaining = Math.max(rateLimitRemaining, failedSendRetryRemaining);
  const leaseRemaining = row.status === "processing" && row.processing_started_at
    ? Math.max(0, Math.ceil((asTime(row.processing_started_at) + leaseSeconds * 1000 - now.getTime()) / 1000))
    : 0;
  const retryable = retryActionAllowed(row);
  const resendable = resendActionAllowed(row);
  const canRetry = retryable && retryRemaining === 0 && leaseRemaining === 0;
  const canResend = resendable && resendRemaining === 0;
  const remaining = retryable ? Math.max(retryRemaining, leaseRemaining) : (resendable ? resendRemaining : 0);
  const hideCrossVenueIdentity = isCrossVenueIdentityFailure(row.failure_code);

  return {
    id:row.id,
    full_name:row.full_name,
    email:row.email,
    role:row.requested_role,
    status:row.status,
    send_state:row.send_state,
    profile_state:row.profile_state,
    attempt_count:Number(row.attempt_count || 0),
    created_at:row.created_at,
    last_attempt_at:row.last_attempt_at,
    last_sent_at:row.last_sent_at,
    accepted_at:row.accepted_at,
    failure_code:hideCrossVenueIdentity ? PUBLIC_IDENTITY_UNAVAILABLE_CODE : (row.failure_code || null),
    failure_message:hideCrossVenueIdentity ? PUBLIC_IDENTITY_UNAVAILABLE_MESSAGE : (row.failure_message || null),
    can_retry:canRetry,
    can_resend:canResend,
    retry_after_seconds:remaining
  };
}

function responseHeaders(origin: string, allowedOrigins: ReadonlySet<string | null>, requestId: string) {
  const headers = new Headers({
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "x-content-type-options":"nosniff",
    "x-doorflow-request-id":requestId,
    "vary":"Origin"
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set(
      "access-control-allow-headers",
      "authorization, apikey, content-type, x-client-info, x-retry-count, traceparent, tracestate, baggage"
    );
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    headers.set("access-control-max-age", "600");
  }
  return headers;
}

function json(payload: unknown, status: number, headers: HeadersInit, extraHeaders: { "retry-after"?: number } = {}) {
  const next = new Headers(headers);
  Object.entries(extraHeaders).forEach(([key, value]) => next.set(key, String(value)));
  return new Response(JSON.stringify(payload), { status, headers:next });
}

function exactOrigin(value: unknown, environment: string) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512 || value.includes("*")) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== "/"
    || url.origin !== value
    || url.hostname.includes("*")
    || url.hostname.endsWith(".")
  ) return null;
  const loopback = isLoopbackHost(url.hostname);
  if (environment === "production") return url.protocol === "https:" && !loopback ? url.origin : null;
  if (environment !== "development") return null;
  return url.protocol === "http:" && loopback ? url.origin : null;
}

function buildConfig(rawConfig: StaffInvitationConfigInput): StaffInvitationConfig {
  const environment = typeof rawConfig.environment === "string" ? rawConfig.environment : "";
  const validEnvironment = environment === "production" || environment === "development";
  const rawOrigins: unknown[] = Array.isArray(rawConfig.allowedOrigins) ? rawConfig.allowedOrigins : [];
  const origins = rawOrigins.map(value => exactOrigin(value, environment));
  const cooldownSeconds = Number(rawConfig.cooldownSeconds);
  const leaseSeconds = Number(rawConfig.leaseSeconds);
  const providerTimeoutMs = Number(rawConfig.providerTimeoutMs);
  const redirectValue = typeof rawConfig.redirectUrl === "string" ? rawConfig.redirectUrl : "";
  let redirect = null;
  try {
    redirect = new URL(redirectValue);
  } catch {
    // Invalid configuration is represented below without leaking its value.
  }
  const validRedirect = Boolean(
    redirect
      && !redirect.username
      && !redirect.password
      && !redirect.search
      && !redirect.hash
      && redirect.pathname === "/auth/"
      && exactOrigin(redirect.origin, environment)
      && origins.includes(redirect.origin)
  );
  const valid = validEnvironment
    && rawOrigins.length > 0
    && rawOrigins.length <= 20
    && origins.every(Boolean)
    && new Set(origins).size === origins.length
    && Number.isInteger(cooldownSeconds)
    && cooldownSeconds >= 60
    && cooldownSeconds <= 86_400
    && Number.isInteger(leaseSeconds)
    && leaseSeconds >= 30
    && leaseSeconds <= 600
    && Number.isInteger(providerTimeoutMs)
    && providerTimeoutMs >= 1_000
    && providerTimeoutMs <= 120_000
    && (!rawConfig.enabled || validRedirect);
  return {
    valid,
    enabled:rawConfig.enabled === true,
    environment,
    redirectUrl:validRedirect ? (redirect as URL).href : "",
    allowedOrigins:new Set(origins.filter(Boolean)),
    cooldownSeconds:Number.isInteger(cooldownSeconds) ? cooldownSeconds : 300,
    leaseSeconds:Number.isInteger(leaseSeconds) ? leaseSeconds : 120,
    providerTimeoutMs:Number.isInteger(providerTimeoutMs) ? providerTimeoutMs : 30_000
  };
}

export async function readJson(request: Request): Promise<unknown> {
  const type = String(request.headers.get("content-type") || "").toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(type)) {
    throw new StaffInvitationError("invalid_content_type", "Send this request as application/json.", 415);
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new StaffInvitationError("invalid_content_length", "The request length is invalid.");
    }
    if (Number(declaredLength) > MAX_REQUEST_BYTES) {
      await request.body?.cancel("request too large").catch(() => {});
      throw new StaffInvitationError("request_too_large", "The request is too large.", 413);
    }
  }

  if (!request.body) {
    throw new StaffInvitationError("invalid_json", "Send a valid JSON request body.");
  }

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        await reader.cancel("invalid body chunk").catch(() => {});
        throw new StaffInvitationError("invalid_json", "Send a valid JSON request body.");
      }
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel("request too large").catch(() => {});
        throw new StaffInvitationError("request_too_large", "The request is too large.", 413);
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal:true }).decode(bytes);
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof StaffInvitationError) throw error;
    throw new StaffInvitationError("invalid_json", "Send a valid JSON request body.");
  } finally {
    reader.releaseLock();
  }
}

async function requireCurrentAdmin(deps: StaffInvitationDependencies, actor: ActorIdentity, venueId: string) {
  const profile = await deps.getStaffProfile(actor.user.id);
  if (!profile || !profile.active || profile.role !== "admin" || profile.venue_id !== venueId) {
    throw new StaffInvitationError("forbidden", "Active Admin access for this venue is required.", 403);
  }
  return profile;
}

function claimedRecord(claim: DecisionResult | null | undefined): InvitationRecord | null {
  return claim?.record || claim?.invitation || (claim?.id ? claim : null);
}

function throwClaimDecision(claim: DecisionResult, original: InvitationRecord, config: Pick<StaffInvitationConfig, "leaseSeconds">, code: string): never {
  if (typeof code !== "string") throw databaseContractError();
  const retryAfterSeconds = Math.max(0, Number(
    claim?.retryAfterSeconds ?? claim?.retry_after_seconds ?? config.leaseSeconds
  ));
  const messages: MessageDictionary<"attempt_in_progress"> = {
    forbidden:"Active Admin access for this venue is required.",
    resend_cooldown:"Wait before requesting another invitation email.",
    retry_cooldown:"Wait before retrying this invitation.",
    provider_outcome_unknown:"The earlier provider outcome is unresolved and must be reconciled before another email is sent.",
    operation_lost:"The invitation operation is no longer owned by this request.",
    email_operation_in_progress:"An invitation operation for this identity is already in progress.",
    attempt_in_progress:"This invitation is already being processed."
  };
  const status = code === "forbidden" ? 403 : (code.endsWith("cooldown") ? 429 : 409);
  throw new StaffInvitationError(code, messages[code] || messages.attempt_in_progress, status, {
    invitation:claimedRecord(claim) || original,
    retryAfterSeconds
  });
}

async function authorizeProviderDispatch(deps: StaffInvitationDependencies, row: InvitationRecord, actor: ActorIdentity, requestId: string) {
  await requireCurrentAdmin(deps, actor, row.venue_id);
  if (typeof deps.authorizeInvitationDispatch === "function") {
    const result = await deps.authorizeInvitationDispatch({
      invitationId:row.id,
      actorUserId:actor.user.id,
      operationToken:row.operation_token,
      expectedLease:row.processing_started_at,
      requestId
    });
    const code = requireDecisionCode(result, DISPATCH_DECISION_CODES);
    if (!["authorized", "dispatch_authorized"].includes(code)) {
      throwClaimDecision(result, row, { leaseSeconds:0 }, code);
    }
    const authorized = claimedRecord(result);
    if (!authorized) throw databaseContractError();
    return authorized;
  }
  return await updateClaimedInvitation(deps, row, {
    operation_state:"dispatch_authorized",
    dispatch_authorized_at:deps.now().toISOString(),
    last_provider_attempt_at:deps.now().toISOString()
  });
}

async function recordProviderOutcome(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string, outcome: ProviderOutcome, user: AuthIdentity | null = null) {
  if (typeof deps.recordInvitationProviderOutcome === "function") {
    const result = await deps.recordInvitationProviderOutcome({
      invitationId:row.id,
      operationToken:row.operation_token,
      actorUserId:actorId,
      outcome,
      providerAuthUserId:user?.id || null,
      providerNormalizedEmail:user?.email ? normalizeEmail(user.email) : null,
      requestId
    });
    const record = claimedRecord(result);
    const code = requireDecisionCode(result, PROVIDER_OUTCOME_DECISION_CODES);
    if (code === "audit_repair_required" && record) {
      throw new StaffInvitationError(
        "audit_repair_required",
        "The provider outcome is preserved, but its required audit evidence needs repair.",
        502,
        { invitation:record }
      );
    }
    const expected = outcome === "accepted"
      ? ["accepted", "provider_accepted", "invitation_resent"]
      : outcome === "identity_mismatch"
        ? ["identity_mismatch", "provider_identity_mismatch", "resend_identity_mismatch"]
        : ["unknown", "provider_outcome_unknown"];
    if (!expected.includes(code) || !record) {
      throw new StaffInvitationError(
        code === "forbidden" ? "forbidden" : "invitation_lease_lost",
        code === "forbidden"
          ? "Active Admin access for this venue is required."
          : "The invitation operation is no longer owned by this request.",
        code === "forbidden" ? 403 : 409,
        { invitation:record || row }
      );
    }
    return record;
  }

  const base = {
    operation_state:outcome === "accepted" ? "provider_accepted" : "provider_unknown",
    last_actor_user_id:actorId
  };
  if (outcome === "accepted") {
    return await updateClaimedInvitation(deps, row, {
      ...base,
      // The only caller forwards persistProviderOutcome's accepted overload,
      // which requires the non-null user verified by sendInvitation.
      auth_user_id:row.expected_auth_user_id || row.auth_user_id || (user as AuthIdentity).id,
      status:"profile_pending",
      send_state:"provider_accepted",
      profile_state:"pending",
      last_sent_at:deps.now().toISOString(),
      failure_code:null,
      failure_message:null
    }, "dispatch_authorized");
  }
  return await updateClaimedInvitation(deps, row, {
    ...base,
    status:"reconciliation_required",
    send_state:"unknown",
    processing_started_at:null,
    failure_code:outcome === "identity_mismatch"
      ? (row.expected_auth_user_id || row.auth_user_id ? "resend_identity_mismatch" : "provider_identity_mismatch")
      : "provider_outcome_unknown",
    failure_message:"An administrator must reconcile this invitation before another email is sent."
  }, "dispatch_authorized");
}

function persistProviderOutcome(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string, outcome: "accepted", user: AuthIdentity): Promise<InvitationRecord>;
function persistProviderOutcome(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string, outcome: "identity_mismatch" | "unknown", user?: AuthIdentity | null): Promise<InvitationRecord>;
async function persistProviderOutcome(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string, outcome: ProviderOutcome, user: AuthIdentity | null = null) {
  try {
    return await recordProviderOutcome(deps, row, actorId, requestId, outcome, user);
  } catch (error) {
    if (error instanceof StaffInvitationError) throw error;
    // Dispatch already crossed the external boundary. A failed or lost
    // persistence response cannot prove what the provider or database did, so
    // retain the dispatch-authorized fence and require reconciliation.
    throw new StaffInvitationError(
      "provider_outcome_unknown",
      "The invitation provider outcome is unknown. Reconcile this record before retrying.",
      502,
      { invitation:row }
    );
  }
}

async function reconcileObservedIdentity(deps: StaffInvitationDependencies, row: InvitationRecord, actor: ActorIdentity, requestId: string, user: AuthIdentity | null) {
  await requireCurrentAdmin(deps, actor, row.venue_id);
  if (typeof deps.reconcileInvitation !== "function") return null;
  const result = await deps.reconcileInvitation({
    invitationId:row.id,
    actorUserId:actor.user.id,
    operationToken:row.operation_token || deps.operationUUID?.() || deps.randomUUID(),
    requestId,
    expectedUpdatedAt:row.updated_at,
    observedAuthUserId:user?.id || null,
    observedNormalizedEmail:user?.email ? normalizeEmail(user.email) : null,
    observedEmailConfirmedAt:user?.email_confirmed_at || null,
    observedInvitedAt:user?.invited_at || null
  });
  const code = requireDecisionCode(result, RECONCILIATION_DECISION_CODES);
  const record = claimedRecord(result);
  if (code === "forbidden") {
    throw new StaffInvitationError("forbidden", "Active Admin access for this venue is required.", 403);
  }
  if (!record) throwClaimDecision(result, row, { leaseSeconds:0 }, code);
  if (code === "audit_repair_required") {
    throw new StaffInvitationError(
      "audit_repair_required",
      "The reconciliation result is preserved, but its required audit evidence needs repair.",
      502,
      { invitation:record }
    );
  }
  return { code, record };
}

async function callProviderOnce(deps: StaffInvitationDependencies, email: string, options: InviteProviderOptions, timeoutMs: number, operationContext: ProviderOperationContext) {
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => deps.inviteUserByEmail(email, options, operationContext)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("provider timeout"), {
          code:"provider_timeout",
          status:504
        })), duration);
      })
    ]);
  } catch (error) {
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requireAdmin(request: Request, deps: StaffInvitationDependencies): Promise<Actor> {
  const token = bearerToken(request);
  let user;
  try {
    user = await deps.verifyUserToken(token);
  } catch {
    throw new StaffInvitationError("invalid_credentials", "The staff session is invalid or expired.", 401);
  }
  if (!user?.id) throw new StaffInvitationError("invalid_credentials", "The staff session is invalid or expired.", 401);

  const profile = await deps.getStaffProfile(user.id);
  if (!profile || !profile.active || profile.role !== "admin" || !profile.venue_id) {
    throw new StaffInvitationError("forbidden", "Active Admin access for an assigned venue is required.", 403);
  }
  return { user, profile:profile as StaffProfile & { venue_id: string }, token };
}

async function appendAudit(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, eventType: string, classification: string, requestId: string, details: unknown = {}, auditId = "") {
  await deps.appendAudit({
    ...(auditId ? { id:auditId } : {}),
    invitation_id:row.id,
    actor_user_id:actorId,
    venue_id:row.venue_id,
    event_type:eventType,
    classification,
    request_id:requestId,
    details:redactDetails(details, eventType)
  });
}

async function deterministicAuditId(row: InvitationRecord, spec: AuditSpec) {
  if (spec.eventType === "accepted_reconciled" && spec.classification === "verified_auth") {
    return row.id;
  }
  const digest = (await sha256Hex(
    `doorflow-staff-invitation-audit\n${row.id}\n${row.operation_token || "legacy"}\n${spec.eventType}\n${spec.classification}`
  )).slice(0, 32).split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16], 16) & 3) | 8).toString(16);
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalAuditMatches(audit: AuditEntry | null, auditId: string, row: InvitationRecord, spec: AuditSpec, actorId: string | null, requestId: string | null) {
  return Boolean(
    audit
      && audit.id === auditId
      && audit.invitation_id === row.id
      && audit.venue_id === row.venue_id
      && audit.event_type === spec.eventType
      && audit.classification === spec.classification
      && (!actorId || audit.actor_user_id === actorId)
      && (!requestId || audit.request_id === requestId)
      && JSON.stringify(audit.details || {}) === "{}"
  );
}

async function appendPendingAudit(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string) {
  const spec = pendingAuditSpec(row);
  if (!spec) throw new StaffInvitationError("audit_state_invalid", "The pending audit state is invalid.", 500);
  const auditId = await deterministicAuditId(row, spec);
  const recordedActorId = row.pending_audit_originating_actor_user_id || null;
  const recordedRequestId = row.pending_audit_originating_request_id || null;
  const originalActorId = recordedActorId || actorId;
  const originalRequestId = recordedRequestId || requestId;
  try {
    await appendAudit(
      deps,
      row,
      originalActorId,
      spec.eventType,
      spec.classification,
      originalRequestId,
      {},
      auditId
    );
  } catch (error) {
    if ((error as ErrorCodeView)?.code === "23505") {
      const existing = await deps.getAuditById(auditId);
      if (canonicalAuditMatches(existing, auditId, row, spec, recordedActorId, recordedRequestId)) return;
      throw new StaffInvitationError(
        "audit_id_collision",
        "The pending audit record could not be verified safely.",
        500
      );
    }
    throw error;
  }
}

async function completePendingAudit(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string, throwOnFailure: boolean) {
  try {
    await appendPendingAudit(deps, row, actorId, requestId);
  } catch {
    let pending = row;
    try {
      pending = await updateClaimedInvitation(deps, row, {
        processing_started_at:null,
        last_actor_user_id:actorId
      });
    } catch {
      // The truthful state and its pending marker remain durable. A later
      // authorized repair may take over this lease after it becomes stale.
    }
    if (throwOnFailure) {
      throw new StaffInvitationError(
        ACCEPTED_AUDIT_PENDING_CODE,
        ACCEPTED_AUDIT_PENDING_MESSAGE,
        502,
        { invitation:pending }
      );
    }
    return pending;
  }

  const cleanup = {
    processing_started_at:null,
    last_actor_user_id:actorId,
    pending_audit_event_type:null,
    pending_audit_classification:null,
    pending_audit_originating_actor_user_id:null,
    pending_audit_originating_request_id:null,
    pending_audit_operation_token:null,
    pending_audit_details:null,
    failure_code:(row.status === "accepted" && row.failure_code === ACCEPTED_AUDIT_PENDING_CODE)
      || row.failure_code === PROFILE_AUDIT_PENDING_CODE
      ? null
      : row.failure_code,
    failure_message:(row.status === "accepted" && row.failure_code === ACCEPTED_AUDIT_PENDING_CODE)
      || row.failure_code === PROFILE_AUDIT_PENDING_CODE
      ? null
      : row.failure_message
  };
  return await updateClaimedInvitation(deps, row, cleanup);
}

async function repairPendingAudit(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string, config: StaffInvitationConfig) {
  if (!pendingAuditSpec(row)) return row;
  await requireCurrentAdmin(deps, { user:{ id:actorId } }, row.venue_id);
  if (typeof deps.repairInvitationAudit === "function") {
    const result = await deps.repairInvitationAudit({
      invitationId:row.id,
      actorUserId:actorId,
      operationToken:deps.operationUUID?.() || deps.randomUUID(),
      requestId
    });
    const record = claimedRecord(result);
    const code = requireDecisionCode(result, AUDIT_REPAIR_DECISION_CODES);
    if (["audit_repaired", "no_pending_audit"].includes(code) && record) return record;
    if (code === "forbidden") {
      throw new StaffInvitationError("forbidden", "Active Admin access for this venue is required.", 403);
    }
    if (code === "audit_id_collision") {
      throw new StaffInvitationError(
        "audit_id_collision",
        "The pending audit record conflicts with different canonical evidence.",
        500,
        { invitation:record || row }
      );
    }
    throw new StaffInvitationError(
      code === "audit_state_invalid" ? "audit_state_invalid" : "audit_repair_failed",
      "The pending audit evidence could not be repaired safely.",
      409,
      {
      invitation:record || row
      }
    );
  }

  const now = deps.now();
  let expectedLease = null;
  if (row.processing_started_at) {
    const staleBefore = now.getTime() - config.leaseSeconds * 1000;
    if (asTime(row.processing_started_at) >= staleBefore) return row;
    expectedLease = row.processing_started_at;
  }

  let claimed;
  try {
    claimed = await deps.updateInvitation(row.id, {
      processing_started_at:now.toISOString(),
      last_actor_user_id:actorId
    }, expectedLease, {
      accepted_at:row.accepted_at,
      status:row.status,
      updated_at:row.updated_at,
      pending_audit_event_type:row.pending_audit_event_type || null,
      pending_audit_classification:row.pending_audit_classification || null,
      ...(row.pending_audit_operation_token
        ? { pending_audit_operation_token:row.pending_audit_operation_token }
        : {})
    });
  } catch (error) {
    if ((error as ErrorCodeView)?.code === "invitation_lease_lost") {
      return await deps.getInvitationById(row.id) || row;
    }
    throw error;
  }
  return await completePendingAudit(deps, claimed, actorId, requestId, false);
}

async function updateClaimedInvitation(deps: StaffInvitationDependencies, row: InvitationRecord, changes: InvitationChanges, expectedOperationState: string | undefined = undefined) {
  if (!row?.processing_started_at) {
    throw new StaffInvitationError("invitation_lease_lost", "The invitation processing lease is no longer active.", 409);
  }
  try {
    const expectedState: InvitationExpectedState = {};
    if (row.operation_token) expectedState.operation_token = row.operation_token;
    if (expectedOperationState) expectedState.operation_state = expectedOperationState;
    return await deps.updateInvitation(
      row.id,
      changes,
      row.processing_started_at,
      Object.keys(expectedState).length ? expectedState : undefined
    );
  } catch (error) {
    if ((error as ErrorCodeView)?.code === "invitation_lease_lost") {
      throw new StaffInvitationError(
        "invitation_lease_lost",
        "A newer invitation attempt took over this record. Refresh before trying again.",
        409
      );
    }
    throw error;
  }
}

async function updateFailure(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string, failure: { code: string; message: string }, overrides: InvitationChanges = {}) {
  const updated = await updateClaimedInvitation(deps, row, {
    status:"failed",
    processing_started_at:null,
    last_actor_user_id:actorId,
    failure_code:failure.code,
    failure_message:failure.message,
    ...overrides
  });
  try {
    await appendAudit(deps, updated, actorId, "attempt_failed", failure.code, requestId);
  } catch {
    // The invitation row remains the durable failure record. Do not hide the
    // original safe error with a second audit-write error.
  }
  return updated;
}

async function updateReconciliation(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string, code: string, sendState = "unknown") {
  const updated = await updateClaimedInvitation(deps, row, {
    status:"reconciliation_required",
    send_state:sendState,
    processing_started_at:null,
    last_actor_user_id:actorId,
    failure_code:code,
    failure_message:"An administrator must reconcile this invitation before another email is sent."
  });
  try {
    await appendAudit(deps, updated, actorId, "reconciliation_required", code, requestId);
  } catch {
    // The server-owned invitation row still preserves the ambiguity.
  }
  return updated;
}

async function ensureProfile(deps: StaffInvitationDependencies, row: InvitationRecord, user: AuthIdentity, actorId: string, requestId: string) {
  await requireCurrentAdmin(deps, { user:{ id:actorId } }, row.venue_id);

  if (typeof deps.finalizeInvitationProfile === "function") {
    const result = await deps.finalizeInvitationProfile({
      invitationId:row.id,
      operationToken:row.operation_token,
      actorUserId:actorId,
      authUser:{ id:user.id, email:normalizeEmail(user.email) },
      requestId
    });
    let code = requireDecisionCode(result, PROFILE_DECISION_CODES);
    if (code === "conflict") {
      const conflictCode = result?.conflictCode ?? result?.conflict_code;
      if (!(PROFILE_CONFLICT_CODES as ReadonlySet<unknown>).has(conflictCode)) throw databaseContractError();
      code = conflictCode as string;
    }
    const record = claimedRecord(result) || row;
    if (["created", "existing"].includes(code) && result?.profile) {
      return { profile:result.profile, state:code, row:record };
    }
    const messages: MessageDictionary<"profile_write_failed"> = {
      existing_account_other_venue:"The Auth account belongs to another venue and was not changed.",
      existing_account_inactive:"The existing staff account is inactive and was not reactivated.",
      existing_account_role_conflict:"The existing staff role differs from this invitation and was not changed.",
      forbidden:"Active Admin access for this venue is required.",
      profile_write_failed:"The invitation provider accepted the email, but staff profile setup failed. Retry setup; do not resend yet.",
      profile_audit_pending:PROFILE_AUDIT_PENDING_MESSAGE,
      audit_repair_required:"The profile result is preserved, but required audit evidence needs repair.",
      operation_lost:"The invitation operation is no longer owned by this request.",
      coordination_lease_expired:"The invitation coordination lease expired before profile finalization."
    };
    throw new StaffInvitationError(
      code,
      messages[code] || messages.profile_write_failed,
      code === "forbidden" ? 403 : (
        code.startsWith("existing_account_")
          || ["operation_lost", "coordination_lease_expired"].includes(code)
          ? 409
          : 502
      ),
      { invitation:record }
    );
  }

  const existing = await deps.getStaffProfile(user.id);
  if (existing) {
    const conflict = profileConflict(existing, row.venue_id, row.requested_role);
    if (conflict && conflict !== "existing_account_active") {
      const messages = {
        existing_account_other_venue:"The Auth account belongs to another venue and was not changed.",
        existing_account_inactive:"The existing staff account is inactive and was not reactivated.",
        existing_account_role_conflict:"The existing staff role differs from this invitation and was not changed."
      };
      const failed = await updateFailure(
        deps,
        row,
        actorId,
        requestId,
        { code:conflict, message:messages[conflict] },
        { profile_state:"failed" }
      );
      throw new StaffInvitationError(conflict, messages[conflict], 409, { invitation:failed });
    }
    return { profile:existing, state:"existing" };
  }

  let profile;
  try {
    await requireCurrentAdmin(deps, { user:{ id:actorId } }, row.venue_id);
    profile = await deps.createStaffProfile({
      id:user.id,
      full_name:row.full_name,
      role:row.requested_role,
      active:true,
      venue_id:row.venue_id
    });
  } catch (error) {
    // An interrupted concurrent request may have inserted the exact profile.
    const raced = await deps.getStaffProfile(user.id);
    if (raced && profileConflict(raced, row.venue_id, row.requested_role) === "existing_account_active") {
      return { profile:raced, state:"existing" };
    }

    const failed = await updateClaimedInvitation(deps, row, {
      status:"profile_pending",
      profile_state:"failed",
      processing_started_at:null,
      last_actor_user_id:actorId,
      failure_code:"profile_write_failed",
      failure_message:"The invitation provider accepted the email, but the staff profile still needs setup."
    });
    try {
      await appendAudit(deps, failed, actorId, "profile_failed", "profile_write_failed", requestId);
    } catch {
      // The invitation row retains the partial-failure evidence.
    }
    throw new StaffInvitationError(
      "profile_write_failed",
      "The invitation provider accepted the email, but staff profile setup failed. Retry setup; do not resend yet.",
      502,
      { invitation:failed }
    );
  }

  try {
    await appendAudit(deps, row, actorId, "profile_created", "created", requestId);
  } catch {
    const pending = await updateClaimedInvitation(deps, row, {
      status:"profile_pending",
      profile_state:"created",
      processing_started_at:null,
      last_actor_user_id:actorId,
      failure_code:PROFILE_AUDIT_PENDING_CODE,
      failure_message:PROFILE_AUDIT_PENDING_MESSAGE,
      pending_audit_event_type:"profile_created",
      pending_audit_classification:"created",
      pending_audit_originating_actor_user_id:actorId,
      pending_audit_originating_request_id:requestId,
      pending_audit_operation_token:row.operation_token || deps.operationUUID?.() || deps.randomUUID(),
      pending_audit_details:{}
    });
    throw new StaffInvitationError(
      PROFILE_AUDIT_PENDING_CODE,
      PROFILE_AUDIT_PENDING_MESSAGE,
      502,
      { invitation:pending }
    );
  }
  return { profile, state:"created", row };
}

async function sendInvitation(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string, config: StaffInvitationConfig) {
  const claimedExpectedAuthUserId = row.expected_auth_user_id || row.auth_user_id || null;
  const claimedOperationToken = row.operation_token;
  if (!claimedExpectedAuthUserId && (typeof claimedOperationToken !== "string" || !UUID_PATTERN.test(claimedOperationToken))) {
    throw new StaffInvitationError(
      "operation_lost",
      "The invitation operation is no longer owned by this request.",
      409,
      { invitation:row }
    );
  }
  const creationMarker = claimedExpectedAuthUserId
    ? null
    : await sha256Hex(`doorflow-staff-invitation-provider-creation\n${claimedOperationToken}`);
  row = await authorizeProviderDispatch(deps, row, { user:{ id:actorId } }, requestId);
  const expectedAuthUserId = row.expected_auth_user_id || row.auth_user_id || null;
  if (expectedAuthUserId !== claimedExpectedAuthUserId || row.operation_token !== claimedOperationToken) {
    throw new StaffInvitationError(
      "operation_lost",
      "The invitation operation is no longer owned by this request.",
      409,
      { invitation:row }
    );
  }
  let user;
  try {
    user = await callProviderOnce(deps, row.email, {
      redirectTo:config.redirectUrl,
      data:{
        full_name:row.full_name,
        ...(!expectedAuthUserId ? { [PROVIDER_CREATION_MARKER_KEY]:creationMarker } : {})
      }
    }, config.providerTimeoutMs, {
      expectedAuthUserId,
      operationToken:row.operation_token
    });
  } catch {
    const pending = await persistProviderOutcome(deps, row, actorId, requestId, "unknown");
    throw new StaffInvitationError(
      "provider_outcome_unknown",
      "The invitation provider outcome is unknown. Reconcile this record before retrying.",
      502,
      { invitation:pending }
    );
  }

  if (
    !user?.id
    || normalizeEmail(user.email) !== row.normalized_email
    || (expectedAuthUserId && user.id !== expectedAuthUserId)
    || (!expectedAuthUserId && providerCreationMarker(user) !== creationMarker)
  ) {
    const pending = await persistProviderOutcome(deps, row, actorId, requestId, "identity_mismatch", user);
    const mismatchCode = expectedAuthUserId ? "resend_identity_mismatch" : "provider_identity_mismatch";
    throw new StaffInvitationError(
      mismatchCode,
      "The invitation provider returned an unexpected identity. Reconciliation is required.",
      502,
      { invitation:pending }
    );
  }

  const sent = await persistProviderOutcome(deps, row, actorId, requestId, "accepted", user);
  if (typeof deps.recordInvitationProviderOutcome !== "function") {
    try {
      await appendAudit(deps, sent, actorId, "provider_accepted", "provider_accepted", requestId);
    } catch {
      const pending = await updateReconciliation(
        deps,
        sent,
        actorId,
        requestId,
        "audit_write_failed_after_send",
        sent.send_state
      );
      throw new StaffInvitationError(
        "audit_write_failed_after_send",
        "The provider accepted the request, but audit recording needs reconciliation before retrying.",
        502,
        { invitation:pending }
      );
    }
  }
  return { row:sent, user };
}

async function processInvitation(deps: StaffInvitationDependencies, original: InvitationRecord, actor: ActorIdentity, action: InvitationAction, requestId: string, config: StaffInvitationConfig) {
  // The snapshot passed into this function is display context only. Current
  // authorization, state, cooldown and unresolved-dispatch fencing are decided
  // atomically by the database claim using database time.
  await requireCurrentAdmin(deps, actor, original.venue_id);
  const operationToken = deps.operationUUID?.() || deps.randomUUID();
  const claim = await deps.claimInvitation({
    invitationId:original.id,
    actorUserId:actor.user.id,
    action,
    operationToken,
    cooldownSeconds:config.cooldownSeconds,
    leaseSeconds:config.leaseSeconds,
    requestId
  });
  let row = claimedRecord(claim);
  const claimCode = requireDecisionCode(claim, CLAIM_DECISION_CODES);
  if (claimCode === "operation_replay" && row) {
    const sameOperation = row.operation_token === operationToken
      && row.operation_action === action
      && row.operation_actor_user_id === actor.user.id
      && row.operation_request_id === requestId;
    if (!sameOperation) {
      throwClaimDecision(claim, original, config, "operation_lost");
    }
    if (["dispatch_authorized", "provider_unknown"].includes(row.operation_state)) {
      throwClaimDecision(claim, row, config, "provider_outcome_unknown");
    }
    if (row.operation_state === "completed") {
      if (!row.failure_code && !pendingAuditSpec(row) && ["sent", "accepted"].includes(row.status)) {
        return row;
      }
      throw new StaffInvitationError(
        row.failure_code || "operation_completed_with_recovery_required",
        "The earlier operation completed, but this invitation still requires recovery.",
        409,
        { invitation:row }
      );
    }
    if (!["claimed", "provider_accepted"].includes(row.operation_state)) {
      throwClaimDecision(claim, row, config, "attempt_in_progress");
    }
  } else if (!row || !["authorized", "claimed"].includes(claimCode)) {
    throwClaimDecision(claim, original, config, claimCode);
  }
  if (claimCode !== "operation_replay" && (typeof deps.claimIncludesAudit !== "boolean" || !deps.claimIncludesAudit)) {
    await appendAudit(deps, row, actor.user.id, "attempt_started", action, requestId, { attempt_count:row.attempt_count });
  }

  let authUser = null;
  let foundByStoredId = false;
  if (row.auth_user_id) {
    await requireCurrentAdmin(deps, actor, row.venue_id);
    authUser = await deps.getAuthUserById(row.auth_user_id);
    foundByStoredId = Boolean(authUser);
    if (authUser && normalizeEmail(authUser.email) !== row.normalized_email) {
      const reconciled = await reconcileObservedIdentity(deps, row, actor, requestId, authUser);
      if (reconciled) {
        throw new StaffInvitationError(
          reconciled.record.failure_code || "stored_auth_identity_mismatch",
          "The stored Auth identity does not match this invitation. Reconciliation is required.",
          409,
          { invitation:reconciled.record }
        );
      }
      const pending = await updateReconciliation(deps, row, actor.user.id, requestId, "stored_auth_identity_mismatch");
      throw new StaffInvitationError(
        "stored_auth_identity_mismatch",
        "The stored Auth identity does not match this invitation. Reconciliation is required.",
        409,
        { invitation:pending }
      );
    }
  }

  if (!authUser) {
    await requireCurrentAdmin(deps, actor, row.venue_id);
    const lookup = typeof deps.lookupAuthUserByEmail === "function"
      ? await deps.lookupAuthUserByEmail(row.normalized_email, actor.user.id, row.venue_id)
      : { user:null, complete:false };
    if (!lookup?.complete) {
      const reconciled = await reconcileObservedIdentity(deps, row, actor, requestId, null);
      if (reconciled) {
        throw new StaffInvitationError(
          reconciled.record.failure_code || "exact_auth_lookup_unavailable",
          "The exact Auth account lookup is unavailable. Reconciliation is required.",
          503,
          { invitation:reconciled.record }
        );
      }
      const pending = await updateReconciliation(
        deps,
        row,
        actor.user.id,
        requestId,
        "exact_auth_lookup_unavailable",
        row.send_state
      );
      throw new StaffInvitationError(
        "exact_auth_lookup_unavailable",
        "The exact Auth account lookup is unavailable. Reconciliation is required.",
        503,
        { invitation:pending }
      );
    }
    authUser = lookup.user || null;
  }

  // auth_user_id alone is not ownership evidence: blocked pre-existing users are
  // recorded for reconciliation too. last_sent_at is written only after the
  // invite provider returns this exact identity successfully.
  const ownsAuthIdentity = Boolean(
    row.auth_user_id
      && row.last_sent_at
      && authUser
      && row.auth_user_id === authUser.id
      && foundByStoredId
  );
  if (authUser && !ownsAuthIdentity) {
    const reconciled = await reconcileObservedIdentity(deps, row, actor, requestId, authUser);
    if (reconciled) {
      const reconciledCode = reconciled.record.failure_code || reconciled.code || "reconciliation_required";
      const reconciledMessages: MessageDictionary = {
        existing_account_other_venue:"An account with this email belongs to another venue and was not changed.",
        existing_account_inactive:"An inactive staff account already uses this email and was not reactivated.",
        existing_account_role_conflict:"An existing staff account has a different role and was not changed.",
        existing_account_active:"An active staff account already uses this email.",
        confirmed_account_unlinked:"A confirmed Auth account already uses this email and was not linked automatically.",
        unowned_pending_auth_account:"An unconfirmed Auth account already uses this email. Reconciliation is required before sending."
      };
      throw new StaffInvitationError(
        reconciledCode,
        reconciledMessages[reconciledCode] || "The existing Auth identity requires reconciliation.",
        409,
        { invitation:reconciled.record }
      );
    }
    const existingProfile = await deps.getStaffProfile(authUser.id);
    const conflict = profileConflict(existingProfile, row.venue_id, row.requested_role);
    const messages = {
      existing_account_other_venue:"An account with this email belongs to another venue and was not changed.",
      existing_account_inactive:"An inactive staff account already uses this email and was not reactivated.",
      existing_account_role_conflict:"An existing staff account has a different role and was not changed.",
      existing_account_active:"An active staff account already uses this email.",
      confirmed_account_unlinked:"A confirmed Auth account already uses this email and was not linked automatically.",
      unowned_pending_auth_account:"An unconfirmed Auth account already uses this email. Reconciliation is required before sending."
    };

    if (conflict) {
      const failed = await updateFailure(
        deps,
        row,
        actor.user.id,
        requestId,
        { code:conflict, message:messages[conflict] },
        { profile_state:"existing" }
      );
      throw new StaffInvitationError(conflict, messages[conflict], 409, { invitation:failed });
    }

    if (isConfirmed(authUser)) {
      const pending = await updateReconciliation(
        deps,
        row,
        actor.user.id,
        requestId,
        "confirmed_account_unlinked",
        row.send_state
      );
      throw new StaffInvitationError("confirmed_account_unlinked", messages.confirmed_account_unlinked, 409, { invitation:pending });
    }

    const pending = await updateReconciliation(
      deps,
      row,
      actor.user.id,
      requestId,
      "unowned_pending_auth_account",
      row.send_state
    );
    throw new StaffInvitationError(
      "unowned_pending_auth_account",
      messages.unowned_pending_auth_account,
      409,
      { invitation:pending }
    );
  }

  if (!authUser && row.auth_user_id) {
    const reconciled = await reconcileObservedIdentity(deps, row, actor, requestId, null);
    if (reconciled) {
      throw new StaffInvitationError(
        reconciled.record.failure_code || "stored_auth_user_missing",
        "The invitation's Auth account could not be found. Reconciliation is required.",
        409,
        { invitation:reconciled.record }
      );
    }
    const pending = await updateReconciliation(deps, row, actor.user.id, requestId, "stored_auth_user_missing");
    throw new StaffInvitationError(
      "stored_auth_user_missing",
      "The invitation's Auth account could not be found. Reconciliation is required.",
      409,
      { invitation:pending }
    );
  }

  if (!authUser && ["unknown", "provider_accepted"].includes(row.send_state)) {
    const pending = await updateReconciliation(deps, row, actor.user.id, requestId, "provider_outcome_unknown");
    throw new StaffInvitationError(
      "provider_outcome_unknown",
      "The earlier provider outcome is unknown. Reconcile this record before another email is sent.",
      409,
      { invitation:pending }
    );
  }

  if (!authUser) {
    ({ row, user:authUser } = await sendInvitation(deps, row, actor.user.id, requestId, config));
  }

  if (isConfirmed(authUser)) {
    const acceptedProfileRecovery = action === "retry"
      && Boolean(row.accepted_at)
      && row.profile_state === "failed"
      && (["accepted_profile_missing", "profile_write_failed"] as readonly (string | null)[]).includes(row.failure_code);
    if (typeof deps.reconcileInvitation === "function" && !acceptedProfileRecovery) {
      await requireCurrentAdmin(deps, actor, row.venue_id);
      const reconciled = await deps.reconcileInvitation({
        invitationId:row.id,
        actorUserId:actor.user.id,
        operationToken:row.operation_token,
        requestId,
        expectedUpdatedAt:row.updated_at,
        observedAuthUserId:authUser.id,
        observedNormalizedEmail:normalizeEmail(authUser.email),
        // This branch already requires isConfirmed(authUser), whose existing
        // timestamp truthiness check excludes null, undefined, and empty text.
        observedEmailConfirmedAt:authUser.email_confirmed_at as string,
        observedInvitedAt:authUser.invited_at || null
      });
      const record = claimedRecord(reconciled);
      const code = requireDecisionCode(reconciled, RECONCILIATION_DECISION_CODES);
      if (code === "audit_repair_required" && record) {
        throw new StaffInvitationError(
          "accepted_audit_pending",
          ACCEPTED_AUDIT_PENDING_MESSAGE,
          502,
          { invitation:record }
        );
      }
      if (!record || ["forbidden", "operation_lost", "conflict"].includes(code)) {
        throwClaimDecision(reconciled, row, config, code);
      }
      return record;
    }
    const profile = await ensureProfile(deps, row, authUser, actor.user.id, requestId);
    row = profile.row || row;
    if (typeof deps.finalizeInvitationProfile === "function") return row;
    const accepted = await updateClaimedInvitation(deps, row, {
      status:"accepted",
      profile_state:profile.state,
      accepted_at:row.accepted_at || deps.now().toISOString(),
      last_actor_user_id:actor.user.id,
      failure_code:ACCEPTED_AUDIT_PENDING_CODE,
      failure_message:ACCEPTED_AUDIT_PENDING_MESSAGE,
      pending_audit_event_type:"accepted_reconciled",
      pending_audit_classification:"verified_auth",
      pending_audit_originating_actor_user_id:actor.user.id,
      pending_audit_originating_request_id:requestId,
      pending_audit_operation_token:row.operation_token || deps.operationUUID?.() || deps.randomUUID(),
      pending_audit_details:{}
    });
    return await completePendingAudit(deps, accepted, actor.user.id, requestId, true);
  }

  const retryingClaimedFailedSend = action === "retry" && isFailedOwnedSend(row);
  if (action === "resend" || retryingClaimedFailedSend) {
    await requireCurrentAdmin(deps, actor, row.venue_id);
    const existingProfile = await deps.getStaffProfile(authUser.id);
    const conflict = profileConflict(existingProfile, row.venue_id, row.requested_role);
    if (conflict !== "existing_account_active") {
      const code = conflict || "profile_retry_required";
      const messages: MessageDictionary<
        "existing_account_other_venue" | "existing_account_inactive"
        | "existing_account_role_conflict" | "profile_retry_required"
      > = {
        existing_account_other_venue:"The Auth account belongs to another venue and was not changed.",
        existing_account_inactive:"The existing staff account is inactive and was not reactivated.",
        existing_account_role_conflict:"The existing staff role differs from this invitation and was not changed.",
        profile_retry_required:"Finish the staff profile setup before resending the invitation."
      };
      const reconciled = await reconcileObservedIdentity(deps, row, actor, requestId, authUser);
      if (reconciled) {
        const reconciledCode = reconciled.record.failure_code || code;
        throw new StaffInvitationError(
          reconciledCode,
          messages[reconciledCode] || messages.profile_retry_required,
          409,
          { invitation:reconciled.record }
        );
      }
      const failed = await updateFailure(deps, row, actor.user.id, requestId, {
        code,
        message:messages[code]
      }, { profile_state:"failed" });
      throw new StaffInvitationError(code, messages[code], 409, { invitation:failed });
    }
    const resent = await sendInvitation(deps, row, actor.user.id, requestId, config);
    row = resent.row;
  }

  const profile = await ensureProfile(deps, row, authUser, actor.user.id, requestId);
  row = profile.row || row;
  if (typeof deps.finalizeInvitationProfile === "function") {
    return row;
  }

  if (action === "resend" || retryingClaimedFailedSend) {
    row = await updateClaimedInvitation(deps, row, {
      status:"sent",
      profile_state:profile.state,
      processing_started_at:null,
      last_actor_user_id:actor.user.id,
      failure_code:null,
      failure_message:null
    });
    await appendAudit(
      deps,
      row,
      actor.user.id,
      action === "resend" ? "invitation_resent" : "invitation_send_retried",
      "provider_accepted",
      requestId
    );
  } else {
    row = await updateClaimedInvitation(deps, row, {
      status:"sent",
      profile_state:profile.state,
      processing_started_at:null,
      last_actor_user_id:actor.user.id,
      failure_code:null,
      failure_message:null
    });
    await appendAudit(deps, row, actor.user.id, "provisioning_completed", "sent", requestId);
  }
  return row;
}

async function transitionFromList(deps: StaffInvitationDependencies, row: InvitationRecord, changes: InvitationChanges) {
  return await deps.updateInvitation(row.id, changes, null, {
    accepted_at:null,
    status:row.status,
    updated_at:row.updated_at
  });
}

async function transitionAcceptedFromList(deps: StaffInvitationDependencies, row: InvitationRecord, actorId: string, requestId: string, changes: InvitationChanges) {
  return await transitionFromList(deps, row, {
    ...changes,
    accepted_at:deps.now().toISOString(),
    processing_started_at:deps.now().toISOString(),
    last_actor_user_id:actorId,
    pending_audit_event_type:changes.status === "accepted"
      ? "accepted_reconciled"
      : "accepted_profile_conflict",
    pending_audit_classification:changes.status === "accepted"
      ? "verified_auth"
      : changes.failure_code,
    pending_audit_originating_actor_user_id:actorId,
    pending_audit_originating_request_id:requestId,
    pending_audit_operation_token:row.operation_token || deps.operationUUID?.() || deps.randomUUID(),
    pending_audit_details:{}
  });
}

async function reconcileAcceptedRows(deps: StaffInvitationDependencies, rows: InvitationRecord[], actor: ActorIdentity, requestId: string, config: StaffInvitationConfig) {
  const reconciled = [];
  for (const current of rows) {
    await requireCurrentAdmin(deps, actor, current.venue_id);
    let row = current;
    if (pendingAuditSpec(row)) {
      row = await repairPendingAudit(deps, row, actor.user.id, requestId, config);
      reconciled.push(row);
      continue;
    }
    if (
      ["dispatch_authorized", "provider_unknown", "provider_outcome_unknown"].includes(row.operation_state)
      && row.operation_token
      && typeof deps.recoverInvitationDispatch === "function"
    ) {
      let lookupComplete = false;
      let observedUser = null;
      try {
        const storedIdentity = row.auth_user_id || row.expected_auth_user_id || null;
        if (storedIdentity) {
          observedUser = await deps.getAuthUserById(storedIdentity);
          lookupComplete = true;
        } else if (typeof deps.lookupAuthUserByEmail === "function") {
          const lookup = await deps.lookupAuthUserByEmail(
            row.normalized_email,
            actor.user.id,
            row.venue_id
          );
          observedUser = lookup?.user || null;
          lookupComplete = lookup?.complete === true;
        }
      } catch {
        // A failed observation is recorded as incomplete. It is never treated
        // as proof that no provider operation occurred.
      }
      await requireCurrentAdmin(deps, actor, row.venue_id);
      const recovery = await deps.recoverInvitationDispatch({
        invitationId:row.id,
        actorUserId:actor.user.id,
        operationToken:row.operation_token,
        recoveryOperationToken:deps.operationUUID?.() || deps.randomUUID(),
        requestId,
        expectedUpdatedAt:row.updated_at,
        lookupComplete,
        observedAuthUserId:observedUser?.id || null,
        observedNormalizedEmail:observedUser?.email ? normalizeEmail(observedUser.email) : null,
        observedEmailConfirmedAt:observedUser?.email_confirmed_at || null,
        observedInvitedAt:observedUser?.invited_at || null
      });
      const code = requireDecisionCode(recovery, RECOVERY_DECISION_CODES);
      const record = claimedRecord(recovery);
      if (code === "forbidden") {
        throw new StaffInvitationError("forbidden", "Active Admin access for this venue is required.", 403);
      }
      if (record) row = record;
      reconciled.push(row);
      continue;
    }
    if (
      row.auth_user_id
      && row.last_sent_at
      && !row.processing_started_at
      && !row.accepted_at
      && ["sent", "profile_pending", "failed"].includes(row.status)
    ) {
      const user = await deps.getAuthUserById(row.auth_user_id);
      await requireCurrentAdmin(deps, actor, row.venue_id);
      if (typeof deps.reconcileInvitation === "function") {
        const result = await deps.reconcileInvitation({
          invitationId:row.id,
          actorUserId:actor.user.id,
          operationToken:deps.operationUUID?.() || deps.randomUUID(),
          requestId,
          expectedUpdatedAt:row.updated_at,
          observedAuthUserId:user?.id || null,
          observedNormalizedEmail:user?.email ? normalizeEmail(user.email) : null,
          observedEmailConfirmedAt:user?.email_confirmed_at || null,
          observedInvitedAt:user?.invited_at || null
        });
        const code = requireDecisionCode(result, RECONCILIATION_DECISION_CODES);
        const record = claimedRecord(result);
        if (code === "forbidden") {
          throw new StaffInvitationError("forbidden", "Active Admin access for this venue is required.", 403);
        }
        if (record) row = record;
        reconciled.push(row);
        continue;
      }
      if (user && normalizeEmail(user.email) !== row.normalized_email) {
        try {
          row = await transitionFromList(deps, row, {
            status:"reconciliation_required",
            processing_started_at:null,
            last_actor_user_id:actor.user.id,
            failure_code:"stored_auth_identity_mismatch",
            failure_message:"The stored Auth identity does not match this invitation. Reconciliation is required."
          });
        } catch (error) {
          if ((error as ErrorCodeView)?.code === "invitation_lease_lost") {
            row = await deps.getInvitationById(row.id) || row;
            if (pendingAuditSpec(row)) {
              row = await repairPendingAudit(deps, row, actor.user.id, requestId, config);
            }
            reconciled.push(row);
            continue;
          }
          throw error;
        }
        try {
          await appendAudit(
            deps,
            row,
            actor.user.id,
            "reconciliation_required",
            "stored_auth_identity_mismatch",
            requestId
          );
        } catch {
          // The invitation row remains the durable mismatch record.
        }
        reconciled.push(row);
        continue;
      }
      if (user && isConfirmed(user)) {
        const profile = await deps.getStaffProfile(user.id);
        await requireCurrentAdmin(deps, actor, row.venue_id);
        const conflict = profileConflict(profile, row.venue_id, row.requested_role);
        let changes = null;
        if (profile && conflict === "existing_account_active") {
          changes = {
            status:"accepted",
            profile_state:["created", "existing"].includes(row.profile_state)
              ? row.profile_state
              : "existing",
            failure_code:ACCEPTED_AUDIT_PENDING_CODE,
            failure_message:ACCEPTED_AUDIT_PENDING_MESSAGE
          };
        } else if (profile && !profile.active) {
          changes = {
            status:"failed",
            profile_state:"failed",
            failure_code:"accepted_profile_inactive",
            failure_message:"The invitation was accepted, but the staff profile is inactive."
          };
        } else if (profile && (["existing_account_other_venue", "existing_account_role_conflict"] as readonly (string | null)[]).includes(conflict)) {
          const venueConflict = conflict === "existing_account_other_venue";
          changes = {
            status:"failed",
            profile_state:"failed",
            failure_code:venueConflict ? "accepted_profile_other_venue" : "accepted_profile_role_conflict",
            failure_message:venueConflict
              ? "The invitation was accepted, but the staff profile now belongs to another venue."
              : "The invitation was accepted, but the staff profile now has a different role."
          };
        } else if (!profile) {
          changes = {
            status:"profile_pending",
            profile_state:"failed",
            failure_code:"accepted_profile_missing",
            failure_message:"The invitation was accepted, but the staff profile still needs setup."
          };
        }

        if (changes) {
          try {
            row = await transitionAcceptedFromList(deps, row, actor.user.id, requestId, changes);
          } catch (error) {
            if ((error as ErrorCodeView)?.code === "invitation_lease_lost") {
              row = await deps.getInvitationById(row.id) || row;
              if (pendingAuditSpec(row)) {
                row = await repairPendingAudit(deps, row, actor.user.id, requestId, config);
              }
              reconciled.push(row);
              continue;
            }
            throw error;
          }
          row = await completePendingAudit(deps, row, actor.user.id, requestId, false);
        }
      }
    }
    reconciled.push(row);
  }
  return reconciled;
}

export function createStaffInvitationsHandler(deps: StaffInvitationDependencies, rawConfig: StaffInvitationConfigInput = {}) {
  const config = buildConfig(rawConfig);

  return async function handle(request: Request) {
    const requestId = deps.randomUUID();
    const origin = String(request.headers.get("origin") || "");
    const headers = responseHeaders(origin, config.allowedOrigins, requestId);

    if (origin && !config.allowedOrigins.has(origin)) {
      return json({ ok:false, error:{ code:"origin_not_allowed", message:"This frontend origin is not allowed." }, request_id:requestId }, 403, headers);
    }
    if (request.method === "OPTIONS") return new Response(null, { status:204, headers });

    try {
      if (request.method !== "GET" && request.method !== "POST") {
        throw new StaffInvitationError("method_not_allowed", "Use GET or POST for this endpoint.", 405);
      }
      const actor = await requireAdmin(request, deps);
      if (!config.valid) {
        throw new StaffInvitationError(
          "configuration_invalid",
          "The invitation service configuration is invalid.",
          503
        );
      }
      if (!config.enabled) {
        throw new StaffInvitationError(
          "provisioning_disabled",
          "In-app staff invitations require server setup and controlled activation.",
          503
        );
      }
      if (!config.redirectUrl) {
        throw new StaffInvitationError("redirect_not_configured", "The trusted invitation redirect is not configured.", 503);
      }

      if (request.method === "GET") {
        const rows = await deps.listInvitations(actor.profile.venue_id);
        const reconciled = await reconcileAcceptedRows(deps, rows, actor, requestId, config);
        return json({
          ok:true,
          invitations:reconciled.map(row => publicInvitation(row, deps.now(), config.cooldownSeconds, config.leaseSeconds)),
          request_id:requestId
        }, 200, headers);
      }

      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as InvitationRequestFields).action !== "string") {
        throw new StaffInvitationError("invalid_field_type", "Invitation fields must use the required string types.");
      }
      const action = (body as { action: string }).action;
      let result;
      let status = 200;

      if (action === "invite") {
        const input = validateInvitationInput(body);
        const fingerprint = await sha256Hex(`${input.normalizedEmail}\n${input.fullName}\n${input.role}`);
        const reservation = await deps.reserveInvitation({
          invited_by_user_id:actor.user.id,
          last_actor_user_id:actor.user.id,
          venue_id:actor.profile.venue_id,
          email:input.email,
          normalized_email:input.normalizedEmail,
          full_name:input.fullName,
          requested_role:input.role,
          status:"reserved",
          send_state:"not_attempted",
          profile_state:"pending",
          idempotency_key:input.idempotencyKey,
          request_fingerprint:fingerprint,
          request_id:requestId
        });

        if (!reservation.inserted) {
          const reservationCode = reservation.code || reservation.decision_code || "invitation_exists";
          if (reservationCode === "forbidden") {
            throw new StaffInvitationError("forbidden", "Active Admin access for this venue is required.", 403);
          }
          if (["invalid_request", "identity_unavailable"].includes(reservationCode)) {
            throw new StaffInvitationError(
              reservationCode,
              reservationCode === "identity_unavailable"
                ? "This identity cannot be provisioned automatically. Reconciliation is required."
                : "The invitation request is invalid.",
              reservationCode === "identity_unavailable" ? 409 : 400
            );
          }
          if (reservationCode === "idempotency_conflict") {
            throw new StaffInvitationError(
              "idempotency_conflict",
              "That request key was already used for different invitation details.",
              409
            );
          }
          if (!reservation.record) {
            throw new StaffInvitationError(
              "invitation_exists",
              "An invitation record already exists for this identity.",
              409
            );
          }
          let existing = reservation.record;
          if (existing.venue_id !== actor.profile.venue_id) {
            throw new StaffInvitationError(
              "invitation_not_available",
              "That invitation request is not available for this venue.",
              403
            );
          }
          const sameRequest = existing.invited_by_user_id === actor.user.id
            && existing.idempotency_key === input.idempotencyKey
            && existing.request_fingerprint === fingerprint;
          if (!sameRequest) {
            throw new StaffInvitationError(
              "invitation_exists",
              "An invitation record already exists for this email. Use its retry or resend action.",
              409,
              { invitation:existing }
            );
          }
          if (pendingAuditSpec(existing)) {
            existing = await repairPendingAudit(deps, existing, actor.user.id, requestId, config);
          }
          if (["provider_unknown", "provider_outcome_unknown"].includes(existing.operation_state)) {
            throw new StaffInvitationError(
              "provider_outcome_unknown",
              "The earlier provider outcome is unresolved and must be reconciled before another email is sent.",
              409,
              { invitation:existing }
            );
          }

          const leaseStale = !existing.processing_started_at
            || asTime(existing.processing_started_at) < deps.now().getTime() - config.leaseSeconds * 1000;
          if (["reserved", "processing"].includes(existing.status) && leaseStale) {
            result = await processInvitation(deps, existing, actor, "retry", requestId, config);
          } else {
            result = existing;
            status = existing.status === "processing" ? 202 : 200;
          }
        } else {
          if (!deps.reserveIncludesAudit) {
            await appendAudit(deps, reservation.record, actor.user.id, "reserved", "new", requestId);
          }
          result = await processInvitation(deps, reservation.record, actor, "invite", requestId, config);
          status = 201;
        }
      } else {
        const input = validateExistingInput(body);
        let existing = await deps.getInvitationById(input.invitationId);
        if (!existing || existing.venue_id !== actor.profile.venue_id) {
          throw new StaffInvitationError("invitation_not_found", "That invitation is not available for this venue.", 404);
        }
        if (!INVITATION_STATES.has(existing.status)) {
          throw new StaffInvitationError("invalid_invitation_state", "That invitation has an invalid server state.", 409);
        }
        const repairingPendingAudit = Boolean(pendingAuditSpec(existing));
        if (repairingPendingAudit) {
          existing = await repairPendingAudit(deps, existing, actor.user.id, requestId, config);
        }
        if (existing.status === "accepted") {
          throw new StaffInvitationError("already_accepted", "This invitation has already been accepted.", 409, { invitation:existing });
        }
        if (repairingPendingAudit && !pendingAuditSpec(existing)) {
          throw new StaffInvitationError(
            "audit_repair_completed",
            "The pending audit evidence was repaired. Refresh before requesting another action.",
            409,
            { invitation:existing }
          );
        }
        if (existing.accepted_at && input.action === "resend") {
          throw new StaffInvitationError("already_accepted", "An accepted invitation cannot be resent.", 409, { invitation:existing });
        }
        if (existing.accepted_at && input.action === "retry" && existing.profile_state !== "failed") {
          throw new StaffInvitationError("already_accepted", "This invitation has already been accepted.", 409, { invitation:existing });
        }
        if (input.action === "resend" && existing.profile_state === "failed") {
          throw new StaffInvitationError(
            "profile_retry_required",
            "Finish the staff profile setup before resending the invitation.",
            409,
            { invitation:existing }
          );
        }
        if (input.action === "retry" && !retryActionAllowed(existing)) {
          throw new StaffInvitationError(
            "retry_not_available",
            "This invitation cannot be retried from its current server state.",
            409,
            { invitation:existing }
          );
        }
        if (input.action === "resend" && !resendActionAllowed(existing)) {
          throw new StaffInvitationError(
            "resend_not_available",
            "This invitation cannot be resent from its current server state.",
            409,
            { invitation:existing }
          );
        }
        result = await processInvitation(deps, existing, actor, input.action, requestId, config);
      }

      return json({
        ok:true,
        invitation:publicInvitation(result, deps.now(), config.cooldownSeconds, config.leaseSeconds),
        request_id:requestId
      }, status, headers);
    } catch (error) {
      const known = error instanceof StaffInvitationError
        ? error
        : new StaffInvitationError("server_error", "The invitation service could not complete the request.", 500);
      const retryAfter = known.retryAfterSeconds || 0;
      const hideCrossVenueIdentity = isCrossVenueIdentityFailure(known.code)
        || isCrossVenueIdentityFailure(known.invitation?.failure_code);
      const invitation = known.invitation && !hideCrossVenueIdentity
        ? publicInvitation(known.invitation, deps.now(), config.cooldownSeconds, config.leaseSeconds)
        : undefined;
      deps.logSafeError?.({ request_id:requestId, code:known.code, status:known.status });
      return json({
        ok:false,
        error:{
          code:hideCrossVenueIdentity ? PUBLIC_IDENTITY_UNAVAILABLE_CODE : known.code,
          message:hideCrossVenueIdentity ? PUBLIC_IDENTITY_UNAVAILABLE_MESSAGE : known.message,
          ...(retryAfter ? { retry_after_seconds:retryAfter } : {})
        },
        ...(invitation ? { invitation } : {}),
        request_id:requestId
      }, known.status, headers, retryAfter ? { "retry-after":retryAfter } : {});
    }
  };
}
