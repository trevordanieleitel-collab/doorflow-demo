DoorFlow Launch Stability v19 - B.O.B. Logo and PWA Icon Wiring

Purpose:
This package builds on the v18 Foundr-style stability and branding update. It keeps the mobile manager layout, booth dropdown, Supabase Realtime, backup refresh system, phone shift notes, emoji keyboard, date/default protections, General Guest List defaults, idle button fixes, normalized raw records, memoized local selectors, stable search surfaces, and non-disruptive refresh while wiring in the real The B.O.B. logo assets.

Changes:
- Preserves form values and open mobile sections during live refresh/re-render events.
- Prevents auto-refresh from interrupting manager Quick Add or Create Party entries.
- Stops forced refreshes from firing on every iPhone/PWA focus event.
- Makes Create Party / Group save directly and update the local screen immediately.
- Makes Add Guest save directly and update the local screen immediately.
- Keeps Supabase Realtime active, backup refresh active, and adds a light realtime health check.
- Adds database request timeouts so stuck requests show an error instead of hanging.
- Adds safer no-store fetch handling for Supabase REST/auth requests.
- Keeps booth/location dropdown options: POD1-POD9, DJ Pod, Fulton St. Corner.
- Browser/PWA refresh now resets to the device's current local calendar date.
- Current date now uses the device's local date instead of UTC, preventing late-night rollover to the next day.
- Preserves the current DoorFlow screen during Supabase token refresh events instead of jumping back to Door/Reports.
- Refreshes the Supabase auth session before database loads when a tablet wakes from idle.
- Reconnects realtime and forces a live data refresh on visibility/focus/pageshow/online resume events.
- Defers idle recovery while modals/forms are open so draft entries are not wiped by a wake-up refresh.
- Flushes any pending idle sync shortly after a modal is closed.
- Verifies the Supabase session with the server before save/delete/check-in actions after wake.
- Refreshes the realtime auth token before database actions and reconnects realtime after any screen sleep.
- Adds a phone-friendly manager Shift Notes composer in mobile manager mode.
- Adds an emoji keyboard to manager shift note add/edit fields.
- Makes shift note add/edit/delete update the local screen immediately and refresh in the background.
- Protects mobile shift note drafts from idle refresh/re-render events.
- Clears stale saving/loading/mobile-submit flags after idle/wake so buttons do not stay blocked.
- Marks Check In, Undo, Create Party, Add Guest, Quick Add, edits, deletes, bulk paste, imports, and staff saves as protected active actions.
- Moves General Guest List lookup for desktop Add Guest, desktop Quick Add, bulk paste, and imports inside timeout-protected save flows.
- Adds timeouts around the main live-data refresh queries so a hung refresh cannot leave the app in a stale loading state.
- Adds pagehide and unhandled action failure recovery so failed async handlers show a clear message.
- Browser/PWA load now starts on the device's current local calendar date instead of a saved previous service date.
- Adds a clear Service Date card to the desktop manager portal.
- Adds a Service Date selector and Use Today button near the top of Mobile Manager Mode.
- Defaults Add Individual Guest, Mobile Quick Add, Bulk Paste, and Excel/CSV upload targets to General Guest List.
- Shows "Adding to" service-date text in manager add/import/note flows.
- Verifies service-day helpers match the currently selected date before saving groups, guests, and shift notes.
- Tablet and desktop guest search now update only the visible result/card panel instead of remounting the whole app on each typed letter.
- Group search now updates only the group list panel.
- Guest list and group list filtering use small derived-list caches to avoid repeated filtering/sorting during a render.
- Silent live-data refresh now compares fetched rows before replacing app state, so unchanged realtime/backup syncs do not churn the UI.
- When search is active, realtime/status refreshes patch visible list, stats, and sync surfaces instead of remounting the full DoorFlow screen.
- Guest filter/sort controls now refresh result surfaces without a full root render when possible.
- All non-submit buttons are explicitly marked type="button" to reduce accidental form submits/reloads.
- Normalizes Supabase-loaded guests, groups, check-in logs, shift notes, service days, and staff profiles before the UI uses them.
- Adds safe empty guest/group/shift-note form models so inputs do not receive undefined values.
- Upgrades guest search to local multi-term matching. Each search term must match somewhere in the guest, group, booth, plus-one, status, late-add, date, or check-in-time haystack.
- Upgrades group search to local multi-term matching against group, host, booth, status, stats, and date text.
- Adds action-specific busy keys for Check In and Undo so a single guest action cannot globally block the screen.
- Check In and Undo now patch visible list, stats, and sync surfaces after successful saves instead of remounting the full app.
- Adds the real The B.O.B. logo to /branding/bob-logo.png and /branding/bob-logo-dark.png.
- Generates optimized branded PWA icons at /branding/bob-icon-192.png, /branding/bob-icon-512.png, and /branding/bob-icon-maskable-512.png.
- Updates manifest.webmanifest icons to use the branded B.O.B. PWA icons.
- Updates favicon and Apple touch icon links to use /branding/bob-icon-192.png.
- Updates the PWA name to "The B.O.B. DoorFlow" while keeping the short name DoorFlow.
- Service worker cache bumped to v27.

Deployment:
1. Upload/replace all files in GitHub.
2. Commit changes.
3. Let Netlify/Vercel redeploy.
4. Fully close and reopen DoorFlow on phones/tablets.
5. If a PWA device still acts old, remove it from the Home Screen and add it again.

No Supabase SQL is needed for this update.
