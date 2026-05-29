DoorFlow Launch Stability v14 - Mobile Shift Notes + Emoji Keyboard

Purpose:
This package builds on the v13 idle recovery fix. It keeps the mobile manager layout, booth dropdown, Supabase Realtime, and backup refresh system, and adds manager shift note creation from phones.

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
- Service worker cache bumped to v22.

Deployment:
1. Upload/replace all files in GitHub.
2. Commit changes.
3. Let Netlify/Vercel redeploy.
4. Fully close and reopen DoorFlow on phones/tablets.
5. If a PWA device still acts old, remove it from the Home Screen and add it again.

No Supabase SQL is needed for this update.
