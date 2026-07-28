# DoorFlow Rollback Runbook

## Purpose

This runbook rolls back the P6 UI/PWA release without changing application data, SQL schema, RLS, auth users, venue IDs, or customer rows. The optional Realtime publication-only rollback below is a separate, owner-authorized configuration procedure; it is not part of the UI/PWA rollback.

## Rollback triggers

Begin rollback when the release owner confirms any of the following:

- Authentication, role routing, venue isolation, or permissions regress.
- Check In, Undo, pending guards, duplicate prevention, rollback, or realtime becomes unreliable.
- Counts, reports, closeout, print, or CSV are incorrect.
- Required controls are hidden, clipped, or inaccessible on an approved device.
- The service worker activates during active service, serves stale UI after controlled activation, caches operational traffic, or breaks offline/reconnect expectations.
- Required release assets fail to load.
- The release diff contains an unapproved SQL/RLS, credential, production-data, or unrelated change.

Choose the rollback path supported by evidence. A verified UI/PWA regression authorizes only the UI/PWA rollback. A verified Realtime publication regression uses the separate publication-only procedure below. Do not run both automatically.

## Previous known-good commit

The pre-P6 known-good UI commit is:

```text
1ce0f3c Phase P5: redesign and refine Door Check-In and Tablet Door Mode
```

Record the deployed P6 release commit separately. Do not assume the current branch tip is the deployed commit.

## Identify the release commit

1. Read the hosting/deployment record.
2. Compare it with the repository release tag or accepted commit.
3. Confirm the deployed `sw.js` uses `doorflow-cache-v30`.
4. Record the release commit, deployment time, reporter, and symptoms.
5. Stop normal release activity while rollback is coordinated.

## Realtime publication-only rollback

This procedure is separate from the UI/PWA rollback. Do not perform it automatically with a UI/PWA rollback. Use it only when the release owner has verified that publishing `public.service_days` and `public.staff_profiles` causes a Realtime regression and has separately authorized the publication change.

An authorized database owner may run only:

```sql
alter publication supabase_realtime
drop table
  public.service_days,
  public.staff_profiles;
```

This command does not delete either table or any row. It does not change RLS, policies, grants, auth users, application data, schema, or UI/PWA assets. It stops future Realtime publication events for `service_days` and `staff_profiles`; `guests`, `groups`, `check_in_logs`, and `shift_notes` remain published.

After execution, use the read-only inventory verification in `P6_REALTIME_CONFIGURATION.md`; the six-table filtered query should then return the four remaining published table rows. Record the authorization, sanitized command result, verification evidence, and operational result. If the verified regression is not resolved, stop and open a separate database incident. Do not broaden this procedure into a schema, RLS, policy, grant, auth, data, backup, or UI/PWA rollback.

## Revert the UI release

Use the repository's approved non-destructive revert workflow after owner approval:

1. Create a new rollback commit that reverses the accepted P6 release commit.
2. Do not reset, force push, rewrite history, or delete unrelated work.
3. Review the rollback diff against `1ce0f3c`.
4. Confirm application runtime and styling match the known-good UI.
5. Re-run P3, P4, P5, and release safety smoke checks adapted to the rollback candidate.
6. Deploy the rollback commit through the approved hosting procedure.

The exact Git/hosting commands must be filled in and approved by the repository owner before release.

## Restore previous service-worker cache behavior

Preferred rollback behavior is to restore the P5 UI while retaining P6's request exclusions and non-disruptive lifecycle. Publish the rollback shell under a new deterministic DoorFlow cache version such as `doorflow-cache-v31-rollback`. This ensures clients receive known-good assets without reintroducing v29's `skipWaiting()` or global cache deletion.

Do not simply redeploy the historic v29 worker without review. It forces activation and deletes unrelated origin caches. If exact historic worker behavior is required for incident recovery, the release owner must explicitly accept those risks and test it during a quiet window.

For the preferred rollback worker:

- Keep same-origin GET-only handling.
- Keep non-GET, cross-origin, Supabase, auth, realtime, and API exclusions.
- Pre-cache the known-good P5 shell and stylesheet.
- Delete only old `doorflow-cache-` versions.
- Do not call `skipWaiting()` or reload clients.
- Close all DoorFlow windows before activating the rollback worker.

## Verify rollback

1. Confirm the deployed UI matches commit `1ce0f3c` plus only the reviewed rollback-worker safety changes.
2. Confirm the rollback cache version is active and v30 is removed.
3. Confirm unrelated caches remain.
4. Confirm every shell asset returns HTTP 200.
5. Confirm the app starts at `/` with the approved identity and icons.
6. Confirm no operational/API response exists in Cache Storage.
7. Sign in with each approved test role and verify role boundaries.
8. Verify responsive navigation, Door Check-In, Tablet Door Mode, Management, Staff, Reports, and Shift Notes.
9. Verify print/PDF and CSV with designated test data.
10. Record evidence and owner decision.

## Test Check In and Undo after rollback

Use one approved non-production guest:

1. Record starting guest and group counts.
2. Click Check In once and verify pending state, final count, and one log.
3. Refresh and verify persistence.
4. Click Undo once and verify final count.
5. Refresh and verify persistence.
6. Recheck once and verify no duplicate guest/group record.
7. Confirm a second approved device receives the authoritative state.
8. Stop if any count, log, pending state, or realtime result is inconsistent.

## No application-data, schema, or RLS rollback

The UI/PWA rollback does not authorize SQL. Do not restore a database backup, change schema or RLS, alter auth users, delete customer rows, or reverse application data as part of it. The separately labeled Realtime publication-only procedure is not authorization for any other SQL or database change.

If an independent database incident exists, open a separate database incident and use its approved recovery runbook. Do not combine it with the UI rollback.

## Communication checklist

- [ ] Incident and rollback owners assigned
- [ ] Door/operations lead notified
- [ ] Active operators told to pause at a safe point
- [ ] P6 release commit recorded
- [ ] Rollback commit recorded
- [ ] Quiet window confirmed
- [ ] Cache close/reopen instruction sent
- [ ] Post-rollback role and mutation checks completed
- [ ] Final status sent to stakeholders
- [ ] Follow-up investigation owner assigned

## Incident notes template

```text
Incident ID:
Detected at:
Reported by:
Release commit:
Affected role/device/view:
Observed behavior:
Expected behavior:
Operational impact:
Rollback authorized by:
Rollback commit:
Rollback cache version:
Deployment completed at:
Check In verification:
Undo verification:
Realtime verification:
Role verification:
Remaining risk:
Follow-up owner:
```
