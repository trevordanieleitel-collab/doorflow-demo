# DoorFlow Phase 8.2A.1 Staff Invitations: Deployment and Recovery

## Status and non-production boundary

Phase 8.2A is local, uncommitted work. The SQL in
`supabase/review/phase_8_2a_staff_invitations_review.sql` is deliberately
outside the migration directory and is **review-only for deployment, not
applied to any hosted project**. Verification has applied it only to isolated,
disposable local PostgreSQL fixtures. No hosted Supabase connection, real Auth
account operation, invitation/email, SMTP/DNS/Auth-setting change, function
deployment, or application-secret change has occurred.

Do not describe local mocks as deployed evidence. Continue to offer the manual
staff-provisioning procedure until an isolated staging project has passed every
applicable check below and production activation has separate approval.

### Phase 8.2A.2 Step 5A — corrected local checkpoint

**READY FOR LOCAL CHECKPOINT WITH DOCUMENTED UPSTREAM EXCEPTION.**
**Raw Deno type-check remains FAILED on the two known library errors.**
This is not approval to deploy, commit, or enable invitations. Provisioning
remains disabled by default. Evidence, pre-edit originals, reproductions,
failed intermediate runs and final runs are in the local lab's
`step5a-checkpoint-corrections` folder.

The three Step 5 blocker categories are corrected locally:

- Invitation requests now own a session/context generation. Sign-out,
  same-account re-login, observed venue/permission changes and newer list
  requests invalidate obsolete results, errors and cleanup writes. The
  invitation endpoint rechecks ownership after awaiting the current session,
  before dispatch; invitation-initiated profile refreshes are guarded too.
  Ordinary same-account token refresh preserves ownership. Session expiry
  without an auth callback clears the visible old screen. These are browser
  ownership protections, not a claim that an already-sent server request was
  canceled or rolled back. No automatic resend occurs on a context change.
- The existing exact lookup accepts only a successful complete table reply:
  the actual HTTP response, SDK envelope, exact count/range and returned
  identity/email/nullable timestamp columns must agree. Empty array plus
  verified zero count is absence; null, false, missing/invalid rows, ambiguous
  or partial replies and failed/undecodable responses are not. The supported
  `count: "exact"` RPC option supplies completeness evidence without changing
  SQL. The pinned SDK's 404-array-to-empty-success conversion is detected at
  the raw HTTP boundary. Required nullable columns are preserved, and harmless
  extra fields do not invalidate a valid match. No directory scan was added.
- Browser cleanup explicitly releases its own worker/page through the test
  session, awaits its observed browser exit, closes its server, checks both
  listeners, and removes only its temporary profile. Cleanup failures remain
  failures. The four smokes retain their original comparison baselines, exact
  inventories and protected bodies; only approved typed spellings, named
  files and exact invitation-only hooks are accounted for. Negative controls
  still reject missing guards, unrelated protected-code edits and extra files.

Malformed POST lookup stops before dispatch and leaves earlier reservation,
claim and audit commits intact. Mutation-capable GET recovery retains its
existing authorized conservative path: invalid lookup becomes an incomplete
observation; guarded recovery may record uncertainty, never authorize a send
or adopt an unverified account. A safe GET receipt is not proof of absence.

| Fresh Step 5A check | Result | Native exit |
| --- | --- | ---: |
| Original invitation tests | 187/187 | 0 |
| Actual adapter/validation tests | 579/579 (525 retained + 54 added) | 0 |
| Audit guards | 8/8 | 0 |
| Acceptance core | 20/20 | 0 |
| Context/browser regressions | 16/16; repeated in fresh browsers | 0 |
| Complete acceptance browser | 1/1; three fresh final-cleanup runs | 0 |
| Phase 8.2A / 8.1 / 8.1A / 8.1B smokes | 44/44, 76/76, 60/60, 79/79 | 0 |
| P6 race smoke | 39/39 | 0 |
| Genuine full Deno check, including changed TypeScript tests | FAILED: same two complete upstream fingerprints; source/test/unexpected diagnostics 0 | 1 |

No final suite is filtered or skipped. Runtime Deno tests use the disclosed
runtime-only `--no-check`; the separate genuine inspection retains `--all
--cached-only --frozen-lockfile --node-modules-dir=none`, without suppressions.
Compiler configuration, SDK 2.116.0, packages and frozen lock are unchanged.
All service replies are fictional intercepted transport. Browser tests use
fresh disposable profiles and loopback servers, never production sessions.

**Real PostgreSQL: prior Step 5 PASS retained; not rerun in Step 5A.**
Its 414 groups / 5,929 assertions / 10 real lock waits apply to the unchanged
review SQL and unchanged fixtures, not directly to the new UI/lookup fixes.
The review SQL remains unapplied to hosted systems. No database was started
or connected in this correction step.

Remaining staging prerequisites are unchanged: deployed schema/grant fidelity,
real PostgREST count/envelope behavior, Edge/runtime limits, pinned Auth resend
semantics, ownership markers, provider interruption/reconciliation behavior,
mail sandbox, actual hosting headers/configuration, and the owner decision on
global normalized-email reservation. No hosted compatibility, exactly-once
email delivery or production readiness is claimed.

### Historical Step 5 result — superseded locally by Step 5A above

The following records the original pre-correction result and remains as history.

**Phase 8.2A.2 local verification: NOT READY FOR CHECKPOINT.** This is a
verification result, not permission to commit, deploy, or enable provisioning.
Evidence is preserved in the local verification lab's
`step5-final-local-verification` folder. Step 5 changed only this guide in the
repository; production source and original test assertions were not repaired
to obtain passing results.

| Fresh check | Result | Native exit |
| --- | --- | ---: |
| Original Node invitation suite | 187/187 passed | 0 |
| Actual Deno adapter/validator suite | 525/525 passed | 0 |
| Deno audit-guard suite | 8/8 passed | 0 |
| Acceptance core | 20/20 passed | 0 |
| Isolated acceptance browser | FAILED: 0/1; functional assertions completed, then temporary-profile cleanup failed with Windows `EBUSY` | 1 |
| Phase 8.2A smoke | 40/43 checks passed | 1 |
| Phase 8.1 smoke | 74/75 checks passed | 1 |
| Phase 8.1A smoke | 58/59 checks passed | 1 |
| Phase 8.1B smoke | 77/78 checks passed | 1 |
| P6 race smoke | 39/39 checks passed | 0 |
| Real PostgreSQL 17.11 | 414 PASS groups, 2 evidence-only records, 5,929 assertions, 10 genuine lock waits | 0 |
| Raw full Deno 2.9.7 check | FAILED due to exactly 2 known upstream diagnostics | 1 |

No cases were skipped or filtered. Counts above distinguish test cases, smoke
checks, and PostgreSQL groups. The fresh PostgreSQL database installed the
actual current review SQL from scratch. Its unchanged Step 4D suite exercised
real locks, current authorization, venue boundaries, nullable venue rejection,
provider/accepted-state constraints, complete audit-marker consistency,
canonical repair, and actual browser-role denial. Its listener and original
process are gone and its control state is cleanly shut down. This is real
PostgreSQL evidence using synthetic fixtures, not deployed-schema fidelity or
a running Supabase stack.

DoorFlow type diagnostics are **0** in `core.ts`, **0** in `index.ts`, and
**0** in its helpers. The only diagnostics match the full previously reproduced
fingerprints: Deno `TS2724` at `asset:///node/stream/web.d.cts:59:49`
(`TransformerCancelCallback`), and Auth SDK `TS2430` at cached
`@supabase/auth-js` **2.116.0** `webauthn.dom.d.ts:501:18`
(`PublicKeyCredentialFuture` / JSON `largeBlob` `ArrayBuffer` versus string).
Unexpected diagnostics: **0**. The frozen lock, dependency versions, cache
package code, strictness and compiler settings were not changed. The full
check retained `--all --cached-only --frozen-lockfile --node-modules-dir=none`.
This passes only the documented upstream-exception comparison; it does not
make the raw type-check pass. Deno runtime suites used the disclosed
runtime-only `--no-check`, denied real network access and intercepted fetch
and listener registration before initialization.

The failed Phase 8 checks retain stale untyped source-spelling expectations
and omit four approved Step 3 helper/test files from their exact inventories.
They remain failures, not waived gates. Protected-function comparisons,
inline-runtime parity, manifest preservation, cache-v30 protections, relevant
syntax and JSON checks passed within their stated coverage. The browser
failure remains recorded despite later successful disposal of its temporary
profile; no production browser session was used.

Two material source-review findings also block the checkpoint. These are
static traces, not newly executed exploit reproductions:

- The exact Auth-email lookup adapter treats falsey malformed non-array
  replies as a complete empty result. For an initial invitation, this can
  permit a provider call without a trustworthy negative identity lookup;
  dispatch authorization does not independently repeat that lookup. Normal
  reviewed SQL returns an array; malformed replies must not be trusted as
  absence. A separately approved correction must validate that envelope and
  its rows before allowing dispatch.
- Invitation POST success/error handlers are not bound to the initiating
  session generation. A delayed prior Admin's receipt can repopulate the
  current Staff list after logout/login and display another venue's invitation
  name/email. The GET loader's generation guard does not protect those POST
  handlers. A separately approved correction must guard all delayed state
  writes and add deterministic session-transition regressions.

Provisioning remains **disabled by default in repository source**. Fictional
enablement existed only in disposable test children; no hosted setting was
read or changed. Production was untouched. Still required after local
corrections: separately approved staging verification of actual deployed
schema/grants, Edge/runtime behavior, real SDK/Auth integration, creation-marker
and pending-invitation resend semantics, mail-sandbox outcomes, and hosting
headers. The global normalized-email reservation policy remains an explicit
owner/product decision; local passing database tests do not settle it.

The SQL creates only:

- `public.staff_invitations`, the current invitation and operation snapshot;
- `public.staff_invitation_attempts`, durable fenced operation/dispatch state;
- `public.staff_invitation_audit`, append-only required evidence;
- service-role-only `SECURITY INVOKER` workflow RPCs; and
- one exact, read-only `auth.users` lookup implemented by a tightly scoped
  `SECURITY DEFINER` function in non-exposed
  `doorflow_invitation_private`, reached through a public
  `SECURITY INVOKER` wrapper.

It does not modify `auth.*`, any existing table, RLS policy, publication,
existing role value, staff account, or operational row.

## Fixed origins, redirect, and environment identity

Replace the worksheet token `PRODUCTION_ORIGIN` with the approved production
hostname before deployment. These are then the only production values:

- frontend origin: `https://PRODUCTION_ORIGIN`;
- invitation redirect: `https://PRODUCTION_ORIGIN/auth/`.

An origin is scheme plus host and optional non-default port only. Reject user
info, paths, queries, fragments, trailing slashes, wildcard hosts, opaque URLs,
and unsupported protocols. Production permits HTTPS only. A separate local
configuration may permit only explicitly listed HTTP loopback values, for
example `http://127.0.0.1:5173` and `http://localhost:5173`, with their exact
`/auth/` redirects. Development mode is fully local: its `SUPABASE_URL` must
also be an exact HTTP loopback origin. It cannot target a hosted Supabase
project. Hosted staging uses production-mode HTTPS origins with its own
non-production project ref and keys. Never mix a local allowlist with hosted
keys or URL.

The browser never supplies an actor ID, Admin flag, venue, origin, redirect,
operation token, expected Auth ID, or role override. The server derives actor
identity from the verified user token and venue/role/active state from current
database rows.

### Environment variables and key precedence

Application-defined configuration uses the `DOORFLOW_` prefix. Supabase
reserves `SUPABASE_` for platform-provided variables; custom secret names must
not use that prefix.

Application configuration (required before production enable except where a
condition is stated):

- `DOORFLOW_STAFF_PROVISIONING_ENABLED`
- `DOORFLOW_ENVIRONMENT` (`production` or `development`; any other value is a
  configuration error)
- `DOORFLOW_SUPABASE_PROJECT_REF` (required in every environment; use the
  reviewed local identifier for a loopback development stack)
- `DOORFLOW_SUPABASE_KEY_NAME` (the one exact member name selected from both
  hosted key dictionaries)
- `DOORFLOW_SUPABASE_PUBLISHABLE_KEY` and
  `DOORFLOW_SUPABASE_SECRET_KEY` only when an approved environment supplies
  explicit direct custom values rather than hosted dictionaries
- `DOORFLOW_SUPABASE_KEY_PROJECT_REF` when the direct custom key pair is used;
  it must exactly match `DOORFLOW_SUPABASE_PROJECT_REF`
- `DOORFLOW_ALLOW_LEGACY_SUPABASE_KEYS` only for a reviewed temporary legacy
  fallback
- `DOORFLOW_INVITE_REDIRECT_URL`
- `DOORFLOW_ALLOWED_ORIGINS`
- `DOORFLOW_INVITE_RESEND_COOLDOWN_SECONDS`
- `DOORFLOW_INVITE_LEASE_SECONDS`
- `DOORFLOW_INVITE_PROVIDER_TIMEOUT_MS`

Platform-provided variables may include:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` JSON dictionaries; and
- legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` only during an
  explicitly reviewed compatibility window.

Key selection is fail-closed:

1. Hosted dictionaries have first precedence and are an inseparable pair:
   both `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` must be present.
   Parse each with the strict flat string-dictionary parser and select the same
   exact `DOORFLOW_SUPABASE_KEY_NAME` from both. Reject a missing dictionary,
   duplicate decoded member name, unknown/blank selected member, nested value,
   non-string value, oversized entry, or oversized dictionary. Never select
   the first or only member automatically.
2. If neither hosted dictionary is present, the second choice is the paired
   `DOORFLOW_SUPABASE_PUBLISHABLE_KEY` and
   `DOORFLOW_SUPABASE_SECRET_KEY`. Both must be present, and
   `DOORFLOW_SUPABASE_KEY_PROJECT_REF` must exactly equal
   `DOORFLOW_SUPABASE_PROJECT_REF`. Opaque direct-key membership in that project
   still requires isolated staging validation; the name check is not proof.
3. Legacy `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` is last and is
   eligible only when `DOORFLOW_ALLOW_LEGACY_SUPABASE_KEYS=true`. It is never
   mixed with a dictionary or direct-key source. A partial pair at any
   precedence is a configuration error, not permission to fill the missing
   half from another source. Singular platform
   `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY` variables are unsupported.
   Before use, the legacy JWT pair is decoded only for bounded configuration
   consistency checks: `alg` must be `HS256`, roles must be exactly `anon` and
   `service_role`, both `ref` claims must equal
   `DOORFLOW_SUPABASE_PROJECT_REF`, and both expirations must be valid. This is
   not signature verification; the isolated staging API checks remain required.
4. In production mode, `SUPABASE_URL` must be exactly
   `https://<DOORFLOW_SUPABASE_PROJECT_REF>.supabase.co`, with no credentials,
   query, fragment, port, path other than `/`, wildcard, trailing dot, or
   hostname suffix. In development mode it must be an exact HTTP origin on
   `localhost`, `127.0.0.1`, or `[::1]`; HTTPS, hosted, remote, abbreviated, or
   suffix hosts are rejected. Reject any environment/project mismatch before
   client creation.
5. Never print a dictionary, selected key, URL credentials, or secret value.

`DOORFLOW_STAFF_PROVISIONING_ENABLED` is true only for the literal value
`true`. At request initialization, missing, blank, differently cased, or
malformed values prevent that newly initialized request from entering any
mutation path, including mutation-capable GET reconciliation and audit repair.
This environment check is not a durable database cancellation gate for a
request that was already admitted.
Cooldown must be a finite base-10 integer from 60 through 86,400 seconds. Lease
must be a finite base-10 integer from 30 through 600 seconds. The invite-provider
timeout must be a finite base-10 integer from 1,000 through 120,000 milliseconds
and remain strictly below the request-idle limit selected for staging. These
ranges are shared by Edge validation and the SQL claim contract. A longer lease
does not resolve dispatch uncertainty.

Supabase currently documents a 150-second request-idle timeout, maximum worker
durations of 150 seconds on Free and 400 seconds on paid plans, and a two-second
CPU budget per request. Validate against the target plan immediately before
staging; do not assume a worker survives to persist a network outcome. See
[Edge Function limits](https://supabase.com/docs/guides/functions/limits).

## Authentication, authorization, and CORS

Keep the committed function setting:

```toml
[functions.staff-invitations]
verify_jwt = true
```

Do not deploy with `--no-verify-jwt`. This platform gate is defense in depth,
not user authentication: Supabase documents that API-key compatibility can
allow a key through the platform check without authenticating a user. The
handler must still parse a Bearer user JWT, call the authentic Auth user
verification API, and authorize the resulting user against the current
`staff_profiles` row. See [API key limitations](https://supabase.com/docs/guides/getting-started/api-keys)
and [Edge Function authentication](https://supabase.com/docs/guides/functions/auth).

Every privileged database boundary independently requires the caller to remain
an active `admin` in the invitation venue:

- reservation;
- claim/action eligibility;
- dispatch authorization immediately before the external call;
- expired dispatch-ownership recovery into explicit uncertainty;
- profile creation/finalization;
- reconciliation; and
- audit repair.

Those RPCs hold the authorization row, not merely a snapshot of it. They lock
the current actor's `staff_profiles` row with `FOR SHARE`, then validate active
status, Admin role, and venue while that lock remains held through the
transaction. `FOR SHARE` is intentional: it conflicts with profile
`UPDATE`/`DELETE`; `FOR KEY SHARE` would not block every non-key authorization
change. Where a target profile can participate (dispatch, profile finalization,
or reconciliation), the function first takes a non-authoritative invitation
snapshot only to identify the possible target, locks all existing actor/target
profile rows in ascending UUID order, and then locks and re-reads the
invitation. Any identity drift rejects the operation. The workflow lock order
is therefore profile UUID order -> invitation -> attempt, with target
validation performed under the already-held profile lock. The sorted profile
order avoids reciprocal Admin/target deadlocks between two invitations.

After the invitation is authoritatively locked, the RPC compares the actor's
venue with the locked invitation before evaluating Auth-ID drift, version/CAS
state, or any decision that can return the invitation row. The earlier identity
peek exists only to establish lock order; it is never an authorization or
disclosure boundary. A cross-venue caller therefore receives only
`forbidden` with a null record, including when `auth_user_id` changes while the
caller is waiting for the profile lock.

A deactivation, demotion, venue move, or deletion that obtains its row lock
first is observed and blocks the RPC. If the RPC obtains `FOR SHARE` first, its
authorization boundary is already established and the conflicting account
change waits for that short transaction to end. No database transaction is
held across the provider network call.

Provider-outcome recording is the deliberate exception. It accepts only the
exact previously authorized operation token and records the late result without
reauthorizing the original actor. That narrow finalization grants no new send,
profile, retry, or role power. Revocation can stop new work but cannot retract
an email already handed to the provider; preserving its true result is required
even if the initiating Admin has since been deactivated, demoted, or moved.

CORS is independent of authorization. Match the request origin against exact
configured values; return the matched origin, never `*`; include `Vary: Origin`;
allow only `GET`, `POST`, and `OPTIONS`; and return `Cache-Control: no-store`.
Permit only the reviewed Supabase client/request headers. A successful
preflight proves neither identity nor permission. See [Supabase CORS guidance](https://supabase.com/docs/guides/functions/cors).

## Request contract

Read POST bodies from the stream and stop after 16,384 bytes actually received,
independent of `Content-Length`. Cancel further reading when the limit is
crossed. Reject a declared length over the limit early, but never trust a
missing or smaller declaration. Count UTF-8 bytes, not JavaScript characters.

Require `application/json`; reject malformed UTF-8/JSON, arrays, scalars, null,
unknown fields, and wrong field types. Do not coerce arrays or objects with
`String()`. Error bodies contain fixed local messages and bounded codes only;
they never echo submitted content or provider prose.

The browser API remains:

- `GET staff-invitations`: authorized venue list plus bounded acceptance
  reconciliation, expired dispatch recovery into explicit uncertainty, and
  exact pending-audit repair when enabled. It is mutation-capable.
- `POST action=invite`: `full_name`, `email`, `role`, `idempotency_key`.
- `POST action=retry`: `invitation_id`; may recover profile-only work or an
  eligible pre-dispatch/definitively failed send, never assume email is needed.
- `POST action=resend`: `invitation_id`; only an eligible pending invitation
  after the authoritative cooldown and verified same-invitation provider path.

## Database RPC contract

All public RPCs below are `SECURITY INVOKER`, use `search_path = ''`, have
PUBLIC/`anon`/`authenticated` EXECUTE revoked, and grant EXECUTE only to
`service_role`. They return one JSON object containing `decision_code` and,
when disclosure is permitted, the authoritative `record`. Claim additionally
returns `retry_after_seconds` and `requires_provider_dispatch`; profile
finalization returns `profile` and, for a conflict, `conflict_code`. Callers
must treat unknown decision codes as failure, never as authorization.

### Reservation

`doorflow_reserve_staff_invitation(actor, venue, email, normalized_email,
full_name, role, idempotency_key, fingerprint, request_id)` rechecks the current
Admin in the requested venue, inserts the reservation and
`invitation_reserved` audit atomically, and enforces:

- global `normalized_email` uniqueness, serializing cross-venue identity;
- `(invited_by_user_id, idempotency_key)` uniqueness;
- same-key/same-fingerprint replay; and
- same-key/different-fingerprint conflict without overwrite.

A cross-venue email collision returns `identity_unavailable` with no row or
owning-venue detail.

This is a permanent first-writer reservation, not proof that the reserving
Admin controls the email address. Provisioning must remain disabled until the
owner confirms that every venue Admin belongs to one trusted organizational
domain, or approves a separately reviewed, audited reclaim/transfer design.
Any future reclaim path must be limited to states that are provably
pre-dispatch or definitively rejected; it must never release an unresolved
`dispatch_authorized` or `provider_unknown` attempt.

### Claim and action decision

`doorflow_claim_staff_invitation(invitation_id, actor, action,
operation_token, cooldown_seconds, lease_seconds, request_id)` locks the row and
uses database time to decide current eligibility. In the same transaction it:

- rechecks active same-venue Admin authorization;
- rejects accepted/conflicting states and malformed pending-audit markers;
- blocks every unresolved `dispatch_authorized` or `provider_unknown` attempt,
  regardless of coordination-lease age;
- computes cooldown and `retry_after_seconds` from the current
  `last_provider_attempt_at`;
- abandons only a stale **pre-dispatch** claim;
- binds the attempt to invitation, normalized email, role, original actor,
  request, expected Auth ID, monotonically increasing fence, and globally
  unique operation token; and
- writes `attempt_started` evidence transactionally. If that audit cannot be
  written, the claim rolls back.

UI `can_retry`/`can_resend` flags are display hints only. The RPC is the action
authority.

The successful claim code is `claimed`. Bounded non-authorizing decisions
include `operation_replay`, `operation_token_conflict`,
`audit_repair_required`, `provider_outcome_unknown`, `attempt_in_progress`,
`invite_not_eligible`, `retry_not_eligible`, `resend_not_eligible`,
`retry_cooldown`, `resend_cooldown`, `reconciliation_required`, and
`accepted_terminal`. Only `claimed` plus
`requires_provider_dispatch=true` may proceed to dispatch authorization.

### Dispatch boundary

`doorflow_authorize_staff_invitation_dispatch(invitation_id, actor,
operation_token, request_id)` again checks the current active same-venue Admin,
the exact actor/token/fence, the attempt's immutable venue/normalized
email/role binding, a live pre-dispatch lease, expected Auth ID, current target
profile where one exists, and current action eligibility. For resend/retry it
holds the stored target profile `FOR SHARE` and rejects a missing, inactive,
wrong-venue, or wrong-role target before authorizing external work. It
atomically writes
`dispatch_authorized_at`, `dispatch_started_at`, `last_provider_attempt_at`, and
required audit evidence before the handler calls `inviteUserByEmail`.

After this RPC commits, the database deliberately treats the dispatch as
possibly executed. A request timeout, abort, worker shutdown, provider timeout,
or lost response therefore leaves a conservative unresolved operation. It does
not become resend permission when the coordination lease expires. DoorFlow
does not claim exactly-once email delivery; it prevents blind duplicate
dispatch by its own workers and requires reconciliation when outcome is
uncertain. A partial unique index also prevents more than one unresolved
`dispatch_authorized`/`provider_unknown` attempt for an invitation.

The handler bounds the one provider call and adds no generic retry around the
invitation POST. Source review of the pinned `v2.116.0` tag shows
[`inviteUserByEmail`](https://github.com/supabase/supabase-js/blob/v2.116.0/packages/core/auth-js/src/GoTrueAdminApi.ts)
calling `_request` once and the
[`_request`/`_handleRequest` path](https://github.com/supabase/supabase-js/blob/v2.116.0/packages/core/auth-js/src/lib/fetch.ts)
calling its supplied fetcher once, without an automatic invite-POST retry
loop. That is source evidence, not a guarantee about a deployed bundle,
transport intermediary, or provider delivery. Inspect the resolved SDK and
provider behavior in staging before enabling sends.

For an initial invite with no stored Auth identity, DoorFlow sends an opaque
SHA-256 creation marker derived from the already-durable operation token in
the provider's user metadata. The returned user is accepted only when its
normalized email and marker both match. This fences the lookup-to-provider
race in which an unrelated pending Auth account appears after the exact
lookup: a provider response for that pre-existing account is treated as an
identity mismatch, its ID is not adopted, and no profile is created. Resends
still require the stored exact Auth user ID. The marker carries no role,
venue, or authorization meaning and is not copied into responses, logs,
profiles, or audit details.

### Provider outcome

`doorflow_record_staff_invitation_provider_outcome(invitation_id, actor,
operation_token, outcome, provider_auth_user_id,
provider_normalized_email, request_id, failure_code default null)` accepts the
exact current operation token/fence and immutable attempt binding in
`dispatch_authorized` or `provider_unknown` state. It needs no current-Admin
authorization because it only preserves a result from already authorized work.

- `accepted`: verifies returned normalized email and expected/stored Auth ID
  before setting a previously null Auth ID. It records provider acceptance, not
  delivery.
- `identity_mismatch`: preserves the original Auth ID, venue, role, prior send
  state/`last_sent_at`, and profile. A resend mismatch is classified
  `resend_identity_mismatch`; an initial mismatch is
  `provider_identity_mismatch`.
- `unknown`: preserves unresolved dispatch and blocks future sends.
- `rejected`: reserved for a future path that has affirmative evidence that no
  dispatch occurred; only bounded allowlisted codes are accepted. The current
  invite flow conservatively records every error after dispatch authorization
  as `unknown`, because an error does not prove no Auth account/email handoff.

A late exact-token result may replace `provider_unknown`. If the earlier
unknown-outcome audit itself is pending, outcome recording first verifies and
repairs that one canonical event as a continuation of the same authorized
attempt; any different pending event blocks the late transition and requires
the authorized repair RPC. An audit failure preserves the provider outcome and
an exact pending-audit marker rather than discarding either fact.

### Expired dispatch recovery

`doorflow_recover_staff_invitation_dispatch(invitation_id, current_actor,
original_operation_token, recovery_operation_token, request_id,
expected_updated_at, lookup_complete, observed_auth_user_id,
observed_normalized_email, observed_email_confirmed_at, observed_invited_at)`
is the authorized recovery boundary for a worker that can no longer persist a
provider result. The mutation-capable GET path invokes it only after an exact,
server-side identity observation and a second Admin authorization check.

The RPC locks current actor/observed target profiles in UUID order, then the
invitation and original attempt; rechecks an active same-venue Admin; verifies
the exact invitation/token/fence/identity binding; and uses database time. A
live `dispatch_authorized` lease returns `attempt_in_progress` without changing
state. After that lease expires, it atomically converts the original attempt
to `provider_unknown`, records the bounded observation on that attempt, clears
only the coordination lease, and writes canonical
`reconciliation_checked/provider_outcome_unknown` evidence with the original
actor/request and the recovering actor/request kept distinct.

This recovery never sends, adopts the observed Auth ID, creates or changes a
profile, changes prior `last_sent_at`, or enables retry/resend. A missing Auth
row is not proof of provider rejection, and a matching row is not proof of
email delivery. A repeat recovery is idempotent. Only the exact original-token
late provider result—or future provider-correlated evidence—may replace the
unknown outcome.

### Profile finalization

`doorflow_finalize_staff_invitation_profile(invitation_id, actor,
operation_token, request_id)` reauthorizes and owns the entire database-only
completion transaction. It creates only a missing exact profile, or verifies an
exact existing profile. It never upserts, updates, reactivates, changes role or
venue, resets a password, or deletes anything.

The transaction finishes the attempt (`sent` when unconfirmed, `accepted` when
`accepted_at` was already verified), clears the coordination lease, and records
`profile_created` or `profile_verified` plus `provisioning_completed`. If a
required audit cannot be inserted, the profile and truthful final state are
preserved with exact original actor/request/operation repair provenance. The
result is not relabeled as a concurrent successful insertion. If the first
profile event is pending, audit repair canonically records it and then attempts
`provisioning_completed/profile_ready` in the same repair transaction before
clearing the marker. Failure of that second append rotates the marker to the
completion event and leaves the truthful terminal state recoverable by a later
audit-only repair.

### Exact Auth lookup and reconciliation

The invitation path does not enumerate Auth users. When `auth_user_id` is
known, use `getUserById`. When it is unknown, the only fallback is
`doorflow_lookup_staff_invitation_auth_user(actor, venue, normalized_email)`.
Its public wrapper is `SECURITY INVOKER`; the private definer function checks a
current same-venue Admin under `FOR SHARE`, then locks and checks the exact
invitation before reading `auth.users`.
It returns only `id`, `email`, `email_confirmed_at`, and `invited_at`, at most two
rows so ambiguity can fail closed. It does not change Auth schema, indexes,
grants, or rows. Never invent a `listUsers` email filter or restore directory
pagination.

`doorflow_reconcile_staff_invitation(invitation_id, actor, operation_token,
request_id, expected_updated_at, observed_auth_user_id,
observed_normalized_email, observed_email_confirmed_at, observed_invited_at)`
receives only exact-lookup observations, locks and reauthorizes the actor plus
any observed/stored target profile before authoritatively locking the invitation,
requires the expected `updated_at`, blocks unresolved dispatch, derives profile
state from the current database, and writes a deterministic audit or exact
repair marker. It handles unowned active/inactive/role/other-venue identities,
confirmed-unlinked (`confirmed_account_unlinked`) and unconfirmed unowned
(`unowned_pending_auth_account`) Auth identities, exact-lookup unavailability,
stored-user absence/mismatch, unconfirmed users, and confirmed acceptance
without adopting an unowned Auth ID. `invited_at` does not change the public
classification or establish ownership. Reconciliation never sends email or
changes a profile.

Precise `existing_account_other_venue` and `accepted_profile_other_venue`
classifications are retained only in server-side invitation/audit state. Every
public response maps them to the generic `identity_unavailable` classification
and omits the invitation row, so another venue cannot learn account ownership,
role, status, or venue details.

### Audit repair

`doorflow_repair_staff_invitation_audit(invitation_id, actor,
repair_operation_token, request_id)` reauthorizes and repairs the exact pending
evidence. Pending state preserves original event, classification, actor,
request, operation token, and bounded details. The audit row separately records
the repairing actor/request/operation. The only chained event is the documented
`provisioning_completed/profile_ready` successor to a pending
`profile_created`/`profile_verified` event; repair never sends or changes
identity/profile data.

The exact all-or-none marker columns are `pending_audit_event_type`,
`pending_audit_classification`, `pending_audit_originating_actor_user_id`,
`pending_audit_originating_request_id`, `pending_audit_operation_token`, and
`pending_audit_details`. Repairable markers currently use the empty details
object; no arbitrary metadata is accepted through this path.

Audit IDs are deterministic over invitation, original operation, event, and
classification. A uniqueness conflict is success only after reading the row by
that ID and verifying every canonical field. A wrong-row collision returns
`audit_id_collision` and retains the marker. Interruption after insertion but
before marker cleanup is therefore safe to repeat without duplicating evidence.
Repair of a pending `profile_created`/`profile_verified` event is an ordered
two-event chain: after canonically recording the profile event, the same repair
actor/request/token records `provisioning_completed/profile_ready` with the
original actor/request/operation attribution. If that second event cannot be
recorded canonically, the transaction retains the repaired first event, rotates
the pending marker to `provisioning_completed/profile_ready`, and returns
`audit_repair_required`; a repeat repairs only that remaining event.

Audit `details` accepts only the schema's explicit flat scalar keys, caps text
and counts, and caps the serialized object at 2 KiB. Nested structures and all
unrecognized keys are rejected. Do not store passwords, access/refresh tokens,
bearer headers, invitation URLs, token hashes, API/SMTP keys, raw provider
objects, or submitted free-form prose in logs, responses, or audit rows.

## State and external-operation boundaries

```text
reserved
  -> claimed (DB lease/token/fence + attempt_started audit)
  -> dispatch_authorized (durable "provider may have been called" boundary)
     -> provider_accepted -> profile_finalizing -> sent
     -> provider_unknown  -> reconciliation_required (no blind resend)
     -> identity_mismatch -> reconciliation_required (identity preserved)
     -> verified rejection -> failed (future affirmative-evidence path only)

dispatch_authorized --lease expires + authorized recovery check-->
  provider_unknown (bounded observation; no identity adoption or resend)
provider_unknown --exact original-token late result-->
  provider_accepted / identity_mismatch / verified rejection

claimed --lease expires before dispatch--> abandoned_before_dispatch
          -> a new claim may start with a new token/fence

sent --verified email_confirmed_at--> accepted / accepted_profile_conflict
accepted + missing profile --new authorized profile-only claim--> accepted

any committed required event + audit failure
  -> exact pending-audit marker
  -> audit-only repair
  -> original outcome unchanged
```

`processing_started_at`/`lease_expires_at` coordinate database ownership before
dispatch. They are not evidence that an external operation did or did not
happen. `dispatch_started_at` and the attempt state carry that distinction.

## Required audit classification

| Evidence | Guarantee |
| --- | --- |
| Reservation and `attempt_started` | Transactional with the corresponding database mutation; failure rolls back the mutation. |
| Stale pre-dispatch `attempt_abandoned` | Transactional with abandonment and the replacement claim; a missing event rolls the takeover back. |
| `dispatch_authorized` | Transactional with the durable dispatch boundary; provider call is forbidden unless it commits. |
| Expired-dispatch `reconciliation_checked/provider_outcome_unknown` | Transactional with the recovery transition; failure rolls back the transition and observation, leaving the dispatch fenced. |
| Provider accepted/resend/unknown/rejected/mismatch | Outcome remains durable even if audit fails; exact marker repairs evidence without another provider call. |
| Profile created/verified/failed and provisioning completed | Same database transaction as profile/final invitation state; profile-write failure remains distinct from an audit failure. Repair of a pending created/verified event chains the skipped completion event, rotating the exact marker to `provisioning_completed/profile_ready` if that second append also fails. |
| Acceptance/profile conflict reconciliation | CAS transaction plus deterministic event; exact marker on audit failure. |
| Optional diagnostic detail | May be omitted or best-effort only when it is not required security evidence; never substitute it for one of the rows above. |

Audit is append-only: `service_role` has SELECT/INSERT only, and no role receives
UPDATE or DELETE. Invitation/attempt rows also have no DELETE grant.

## Disabling and already-running work

The environment enable switch is evaluated when the handler initializes a
request. After a changed value is visible to the runtime, newly initialized
requests must reject reservation, claim, dispatch, profile, reconciliation,
and repair paths. The review SQL deliberately contains no durable provisioning
enable flag, so the environment toggle alone does **not** cancel or re-gate
later boundaries inside a request already admitted under `true`.

It also does not kill a running isolate, cancel a provider request, revoke an
email already queued, or recall a committed dispatch authorization. During a
disablement, drain and observe already-admitted invocations, continue only the
narrow exact-token persistence needed to preserve a result from an already
authorized dispatch, never resend to probe an uncertain outcome, and inspect
all unresolved attempts before re-enabling. An immediate durable stop would
require a separately designed and reviewed database gate or withdrawal of the
route/runtime; neither mechanism is part of this SQL contract. Do not describe
an environment update as instantaneous cancellation.

## SMTP, Auth URL, template, and acceptance prerequisites

Before enabling in staging or production:

1. Configure approved custom SMTP. Verify sender/domain, SPF, DKIM, DMARC,
   provider and Supabase Auth rate limits, and a stable From address.
2. Disable click/link rewriting for Auth mail when it can invalidate single-use
   links.
3. Set the exact Site URL and exact `/auth/` redirect. Supabase can fall back to
   Site URL when `redirectTo` is not allowlisted, so inspect the canary link.
4. Use the Invite user template with `{{ .ConfirmationURL }}`. Do not substitute
   recovery or signup-confirmation flows.
5. Verify `/auth/` uses an isolated nonpersistent client, authenticates the
   invite session before password mutation, re-verifies the same identity at
   the mutation boundary, never reuses the normal DoorFlow session, and locally
   disposes the acceptance client on every terminal path.
6. Verify credential material is synchronously removed before subresources;
   responses are `no-store`/`no-referrer`; there is no analytics; and cache-v30
   and service-worker offline fallback never contain or serve `/auth/`.
7. Exercise a deliberately misrouted fictional invite against `/`. The main
   persistent DoorFlow client must use `detectSessionInUrl:false`; the document
   must scrub Auth credentials and provider-error details before external
   scripts; and the service worker must bypass and purge credential-bearing
   root navigations while retaining the cache-v30 name and ordinary shell
   behavior. The existing signed-in session must remain unchanged.
8. Verify both hosting configurations send `X-Frame-Options: DENY` and
   `Content-Security-Policy: frame-ancestors 'none'` for the main application
   and `/auth/`, in addition to the acceptance privacy headers.

Official references:

- [Admin invitations](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)
- [Auth users](https://supabase.com/docs/guides/auth/users)
- [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Edge Function secrets and reserved names](https://supabase.com/docs/guides/functions/secrets)
- [Edge Function limits](https://supabase.com/docs/guides/functions/limits)

The invitation API reference proves the supported invitation call; it does not
by itself prove every pending-invitation resend behavior. Verify same-invitation
resend semantics, returned identity, provider rate limiting, and error timing
against pinned SDK `2.116.0` in the isolated staging project. Do not substitute
password recovery, signup confirmation, or an invented method.

## Installation order

The SQL file is one transaction, but the broader release is not atomic.

1. Capture candidate revision, Git status, hashes, test evidence, existing
   schema/policy/function/publication/grant inventory, and a backup/PITR point.
2. Confirm these names do not exist: all three tables, the private schema, and
   every `doorflow_*staff_invitation*` function listed below. A collision is a
   stop condition; do not overwrite an unknown object.
3. Deploy and verify the static acceptance page/headers with provisioning
   disabled. Do not send an invitation.
4. Review and apply the complete review SQL once in an isolated staging
   database. Do not paste fragments or move it to automatic migrations.
5. Run every read-only and effective-role check below. Run real concurrency and
   constraint tests with disposable fictional rows, then roll back/remove only
   those approved fixtures.
6. Configure exact Auth URL/template/SMTP and environment values. Keep the
   switch disabled.
7. Deploy with `verify_jwt = true`. Confirm disabled GET/POST cannot mutate.
8. Run the full isolated staging checklist, including provider and browser
   tests. Review database, Auth, mail-provider, and audit chronology together.
9. Production activation requires separate approval and a staffed observation
   window. Enable, send one approved internal canary, and stop on any ambiguity.

## Read-only post-install verification

Run as an authorized database operator. These queries do not create an
invitation or mutate an account.

```sql
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'staff_invitations', 'staff_invitation_attempts',
    'staff_invitation_audit'
  )
order by c.relname;

select schemaname, tablename, policyname, roles, cmd
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in (
    'staff_invitations', 'staff_invitation_attempts',
    'staff_invitation_audit'
  );

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'staff_invitations', 'staff_invitation_attempts',
    'staff_invitation_audit'
  )
order by table_name, ordinal_position;

select c.conrelid::regclass as table_name, c.conname,
       pg_catalog.pg_get_constraintdef(c.oid) as definition
from pg_catalog.pg_constraint as c
where c.conrelid in (
  'public.staff_invitations'::regclass,
  'public.staff_invitation_attempts'::regclass,
  'public.staff_invitation_audit'::regclass
)
order by c.conrelid::regclass::text, c.conname;

select tablename, indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
  and tablename in (
    'staff_invitations', 'staff_invitation_attempts',
    'staff_invitation_audit'
  )
order by tablename, indexname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'staff_invitations', 'staff_invitation_attempts',
    'staff_invitation_audit'
  )
order by table_name, grantee, privilege_type;

select n.nspname, p.oid::regprocedure, p.prosecdef,
       p.provolatile, p.proconfig
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname in ('public', 'doorflow_invitation_private')
  and (p.proname like 'doorflow_%staff_invitation%'
       or n.nspname = 'doorflow_invitation_private')
order by n.nspname, p.oid::regprocedure::text;

with roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
), rpc_functions(signature) as (
  values
    ('public.doorflow_reserve_staff_invitation(uuid,uuid,text,text,text,text,text,text,uuid)'),
    ('public.doorflow_claim_staff_invitation(uuid,uuid,text,uuid,integer,integer,uuid)'),
    ('public.doorflow_authorize_staff_invitation_dispatch(uuid,uuid,uuid,uuid)'),
    ('public.doorflow_record_staff_invitation_provider_outcome(uuid,uuid,uuid,text,uuid,text,uuid,text)'),
    ('public.doorflow_recover_staff_invitation_dispatch(uuid,uuid,uuid,uuid,uuid,timestamptz,boolean,uuid,text,timestamptz,timestamptz)'),
    ('public.doorflow_finalize_staff_invitation_profile(uuid,uuid,uuid,uuid)'),
    ('public.doorflow_reconcile_staff_invitation(uuid,uuid,uuid,uuid,timestamptz,uuid,text,timestamptz,timestamptz)'),
    ('public.doorflow_repair_staff_invitation_audit(uuid,uuid,uuid,uuid)'),
    ('public.doorflow_lookup_staff_invitation_auth_user(uuid,uuid,text)'),
    ('doorflow_invitation_private.valid_audit_details(jsonb)'),
    ('doorflow_invitation_private.event_uuid(uuid,uuid,text,text)'),
    ('doorflow_invitation_private.append_audit(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,jsonb)'),
    ('doorflow_invitation_private.lookup_auth_user_by_email(uuid,uuid,text)')
)
select roles.role_name, rpc_functions.signature,
       pg_catalog.has_function_privilege(
         roles.role_name, rpc_functions.signature, 'EXECUTE'
       ) as can_execute
from roles cross join rpc_functions
order by rpc_functions.signature, roles.role_name;

select n.nspname, p.oid::regprocedure,
       exists (
         select 1
         from pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) as acl
         where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
       ) as public_execute
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname in ('public', 'doorflow_invitation_private')
  and (p.proname like 'doorflow_%staff_invitation%'
       or n.nspname = 'doorflow_invitation_private')
order by n.nspname, p.oid::regprocedure::text;

with browser_roles(role_name) as (
  values ('anon'), ('authenticated')
), invitation_tables(table_name) as (
  values
    ('staff_invitations'),
    ('staff_invitation_attempts'),
    ('staff_invitation_audit')
)
select browser_roles.role_name, invitation_tables.table_name,
       pg_catalog.has_table_privilege(
         browser_roles.role_name,
         pg_catalog.format('public.%I', invitation_tables.table_name),
         'SELECT'
       ) as can_select,
       pg_catalog.has_table_privilege(
         browser_roles.role_name,
         pg_catalog.format('public.%I', invitation_tables.table_name),
         'INSERT'
       ) as can_insert,
       pg_catalog.has_table_privilege(
         browser_roles.role_name,
         pg_catalog.format('public.%I', invitation_tables.table_name),
         'UPDATE'
       ) as can_update,
       pg_catalog.has_table_privilege(
         browser_roles.role_name,
         pg_catalog.format('public.%I', invitation_tables.table_name),
         'DELETE'
       ) as can_delete
from browser_roles cross join invitation_tables
order by invitation_tables.table_name, browser_roles.role_name;

with browser_roles(role_name) as (
  values ('anon'), ('authenticated')
)
select browser_roles.role_name,
       pg_catalog.has_schema_privilege(
         browser_roles.role_name, 'doorflow_invitation_private', 'USAGE'
       ) as private_schema_usage
from browser_roles
order by browser_roles.role_name;

select
  has_table_privilege('service_role', 'public.staff_invitation_audit', 'UPDATE')
    as service_role_audit_update,
  has_table_privilege('service_role', 'public.staff_invitation_audit', 'DELETE')
    as service_role_audit_delete;
```

Expected: all three tables have RLS enabled and forced; the policy query returns
zero rows; every `anon`/`authenticated` privilege on every new table and private
schema `USAGE` is false; every `public_execute` value is false; service role has
no audit UPDATE/DELETE and no table DELETE; public functions are invoker; only
the private exact Auth lookup is definer; and every function has a fixed empty
search path.

Check each public RPC's EXECUTE privilege using its exact `regprocedure`
signature. `anon` and `authenticated` must be false; `service_role` true. Also
confirm PUBLIC EXECUTE is absent from private helpers.

### Effective-role denial tests

Privilege metadata alone is not a browser-role execution test. In the isolated
staging database, run each block separately and record the expected permission
error, then `ROLLBACK`:

```sql
begin;
set local role anon;
select * from public.staff_invitations limit 1; -- must be denied
rollback;

begin;
set local role anon;
select * from public.staff_invitation_attempts limit 1; -- must be denied
rollback;

begin;
set local role anon;
select * from public.staff_invitation_audit limit 1; -- must be denied
rollback;

begin;
set local role authenticated;
select * from public.staff_invitations limit 1; -- must be denied
rollback;

begin;
set local role authenticated;
select * from public.staff_invitation_attempts limit 1; -- must be denied
rollback;

begin;
set local role authenticated;
select * from public.staff_invitation_audit limit 1; -- must be denied
rollback;

begin;
set local role anon;
select *
from doorflow_invitation_private.lookup_auth_user_by_email(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  'fictional@example.invalid'
); -- must be denied before the function body
rollback;

begin;
set local role authenticated;
select *
from doorflow_invitation_private.lookup_auth_user_by_email(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  'fictional@example.invalid'
); -- must be denied before the function body
rollback;
```

Also invoke every public RPC as `anon` and `authenticated` with fictional UUIDs;
PostgreSQL must deny function execution before any lookup. A service-role-only
test cannot prove browser denial because privileged roles may bypass RLS.

## Recovery matrix

| Observed state | Safe action |
| --- | --- |
| Same request replay before/during/after completion | Replay the same reservation/operation result when token, request, actor, and payload fingerprint match. Never create a second intended identity. |
| Same idempotency key, different payload | Return conflict. Preserve original name, email, venue, role, and identity intent. |
| Same normalized email, different venue/Admin | Global uniqueness selects one reservation. Return generic `identity_unavailable` to the other venue with no identity/venue detail. |
| Stale claim before dispatch | Mark only the old pre-dispatch attempt `abandoned_before_dispatch`, audit it, then use a new token/fence. |
| Dispatch boundary committed, response lost | After the coordination lease expires, authorized GET recovery records the exact bounded observation and converts only to audited `provider_unknown`. It adopts no identity and permits no resend. |
| Recovery finds no or one matching Auth row | Preserve that observation on the original attempt. Neither absence nor a match proves delivery/rejection; remain `provider_unknown`. |
| Late provider acceptance | Record through the original token, validate email/Auth ID, then continue profile-only work under a newly authorized boundary if needed. |
| Resend returns unexpected Auth ID | Preserve original Auth ID and `last_sent_at`; set `resend_identity_mismatch`; create no profile for the returned identity. |
| Initial invite returns unexpected identity | Preserve intended venue/role and any prior evidence; set `provider_identity_mismatch`; require reconciliation. |
| Provider error after dispatch authorization | Current flow records `unknown`; do not infer no account/email was created. |
| Provider accepted, database result write failed | Exact attempt remains unresolved or late-result capable. Reconcile; do not resend. |
| Profile creation succeeds, required audit fails | Preserve exact profile and terminal invitation fields plus pending provenance. Repair a pending profile event first, then canonically append the skipped `provisioning_completed/profile_ready` event in the same repair; rotate the marker to that completion event if its append fails. |
| Existing active exact profile | Verify without updating it; append `profile_verified`; finish only if identity/venue/role all match. |
| Existing inactive/different-role/other-venue profile | Preserve it unchanged, record exact conflict, and require independent operator action. |
| Acceptance verified, profile missing | Preserve `accepted_at`; permit only separately authorized profile creation, never resend. |
| Audit inserted, marker cleanup interrupted | Repeat repair. Deterministic ID plus canonical read produces one event, then clears only the marker. |
| Deterministic audit ID contains different canonical row | Return `audit_id_collision`; retain marker; no email/profile/identity mutation. |
| Admin deactivated/demoted/moved before claim/dispatch/profile/reconcile/repair | Current database authorization rejects new work. If email already crossed dispatch, exact-token outcome recording may still preserve truth. |
| Provisioning disabled while request runs | The environment toggle rejects requests initialized after the changed value is visible. With no durable SQL gate, an already-admitted request may still reach later boundaries; drain/observe it. A committed dispatch cannot be recalled, and its exact result may still be finalized. |

## Staging verification checklist

The Step 5 results above establish the listed local PostgreSQL checks only.
This checklist still requires separately approved non-production staging
evidence against the actual schema, roles, runtime, provider and hosting
configuration. Local fixtures and mocks do not satisfy that fidelity check;
the local review findings and failed regression commands must also be resolved.

- [ ] Apply the review SQL transaction and run PostgreSQL parse/type checks.
- [ ] Exercise real row locks with concurrent connections: two Admins/same
  email, cross venue, delayed resend claim, lease expiry before dispatch, and
  provider-unknown after lease expiry.
- [ ] Verify actual constraints, canonical audit collision handling,
  transaction rollback, and effective `anon`/`authenticated` denial.
- [ ] Confirm current hosted/local Deno runtime typechecks and runs the pinned
  function; check wall-clock/idle limits on the selected plan.
- [ ] Confirm both hosted dictionaries are required as a pair, the one exact
  `DOORFLOW_SUPABASE_KEY_NAME` selects both entries, duplicate decoded names and
  nested/non-string/oversized entries fail, source pairs never mix, direct-key
  project-ref/URL binding is validated, and exact origins/fixed redirect hold.
  Confirm development rejects every hosted/remote/HTTPS Supabase URL and
  production rejects loopback, wrong-ref, suffix, wildcard, trailing-dot, and
  unexpected-port URLs. For an explicitly enabled legacy pair, confirm exact
  `anon`/`service_role` roles, shared project ref, HS256, and unexpired claims;
  then perform the separate staging API validation because decoding is not
  signature proof.
- [ ] Confirm missing/malformed/expired/forged/API-key-only credentials fail;
  Manager, Door, Viewer, inactive Admin, and missing-profile users fail.
- [ ] Confirm deactivation, demotion, and venue reassignment at every barrier:
  reserve, claim, pre-dispatch, lookup, profile, reconcile, and repair.
- [ ] Exercise the locked-row cross-venue ordering with deterministic database
  barriers for dispatch authorization, expired-dispatch recovery, profile
  finalization, and reconciliation. In session A, lock the foreign-venue
  caller's profile `FOR UPDATE`; start the RPC in session B and wait until
  `pg_stat_activity` proves it is blocked acquiring the profile lock (so its
  non-authoritative invitation identity peek has completed); then change the
  fictional invitation's `auth_user_id` and commit session A. Session B must
  return `decision_code=forbidden` with `record` null, never an
  identity-drift/version response containing the row. Reset the disposable
  fixture and repeat for all four RPCs.
- [ ] Confirm interruption before dispatch produces no provider call; during
  call, after provider success, and before outcome persistence produce
  conservative uncertainty and no blind duplicate dispatch. Confirm a live
  lease is not recovered, an expired lease becomes one canonical
  `provider_unknown` observation, a different same-venue Admin is attributed
  as recoverer, revoked/moved Admins fail, repeats do not duplicate audit, and
  only an exact original-token late result can resolve the unknown state.
- [ ] Verify provider call count, Auth/profile identity, committed invitation
  and attempt rows, and complete audit evidence—not status code alone.
- [ ] Verify current Supabase pending-invitation resend semantics with one
  fictional mail-sandbox identity. Do not infer them from the method name.
- [ ] Verify the pinned provider preserves the opaque creation marker only on
  the newly created Auth user and does not apply it to a pre-existing pending
  same-email user. Confirm the latter response is rejected without adopting
  the user ID or creating a profile, and confirm the marker is absent from
  DoorFlow responses, logs, profiles, and audit details.
- [ ] Resolve the global email-reservation trust decision: either document
  that all venue Admins are mutually trusted to make permanent first claims,
  or approve and test a separate audited reclaim/transfer design restricted
  to provably pre-dispatch or definitively rejected attempts. Keep
  provisioning disabled until this policy is settled.
- [ ] Verify oversize/misleading/absent `Content-Length`, streamed UTF-8,
  malformed JSON, unsupported media type, non-object and wrong-type bodies,
  extra fields, and bounded sanitized responses.
- [ ] Simulate every required audit failure and interruption after insert/before
  cleanup. Include an already-accepted invitation whose first profile audit
  fails; confirm repair records both the profile event and
  `provisioning_completed/profile_ready`, or rotates the marker to the latter
  when its append fails. Confirm only audit repair occurs and original
  attribution survives.
- [ ] Install network interception before `/auth/` page initialization. Verify
  URL scrubbing, invitation-session isolation from a seeded Admin session,
  same-identity recheck before password update, policy/mismatch/timeout paths,
  local disposal, response headers, and empty CacheStorage/offline behavior.
- [ ] Re-run normal login/session recovery, Staff editing, service controls,
  Check In/Undo race guards, realtime/polling, reports/export/print, mobile
  layouts/scroll, PWA cache-v30, manifests, and cumulative phase smokes.
- [ ] Run an approved internal canary and reconcile Auth, SMTP provider,
  invitation, attempt, profile, and audit chronology. Stop on any mismatch.

## Stop conditions

Disable provisioning and stop on duplicate or ambiguous dispatch, unexpected
identity, cross-venue disclosure, stale-worker external call, missing required
audit, noncanonical `23505` handling, wrong redirect, leaked credential,
unexpected browser privilege, acceptance-session crossover, configuration
source mixing, or profile/Auth ID mismatch. Do not use a resend to diagnose an
ambiguous provider result.

## Non-destructive rollback

1. Set `DOORFLOW_STAFF_PROVISIONING_ENABLED` to a non-`true` value and verify
   requests initialized after the changed value becomes visible reject POST
   mutations and GET reconciliation/repair.
2. Drain and observe already-admitted invocations. The environment toggle does
   not re-gate their later boundaries because this review SQL has no durable
   enable flag. Preserve exact-token outcome evidence for an already-authorized
   dispatch; do not claim that disabling recalled or canceled it.
3. Hide/roll back the Add Staff UI and retain manual provisioning.
4. If necessary, withdraw the function route after the disabled response is
   verified. Preserve logs according to policy.
5. Leave all three new tables and their RLS/grants in place. They are recovery
   and audit evidence, not disposable cache.
6. Do not delete/change Auth users, profiles, invitations, attempts, or audits;
   do not reset passwords, reassign venues, change roles, or reactivate staff as
   rollback.
7. Reconcile every claimed, dispatch-authorized, provider-unknown,
   reconciliation-required, profile-pending, or pending-audit row before a
   separately approved reactivation.

Dropping functions, the private schema, or tables is not normal rollback. A
future retention-driven removal requires verified evidence export, resolution
of every partial operation, explicit data-destruction approval, and a separate
reviewed change.
