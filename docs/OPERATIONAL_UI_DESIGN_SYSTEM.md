# DoorFlow Operational UI Design System

## Design objective

DoorFlow operational interfaces should feel like the same product family as the DoorFlow Marketing site while serving a different job. Marketing creates confidence and communicates the product. The operational application must support scanning, comparison, repeated actions, exception handling, and reliable work under time pressure.

The principle is **brand-aligned, operation-first**.

Phase P2 demonstrates this direction in the isolated Reports / Closeout prototype. It does not change the production application or establish final behavior for live Door Operations.

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

Below `1100px`, the same sidebar and navigation markup becomes an off-canvas drawer opened from the utility bar. Do not create a second horizontal or hidden duplicate navigation tree for responsive layouts.

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

The compact utility bar sits above the content column and remains distinct from primary navigation. It is the primary home for operational context:

- original `SV` sample-venue monogram and `Sample Venue` identity
- fictional service-date selector and concise `Service review` state
- fictional `Sample Manager` and `Manager` role context
- accessible account-preview control

The utility bar uses an opaque near-white canvas, restrained border, and low shadow. It stays sticky beneath the prototype disclosure without covering content or focus targets. Venue identity must not be repeated in the sidebar, page header, or footer without a specific contextual need.

At tablet widths, the bar adds the menu button while keeping venue, service, and user context compact. At phone widths, it presents `[Menu] [Venue Logo + Venue Name] [User]`; the service date becomes a secondary venue line and the account control becomes an initials button. Venue text truncates rather than forcing horizontal page scrolling.

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

## Future migration phases

### P3: Application shell and shared primitives

Integrate approved tokens, focus styles, navigation shell, buttons, fields, status badges, modal styling, and responsive foundations while preserving current page logic.

### P4: Administrative workflows

Migrate Reports / Closeout, Management, Staff, and Shift Notes. Validate existing calculations, role visibility, empty states, errors, and exports.

### P5: Guest-list and Door Operations

Redesign live-service screens only after dedicated workflow review. Preserve check-in pending guards and rollback behavior. Validate tablet, low-light, rapid repeated actions, offline/realtime behavior, and recovery from failed writes.

### P6: Hardening and release review

Complete viewport, keyboard, reduced-motion, zoom, performance, PWA, role, and production smoke tests. Capture owner-approved screenshots and release only after operational sign-off.
