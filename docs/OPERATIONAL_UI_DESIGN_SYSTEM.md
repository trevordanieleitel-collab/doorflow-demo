# DoorFlow Operational UI Design System

## Design objective

DoorFlow operational interfaces should feel like the same product family as the DoorFlow Marketing site while serving a different job. Marketing creates confidence and communicates the product. The operational application must support scanning, comparison, repeated actions, exception handling, and reliable work under time pressure.

The principle is **brand-aligned, operation-first**.

Phase P2 demonstrates this direction in the isolated Reports / Closeout prototype. Phase P3 begins real application integration with a shared login treatment, authenticated shell, venue utility bar, and base administrative theme. It does not establish final behavior or internal presentation for live Door Operations.

## Relationship to DoorFlow Marketing

The operational system translates these approved marketing foundations:

- warm paper and near-white canvas colors
- deep operational navy surfaces
- electric blue primary actions
- restrained amber attention detail
- editorial typography used selectively
- thin borders and controlled shadows
- local system fonts only
- responsive, focus-visible, reduced-motion behavior

It does not copy marketing page composition, oversized section spacing, decorative storytelling, product mockups, or promotional calls to action. Operational pages use denser information, shorter vertical rhythm, predictable navigation, and visible state labels.

## Theme strategy

### Administrative theme

- Warm paper page background: `--df-paper`
- White content surfaces: `--df-surface`
- Deep navy shell: `--df-navy-deep`
- Dark slate content text: `--df-text`
- Electric blue primary actions: `--df-blue`
- Editorial serif restricted to major administrative titles and low-density headings
- Compact cards, borders, tables, forms, and status badges use the operational sans stack

Administrative screens should feel calm, precise, and scan-friendly. Surface changes must communicate grouping rather than decoration.

### Door Mode foundation

- Dark navy canvas: `--df-door-canvas`
- Raised dark surfaces: `--df-door-surface` and `--df-door-surface-raised`
- White primary text and muted blue-gray secondary text
- Green completion action: `--df-door-action`
- Amber review state: `--df-door-warning`
- Red reserved for errors and destructive actions: `--df-door-error`
- Light blue visible focus ring: `--df-door-focus`

Door Mode should prioritize high contrast, large touch targets, stable layout, short labels, explicit pending states, and immediate action feedback. Phase P2 defines only the foundation; it does not redesign or simulate check-in.

## Color tokens

| Purpose | Token | Value |
| --- | --- | --- |
| Warm page background | `--df-paper` | `#f6f2ea` |
| Administrative canvas | `--df-canvas` | `#fcfbf8` |
| Content surface | `--df-surface` | `#ffffff` |
| Major ink | `--df-ink` | `#071528` |
| Body text | `--df-text` | `#172133` |
| Secondary text | `--df-muted` | `#5f6b7c` |
| Navigation shell | `--df-navy` | `#0a2347` |
| Deep shell / Door canvas | `--df-navy-deep` | `#06162e` |
| Primary action | `--df-blue` | `#0b63f6` |
| Primary hover | `--df-blue-hover` | `#084fd0` |
| Primary active | `--df-blue-active` | `#063fa8` |
| Attention accent | `--df-amber` | `#b58a50` |
| Verified / completed | `--df-green` | `#1f704c` |
| Error / destructive | `--df-red` | `#a52d2d` |
| Component border | `--df-border` | `#d6dde6` |
| Keyboard focus | `--df-focus` | `#2878ff` |

Status background and text pairs are defined separately in `doorflow-operational-tokens.css`. Status must never be communicated by color alone.

## Typography

Editorial stack:

```css
"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif
```

Operational stack:

```css
ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif
```

Use editorial serif only for:

- one major page title
- low-density administrative section headings when the layout has room
- Reports / Closeout and onboarding headlines

Use operational sans for navigation, controls, tables, names, values, statuses, notes, Door Mode, and all live-service information. Text sizes change at explicit breakpoints rather than scaling continuously with viewport width.

## Spacing

The spacing scale is based on 4, 8, 12, 16, 20, 24, 32, 40, 48, and 64 pixels. Prefer:

- 8-12px between tightly related labels and controls
- 16-24px inside operational cards
- 18-32px between report sections
- 32-48px around major page headings on desktop
- 12-16px page gutters on narrow phones

Density should support fast scanning without compressing touch targets below approximately 44px.

## Radius and shadows

- Controls: `8px`
- Compact cards: `12px`
- Standard operational cards: `16px`
- Major presentation surfaces and dialogs only: `20-24px`

Use borders as the primary grouping device. Apply shadows sparingly to the application shell, modals, and a limited number of important surfaces. Avoid floating page sections, nested cards, glow effects, and decorative depth.

## Buttons

- Primary: electric blue, white label, minimum 44px height
- Secondary: white surface, visible border, dark text
- Quiet: transparent surface for low-priority commands
- Destructive: red only when an actual destructive command exists
- Icon-only: familiar symbol, accessible name, visible hover/focus state, stable square dimensions

Pending states must disable only the affected action and provide visible status text. Prototype buttons never imply persistence.

## Forms

- Labels remain visible; placeholders do not replace labels
- Inputs and selects have a minimum 44px height
- Default borders use `--df-border-strong`
- Focus uses a 3px visible ring with clear offset
- Errors include direct text and do not rely on red alone
- Related fields use aligned grids that collapse before labels become narrow

## Tables

- Headers are short, visible, and left aligned unless numeric comparison requires otherwise
- Numeric values use tabular figures where supported
- Row borders organize content without zebra-striping every table
- Desktop tables may scroll inside an explicitly bounded region when necessary
- On narrow screens, important tables should transform into labeled records instead of shrinking into unreadable columns
- Mobile values must retain their header context through visible labels

## Cards and surfaces

Cards are for repeated summaries, discrete records, dialogs, and genuinely bounded tools. Page sections should not become decorative floating cards by default. Do not place cards inside other cards.

Summary cards should keep stable minimum dimensions and place labels, symbols, values, and context consistently. Operational panels should use restrained borders, compact headers, and source-order reading flow.

## Status badges

Standard statuses are:

- Ready
- Open
- Checked In
- Verified
- Pending
- Needs Review
- Warning
- Error
- Closed
- Draft

Each badge includes readable text and a compact visible symbol. Colors distinguish categories, but the words carry the meaning. Avoid inventing near-duplicate labels without an operational need.

## Navigation

Desktop administration uses a persistent deep-navy sidebar as the sole primary navigation. The sidebar contains the DoorFlow brand lockup and one navigation tree. It does not repeat venue or user context.

At `1080px` and below, the same sidebar and navigation markup becomes an off-canvas drawer opened from the utility bar. Do not create a second horizontal or hidden duplicate navigation tree for responsive layouts.

Navigation requirements:

- current location uses `aria-current="page"`
- the mobile toggle exposes `aria-expanded` and `aria-controls`
- Escape closes the mobile menu and restores focus to the toggle
- the closed responsive drawer is removed from keyboard navigation
- selecting a destination closes the drawer
- clicking the drawer backdrop closes the drawer and restores focus
- all targets are at least approximately 44px high
- labels wrap or truncate intentionally; no one-character columns
- prototype-only destinations disclose that they are inactive

### Venue utility bar

The compact utility bar sits above the content column and remains distinct from primary navigation. In the real application it is the primary home for actual operational context:

- the loaded venue name and a derived venue monogram
- the existing day and service-date controls
- the existing sync state and refresh action
- the authenticated staff name, role, initials fallback, and logout action

The utility bar uses an opaque near-white canvas, restrained border, and low shadow. It remains sticky without covering content or focus targets. If venue state is not loaded, it displays the neutral `Venue` fallback; it never substitutes prototype sample content.

At tablet widths, the bar adds the menu button while keeping venue, service, and user context compact. At phone widths, the service controls move to a compact second row, user text reduces to initials, and venue text truncates rather than forcing horizontal page scrolling. The P2 prototype keeps its fictional context for isolated design review only.

## Modals

Dialogs require:

- `role="dialog"` and `aria-modal="true"`
- accessible title and description
- reachable close control
- Escape-to-close
- focus containment
- focus restoration to the opening control
- responsive width, safe-area padding, and internal scrolling
- controls that remain reachable on short mobile screens and at 200% zoom

Production confirmation dialogs must state the exact action and consequence. The Phase P2 modal states explicitly that no operational data changed.

## Responsive behavior

The prototype supports the requested desktop, laptop, tablet, phone, landscape, and zoom conditions through content-driven layout:

- Desktop: persistent sidebar, sticky venue utility bar, three-column summary grid, primary and secondary report columns
- Tablet landscape: utility bar with menu control, single sidebar drawer, two-column summaries, stacked report columns
- Tablet portrait: compact utility context, simplified attendance layout, and full-width report flow
- Phone: menu/venue/user utility bar, single sidebar drawer, one-column summaries, stacked controls, and labeled table records
- Narrow phone: single-column segmented controls and table values
- Landscape phone: reduced vertical spacing and internally scrolling overlays
- 200% zoom: width-driven reflow with no fixed page minimum

Page-level horizontal scrolling is not an accepted fallback. Any intentional horizontal table scrolling must remain inside the table region and retain visible context.

## Accessibility

- Semantic header, navigation, main, section, aside, and footer landmarks
- Skip-to-content link
- One `h1` and logical heading order
- Visible focus states on all controls
- Touch-friendly dimensions
- Text-plus-symbol statuses
- Focus-contained modal with restoration
- reduced-motion handling
- no remote fonts or dependency on visual effects
- source order remains meaningful when columns collapse
- disclosure and sample-data labels remain visible at every width

## Low-light considerations

Door Mode should reduce glare without reducing contrast. Avoid pure black backgrounds, thin low-contrast borders, muted primary labels, and blue-only status meaning. Green indicates a completed or verified state; amber indicates review; red indicates failure or destructive intent.

Test in a dim environment with actual target hardware. Confirm that touch targets, pending states, guest identifiers, party counts, and error recovery remain legible without relying on hover.

## Do not use in Door Mode

- Editorial serif for guest names, party names, controls, or live status
- decorative shadows, gradients, imagery, or promotional copy
- small icon-only primary actions
- subtle gray pending indicators
- dense multi-column report tables
- motion that delays or obscures action feedback
- hidden navigation that competes with check-in flow
- prototype sample values or interactions

## Integration guidance

1. Treat `index.html` as the current operational runtime authority unless architecture changes are explicitly approved.
2. Introduce tokens and shared visual primitives separately from application behavior.
3. Preserve Supabase queries, authentication, authorization, venue context, and reporting calculations.
4. Map existing roles and permissions to visibility without changing the permission model.
5. Keep check-in reliability guards, optimistic rollback behavior, party counts, and visible state refreshes intact.
6. Test each integrated screen with its actual data states before proceeding to the next workflow.
7. Keep the isolated prototype until owner review is complete; do not use it as production code by substitution.

## Real application shell integration (P3)

### Runtime architecture

`index.html` remains the production runtime authority and contains the inline application JavaScript. It links `../doorflow-operational-theme.css` from the repository root. `app.js` remains a maintained mirror/reference and carries the same shell renderers, but `index.html` does not load it.

The authenticated shell has one semantic structure:

- a skip-to-content link
- a single `aside` navigation landmark
- one primary role-gated navigation tree
- a sticky venue utility bar
- a semantic `main` content region
- a backdrop for the responsive navigation drawer
- a shell-level modal styling boundary

### Role-gated navigation

The real shell reuses the existing `perms()` results and existing tab state. It does not add routes or permissions. The current item uses `aria-current="page"`, and selecting an item calls the existing `switchView()` contract after closing the drawer.

- Admin retains Door Check-In, Tablet Door Mode, Management, Staff, and Reports.
- Manager retains Door Check-In, Tablet Door Mode, Management, and Reports.
- Door retains Door Check-In and Tablet Door Mode.
- Viewer retains Reports.

These statements document the existing application permission map; authorization must continue to be enforced by application logic and database policy rather than CSS.

### Venue, service, and user context

Venue identity comes from `state.venue.name`, with `Venue` as the loading fallback. The monogram is derived from the loaded name. Day and service date keep the existing `setActiveDay()` and `setActiveDate()` handlers. Party/group selection and door location remain in their existing operational context card.

The user area uses the current staff display name and role label, derives initials locally, and calls the existing `logout()` action. It does not add an account menu, profile settings, or new authentication behavior. Sync text and refresh continue to use `renderSyncPill()` and `manualRefreshData()`.

### Responsive drawer

The desktop sidebar becomes an off-canvas drawer at `1080px` and below without duplicating navigation. The menu button exposes `aria-controls` and `aria-expanded`. Escape and backdrop activation close the drawer and restore focus; selecting a destination closes it before navigation. The closed drawer is inert, body scroll is held while open, safe-area padding is applied, and short-landscape and reduced-motion rules are included.

### Administrative style boundary

Base card, button, form, notice, badge, table, and modal treatments are scoped through `.df-admin-theme`, `.df-app-shell`, and `.df-shell-modal-scope`. P3 does not change page-specific information architecture. Reports, Management, Staff, Shift Notes, lists, party details, and guest details remain candidates for P4 or P5.

### Live-service exception

Door Check-In and Tablet Door Mode receive the outer shell but not the `.df-admin-theme` component overrides. Their internal rendering, controls, typography, check-in/undo actions, pending states, and event handlers remain unchanged. This is an intentional temporary P3 exception so the dedicated P5 workflow review can address live-service width, low-light, and touch behavior without incidental redesign.

### P3 manual validation requirements

Before release consideration, test the real app manually with approved non-production accounts for admin, manager, door, and viewer. Verify login success/error behavior, focus order, exact tab visibility, active state, venue/date/user/sync context, logout, drawer keyboard behavior, and all authorized destinations. Review desktop, tablet, phone, short landscape, 200% zoom, and reduced motion. Confirm Door Check-In and Tablet Door Mode have no shell-induced clipping and perform their dedicated operational regression checklist.

### Service-worker caveat

P3 does not modify `sw.js` or `manifest.webmanifest`. The new stylesheet is therefore not yet covered by a reviewed cache-version rollout. Service-worker integration, update behavior, offline/stale-cache testing, and owner-approved authenticated role testing remain required before deployment.

## Real administrative workflow integration (P4)

P4 applies the approved administrative system to the real inline runtime and its `app.js` mirror. It changes presentation and accessibility structure only; existing authentication, permission checks, Supabase queries, calculations, exports, mutations, validation, and confirmation behavior remain the operational authority.

### Administrative page architecture

Reports, Management, and Staff use `.df-admin-page` with one page-level `h1`, a concise operational description, and a compact venue/service-date context definition list. Section headings remain system sans-serif and use restrained kicker text for scanability. Administrative sections use full-width flow or genuinely bounded tool cards; repeated summary records remain cards.

### Reports and closeout

The real Reports page uses only current application state. Its summary includes the existing group, completed-group, allowed, checked-in, remaining, late-add, and activity-log values. Attendance, activity, guest-status, and shift-note sections reuse existing state and calculation helpers. Existing CSV, refresh, closeout preview, print, and report export handlers are unchanged.

The closeout dialog keeps the existing report builder and export behavior. Presentation adds a viewport-safe administrative dialog surface, readable table regions, and a visible close control. It does not introduce finalize state, revenue, POS, payment, wait-time, or cover metrics.

P4.1 refines the Close Out Report as a dedicated `.df-closeout-report` document surface. The header contains one venue/date context, generated-by metadata, Export CSV, Print, and one accessible X close action. Each of the five existing report tables remains in its original section and column order, with horizontal overflow contained by its own table region at medium widths and labeled record rows on phones. Empty report areas render as calm status records instead of fake table rows.

Closeout printing uses the named landscape `@page doorflow-closeout` rule because the preserved Group Breakdown and Late Adds tables contain seven required columns. Only a rendered closeout report opts into that page and suppresses its sibling application shell; the report's `#app` ancestor remains printable. Print removes backdrop treatment, actions, internal scrolling, shadows, and rounded modal styling; table headers repeat where supported and rows avoid page breaks where practical. No print column is omitted, and the existing `printCloseOutReport()` and CSV export behavior remain unchanged.

### Management and Shift Notes

Management retains the dedicated mobile manager renderer and the existing desktop CRUD workspace. The page header and command band organize existing Create Party, Add Guest, Bulk Paste, clear, report-preview, and export actions without changing handler contracts. The embedded live guest workspace remains structurally unchanged.

Shift Notes are presented as a dated administrative record. Category, priority, time, author, note text, and authorized edit/delete actions remain visible. Long note text uses normal wrapping and content-driven height. Composer and edit fields retain their existing names and submit handlers while adding explicit label associations.

### Staff

Staff preserves the P3.1 responsive table-to-record behavior and the existing `staff-*` forms, `form=` associations, role values, status values, and `updateStaffProfile(event)` submission. Desktop remains tabular; narrower layouts expose labeled records. Editable names, roles, statuses, created dates, and Save actions remain fully readable and reachable.

### Forms and modals

Administrative forms keep existing field names, required states, validation, and submit handlers. Labels are explicitly associated with the group, guest, plus-one, bulk-paste, and shift-note fields. Two-column forms collapse to one column before controls become narrow.

Administrative dialogs use `role="dialog"`, `aria-modal="true"`, accessible names, visible close controls, focus containment, Escape close, and restoration to the matching opening control when it remains available. Dialogs use dynamic viewport maximum heights and internal scrolling. Backdrop-close behavior remains unchanged per dialog.

### Status and state mapping

- Green is reserved for confirmed live/success or complete attendance states.
- Amber identifies remaining attendance, empty records, or review attention.
- Red identifies errors and destructive commands.
- Neutral status treatment identifies counts and non-evaluative context.
- Loading text states that records are being refreshed and does not claim completion.
- Empty states state what is absent and reference only actions already available to the current workflow.

Underlying database values are not remapped. Status text remains visible so meaning never depends on color alone.

### Responsive records and accessibility

Reports tables become labeled records below the narrow-layout threshold; Staff retains its dedicated labeled record conversion. Wider tables stay inside explicit horizontal scroll regions rather than widening the page. Page headers, context, summary cards, actions, and forms collapse by available width, including short landscape and 200% zoom conditions.

P4 retains the shell skip link and logical DOM order, adds one `h1` per administrative page, table captions and scoped headers, explicit field labels, alert/status semantics, touch-friendly controls, and modal keyboard focus handling. Static checks cannot prove visual layout, authenticated role behavior, or database behavior; those remain owner-run manual tests.

### Door Mode exclusion and remaining P5 work

P4 does not change Door Check-In guest rows, Tablet Door Mode, check-in/undo controls, party arrival controls, Door search/filter/sort controls, or live-service status presentation. The P3.1 responsive workspace and check-in reliability safeguards remain protected by source-hash smoke checks.

P5 remains responsible for the dedicated live-service redesign, low-light treatment, guest-row density, touch workflow review, rapid-action behavior, and authenticated check-in regression testing.

### PWA/service-worker caveat

P4 does not modify `sw.js` or `manifest.webmanifest`. The administrative CSS and runtime changes still require an owner-approved cache-version rollout plus stale-cache, update, offline, and installed-PWA testing before deployment.

## Future migration phases

### P3: Application shell and shared primitives

The real login, navigation shell, utility context, base administrative primitives, focus styles, and responsive drawer are integrated as an uncommitted review change. Page logic and live-service internals remain outside this phase.

### P4: Administrative workflows

Reports / Closeout, Management, Staff, Shift Notes, and administrative dialogs are integrated as uncommitted review work. Existing calculations and mutation contracts are statically protected; authenticated role, empty/error state, export-content, and responsive visual review remain required.

### P5: Guest-list and Door Operations

Redesign live-service screens only after dedicated workflow review. Preserve check-in pending guards and rollback behavior. Validate tablet, low-light, rapid repeated actions, offline/realtime behavior, and recovery from failed writes.

### P6: Hardening and release review

Complete viewport, keyboard, reduced-motion, zoom, performance, PWA, role, and production smoke tests. Capture owner-approved screenshots and release only after operational sign-off.
