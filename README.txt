# DoorFlow - Mobile Manager Quick Add + Auto Refresh Sync Fix

This version keeps the auto-refresh backup and adds a phone-friendly Manager Mode layout for quick manager additions during live service.

## What changed

- Added a mobile Manager Mode layout for phones.
- Added Manager Quick Add for fast live-shift additions.
- Added Today's Lists with counts on mobile.
- Added Recent Manager Adds audit trail on mobile.
- Moved advanced management tools into a collapsed mobile section.
- DoorFlow now auto-refreshes live data every 30 seconds.
- DoorFlow refreshes when the app/browser comes back into focus.
- DoorFlow refreshes when a tablet wakes up or the app becomes visible again.
- Auto-refresh skips while someone is typing, using a dropdown, or editing in a modal.
- Added a Refresh Data button in the top bar.
- Service worker cache bumped to v5.

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


## Mobile Manager Test

1. Log in as a manager/admin on a phone.
2. Open Management.
3. Confirm the mobile Manager Mode layout appears.
4. Add a guest through Quick Add.
5. Confirm the guest appears on the selected list and shows as a Late Add with approval info.
6. Confirm desktop/tablet Management still works as before.


UPDATE: Mobile Manager Quick Add v2
- Quick Add can now add directly to the General Guest List even if the General Guest List needs to be created for that service date.
- Added Plus Ones field for manager phone additions.
- Added a visible Create Party / Group button in the mobile manager quick actions area.
- Improved phone modal layout for creating parties/groups.
- Service worker cache bumped to v6.


UPDATE: Mobile Manager Quick Add v3
- Reworked mobile Quick Add to use a direct phone button handler instead of relying on the full desktop form/modal flow.
- Added an in-phone Create Party / Group panel so managers can create a list without leaving the mobile layout.
- Added clearer mobile success/error messages inside Manager Mode.
- General Guest List quick adds now explicitly create/find the General Guest List before inserting the guest.
- Service worker cache bumped to v7.


V4 fix notes:
- Mobile Quick Add no longer uses .select().single() after inserts.
- Mobile Create Party/Group no longer uses .select().single() after inserts.
- General Guest List lookup is resilient if duplicate General Guest List rows exist.
- Venue and service day lookup avoid single-row errors by selecting the first matching row.
- Service worker cache bumped to v8.


V5 fix notes:
- Fixed desktop Add Name so General Guest List / Individual Guest can create/find the General Guest List before adding a name.
- Fixed desktop Create Party by removing the Supabase .single() dependency after insert.
- Fixed CSV/import General Guest List targeting to use the same General Guest List finder.
- Service worker cache bumped to v9.
