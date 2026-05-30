DoorFlow Launch Stability v15 - Idle Button Recovery

Purpose:
This package builds on the v14 mobile shift notes update. It keeps the mobile manager layout, booth dropdown, Supabase Realtime, backup refresh system, phone shift notes, and emoji keyboard while hardening button actions after idle/PWA wake.

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
- Browser/PWA refresh now keeps the selected service date instead of resetting.
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
- Service worker cache bumped to v23.

Deployment:
1. Upload/replace all files in GitHub.
2. Commit changes.
3. Let Netlify/Vercel redeploy.
4. Fully close and reopen DoorFlow on phones/tablets.
5. If a PWA device still acts old, remove it from the Home Screen and add it again.

No Supabase SQL is needed for this update.
