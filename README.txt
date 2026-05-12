# DoorFlow PWA Android / Toast Tablet Install Fix

This version keeps the same DoorFlow app but updates the PWA install files for better Android/Chrome tablet compatibility.

## What changed
- Manifest paths changed to absolute root paths
- Start URL changed to /
- Scope changed to /
- Service worker registration changed to /sw.js
- Service worker cache bumped to v2
- Removed orientation lock from manifest

## Upload to GitHub
Replace/update these files in your GitHub repo:

- index.html
- manifest.webmanifest
- sw.js
- icons/icon-192.png
- icons/icon-512.png
- icons/maskable-512.png
- _headers

Then commit changes. Netlify should redeploy automatically.

## After Netlify redeploys
On the Toast/Android tablet:
1. Open Chrome.
2. Go to https://doorflow-thebob.netlify.app
3. Refresh the page.
4. Try Install again.

If it still says it cannot install:
- Use Add to Home Screen instead of Install App, if Chrome offers it.
- Or keep using Go Back To Site / browser shortcut.
- Some Toast-managed tablets may block installing third-party PWAs.
