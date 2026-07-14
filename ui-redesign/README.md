# DoorFlow Reports / Closeout Prototype

## Purpose

This folder contains an isolated visual prototype for a future DoorFlow operational Reports / Closeout screen. It demonstrates the Phase P2 design-system direction without changing the current operational application.

Every venue, person, date, count, note, status, and activity entry shown in the prototype is fictional sample content.

## Files

- `reports-closeout-prototype.html`: standalone semantic prototype markup and fictional content
- `reports-closeout-prototype.css`: responsive app shell and component presentation
- `reports-closeout-prototype.js`: local-only navigation, filter, sample-date, and modal interactions
- `doorflow-operational-tokens.css`: reusable administrative and Door Mode foundations

The companion design-system guidance is in `../docs/OPERATIONAL_UI_DESIGN_SYSTEM.md`.

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
- the Door Mode dark token foundation
- whether sanitized screenshots are needed for future design reviews

## Live-service boundary

Do not copy this prototype wholesale into critical live-service screens. Door Operations and guest check-in require separate workflow analysis, low-light testing, touch-target review, pending/error-state coverage, and regression testing against the existing check-in reliability safeguards.

Do not replace operational calculations, query behavior, authentication, authorization, or state management with prototype values or interactions.
