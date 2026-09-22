import { StaffInvitationError } from "./core.ts";

// The production adapter always supplies the guarded reservation, claim,
// outcome, finalization, reconciliation and repair RPCs. Those operations own
// required audit insertion and canonical provenance in the reviewed SQL.
//
// Keep the generic core's required append dependency explicitly rejecting in
// this adapter: legacy injected dependencies have a different audit contract. This
// is not an optional/no-op audit writer and must never report successful work.
// No payload is inspected, repaired, logged or sent to a direct table route.
export async function rejectDirectAuditWrite(): Promise<never> {
  throw new StaffInvitationError(
    "invalid_database_contract",
    "Required invitation audit evidence must be recorded by the guarded database operation.",
    500
  );
}
