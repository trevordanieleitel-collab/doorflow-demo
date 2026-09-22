import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import {
  createRepairInvitationAuditRpcAdapter,
  createStaffInvitationsHandler,
  resolveSupabaseServerKeys,
  StaffInvitationError,
  validateSupabaseProjectConfiguration
} from "./core.ts";
import { isInvitationRecord, parseAuthLookupReply, parseRpcReply } from "./rpc-validation.ts";
import type { RpcExpectation } from "./rpc-validation.ts";
import { rejectDirectAuditWrite } from "./audit.ts";
import type {
  AuditEntry,
  DecisionRpcName,
  InvitationAction,
  InvitationRecord,
  InvitationReservationResult,
  StaffInvitationDependencies,
  StaffProfile
} from "./core.ts";

// This is the adapter's local projection of the reviewed SQL contract, not a
// generated or verified production schema. JSONB decisions stay unknown until
// the response boundary checks their branch, payload and request relationships.
type TableContract<Row, Insert, Update> = {
  Row: { [Key in keyof Row]: Row[Key] };
  Insert: { [Key in keyof Insert]: Insert[Key] };
  Update: { [Key in keyof Update]: Update[Key] };
  Relationships: [];
};
type OperationArgs = {
  p_invitation_id: string;
  p_actor_user_id: string;
  p_operation_token: string | null;
  p_request_id: string;
};
type ObservationArgs = OperationArgs & {
  p_expected_updated_at: string;
  p_observed_auth_user_id: string | null;
  p_observed_normalized_email: string | null;
  p_observed_email_confirmed_at: string | null;
  p_observed_invited_at: string | null;
};
// The reviewed audit table has no defaults for these required identity and
// attribution columns. This projection remains strict even though production
// writes audit evidence through guarded RPCs, never through a direct insert.
type AuditInsert = Omit<AuditEntry, "id"> & {
  id: string;
  originating_actor_user_id: string;
  recorded_request_id: string;
  operation_token?: string | null;
  repair_operation_token?: string | null;
};
type DecisionArgs = {
  doorflow_reserve_staff_invitation: {
    p_actor_user_id: string;
    p_venue_id: string;
    p_email: string;
    p_normalized_email: string;
    p_full_name: string;
    p_requested_role: string;
    p_idempotency_key: string;
    p_request_fingerprint: string;
    p_request_id: string;
  };
  doorflow_claim_staff_invitation: OperationArgs & {
    p_action: InvitationAction;
    p_cooldown_seconds: number;
    p_lease_seconds: number;
  };
  doorflow_authorize_staff_invitation_dispatch: OperationArgs;
  doorflow_record_staff_invitation_provider_outcome: OperationArgs & {
    p_outcome: "accepted" | "identity_mismatch" | "unknown";
    p_provider_auth_user_id: string | null;
    p_provider_normalized_email: string | null;
    p_failure_code: null;
  };
  doorflow_recover_staff_invitation_dispatch: ObservationArgs & {
    p_recovery_operation_token: string;
    p_lookup_complete: boolean;
  };
  doorflow_finalize_staff_invitation_profile: OperationArgs;
  doorflow_reconcile_staff_invitation: ObservationArgs;
  doorflow_repair_staff_invitation_audit: {
    p_invitation_id: string;
    p_actor_user_id: string;
    p_repair_operation_token: string;
    p_request_id: string;
  };
};
type InvitationAdapterDatabase = {
  public: {
    Tables: {
      staff_profiles: TableContract<StaffProfile, StaffProfile, never>;
      staff_invitations: TableContract<InvitationRecord, never, Partial<InvitationRecord>>;
      staff_invitation_audit: TableContract<AuditEntry & { id: string }, AuditInsert, never>;
    };
    Views: Record<never, never>;
    Functions: {
      [Name in DecisionRpcName]: { Args: DecisionArgs[Name]; Returns: unknown };
    } & {
      doorflow_lookup_staff_invitation_auth_user: {
        Args: { p_actor_user_id: string; p_venue_id: string; p_normalized_email: string };
        Returns: {
          id: string;
          email: string;
          email_confirmed_at: string | null;
          invited_at: string | null;
        }[];
      };
    };
  };
};
type RequestConfig = ReturnType<typeof readConfig>;
type DatabaseErrorFields = { code?: string; status?: number };

function requiredPlatformEnv(name: string) {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new Error("Missing required server configuration");
  return value;
}

function strictInteger(name: string, minimum: number, maximum: number) {
  const raw = Deno.env.get(name);
  if (raw === undefined || !String(raw).trim()) {
    throw new Error("Missing required numeric server configuration");
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) throw new Error("Invalid numeric server configuration");
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("Numeric server configuration is outside its safe range");
  }
  return value;
}

function booleanEnv(name: string, fallback = false) {
  const raw = Deno.env.get(name);
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("Invalid boolean server configuration");
}

function createBoundedFetch(timeoutMs: number): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const controller = new AbortController();
    const upstream = init.signal;
    const abort = () => controller.abort(upstream?.reason);
    if (upstream?.aborted) abort();
    else upstream?.addEventListener("abort", abort, { once:true });
    const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "AbortError")), timeoutMs);
    try {
      return await fetch(input, { ...init, signal:controller.signal });
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener("abort", abort);
    }
  };
}

function createRequestDependencies(config: RequestConfig): StaffInvitationDependencies {
  const project = validateSupabaseProjectConfiguration({
    environment:config.environment,
    supabaseUrl:requiredPlatformEnv("SUPABASE_URL"),
    projectRef:requiredPlatformEnv("DOORFLOW_SUPABASE_PROJECT_REF")
  });
  const supabaseUrl = project.supabaseUrl;
  const configuredProjectRef = project.projectRef;
  const allowLegacy = booleanEnv("DOORFLOW_ALLOW_LEGACY_SUPABASE_KEYS", false);
  const { publishableKey, secretKey } = resolveSupabaseServerKeys({
    publishableDictionary:Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
    secretDictionary:Deno.env.get("SUPABASE_SECRET_KEYS"),
    selector:Deno.env.get("DOORFLOW_SUPABASE_KEY_NAME"),
    directPublishable:Deno.env.get("DOORFLOW_SUPABASE_PUBLISHABLE_KEY"),
    directSecret:Deno.env.get("DOORFLOW_SUPABASE_SECRET_KEY"),
    directProjectRef:Deno.env.get("DOORFLOW_SUPABASE_KEY_PROJECT_REF"),
    projectRef:configuredProjectRef,
    legacyPublishable:Deno.env.get("SUPABASE_ANON_KEY"),
    legacySecret:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    allowLegacy
  });
  const authOptions = {
    autoRefreshToken:false,
    persistSession:false,
    detectSessionInUrl:false
  };
  const boundedFetch = createBoundedFetch(config.providerTimeoutMs);
  const clientOptions = { auth:authOptions, global:{ fetch:boundedFetch } };
  const verifier = createClient<InvitationAdapterDatabase>(supabaseUrl, publishableKey, clientOptions);
  // Preserve the actual HTTP boundary: the pinned SDK normalizes a 404 array
  // into status 200 / []. That must never establish an absent Auth identity.
  const lookupTransport: { status: number; contentRange: string | null }[] = [];
  const adminFetch: typeof fetch = async (input, init) => {
    const response = await boundedFetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${supabaseUrl}/rest/v1/rpc/doorflow_lookup_staff_invitation_auth_user`) {
      lookupTransport.push({ status:response.status, contentRange:response.headers.get("content-range") });
    }
    return response;
  };
  const admin = createClient<InvitationAdapterDatabase>(supabaseUrl, secretKey, { auth:authOptions, global:{ fetch:adminFetch } });

  const dataOrThrow = <Data>(data: Data, error: DatabaseErrorFields | null, label: string): Data => {
    if (error) {
      const safe = Object.assign(new Error(label), {
        code:error.code || "database_error",
        status:error.status || 500
      });
      throw safe;
    }
    return data;
  };

  const invalidReply = () => new StaffInvitationError(
    "invalid_database_contract",
    "The invitation service received an invalid database response.",
    500
  );
  // Request-local context only, never cross-request authorization or a claim.
  // It binds returned rows to the identity already read in this workflow; all
  // eligibility/authorization/lease decisions remain in the existing SQL calls.
  const knownInvitations = new Map<string, InvitationRecord>();
  const rememberInvitation = (data: unknown, id?: string, venueId?: string) => {
    if (!isInvitationRecord(data) || (id !== undefined && data.id.toLowerCase() !== id.toLowerCase())
        || (venueId !== undefined && data.venue_id !== venueId)) throw invalidReply();
    knownInvitations.set(data.id.toLowerCase(), data);
    return data;
  };
  const decisionRpc = async <Name extends DecisionRpcName>(
    name: Name, args: DecisionArgs[Name], label: string,
    extra: Pick<RpcExpectation, "reservation" | "authUser"> = {}
  ) => {
    const input: DecisionArgs[DecisionRpcName] = args;
    const expected: RpcExpectation = { actorUserId:input.p_actor_user_id, requestId:input.p_request_id, ...extra };
    if ("p_invitation_id" in input) {
      expected.invitationId = input.p_invitation_id;
      expected.previous = knownInvitations.get(input.p_invitation_id.toLowerCase());
    }
    if ("p_operation_token" in input) expected.operationToken = input.p_operation_token;
    if ("p_action" in input) expected.action = input.p_action;
    if ("p_outcome" in input) expected.provider = {
      outcome:input.p_outcome, authUserId:input.p_provider_auth_user_id,
      normalizedEmail:input.p_provider_normalized_email
    };
    if ("p_observed_auth_user_id" in input) expected.observation = {
      authUserId:input.p_observed_auth_user_id, normalizedEmail:input.p_observed_normalized_email,
      emailConfirmedAt:input.p_observed_email_confirmed_at
    };
    const result = await admin.rpc(name, args);
    const data = dataOrThrow(result.data, result.error, label);
    const decision = parseRpcReply(name, data, expected);
    // A bad response may follow a committed write. Throw without a row, retry,
    // compensation, or local snapshot fallback; preserve durable uncertainty.
    if (!decision) throw invalidReply();
    if (decision.record) knownInvitations.set(decision.record.id.toLowerCase(), decision.record);
    return decision;
  };

  return {
    reserveIncludesAudit:true,
    claimIncludesAudit:true,
    now:() => new Date(),
    randomUUID:() => crypto.randomUUID(),
    logSafeError:({ request_id, code, status }) => {
      console.error(JSON.stringify({ scope:"staff-invitations", request_id, code, status }));
    },
    verifyUserToken:async token => {
      const { data, error } = await verifier.auth.getUser(token);
      if (error || !data?.user) throw error || new Error("Auth user missing");
      return data.user;
    },
    getStaffProfile:async userId => {
      const result = await admin.from("staff_profiles").select("*").eq("id", userId).maybeSingle();
      return dataOrThrow(result.data, result.error, "staff_profile_lookup_failed");
    },
    createStaffProfile:async profile => {
      const result = await admin.from("staff_profiles").insert(profile).select("*").single();
      return dataOrThrow(result.data, result.error, "staff_profile_create_failed");
    },
    reserveInvitation:async (record): Promise<InvitationReservationResult> => {
      const decision = await decisionRpc("doorflow_reserve_staff_invitation", {
        p_actor_user_id:record.invited_by_user_id,
        p_venue_id:record.venue_id,
        p_email:record.email,
        p_normalized_email:record.normalized_email,
        p_full_name:record.full_name,
        p_requested_role:record.requested_role,
        p_idempotency_key:record.idempotency_key,
        p_request_fingerprint:record.request_fingerprint,
        p_request_id:record.request_id
      }, "invitation_reservation_failed", { reservation:record });
      const code = decision.decision_code;
      if (code === "reserved") {
        if (!decision.record) throw invalidReply();
        return { inserted:true, record:decision.record, code };
      }
      return { inserted:false, record:decision.record, code };
    },
    getInvitationById:async invitationId => {
      const result = await admin.from("staff_invitations").select("*").eq("id", invitationId).maybeSingle();
      const data = dataOrThrow(result.data, result.error, "invitation_lookup_failed");
      return data === null ? null : rememberInvitation(data, invitationId);
    },
    listInvitations:async venueId => {
      const result = await admin
        .from("staff_invitations")
        .select("*")
        .eq("venue_id", venueId)
        .order("created_at", { ascending:false })
        .limit(100);
      const data: unknown = dataOrThrow(result.data || [], result.error, "invitation_list_failed");
      if (!Array.isArray(data)) throw invalidReply();
      return data.map((row: unknown) => rememberInvitation(row, undefined, venueId));
    },
    claimInvitation:async claim => {
      return await decisionRpc("doorflow_claim_staff_invitation", {
        p_invitation_id:claim.invitationId,
        p_actor_user_id:claim.actorUserId,
        p_action:claim.action,
        p_operation_token:claim.operationToken,
        p_cooldown_seconds:claim.cooldownSeconds,
        p_lease_seconds:claim.leaseSeconds,
        p_request_id:claim.requestId
      }, "invitation_claim_failed");
    },
    authorizeInvitationDispatch:async operation => {
      return await decisionRpc("doorflow_authorize_staff_invitation_dispatch", {
        p_invitation_id:operation.invitationId,
        p_actor_user_id:operation.actorUserId,
        p_operation_token:operation.operationToken,
        p_request_id:operation.requestId
      }, "invitation_dispatch_authorization_failed");
    },
    recordInvitationProviderOutcome:async outcome => {
      return await decisionRpc("doorflow_record_staff_invitation_provider_outcome", {
        p_invitation_id:outcome.invitationId,
        p_actor_user_id:outcome.actorUserId,
        p_operation_token:outcome.operationToken,
        p_outcome:outcome.outcome,
        p_provider_auth_user_id:outcome.providerAuthUserId,
        p_provider_normalized_email:outcome.providerNormalizedEmail,
        p_failure_code:null,
        p_request_id:outcome.requestId
      }, "invitation_provider_outcome_failed");
    },
    recoverInvitationDispatch:async recovery => {
      return await decisionRpc("doorflow_recover_staff_invitation_dispatch", {
        p_invitation_id:recovery.invitationId,
        p_actor_user_id:recovery.actorUserId,
        p_operation_token:recovery.operationToken,
        p_recovery_operation_token:recovery.recoveryOperationToken,
        p_request_id:recovery.requestId,
        p_expected_updated_at:recovery.expectedUpdatedAt,
        p_lookup_complete:recovery.lookupComplete,
        p_observed_auth_user_id:recovery.observedAuthUserId,
        p_observed_normalized_email:recovery.observedNormalizedEmail,
        p_observed_email_confirmed_at:recovery.observedEmailConfirmedAt,
        p_observed_invited_at:recovery.observedInvitedAt
      }, "invitation_dispatch_recovery_failed");
    },
    finalizeInvitationProfile:async operation => {
      return await decisionRpc("doorflow_finalize_staff_invitation_profile", {
        p_invitation_id:operation.invitationId,
        p_actor_user_id:operation.actorUserId,
        p_operation_token:operation.operationToken,
        p_request_id:operation.requestId
      }, "invitation_profile_finalize_failed", { authUser:operation.authUser });
    },
    repairInvitationAudit:createRepairInvitationAuditRpcAdapter(decisionRpc),
    reconcileInvitation:async operation => {
      return await decisionRpc("doorflow_reconcile_staff_invitation", {
        p_invitation_id:operation.invitationId,
        p_actor_user_id:operation.actorUserId,
        p_operation_token:operation.operationToken,
        p_request_id:operation.requestId,
        p_expected_updated_at:operation.expectedUpdatedAt,
        p_observed_auth_user_id:operation.observedAuthUserId,
        p_observed_normalized_email:operation.observedNormalizedEmail,
        p_observed_email_confirmed_at:operation.observedEmailConfirmedAt,
        p_observed_invited_at:operation.observedInvitedAt
      }, "invitation_reconciliation_failed");
    },
    updateInvitation:async (invitationId, changes, expectedLease = undefined, expectedState = undefined) => {
      let query = admin
        .from("staff_invitations")
        .update({ ...changes, updated_at:new Date().toISOString() })
        .eq("id", invitationId);
      if (typeof expectedLease === "string") query = query.eq("processing_started_at", expectedLease);
      if (expectedLease === null) query = query.is("processing_started_at", null);
      // Core's internal expected-state constructors omit absent keys and never
      // supply undefined values. These member views preserve that contract;
      // hasOwn alone is not validation of an external object's field values.
      if (expectedState && Object.hasOwn(expectedState, "accepted_at")) {
        query = expectedState.accepted_at === null
          ? query.is("accepted_at", null)
          : query.eq("accepted_at", expectedState.accepted_at as string);
      }
      if (expectedState && Object.hasOwn(expectedState, "status")) {
        query = query.eq("status", expectedState.status as string);
      }
      if (expectedState && Object.hasOwn(expectedState, "operation_token")) {
        query = query.eq("operation_token", expectedState.operation_token as string);
      }
      if (expectedState && Object.hasOwn(expectedState, "operation_state")) {
        query = query.eq("operation_state", expectedState.operation_state as string);
      }
      if (expectedState && Object.hasOwn(expectedState, "updated_at")) {
        query = query.eq("updated_at", expectedState.updated_at as string);
      }
      if (expectedState && Object.hasOwn(expectedState, "pending_audit_event_type")) {
        query = expectedState.pending_audit_event_type === null
          ? query.is("pending_audit_event_type", null)
          : query.eq("pending_audit_event_type", expectedState.pending_audit_event_type as string);
      }
      if (expectedState && Object.hasOwn(expectedState, "pending_audit_classification")) {
        query = expectedState.pending_audit_classification === null
          ? query.is("pending_audit_classification", null)
          : query.eq("pending_audit_classification", expectedState.pending_audit_classification as string);
      }
      if (expectedState && Object.hasOwn(expectedState, "pending_audit_operation_token")) {
        query = query.eq("pending_audit_operation_token", expectedState.pending_audit_operation_token as string);
      }
      const result = await query
        .select("*")
        .maybeSingle();
      const updated = dataOrThrow(result.data, result.error, "invitation_update_failed");
      if (!updated && (expectedLease !== undefined || expectedState !== undefined)) {
        throw Object.assign(new Error("invitation_lease_lost"), {
          code:"invitation_lease_lost",
          status:409
        });
      }
      if (!updated) throw new Error("invitation_update_missing");
      return updated;
    },
    appendAudit:rejectDirectAuditWrite,
    getAuditById:async auditId => {
      const result = await admin
        .from("staff_invitation_audit")
        .select("id, invitation_id, actor_user_id, venue_id, event_type, classification, request_id, details")
        .eq("id", auditId)
        .maybeSingle();
      return dataOrThrow(result.data, result.error, "invitation_audit_lookup_failed");
    },
    getAuthUserById:async userId => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error?.status === 404) return null;
      if (error) throw error;
      return data?.user || null;
    },
    lookupAuthUserByEmail:async (normalizedEmail, actorUserId, venueId) => {
      lookupTransport.length = 0;
      const result = await admin.rpc("doorflow_lookup_staff_invitation_auth_user", {
        p_actor_user_id:actorUserId,
        p_venue_id:venueId,
        p_normalized_email:normalizedEmail
      }, { count:"exact" });
      const parsed = lookupTransport.length === 1
        ? parseAuthLookupReply(result, lookupTransport[0], normalizedEmail)
        : null;
      if (!parsed) throw invalidReply();
      return parsed;
    },
    inviteUserByEmail:async (email, options) => {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, options);
      if (error) throw error;
      if (!data?.user) throw new Error("Invitation provider returned no user");
      return data.user;
    }
  };
}

function readConfig() {
  const environmentValue = String(Deno.env.get("DOORFLOW_ENVIRONMENT") || "").trim();
  if (!["production", "development"].includes(environmentValue)) {
    throw new Error("Invalid DoorFlow environment configuration");
  }
  const allowedOrigins = String(Deno.env.get("DOORFLOW_ALLOWED_ORIGINS") || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
  if (!allowedOrigins.length) throw new Error("No DoorFlow frontend origins are configured");
  const redirectUrl = String(Deno.env.get("DOORFLOW_INVITE_REDIRECT_URL") || "").trim();
  return {
    enabled:booleanEnv("DOORFLOW_STAFF_PROVISIONING_ENABLED", false),
    environment:environmentValue,
    redirectUrl,
    allowedOrigins,
    cooldownSeconds:strictInteger("DOORFLOW_INVITE_RESEND_COOLDOWN_SECONDS", 60, 86_400),
    leaseSeconds:strictInteger("DOORFLOW_INVITE_LEASE_SECONDS", 30, 600),
    providerTimeoutMs:strictInteger("DOORFLOW_INVITE_PROVIDER_TIMEOUT_MS", 1_000, 120_000)
  };
}

Deno.serve(request => {
  try {
    const config = readConfig();
    // Both clients are created for this request only. Neither persists a user
    // session, and the privileged client is never shared with browser code.
    return createStaffInvitationsHandler(createRequestDependencies(config), config)(request);
  } catch (error) {
    console.error(JSON.stringify({ scope:"staff-invitations", code:"server_configuration_error" }));
    return Response.json(
      { ok:false, error:{ code:"server_configuration_error", message:"The invitation service is not configured." } },
      { status:503, headers:{ "cache-control":"no-store" } }
    );
  }
});
