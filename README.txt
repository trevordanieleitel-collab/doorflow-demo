# DoorFlow - Smooth Live Sync v7

This package keeps the working v5 desktop/mobile manager fixes and adds a stronger live-sync system for phone, tablet, and PWA testing.

## What changed in v6

- Added Supabase Realtime event listeners for:
  - guests
  - groups
  - check_in_logs
  - shift_notes
  - service_days
  - staff_profiles
- Realtime updates are debounced so multiple database events do not cause choppy reloads.
- Backup refresh was previously set to 15 seconds in v6. v7 changes it to 30 seconds because Supabase Realtime is now the primary sync layer.
- Refresh on focus, visibility change, pageshow, and reconnect is stronger.
- Auto-refresh no longer skips forever just because a search/input field is focused.
- Added sync status display:
  - Live
  - Syncing
  - Polling
  - Pending
  - Offline
- Added last-updated time to the top bar and mobile manager footer.
- Service worker cache bumped to v10.
- Service worker now uses network-first loading for app code so phones/tablets are less likely to stay stuck on an old build.

## Files to upload/replace

Upload/replace these files in your GitHub repo:

- index.html
- app.js
- sw.js
- manifest.webmanifest
- _headers
- vercel.json if using Vercel
- icons folder if needed
- supabase_realtime_enable.sql is included for reference; do not upload it to Netlify/Vercel as part of the app unless you want to keep it in the repo.

## Supabase Realtime SQL

If live updates still feel delayed after deployment, run the included file in Supabase SQL Editor:

supabase_realtime_enable.sql

This enables Realtime for the DoorFlow tables. If Realtime is already enabled, the script safely skips those tables.

## After deployment

Because DoorFlow is installed as a PWA, each phone/tablet may keep an older cached build.

After Netlify/Vercel redeploys:

1. Fully close DoorFlow on each phone/tablet.
2. Reopen it.
3. If a device still acts like the old version, remove DoorFlow from the home screen and add it again.

## Test plan

1. Open DoorFlow on two devices.
2. Confirm the sync pill shows Live or Polling with an Updated time.
3. Add a guest on Device 1.
4. Watch Device 2 without touching Refresh Data.
5. It should update from Realtime quickly, or from backup refresh within about 30 seconds.
6. Lock/unlock Device 2 and confirm it refreshes after returning.
7. Put one device on cellular and one on Wi-Fi to compare building Wi-Fi vs app sync.

## Notes

- Live data still requires internet.
- If the sync pill shows Polling, the app is still usable because backup refresh is active.
- If the sync pill shows Offline, the device connection is the issue.
- If Refresh Data works but automatic updates lag, Realtime probably needs the Supabase SQL script.


DoorFlow Smooth Live Sync v7 notes:
- Keeps Supabase Realtime enabled from v6.
- Reduces unnecessary screen repaints when backup refresh finds no data changes.
- Filters realtime events so this screen only reloads for the active service date/list data.
- Changes backup polling from 15 seconds to 30 seconds because realtime is now the primary sync method.
- Avoids interrupting mobile manager form fields while managers are typing.
- Flushes pending sync after a manager leaves a field.
- Service worker cache bumped to v11.
