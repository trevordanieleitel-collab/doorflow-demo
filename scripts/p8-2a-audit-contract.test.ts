// Tests the actual production adapter's retired direct-write capability.
// These are guard tests, NOT PostgreSQL or canonical audit-writer tests.
import { rejectDirectAuditWrite } from "../supabase/functions/staff-invitations/audit.ts";
import { StaffInvitationError } from "../supabase/functions/staff-invitations/core.ts";
import type { AuditEntry, StaffInvitationDependencies } from "../supabase/functions/staff-invitations/core.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const append: StaffInvitationDependencies["appendAudit"] = rejectDirectAuditWrite;
const original: AuditEntry = {
  invitation_id:"30000000-0000-4000-8000-000000000001",
  actor_user_id:"10000000-0000-4000-8000-000000000001",
  venue_id:"20000000-0000-4000-8000-000000000001",
  event_type:"reserved", classification:"new",
  request_id:"60000000-0000-4000-8000-000000000001", details:{}
};
const cases: { name: string; entry: AuditEntry }[] = [
  { name:"legacy initial event with missing table attribution", entry:original },
  { name:"legacy repair ID is not silently reinterpreted", entry:{ ...original, id:original.invitation_id, event_type:"accepted_reconciled", classification:"verified_auth" } },
  { name:"later actor cannot fabricate original attribution", entry:{ ...original, actor_user_id:"10000000-0000-4000-8000-000000000002", event_type:"invitation_resent" } },
  { name:"cross-venue payload cannot open a direct route", entry:{ ...original, venue_id:"20000000-0000-4000-8000-000000000002" } },
  { name:"contradictory payload is never logged", entry:{ ...original, actor_user_id:"", details:{ arbitrary:"FICTIONAL_RAW_MARKER" } } },
  { name:"payload getters are never evaluated", entry:{ ...original, get details(): unknown { throw new Error("FICTIONAL_RAW_MARKER"); } } }
];

for (const item of cases) {
  Deno.test(`production audit guard: ${item.name}`, async () => {
    const savedFetch = globalThis.fetch;
    const savedLog = console.error;
    let requests = 0;
    const logs: unknown[][] = [];
    globalThis.fetch = () => { requests += 1; throw new Error("No transport is permitted for a retired direct writer"); };
    console.error = (...values: unknown[]) => { logs.push(values); };
    try {
      // A repeated attempt must reject too, never succeed as an empty repair.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let failure: unknown;
        try { await append(item.entry); } catch (error) { failure = error; }
        assert(failure instanceof StaffInvitationError, "Required audit work must fail explicitly, not become a no-op");
        assert(failure.code === "invalid_database_contract" && failure.status === 500, "Use the controlled contract error");
        assert(!failure.message.includes("FICTIONAL_RAW_MARKER"), "Never reflect payloads");
        assert(failure.invitation === null, "Use the existing error contract's explicit no-invitation value");
      }
      assert(requests === 0, "No direct table, provider or other transport request");
      assert(logs.length === 0, "No payload or credential logging");
    } finally {
      globalThis.fetch = savedFetch;
      console.error = savedLog;
    }
  });
}

Deno.test("production audit guard: even a fully attributed object cannot bypass guarded SQL", async () => {
  const attributed = {
    ...original, id:"c262fc3d-8518-432f-8f20-543b49b1680d",
    originating_actor_user_id:original.actor_user_id,
    recorded_request_id:original.request_id, operation_token:null, repair_operation_token:null
  };
  let failure: unknown;
  try { await append(attributed); } catch (error) { failure = error; }
  assert(failure instanceof StaffInvitationError && failure.code === "invalid_database_contract", "Complete fields do not grant a direct privileged write capability");
});

Deno.test("production audit guard: permissions remain explicitly denied", async () => {
  for (const name of ["net", "run", "ffi", "write", "sys", "import"] as const) {
    assert((await Deno.permissions.query({ name })).state === "denied", `${name} must remain denied`);
  }
});
