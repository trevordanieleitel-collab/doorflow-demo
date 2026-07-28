# DoorFlow P6 Manual Acceptance Checklist

## Test controls

- [ ] Testing occurs outside active service.
- [ ] Only approved non-production accounts, service days, guests, and groups are used.
- [ ] No production customer record is changed or exported.
- [ ] Two approved devices or isolated browser profiles are available for realtime testing.
- [ ] The candidate commit, origin, device/browser versions, and tester are recorded.
- [ ] Evidence contains no credentials, tokens, or customer data.

## P6.6 owner-supplied evidence

Checked items in this section record owner-observed initial evidence only. They do not complete the remaining database-metadata, five-cycle, reconnect, mobile, scroll, print, low-light, or final-owner gates.

- [x] The owner reports that all six required public tables are enabled in the existing `supabase_realtime` publication.
- [x] The owner confirms the existing grants and `SELECT` policies were already in place; P6.6 made no change to either.
- [x] After both sessions restarted, phone-to-computer Check In arrived in 3 seconds without manual Refresh.
- [x] Computer-to-phone Undo arrived in 3 seconds without manual Refresh.
- [x] Approved test records were restored to Not Arrived and the test group returned to 0/2 checked in.

## Roles

### Admin

- [ ] Door Check-In is visible and usable.
- [ ] Tablet Door Mode is visible and usable.
- [ ] Management is visible and authorized actions work on test records.
- [ ] Staff is visible and authorized test-profile actions work.
- [ ] Reports and closeout controls are visible.
- [ ] No unauthorized cross-venue data is visible.

### Manager

- [ ] Door Check-In and Tablet Door Mode are visible.
- [ ] Management, Reports, and Shift Notes match current permissions.
- [ ] Staff administration is not available.
- [ ] Admin-only controls are not available.
- [ ] No unauthorized cross-venue data is visible.

### Door

- [ ] Only currently authorized Door views are visible.
- [ ] Notes are read-only where current permissions require it.
- [ ] Management, Staff, reports/admin-only controls, and unauthorized writes are absent.
- [ ] Authorization remains functional when CSS is disabled or altered in DevTools.

### Viewer

- [ ] Reports are available only where currently authorized.
- [ ] Door Mode and write actions are absent.
- [ ] Management and Staff are absent.

## Reports

- [ ] Service-day counts match approved test data.
- [ ] Attendance breakdown, activity, guest status, late adds, no-shows, and notes remain correct.
- [ ] The B.O.B. and EVE shared-list context is clear.
- [ ] The report modal opens, is named, traps focus, closes with Escape, and restores focus.
- [ ] Long tables scroll inside their region without creating a page-wide scrollbar.
- [ ] Closeout preview calculations match the pre-release baseline.

## Management

- [ ] Guest and group lists load with current search, filter, sort, and selection behavior.
- [ ] Create, edit, and delete controls follow current role permissions.
- [ ] Duplicate warnings remain visible and accurate.
- [ ] Late-add approval and metadata remain available where expected.
- [ ] Selected-group counts and party host behavior remain correct.
- [ ] Mobile management drafts and validation remain intact.

## Staff

- [ ] Staff list loads for Admin.
- [ ] Names, roles, statuses, dates, and actions are fully readable.
- [ ] Desktop rows remain readable and narrow records reflow without clipping.
- [ ] A harmless `full_name` edit on a designated test account saves and can be reversed.
- [ ] No active administrator is deactivated and no live role is changed during first release validation.
- [ ] Manager, Door, and Viewer accounts cannot access Staff administration.

## Shift Notes

- [ ] Notes load for the selected service day.
- [ ] Authorized create, edit, and delete actions work on a test note.
- [ ] Door/read-only presentation matches current permissions.
- [ ] Priority and category remain text-backed and understandable without color.
- [ ] No note is duplicated after refresh or realtime recovery.

## Door Check-In

- [ ] Parent venue The B.O.B., operating space EVE, shared list, and physical door are distinct.
- [ ] At phone widths, the utility header reflows into non-overlapping identity, Day/Service Date, and actual status/Refresh rows with no clipping, horizontal scrolling, or false Live state.
- [ ] Guest search, filters, sorting, list selection, group browser, and selected-group state work.
- [ ] Names wrap normally and arrival counts remain aligned.
- [ ] Late Add and Needs Approval states remain readable.
- [ ] Groups, complete groups, total allowed, checked in, and remaining totals agree.
- [ ] No Door theme leaks into Management, Staff, Reports, or Shift Notes.

## Tablet Door Mode

- [ ] The B.O.B./EVE context, shared list, service date, and physical door are distinct.
- [ ] Search, list, filter, sort, cards, and summary counts work in portrait and landscape.
- [ ] Guest cards remain dense but readable at approved tablet and phone sizes.
- [ ] Check In and Undo actions remain reachable and at least 44px on narrow phones.
- [ ] Rotation preserves authoritative state and does not hide pending/error controls.
- [ ] No administrative theme leaks into Tablet Door Mode.

## Check-in

- [ ] Record the starting guest, group, and day counts for a designated guest.
- [ ] Click Check In once.
- [ ] Only that guest shows a pending/Saving state.
- [ ] Repeated clicks are blocked while pending.
- [ ] The UI updates after one successful write without requiring Undo/recheck.
- [ ] Counts update consistently in the row, selected group, group card, and summary.
- [ ] Refresh confirms the database-authoritative state.
- [ ] Exactly one expected check-in log exists.
- [ ] On phone and tablet, the acted-on guest remains at approximately the same viewport position after Check In, with the updated Undo control visible and keyboard focus logical where applicable.

## Undo

- [ ] Click Undo once on the designated checked-in guest.
- [ ] Only that guest shows a pending/Saving state.
- [ ] Repeated Undo clicks are blocked while pending.
- [ ] Counts update consistently without repeated clicks.
- [ ] Refresh confirms the database-authoritative state.
- [ ] Recheck once and confirm no guest or group duplicate is created.
- [ ] On phone and tablet, the acted-on guest remains at approximately the same viewport position after Undo, with the updated Check In control visible and keyboard focus logical where applicable.

## Duplicate prevention

- [ ] Add a duplicate test name and verify the current warning/confirmation flow.
- [ ] Cancel and confirm no record is created.
- [ ] Use the approved confirmation path and confirm only the intended record is created.
- [ ] Repeated rapid submission does not create duplicate records.
- [ ] Check-in rapid actions do not create duplicate logs.

## Realtime

- [ ] Run the approved read-only publication inventory verification and confirm exactly one `public` row for each of `guests`, `groups`, `check_in_logs`, `shift_notes`, `service_days`, and `staff_profiles`.
- [ ] Confirm the `supabase_realtime` publication event flags are correct, including `pubupdate = true`.
- [ ] Complete five consecutive bidirectional Check In/Undo cycles; both devices settle without manual Refresh and guest, group, and day counts agree after every cycle.
- [ ] Device A and Device B open the same test service day.
- [ ] Device A checks in one guest.
- [ ] Device B receives the update without a manual record edit.
- [ ] Guest, group, and day counts agree.
- [ ] Device B undoes the guest.
- [ ] Device A receives the update and counts agree.
- [ ] One permitted party/group action synchronizes correctly.
- [ ] Selected-group state does not remain stale.
- [ ] Temporarily disconnect Device B, reconnect it, and confirm Realtime resumes and both devices reach authoritative state without manual Refresh.
- [ ] A remote update for another guest does not move the receiving operator away from the current roster position.
- [ ] Manual Refresh preserves the working roster position where the current guest or list still exists.
- [ ] No duplicate log or false success exists on either device.

## Failed writes

- [ ] Use Chrome DevTools Network Offline immediately before one test Check In.
- [ ] Attempt the Check In once.
- [ ] Confirm the app does not permanently display false success.
- [ ] Confirm the existing visible error and optimistic rollback behavior.
- [ ] Restore network and invoke normal refresh/recovery.
- [ ] Confirm guest, group, and day counts match authoritative state.
- [ ] Confirm no check-in log was created for the failed write.
- [ ] Repeat the procedure for Undo.
- [ ] Confirm no duplicate log was created after reconnect/retry.

## Rapid actions

- [ ] Prepare distinct test guests N and M in the same list, both unchecked, and record starting guest, group, day, and log counts.
- [ ] Click Check In for N and M back-to-back without waiting; each accepted action shows its own pending state.
- [ ] After both settle, N and M are each checked in once, visible group/day totals increased by exactly two, and exactly one new log exists per guest.
- [ ] Repeat the two-guest sequence under varied network latency where practical; neither completion order makes the visible total move backward.
- [ ] Rapidly tap Check In repeatedly for one unchecked test guest; one mutation proceeds, the total increases once, and one log is added.
- [ ] Rapidly tap Undo repeatedly for one checked-in test guest; one mutation proceeds, the total decreases once, and one Undo log is added.
- [ ] Undo N and M back-to-back; both records and all aggregate counts settle to the authoritative values without a second click.
- [ ] Attempt Check In followed immediately by Undo on the same guest; the pending guard allows only one action, then a deliberate action after settlement works normally.
- [ ] Refresh while N and M actions are pending; no settled successful result disappears and final recovery matches authoritative state.
- [ ] Two test operators attempt the same guest; final state is authoritative and each accepted logical transition has exactly one log.
- [ ] Exercise an unrelated permitted group operation while an individual action is pending; controls and counts remain consistent. DoorFlow has no party-wide database check-in handler to overlap directly.
- [ ] Rotate the device during pending state; action feedback remains visible.
- [ ] Check In or Undo two different guests back-to-back; the latest operator action determines the maintained working position and an older response never scrolls back to the earlier guest.
- [ ] Every failure is visible and no control reports success prematurely.

## Responsive

At each viewport, check page scroll, overlap, clipped text, one-character columns, hidden actions, drawer/modal reachability, utility-bar fit, Staff, Door roster/group layout, and report modal.

- [ ] 1920x1080
- [ ] 1574-style real browser window
- [ ] 1440x900
- [ ] 1366x768
- [ ] 1280x800
- [ ] 1180x800
- [ ] 1024x768
- [ ] 900x768
- [ ] 1366x1024 tablet
- [ ] 1180x820 tablet
- [ ] 834x1194 tablet
- [ ] 820x1180 tablet
- [ ] 768x1024 tablet
- [ ] 430x932 phone
- [ ] 390x844 phone
- [ ] 375x812 phone
- [ ] 360x800 phone
- [ ] 320x568 phone
- [ ] 844x390 landscape phone
- [ ] 667x375 landscape phone
- [ ] Short viewport height

## Zoom

- [ ] 125% browser zoom
- [ ] 150% browser zoom
- [ ] 200% browser zoom
- [ ] Text reflows without clipping or horizontal page scroll.
- [ ] Drawer, modal, report tables, and actions remain reachable.

## Reduced motion

- [ ] Enable reduced motion at the operating-system level.
- [ ] Navigation, drawer, modal, and Door controls remain usable.
- [ ] Motion is minimized and no continuous animation appears.
- [ ] No transition delays Check In, Undo, or error feedback.

## Keyboard and accessibility

- [ ] Skip link is the first useful keyboard destination and moves focus to main content.
- [ ] Each rendered page has one perceptible H1 and logical heading order.
- [ ] Primary navigation exposes current state.
- [ ] Search, filters, forms, statuses, and errors have usable labels.
- [ ] Drawer opens, closes, and returns focus correctly.
- [ ] Every modal has a name/description, contains focus, closes with Escape, and restores focus.
- [ ] Visible focus rings appear on all actionable controls.
- [ ] Disabled/pending controls are announced and not color-only.
- [ ] Touch-first use does not require hover.
- [ ] No duplicate or disruptive live announcement occurs.

## Low light

- [ ] Use the real service tablet at approximately 25% brightness in a dim room.
- [ ] Names and counts are readable at arm's length.
- [ ] Blue primary action is distinguishable.
- [ ] Green checked-in state is distinguishable.
- [ ] Amber warning state is distinguishable.
- [ ] Red error state is distinguishable.
- [ ] Muted text remains readable.
- [ ] No large surface is painfully bright.
- [ ] No continuous animation causes fatigue.
- [ ] Primary Check In action is obvious.
- [ ] Touch targets work one-handed.
- [ ] Portrait and landscape both pass.
- [ ] The compact mobile utility header, truthful sync status, Shift Brief, search, roster, and action controls remain readable and operable in portrait and landscape low-light use.

## PWA installation

- [ ] Clear site data on a designated test device/profile.
- [ ] Load the app online and verify service-worker registration.
- [ ] Install the PWA.
- [ ] Launch the installed app.
- [ ] Verify name `The B.O.B. DoorFlow`, short name `DoorFlow`, icon, theme, standalone mode, and `/` start URL.
- [ ] Verify the 192, 512, and maskable icons render correctly.

## PWA update

- [ ] Load the currently installed/cached v29 version on a designated test device.
- [ ] Serve/deploy the reviewed P6 candidate at the same test origin.
- [ ] Refresh normally and confirm v30 is detected without an automatic reload.
- [ ] Confirm the current open session is not disrupted.
- [ ] During the quiet-window simulation, close all DoorFlow tabs and installed-app windows.
- [ ] Reopen and confirm `doorflow-cache-v30` controls the app.
- [ ] Confirm the new stylesheet/UI loads.
- [ ] Confirm v29 is removed and v30 remains.
- [ ] Confirm unrelated origin caches remain.
- [ ] Confirm the cache contains only documented shell assets.

## Offline

- [ ] Load the installed app online first.
- [ ] Switch offline and reload.
- [ ] Confirm the expected cached shell appears or a clear browser failure occurs if shell caching is unavailable.
- [ ] Confirm login and live data are not falsely represented as available.
- [ ] Attempt only the designated failed-write test; confirm no false success.
- [ ] Confirm no operational data or mutation response appears in Cache Storage.

## Reconnect

- [ ] Restore the connection.
- [ ] Confirm normal refresh/recovery completes.
- [ ] Confirm authoritative guest, group, and day counts.
- [ ] Confirm realtime resumes on two approved devices/profiles.
- [ ] Confirm stale visible data is replaced and errors clear appropriately.

## Print/PDF

- [ ] Open the closeout preview with approved test data.
- [ ] Verify venue/operating-space/shared-list context.
- [ ] Print preview has no clipped columns, controls, or page-wide scrollbar.
- [ ] Print pagination keeps short Group Breakdown, Late Adds, No-Shows, and Shift Notes sections together when practical; headings are not orphaned, Recent Door Activity may split cleanly, repeated pages retain table headers, and individual rows do not split or lose values.
- [ ] Save a test PDF only if approved; confirm calculations and audit fields.
- [ ] Delete the non-production artifact according to local test policy.

## CSV

- [ ] Export approved non-production closeout/test data.
- [ ] Confirm column names and calculations match the baseline.
- [ ] Confirm late-add approval/reason/author/time fields remain present.
- [ ] Confirm no unexpected customer or cross-venue data exists.
- [ ] Delete the non-production artifact according to local test policy.

## Rollback readiness

- [ ] Release commit and known-good commit `1ce0f3c` are recorded.
- [ ] Rollback owner and communications owner are assigned.
- [ ] Approved non-destructive revert procedure is filled into the runbook.
- [ ] Hosting rollback procedure is filled into the runbook.
- [ ] Preferred rollback cache version and shell inventory are reviewed.
- [ ] Team understands that UI rollback does not run SQL or restore application data; the Realtime publication-only rollback is a separate, explicitly authorized procedure.
- [ ] Check In, Undo, role, realtime, and cache verification steps are ready.
- [ ] Quiet rollback window is available before service.

## Final owner decision

- [ ] All required sections passed.
- [ ] Failures and accepted risks are documented.
- [ ] Backup/PITR coverage is confirmed without exposing credentials.
- [ ] Release and rollback owners approve proceeding.
- [ ] Owner marks the candidate release-approved.

Owner: `[fill in]`

Date/time: `[fill in]`

Candidate commit: `[fill in]`

Notes/evidence reference: `[fill in]`
