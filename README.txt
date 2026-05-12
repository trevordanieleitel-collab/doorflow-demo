# DoorFlow - Tablet Search Keyboard Fix

This version fixes the Tablet Door Mode search issue where the keyboard refreshed/flickered after every letter.

## What changed
- Tablet search no longer re-renders the full page on every keystroke.
- Search now updates only the tablet guest cards.
- Search input has autocomplete/autocorrect/spellcheck disabled.
- Service worker cache version bumped so tablets pull the update.

## Upload to GitHub
Replace/update these files in your GitHub repo:
- index.html
- sw.js
- manifest.webmanifest
- icons folder if needed
- _headers if needed

Then commit changes and let Netlify redeploy.

## After Netlify deploys
On the tablet:
1. Open DoorFlow.
2. Refresh the page.
3. If it still acts strange, close Chrome completely and reopen it.
4. If needed, clear site data for doorflow-thebob.netlify.app.
