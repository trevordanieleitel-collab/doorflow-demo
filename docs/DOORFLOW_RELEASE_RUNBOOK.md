# DoorFlow Release Runbook

## Purpose

This runbook controls the P6 premium editorial UI release. It contains no deployment credentials or provider-specific commands. The release owner must fill in the approved hosting procedure before execution.

## Required baseline

- Candidate branch: `codex/premium-editorial-ui-redesign`
- Candidate baseline: `1ce0f3c`
- Candidate cache: `doorflow-cache-v30`
- Previous cache: `doorflow-cache-v29`
- Known-good UI baseline: `1ce0f3c`

## Pre-release checks

1. Confirm the owner has approved `P6_MANUAL_ACCEPTANCE_CHECKLIST.md`.
2. Confirm all findings are resolved or explicitly accepted in writing.
3. Confirm the candidate branch contains only reviewed P6 files.
4. Confirm the candidate commit ID and record it in the release ticket.
5. Confirm the target branch and hosting target with the release owner.
6. Confirm no SQL, RLS, migration, policy, auth-user, venue-ID, or customer-data change is part of the release.
7. Confirm a rollback owner and communications owner are available.
8. Confirm an authorized owner completed the read-only Realtime publication verification in `P6_REALTIME_CONFIGURATION.md`. The filtered inventory query must return exactly six distinct rows in `supabase_realtime`, all in schema `public`: `guests`, `groups`, `check_in_logs`, `shift_notes`, `service_days`, and `staff_profiles`. Confirm the publication event flags include `pubupdate = true`, record sanitized evidence, and stop the release if any required row or flag is missing. Static smoke checks and matching source subscriptions do not prove the live publication state. This is a verification gate only; do not alter the publication during the UI/PWA release procedure.

Run read-only Git checks:

```powershell
git branch --show-current
git status --short
git log -5 --oneline
git branch -vv
git rev-list --left-right --count origin/codex/premium-editorial-ui-redesign...HEAD
```

Stop if the branch, commit, synchronization, reviewed-file inventory, or worktree state differs from the approved candidate.

## Required smoke commands

Run from `C:\Users\TrevorEitel\Documents\DoorFlow`:

```powershell
node --check app.js
node --check sw.js
node scripts\p3-shell-smoke.mjs
node scripts\p4-admin-smoke.mjs
node scripts\p5-door-smoke.mjs
node scripts\p6-release-smoke.mjs
git diff --check
```

Also parse the inline runtime without executing it, parse `manifest.webmanifest` as JSON, verify balanced CSS braces, and verify HTTP 200 for every PWA shell asset and the reports prototype.

Any failed check blocks release.

## Required manual tests

Complete every applicable item in `P6_MANUAL_ACCEPTANCE_CHECKLIST.md`, including:

- Admin, Manager, Door, and Viewer authorization
- Check In, Undo, pending guards, and duplicate prevention
- Failed writes, rapid actions, and two-device realtime
- Reports, closeout preview/print/PDF, and CSV
- Management, Staff, and Shift Notes
- Desktop, tablet, phone, zoom, keyboard, touch, and reduced motion
- Low-light tablet review
- PWA fresh install, waiting update, offline shell, and reconnect
- Rollback rehearsal or documented dry run

Use approved non-production accounts, service days, guests, and groups. Never test against active guest records.

## Quiet window

Release only outside active door operations. The window must allow enough time to:

- Confirm operators are logged out or safely stopped.
- Close all DoorFlow tabs and installed-app windows when instructed.
- Deploy the reviewed static candidate.
- Activate and verify `doorflow-cache-v30`.
- Run post-deployment read and controlled-write checks.
- Roll back before service begins if any stop condition occurs.

Do not force-refresh an active session.

## Backup requirement

Before release, confirm the existing managed database backup or point-in-time recovery coverage is current according to the approved Supabase operating procedure. P6 does not change application data or schema, so do not create an ad hoc customer-data export or run mutating SQL as part of this UI release. The separately documented, owner-run read-only publication verification is a release gate, not an application change.

Record:

- Backup/PITR confirmation time: `[fill in]`
- Person confirming coverage: `[fill in]`
- Recovery reference, without credentials: `[fill in]`

## Merge procedure

The owner must define and approve the repository merge method. At minimum:

1. Record the accepted P6 candidate commit.
2. Re-run all smoke checks against that exact commit.
3. Confirm the target branch has not diverged unexpectedly.
4. Review the final diff and confirm no SQL/RLS or secret file is present.
5. Merge using the repository's approved protected-branch process.
6. Record the resulting release commit.

Do not use `reset`, force push, or history rewriting.

## Deployment procedure placeholder

Hosting provider: `[owner to fill in]`

Approved deploy command or console procedure: `[owner to fill in]`

Approved rollback command or console procedure: `[owner to fill in]`

Required deployment evidence: `[owner to fill in]`

Deploy the exact reviewed release commit. Do not make console edits to built/static files after review.

## PWA cache verification

1. Before deployment, record the active cache name on a designated test device.
2. Deploy the candidate at the same approved origin.
3. Refresh normally and confirm a new worker is detected without an automatic reload.
4. Confirm the current open session remains stable.
5. During the quiet window, close every DoorFlow browser tab and installed-app window.
6. Reopen DoorFlow and verify `doorflow-cache-v30` is active.
7. Confirm `doorflow-cache-v29` is removed.
8. Confirm unrelated origin caches, if any, remain.
9. Confirm the v30 cache contains only the documented shell inventory.
10. Confirm `/doorflow-operational-theme.css` is present and legacy `/icons/` paths are absent.
11. Confirm no Supabase, auth, realtime, API, mutation, customer-data, report-export, or operational response is cached.

## Post-deployment verification

1. Verify HTTP 200 and content types for `/`, `/index.html`, the stylesheet, `sw.js`, manifest, all manifest icons, all shell branding assets, and the reports prototype.
2. Verify the installed app name, icon, theme, start URL, and scope.
3. Sign in with approved Admin, Manager, Door, and Viewer test accounts.
4. Verify role-visible navigation and absence of unauthorized controls.
5. Use a designated test guest to verify one Check In, one Undo, and one recheck.
6. Confirm counts and logs are authoritative and no duplicate log exists.
7. Verify two-device realtime and reconnect.
8. Verify Management, Staff, Shift Notes, Reports, print/PDF, and CSV with approved test data.
9. Verify the highest-risk responsive and low-light hardware cases.
10. Record evidence and release owner sign-off.

## Stop conditions

Stop deployment or begin rollback if any of these occur:

- Login, session restoration, or role routing fails.
- Unauthorized data or actions become visible.
- Check In or Undo is slow, duplicates, lies about success, or fails to roll back.
- Counts, logs, reports, closeout, print, or CSV disagree with authoritative data.
- Realtime fails to recover or devices remain inconsistent.
- The service worker caches operational/API data, activates unexpectedly, or serves stale UI after the approved activation procedure.
- Required shell assets or icons return non-200 responses.
- The layout hides actions or becomes unusable on an approved device.
- Any SQL/RLS, credential, production-data, or unrelated-project change appears.

## Communication checklist

- [ ] Release owner assigned
- [ ] Rollback owner assigned
- [ ] Door/operations lead notified of quiet window
- [ ] Test-account and test-record owners confirmed
- [ ] Start message sent
- [ ] Cache activation instruction sent
- [ ] Verification status shared
- [ ] Release success or rollback decision recorded
- [ ] Incident channel and escalation path confirmed
- [ ] Final release commit and evidence links recorded
