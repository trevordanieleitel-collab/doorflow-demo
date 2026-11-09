# Phase 9 release verification — November 8, 2026

PHASE 9 CUSTOMER/ORGANIZATION MODEL: PASS
VENUE ONBOARDING: PASS
FIRST ADMIN BOOTSTRAP: PASS
VENUE SETTINGS: PASS
VENUE LIFECYCLE: PASS
SUBSCRIPTION SCAFFOLDING: PASS
STAFF INVITATION READINESS: PARTIAL — application ready; custom SMTP activation outstanding
MULTI-CUSTOMER ISOLATION: PASS
HOSTED STAGING END-TO-END ONBOARDING: PASS
REGRESSION SUITES: PASS
APPLICATION/TEST DIAGNOSTICS: 0
UNEXPECTED DIAGNOSTICS: 0
RAW DENO CHECK: FAIL — only the two known external TS2724 / TS2430 declarations
PRODUCTION PREFLIGHT: PASS
PRODUCTION DEPLOYMENT: PASS
PRODUCTION DISABLED-MODE VERIFICATION: PASS
PRODUCTION INVITATION PROVISIONING: DISABLED
PRODUCTION EMAILS SENT: 0

PHASE 9 VENUE ONBOARDING & SAAS ADMINISTRATION: COMPLETE. EMAIL DELIVERY PROVIDER/DNS SETUP REMAINS AN EXTERNAL ACTIVATION STEP.

## What is live

DoorFlow can now create a customer and venue through a trusted operator tool, initialize venue-specific defaults, and securely assign the intended first Admin without editing database rows manually. That Admin can sign in, see only their venue and use Venue Settings. Customer, subscription and venue lifecycle controls preserve history while restricting operations. Ordinary staff still receive authority only from their active staff profile; there is no Platform Admin or multi-venue Admin.

The four existing SaaS tables are reused: organizations, subscription_accounts, venue_settings and venue_branding. The staging equivalents were absent and are now created. Membership tables remain unused. New tables record onboarding requests and administration audit events. Existing B.O.B. data is preserved; no fake customer or user was created in production.

The operator reserves the intended first-Admin email, requires a matching confirmed Auth identity and creates the Admin profile for that exact venue. It refuses to move/promote an existing unrelated employee and safely replays matching completed requests. Temporary-password user creation is hard-limited to fictional staging accounts. Production links a confirmed existing identity until approved customer email activation is available.

Admins can configure display name, timezone, default door, service-day rollover and an optional HTTPS logo reference. New venues use generic branding and their own timezone/defaults. Existing B.O.B. operational behavior remains compatible. Active operations require permitted venue, customer and subscription states; onboarding is setup-only; suspended/canceled preserve history and deny operations/invitations. Reactivation restores the same users/data. Standard manual subscriptions support trial/active/suspended/canceled; trial dates are informational and no payments are implemented.

## Evidence

- 282 local Node tests pass; all nine operational/mobile/invitation/check-in-race smoke suites pass.
- Original tenant foundation: 1,340 database checks. Phase 9: 180 actual role/session RLS probes across both schema shapes, plus bootstrap/idempotency/lifecycle assertions.
- 587 Deno adapter/audit tests pass. Raw Deno has only the documented external TS2724 and TS2430 errors; no application/test or unexpected diagnostics.
- 47 config/context/password browser checks and the full invitation acceptance browser suite pass. Temporary browser cleanup is verified.
- Hosted staging run p9-4bdb076a86: 124 checks pass. Fictional A/B/C were created through onboarding; actual Auth login and hosted UI covered settings save, Door restrictions, account switching, tenant isolation, suspension/cancellation and restoration. Fixtures remain clearly named p9-* / example.invalid; earlier test runs are retained and documented in the runbook.
- Staging and production advisors: 13 warnings each, zero error-level notices. Nine intentional browser-callable protected functions (seven pre-existing helpers plus lifecycle/settings) and four existing overlapping read-policy warnings were reviewed. No RLS was weakened.
- All 19 served production files match the tested production artifact.
- Existing production Admin session restored after deployment. Door Check-In, Staff, Management, Reports and Venue Settings loaded. Staff showed 18 profiles; settings showed active EVE, America/New_York, Front Door and 04:00. The Staff screen showed the server's disabled/setup-required invitation message. No production form was saved and no invitation was submitted.
- Production staff digest before/after: ac4706a5f4db30673465017ddeaf1750. Staff 18; Auth users 18; organizations 1; onboarding requests 0. Invitation/attempt/audit/provider-dispatch counts all remain 0. Both staging and production provisioning metadata match SHA-256(false).
- Browser venue INSERT, onboarding execution and first-Admin bootstrap execution are denied. Both hosted databases record the exact migration source hashes below.

## Release identifiers

- Branch: release/phase-9-venue-onboarding. Only this branch was pushed; main and prior release/staging histories were preserved.
- Deployed application commit: 152ea1da451a4a1923a6f0b3bdb7045a8c9edf06.
- Production: https://doorflow-thebob.netlify.app
- Netlify production deployment: 6af14820c845f4e36981d209.
- Final staging preview deployment: 6af146515b3957f9063ad1ff.
- Staging preview: https://saas-foundation--doorflow-thebob.netlify.app
- Hosted staging: ktvmihmkdfvzmgubsqqc. Production: wdlgkwzowapzhurbbavf.
- Both hosted versions: 20261109034248 and 20261109040314.

| Migration | Applied source SHA-256 |
|---|---|
| 20261109034248_phase_9_venue_onboarding.sql | 60ccff27ffb62cba24f349c5802cc4108d1ba20d4e198dcab0b1d010ab08fa06 |
| 20261109040314_phase_9_lifecycle_boundaries.sql | cdf0abf36d5391f03a2c82220fdc447f28b15986b8d6d18a9bd736ed03ee2ca7 |

The exact source was recorded atomically in hosted migration history. New migration files have byte-preserving Git attributes. Production applied both changes in one guarded transaction. The final documentation-only checkpoint follows the deployed code commit and does not change the served artifact.

## Recovery and outstanding activation

Previous Netlify deployment: 6af0aaddca808b3c9df6fe1c, source 6593c887e67d431c73d4d93399dd7f70e3fd996f. Its served files are saved in phase9-evidence/production-checkpoint. Recovery is a new controlled deploy from that preserved frontend, retaining the additive database protections. Vercel production remains dpl_Dq52TQ1javVyq8xkPqLU1Je8UGqF at commit 7144c3d6a19e81ac2b5df191958171242b4ea5e9.

Production Supabase Emails currently uses its built-in service, with no custom SMTP configured. A provider account, approved sender/domain, SMTP credentials, provider-required DNS verification, and an approved delivery test remain necessary. No provider was purchased, DNS changed, real password reset, production invitation enabled or email sent. PHASE_9_RUNBOOK.md documents the provider-neutral activation procedure and operator commands.

Billing/payments, POS, Digital Cover, multi-venue Admin, Platform Admin, custom domains, full theme builder and AI analysis remain deferred.
