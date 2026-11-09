# Phase 9 operator and release runbook

## Product contract

See PHASE_9_MODEL.md. Existing organizations, subscription_accounts, venue_settings and venue_branding are reused. Missing staging tables are created with compatible columns. Both membership tables remain deferred; they confer no authority. New venues are owned by one organization and the trusted onboarding operation refuses a second venue for that organization.

Existing production EVE is deterministically adopted by the sole existing doorflow-legacy organization; its settings and branding rows are preserved. Legacy subscription status remains accepted. Existing unowned staging fixtures are grandfathered. No fictional production rows or users are permitted.

## Trusted onboarding without SQL

Run `node scripts/venue-operator.mjs <command> request.json` from a trusted operator environment. Set DOORFLOW_OPERATOR_PROJECT_REF to the exact intended DoorFlow project and DOORFLOW_OPERATOR_SECRET through the environment. Never put that credential in JSON, source control, browser configuration or command arguments. The static build allowlist excludes every script and database file.

1. `onboard`: JSON fields customerRequestId (stable UUID), requestId (stable UUID), customerName, venueName, timezone (IANA name), email, fullName and optional address object. It creates/reuses the customer and creates an onboarding venue with deterministic settings. The same request/payload replays; a changed payload conflicts. A customer may also be created independently using the service-only doorflow_create_customer RPC.
2. `bootstrap`: requestId and an explicitly verified authUserId. The database locks the reservation and Auth identity, requires the intended normalized email and confirmed email, refuses existing unrelated staff profiles, and creates the active Admin profile. A matching completed request replays without changing credentials, role or venue. Audit records identify the request and bound identity.
3. `lifecycle`: venueId, status, optional subscriptionStatus, and a meaningful reason. Activation requires an active first Admin. The trusted action records an audit event. No history is deleted.
4. `customerStatus`: organizationId, status and reason. Customer denial overrides otherwise active venue/subscription states, and is audited.

For fictional staging only, `createStagingUser` accepts email/fullName and DOORFLOW_STAGING_TEMP_PASSWORD (20+ characters) in the environment. It is hard-bound to ktvmihmkdfvzmgubsqqc and example.invalid recipients, uses Auth admin create-user with email_confirm=true, and never calls invitation/recovery/email endpoints. It refuses production. Then pass the returned Auth ID to bootstrap. A duplicate Auth email is an explicit refusal; supply the verified existing ID to bootstrap rather than silently resetting or selecting an account.

Production bootstrap currently links a confirmed existing identity. First-customer email activation requires the external email setup described below. There is no public signup or Platform Admin account.

## Admin settings and operations

Venue Admins have Venue Settings navigation for display name, IANA timezone, default door location, service-day rollover, and an optional HTTPS logo reference. Save uses a narrow RPC that derives venue from the active profile; there is no caller-controlled venue ID. Managers, Door and Viewer cannot save settings. Customer objects and onboarding/audit tables remain server-only.

New venues use their timezone/rollover for the initial service date and Today action, their own door location and generic branding. B.O.B. retains its established local-date behavior, door choices, booth choices and presentation. A new venue named EVE does not acquire B.O.B. branding. Device-installed PWA icons/login shell remain the existing deployment shell; per-customer domains/PWA packaging are deferred.

Onboarding permits Admin setup while operational access is blocked. Active permits normal existing role-based operations only if the customer and subscription permit them. Suspended/canceled preserve all data and block operational reads/writes and staff mutations; the user's own profile/status/settings remain readable. Reservations, claims and invitation dispatch are refused for unavailable venues. Reactivation restores access to the same records and identities. Browser screens reflect the server result; RLS remains authoritative between refreshes.

Manual standard subscriptions support trial/active/suspended/canceled. Existing legacy/manual rows remain compatible. Trial start/end are informational, not a billing clock or automatic cutoff. No payments, payment methods, Stripe, paid service, DNS or external email configuration is added.

## Email activation dependency

Read-only production Supabase Emails inspection on November 8, 2026 showed the built-in email service and the Set up custom SMTP notice. No custom SMTP provider is configured. Do not add Supabase organization members to work around delivery restrictions.

Trevor must approve a provider/account and sender domain before activation. Configure SMTP host, port, TLS, username/password and sender address/name in Supabase Auth; add provider-required SPF/DKIM and a suitable DMARC policy only with domain approval. Review the existing invitation template and exact /auth/ redirect allowlist. Test with approved recipients in staging, check provider delivery/bounce logs, then obtain explicit approval before any production invitation or email. Keep DOORFLOW_STAFF_PROVISIONING_ENABLED=false until then. Credentials stay server-side. No production email was sent by this work.

## Verification and migration provenance

Release base: 6593c887e67d431c73d4d93399dd7f70e3fd996f.

| Migration | SHA-256 of applied local source |
|---|---|
| 20261109034248_phase_9_venue_onboarding.sql | 60ccff27ffb62cba24f349c5802cc4108d1ba20d4e198dcab0b1d010ab08fa06 |
| 20261109040314_phase_9_lifecycle_boundaries.sql | cdf0abf36d5391f03a2c82220fdc447f28b15986b8d6d18a9bd736ed03ee2ca7 |

Both were generated with the installed Supabase CLI. Each hosted application records the exact source in supabase_migrations.schema_migrations inside the same transaction before COMMIT. Earlier migration files are unchanged. The two new migration paths are marked -text in .gitattributes so Git preserves their exact bytes. The first migration retains the reused table definitions' CRLF bytes; the exact applied files and atomic application bundles are preserved in the release evidence.

Local results: 282 Node tests, nine smoke suites, 587 Deno adapter/audit tests, 47 config/context/password browser tests plus the invitation acceptance browser suite. Original foundation acceptance: 1,340 checks. Phase 9 tests replay both production-present and staging-absent SaaS table shapes, with 180 actual RLS probes plus onboarding/idempotency/lifecycle assertions. PGlite runtime used here: 0.3.16, PostgreSQL 17.5 WASM. No skipped database tests.

Raw Deno with the project config: zero application/test diagnostics and zero unexpected diagnostics. The two unchanged external errors remain TS2724 at asset:///node/stream/web.d.cts:59:49 and TS2430 at Auth JS 2.116.0 webauthn.dom.d.ts:501:18. Raw check therefore exits nonzero; runtime tests use the explicitly disclosed --no-check and denied network/run/FFI/write/sys/import permissions.

Hosted staging acceptance: 124 checks on fictional A/B/C using actual Auth sessions and the hosted frontend. It tests creation, retries, settings RPC and form, role limits, cross-tenant queries, account switching, generic presentation, invitation disabled status, suspension/cancellation, preserved guest data and reactivation. Fixtures are retained under unique p9-* names and example.invalid addresses. Early harness attempts are retained too: one empty-success-response parsing failure and a later test attempted to reuse a refresh session after logout; the final harness uses fresh password logins. These were test/operator defects, repaired before production.

Advisor review: no error-level notices. Intentional browser-callable SECURITY DEFINER profile/authorization helpers and the narrow settings RPC are reported as warnings; they have fixed search paths, explicit grants and profile-derived authority. Existing overlapping permissive read policies are unchanged. Do not weaken RLS to remove these notices.

## Deployment and rollback checkpoints

Production gates require all local checks, hosted onboarding, compatible read-only production preflight, and no critical security blocker. Production preflight verifies 18 assigned staff, 18 Auth users, one legacy customer/venue, supported subscription states, no conflicting columns/policies/objects, and zero invitation/attempt/audit/provider dispatch rows. Staff digest before release: ac4706a5f4db30673465017ddeaf1750.

Netlify previous production checkpoint: 6af0aaddca808b3c9df6fe1c. Vercel production checkpoint: dpl_Dq52TQ1javVyq8xkPqLU1Je8UGqF, main commit 7144c3d6a19e81ac2b5df191958171242b4ea5e9. Neither main nor preserved branches are rewritten. Push only release/phase-9-venue-onboarding. Deploy the explicitly built static artifact to Netlify; do not push main or trigger a second production host.

If frontend recovery is needed, build and publish the preserved previous frontend source with the current production public configuration. Keep the additive schema and tenant/lifecycle controls; prefer a forward fix to dropping tables or restoring permissive policies. Never delete historical operational/security data. A failed transactional migration leaves its previous state intact. Keep exact source bundles, deploy identifiers and served-file hashes in phase9-evidence outside the Git tree.

Deferred: external SMTP/DNS activation, public signup, multi-venue ownership UI/authority, Platform Admin, billing/payments, POS, Digital Cover, custom domains, full theme builder and AI analysis.
