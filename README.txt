DoorFlow Launch Stability v11

Purpose:
This package is a launch-night stability pass over the v9/v10 DoorFlow build. It keeps the mobile manager layout, booth dropdown, Supabase Realtime, and backup refresh system, but makes the app less likely to feel frozen or require a close/reopen after sitting idle.

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
- Service worker cache bumped to v15.

Deployment:
1. Upload/replace all files in GitHub.
2. Commit changes.
3. Let Netlify/Vercel redeploy.
4. Fully close and reopen DoorFlow on phones/tablets.
5. If a PWA device still acts old, remove it from the Home Screen and add it again.

No Supabase SQL is needed for this update.
