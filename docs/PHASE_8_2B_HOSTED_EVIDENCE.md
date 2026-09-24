# Phase 8.2B: hosted staging provenance

This document records sanitized milestones from completed staging work. It contains no keys, credentials, recipient addresses, user identifiers or fictional seed records. Detailed local reports and raw evidence remain outside Git. The current production release plan is [Phase 8.2C disabled deployment](PHASE_8_2C_DISABLED_PRODUCTION_DEPLOYMENT.md); these historical results do not replace its exact-candidate smoke.

## Verified source and hosted identity

| Checkpoint | Value |
|---|---|
| Phase 8.2A parent | `dff47553e9134c08e0defa5280dd5808d8fb1a56` |
| Local staging-safety baseline | `0b6ec916e6b2adb2b4f489e16edf55034a4ef076` |
| Preserved staging branch | `staging/phase-8-2b` |
| Final staging frontend commit | `74d8a2722cc62720ec5d405107d665056fcf0109` |
| Supabase project | DoorFlow Staging, `ktvmihmkdfvzmgubsqqc`, us-east-2 |
| Vercel Preview | `dpl_2q1j7L3Wrt5w7zzBrhL2BawY7W3a` |
| Stable origin | https://doorflow-demo-git-sta-025094-trevordanieleitel-collabs-projects.vercel.app |
| Function | `staff-invitations`, ID `ad4386f5-6db9-451a-8d28-d7d128bd711e` |
| Final Phase 8.2B Function version | `6`, ACTIVE, `verify_jwt=true` |
| Function bundle SHA-256 | `6e328941c774337a02036079b49b340507efe6e475590f7a27008098e74cf283` |

The staging branch was first pushed at the exact safety baseline and verified remotely before hosted setup. The later staging-only repair changed public configuration fetches to include same-origin hosting cookies for protected Vercel Preview. Origin/binding checks and redirect denial stayed in place. Three browser tests covered the repair.

Neither main branch was moved or pushed during staging testing. GitHub main and both production frontends remained at `7144c3d6a19e81ac2b5df191958171242b4ea5e9`. The production schema was inspected read-only for faithful staging reconstruction; no production business data was copied and no production mutation occurred.

## Historical migration identities

Supabase's hosted application assigned versions different from the local artifact filenames. Keep both identities; do not blindly replay local versions against the already initialized staging database.

| Local staging artifact | Hosted version |
|---|---|
| `20260923213950_doorflow_staging_prerequisites.sql` | `20260923214328` |
| `20260923214042_doorflow_staff_invitations.sql` | `20260923214345` |
| `20260923214045_doorflow_single_venue_staff.sql` | `20260923214359` |
| `20260923214548_doorflow_staging_advisor_hardening.sql` | `20260923214644` |

SHA-256 hashes of those original LF artifacts, in the same order:

1. `9eb9046b8e632b45fb5173e9a105091bc27d20bc686e64018bb83c9ba7c52028`
2. `419e306d7aba0566fbb112c659a66ca585ec7cea7ca40aaae407f8dbb1e4d8e5`
3. `e81456174e414bcad1324a4584838cb48c2289bd8457680ade5f23b68a78e768`
4. `805d157cd66886d535259d02d0e71c5da0bb6dc4ff62fc46cdcd641926da16ca`

The empty staging project needed a faithful operational-schema bootstrap. Production already has that schema. Phase 8.2C therefore packages a production prerequisite guard followed by the tested invitation, single-venue policy and hardening changes; it does not run the empty-project bootstrap against production.

Staging preserved nullable staff venue, the Auth foreign-key relationship and deletion behavior, required defaults/constraints/helpers, and the `auth.users.email::text` correction. Hardening removed unnecessary helper execution, retained required identity-helper execution, narrowed operational table privileges, added supporting indexes, and optimized own-profile identity lookup. No public policy was added to the server-only invitation tables.

## Hosted verification milestones

| Gate | Observed result |
|---|---|
| Real staging Auth | Normal password login passed with fictional accounts; wrong password rejected. |
| Venue staff RLS | Admin A/B restricted to their assigned venues; cross-venue and null-venue administration denied. |
| Own-profile initialization | Retained, including a no-venue Admin's own-profile read. |
| Non-admin permissions | Door account could read its own profile and could not use Admin staff actions. |
| Current authorization | Deactivation/demotion blocked new work; reassignment removed old-venue authority. |
| Authenticated frontend isolation | Main/auth configuration and observed application requests used staging only. |
| Function gateway | Missing/malformed token denied with `verify_jwt=true`. |
| Disabled Function | Valid active Admin received `503 provisioning_disabled`; invitation records/provider sends unchanged. |
| Controlled first provider send | One authorized invitation accepted; profile created with Door role in fictional Venue A. |
| Exact request replay | Existing invitation returned; zero additional provider dispatch. |
| Immediate legitimate resend | `429 resend_cooldown`; zero additional provider dispatch. |
| Email acceptance | Owner confirmed receipt/click; Auth recorded acceptance at 2026-09-24 00:18:11.291278 UTC. |
| Invited-account login | Real hosted website and normal Auth API login passed; Door/Venue A permissions confirmed. |
| Acceptance reconciliation | Supported non-emailing Admin GET updated invitation state; repeating it was stable. |
| Duplicates | No duplicate matching Auth identity or profile. |
| Final provisioning | Explicitly false, saved setting and live disabled response verified. |

The accepted invitation ended with `status=accepted`, `send_state=provider_accepted`, `profile_state=created`, `operation_state=completed`, `attempt_count=1`, and no failure or pending audit. There was **one total provider dispatch** and one separate reconciliation operation with `requires_provider_dispatch=false`. The latter is bookkeeping, not a second email. Audit and Auth gateway evidence independently supported this result. The second authorized email was unnecessary and unused.

The invited-account password was set through a supported, bounded staging Auth administrator workflow and then tested with normal login. This verifies real account access; it does **not** claim the `/auth/` page's password-entry form was exercised during that hosted run. Its local browser/unit tests are separate evidence. Temporary verification helpers were retired; no helper credentials or code are production release inputs.

The final Phase 8.2B report was recorded at 2026-09-24 01:21 UTC. Setting changes advanced the Function version without changing its application bundle. Both verification sessions and browser sessions were signed out. Custom SMTP was not configured or changed.

## Configuration and cache evidence

The five public variable names were scoped only to Vercel Preview and `staging/phase-8-2b`: `DOORFLOW_ENVIRONMENT`, `DOORFLOW_PUBLIC_SUPABASE_URL`, `DOORFLOW_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DOORFLOW_PUBLIC_SUPABASE_PROJECT_REF`, and `DOORFLOW_PUBLIC_ALLOWED_ORIGIN`. No privileged value entered browser configuration.

Main and `/auth/` share validation before Supabase clients initialize. Missing configuration failed the build. Wrong-origin deployment URLs failed closed. Stale/mismatched document/config bindings were rejected. Configuration was network-only and excluded from the service-worker cache. Seventy-two existing configuration/browser/cache tests plus three protected-host tests passed after the repair.

Browser observations covered page resources and application/API behavior; they were not a comprehensive packet capture. An existing old production window/worker cannot be repaired retroactively by a staging deployment. The production release needs its own cache-replacement verification.

## Advisor and type-check exceptions

Final staging security notices were three informational no-policy findings for intentionally server-only invitation tables, seven warnings for required authenticated security-definer identity helpers, and a leaked-password-protection warning. Performance notices included unused indexes, four multiple-policy warnings, and Auth connection allocation. Their Phase 8.2C disposition is in the current runbook; no permission was weakened to make the historical report warning-free.

The known raw Deno check remained failed on exactly two external declaration diagnostics:

- `TS2724`, `asset:///node/stream/web.d.cts:59:49`, `TransformerCancelCallback`.
- `TS2430`, `@supabase/auth-js` 2.116.0 `webauthn.dom.d.ts:501:18`, `PublicKeyCredentialFuture` / JSON `largeBlob` type mismatch.

Application/test-source diagnostics and unexpected diagnostics were zero. This is a documented upstream exception, not a passing raw check. Do not suppress it by changing library declarations, lock files, compiler strictness, or test expectations. Any additional diagnostic fails the candidate gate. Earlier local runtime suites disclosed their runtime-only `--no-check`; hosted Auth/provider success supplies different evidence.

## Preservation and reproducibility limits

Preserve this staging branch and its hosted history. Keep raw response files, temporary scripts, generated runtime config, private passwords, session tokens, keys and fictional records outside committed production source.

Migration histories and source hashes identify what was tested; they do not authorize reapplying an empty-project migration or importing test data. The production candidate must pass its own schema guard, tests, fresh disabled staging smoke and production preflight. A source change after that smoke requires another smoke. Production enablement remains a separate decision.

