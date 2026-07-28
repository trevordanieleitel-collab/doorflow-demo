# DoorFlow P6 Realtime Configuration

## Evidence boundary

This document records the Realtime configuration and post-change observations supplied by the DoorFlow owner. During P6.6, Codex did not connect to Supabase, run SQL, change the publication, inspect live metadata, or independently verify production state. Static source checks can confirm only that DoorFlow subscribes to the same six tables documented here.

Do not place credentials, tokens, project URLs, UUIDs, or customer information in release evidence.

## Original symptom

Before the configuration correction:

- Cross-device updates generally took 19–42 seconds.
- Reconnect recovery completed quickly.
- The Supabase Postgres Changes report showed no delivered events.

This pattern was consistent with recovery or fallback refreshes eventually reconciling state while publication events were not being delivered.

## Original configuration mismatch

DoorFlow subscribes to six tables in the `public` schema. The existing `supabase_realtime` publication initially contained only four:

- `public.guests`
- `public.groups`
- `public.check_in_logs`
- `public.shift_notes`

The application also subscribed to `public.service_days` and `public.staff_profiles`, but those two tables were missing from the publication. The source subscriptions and publication inventory therefore did not match.

## Owner-applied configuration change

The owner reports applying this approved publication change:

```sql
alter publication supabase_realtime
add table
  public.service_days,
  public.staff_profiles;
```

This command is documented as evidence only. It was not executed during P6.6.

## Complete required publication inventory

The complete required inventory is exactly:

- `public.guests`
- `public.groups`
- `public.check_in_logs`
- `public.shift_notes`
- `public.service_days`
- `public.staff_profiles`

DoorFlow source must subscribe to this same inventory, and the live `supabase_realtime` publication must contain each row exactly once.

## Read-only publication verification

An authorized owner must run this read-only query in the approved Supabase administration context:

```sql
select
  pubname,
  schemaname,
  tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in (
    'guests',
    'groups',
    'check_in_logs',
    'shift_notes',
    'service_days',
    'staff_profiles'
  )
order by tablename;
```

The expected result is exactly six distinct rows, all with `pubname = 'supabase_realtime'` and `schemaname = 'public'`, one for each required table. A missing row, duplicate result, unexpected schema, or unexpected publication name blocks release. Record only sanitized evidence.

Static validation cannot verify the live publication state or prove that this query returns six rows.

## Publication event flags

An authorized owner must also run this read-only query:

```sql
select
  pubname,
  pubinsert,
  pubupdate,
  pubdelete,
  pubtruncate
from pg_publication
where pubname = 'supabase_realtime';
```

Expect exactly one `supabase_realtime` row. Record all event flags and confirm at minimum that `pubupdate = true`, because Check In and Undo update guest state. Any flag needed by the accepted DoorFlow Realtime operations must be enabled; a missing required flag blocks release.

The owner confirmed that the existing grants and `SELECT` policies were already in place. P6.6 did not change grants, policies, RLS, schema, or application data and did not independently query those controls.

## Owner-supplied post-change evidence

After `public.service_days` and `public.staff_profiles` were added and both sessions were restarted, the owner reported:

| Direction and action | Observed delivery |
| --- | --- |
| Device A phone to Device B computer — Check In | 3 seconds |
| Device B computer to Device A phone — Undo | 3 seconds |

- No manual Refresh was required in either direction.
- The approved test records were restored to Not Arrived.
- The approved test group finished at 0/2 checked in.

This is positive initial evidence. It does not replace the required metadata capture, five-cycle test, reconnect test, or final owner acceptance.

## Release verification procedure

Use only approved non-production accounts and records, outside active service:

1. Record the candidate commit, tester, devices, browsers, and time without including secrets or record identifiers.
2. Run the read-only publication inventory query and confirm exactly the six required rows.
3. Run the read-only publication event-flags query and confirm `pubupdate = true` plus every flag required by the accepted operations.
4. Confirm the existing grants and `SELECT` policies remain in place; do not change them as part of the UI/PWA release.
5. Close and restart both test sessions so each creates a current Realtime subscription.
6. Open the same approved test service day on two isolated devices or profiles.
7. Complete five consecutive bidirectional Check In/Undo cycles. Confirm both devices settle without manual Refresh and guest, group, and day counts agree after every cycle.
8. Disconnect one device, perform an approved update on the other, reconnect, and confirm Realtime resumes and both devices reach authoritative state without manual Refresh.
9. Confirm no duplicate log, false success, stale selected-group state, or unexpected scroll movement occurred.
10. Restore every approved test guest to Not Arrived and the approved test group to its starting 0/2 state.
11. Attach sanitized query and timing evidence to the release record and complete `P6_MANUAL_ACCEPTANCE_CHECKLIST.md`.

## Realtime publication-only rollback

This is separate from the UI/PWA rollback. Use it only when the release owner has verified that publishing `public.service_days` and `public.staff_profiles` causes a Realtime regression and has separately authorized the publication change.

An authorized database owner may run:

```sql
alter publication supabase_realtime
drop table
  public.service_days,
  public.staff_profiles;
```

This command:

- Does not delete either table or any row.
- Does not change RLS, policies, grants, auth users, schema, or application data.
- Stops future Realtime publication events for `service_days` and `staff_profiles`.
- Leaves `guests`, `groups`, `check_in_logs`, and `shift_notes` published.
- Must not be used without a verified Realtime regression and explicit owner authorization.

After an authorized rollback, repeat the read-only inventory query. The filtered result should contain the four remaining published tables. Record authorization, the sanitized command result, metadata verification, and operational outcome. If the regression remains, stop and open a separate database incident rather than broadening the rollback.

## Static-validation limitation

P6.6 static checks verify documentation completeness, the six-table source subscription inventory, runtime/mirror synchronization, and protected-function hashes. They cannot verify the live Supabase publication, publication flags, grants, policies, delivered Postgres Changes events, observed latency, reconnect behavior, or authenticated cross-device acceptance.
