# DoorFlow - Auto Refresh Sync Backup Fix

This version adds a backup auto-refresh so tablets and PWAs stay updated even if the Supabase realtime connection drops or pauses.

## What changed

- DoorFlow now auto-refreshes live data every 30 seconds.
- DoorFlow refreshes when the app/browser comes back into focus.
- DoorFlow refreshes when a tablet wakes up or the app becomes visible again.
- Auto-refresh skips while someone is typing, using a dropdown, or editing in a modal.
- Added a Refresh Data button in the top bar.
- Service worker cache bumped to v4.

## Why this matters

Supabase realtime should handle live updates, but tablets, Toast devices, Android Chrome, iPhones, and PWAs can pause background connections. This backup refresh catches missed changes without requiring staff to manually refresh every time.

## Upload to GitHub

Replace/update these files in your GitHub repo:

- index.html
- sw.js
- manifest.webmanifest
- _headers
- icons folder if needed

Then commit changes and let Netlify redeploy.

## After Netlify redeploys

On each device:
1. Open DoorFlow.
2. Refresh once.
3. If it is installed as a PWA, close and reopen the app.
4. Test adding a guest from one device and waiting up to 30 seconds on the other device.
