# DoorFlow P6 Release Hardening

## Status

This document describes an uncommitted release candidate for owner review. P6.1 deterministic race validation passes without network access. The owner reports that the complete six-table Realtime publication configuration is now applied and supplied an initial post-restart round trip: phone-to-computer Check In in 3 seconds, computer-to-phone Undo in 3 seconds, no manual Refresh, and final approved test state restored to 0/2. This is positive initial evidence, not final acceptance. The release remains **BLOCKED** until the owner completes the read-only publication/flag verification, five-cycle and reconnect tests, the P6.5 mobile, scroll, print, and low-light gates, and the remainder of `P6_MANUAL_ACCEPTANCE_CHECKLIST.md`. Codex did not connect to Supabase or independently verify live database state. P6.6 does not deploy, merge, execute mutations, or prove live behavior.

## Scope

- Baseline commit: `1ce0f3c` (`Phase P5: redesign and refine Door Check-In and Tablet Door Mode`)
- Required branch: `codex/premium-editorial-ui-redesign`
- Runtime: inline JavaScript in `index.html`
- Mirror/reference: `app.js`
- Parent venue presentation: The B.O.B.
- Operating space presentation: EVE
- Guest-list scope presentation: Shared Guest List across The B.O.B. and EVE
- Physical entrance context: selected Door Location

The venue hierarchy remains presentation metadata. P6 does not change venue IDs, schema, queries, permissions, RLS, or door-location behavior.

## Protected behavior

P6.1 changes only its reviewed guest-action/load lifecycle functions. P6.5 additionally changes only reviewed presentation coordination and rendering functions plus scoped mobile and print CSS. Runtime/mirror parity and protected hashes cover all remaining operational functions, including authentication, permissions, queries, mutations, race protection, Realtime delivery, polling, reports, and exports. The P5 stylesheet prefix remains protected while the scoped P6.5 boundary contains the reviewed presentation refinements. Release smoke checks verify this boundary without printing function bodies.

Protected areas include authentication, session restoration, role routing, permissions, venue authority, loaders, search, filters, sorting, mutations, pending guards, duplicate prevention, optimistic updates, rollback, realtime, reports, closeout, CSV, print, and database action guards.

## P6.1 rapid check-in race hardening

The same-guest pending guard was already synchronous and prevented duplicate requests for one guest. The race involved two different guests: `activeDoorFlowAction` was a single boolean, so the first completed action could clear it while another guest action was still pending. A queued, realtime, or direct refresh could then replace `state.guests` with a database snapshot that predated the remaining write. The pending action retained a reference to the replaced guest object, so its eventual success no longer updated visible state and a count could move backward until another refresh.

P6.1 now derives the global action state from all pending guest check-in/Undo locks. Each live-data load carries a monotonically increasing load sequence, a guest-state version, and whether guest work was pending when the load started. A result is applied only when it is the newest load, no local guest transition occurred during the request, and no guest check action was pending at load start or completion. Rejected current loads schedule normal reconciliation after pending work settles. Check In and Undo advance the version before optimistic state changes and before error rollback, preserving the existing per-guest rollback path.

The fix does not change Supabase tables, queries, update payloads, log payloads, permissions, duplicate prevention, reports, exports, CSS, service-worker strategy, or manifest. `scripts/p6-checkin-race-smoke.mjs` executes the current application functions with delayed mocked writes and verifies same-guest double invocation, both two-guest response orders, realtime before and after mutation responses, duplicate realtime, rapid Undo, Check In followed by Undo, isolated failure, lock cleanup, and count monotonicity. It does not replace authenticated manual or two-device testing.

## P6.6 Realtime publication configuration

### Root cause and required inventory

DoorFlow subscribes to six public tables, but the existing `supabase_realtime` publication initially contained only `guests`, `groups`, `check_in_logs`, and `shift_notes`. The missing `service_days` and `staff_profiles` publication coverage was the configuration mismatch associated with absent delivered Postgres Changes events and cross-device updates generally arriving through recovery or fallback polling after 19–42 seconds.

The owner reports that `service_days` and `staff_profiles` were added. The complete required publication inventory is:

- `public.guests`
- `public.groups`
- `public.check_in_logs`
- `public.shift_notes`
- `public.service_days`
- `public.staff_profiles`

The owner-applied command, exact read-only verification queries, expected results, and separately authorized rollback are recorded in `P6_REALTIME_CONFIGURATION.md`.

### Owner-supplied initial evidence

After both sessions restarted:

- Phone-to-computer Check In arrived in 3 seconds.
- Computer-to-phone Undo arrived in 3 seconds.
- Neither direction required manual Refresh.
- The approved test records were restored and the group returned to 0/2 checked in.

### Remaining owner verification

Initial success does not replace final acceptance. The owner must still:

- Confirm the read-only publication inventory query returns exactly the six required rows.
- Confirm the publication event flags, including `pubupdate = true`.
- Complete five consecutive bidirectional Realtime cycles without manual Refresh.
- Complete disconnect/reconnect recovery and confirm Realtime resumes without manual Refresh.
- Complete the remaining mobile-header, scroll-preservation, print-pagination, low-light, and checklist gates.

## Pre-P6 PWA audit

The P5 baseline service worker used `doorflow-cache-v29` and pre-cached:

- `/`
- `/index.html`
- `/manifest.webmanifest`
- `/branding/bob-logo.png`
- `/branding/bob-logo-dark.png`
- `/branding/bob-icon-192.png`
- `/branding/bob-icon-512.png`
- `/branding/bob-icon-maskable-512.png`

The v29 worker called `skipWaiting()`, deleted every cache whose name did not equal the active cache, and did not reject non-GET or all cross-origin traffic before its fetch strategy. It used network-first behavior for navigation, HTML, JavaScript, and CSS, but did not pre-cache `doorflow-operational-theme.css`. These behaviors could activate an update during an open session, delete an unrelated origin cache, or apply shell caching too broadly.

Registration remains a load-time `navigator.serviceWorker.register("/sw.js")` call in `index.html`. There was no update notice or forced page reload.

The manifest was valid before P6 and remains unchanged:

- Name: `The B.O.B. DoorFlow`
- Short name: `DoorFlow`
- Start URL and scope: `/`
- Display: `standalone`
- Background: `#f5f6f8`
- Theme: `#111827`
- Icons: local 192, 512, and maskable 512 PNG files

## PWA strategy

P6 uses `doorflow-cache-v30` with a `doorflow-cache-` ownership prefix.

### Cached shell inventory

- `/`
- `/index.html`
- `/doorflow-operational-theme.css`
- `/manifest.webmanifest`
- `/branding/bob-logo.png`
- `/branding/bob-logo-dark.png`
- `/branding/bob-icon-192.png`
- `/branding/bob-icon-512.png`
- `/branding/bob-icon-maskable-512.png`

The maintained but unused `app.js` mirror is not pre-cached. Legacy `/icons/` paths are not pre-cached. Every v30 shell path must exist and return HTTP 200 before release.

### Request strategy

| Request | Strategy | Cached data |
| --- | --- | --- |
| Navigation, `/`, `/index.html` | Network first with `no-store`; cached `index.html` fallback on network failure | App shell only |
| Explicit same-origin shell assets | Cache first with background revalidation | Allowlisted local files only |
| Non-GET request | Service worker does not intercept | None |
| Cross-origin request | Service worker does not intercept | None |
| Same-origin `/rest/`, `/auth/`, `/realtime/`, `/api/` | Service worker does not intercept | None |
| Other same-origin assets | Browser/network owned | None through DoorFlow worker |

No Supabase query response, authentication response, realtime message, customer row, mutation, export, or operational data is cached.

### Cache cleanup

Activation deletes only cache names beginning with `doorflow-cache-` and not equal to `doorflow-cache-v30`. Unrelated origin caches are retained. The old v29 cache is removed only after v30 reaches normal activation.

### Update lifecycle

The v30 worker does not call `skipWaiting()` and does not reload any client. An installed update waits while an existing DoorFlow window is open. During a quiet window, operators explicitly close every DoorFlow tab and installed-app window, then reopen the app. This activates the waiting worker without replacing a running live-service session.

No in-app update prompt was added because it would expand runtime state and event handling. The manual update procedure is documented in the release runbook and acceptance checklist.

## Offline and reconnect expectations

- An app shell previously loaded online may render from the v30 cache when navigation fails.
- Offline shell availability does not mean login or operational data is available.
- Login requires the live authentication service and should fail visibly while offline.
- Check-in and Undo require live database access; existing guards and rollback behavior must prevent permanent false success.
- No offline mutation queue or background sync exists.
- Cached visible content may be stale until live loaders and realtime recovery complete.
- After reconnect, the operator should use the existing refresh/recovery flow and verify counts against database-authoritative state.
- Manual failed-write and reconnect tests are mandatory because static checks cannot prove these outcomes.

## Performance findings

- No new framework, dependency, remote font, image, analytics, timer, polling loop, or runtime event listener is added.
- P6.1 changes only guest-action/load reconciliation; P6.5 adds reviewed presentation coordination, rendering, mobile CSS, print CSS, and scroll-position restoration without adding timers, polling, or data behavior.
- No animation is added; existing reduced-motion treatment remains intact.
- The service worker uses a fixed nine-file allowlist and does not scan or cache runtime data.
- Large local branding PNGs remain required PWA assets. They are unchanged; image recompression is deferred because visual and install-icon review is an owner gate.
- `index.html` duplicates the runtime maintained in `app.js`. P6 does not rewrite that established architecture.
- No CSS was removed. Earlier phase styles remain because lack of use was not established safely without browser/manual coverage.
- Final byte sizes are reported by `scripts/p6-release-smoke.mjs` and in the P6 handoff report.

## Responsive matrix

Manual acceptance must cover:

- Desktop: 1920x1080, 1574-style browser window, 1440x900, 1366x768, 1280x800, 1180x800, 1024x768, 900x768
- Tablet: 1366x1024, 1180x820, 1024x768, 834x1194, 820x1180, 768x1024
- Phone: 430x932, 390x844, 375x812, 360x800, 320x568, 844x390, 667x375
- Zoom: 125%, 150%, 200%
- Modes: reduced motion, short height, keyboard only, touch first

Required observations are no page-level horizontal scroll, overlap, clipped names, one-character columns, hidden actions, inaccessible drawers/modals, utility-bar collisions, Staff clipping, Door roster/group collisions, report-modal page scroll, or cross-theme leakage.

## Accessibility matrix

Static source checks preserve the skip link, page-level headings, navigation labels, `aria-current`, form/search labels, modal names, Escape/focus helpers, focus-visible styling, text-backed statuses, disabled controls, logical DOM order, touch targets, and reduced-motion rules.

Manual checks remain required for:

- One perceptible page-level H1 in each role/view
- Logical heading announcements
- Drawer and modal focus containment/restoration
- Keyboard reachability and visible focus
- Validation relationships and error announcements
- No duplicate live-region announcement
- Text-backed status comprehension without color
- Touch target usability on real hardware

## Role matrix

Authorization remains logic-driven and byte-identical to the P5 baseline.

| Role | Required manual coverage |
| --- | --- |
| Admin | Door Check-In, Tablet Door Mode, Management, Staff, Reports, authorized writes |
| Manager | Door Check-In, Tablet Door Mode, Management, Reports, Shift Notes; no Staff administration |
| Door | Authorized Door views and applicable read-only notes; no Management, Staff, or admin-only controls |
| Viewer | Reports only where currently authorized; no Door Mode or write actions |

## Controlled operational test plans

Use designated non-production records only. Do not test during active service.

- Failed writes: take the browser offline immediately before one Check In and one Undo, verify rollback/error state, reconnect, refresh/recover, compare authoritative counts, and confirm no duplicate log.
- Rapid actions: check in two distinct guests back-to-back, repeat same-guest Check In/Undo taps, attempt Check In then Undo, verify exact log counts, exercise two-operator contention, rotate, and refresh during pending state.
- Realtime: verify the six-row publication inventory and `pubupdate`, then use two approved devices/profiles on one test service day for five consecutive bidirectional Check In/Undo cycles without manual Refresh; compare guest, group, and day counts after every cycle, exercise one permitted group action, and test disconnect/reconnect recovery.
- Low light: use the real tablet around 25% brightness in portrait and landscape; verify names, counts, blue/green/amber/red states, muted text, action visibility, and one-hand touch use.
- PWA: test fresh install, waiting-worker update, stale-cache replacement, offline shell, reconnect, manifest identity, icons, theme, and start URL.

Exact checkbox procedures are in `P6_MANUAL_ACCEPTANCE_CHECKLIST.md`.

## Remaining risks

- Authenticated role behavior, database writes, offline rollback, PWA install/update, responsive layouts, zoom, and low-light usability are not proven by static validation.
- The owner-reported initial post-configuration round trip succeeded in both directions in 3 seconds without manual Refresh, but publication metadata, five-cycle consistency, reconnect recovery, and broader authenticated two-device behavior remain owner acceptance gates and are not proven by static validation.
- Deterministic mocked timing covers the identified local race, but browser scheduling, live Supabase latency, and two-device realtime reconciliation remain manual release gates.
- A waiting service worker requires all controlled DoorFlow windows to close before activation; an overlooked tab can retain v29 until closed.
- Cached shell markup can be visible offline while operational data is unavailable or stale.
- Branding PNG size affects first install/cache transfer but was not changed in P6.
- The inline-runtime/mirror architecture requires future changes to remain synchronized.
- The B.O.B./EVE hierarchy is still presentation configuration rather than separate database fields.

## Release acceptance criteria

Owner acceptance requires all of the following:

- P3, P4, P5, and P6 smoke checks pass.
- `app.js`, inline runtime, and `sw.js` syntax checks pass.
- Manifest JSON and icon files validate.
- All v30 shell assets return HTTP 200.
- Protected hashes and runtime/mirror parity pass.
- SQL, RLS, migrations, and policy snapshots remain unchanged; runtime changes stay within the reviewed P6.1 lifecycle and P6.5 presentation boundary.
- The Realtime publication read-only inventory returns all six required public tables and the required publication event flags, including `pubupdate`, are enabled.
- Five consecutive bidirectional Realtime cycles and disconnect/reconnect recovery pass without manual Refresh.
- The complete manual acceptance checklist passes with approved accounts, devices, and non-production records.
- A quiet release window, current backup confirmation, release communication, and rollback owner are assigned.
- Any failure in check-in, Undo, duplicate prevention, permissions, realtime, reports, exports, or rollback blocks release.
