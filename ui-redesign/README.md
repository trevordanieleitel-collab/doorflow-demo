# DoorFlow Reports / Closeout Prototype

## Purpose

This folder contains the isolated visual prototype for DoorFlow operational Reports / Closeout. It remains the Phase P2 design reference while the real application uses the committed P4 administrative presentation and the uncommitted P5 Door Check-In and Tablet Door Mode presentation.

Every venue, person, date, count, note, status, and activity entry shown in the prototype is fictional sample content.

## Files

- `reports-closeout-prototype.html`: standalone semantic prototype markup and fictional content
- `reports-closeout-prototype.css`: responsive app shell and component presentation
- `reports-closeout-prototype.js`: local-only navigation, filter, sample-date, and modal interactions
- `doorflow-operational-tokens.css`: reusable administrative and Door Mode foundations

The companion design-system guidance is in `../docs/OPERATIONAL_UI_DESIGN_SYSTEM.md`.

## Real application integration status

The standalone prototype remains isolated and continues to use fictional local-only content. Phase P3 translated its shell direction into the real application through:

- `../doorflow-operational-theme.css`
- the inline runtime shell in `../index.html`
- matching shell renderers in the maintained `../app.js` mirror
- `../scripts/p3-shell-smoke.mjs`

Phase P4 administrative integration is present in the committed real application baseline. It applies the approved direction to Reports / Closeout, Management, Shift Notes, Staff, administrative forms, modal surfaces, and administrative states while preserving the existing runtime logic and real application data contracts. It does not copy fictional prototype values or prototype interactions into the application.

Phase P5 integrates the real Door Check-In and Tablet Door Mode presentation in `../index.html`, the synchronized `../app.js` mirror, `../doorflow-operational-theme.css`, and `../scripts/p5-door-smoke.mjs`. It introduces a scoped dark live-service theme, responsive guest and party presentation, text-backed status treatment, and larger touch targets without changing existing check-in, undo, query, permission, or realtime behavior. The standalone reports prototype remains a reference and is not substituted for operational runtime code.

Phase P5.1 refines that uncommitted presentation for operational density. Door Check-In aligns its roster with a dedicated right-side group browser, integrates selected counts into the selected group card, and enables a content-driven two-column roster when space permits. Tablet Door Mode removes the standalone Party Context card, uses the full width for denser guest results, and compacts controls and cards at tablet and phone widths. Existing handlers, IDs, role behavior, and data values remain unchanged.

Phase P5.2 removes presentation-only `+N` suffixes and historical late-add audit detail from live Door and Tablet guest cards. Checked/allowed badges remain visible, approved late additions retain a concise label, and legacy missing-approval records remain text-backed as `Needs Approval`. Detailed late-add fields remain unchanged in closeout and CSV output. A future administrative `Things to Review` workflow is documented but not implemented.

Phase P5.3 adds a live-service-only compact density layer at 430px and below plus short landscape. Door and Tablet guest cards remove fixed narrow-phone height, use tighter spacing, preserve normal name wrapping and count alignment, and keep primary actions at 44px. Wider Door layouts and administrative screens are unchanged.

The current database context still exposes only the `EVE` venue row. An isolated presentation configuration identifies The B.O.B. as the parent property, EVE as the operating nightclub, and the list as `Shared Guest List`; unknown venues fall back to their stored names. This does not alter venue IDs, service-day or guest-list queries, report calculations, CSV output, RLS, or door-location behavior. Explicit hierarchy fields remain a future data-model requirement.

Phase P6 prepares an uncommitted release-hardening candidate. It preserves the P5 visual system, moves the service worker to a scoped `doorflow-cache-v30` strategy, adds dependency-free release smoke coverage, and documents manual acceptance, release, and rollback procedures. P6.1 synchronizes a narrow rapid check-in/load race fix across the inline runtime and `app.js` mirror and adds deterministic delayed-write coverage. Release status remains blocked pending authenticated live mutation, duplicate-log, two-device realtime, responsive, low-light, and installed-PWA owner sign-off.

Phase 8.1 adds a permission-gated phone `Manage Guests` list for Admin and Manager roles. It derives search and All/General/party filtering from the already-loaded guest/group state, keeps Edit and Delete on the existing CRUD handlers, and preserves the edited or neighboring record through rerenders and intermediate realtime paints. Management's redundant desktop and mobile Service Date cards are removed. The one shared utility bar now provides a truthful Day/date/sync disclosure at 540px and below, collapsed by default and backed only by authenticated-session memory; its accessible name tracks the visible summary, breakpoint collapse transfers focus before hiding, and expanded controls retain the P6.9/P6.10 native-date geometry. The operational theme URL advances to `?v=p8.1`, while `sw.js`, `cache-v30`, the manifest, SQL, RLS, and policy files remain unchanged.

## Run locally

From the repository root:

```powershell
node -e "const h=require('http'),f=require('fs'),p=require('path'),r=process.cwd(),m={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};h.createServer((q,s)=>{const u=decodeURIComponent(new URL(q.url,'http://127.0.0.1').pathname).replace(/^\/+/,''),x=p.resolve(r,u||'index.html');if(!x.startsWith(r+p.sep)){s.writeHead(403);return s.end('Forbidden')}f.readFile(x,(e,d)=>{s.writeHead(e?404:200,{'Content-Type':m[p.extname(x)]||'application/octet-stream'});s.end(e?'Not found':d)})}).listen(5174,'127.0.0.1',()=>console.log('http://127.0.0.1:5174/ui-redesign/reports-closeout-prototype.html'))"
```

Open:

`http://127.0.0.1:5174/ui-redesign/reports-closeout-prototype.html`

Stop the server with `Ctrl+C` in the terminal that started it.

The Node command is used because the Windows `py` and `python` launchers are not available in the verified project environment. It uses only Node's built-in modules and listens on loopback.

## Isolation and data safety

The prototype is not connected to:

- Supabase or any database
- DoorFlow authentication
- the operational `index.html` or `app.js`
- production venue, guest, party, staff, shift-note, or check-in data
- analytics or external endpoints
- local storage, session storage, cookies, or other persistence

Prototype controls change the current document only. Refreshing the page returns it to its initial fictional state. Export and closeout actions open a notice; they do not create files or update data.

## Owner approval required

Before integration, the owner should approve:

- the administrative light theme and deep-navy application shell
- serif usage for the Reports / Closeout page title
- desktop sidebar, venue utility bar, and responsive drawer behavior
- summary-card density and report section hierarchy
- the status vocabulary and colors
- the mobile table-to-record transformation
- the integrated P5 Door Check-In and Tablet Door Mode presentation
- low-light readability and the desktop, tablet, phone, zoom, and reduced-motion matrix
- authenticated role, check-in, undo, duplicate-prevention, error-recovery, and realtime regression results
- the P6 service-worker/cache-version and controlled release plan
- Manager and Admin phone access to every current guest name, local search/list filtering, Edit, Delete, and neighboring-record scroll retention
- Door and Viewer confirmation that no Management guest Edit/Delete surface is available
- the shared phone service summary's current Day, Service Date, and connection wording in collapsed and expanded states across tab switches
- 320-430px portrait, short landscape, 150%/200% zoom, native calendar gutter, keyboard focus, and no-horizontal-scroll behavior for Phase 8.1
- whether sanitized screenshots are needed for future design reviews

## Live-service boundary

The P5 live-service presentation is implemented directly in the real runtime and mirror; it was not copied wholesale from this prototype. Before release, Door Operations and guest check-in still require owner-run low-light testing, touch review, pending/error-state coverage, authenticated role validation, and regression testing against the existing check-in reliability safeguards.

Do not replace operational calculations, query behavior, authentication, authorization, or state management with prototype values or interactions.

P5 does not modify `../sw.js` or `../manifest.webmanifest`. Installed or previously cached application copies may remain stale until P6 completes an owner-approved cache-version update and installed-PWA validation.
