# Single-venue isolation and public browser configuration

> Historical local-safety record: hosted staging subsequently completed, as documented in [Phase 8.2B hosted provenance](PHASE_8_2B_HOSTED_EVIDENCE.md). The local-only status below describes its original checkpoint. The current gated release plan is [Phase 8.2C disabled production deployment](PHASE_8_2C_DISABLED_PRODUCTION_DEPLOYMENT.md); it does not yet claim a completed production deployment. The authorization and browser configuration contracts below remain relevant.

Local review only. No hosted installation, deployment, account creation or invitation enablement is authorized by these files.

## Staff-management rule

`staff_profiles.venue_id` is the authority source. An active Admin with a non-null venue can administratively SELECT, INSERT, UPDATE and DELETE profiles only in that same venue. UPDATE checks both the existing and proposed row. NULL is not a wildcard. The existing independent own-profile SELECT policy remains, including for inactive and no-venue users, so login can explain their account state. There was no general self-update policy to preserve; nonadmins do not acquire one. A no-venue Admin can read their own profile but has no venue staff-management authority.

`supabase/review/phase_8_2b_single_venue_staff_review.sql` replaces both broad permissive Admin policies, inside one transaction, after checking the exact expected policy inventory. It reuses `doorflow_has_venue_role(uuid,text[])`, not user metadata or memberships. Review the deployed helper definition, ownership, search path, execution privileges, table grants, role flags and policy inventory against the captured prerequisites before any separately approved application. No new SECURITY DEFINER, grants, Auth-schema changes or invitation RPC changes are introduced. Service-role behavior and database constraints remain separate.

Multi-venue administrator authorization is not part of the current staff_profiles.venue_id model and requires a separate authorization design before venue_memberships can become an authority source.

Future questions only: who grants/revokes memberships; which roles each membership permits; how venue selection and invitations work; how revocation, organization boundaries, audit evidence and platform administration should be handled. No Admin AB behavior exists in this change.

## Build and runtime contract

Run `node scripts/build-public.mjs` with Node 22 or later in a fresh checkout/build workspace. It uses no packages and reads no `.env` files. Publish **only `dist/`**, never the repository root. The build refuses to reuse an existing output directory. Missing or invalid values fail the build before creating output. Host configuration files select this command/output; no host settings have been changed.

Set these exact five browser-safe variables, scoped independently to each deployment environment:

| Variable | Meaning |
|---|---|
| `DOORFLOW_ENVIRONMENT` | `production`, `staging`, or explicit loopback `development` |
| `DOORFLOW_PUBLIC_SUPABASE_URL` | Exact `https://<project-ref>.supabase.co`, no path/query/credentials |
| `DOORFLOW_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The matching project's `sb_publishable_…` browser key |
| `DOORFLOW_PUBLIC_SUPABASE_PROJECT_REF` | Matching 20-character project reference |
| `DOORFLOW_PUBLIC_ALLOWED_ORIGIN` | One exact browser origin, no path/query/fragment/wildcard |

Vercel: main is Production; other branches are Preview. Set the five values separately in Production and Preview, with Preview using `staging` and a distinct staging backend. Netlify: set equivalent production versus deploy-preview/branch-deploy values. No values currently configured means the new build must fail, not select production. Optional provider context signals (`VERCEL_ENV`, `CONTEXT`) additionally reject a production-labelled config in non-production builds. No other environment variables are emitted. Never supply a service-role/secret key as the browser key.

For HTTPS preview URLs, configure the exact approved URL before building. A deployment-specific or alias URL not matching that origin will be intentionally unusable; wildcards and automatic hostname guessing are not supported. HTTP is permitted only for explicitly configured development loopback origins. Both pages use the same validator and public JSON at `/api/doorflow-public-config.json` before creating clients. Staging/development reject the known production project reference; that reference is a denial rule, never a fallback URL.

The generated HTML contains a SHA-256 fingerprint of the complete normalized public configuration. The fresh JSON must match that fingerprint and the browser origin. Main/auth disagreement or a stale document/fresh-config mismatch fails closed with a fixed setup message, no Supabase client and no backend requests. Acceptance still removes URL credentials synchronously before loading dependencies, and uses only its isolated in-memory session.

The fingerprint detects mismatched deployment artifacts; it is **not** a signature, authorization system, or proof that an opaque publishable key belongs to a project. The operator must independently verify the URL/ref/key pairing. An altered malicious same-origin application is outside this configuration check. Backend authorization and RLS remain necessary. Frontend `staging` describes deployment selection; the Edge function's HTTPS configuration still uses its existing `production` security mode with staging project values and provisioning disabled.

## Cache and rollout limits

Cache v31 replaces v30 because navigation/static fallback now reads only the current cache. Activation removes earlier DoorFlow caches. Public configuration and its validator are network-only and carry no-store headers; they are not precached. Safe shell/branding remains cached. Opening offline can show the shell, but cannot choose a backend or start account work without fresh configuration. Operational data was never an offline cache feature.

A restored back-forward page reloads to revalidate configuration. No forced service-worker activation interrupts a live service. Existing **prepatch** open pages/active old workers cannot be retroactively fixed by a new deployment: staging must use a fresh isolated origin, and upgrading an existing origin requires all old windows closed and verified worker replacement before use. Do not switch an origin between staging and production or reuse a production browser profile. Running clients are not instantly cancelled when host configuration changes. Deploy complete artifacts atomically; rebuild after configuration changes. Rolling back to a pre-config hardcoded-production bundle on staging is unsafe and prohibited. A safe rollback serves a non-operational maintenance page or the previous verified environment-bound artifact, keeps provisioning disabled, and preserves data/audit evidence.

## Verification

Local verification results and exact commands are recorded in the Step 3A lab completion report. Real browser transport is intercepted before initialization; mock results do not establish hosted Auth or email behavior. Real local PostgreSQL uses fictional records and actual non-bypass browser roles; its SQL-subject stand-in is not hosted JWT validation. Two known external Deno declaration errors remain a separately reported upstream exception, never a passing raw type-check.

Before staging approval: verify hosted schema/helper/grants, host build/headers/origin isolation, correct public key pairing, Edge Auth/API compatibility, invitation provider resend/uncertainty behavior, mail sandbox and redirect/SMTP configuration under separate authorization. Provisioning remains disabled.

Official references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [publishable versus secret keys](https://supabase.com/docs/guides/getting-started/api-keys), [Vercel project build configuration](https://vercel.com/docs/project-configuration), [Netlify file configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/).
