// Actual-adapter tests. All service replies and committed-state snapshots below
// are fictional transport simulations, not PostgreSQL transaction validation.
// Run only with the documented disposable environment and Deno --deny-net,
// --deny-run and --deny-ffi permissions. No original Deno.serve is called.
import type {
  InvitationAction,
  InvitationRecord,
  StaffProfile
} from "../supabase/functions/staff-invitations/core.ts";

const API = "http://127.0.0.1:54321";
const ORIGIN = "http://127.0.0.1:4173";
const ADMIN = "10000000-0000-4000-8000-000000000001";
const OTHER_ADMIN = "10000000-0000-4000-8000-000000000002";
const VENUE = "20000000-0000-4000-8000-000000000001";
const OTHER_VENUE = "20000000-0000-4000-8000-000000000002";
const INVITATION = "30000000-0000-4000-8000-000000000001";
const TARGET_USER = "40000000-0000-4000-8000-000000000001";
const PRIOR_OPERATION = "50000000-0000-4000-8000-000000000001";
const PRIOR_REQUEST = "60000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "70000000-0000-4000-8000-000000000001";
const EMAIL = "fictional.staff@example.invalid";
const TIME = "2026-01-01T00:00:00.000Z";
const RAW_MARKER = "FICTIONAL_UNTRUSTED_DATABASE_REPLY_MUST_NOT_ESCAPE";
const LEASE_END = "2026-01-01T00:02:00.000Z";
const RPC = {
  reserve:"doorflow_reserve_staff_invitation",
  claim:"doorflow_claim_staff_invitation",
  dispatch:"doorflow_authorize_staff_invitation_dispatch",
  outcome:"doorflow_record_staff_invitation_provider_outcome",
  recover:"doorflow_recover_staff_invitation_dispatch",
  finalize:"doorflow_finalize_staff_invitation_profile",
  repair:"doorflow_repair_staff_invitation_audit",
  reconcile:"doorflow_reconcile_staff_invitation"
} as const;
type Rpc = typeof RPC[keyof typeof RPC];
type Path = "invite" | "recover" | "repair" | "reconcile";
type Reply = {
  decision_code: string;
  record: InvitationRecord | null;
  profile?: StaffProfile | null;
  retry_after_seconds?: number;
  requires_provider_dispatch?: boolean;
};
type Rewrite = (reply: Reply) => unknown;
type Handler = (request: Request) => Response | Promise<Response>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "Expected a fictional JSON object");
  return value as Record<string, unknown>;
}
function stringField(value: Record<string, unknown>, key: string): string {
  assert(typeof value[key] === "string", `Missing fictional request field ${key}`);
  return value[key];
}
function record(reply: Reply): InvitationRecord {
  assert(reply.record !== null, "Fixture requires a record");
  return reply.record;
}
function profile(): StaffProfile {
  return { id:TARGET_USER, full_name:"Fictional Staff", role:"door", active:true, venue_id:VENUE };
}
function invitation(): InvitationRecord {
  return {
    id:INVITATION, invited_by_user_id:ADMIN, last_actor_user_id:ADMIN,
    venue_id:VENUE, email:EMAIL, normalized_email:EMAIL, full_name:"Fictional Staff",
    requested_role:"door", auth_user_id:null, status:"reserved", send_state:"not_attempted",
    profile_state:"pending", idempotency_key:IDEMPOTENCY_KEY, request_fingerprint:"fictional-fingerprint",
    attempt_count:0, last_attempt_at:null, last_provider_attempt_at:null, last_sent_at:null,
    operation_fence:0, operation_token:null, operation_action:null, operation_state:"idle",
    operation_actor_user_id:null, operation_request_id:null, operation_started_at:null,
    processing_started_at:null, lease_expires_at:null, dispatch_authorized_at:null,
    dispatch_started_at:null, operation_completed_at:null, expected_auth_user_id:null,
    failure_code:null, failure_message:null, pending_audit_event_type:null,
    pending_audit_classification:null, pending_audit_originating_actor_user_id:null,
    pending_audit_originating_request_id:null, pending_audit_operation_token:null,
    pending_audit_details:null, accepted_at:null, created_at:TIME, updated_at:TIME
  };
}
function seed(path: Path): InvitationRecord {
  const row = invitation();
  if (path === "invite") return row;
  Object.assign(row, {
    status:"processing", attempt_count:1, last_attempt_at:TIME,
    operation_fence:1, operation_token:PRIOR_OPERATION, operation_action:"invite",
    operation_state:"dispatch_authorized", operation_actor_user_id:ADMIN,
    operation_request_id:PRIOR_REQUEST, operation_started_at:TIME,
    processing_started_at:TIME, lease_expires_at:LEASE_END,
    dispatch_authorized_at:TIME, dispatch_started_at:TIME, last_provider_attempt_at:TIME
  });
  if (path === "recover") return row;
  Object.assign(row, {
    status:"sent", send_state:"provider_accepted", profile_state:"created",
    auth_user_id:TARGET_USER, last_sent_at:TIME, operation_state:"completed",
    operation_completed_at:TIME, processing_started_at:null, lease_expires_at:null
  });
  if (path === "repair") Object.assign(row, {
    status:"profile_pending", failure_code:"profile_audit_pending",
    failure_message:"Fictional profile evidence awaits repair.",
    pending_audit_event_type:"profile_created", pending_audit_classification:"created",
    pending_audit_originating_actor_user_id:ADMIN,
    pending_audit_originating_request_id:PRIOR_REQUEST,
    pending_audit_operation_token:PRIOR_OPERATION, pending_audit_details:{}
  });
  return row;
}

class Simulation {
  action: InvitationAction = "invite";
  actorId = ADMIN;
  origin = ORIGIN;
  requestEmail = EMAIL;
  requestInvitationId: string | undefined;
  confirmedObservation = true;
  lookupResponse: (() => Response) | undefined;
  lookupSnapshot: unknown;
  recoveryLookupComplete: unknown;
  recoveryObservedUser: unknown;
  row: InvitationRecord;
  profile: StaffProfile | null;
  readonly requests: string[] = [];
  readonly unexpected: string[] = [];
  readonly auditEvents: string[] = [];
  readonly commits = new Map<Rpc, { row: InvitationRecord; profile: StaffProfile | null; auditEvents: string[] }>();
  providerCalls = 0;
  auditInsertAttempts = 0;
  mutationAttempts = 0;
  reservationCalls = 0;
  profileWrites = 0;
  readonly safeLogs: string[] = [];
  constructor(readonly path: Path, readonly target?: Rpc, readonly rewrite?: Rewrite, readonly denyBeforeCommit = false) {
    this.row = seed(path);
    this.profile = path === "repair" || path === "reconcile" ? profile() : null;
  }
  commit(name: Rpc) {
    this.commits.set(name, structuredClone({ row:this.row, profile:this.profile, auditEvents:this.auditEvents }));
  }
  rpc(name: Rpc, args: Record<string, unknown>): unknown {
    equal(args.p_actor_user_id, this.actorId, "RPC actor must remain the authenticated fictional Admin");
    if (name !== RPC.reserve) equal(args.p_invitation_id, this.row.id, "RPC invitation identity");
    if (name === this.target && this.denyBeforeCommit && this.rewrite) {
      // These fixtures represent a legitimate SQL denial without a write.
      this.commit(name);
      return this.rewrite({ decision_code:"unused", record:null });
    }
    let reply: Reply;
    if (name === RPC.reserve) {
      equal(args.p_venue_id, VENUE, "Reservation venue");
      equal(args.p_email, this.requestEmail, "Reservation email");
      this.reservationCalls += 1;
      if (this.reservationCalls > 1) {
        equal(args.p_request_fingerprint, this.row.request_fingerprint, "Same-payload replay fingerprint");
        return { decision_code:"replay", record:structuredClone(this.row) };
      }
      this.row.request_fingerprint = stringField(args, "p_request_fingerprint");
      this.row.idempotency_key = stringField(args, "p_idempotency_key");
      this.auditEvents.push("reserved");
      reply = { decision_code:"reserved", record:this.row };
    } else if (name === RPC.claim) {
      if (this.row.dispatch_started_at && ["dispatch_authorized", "provider_unknown"].includes(this.row.operation_state)) {
        return { decision_code:"provider_outcome_unknown", retry_after_seconds:0, record:structuredClone(this.row) };
      }
      Object.assign(this.row, {
        status:"processing", attempt_count:this.row.attempt_count + 1, last_attempt_at:TIME,
        operation_fence:this.row.operation_fence + 1, operation_token:stringField(args, "p_operation_token"),
        operation_action:this.action, operation_state:"claimed", operation_actor_user_id:this.actorId,
        operation_request_id:stringField(args, "p_request_id"), operation_started_at:TIME,
        processing_started_at:TIME, lease_expires_at:LEASE_END,
        expected_auth_user_id:this.row.auth_user_id, dispatch_started_at:null,
        dispatch_authorized_at:null, operation_completed_at:null
      });
      this.auditEvents.push("attempt_started");
      reply = { decision_code:"claimed", record:this.row, retry_after_seconds:0, requires_provider_dispatch:this.action !== "retry" };
    } else if (name === RPC.dispatch) {
      equal(args.p_operation_token, this.row.operation_token, "Dispatch token fencing");
      Object.assign(this.row, {
        operation_state:"dispatch_authorized", dispatch_authorized_at:TIME,
        dispatch_started_at:TIME, last_provider_attempt_at:TIME
      });
      this.auditEvents.push("dispatch_authorized");
      reply = { decision_code:"dispatch_authorized", record:this.row };
    } else if (name === RPC.outcome) {
      equal(args.p_operation_token, this.row.operation_token, "Outcome token fencing");
      equal(args.p_outcome, "accepted", "Only the fictional accepted provider outcome is configured");
      equal(args.p_provider_auth_user_id, TARGET_USER, "Provider identity persisted");
      Object.assign(this.row, {
        auth_user_id:TARGET_USER, status:"profile_pending", send_state:"provider_accepted",
        profile_state:"pending", operation_state:"provider_accepted", last_sent_at:TIME,
        processing_started_at:null, lease_expires_at:null
      });
      this.auditEvents.push("provider_accepted");
      reply = { decision_code:this.action === "resend" ? "invitation_resent" : "provider_accepted", record:this.row };
    } else if (name === RPC.finalize) {
      equal(args.p_operation_token, this.row.operation_token, "Profile token fencing");
      const state = this.profile ? "existing" : "created";
      if (!this.profile) {
        this.profile = profile();
        this.profileWrites += 1;
      }
      Object.assign(this.row, {
        status:"sent", profile_state:state, operation_state:"completed",
        operation_completed_at:TIME, processing_started_at:null, lease_expires_at:null,
        failure_code:null, failure_message:null
      });
      this.auditEvents.push(state === "created" ? "profile_created" : "profile_verified", "provisioning_completed");
      reply = { decision_code:state, record:this.row, profile:this.profile };
    } else if (name === RPC.recover) {
      this.recoveryLookupComplete = args.p_lookup_complete;
      this.recoveryObservedUser = args.p_observed_auth_user_id;
      equal(args.p_operation_token, PRIOR_OPERATION, "Recovery preserves dispatch ownership");
      Object.assign(this.row, {
        status:"reconciliation_required", operation_state:"provider_unknown",
        processing_started_at:null, lease_expires_at:null, failure_code:"provider_outcome_unknown",
        failure_message:"The fictional dispatch outcome remains unknown."
      });
      this.auditEvents.push("reconciliation_checked");
      reply = { decision_code:"provider_outcome_unknown", record:this.row };
    } else if (name === RPC.repair) {
      Object.assign(this.row, {
        status:"sent", pending_audit_event_type:null, pending_audit_classification:null,
        pending_audit_originating_actor_user_id:null, pending_audit_originating_request_id:null,
        pending_audit_operation_token:null, pending_audit_details:null,
        failure_code:null, failure_message:null
      });
      this.auditEvents.push("profile_created", "provisioning_completed");
      reply = { decision_code:"audit_repaired", record:this.row };
    } else {
      equal(name, RPC.reconcile, "Only the explicit reconciliation fixture is permitted");
      equal(args.p_observed_auth_user_id, TARGET_USER, "Observed Auth identity");
      Object.assign(this.row, {
        status:this.confirmedObservation ? "accepted" : "sent",
        accepted_at:this.confirmedObservation ? TIME : null, operation_action:"reconcile",
        operation_fence:this.row.operation_fence + 1, expected_auth_user_id:TARGET_USER,
        operation_token:stringField(args, "p_operation_token"),
        operation_request_id:stringField(args, "p_request_id"),
        dispatch_authorized_at:null, dispatch_started_at:null
      });
      this.auditEvents.push(this.confirmedObservation ? "accepted_reconciled" : "reconciliation_checked");
      reply = { decision_code:this.confirmedObservation ? "verified_auth" : "not_accepted", record:this.row };
    }
    this.commit(name);
    const detached = structuredClone(reply);
    return this.target === name && this.rewrite ? this.rewrite(detached) : detached;
  }
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const fail = (description: string): never => {
      this.unexpected.push(description);
      throw new Error(`Unexpected fictional transport request: ${description}`);
    };
    if (url.origin !== API) return fail("origin outside the exact loopback allowlist");
    const route = `${request.method} ${url.pathname}`;
    if (route === "GET /auth/v1/user") {
      this.requests.push("authenticate");
      return Response.json({ id:this.actorId, email:"fictional.admin@example.invalid", aud:"authenticated", user_metadata:{}, app_metadata:{}, created_at:TIME });
    }
    if (route === "GET /rest/v1/staff_profiles") {
      if (url.searchParams.get("id") === `eq.${TARGET_USER}` && this.action === "resend") {
        this.requests.push("profile-target");
        return Response.json(this.profile ? [this.profile] : []);
      }
      equal(url.searchParams.get("id"), `eq.${this.actorId}`, "Only configured Admin/target profile reads are allowed");
      this.requests.push("authorize");
      return Response.json([{ id:this.actorId, full_name:"Fictional Admin", role:"admin", active:true, venue_id:VENUE }]);
    }
    if (route === "GET /rest/v1/staff_invitations" && this.action !== "invite") {
      equal(url.searchParams.get("id"), `eq.${this.requestInvitationId || this.row.id}`, "Existing invitation exact lookup");
      this.requests.push("read");
      return Response.json([this.row]);
    }
    if (route === "GET /rest/v1/staff_invitations" && this.path !== "invite") {
      equal(url.searchParams.get("venue_id"), `eq.${VENUE}`, "Invitation list venue");
      this.requests.push("list");
      return Response.json([this.row]);
    }
    if (route === `GET /auth/v1/admin/users/${TARGET_USER}` && (this.path === "reconcile" || this.action !== "invite")) {
      this.requests.push("observe-auth");
      return Response.json({ user:{ id:TARGET_USER, email:EMAIL, email_confirmed_at:this.path === "reconcile" && this.confirmedObservation ? TIME : null, invited_at:TIME, user_metadata:{}, app_metadata:{}, aud:"authenticated", created_at:TIME } });
    }
    if (route === "POST /rest/v1/rpc/doorflow_lookup_staff_invitation_auth_user") {
      equal(request.headers.get("prefer"), "count=exact", "Table lookup requests supported exact completeness count");
      assert(this.path === "invite" || this.path === "recover", "Exact lookup is allowed only in these explicit paths");
      const args = object(await request.json());
      equal(args.p_actor_user_id, this.actorId, "Lookup actor");
      equal(args.p_venue_id, VENUE, "Lookup venue");
      equal(args.p_normalized_email, EMAIL, "Lookup identity");
      this.requests.push("lookup");
      this.lookupSnapshot = structuredClone({ row:this.row, profile:this.profile, auditEvents:this.auditEvents });
      return this.lookupResponse ? this.lookupResponse() : Response.json([], { headers:{ "content-range":"*/0" } });
    }
    if (route === "POST /auth/v1/invite" && this.path === "invite") {
      const body = object(await request.json());
      equal(body.email, EMAIL, "Provider recipient must not change");
      this.requests.push("provider");
      this.providerCalls += 1;
      return Response.json({ user:{ id:TARGET_USER, email:EMAIL, invited_at:TIME, email_confirmed_at:null, user_metadata:body.data, app_metadata:{}, aud:"authenticated", created_at:TIME } });
    }
    if (route === "POST /rest/v1/staff_invitation_audit") {
      this.auditInsertAttempts += 1;
      this.requests.push("REJECTED-direct-audit-insert");
      // Never silently forgive the separately known required-attribution defect.
      return Response.json({ code:"23502", message:"Fictional audit insert lacks required attribution", details:null, hint:null }, { status:400 });
    }
    const allowed = this.path === "invite"
      ? [RPC.reserve, RPC.claim, RPC.dispatch, RPC.outcome, RPC.finalize]
      : [RPC[this.path]];
    const name = allowed.find(value => route === `POST /rest/v1/rpc/${value}`);
    if (name) {
      this.requests.push(name);
      return Response.json(this.rpc(name, object(await request.json())));
    }
    if (request.method !== "GET") this.mutationAttempts += 1;
    return fail(route);
  }
}

let activeSimulation: Simulation | undefined;
let handler: Handler | undefined;
const savedServe = Object.getOwnPropertyDescriptor(Deno, "serve");
assert(savedServe, "Deno.serve must be interceptable before adapter initialization");
Object.defineProperty(Deno, "serve", {
  configurable:savedServe.configurable,
  enumerable:savedServe.enumerable,
  writable:true,
  value:(callback: Handler) => {
    assert(handler === undefined, "Only one adapter listener registration is expected");
    handler = callback;
    return undefined; // The real index ignores this return value; no socket exists.
  }
});
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  assert(activeSimulation, "All fetches must occur within an explicitly active fictional test");
  return activeSimulation.fetch(input, init);
};
await import("../supabase/functions/staff-invitations/index.ts");
assert(handler, "Actual index.ts must register its handler through intercepted Deno.serve");

const INVITE_ORDER = [
  "authenticate", "authorize", RPC.reserve, "authorize", RPC.claim,
  "authorize", "lookup", "authorize", RPC.dispatch, "provider", RPC.outcome,
  "authorize", RPC.finalize
];
const GET_ORDERS = {
  recover:["authenticate", "authorize", "list", "authorize", "lookup", "authorize", RPC.recover],
  repair:["authenticate", "authorize", "list", "authorize", "authorize", RPC.repair],
  reconcile:["authenticate", "authorize", "list", "authorize", "observe-auth", "authorize", RPC.reconcile]
};
async function invoke(simulation: Simulation, enabled = true) {
  assert(handler, "Captured handler is available");
  assert(activeSimulation === undefined, "Tests must not overlap their global transport");
  Deno.env.set("DOORFLOW_STAFF_PROVISIONING_ENABLED", enabled ? "true" : "false");
  activeSimulation = simulation;
  const originalError = console.error;
  console.error = (...values: unknown[]) => simulation.safeLogs.push(values.map(String).join(" "));
  try {
    const response = await handler(new Request(`${API}/functions/v1/staff-invitations`, {
      method:simulation.path === "invite" ? "POST" : "GET",
      headers:{ origin:simulation.origin, authorization:"Bearer fictional.user.token", "content-type":"application/json" },
      ...(simulation.path === "invite" ? { body:JSON.stringify(simulation.action === "invite"
        ? { action:"invite", full_name:"Fictional Staff", email:simulation.requestEmail, role:"door", idempotency_key:IDEMPOTENCY_KEY }
        : { action:simulation.action, invitation_id:simulation.requestInvitationId || simulation.row.id }) } : {})
    }));
    const body = object(await response.json());
    return { response, body };
  } finally {
    activeSimulation = undefined;
    console.error = originalError;
    Deno.env.set("DOORFLOW_STAFF_PROVISIONING_ENABLED", "true");
  }
}
function assertIsolation(simulation: Simulation) {
  equal(simulation.unexpected, [], "No request may fall outside the strict fictional allowlist");
  equal(simulation.mutationAttempts, 0, "No compensating update or other unconfigured mutation");
  equal(simulation.auditInsertAttempts, 0, "No direct audit inserts may hide the known audit contract defect");
}
function malformed(name: string, path: Path, target: Rpc, rewrite: Rewrite, providerCalls: number, setup?: (simulation: Simulation) => void) {
  Deno.test(name, async () => {
    const simulation = new Simulation(path, target, rewrite);
    setup?.(simulation);
    const { response, body } = await invoke(simulation);
    const classification = body.error !== null && typeof body.error === "object" && !Array.isArray(body.error)
      ? object(body.error).code
      : body.ok === true ? "success" : "missing_error";
    console.log(JSON.stringify({
      case:name, status:response.status, classification, provider_calls:simulation.providerCalls,
      requests:simulation.requests, simulated_state:simulation.row.operation_state,
      simulated_profile_id:simulation.profile?.id || null, simulated_audit_events:simulation.auditEvents
    }));
    equal(classification, "invalid_database_contract", "Malformed RPC response classification");
    equal(response.status, 500, "Malformed RPC response status");
    equal(simulation.providerCalls, providerCalls, "Provider dispatch count");
    const order = path === "invite" ? INVITE_ORDER.slice(0, INVITE_ORDER.indexOf(target) + 1) : GET_ORDERS[path];
    equal(simulation.requests, order, "Stop at the invalid response boundary without further work");
    const committed = simulation.commits.get(target);
    assert(committed, "Target RPC must simulate a committed result before corrupting its reply");
    equal({ row:simulation.row, profile:simulation.profile, auditEvents:simulation.auditEvents }, committed, "Preserve all simulated committed state after a malformed reply");
    assert(!Object.hasOwn(body, "invitation"), "Invalid replies must not expose an unvalidated or earlier invitation snapshot");
    assert(!JSON.stringify(body).includes(OTHER_VENUE), "No cross-venue identity disclosure");
    assert(!JSON.stringify(body).includes(RAW_MARKER), "No raw untrusted reply in HTTP response");
    assert(!simulation.safeLogs.join("\n").includes(RAW_MARKER), "No raw untrusted reply in safe logs");
    assertIsolation(simulation);
  });
}

Deno.test("actual adapter: valid invite preserves the provider and profile workflow", async () => {
  const simulation = new Simulation("invite");
  const { response, body } = await invoke(simulation);
  equal(response.status, 201, "Valid invite status");
  equal(body.ok, true, "Valid invite response");
  equal(simulation.requests, INVITE_ORDER, "Actual SDK request order");
  equal(simulation.providerCalls, 1, "Exactly one intercepted provider request");
  equal(simulation.row.status, "sent", "Simulated invitation finalized");
  equal(simulation.profile, profile(), "Correct simulated profile identity and role");
  equal(simulation.auditEvents, ["reserved", "attempt_started", "dispatch_authorized", "provider_accepted", "profile_created", "provisioning_completed"], "Simulated required SQL evidence");
  assertIsolation(simulation);
});
malformed("actual adapter: reserved requires a record before claim", "invite", RPC.reserve, reply => ({ ...reply, record:null }), 0);
malformed("actual adapter: dispatch rejects another venue before provider", "invite", RPC.dispatch, reply => ({ ...reply, record:{ ...record(reply), venue_id:OTHER_VENUE } }), 0);
malformed("actual adapter: malformed outcome preserves committed provider evidence", "invite", RPC.outcome, reply => ({ ...reply, record:null }), 1);
malformed("actual adapter: created requires its committed profile evidence", "invite", RPC.finalize, reply => ({ ...reply, profile:null }), 1);
malformed("actual adapter: GET recovery cannot use a missing committed record", "recover", RPC.recover, reply => ({ ...reply, record:null }), 0);

const CASES: { operation: keyof typeof RPC; path: Path; target: Rpc; providerCalls: number }[] = [
  { operation:"reserve", path:"invite", target:RPC.reserve, providerCalls:0 },
  { operation:"claim", path:"invite", target:RPC.claim, providerCalls:0 },
  { operation:"dispatch", path:"invite", target:RPC.dispatch, providerCalls:0 },
  { operation:"outcome", path:"invite", target:RPC.outcome, providerCalls:1 },
  { operation:"finalize", path:"invite", target:RPC.finalize, providerCalls:1 },
  { operation:"recover", path:"recover", target:RPC.recover, providerCalls:0 },
  { operation:"repair", path:"repair", target:RPC.repair, providerCalls:0 },
  { operation:"reconcile", path:"reconcile", target:RPC.reconcile, providerCalls:0 }
];

const lookupUser = { id:TARGET_USER, email:EMAIL, email_confirmed_at:null, invited_at:TIME };
const BAD_LOOKUPS: [string, () => Response][] = [
  ["false body", () => Response.json(false, { headers:{ "content-range":"*/0" } })],
  ["zero body", () => Response.json(0, { headers:{ "content-range":"*/0" } })],
  ["empty string body", () => Response.json("", { headers:{ "content-range":"*/0" } })],
  ["null body", () => Response.json(null, { headers:{ "content-range":"*/0" } })],
  ["empty body", () => new Response(null, { headers:{ "content-range":"*/0" } })],
  ["false row", () => Response.json([false], { headers:{ "content-range":"0-0/1" } })],
  ["null row", () => Response.json([null], { headers:{ "content-range":"0-0/1" } })],
  ["object wrapper", () => Response.json({ data:[] }, { headers:{ "content-range":"*/0" } })],
  ["singleton instead of table", () => Response.json(lookupUser, { headers:{ "content-range":"0-0/1" } })],
  ["missing identity", () => Response.json([{ email:EMAIL, email_confirmed_at:null, invited_at:TIME }], { headers:{ "content-range":"0-0/1" } })],
  ["wrong identity type", () => Response.json([{ ...lookupUser, id:[] }], { headers:{ "content-range":"0-0/1" } })],
  ["invalid identity", () => Response.json([{ ...lookupUser, id:"not-a-uuid" }], { headers:{ "content-range":"0-0/1" } })],
  ["wrong email type", () => Response.json([{ ...lookupUser, email:[] }], { headers:{ "content-range":"0-0/1" } })],
  ["different email", () => Response.json([{ ...lookupUser, email:"other@example.invalid" }], { headers:{ "content-range":"0-0/1" } })],
  ["missing nullable column", () => Response.json([{ id:TARGET_USER, email:EMAIL, invited_at:TIME }], { headers:{ "content-range":"0-0/1" } })],
  ["wrong optional value", () => Response.json([{ ...lookupUser, invited_at:{} }], { headers:{ "content-range":"0-0/1" } })],
  ["ambiguous matches", () => Response.json([lookupUser, lookupUser], { headers:{ "content-range":"0-1/2" } })],
  ["missing completeness", () => Response.json([])],
  ["incomplete empty page", () => Response.json([], { headers:{ "content-range":"*/1" } })],
  ["incomplete match page", () => Response.json([lookupUser], { headers:{ "content-range":"0-0/2" } })],
  ["malformed count", () => Response.json([], { headers:{ "content-range":"*/0junk" } })],
  ["partial response", () => Response.json([], { status:206, headers:{ "content-range":"*/0" } })],
  ["SDK-normalized failed response", () => Response.json([], { status:404, headers:{ "content-range":"*/0" } })],
  ["decoding failure", () => new Response("{malformed", { headers:{ "content-range":"*/0" } })],
  ["failed request", () => Response.json({code:"FICTIONAL",message:RAW_MARKER}, {status:400})],
  ["network failure", () => { throw new Error(RAW_MARKER); }]
];
for (const [label, response] of BAD_LOOKUPS) {
  Deno.test(`actual exact lookup rejects ${label} without assumed absence`, async () => {
    const simulation = new Simulation("invite");
    simulation.lookupResponse = response;
    const result = await invoke(simulation);
    console.log(JSON.stringify({ case:label, status:result.response.status, error:result.body.error,
      providerCalls:simulation.providerCalls, requests:simulation.requests, state:simulation.row.operation_state,
      profile:simulation.profile?.id, audit:simulation.auditEvents }));
    equal(result.response.status, 500, "Invalid lookup is a controlled failure");
    equal(object(result.body.error).code, "invalid_database_contract", "Invalid lookup classification");
    equal(simulation.providerCalls, 0, "Invalid lookup cannot authorize a provider request");
    equal(simulation.requests, INVITE_ORDER.slice(0, 7), "Stop at lookup; no fallback mutation");
    equal({ row:simulation.row, profile:simulation.profile, auditEvents:simulation.auditEvents }, simulation.lookupSnapshot, "Earlier claim and audit commits remain intact");
    assert(!JSON.stringify(result.body).includes(RAW_MARKER), "Untrusted lookup details are not returned");
    assert(!simulation.safeLogs.join("\n").includes(RAW_MARKER), "Untrusted lookup details are not logged");
    assertIsolation(simulation);
  });
  Deno.test(`actual exact lookup GET recovery treats ${label} as incomplete, never absent`, async () => {
    const simulation = new Simulation("recover");
    simulation.lookupResponse = response;
    const before = structuredClone(simulation.row);
    const result = await invoke(simulation);
    equal(result.response.status, 200, "Existing conservative recovery returns its guarded receipt");
    equal(simulation.requests, GET_ORDERS.recover, "Recovery still reauthorizes after failed observation");
    equal(simulation.recoveryLookupComplete, false, "Invalid reply is explicitly incomplete");
    equal(simulation.recoveryObservedUser, null, "Do not adopt any invalid observed identity");
    equal(simulation.row.operation_token, before.operation_token, "Original dispatch ownership survives");
    equal(simulation.row.dispatch_started_at, before.dispatch_started_at, "Dispatch evidence survives");
    equal(simulation.row.auth_user_id, before.auth_user_id, "Identity is unchanged");
    equal(simulation.row.operation_state, "provider_unknown", "Uncertain operation cannot authorize another send");
    equal(simulation.auditEvents, ["reconciliation_checked"], "Guarded recovery evidence retained");
    equal(simulation.providerCalls, 0, "No provider request from failed lookup recovery");
    equal(simulation.profileWrites, 0, "No profile creation from failed observation");
    assertIsolation(simulation);
  });
}

for (const row of [lookupUser, { ...lookupUser, email:`  ${EMAIL.toUpperCase()}  `, invited_at:null, extra:{ harmless:true } }]) {
  Deno.test(`actual exact lookup complete match preserves nullable values and normalized email (${row.invited_at === null})`, async () => {
    const simulation = new Simulation("recover");
    simulation.lookupResponse = () => Response.json([row], { headers:{ "content-range":"0-0/1" } });
    const result = await invoke(simulation);
    equal(result.response.status, 200, "Valid complete observation accepted");
    equal(simulation.recoveryLookupComplete, true, "Valid match is complete");
    equal(simulation.recoveryObservedUser, TARGET_USER, "Only matching identity observed");
    equal(simulation.requests, GET_ORDERS.recover, "Authorization and guarded recovery order retained");
    equal(simulation.providerCalls, 0, "Observation never dispatches");
    equal(simulation.row.auth_user_id, null, "Unknown dispatch is not automatically adopted");
    assertIsolation(simulation);
  });
}

Deno.test("isolation: network, subprocesses, FFI, filesystem writes and uncached imports are denied", async () => {
  for (const name of ["net", "run", "ffi", "write", "import"] as const) {
    equal((await Deno.permissions.query({ name })).state, "denied", `${name} permission must be explicitly denied`);
  }
});

for (const path of ["recover", "repair", "reconcile"] as const) {
  Deno.test(`actual adapter: valid GET ${path} preserves existing behavior`, async () => {
    const simulation = new Simulation(path);
    const initialProfile = structuredClone(simulation.profile);
    const { response, body } = await invoke(simulation);
    equal(response.status, 200, "Valid reconciliation list status");
    equal(body.ok, true, "Valid reconciliation list result");
    equal(simulation.requests, GET_ORDERS[path], "GET request order including current authorization");
    equal(simulation.providerCalls, 0, "GET never dispatches");
    equal(simulation.profile, initialProfile, "GET neither recreates nor changes the profile");
    if (path === "recover") {
      equal(simulation.row.operation_state, "provider_unknown", "Uncertain dispatch stays fenced");
      equal(simulation.row.operation_token, PRIOR_OPERATION, "Recovery keeps original dispatch identity");
      equal(simulation.row.dispatch_started_at, TIME, "Recovery cannot erase dispatch evidence");
    } else if (path === "repair") {
      equal(simulation.row.pending_audit_event_type, null, "Successful simulated repair clears only repaired marker");
      equal(simulation.auditEvents, ["profile_created", "provisioning_completed"], "Repair preserves canonical evidence chain");
    } else {
      equal(simulation.row.status, "accepted", "Verified acceptance reflected");
      equal(simulation.row.auth_user_id, TARGET_USER, "Accepted identity preserved");
    }
    assertIsolation(simulation);
  });
}

for (const item of CASES) {
  malformed(`actual adapter ${item.operation}: required record omitted`, item.path, item.target, reply => {
    const { record:_record, ...withoutRecord } = reply;
    return withoutRecord;
  }, item.providerCalls);
  malformed(`actual adapter ${item.operation}: required record null`, item.path, item.target, reply => ({ ...reply, record:null }), item.providerCalls);
  malformed(`actual adapter ${item.operation}: wrong invitation field type`, item.path, item.target, reply => ({ ...reply, record:{ ...record(reply), attempt_count:"not-a-number" } }), item.providerCalls);
  malformed(`actual adapter ${item.operation}: unknown operation state`, item.path, item.target, reply => ({ ...reply, record:{ ...record(reply), operation_state:"invented_state" } }), item.providerCalls);
  malformed(`actual adapter ${item.operation}: unknown decision`, item.path, item.target, reply => ({ ...reply, decision_code:"invented_decision" }), item.providerCalls);
  malformed(`actual adapter ${item.operation}: contradictory decision aliases`, item.path, item.target, reply => ({ ...reply, decisionCode:"contradictory_decision" }), item.providerCalls);
  malformed(`actual adapter ${item.operation}: wrong venue is not disclosed`, item.path, item.target, reply => ({ ...reply, record:{ ...record(reply), venue_id:OTHER_VENUE } }), item.providerCalls);
  malformed(`actual adapter ${item.operation}: wrong intended identity`, item.path, item.target, reply => ({ ...reply, record:{ ...record(reply), email:"different.identity@example.invalid", normalized_email:"different.identity@example.invalid" } }), item.providerCalls);

  Deno.test(`actual adapter ${item.operation}: harmless extra fields and valid nulls are accepted`, async () => {
    const simulation = new Simulation(item.path, item.target, reply => ({
      ...reply, harmless_extra:{ ignored:true }, record:{ ...record(reply), harmless_column:"ignored" }
    }));
    const { response, body } = await invoke(simulation);
    equal(response.status, item.path === "invite" ? 201 : 200, "Valid result with harmless extensions");
    equal(body.ok, true, "Extra fields are not new business constraints");
    equal(simulation.requests, item.path === "invite" ? INVITE_ORDER : GET_ORDERS[item.path], "Valid operation order unchanged");
    equal(simulation.providerCalls, item.path === "invite" ? 1 : 0, "Valid dispatch count unchanged");
    assertIsolation(simulation);
  });

  for (const omitRecord of [false, true]) {
    Deno.test(`actual adapter ${item.operation}: legitimate denial with ${omitRecord ? "omitted" : "null"} record`, async () => {
      const deniedCode = item.operation === "outcome" ? "not_found" : "forbidden";
      const simulation = new Simulation(item.path, item.target, () => ({
        decision_code:deniedCode,
        ...(omitRecord ? {} : { record:null }),
        ...(item.operation === "claim" ? { retry_after_seconds:0 } : {})
      }), true);
      const { response, body } = await invoke(simulation);
      equal(object(body.error).code, item.operation === "outcome" ? "invitation_lease_lost" : "forbidden", "Valid denial classification retained");
      equal(response.status, item.operation === "outcome" ? 409 : 403, "Valid denial status retained");
      equal(simulation.providerCalls, item.providerCalls, "Denial does not trigger further provider dispatch");
      equal(simulation.requests, item.path === "invite" ? INVITE_ORDER.slice(0, INVITE_ORDER.indexOf(item.target) + 1) : GET_ORDERS[item.path], "Stop after denial");
      equal({ row:simulation.row, profile:simulation.profile, auditEvents:simulation.auditEvents }, simulation.commits.get(item.target), "Denial cannot cause compensating writes");
      assertIsolation(simulation);
    });
  }
}

malformed("actual adapter: RPC array cannot conceal extra results", "invite", RPC.reserve, reply => [reply, reply], 0);
malformed("actual adapter: claimed retry delay must be numeric", "invite", RPC.claim, reply => ({ ...reply, retry_after_seconds:"later" }), 0);
malformed("actual adapter: claimed provider requirement must be boolean", "invite", RPC.claim, reply => ({ ...reply, requires_provider_dispatch:"yes" }), 0);
malformed("actual adapter: dispatch operation token must match request", "invite", RPC.dispatch, reply => ({ ...reply, record:{ ...record(reply), operation_token:PRIOR_OPERATION } }), 0);
malformed("actual adapter: outcome cannot substitute Auth identity", "invite", RPC.outcome, reply => ({ ...reply, record:{ ...record(reply), auth_user_id:ADMIN } }), 1);
malformed("actual adapter: successful profile must preserve Auth identity", "invite", RPC.finalize, reply => ({ ...reply, profile:{ ...profile(), id:ADMIN } }), 1);
malformed("actual adapter: successful profile cannot reassign venue", "invite", RPC.finalize, reply => ({ ...reply, profile:{ ...profile(), venue_id:OTHER_VENUE } }), 1);
malformed("actual adapter: successful profile cannot silently change role", "invite", RPC.finalize, reply => ({ ...reply, profile:{ ...profile(), role:"admin" } }), 1);
malformed("actual adapter: successful profile active field requires boolean", "invite", RPC.finalize, reply => ({ ...reply, profile:{ ...profile(), active:"true" } }), 1);
malformed("actual adapter: successful profile full name cannot be missing", "invite", RPC.finalize, reply => {
  const { full_name:_name, ...incompleteProfile } = profile();
  return { ...reply, profile:incompleteProfile };
}, 1);
malformed("actual adapter: GET recovery cannot attach an unowned observed Auth identity", "recover", RPC.recover, reply => ({ ...reply, record:{ ...record(reply), auth_user_id:TARGET_USER } }), 0);
malformed("actual adapter: invalid raw database text stays out of responses and logs", "invite", RPC.dispatch, reply => ({ ...reply, record:{ ...record(reply), attempt_count:"invalid", failure_message:RAW_MARKER } }), 0);

for (const path of ["invite", "recover", "repair", "reconcile"] as const) {
  Deno.test(`actual adapter: disabled ${path} performs only authentication and authorization reads`, async () => {
    const simulation = new Simulation(path);
    const before = structuredClone({ row:simulation.row, profile:simulation.profile, auditEvents:simulation.auditEvents });
    const { response, body } = await invoke(simulation, false);
    equal(response.status, 503, "Disabled status");
    equal(object(body.error).code, "provisioning_disabled", "Disabled classification");
    equal(simulation.requests, ["authenticate", "authorize"], "Existing pre-gate read-only authentication/authorization is preserved");
    equal(simulation.providerCalls, 0, "Disabled provisioning sends nothing");
    equal({ row:simulation.row, profile:simulation.profile, auditEvents:simulation.auditEvents }, before, "Disabled provisioning changes no simulated state");
    assertIsolation(simulation);
  });
}

for (const target of [RPC.dispatch, RPC.outcome, RPC.finalize]) {
  Deno.test(`actual adapter: same request after malformed ${target} never blindly redispatches`, async () => {
    const simulation = new Simulation("invite", target, reply => ({ ...reply, record:null }));
    const first = await invoke(simulation);
    equal(object(first.body.error).code, "invalid_database_contract", "First response fails closed");
    const committed = structuredClone({ row:simulation.row, profile:simulation.profile, auditEvents:simulation.auditEvents });
    const providers = simulation.providerCalls;
    const second = await invoke(simulation);
    if (target === RPC.dispatch) {
      equal(object(second.body.error).code, "provider_outcome_unknown", "Unresolved dispatch replay remains blocked by current simulated database state");
      equal(second.response.status, 409, "Unresolved replay status");
    } else {
      equal(second.body.ok, true, "Replay returns the already committed simulated row without a new operation");
      equal(second.response.status, 200, "Replay status");
    }
    equal(simulation.providerCalls, providers, "No additional provider request after ambiguous reply");
    equal({ row:simulation.row, profile:simulation.profile, auditEvents:simulation.auditEvents }, committed, "Replay neither clears dispatch evidence nor repeats profile/audit writes");
    equal(simulation.requests.filter(value => value === RPC.dispatch).length, 1, "One durable dispatch attempt only");
    assertIsolation(simulation);
  });
}

Deno.test("actual adapter: profile-only retry never sends another invitation", async () => {
  const simulation = new Simulation("invite");
  simulation.action = "retry";
  simulation.row = seed("reconcile");
  Object.assign(simulation.row, {
    status:"profile_pending", profile_state:"failed", operation_state:"provider_accepted",
    operation_completed_at:null, failure_code:"profile_write_failed",
    failure_message:"The fictional profile still requires setup."
  });
  const { response, body } = await invoke(simulation);
  equal(response.status, 200, "Valid profile-only retry status");
  equal(body.ok, true, "Profile-only retry succeeds");
  equal(simulation.requests, ["authenticate", "authorize", "read", "authorize", RPC.claim, "authorize", "observe-auth", "authorize", RPC.finalize], "Profile-only workflow omits all dispatch operations");
  equal(simulation.providerCalls, 0, "Profile-only recovery cannot send email");
  equal(simulation.profileWrites, 1, "Exactly one simulated profile creation");
  equal(simulation.profile, profile(), "Profile identity/venue/role preserved");
  assertIsolation(simulation);
});

Deno.test("actual adapter: valid resend keeps its existing Auth identity and profile", async () => {
  const simulation = new Simulation("invite");
  simulation.action = "resend";
  simulation.row = seed("reconcile");
  simulation.profile = profile();
  const originalProfile = structuredClone(simulation.profile);
  const { response, body } = await invoke(simulation);
  equal(response.status, 200, "Valid resend status");
  equal(body.ok, true, "Valid resend result");
  equal(simulation.requests, ["authenticate", "authorize", "read", "authorize", RPC.claim, "authorize", "observe-auth", "authorize", "profile-target", "authorize", RPC.dispatch, "provider", RPC.outcome, "authorize", RPC.finalize], "Resend authorization and dispatch order");
  equal(simulation.providerCalls, 1, "One intercepted resend");
  equal(simulation.profileWrites, 0, "Resend never recreates existing profile");
  equal(simulation.profile, originalProfile, "Existing profile remains unchanged");
  equal(simulation.row.auth_user_id, TARGET_USER, "Original Auth identity retained");
  equal(simulation.row.profile_state, "existing", "Finalization truthfully reports existing profile");
  assertIsolation(simulation);
});

Deno.test("actual adapter: same-email collision from another Admin preserves the original role", async () => {
  const simulation: Simulation = new Simulation("invite", RPC.reserve, () => ({ decision_code:"email_reserved", record:structuredClone(simulation.row) }), true);
  simulation.actorId = OTHER_ADMIN;
  simulation.row.requested_role = "manager";
  const before = structuredClone(simulation.row);
  const { response, body } = await invoke(simulation);
  equal(response.status, 409, "Same-venue existing reservation is a conflict");
  equal(object(body.error).code, "invitation_exists", "Existing reservation classification");
  equal(simulation.requests, ["authenticate", "authorize", RPC.reserve], "Collision performs no new work");
  equal(simulation.providerCalls, 0, "Collision cannot dispatch");
  equal(simulation.row, before, "Other Admin cannot overwrite intended role or identity");
  equal(simulation.row.invited_by_user_id, ADMIN, "Original attribution preserved");
  assertIsolation(simulation);
});

Deno.test("actual adapter: idempotency conflict preserves original payload", async () => {
  const simulation: Simulation = new Simulation("invite", RPC.reserve, () => ({ decision_code:"idempotency_conflict", record:structuredClone(simulation.row) }), true);
  simulation.row.full_name = "Original Fictional Name";
  simulation.row.requested_role = "manager";
  const before = structuredClone(simulation.row);
  const { response, body } = await invoke(simulation);
  equal(response.status, 409, "Idempotency conflict status");
  equal(object(body.error).code, "idempotency_conflict", "Payload conflict retained");
  equal(simulation.providerCalls, 0, "Different payload cannot dispatch");
  equal(simulation.row, before, "Original intent remains unchanged");
  assertIsolation(simulation);
});

Deno.test("actual adapter: unconfigured request origin is rejected before any service work", async () => {
  const simulation = new Simulation("invite");
  simulation.origin = "http://127.0.0.1:4999";
  const { response, body } = await invoke(simulation);
  equal(response.status, 403, "Unconfigured origin status");
  equal(object(body.error).code, "origin_not_allowed", "Unconfigured origin classification");
  equal(simulation.requests, [], "No service request for an unconfigured origin");
  assertIsolation(simulation);
});

Deno.test("actual adapter: same-key replay with different email casing stays the same invitation", async () => {
  const simulation = new Simulation("invite");
  const first = await invoke(simulation);
  equal(first.response.status, 201, "Initial invitation succeeds");
  const committed = structuredClone(simulation.row);
  simulation.requestEmail = EMAIL.toUpperCase();
  const replay = await invoke(simulation);
  equal(replay.response.status, 200, "Normalized-email replay retains valid existing behavior");
  equal(replay.body.ok, true, "Email casing alone is not a payload conflict");
  equal(simulation.providerCalls, 1, "Replay does not send again");
  equal(simulation.row, committed, "Replay does not rewrite stored spelling or intent");
  assertIsolation(simulation);
});

Deno.test("actual adapter: uppercase UUID lookup retains canonical existing profile-only retry", async () => {
  const simulation = new Simulation("invite");
  simulation.action = "retry";
  simulation.row = seed("reconcile");
  Object.assign(simulation.row, {
    id:"3abcdef0-0000-4000-8000-000000000001",
    status:"profile_pending", profile_state:"failed", operation_state:"provider_accepted",
    operation_completed_at:null, failure_code:"profile_write_failed",
    failure_message:"The fictional profile still requires setup."
  });
  simulation.requestInvitationId = simulation.row.id.toUpperCase();
  const { response, body } = await invoke(simulation);
  equal(response.status, 200, "UUID casing accepted by the original request contract remains valid");
  equal(body.ok, true, "Canonical database UUID is not an identity mismatch");
  equal(simulation.providerCalls, 0, "Canonicalized profile retry sends nothing");
  equal(simulation.row.id, "3abcdef0-0000-4000-8000-000000000001", "Canonical invitation identity preserved");
  assertIsolation(simulation);
});

Deno.test("actual adapter: GET unconfirmed Auth observation remains not accepted", async () => {
  const simulation = new Simulation("reconcile");
  simulation.confirmedObservation = false;
  const beforeProfile = structuredClone(simulation.profile);
  const { response, body } = await invoke(simulation);
  equal(response.status, 200, "Valid not-accepted observation status");
  equal(body.ok, true, "Valid not-accepted decision is retained");
  equal(simulation.requests, GET_ORDERS.reconcile, "Unconfirmed observation follows existing authorized GET path");
  equal(simulation.row.status, "sent", "Unconfirmed Auth identity is not accepted");
  equal(simulation.row.accepted_at, null, "No confirmation timestamp is invented");
  equal(simulation.profile, beforeProfile, "Observation does not modify profile");
  equal(simulation.providerCalls, 0, "Observation sends nothing");
  assertIsolation(simulation);
});
malformed("actual adapter: GET cannot fabricate acceptance from an unconfirmed Auth observation", "reconcile", RPC.reconcile,
  reply => ({ ...reply, decision_code:"verified_auth", record:{ ...record(reply), status:"accepted", accepted_at:TIME } }),
  0, simulation => { simulation.confirmedObservation = false; });

for (const code of ["provider_rejected_verified", "rate_limited_verified"]) {
  malformed(`actual adapter: accepted provider outcome cannot be rewritten as ${code}`, "invite", RPC.outcome,
    reply => ({ ...reply, decision_code:code, record:{
      ...record(reply), operation_state:"provider_rejected", operation_completed_at:TIME,
      status:"failed", send_state:"failed", auth_user_id:null, last_sent_at:null,
      failure_code:code, failure_message:"Fictional rejection contradicts the accepted request."
    } }), 1);
}
malformed("actual adapter: pending audit cannot fabricate acceptance from an unconfirmed observation", "reconcile", RPC.reconcile,
  reply => ({ ...reply, decision_code:"audit_repair_required", record:{
    ...record(reply), status:"accepted", accepted_at:TIME,
    pending_audit_event_type:"accepted_reconciled", pending_audit_classification:"verified_auth",
    pending_audit_originating_actor_user_id:ADMIN,
    pending_audit_originating_request_id:record(reply).operation_request_id,
    pending_audit_operation_token:record(reply).operation_token, pending_audit_details:{},
    failure_code:"accepted_audit_pending", failure_message:"Fictional audit marker cannot establish acceptance."
  } }), 0, simulation => { simulation.confirmedObservation = false; });

// Helper checks are deliberately named separately from actual-adapter tests.
// They invoke the real dependency-free validator, never a copied validator.
const { parseRpcReply, isInvitationRecord } = await import("../supabase/functions/staff-invitations/rpc-validation.ts");
type Expectation = Parameters<typeof parseRpcReply>[2];
const BASIC_EXPECTATION: Expectation = { actorUserId:ADMIN, requestId:PRIOR_REQUEST };

// Expected row presence is transcribed from the review SQL return branches:
// reserve 711–803; claim 844–1054; dispatch 1087–1234; outcome 1273–1457;
// recover 1532–1709; finalize 1745–2016; reconcile 2062–2322; repair 2355–2563.
// This tests a local reviewed contract, not a deployed schema or transactions.
const SQL_BRANCHES: Record<Rpc, { withoutRecord: string[]; withRecord: string[]; optionalRecord?: string[] }> = {
  [RPC.reserve]: {
    withoutRecord:["invalid_request", "forbidden", "identity_unavailable"],
    optionalRecord:["idempotency_conflict"], withRecord:["reserved", "replay", "email_reserved"]
  },
  [RPC.claim]: {
    withoutRecord:["invalid_claim", "forbidden", "not_found", "operation_token_conflict"],
    withRecord:["operation_replay", "audit_repair_required", "provider_outcome_unknown", "attempt_in_progress", "accepted_terminal", "invite_not_eligible", "resend_not_eligible", "reconciliation_required", "retry_not_eligible", "resend_cooldown", "retry_cooldown", "claimed"]
  },
  [RPC.dispatch]: {
    withoutRecord:["invalid_request", "not_found", "forbidden"],
    withRecord:["operation_lost", "coordination_lease_expired", "dispatch_not_eligible", "dispatch_authorized"]
  },
  [RPC.outcome]: {
    withoutRecord:["invalid_outcome", "invalid_failure_code", "not_found"],
    withRecord:["operation_lost", "audit_repair_required", "provider_accepted", "invitation_resent", "provider_outcome_unknown", "provider_identity_mismatch", "resend_identity_mismatch", "provider_rejected_verified", "rate_limited_verified"]
  },
  [RPC.recover]: {
    withoutRecord:["invalid_recovery", "not_found", "forbidden", "operation_token_conflict"],
    withRecord:["version_conflict", "operation_lost", "provider_outcome_unknown", "attempt_in_progress", "audit_repair_required"]
  },
  [RPC.finalize]: {
    withoutRecord:["invalid_request", "not_found", "forbidden"],
    withRecord:["operation_lost", "coordination_lease_expired", "audit_repair_required", "profile_write_failed", "conflict", "profile_audit_pending", "created", "existing"]
  },
  [RPC.reconcile]: {
    withoutRecord:["invalid_request", "not_found", "forbidden", "operation_token_conflict"],
    withRecord:["version_conflict", "audit_repair_required", "provider_outcome_unknown", "attempt_in_progress", "exact_auth_lookup_unavailable", "unowned_auth_identity_mismatch", "existing_account_other_venue", "existing_account_inactive", "existing_account_role_conflict", "existing_account_active", "confirmed_account_unlinked", "unowned_pending_auth_account", "stored_auth_user_missing", "stored_auth_identity_mismatch", "not_accepted", "accepted_profile_missing", "accepted_profile_inactive", "accepted_profile_other_venue", "accepted_profile_role_conflict", "verified_auth"]
  },
  [RPC.repair]: {
    withoutRecord:["invalid_request", "forbidden", "not_found", "version_conflict"],
    withRecord:["no_pending_audit", "audit_state_invalid", "audit_id_collision", "audit_repair_required", "audit_repaired"]
  }
};
for (const operation of Object.keys(RPC) as (keyof typeof RPC)[]) {
  const name = RPC[operation];
  const branches = SQL_BRANCHES[name];
  for (const code of [...branches.withoutRecord, ...(branches.optionalRecord || [])]) {
    for (const omit of [false, true]) {
      Deno.test(`pure validator ${operation}: ${code} permits ${omit ? "omitted" : "null"} record`, () => {
        const result = parseRpcReply(name, {
          decision_code:code, ...(omit ? {} : { record:null }),
          ...(name === RPC.claim ? { retry_after_seconds:0 } : {})
        }, BASIC_EXPECTATION);
        assert(result !== null, "A documented record-free denial must remain valid");
        equal(result.decision_code, code, "Denial identity preserved");
        equal(result.record, null, "No denied identity is invented");
      });
    }
  }
  for (const code of branches.withRecord) {
    for (const omit of [false, true]) {
      Deno.test(`pure validator ${operation}: ${code} rejects ${omit ? "omitted" : "null"} required record`, () => {
        equal(parseRpcReply(name, {
          decision_code:code, ...(omit ? {} : { record:null }), retry_after_seconds:0,
          requires_provider_dispatch:true,
          ...(code === "conflict" ? { conflict_code:"existing_account_inactive" } : {})
        }, BASIC_EXPECTATION), null, "Required record cannot be fabricated or defaulted");
      });
    }
  }
}

for (const key of Object.keys(invitation())) {
  Deno.test(`pure validator: invitation requires field ${key}`, () => {
    const missing: Record<string, unknown> = { ...invitation() };
    delete missing[key];
    equal(isInvitationRecord(missing), false, "Even nullable SQL columns must be present in a full row");
  });
  Deno.test(`pure validator: invitation checks field ${key}`, () => {
    const malformedRow: Record<string, unknown> = { ...invitation(), [key]:{ unsupported:true } };
    equal(isInvitationRecord(malformedRow), false, "A required field cannot use an unsupported nested structure");
  });
}

function finalizationSample(code: "created" | "existing" | "profile_audit_pending" | "audit_repair_required") {
  const row = seed("reconcile");
  row.expected_auth_user_id = TARGET_USER;
  row.profile_state = code === "existing" ? "existing" : "created";
  const previous: InvitationRecord = {
    ...row, status:"profile_pending", profile_state:"pending", operation_state:"provider_accepted",
    operation_completed_at:null
  };
  if (code === "profile_audit_pending" || code === "audit_repair_required") {
    Object.assign(row, {
      status:code === "profile_audit_pending" ? "profile_pending" : "sent",
      pending_audit_event_type:code === "profile_audit_pending" ? "profile_created" : "provisioning_completed",
      pending_audit_classification:code === "profile_audit_pending" ? "created" : "profile_ready",
      pending_audit_originating_actor_user_id:ADMIN,
      pending_audit_originating_request_id:PRIOR_REQUEST,
      pending_audit_operation_token:PRIOR_OPERATION, pending_audit_details:{},
      failure_code:code === "profile_audit_pending" ? "profile_audit_pending" : "provisioning_audit_pending",
      failure_message:"Fictional committed profile requires only evidence repair."
    });
  }
  const expected: Expectation = {
    actorUserId:ADMIN, requestId:"60000000-0000-4000-8000-000000000002",
    invitationId:INVITATION, operationToken:PRIOR_OPERATION, previous,
    authUser:{ id:TARGET_USER, email:EMAIL }
  };
  return { row, expected, reply:{ decision_code:code, record:row, profile:profile() } };
}
for (const code of ["created", "existing", "profile_audit_pending", "audit_repair_required"] as const) {
  Deno.test(`pure validator: ${code} accepts complete preserved profile evidence`, () => {
    const sample = finalizationSample(code);
    const result = parseRpcReply(RPC.finalize, sample.reply, sample.expected);
    assert(result !== null, "A valid finalization shape remains accepted");
    equal(result.profile, profile(), "Correct identity and profile fields retained");
    equal(result.record?.operation_request_id, PRIOR_REQUEST, "Original attempt attribution is not overwritten by a later finalization request");
  });
  if (code !== "audit_repair_required") {
    for (const omit of [false, true]) {
      Deno.test(`pure validator: ${code} rejects ${omit ? "omitted" : "null"} required profile`, () => {
        const sample = finalizationSample(code);
        equal(parseRpcReply(RPC.finalize, {
          decision_code:code, record:sample.row, ...(omit ? {} : { profile:null })
        }, sample.expected), null, "Required committed profile evidence cannot disappear");
      });
    }
  }
}
for (const key of Object.keys(profile())) {
  Deno.test(`pure validator: successful profile requires ${key}`, () => {
    const sample = finalizationSample("created");
    const missing: Record<string, unknown> = { ...profile() };
    delete missing[key];
    equal(parseRpcReply(RPC.finalize, { ...sample.reply, profile:missing }, sample.expected), null, "Promised profile fields must be inspected");
  });
}

Deno.test("pure validator: an existing profile may legitimately have a changed full name", () => {
  const sample = finalizationSample("existing");
  const preserved = { ...profile(), full_name:"Fictional Later Name" };
  const result = parseRpcReply(RPC.finalize, { ...sample.reply, profile:preserved }, sample.expected);
  assert(result !== null, "Profile full name need not equal the original invitation name");
  equal(result.profile?.full_name, preserved.full_name, "Validation must not overwrite a later profile name");
});

for (const omit of [false, true]) {
  Deno.test(`pure validator: pre-profile audit-repair denial permits ${omit ? "omitted" : "null"} profile`, () => {
    const sample = finalizationSample("profile_audit_pending");
    Object.assign(sample.row, {
      profile_state:"pending", operation_state:"provider_accepted", operation_completed_at:null,
      pending_audit_event_type:"provider_accepted", pending_audit_classification:"provider_accepted",
      failure_code:"provider_audit_pending"
    });
    const result = parseRpcReply(RPC.finalize, {
      decision_code:"audit_repair_required", record:sample.row, ...(omit ? {} : { profile:null })
    }, sample.expected);
    assert(result !== null, "Earlier pending provider evidence can block profile work before a profile exists");
  });
}

for (const conflict of ["existing_account_other_venue", "existing_account_inactive", "existing_account_role_conflict"]) {
  Deno.test(`pure validator: finalization conflict ${conflict} has no profile payload`, () => {
    const sample = finalizationSample("created");
    Object.assign(sample.row, { status:"failed", profile_state:"failed", failure_code:conflict });
    const result = parseRpcReply(RPC.finalize, {
      decision_code:"conflict", conflict_code:conflict, record:sample.row, profile:null
    }, sample.expected);
    assert(result !== null, "Conflict returns truthful failure state without exposing another profile");
    equal(result.conflict_code, conflict, "Specific conflict classification preserved");
    equal(result.profile, null, "No profile is invented for a conflict");
  });
}

Deno.test("pure validator: operation-lost reply can describe a newer owner's token", () => {
  const prior = seed("recover");
  const current = {
    ...prior, operation_token:"50000000-0000-4000-8000-000000000002",
    operation_actor_user_id:OTHER_ADMIN, operation_request_id:"60000000-0000-4000-8000-000000000002",
    operation_fence:2
  };
  const result = parseRpcReply(RPC.dispatch, { decision_code:"operation_lost", record:current }, {
    ...BASIC_EXPECTATION, invitationId:INVITATION, operationToken:PRIOR_OPERATION, previous:prior
  });
  assert(result !== null, "A legitimate ownership-loss denial must not falsely require the old token");
  equal(result.record?.operation_token, current.operation_token, "The newer ownership evidence remains distinguishable");
});

Deno.test("pure validator: singleton wrapper and matching compatibility aliases remain valid", () => {
  const sample = finalizationSample("existing");
  const result = parseRpcReply(RPC.finalize, [{
    ...sample.reply, decisionCode:"existing", invitation:structuredClone(sample.row), id:sample.row.id,
    harmless_extra:{ future_field:true }
  }], sample.expected);
  assert(result !== null, "One complete result with matching aliases is not an invented ambiguity");
  equal(result.decision_code, "existing", "Canonical checked representation retained");
});

Deno.test("pure validator: fields do not gain an invented timestamp or name format", () => {
  const row = invitation();
  row.created_at = "database-timestamp-representation";
  row.full_name = "Fictional • Name";
  assert(isInvitationRecord(row), "Boundary validation must not add unrequested timestamp/name syntax rules");
});

Deno.test("pure validator: nullable-venue successful profile contradicts the supplied venue", () => {
  const sample = finalizationSample("existing");
  equal(parseRpcReply(RPC.finalize, { ...sample.reply, profile:{ ...profile(), venue_id:null } }, sample.expected), null,
    "Documented SQL nullable-venue comparison gap must not become a false matching-profile promise");
});

function acceptedObservationSample() {
  const previous = seed("reconcile");
  const row: InvitationRecord = {
    ...previous, status:"accepted", accepted_at:TIME,
    operation_token:"50000000-0000-4000-8000-000000000002",
    operation_action:"reconcile", operation_fence:2,
    operation_request_id:"60000000-0000-4000-8000-000000000002",
    expected_auth_user_id:TARGET_USER, dispatch_started_at:null, dispatch_authorized_at:null
  };
  const expected: Expectation = {
    actorUserId:ADMIN, requestId:"60000000-0000-4000-8000-000000000002",
    invitationId:INVITATION, operationToken:row.operation_token, previous,
    observation:{ authUserId:TARGET_USER, normalizedEmail:EMAIL, emailConfirmedAt:TIME }
  };
  return { row, expected, reply:{ decision_code:"verified_auth", record:row } };
}

Deno.test("pure validator: Auth and PostgreSQL timestamp spellings can identify the same instant", () => {
  const sample = acceptedObservationSample();
  sample.row.accepted_at = "2025-12-31T19:00:00-05:00";
  const result = parseRpcReply(RPC.reconcile, sample.reply, sample.expected);
  assert(result !== null, "Equivalent observed timestamp instants retain valid acceptance");
  equal(result.record?.accepted_at, sample.row.accepted_at, "Validator preserves the database spelling rather than inventing one");
});

Deno.test("pure validator: reconciliation cannot replace the observed confirmation instant", () => {
  const sample = acceptedObservationSample();
  sample.row.accepted_at = "2026-01-02T00:00:00.000Z";
  equal(parseRpcReply(RPC.reconcile, sample.reply, sample.expected), null, "A different accepted-at instant contradicts the observation");
});

for (const [description, observation] of [
  ["null confirmation", { authUserId:TARGET_USER, normalizedEmail:EMAIL, emailConfirmedAt:null }],
  ["null Auth identity", { authUserId:null, normalizedEmail:EMAIL, emailConfirmedAt:TIME }],
  ["wrong Auth identity", { authUserId:ADMIN, normalizedEmail:EMAIL, emailConfirmedAt:TIME }],
  ["wrong normalized email", { authUserId:TARGET_USER, normalizedEmail:"other.fictional@example.invalid", emailConfirmedAt:TIME }]
] as const) {
  Deno.test(`pure validator: verified acceptance rejects ${description}`, () => {
    const sample = acceptedObservationSample();
    equal(parseRpcReply(RPC.reconcile, sample.reply, { ...sample.expected, observation }), null, "Acceptance must be tied to the supplied verified observation");
  });
}

function recoveredObservationSample() {
  const previous = seed("recover");
  const row: InvitationRecord = {
    ...previous, status:"reconciliation_required", operation_state:"provider_unknown",
    processing_started_at:null, lease_expires_at:null, last_actor_user_id:OTHER_ADMIN,
    failure_code:"provider_outcome_unknown", failure_message:"Fictional dispatch remains unresolved."
  };
  const expected: Expectation = {
    actorUserId:OTHER_ADMIN, requestId:"60000000-0000-4000-8000-000000000002",
    invitationId:INVITATION, operationToken:PRIOR_OPERATION, previous,
    observation:{ authUserId:TARGET_USER, normalizedEmail:EMAIL, emailConfirmedAt:null }
  };
  return { row, expected, reply:{ decision_code:"provider_outcome_unknown", record:row } };
}

Deno.test("pure validator: another Admin may recover without acquiring identity or original attribution", () => {
  const sample = recoveredObservationSample();
  const result = parseRpcReply(RPC.recover, sample.reply, sample.expected);
  assert(result !== null, "Authorized recovery can truthfully record an observation by another Admin");
  equal(result.record?.auth_user_id, null, "Observed account is not acquired");
  equal(result.record?.expected_auth_user_id, null, "Original nullable dispatch identity is preserved");
  equal(result.record?.operation_actor_user_id, ADMIN, "Original operation actor remains distinct");
  equal(result.record?.operation_request_id, PRIOR_REQUEST, "Original request attribution is preserved");
  equal(result.record?.last_actor_user_id, OTHER_ADMIN, "Recovering actor can be recorded separately");
});

const RECOVERY_FORGERIES: [string, Partial<InvitationRecord>][] = [
  ["acquired Auth identity", { auth_user_id:TARGET_USER }],
  ["expected Auth identity", { expected_auth_user_id:TARGET_USER }],
  ["original actor", { operation_actor_user_id:OTHER_ADMIN }],
  ["original request", { operation_request_id:"60000000-0000-4000-8000-000000000002" }],
  ["operation token", { operation_token:"50000000-0000-4000-8000-000000000002" }],
  ["operation action", { operation_action:"retry" }],
  ["operation fence", { operation_fence:2 }],
  ["operation start", { operation_started_at:"2026-01-02T00:00:00.000Z" }]
];
for (const [description, changes] of RECOVERY_FORGERIES) {
  Deno.test(`pure validator: recovery cannot rewrite ${description}`, () => {
    const sample = recoveredObservationSample();
    equal(parseRpcReply(RPC.recover, { ...sample.reply, record:{ ...sample.row, ...changes } }, sample.expected), null,
      "Recovery's observed identity and repairing actor do not replace the dispatch contract");
  });
}

// Step 3E: actual handler/SDK integration with SIMULATED SQL audit replies.
// These fixtures do not execute append_audit, transactions, RLS, or constraints.
// Their rows document the reviewed SQL contract; assertions below test adapter
// routing, attribution inputs, conservative responses, and absence of fallback
// writes. PostgreSQL must independently verify the real canonical writer.
const { createHash } = await import("node:crypto");
type SimulatedAuditRow = {
  id:string; invitation_id:string; venue_id:string; actor_user_id:string;
  originating_actor_user_id:string; operation_token:string | null;
  repair_operation_token:string | null; event_type:string; classification:string;
  request_id:string; recorded_request_id:string;
  details:Record<string, string | number | boolean | null>; created_at:string;
};
type AuditFixtureMode = "normal" | "profile_pending" | "completion_pending" | "provider_pending"
  | "repair_collision" | "repair_chain_pending" | "repair_lost_reply" | "repair_forbidden";

function simulatedAuditId(invitationId: string, operationToken: string | null, event: string, classification: string): string {
  // Exact event_uuid input framing from the review-only SQL, including its
  // reservation sentinel. This is a fixture identity, not a replacement writer.
  const hex = createHash("md5").update([invitationId, operationToken ?? "reservation", event, classification].join("\n")).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function canonicalAuditFields(row: SimulatedAuditRow) {
  // Recorder and repair request differ legitimately on a later repair. The
  // canonical original evidence must not be replaced by the later recorder.
  return {
    id:row.id, invitation_id:row.invitation_id, venue_id:row.venue_id,
    originating_actor_user_id:row.originating_actor_user_id,
    operation_token:row.operation_token, event_type:row.event_type,
    classification:row.classification, request_id:row.request_id, details:row.details
  };
}
class SqlAuditSimulation extends Simulation {
  mode: AuditFixtureMode = "normal";
  readonly canonicalRows = new Map<string, SimulatedAuditRow>();
  readonly auditRpcInputs: { name:Rpc; args:Record<string, unknown> }[] = [];
  simulatedCanonicalInsertions = 0;
  simulatedCanonicalVerifications = 0;
  revokeAtAuthorization: number | undefined;
  revokeKind: "inactive" | "other_venue" = "inactive";
  private authorizationReads = 0;

  auditFixture(args: Record<string, unknown>, event: string, classification: string,
    details: SimulatedAuditRow["details"] = {}, repairing = false): SimulatedAuditRow {
    const operation = event === "invitation_reserved" ? null
      : repairing ? this.row.pending_audit_operation_token : this.row.operation_token;
    const origin = event === "invitation_reserved" ? this.actorId
      : repairing ? this.row.pending_audit_originating_actor_user_id : this.row.operation_actor_user_id;
    const originalRequest = event === "invitation_reserved" ? stringField(args, "p_request_id")
      : repairing ? this.row.pending_audit_originating_request_id : this.row.operation_request_id;
    assert(origin && originalRequest, "Audit fixture requires persisted original provenance");
    return {
      id:simulatedAuditId(this.row.id, operation, event, classification), invitation_id:this.row.id,
      venue_id:this.row.venue_id, actor_user_id:this.actorId, originating_actor_user_id:origin,
      operation_token:operation, repair_operation_token:repairing ? stringField(args, "p_repair_operation_token") : null,
      event_type:event, classification, request_id:originalRequest,
      recorded_request_id:stringField(args, "p_request_id"), details, created_at:TIME
    };
  }
  stageSimulatedAudit(row: SimulatedAuditRow): boolean {
    const existing = this.canonicalRows.get(row.id);
    if (existing) {
      this.simulatedCanonicalVerifications += 1;
      return JSON.stringify(canonicalAuditFields(existing)) === JSON.stringify(canonicalAuditFields(row));
    }
    this.canonicalRows.set(row.id, structuredClone(row));
    this.simulatedCanonicalInsertions += 1;
    return true;
  }
  markPending(event: string, classification: string, failure: string) {
    assert(this.row.operation_token && this.row.operation_actor_user_id && this.row.operation_request_id,
      "Pending fixture requires original attempt provenance");
    Object.assign(this.row, {
      pending_audit_event_type:event, pending_audit_classification:classification,
      pending_audit_originating_actor_user_id:this.row.operation_actor_user_id,
      pending_audit_originating_request_id:this.row.operation_request_id,
      pending_audit_operation_token:this.row.operation_token, pending_audit_details:{},
      failure_code:failure, failure_message:"Fictional required audit evidence awaits repair."
    });
  }
  override rpc(name: Rpc, args: Record<string, unknown>): unknown {
    this.auditRpcInputs.push({ name, args:structuredClone(args) });
    if (name === RPC.repair) {
      equal(args.p_actor_user_id, this.actorId, "Repair RPC receives the current verified actor");
      equal(args.p_invitation_id, this.row.id, "Repair RPC targets only the known invitation");
      if (this.mode === "repair_forbidden") return { decision_code:"forbidden", record:null };
      const event = this.row.pending_audit_event_type;
      const classification = this.row.pending_audit_classification;
      assert(event && classification, "Repair fixture starts with an exact durable marker");
      const audit = this.auditFixture(args, event, classification, {}, true);
      const matches = this.stageSimulatedAudit(audit);
      if (this.mode === "repair_collision") {
        assert(!matches, "Collision fixture must contain genuinely different canonical evidence");
        return { decision_code:"audit_id_collision", record:structuredClone(this.row) };
      }
      assert(matches, "Configured simulated canonical audit agrees with prior evidence");
      if (this.mode === "repair_lost_reply") {
        // Deliberately adversarial retained-marker state with existing evidence.
        // This is NOT a claim that a real SQL transaction commits half a repair.
        this.commit(name);
        return { decision_code:"audit_repaired", record:null };
      }
      if (event === "profile_created" || event === "profile_verified") {
        if (this.mode === "repair_chain_pending") {
          this.row.status = "sent";
          this.markPending("provisioning_completed", "profile_ready", "provisioning_audit_pending");
          this.commit(name);
          return { decision_code:"audit_repair_required", record:structuredClone(this.row) };
        }
        assert(this.stageSimulatedAudit(this.auditFixture(args, "provisioning_completed", "profile_ready", {}, true)),
          "Configured completion evidence agrees with prior evidence");
      }
      Object.assign(this.row, {
        status:event === "profile_created" || event === "profile_verified" ? "sent" : this.row.status,
        pending_audit_event_type:null, pending_audit_classification:null,
        pending_audit_originating_actor_user_id:null, pending_audit_originating_request_id:null,
        pending_audit_operation_token:null, pending_audit_details:null,
        failure_code:null, failure_message:null, last_actor_user_id:this.actorId
      });
      this.auditEvents.push(event);
      if (event === "profile_created" || event === "profile_verified") this.auditEvents.push("provisioning_completed");
      this.commit(name);
      return { decision_code:"audit_repaired", record:structuredClone(this.row) };
    }
    const previousEvents = [...this.auditEvents];
    const result = super.rpc(name, args);
    if (name === RPC.reserve) {
      assert(this.stageSimulatedAudit(this.auditFixture(args, "invitation_reserved", "reserved")), "Reservation fixture evidence");
    } else if (name === RPC.claim) {
      assert(this.stageSimulatedAudit(this.auditFixture(args, "attempt_started", this.action, {
        action:this.action, attempt_count:this.row.attempt_count, operation_fence:this.row.operation_fence
      })), "Attempt fixture evidence");
    } else if (name === RPC.dispatch) {
      assert(this.stageSimulatedAudit(this.auditFixture(args, "dispatch_authorized", this.action, {
        action:this.action, operation_fence:this.row.operation_fence
      })), "Dispatch fixture evidence");
    } else if (name === RPC.outcome) {
      const classification = this.action === "resend" ? "invitation_resent" : "provider_accepted";
      if (this.mode === "provider_pending") {
        this.auditEvents.splice(0, this.auditEvents.length, ...previousEvents);
        this.markPending("provider_accepted", classification, "provider_audit_pending");
        this.commit(name);
        return { decision_code:"audit_repair_required", record:structuredClone(this.row) };
      }
      assert(this.stageSimulatedAudit(this.auditFixture(args, "provider_accepted", classification)), "Provider fixture evidence");
    } else if (name === RPC.finalize) {
      const state = this.row.profile_state;
      assert(state === "created" || state === "existing", "Finalization fixture profile state");
      const event = state === "created" ? "profile_created" : "profile_verified";
      if (this.mode === "profile_pending") {
        this.auditEvents.splice(0, this.auditEvents.length, ...previousEvents);
        this.row.status = "profile_pending";
        this.markPending(event, state, "profile_audit_pending");
        this.commit(name);
        return { decision_code:"profile_audit_pending", record:structuredClone(this.row), profile:structuredClone(this.profile) };
      }
      assert(this.stageSimulatedAudit(this.auditFixture(args, event, state)), "Profile fixture evidence");
      if (this.mode === "completion_pending") {
        this.auditEvents.splice(0, this.auditEvents.length, ...previousEvents, event);
        this.markPending("provisioning_completed", "profile_ready", "provisioning_audit_pending");
        this.commit(name);
        return { decision_code:"audit_repair_required", record:structuredClone(this.row), profile:structuredClone(this.profile) };
      }
      assert(this.stageSimulatedAudit(this.auditFixture(args, "provisioning_completed", "profile_ready")), "Completion fixture evidence");
    }
    return result;
  }
  override async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === API && request.method === "GET" && url.pathname === "/rest/v1/staff_profiles"
        && url.searchParams.get("id") === `eq.${this.actorId}`) {
      this.authorizationReads += 1;
      if (this.authorizationReads === this.revokeAtAuthorization) {
        this.requests.push("authorize");
        return Response.json([{ id:this.actorId, full_name:"Fictional Admin", role:"admin",
          active:this.revokeKind !== "inactive", venue_id:this.revokeKind === "other_venue" ? OTHER_VENUE : VENUE }]);
      }
    }
    // A pending marker on POST retry/resend must route to repair and then stop.
    // All other routes, particularly the rejected direct audit insert, remain
    // the unchanged original strict fictional transport implementation above.
    if (url.origin === API && request.method === "POST" && url.pathname === `/rest/v1/rpc/${RPC.repair}`
        && this.path === "invite" && this.action !== "invite") {
      this.requests.push(RPC.repair);
      return Response.json(this.rpc(RPC.repair, object(await request.json())));
    }
    return await super.fetch(request);
  }
}
function simulatedEvent(simulation: SqlAuditSimulation, event: string): SimulatedAuditRow {
  const matches = [...simulation.canonicalRows.values()].filter(row => row.event_type === event);
  equal(matches.length, 1, "Fixture has exactly one requested canonical event");
  const match = matches[0];
  assert(match, "Canonical event fixture exists");
  return match;
}
function transferAuditFixture(source: SqlAuditSimulation, path: Path): SqlAuditSimulation {
  const next = new SqlAuditSimulation(path);
  next.row = structuredClone(source.row);
  next.profile = structuredClone(source.profile);
  for (const [id, row] of source.canonicalRows) next.canonicalRows.set(id, structuredClone(row));
  return next;
}
function assertNoRepairSideEffects(simulation: SqlAuditSimulation, preservedProfile: StaffProfile | null) {
  equal(simulation.providerCalls, 0, "Audit repair must not dispatch an email");
  equal(simulation.profileWrites, 0, "Audit repair must not recreate a profile");
  equal(simulation.profile, preservedProfile, "Committed profile identity, role, venue and activity are preserved");
  assertIsolation(simulation);
}

Deno.test("actual adapter SQL-audit integration (simulated): normal invitation uses guarded RPCs and complete original provenance", async () => {
  const simulation = new SqlAuditSimulation("invite");
  const { response, body } = await invoke(simulation);
  equal(response.status, 201, "Normal invitation result");
  equal(body.ok, true, "Normal invitation classification");
  equal(simulation.requests, INVITE_ORDER, "SQL-backed route has no direct audit insert");
  equal(simulation.canonicalRows.size, 6, "Fixture supplies reservation, claim, dispatch, provider, profile and completion evidence");
  const reserved = simulatedEvent(simulation, "invitation_reserved");
  equal(reserved.operation_token, null, "Reservation uses SQL's null-operation identity");
  for (const audit of simulation.canonicalRows.values()) {
    equal(audit.actor_user_id, ADMIN, "Original request records its own evidence");
    equal(audit.originating_actor_user_id, ADMIN, "Original actor is explicit");
    equal(audit.request_id, body.request_id, "Original request is explicit");
    equal(audit.recorded_request_id, body.request_id, "Recording request is independently present");
    equal(audit.repair_operation_token, null, "Normal operation is not mislabeled as repair");
    if (audit.event_type !== "invitation_reserved") equal(audit.operation_token, simulation.row.operation_token, "Attempt event identity is fenced");
  }
  equal(simulation.providerCalls, 1, "Only one fictional dispatch");
  equal(simulation.profileWrites, 1, "Only one fictional profile creation");
  assertIsolation(simulation);
});

Deno.test("actual adapter SQL-audit integration (simulated): later resend belongs to its Admin and attempt, not the first inviter", async () => {
  const simulation = new SqlAuditSimulation("invite");
  simulation.action = "resend";
  simulation.actorId = OTHER_ADMIN;
  simulation.row = seed("reconcile");
  simulation.profile = profile();
  const originalProfile = structuredClone(simulation.profile);
  const { response, body } = await invoke(simulation);
  equal(response.status, 200, "Separately authorized resend succeeds");
  equal(body.ok, true, "Resend classification");
  equal(simulation.row.invited_by_user_id, ADMIN, "Original inviter is not overwritten");
  assert(simulation.row.operation_token !== PRIOR_OPERATION, "Resend owns a distinct operation");
  assert(body.request_id !== PRIOR_REQUEST, "Resend has its own request provenance");
  equal(simulatedEvent(simulation, "provider_accepted").classification, "invitation_resent", "Provider evidence identifies resend");
  for (const audit of simulation.canonicalRows.values()) {
    equal(audit.originating_actor_user_id, OTHER_ADMIN, "This attempt's actor is not inferred from the invitation creator");
    equal(audit.actor_user_id, OTHER_ADMIN, "Current attempt recorder");
    equal(audit.request_id, body.request_id, "Current attempt origin request");
    equal(audit.operation_token, simulation.row.operation_token, "Current attempt canonical identity");
  }
  equal(simulation.providerCalls, 1, "Exactly one fictional resend dispatch");
  equal(simulation.profileWrites, 0, "Existing profile is not recreated");
  equal(simulation.profile, originalProfile, "Existing profile is unchanged");
  assertIsolation(simulation);
});

Deno.test("actual adapter SQL-audit integration (simulated): different Admin repairs original evidence without taking its attribution", async () => {
  const simulation = new SqlAuditSimulation("repair");
  simulation.actorId = OTHER_ADMIN;
  const originalProfile = structuredClone(simulation.profile);
  const { response, body } = await invoke(simulation);
  equal(response.status, 200, "Authorized repair result");
  equal(body.ok, true, "Authorized repair classification");
  equal(simulation.requests, GET_ORDERS.repair, "Repair follows current-Admin guards and one RPC");
  equal(simulation.canonicalRows.size, 2, "Profile and skipped completion evidence are represented");
  for (const audit of simulation.canonicalRows.values()) {
    equal(audit.actor_user_id, OTHER_ADMIN, "Repairing actor is distinguishable");
    equal(audit.originating_actor_user_id, ADMIN, "Original actor remains original");
    equal(audit.request_id, PRIOR_REQUEST, "Original request remains original");
    equal(audit.operation_token, PRIOR_OPERATION, "Original operation defines the canonical ID");
    equal(audit.recorded_request_id, body.request_id, "New recording request is explicit");
    assert(audit.repair_operation_token && audit.repair_operation_token !== PRIOR_OPERATION, "Repair has a distinct operation identity");
  }
  equal(simulation.row.pending_audit_event_type, null, "Validated repair result clears the pending marker");
  assertNoRepairSideEffects(simulation, originalProfile);
});

Deno.test("actual adapter SQL-audit integration (simulated): uncertain reply with retained marker verifies existing canonical evidence on recovery", async () => {
  const simulation = new SqlAuditSimulation("repair");
  simulation.mode = "repair_lost_reply";
  const originalProfile = structuredClone(simulation.profile);
  const first = await invoke(simulation);
  equal(first.response.status, 500, "Missing repair outcome is not acknowledged as success");
  equal(object(first.body.error).code, "invalid_database_contract", "Uncertain reply classification");
  equal(simulation.row.pending_audit_event_type, "profile_created", "Adversarial retained marker is not cleared by the application");
  const originalEvidence = structuredClone(simulatedEvent(simulation, "profile_created"));
  simulation.mode = "normal";
  simulation.actorId = OTHER_ADMIN;
  const second = await invoke(simulation);
  equal(second.response.status, 200, "A later explicit repair can verify the supplied canonical evidence");
  equal(simulation.simulatedCanonicalVerifications, 1, "Existing event is canonically verified in the fixture rather than duplicated");
  equal(simulation.simulatedCanonicalInsertions, 2, "Only the profile and completion fixture events exist");
  equal(simulatedEvent(simulation, "profile_created"), originalEvidence, "The earlier recorder's evidence is not overwritten by repair");
  equal(simulatedEvent(simulation, "provisioning_completed").actor_user_id, OTHER_ADMIN, "Only new completion evidence uses the later recorder");
  equal(simulation.row.pending_audit_event_type, null, "Successful canonical verification clears the marker");
  assertNoRepairSideEffects(simulation, originalProfile);
});

Deno.test("actual adapter SQL-audit integration (simulated): same canonical ID with different contents remains a collision and pending", async () => {
  const simulation = new SqlAuditSimulation("repair");
  simulation.mode = "repair_collision";
  const prior = simulation.auditFixture({ p_request_id:PRIOR_REQUEST, p_repair_operation_token:PRIOR_OPERATION }, "profile_created", "created", {}, true);
  prior.originating_actor_user_id = OTHER_ADMIN;
  simulation.canonicalRows.set(prior.id, structuredClone(prior));
  const pending = structuredClone(simulation.row);
  const originalProfile = structuredClone(simulation.profile);
  const { response, body } = await invoke(simulation);
  equal(response.status, 500, "Canonical collision is not reported as successful repair");
  equal(object(body.error).code, "audit_id_collision", "Collision retains its explicit classification");
  equal(simulation.row, pending, "Exact pending condition is preserved");
  equal(simulation.canonicalRows.get(prior.id), prior, "Conflicting canonical evidence is not replaced");
  equal(simulation.canonicalRows.size, 1, "No completion event is invented after collision");
  assertNoRepairSideEffects(simulation, originalProfile);
});

for (const [mode, expectedCode, event] of [
  ["profile_pending", "profile_audit_pending", "profile_created"],
  ["completion_pending", "audit_repair_required", "provisioning_completed"]
] as const) {
  Deno.test(`actual adapter SQL-audit integration (simulated): committed profile with ${mode} repairs evidence without resend or recreation`, async () => {
    const initial = new SqlAuditSimulation("invite");
    initial.mode = mode;
    const failed = await invoke(initial);
    equal(failed.response.status, 502, "Committed profile is not falsely reported fully provisioned");
    equal(object(failed.body.error).code, expectedCode, "Audit condition has its own classification");
    equal(initial.row.pending_audit_event_type, event, "Exact missing event remains durable in the fixture");
    equal(initial.profile?.id, TARGET_USER, "Successful profile is preserved");
    equal(initial.profileWrites, 1, "Only the initial profile was created");
    equal(initial.providerCalls, 1, "Original invitation was dispatched only once");
    assertIsolation(initial);
    const recovery = transferAuditFixture(initial, "invite");
    recovery.actorId = OTHER_ADMIN;
    recovery.action = "resend";
    const originalProfile = structuredClone(recovery.profile);
    const repaired = await invoke(recovery);
    equal(repaired.response.status, 409, "Repair is not permission to continue the requested resend");
    equal(object(repaired.body.error).code, "audit_repair_completed", "Caller must explicitly refresh after repair");
    equal(recovery.requests, ["authenticate", "authorize", "read", "authorize", RPC.repair], "Only guarded repair runs");
    equal(recovery.row.pending_audit_event_type, null, "Repair clears only the missing evidence condition");
    equal(recovery.canonicalRows.size, 6, "Complete canonical fixture evidence is present once");
    assertNoRepairSideEffects(recovery, originalProfile);
  });
}

Deno.test("actual adapter SQL-audit integration (simulated): provider acceptance audit failure stops before profile finalization and duplicate dispatch", async () => {
  const initial = new SqlAuditSimulation("invite");
  initial.mode = "provider_pending";
  const failed = await invoke(initial);
  equal(failed.response.status, 502, "Missing provider evidence is not reported as successful provisioning");
  equal(object(failed.body.error).code, "audit_repair_required", "Provider audit uncertainty is explicit");
  equal(initial.providerCalls, 1, "Provider was called once before its evidence became pending");
  equal(initial.profileWrites, 0, "No profile work proceeds past missing provider evidence");
  equal(initial.row.auth_user_id, TARGET_USER, "Accepted identity is retained");
  equal(initial.row.pending_audit_event_type, "provider_accepted", "Exact provider evidence marker is retained");
  equal(initial.requests, INVITE_ORDER.slice(0, INVITE_ORDER.indexOf(RPC.outcome) + 1), "Outcome boundary stops later work");
  assertIsolation(initial);
  const recovery = transferAuditFixture(initial, "invite");
  recovery.action = "retry";
  const repaired = await invoke(recovery);
  equal(repaired.response.status, 409, "Evidence repair does not automatically continue profile recovery");
  equal(object(repaired.body.error).code, "audit_repair_completed", "A new explicit action is required after evidence repair");
  equal(recovery.row.auth_user_id, TARGET_USER, "Repair keeps the accepted identity");
  assertNoRepairSideEffects(recovery, null);
});

Deno.test("actual adapter SQL-audit integration (simulated): partial evidence repair advances the marker and later completes only missing evidence", async () => {
  const simulation = new SqlAuditSimulation("repair");
  simulation.mode = "repair_chain_pending";
  const originalProfile = structuredClone(simulation.profile);
  const first = await invoke(simulation);
  equal(first.response.status, 409, "Incomplete repair is not success");
  equal(object(first.body.error).code, "audit_repair_failed", "Incomplete chain is explicitly recoverable");
  equal(simulation.row.pending_audit_event_type, "provisioning_completed", "Marker advances to only the missing event");
  const profileEvidence = structuredClone(simulatedEvent(simulation, "profile_created"));
  simulation.mode = "normal";
  simulation.actorId = OTHER_ADMIN;
  const second = await invoke(simulation);
  equal(second.response.status, 200, "Later completion-only repair succeeds");
  equal(simulation.canonicalRows.size, 2, "No duplicate profile evidence");
  equal(simulatedEvent(simulation, "profile_created"), profileEvidence, "Previously recorded profile evidence is immutable");
  equal(simulatedEvent(simulation, "provisioning_completed").originating_actor_user_id, ADMIN, "Original origin survives the second repair");
  equal(simulatedEvent(simulation, "provisioning_completed").actor_user_id, OTHER_ADMIN, "Second repairing actor is separately recorded");
  assertNoRepairSideEffects(simulation, originalProfile);
});

for (const revokeKind of ["inactive", "other_venue"] as const) {
  Deno.test(`actual adapter SQL-audit integration (simulated): ${revokeKind} Admin cannot begin audit repair after a wait`, async () => {
    const simulation = new SqlAuditSimulation("repair");
    simulation.revokeAtAuthorization = 3;
    simulation.revokeKind = revokeKind;
    const originalProfile = structuredClone(simulation.profile);
    const pending = structuredClone(simulation.row);
    const { response, body } = await invoke(simulation);
    equal(response.status, 403, "Changed Admin authority blocks privileged repair");
    equal(object(body.error).code, "forbidden", "Authorization classification");
    equal(simulation.requests, GET_ORDERS.repair.slice(0, -1), "Revocation is noticed before the repair RPC");
    equal(simulation.canonicalRows.size, 0, "No audit write is fabricated after revocation");
    equal(simulation.row, pending, "Pending invitation evidence is unchanged");
    assertNoRepairSideEffects(simulation, originalProfile);
  });
}

Deno.test("actual adapter SQL-audit integration (simulated): guarded SQL denial preserves the pending marker without fallback writes", async () => {
  const simulation = new SqlAuditSimulation("repair");
  simulation.mode = "repair_forbidden";
  const pending = structuredClone(simulation.row);
  const originalProfile = structuredClone(simulation.profile);
  const { response, body } = await invoke(simulation);
  equal(response.status, 403, "SQL's current authorization decision is authoritative");
  equal(object(body.error).code, "forbidden", "SQL denial classification");
  equal(simulation.row, pending, "Denied transaction leaves pending state untouched");
  equal(simulation.canonicalRows.size, 0, "No replacement audit write follows denial");
  assertNoRepairSideEffects(simulation, originalProfile);
});

// Step 3F: a detached, contradictory claim reply must be rejected before core
// performs reads or attempts its legacy mutation. The real reviewed SQL lease
// constraint would reject that PATCH; this fixture does not invent a commit.
class ContradictoryClaimSimulation extends Simulation {
  readonly legacyPatches: Record<string, unknown>[] = [];
  constructor(rewrite: Rewrite = reply => ({ ...reply, record:{ ...record(reply), send_state:"unknown" } })) {
    super("invite", RPC.claim, rewrite);
  }
  override async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === API && request.method === "PATCH" && url.pathname === "/rest/v1/staff_invitations") {
      equal(url.searchParams.get("id"), `eq.${this.row.id}`, "Legacy patch targets this fictional invitation");
      equal(url.searchParams.get("operation_token"), `eq.${this.row.operation_token}`, "Legacy patch carries its fence");
      this.requests.push("REJECTED-legacy-invitation-patch");
      this.mutationAttempts += 1;
      this.legacyPatches.push(object(await request.json()));
      return Response.json({ code:"23514", message:"Fictional lease constraint rejection", details:null, hint:null }, { status:400 });
    }
    return await super.fetch(request);
  }
}

Deno.test("actual adapter Step3F: contradictory claimed unknown outcome stops at the reply boundary", async () => {
  const simulation = new ContradictoryClaimSimulation();
  const { response, body } = await invoke(simulation);
  const committed = simulation.commits.get(RPC.claim);
  assert(committed, "The preceding claim was already simulated as committed");
  if (simulation.legacyPatches.length) {
    // Bounded fictional reproduction evidence, never a raw reply or identity.
    console.info(JSON.stringify({
      reproduction:"step3f-contradictory-claim", status:response.status,
      errorCode:object(body.error).code, requests:simulation.requests,
      providerCalls:simulation.providerCalls, legacyUpdateAttempts:simulation.legacyPatches.length,
      directAuditRequests:simulation.auditInsertAttempts,
      simulatedClaimPreserved:JSON.stringify(simulation.row) === JSON.stringify(committed.row),
      patchClearsProcessingWithoutLease:simulation.legacyPatches[0]?.processing_started_at === null
        && !Object.hasOwn(simulation.legacyPatches[0], "lease_expires_at")
    }));
  }
  equal(simulation.requests, INVITE_ORDER.slice(0, 5), "No action may follow the contradictory claim reply");
  equal(response.status, 500, "Invalid database contract is controlled");
  equal(object(body.error).code, "invalid_database_contract", "Reject at the response boundary, not after a legacy write");
  equal(simulation.providerCalls, 0, "No invitation dispatch");
  equal(simulation.legacyPatches.length, 0, "No compensating legacy update");
  equal(simulation.row, committed.row, "Do not assume the preceding RPC rolled back");
  equal(simulation.auditEvents, committed.auditEvents, "Existing simulated audit evidence is untouched");
  equal(simulation.profile, committed.profile, "No profile work follows rejection");
  assert(!JSON.stringify(body).includes(RAW_MARKER), "Do not expose raw database replies");
  assertIsolation(simulation);
});

const STEP3F_INVALID_CLAIMS: { name:string; action:InvitationAction; rewrite:Rewrite }[] = [
  { name:"matching claimed replay with unknown send", action:"invite", rewrite:reply => ({
    ...reply, decision_code:"operation_replay", record:{ ...record(reply), send_state:"unknown" }
  }) },
  { name:"matching provider-accepted replay with unknown send and missing identity", action:"invite", rewrite:reply => ({
    ...reply, decision_code:"operation_replay", record:{ ...record(reply), operation_state:"provider_accepted",
      send_state:"unknown", dispatch_authorized_at:TIME, dispatch_started_at:TIME, last_provider_attempt_at:TIME }
  }) },
  { name:"ordinary retry claiming unknown outcome", action:"retry", rewrite:reply => ({
    ...reply, requires_provider_dispatch:true, record:{ ...record(reply), send_state:"unknown" }
  }) },
  { name:"provider-accepted replay with empty identity", action:"invite", rewrite:reply => ({
    ...reply, decision_code:"operation_replay", record:{ ...record(reply), operation_state:"provider_accepted",
      status:"profile_pending", send_state:"provider_accepted", auth_user_id:"", expected_auth_user_id:"",
      last_sent_at:TIME, dispatch_authorized_at:TIME, dispatch_started_at:TIME, last_provider_attempt_at:TIME,
      processing_started_at:null, lease_expires_at:null }
  }) },
  { name:"accepted-profile retry with empty identity", action:"retry", rewrite:reply => ({
    ...reply, requires_provider_dispatch:false, record:{ ...record(reply), send_state:"unknown",
      auth_user_id:"", expected_auth_user_id:"", accepted_at:TIME, last_sent_at:TIME,
      profile_state:"failed", failure_code:"accepted_profile_missing" }
  }) },
  { name:"fresh claim carrying an unresolved audit marker", action:"invite", rewrite:reply => ({
    ...reply, record:{ ...record(reply), send_state:"unknown", pending_audit_event_type:"reconciliation_required",
      pending_audit_classification:"provider_outcome_unknown", pending_audit_originating_actor_user_id:ADMIN,
      pending_audit_originating_request_id:record(reply).operation_request_id,
      pending_audit_operation_token:record(reply).operation_token, pending_audit_details:{} }
  }) }
];
for (const item of STEP3F_INVALID_CLAIMS) {
  Deno.test(`actual adapter Step3F: rejects ${item.name} before lookup or mutation`, async () => {
    const simulation = new ContradictoryClaimSimulation(item.rewrite);
    simulation.action = item.action;
    const { response, body } = await invoke(simulation);
    const order = ["authenticate", "authorize", item.action === "invite" ? RPC.reserve : "read", "authorize", RPC.claim];
    equal(simulation.requests, order, "Contradictory actionable reply cannot authorize subsequent work");
    equal(response.status, 500, "Controlled contract error");
    equal(object(body.error).code, "invalid_database_contract", "Invalid reply classification");
    const committed = simulation.commits.get(RPC.claim);
    assert(committed, "Previous RPC may already have committed");
    equal(simulation.row, committed.row, "No compensation or snapshot restoration");
    equal(simulation.auditEvents, committed.auditEvents, "Keep existing evidence");
    equal(simulation.providerCalls, 0, "No provider call");
    equal(simulation.profileWrites, 0, "No profile creation");
    assertIsolation(simulation);
  });
}

function step3fClaimSample(action: InvitationAction, changes: Partial<InvitationRecord> = {}, dispatch = true, replay = false) {
  const row: InvitationRecord = {
    ...invitation(), status:"processing", operation_state:"claimed", operation_action:action,
    operation_token:PRIOR_OPERATION, operation_actor_user_id:ADMIN, operation_request_id:PRIOR_REQUEST,
    operation_started_at:TIME, processing_started_at:TIME, lease_expires_at:LEASE_END,
    operation_fence:1, attempt_count:1, last_attempt_at:TIME, ...changes
  };
  const expected: Expectation = { ...BASIC_EXPECTATION, invitationId:INVITATION, operationToken:PRIOR_OPERATION, action };
  return { row, expected, reply:{ decision_code:replay ? "operation_replay" : "claimed", record:row,
    retry_after_seconds:0, requires_provider_dispatch:dispatch } };
}

const STEP3F_VALID_CLAIMS: { name:string; action:InvitationAction; changes:Partial<InvitationRecord>; dispatch:boolean }[] = [
  { name:"new invite without Auth identity", action:"invite", changes:{}, dispatch:true },
  { name:"retry before any provider attempt", action:"retry", changes:{}, dispatch:true },
  { name:"retry after verified provider failure", action:"retry", changes:{ send_state:"failed" }, dispatch:true },
  { name:"profile-only retry after provider acceptance", action:"retry", changes:{
    send_state:"provider_accepted", auth_user_id:TARGET_USER, expected_auth_user_id:TARGET_USER, last_sent_at:TIME
  }, dispatch:false },
  { name:"resend of an existing completed profile", action:"resend", changes:{
    send_state:"provider_accepted", auth_user_id:TARGET_USER, expected_auth_user_id:TARGET_USER,
    last_sent_at:TIME, profile_state:"existing"
  }, dispatch:true }
];
for (const send of ["unknown", "not_attempted", "failed", "provider_accepted"] as const) {
  for (const failure of ["accepted_profile_missing", "profile_write_failed"]) {
    STEP3F_VALID_CLAIMS.push({ name:`accepted-profile recovery preserving ${send}/${failure}`, action:"retry", changes:{
      send_state:send, auth_user_id:TARGET_USER, expected_auth_user_id:TARGET_USER,
      last_sent_at:TIME, accepted_at:TIME, profile_state:"failed", failure_code:failure
    }, dispatch:false });
  }
}
for (const sample of STEP3F_VALID_CLAIMS) {
  for (const replay of [false, true]) {
    Deno.test(`pure validator Step3F: ${replay ? "resumable replay" : "fresh claim"} permits ${sample.name}`, () => {
      const fixture = step3fClaimSample(sample.action, sample.changes, sample.dispatch, replay);
      const parsed = parseRpcReply(RPC.claim, fixture.reply, fixture.expected);
      assert(parsed !== null, "Reviewed SQL's valid neighboring eligibility branch remains supported");
      equal(parsed.record, fixture.row, "Do not normalize or silently repair valid state");
      equal(parsed.requires_provider_dispatch, sample.dispatch, "Preserve profile-only versus dispatch decision");
    });
  }
}

const STEP3F_BAD_CLAIM_RELATIONSHIPS: { name:string; action:InvitationAction; changes:Partial<InvitationRecord>; dispatch:boolean }[] = [
  { name:"ordinary unknown outcome", action:"retry", changes:{ send_state:"unknown" }, dispatch:true },
  { name:"invite after a failed send", action:"invite", changes:{ send_state:"failed" }, dispatch:true },
  { name:"accepted recovery requesting dispatch", action:"retry", changes:{
    auth_user_id:TARGET_USER, expected_auth_user_id:TARGET_USER, last_sent_at:TIME, accepted_at:TIME,
    profile_state:"failed", failure_code:"accepted_profile_missing"
  }, dispatch:true },
  { name:"accepted recovery without original send evidence", action:"retry", changes:{
    auth_user_id:TARGET_USER, expected_auth_user_id:TARGET_USER, accepted_at:TIME,
    profile_state:"failed", failure_code:"accepted_profile_missing"
  }, dispatch:false },
  { name:"accepted recovery with an unrelated failure", action:"retry", changes:{
    auth_user_id:TARGET_USER, expected_auth_user_id:TARGET_USER, last_sent_at:TIME, accepted_at:TIME,
    profile_state:"failed", failure_code:"existing_account_other_venue"
  }, dispatch:false },
  { name:"resend before a ready profile", action:"resend", changes:{
    auth_user_id:TARGET_USER, expected_auth_user_id:TARGET_USER, last_sent_at:TIME, send_state:"provider_accepted"
  }, dispatch:true },
  { name:"claimed operation with retained dispatch timestamps", action:"invite", changes:{
    dispatch_authorized_at:TIME, dispatch_started_at:TIME, last_provider_attempt_at:TIME
  }, dispatch:true },
  { name:"claimed operation already completed", action:"invite", changes:{ operation_completed_at:TIME }, dispatch:true },
  { name:"profile-only retry mislabeled as a dispatch", action:"retry", changes:{
    auth_user_id:TARGET_USER, expected_auth_user_id:TARGET_USER, last_sent_at:TIME, send_state:"provider_accepted"
  }, dispatch:true }
];
for (const sample of STEP3F_BAD_CLAIM_RELATIONSHIPS) {
  for (const replay of [false, true]) {
    Deno.test(`pure validator Step3F: ${replay ? "resumable replay" : "fresh claim"} rejects ${sample.name}`, () => {
      const fixture = step3fClaimSample(sample.action, sample.changes, sample.dispatch, replay);
      equal(parseRpcReply(RPC.claim, fixture.reply, fixture.expected), null, "Incompatible action/attempt evidence must not become authority");
    });
  }
}

for (const field of ["auth_user_id", "expected_auth_user_id"] as const) {
  for (const value of ["", " \t "]) {
    Deno.test(`pure validator Step3F: ${field} rejects ${value === "" ? "empty" : "whitespace"} identity representation`, () => {
      equal(isInvitationRecord({ ...invitation(), [field]:value }), false, "UUID identity is null or a nonblank value, not a false missing-ID representation");
    });
  }
}

Deno.test("pure validator Step3F: progressed provider replay keeps pending audit and historical dispatch flag", () => {
  const fixture = step3fClaimSample("invite", {
    ...seed("repair"), status:"profile_pending", operation_state:"provider_accepted", operation_completed_at:null,
    profile_state:"pending", pending_audit_event_type:"provider_accepted", pending_audit_classification:"provider_accepted"
  }, true, true);
  assert(parseRpcReply(RPC.claim, fixture.reply, fixture.expected) !== null, "Provider acceptance can await audit work; replay's historical flag does not mean redispatch");
});

Deno.test("pure validator Step3F: historical replay dispatch flag does not constrain a newer owner's claim", () => {
  const fixture = step3fClaimSample("retry", {
    send_state:"provider_accepted", auth_user_id:TARGET_USER, expected_auth_user_id:TARGET_USER, last_sent_at:TIME,
    operation_token:"50000000-0000-4000-8000-000000000002", operation_actor_user_id:OTHER_ADMIN,
    operation_request_id:"60000000-0000-4000-8000-000000000002"
  }, true, true);
  fixture.expected.action = "invite";
  assert(parseRpcReply(RPC.claim, fixture.reply, fixture.expected) !== null, "SQL returns current row with old attempt metadata; core must decide operation loss");
});

Deno.test("actual adapter Step3F: newer-owner replay remains operation_lost without follow-up work", async () => {
  const simulation = new ContradictoryClaimSimulation(reply => ({ ...reply, decision_code:"operation_replay", record:{
    ...record(reply), operation_action:"retry", send_state:"provider_accepted", auth_user_id:TARGET_USER,
    expected_auth_user_id:TARGET_USER, last_sent_at:TIME, operation_actor_user_id:OTHER_ADMIN,
    operation_token:"50000000-0000-4000-8000-000000000002", operation_request_id:PRIOR_REQUEST
  } }));
  const { response, body } = await invoke(simulation);
  equal(response.status, 409, "Legitimate ownership loss is not reclassified as a malformed reply");
  equal(object(body.error).code, "operation_lost", "Existing ownership decision is preserved");
  equal(simulation.requests, INVITE_ORDER.slice(0, 5), "Old worker stops at the replay");
  equal(simulation.providerCalls, 0, "No send by old worker");
  assertIsolation(simulation);
});

for (const send of ["not_attempted", "unknown"] as const) {
  Deno.test(`actual adapter Step3F: GET recovery retains valid ${send} send state and missing Auth identity`, async () => {
    const simulation = new Simulation("recover");
    simulation.row.send_state = send;
    const { response, body } = await invoke(simulation);
    equal(response.status, 200, "Legitimate uncertain recovery remains available");
    equal(body.ok, true, "Valid recovery result");
    equal(simulation.requests, GET_ORDERS.recover, "Only existing authorized recovery requests");
    equal(simulation.row.send_state, send, "Recovery does not invent a provider outcome");
    equal(simulation.row.auth_user_id, null, "Unknown identity stays unknown");
    equal(simulation.row.operation_state, "provider_unknown", "Uncertainty remains explicit");
    equal(simulation.providerCalls, 0, "No recovery email");
    assertIsolation(simulation);
  });
}

for (const path of ["recover", "reconcile"] as const) {
  Deno.test(`actual adapter Step3F: contradictory ${path} list reply stops before observation or recovery`, async () => {
    const simulation = new Simulation(path);
    if (path === "recover") Object.assign(simulation.row, { operation_state:"provider_accepted", send_state:"unknown" });
    else Object.assign(simulation.row, { auth_user_id:"", expected_auth_user_id:"" });
    const before = structuredClone(simulation.row);
    const { response, body } = await invoke(simulation);
    equal(response.status, 500, "Invalid row is rejected at the list boundary");
    equal(object(body.error).code, "invalid_database_contract", "Controlled invalid-contract classification");
    equal(simulation.requests, ["authenticate", "authorize", "list"], "No Auth observation or mutation after contradictory read");
    equal(simulation.row, before, "Reject, do not repair the supplied state");
    equal(simulation.providerCalls, 0, "No dispatch");
    assertIsolation(simulation);
  });
}

Deno.test("actual adapter Step3F: disabled provisioning still stops after its two read-only checks", async () => {
  const simulation = new ContradictoryClaimSimulation();
  const { response, body } = await invoke(simulation, false);
  equal(response.status, 503, "Disabled provisioning");
  equal(object(body.error).code, "provisioning_disabled", "Existing gate classification");
  equal(simulation.requests, ["authenticate", "authorize"], "Do not claim zero total service requests");
  equal(simulation.providerCalls, 0, "Disabled means no dispatch");
  assertIsolation(simulation);
});

for (const change of ["inactive", "other_venue"] as const) {
  Deno.test(`actual adapter Step3F: ${change} Admin is blocked before the claim`, async () => {
    const simulation = new class extends ContradictoryClaimSimulation {
      reads = 0;
      override async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.origin === API && request.method === "GET" && url.pathname === "/rest/v1/staff_profiles" && ++this.reads === 2) {
          this.requests.push("authorize");
          return Response.json([{ id:ADMIN, role:"admin", active:change !== "inactive", venue_id:change === "other_venue" ? OTHER_VENUE : VENUE }]);
        }
        return await super.fetch(request);
      }
    }();
    const { response, body } = await invoke(simulation);
    equal(response.status, 403, "Current authorization still precedes the claim");
    equal(object(body.error).code, "forbidden", "Authorization classification");
    equal(simulation.requests, INVITE_ORDER.slice(0, 4), "Reservation happened, but claim and later work did not");
    equal(simulation.providerCalls, 0, "No unauthorized dispatch");
    assertIsolation(simulation);
  });
}

Deno.test("actual adapter Step3F: accepted-profile recovery with unknown send still creates only the missing profile", async () => {
  const simulation = new class extends Simulation {
    constructor() { super("invite"); }
    override rpc(name: Rpc, args: Record<string, unknown>): unknown {
      // The earlier display read had provider acceptance. Current claim-time
      // state may differ after a wait; SQL's accepted-recovery branch permits
      // this unknown send state and does not dispatch from it.
      if (name === RPC.claim) this.row.send_state = "unknown";
      const reply = super.rpc(name, args);
      if (name !== RPC.finalize) return reply;
      // SQL finalization preserves an already verified acceptance timestamp.
      this.row.status = "accepted";
      this.commit(name);
      return { decision_code:"created", record:structuredClone(this.row), profile:structuredClone(this.profile) };
    }
    override async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === API && request.method === "GET" && url.pathname === `/auth/v1/admin/users/${TARGET_USER}`) {
        this.requests.push("observe-auth");
        return Response.json({ user:{ id:TARGET_USER, email:EMAIL, email_confirmed_at:TIME, invited_at:TIME,
          aud:"authenticated", created_at:TIME, user_metadata:{}, app_metadata:{} } });
      }
      return await super.fetch(request);
    }
  }();
  simulation.action = "retry";
  simulation.row = { ...seed("reconcile"), status:"profile_pending", profile_state:"failed",
    accepted_at:TIME, failure_code:"accepted_profile_missing", expected_auth_user_id:TARGET_USER };
  simulation.profile = null;
  const { response, body } = await invoke(simulation);
  equal(response.status, 200, "Valid accepted-profile recovery is not blocked by unknown send state");
  equal(body.ok, true, "Verified profile completion remains successful");
  equal(simulation.requests, ["authenticate", "authorize", "read", "authorize", RPC.claim, "authorize", "observe-auth", "authorize", RPC.finalize],
    "No dispatch or legacy profile write is added to accepted recovery");
  equal(simulation.providerCalls, 0, "Never resend to recover a profile");
  equal(simulation.profileWrites, 1, "Only the missing fictional profile is created through the finalizer");
  equal(simulation.row.accepted_at, TIME, "Original acceptance evidence remains");
  equal(simulation.row.send_state, "unknown", "Profile completion does not invent a provider result");
  equal(simulation.profile, profile(), "Known Auth identity, venue, role and active state are used");
  assertIsolation(simulation);
});

Deno.test("actual adapter Step3F: valid same-operation claimed replay retains the normal invitation path", async () => {
  const simulation = new ContradictoryClaimSimulation(reply => ({ ...reply, decision_code:"operation_replay" }));
  const { response, body } = await invoke(simulation);
  equal(response.status, 201, "A valid resumable claim still works");
  equal(body.ok, true, "Normal invitation completion");
  equal(simulation.requests, INVITE_ORDER, "Original guarded path remains unchanged");
  equal(simulation.providerCalls, 1, "Exactly one fictional send");
  equal(simulation.profileWrites, 1, "Exactly one guarded fictional profile creation");
  assertIsolation(simulation);
});

malformed("actual adapter Step3F: invalid reply after provider outcome commit does not cause another send or fallback", "invite", RPC.outcome,
  reply => ({ ...reply, record:{ ...record(reply), send_state:"unknown", failure_message:RAW_MARKER } }), 1);

Deno.test("actual adapter Step3F: request repeated after invalid claim preserves a concurrently committed unresolved dispatch", async () => {
  const simulation = new class extends ContradictoryClaimSimulation {
    override rpc(name: Rpc, args: Record<string, unknown>): unknown {
      if (name !== RPC.claim) return super.rpc(name, args);
      equal(args.p_actor_user_id, ADMIN, "Current actor passed to claim");
      equal(args.p_invitation_id, this.row.id, "Claim identity");
      // Explicitly simulate another operation committing while this claim
      // waits. This state is never restored to the earlier display snapshot.
      Object.assign(this.row, seed("recover"), {
        status:"reconciliation_required", send_state:"unknown", operation_state:"provider_unknown",
        processing_started_at:null, lease_expires_at:null, failure_code:"provider_outcome_unknown"
      });
      this.commit(name);
      // The durable fictional row is an earlier unresolved dispatch. The
      // corrupt reply falsely claims new work; it does not change that row.
      return { decision_code:"claimed", requires_provider_dispatch:true, retry_after_seconds:0, record:{
        ...this.row, status:"processing", operation_state:"claimed", operation_action:"retry",
        operation_token:stringField(args, "p_operation_token"), operation_request_id:stringField(args, "p_request_id"),
        operation_actor_user_id:ADMIN, processing_started_at:TIME, lease_expires_at:LEASE_END,
        dispatch_authorized_at:null, dispatch_started_at:null, expected_auth_user_id:null, failure_message:RAW_MARKER
      } };
    }
  }();
  simulation.action = "retry";
  const first = await invoke(simulation);
  equal(first.response.status, 500, "Malformed claim reply rejects before later work");
  equal(object(first.body.error).code, "invalid_database_contract", "Do not turn rejection into retry authority");
  const durable = structuredClone(simulation.row);
  const second = await invoke(simulation);
  equal(second.response.status, 409, "A fresh read now sees the preserved uncertainty and blocks retry");
  equal(object(second.body.error).code, "retry_not_available", "Existing pre-claim safe denial remains unchanged");
  for (const { body } of [first, second]) {
    assert(!JSON.stringify(body).includes(RAW_MARKER) && !simulation.safeLogs.join(" ").includes(RAW_MARKER), "No raw reply leakage");
  }
  equal(simulation.row, durable, "Existing dispatch timestamps, identity and uncertainty are not cleared");
  const once = ["authenticate", "authorize", "read", "authorize", RPC.claim];
  equal(simulation.requests, [...once, "authenticate", "authorize", "read"], "No subsequent lookup, dispatch, repair or direct update");
  equal(simulation.providerCalls, 0, "Existing unknown outcome never grants redispatch");
  equal(simulation.profileWrites, 0, "No profile action");
  assertIsolation(simulation);
});

Deno.test("actual adapter Step3F: repeated contradictory list replies preserve committed profile and pending audit evidence", async () => {
  const simulation = new class extends Simulation {
    constructor() { super("repair"); }
    override async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === API && request.method === "GET" && url.pathname === "/rest/v1/staff_invitations") {
        equal(url.searchParams.get("venue_id"), `eq.${VENUE}`, "List remains venue-scoped");
        this.requests.push("list");
        return Response.json([{ ...this.row, operation_state:"provider_accepted", send_state:"unknown", failure_message:RAW_MARKER }]);
      }
      return await super.fetch(request);
    }
  }();
  const before = structuredClone(simulation.row);
  const committedProfile = structuredClone(simulation.profile);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { response, body } = await invoke(simulation);
    equal(response.status, 500, "Malformed list reply is not an authorized repair input");
    equal(object(body.error).code, "invalid_database_contract", "Controlled boundary rejection");
    equal(simulation.row, before, "Exact six-field pending marker remains untouched");
    equal(simulation.profile, committedProfile, "Committed profile remains untouched");
    assert(!JSON.stringify(body).includes(RAW_MARKER) && !simulation.safeLogs.join(" ").includes(RAW_MARKER), "No raw reply reflection");
  }
  equal(simulation.requests, ["authenticate", "authorize", "list", "authenticate", "authorize", "list"], "Neither request starts repair or another mutation");
  equal(simulation.providerCalls, 0, "Audit uncertainty is not permission to send");
  equal(simulation.profileWrites, 0, "Existing profile is not recreated");
  assertIsolation(simulation);
});
