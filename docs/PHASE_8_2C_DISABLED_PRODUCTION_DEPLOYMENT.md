# Phase 8.2C: disabled production deployment

## Status and scope

This is the reviewed deployment plan under preparation, not a record of a completed production deployment. The final candidate commit, fresh staging smoke, password-security decision, and production preflight must all pass before production changes begin. Record their results in the release report; a planned action below is not evidence that it ran.

The owner authorized a production deployment with invitations disabled after those gates pass. This does not authorize enabling invitations, sending production email, creating fictional production users, resetting real employees' passwords, or configuring custom SMTP.

A migration is a versioned database change. Row-level security (RLS) is the database rule that decides which records a signed-in person may access. The Edge Function is the server endpoint that performs invitations. Its off switch remains `DOORFLOW_STAFF_PROVISIONING_ENABLED=false` throughout this release.

| Item | Release target or preserved checkpoint |
|---|---|
| Primary production website, confirmed by owner | https://doorflow-thebob.netlify.app |
| Production invitation return page | https://doorflow-thebob.netlify.app/auth/ |
| Production Supabase | `wdlgkwzowapzhurbbavf`, us-east-2 |
| Staging Supabase | `ktvmihmkdfvzmgubsqqc`, us-east-2 |
| Candidate branch | `release/phase-8-2c-disabled`, descended from verified staging commit `74d8a2722cc62720ec5d405107d665056fcf0109` |
| Preserved staging branch | `staging/phase-8-2b` at `74d8a2722cc62720ec5d405107d665056fcf0109` |
| Original local main | `0b6ec916e6b2adb2b4f489e16edf55034a4ef076` |
| GitHub main before release | `7144c3d6a19e81ac2b5df191958171242b4ea5e9` |
| Netlify site | `doorflow-thebob`, ID `111b2099-d324-49db-ade1-dbfc7c68233b` |
| Preserved Netlify production deploy | `6aab31ca54a624000820bd39`, main `7144c3d6...`, published 2026-09-17 |
| Preserved Vercel production deploy | `dpl_Dq52TQ1javVyq8xkPqLU1Je8UGqF`, main `7144c3d6...` |

Deploy only to Netlify. Do not push or merge main as a deployment shortcut: both hosting services track it. A direct upload of the candidate's built files to the existing Netlify site avoids a second Vercel production rollout. Staging and production must retain different origins and database projects.

## Reproducible database changes

Run these candidate migrations in order, after the preflight guard succeeds:

| File in `supabase/migrations/` | Purpose |
|---|---|
| `20260924220909_phase_8_2c_production_prerequisites.sql` | Read-only guard comparing the expected existing production schema; does not reconstruct or reseed production tables. |
| `20260924221018_phase_8_2c_staff_invitations.sql` | Tested invitation tables, server-only permissions, durable operation/audit procedures, and `auth.users.email::text` compatibility. |
| `20260924221024_phase_8_2c_single_venue_staff.sql` | Replace broad staff Admin policies with the tested current-profile, single-venue authorization rule. |
| `20260924221030_phase_8_2c_advisor_hardening.sql` | Narrow unnecessary execution/table privileges, add supporting indexes, and optimize own-profile identity lookup. |

The original staging database bootstrap is a test fixture, not a production migration. Production already has operational tables and real records. The guard compares seven operational tables, 64 columns, 23 constraints, 20 policies, 17 existing indexes, four triggers, and 11 helper definitions. It leaves the six existing organization/membership/subscription/branding/settings tables outside this release's schema changes.

Preserve nullable `staff_profiles.venue_id`, its existing Auth relationship, defaults and deletion behavior. NULL gives an Admin no staff-management authority. Preserve the independent own-profile read needed to initialize a session. Do not invent multi-venue authority from `venue_memberships`.

Never apply the old staging migration identifiers to an already initialized database without deliberately reconciling migration history. The hosted staging identifiers and source hashes are recorded in [the staging provenance document](PHASE_8_2B_HOSTED_EVIDENCE.md). Record the versions actually assigned to production when applying these candidate migrations.

## Preflight: inspect before changing

1. Record the exact final candidate SHA and confirm that its tracked files are clean. Check source parity, migration integrity, browser configuration, cache behavior, and the documented type-check exception. Any source change afterward invalidates the completed candidate smoke.
2. Inspect production metadata only: tables, columns, constraints, RLS policies, helper bodies/signatures/owners/grants, indexes, triggers, migration history, Realtime membership, and aggregate affected-table counts. Store sanitized snapshots and hashes outside Git; do not export business rows.
3. Compare that snapshot to the guard and candidate SQL. Stop on incompatible schema drift, a destructive operation, unexpected constraints, or any proposal requiring data deletion. The migration guard is a stop signal, not permission to change its expected values to make a mismatch disappear.
4. Record existing Edge Function versions, bundle identity, `verify_jwt`, application setting names, secret-key dictionary availability, and relevant Auth/SMTP/redirect/password settings. Preserve recoverable configuration securely; never put secret values in Git or reports. If the Function does not exist, record that absence.
5. Verify the current Netlify and Vercel deployment IDs still match their preserved checkpoints. Preserve Netlify rollback access before release. Verify the CLI can access the exact existing site; do not create or relink a different site.
6. Confirm the relevant production key is publishable and matches the production URL/ref. Browser variables are not permission to access privileged server keys.
7. Finish the advisor disposition and exact-candidate staging smoke below before applying production SQL.

Production activity may continue between aggregate snapshots. A count change is a reason to investigate its cause; it is not automatically evidence of data loss or of this release writing records.

## Security advisor disposition

The production inventory on 2026-09-24 reported six no-policy notices, 11 anonymous and 11 authenticated security-definer execution warnings, one leaked-password warning, six unindexed foreign keys, one Auth/RLS initialization-plan warning, ten unused indexes, four multiple-policy warnings, and one Auth connection-allocation notice. Re-run advisors after deployment; findings below describe intended treatment, not completed remediation.

| Finding | Disposition | Reason and verification |
|---|---|---|
| 11 helpers callable by `anon` or inherited PUBLIC execution | A — fix before production | Revoke unnecessary direct execution. Verify anonymous calls are denied and signed-in flows still work. |
| Four autofill trigger helpers callable directly by `authenticated` | A — fix before production | Remove direct browser execution; retain trigger operation and test ordinary inserts. |
| Seven authenticated identity/authorization helpers | B — accept with rationale | RLS needs current trusted identity/active-profile checks. Retain only required execution; inspect ownership, fixed search path and definitions. Removing them without a replacement would break authorization. |
| Six existing RLS-enabled tables with no browser policies | B — accept denial; C — defer their feature design | `organizations`, `organization_memberships`, `subscription_accounts`, `venue_branding`, `venue_memberships`, and `venue_settings` are existing unused/server-only structures in this release. Leave them unchanged; do not add public access to remove a notice. |
| Three new invitation tables with RLS and no browser policies | B — accept with rationale | Invitation records, operation attempts and audit evidence are server-only. Browser access remains denied; privileged server access stays narrowly controlled. |
| Six missing operational foreign-key indexes | A — fix before production | Add `check_in_logs_group_id_idx`, `check_in_logs_guest_id_idx`, `groups_service_day_id_idx`, `guests_added_by_user_id_idx`, `guests_group_id_idx`, and `shift_notes_created_by_user_id_idx`. Also index new `staff_invitation_attempts.venue_id`. |
| Own-profile Auth/RLS initialization-plan warning | A — fix before production | Use the tested `(select auth.uid())` predicate without changing who may see their own profile. |
| Broad operational table grants | A — fix before production | Restrict the seven in-scope tables to the CRUD operations tested in staging; do not weaken RLS or add browser access to invitation tables. |
| Unused indexes | C — defer removal | Small or lightly exercised databases do not prove that indexes are unnecessary. Retain them; collect workload evidence before removal. |
| Four multiple permissive-policy warnings | B — accept current behavior; C — defer redesign | Separate own/read and Admin policy paths are intentional. Verify their combined effective permissions, especially staff venue restrictions. Do not merge policies mechanically. |
| Auth connection allocation | C — defer sizing | Capacity tuning is separate from this permission/deployment change. |
| Leaked-password protection | A — enable during the gated production rollout | Enabled and tested in staging on 2026-09-24: ordinary Auth password update rejected a known compromised value with HTTP 422, `weak_password`, reason `pwned`; the prior strong password still logged in; a new strong password was accepted and logged in. The existing acceptance UI displayed the safe rejection and permitted retry in a local browser fixture. No email was sent. |

**Password-protection decision: include it in the gated production rollout.** Staging password, login, own-profile and venue-authorization checks passed with protection enabled; the leaked-password advisor warning cleared. Production remains unchanged until all release gates pass. Do not change reauthentication/current-password requirements or other password/email settings as an accidental side effect. The hosted password test used the ordinary authenticated Auth API; local browser evidence separately verified the password form's rejection/retry behavior. Supabase's raw REST errors use `error_code`, which the temporary verifier must distinguish from the SDK's normalized `code` field.

Official references reviewed for this plan: [database function permissions](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database advisors](https://supabase.com/docs/guides/database/database-linter), and [password security](https://supabase.com/docs/guides/auth/password-security). Consult current documentation/changelog before altering security settings. Advisor warnings are evidence to assess, not a score to make zero by weakening protection.

## Exact-candidate staging smoke

Keep staging provisioning false. Use only fictional staging users and the staging origin. No email, invitation creation, retry or resend belongs in this smoke.

Verify real login and own-profile initialization; same-venue Admin access; cross-venue and null-venue denial; non-admin denial; current deactivation/demotion/reassignment behavior as relevant; missing/malformed token denial; and a valid Admin receiving `503 provisioning_disabled`. Record invitation, operation, audit and provider-dispatch counts before and after; they must not increase because of the smoke.

Verify main and `/auth/` load the same validated staging config before client initialization. Missing, wrong-origin, mismatched or stale config must fail closed. Observe staging-only browser/API traffic and confirm the cache cannot restore a different environment. A page resource inventory has limits; do not present it as a complete packet capture.

The exact committed candidate must supply both the staged frontend and deployed Function source. Record source hashes, hosted deployment/function versions, current advisor results, and all pending subtests. Historical Phase 8.2B results support the design but do not substitute for this fresh candidate gate.

## Production settings and build

Production browser settings belong only to Netlify's **production** context and **builds** scope:

| Name | Reviewed production selection |
|---|---|
| `DOORFLOW_ENVIRONMENT` | `production` |
| `DOORFLOW_PUBLIC_SUPABASE_URL` | Exact URL for `wdlgkwzowapzhurbbavf` |
| `DOORFLOW_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Matching verified production publishable key; value omitted |
| `DOORFLOW_PUBLIC_SUPABASE_PROJECT_REF` | `wdlgkwzowapzhurbbavf` |
| `DOORFLOW_PUBLIC_ALLOWED_ORIGIN` | `https://doorflow-thebob.netlify.app` |

Use Node 22 or later; explicitly select Node 22 for hosted builds. Run `node scripts/build-public.mjs` in the clean candidate checkout with complete public configuration and a fresh output directory. The static runtime receives only the generated `/api/doorflow-public-config.json`. Publish only `dist/`. Keep generated values and release hash manifests outside Git. A missing variable must fail the build, not select a fallback.

Production Function settings are separate from browser variables:

| Name | Required production setting |
|---|---|
| `DOORFLOW_STAFF_PROVISIONING_ENABLED` | `false` |
| `DOORFLOW_ENVIRONMENT` | `production` (strict HTTPS mode) |
| `DOORFLOW_SUPABASE_PROJECT_REF` | `wdlgkwzowapzhurbbavf` |
| `DOORFLOW_SUPABASE_KEY_NAME` | Verified matching member of the production platform key dictionaries |
| `DOORFLOW_ALLOWED_ORIGINS` | Exact Netlify production origin |
| `DOORFLOW_INVITE_REDIRECT_URL` | Exact Netlify production origin plus `/auth/` |
| `DOORFLOW_INVITE_RESEND_COOLDOWN_SECONDS` | `300` |
| `DOORFLOW_INVITE_LEASE_SECONDS` | `120` |
| `DOORFLOW_INVITE_PROVIDER_TIMEOUT_MS` | `30000` |
| `DOORFLOW_ALLOW_LEGACY_SUPABASE_KEYS` | `false` |

Platform `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` must be internally consistent with production. Keep privileged material server-side. Preserve `verify_jwt=true`. Do not copy staging server keys or production SMTP credentials. Review existing Auth Site URL/redirect entries before an additive, exact production `/auth/` entry; do not discard needed existing redirects blindly.

The read-only production checkpoint found Auth Site URL `http://localhost:3000`, no redirect entries, no Edge Functions, and no custom Edge Function secrets. After the release gates pass, set Site URL to `https://doorflow-thebob.netlify.app` and add only `https://doorflow-thebob.netlify.app/auth/` as the invitation return URL. Keep existing signup, email confirmation, password reauthentication and security-notification settings unchanged. Production currently uses Supabase's built-in email service; this phase does not configure SMTP. A reviewed production email provider and recipient plan remains a separate enablement gate.

## Deployment order

1. Record the production checkpoint and rollback deployment; confirm the final candidate SHA, smoke and advisor decisions.
2. Preserve current Function state/settings and sanitized schema hashes/counts.
3. Run the catalog guard, then the three reviewed compatible change migrations in order. Record actual hosted migration versions. Preserve all business records; no seed data.
4. Verify schema/grants/RLS and run both advisors. Resolve unexpected in-scope regressions before continuing.
5. Set production Function configuration explicitly false, deploy candidate `staff-invitations` with `verify_jwt=true`, and verify its bundle identity, gateway denials and disabled configuration.
6. Apply only the reviewed production Auth/password decision. Do not enable invitations or send an email.
7. Configure Netlify production public variables, build the exact candidate, and record a file-hash manifest. Never reuse the staging-built output.
8. Upload that output to the existing Netlify site. A draft upload may be inspected first and the same deployment published afterward; an exact-origin production app intentionally refuses to run on the draft hostname.
9. Publish only after artifact/config checks pass. Record deployment ID, source SHA and deployed-file parity. A manually uploaded deployment can have no `commit_ref`; the clean checkout and byte/hash evidence must establish provenance.
10. Complete disabled production checks below. Recheck GitHub main and Vercel production remain unchanged, then stop.

The supported [Netlify CLI](https://cli.netlify.com/commands/deploy/) accepts an explicit site, prebuilt directory and `--no-build`. Use `--context production`; add `--prod` only at the planned production publish step. The connector's site-only build trigger cannot identify a local candidate artifact and is not the chosen transport. Do not use main push, a new site, or `--trigger` as an improvised fallback if CLI authentication is unavailable.

Existing open pages and service workers cannot be replaced retroactively by uploading files. Verify replacement on a designated safe browser, close old app windows for that verification, and avoid forcing activation during live door operations. Record any installed-device rollout follow-up instead of claiming all devices instantly updated.

The shared main branch still identifies the earlier release after a direct artifact upload. Any future main push can trigger both hosts; reconcile the Git release and hosting policy in a separately reviewed follow-up before the next main-based rollout. Do not mistake the manual Netlify release for a main merge.

## Disabled production verification

Use read-only checks and existing safely available sessions. Do not create production test accounts or change a real user's password.

- Production main and `/auth/` load safely; their configuration and observed API traffic use production Supabase only.
- Deployed source bytes match the final candidate's production build; no staging project ref appears in emitted production config or observed application requests.
- Missing/malformed Function credentials are denied. If an authorized existing Admin session is already safely available, its request returns `provisioning_disabled` and performs no invitation mutation. Otherwise record that subtest as pending.
- An existing safe login/session and ordinary app behavior remain functional where testing is possible; distinguish static checks from real authenticated checks.
- Approved staff RLS, helper/grant hardening, schema constraints, Function bundle/version and `verify_jwt=true` are verified.
- Invitation/attempt/audit counts and provider-email evidence show zero release-test mutation/send. Run security/performance advisors and explain retained findings.
- Final Function setting is explicitly false and live disabled behavior is checked when a safe session is available.
- Main and Vercel production remain at their preserved checkpoints.

## Rollback: separate the four layers

| Layer | Recovery action | Limit |
|---|---|---|
| Netlify frontend | Republish `6aab31ca54a624000820bd39` through the supported restore/publish workflow. Verify the live origin and preserved asset identity. | Restores that artifact only; does not undo SQL, Auth settings or Function deployment. The legacy artifact lacks the new runtime-config contract. |
| Edge Function | Keep provisioning false; restore the recorded previous bundle/settings if one existed. If newly introduced, leave the verified disabled endpoint or retire only that new endpoint after assessing dependent clients. | Never downgrade authorization merely to restore a green test. Preserve audit/operation data. |
| Configuration | Restore recorded prior Netlify public settings and explicitly reviewed Auth/Function settings if needed, keeping provisioning false. | Existing frontend artifacts keep their build-time configuration; settings edits alone do not rebuild them. |
| Database | Prefer a reviewed forward fix. Preserve new invitation/audit tables and production records; investigate any partial migration using its transaction/version evidence. | No promise of destructive database rollback. Do not drop tables, erase audit history, or restore broad cross-venue Admin policies as a shortcut. |

Stop the rollout on wrong project/origin, config mismatch, unexpected schema drift, unplanned data change, unsafe public privilege, missing rollback access, or uncertain deployment provenance. Keep both staging and production provisioning disabled.

## Release record and final boundary

The operator's release report must record final candidate SHA; exact migration filenames and hosted versions; function bundle hash/version; Netlify deployment ID and artifact hash parity; variable names/scopes; before/after aggregate and advisor evidence; password-protection decision; test results/limitations; and rollback points. Do not commit keys, passwords, sessions, generated runtime values, raw evidence, fixture users, or business data.

After all applicable disabled gates pass, the release may be described as a **disabled production deployment**. Production invitations require a separate controlled enablement decision, reviewed recipient/provider setup, and operational monitoring. This phase ends with production provisioning disabled and zero production invitation emails.
