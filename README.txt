# DoorFlow PWA Installable Build

This is the current stable DoorFlow build converted into a PWA-ready package.

## What this adds
- App manifest
- App icons
- Service worker
- iPhone/iPad Add to Home Screen support
- Android/Chrome Install App support
- Netlify/Vercel hosting support files

## Important
DoorFlow still requires internet access for live Supabase sync. The PWA opens like an app, but live check-ins, notes, and database updates require online access.

## Netlify quick deploy
1. Go to Netlify.
2. Choose Add new site / Deploy manually.
3. Drag the full unzipped `doorflow_pwa_installable` folder into Netlify.
4. Netlify gives you a link.
5. Open that link on the device.
6. iPhone/iPad: Safari → Share → Add to Home Screen.
7. Android/Chrome: menu → Install App or Add to Home Screen.

## Vercel quick deploy
1. Upload these files to a GitHub repository or import the folder into Vercel.
2. Deploy as a static site.
3. Open the deployed link.
4. Install it to the device/home screen.

## Pilot recommendation
Before live use at The BOB:
- Host this build at one link.
- Install it on at least two test devices.
- Log in as manager on one device and door staff on another.
- Run a fake event with 100 names.
- Confirm sync, check-ins, notes, late adds, filters, and closeout report.
