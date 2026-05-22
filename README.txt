DoorFlow Smooth Live Sync v9 - Booth Dropdown Inline Fix

Fixes the v8 issue where the dropdown was added to app.js but the live app was still using the inline script inside index.html.

Changes:
- Booth / Location field in Create Party / Group is now a dropdown in the actual inline app code.
- Options: POD1 through POD9, DJ Pod, Fulton St. Corner.
- Mobile Create Party / Group uses the same dropdown.
- Desktop Create/Edit Party / Group uses the same dropdown.
- Service worker cache bumped to v13.

Deployment:
1. Upload/replace all files in your GitHub repo.
2. Commit changes.
3. Let Netlify/Vercel redeploy.
4. Fully close/reopen DoorFlow on phones/tablets. If the field is still not a dropdown, remove the PWA from the Home Screen and add it again.

No Supabase SQL is needed for this update.
