# SaaS / Venue Foundation regression gates

The historical scripts combined two different kinds of assertions: reusable
functional/UI contracts, and one-time evidence that a particular P3–P8 patch
changed only a named branch, function inventory, file inventory, hash, or cache
version. The latter correctly described those old patches but cannot describe
this milestone, which intentionally changes authorization, SQL, data loaders,
Realtime, and the cache version.

The eight historical scripts still run their functional/UI contracts. Their
inline-runtime extractor now uses the active configuration-aware script boundary,
and Git reads use the current worktree's explicit safe-directory setting. Frozen
patch-scope assertions are printed as `RETIRED RELEASE SCOPE`, not as passes.
`DOORFLOW_HISTORICAL_RELEASE_AUDIT=1` re-enables all of them when reproducing an
old patch audit. The classification is in `scripts/historical-release-scope.mjs`.

## Current equivalents for retired patch-scope assertions

| Historical assertion | Current acceptance evidence |
| --- | --- |
| Required old branch/HEAD, exact new-file list, nothing staged, UI-only/no-SQL scope | Dedicated foundation branch from `51dafad`; exact migration inventory and immutable Phase 8.2C migration-body hash checks in `p8-2c-migration-integrity.test.mjs`; reviewed candidate commit and deployment checkpoint |
| Protected function must equal an old hash, or must be newly added compared with HEAD | Complete inline/app equality and syntax compilation in `current-operational-contracts.test.mjs`; retained renderer/action contract assertions; foundation context behavior tests; delayed-write race scenarios |
| Exact old function count/order and exact old invitation reset placements | Current runtime parity; active context invalidation, invitation reset, mandatory guarded Staff loads checked in the historical suites; context behavior and invitation browser tests remain required |
| No new timer/storage/query call sites compared with a historical UI-only patch | Current per-venue query/context tests, existing cache/config behavioral tests, and hosted acceptance. Source-count equality is not a security claim |
| Exact historical dependency inventory | Exact three-script inventory from approved candidate `51dafad` in `current-operational-contracts.test.mjs`: pinned SheetJS 0.20.3, local public config, pinned Supabase JS 2.116.0 |
| Exact old stylesheet/cache version | Exactly one versioned local stylesheet; cache lifecycle tests; exact comparison proving the foundation service worker differs from `51dafad` only by `v31` → `v32`; original normalized worker negative controls retained |
| Guest edit/delete/auth/data functions unchanged from old presentation patch | Retained form/action/permission contracts, foundation context/mutation tests, real PostgreSQL isolation acceptance, and hosted same-venue workflow acceptance |

## Maintained functional checks

- P3 shell still checks login fields, role identifiers, accessible navigation,
  drawers, shell structure, and mirror parity.
- P4 still checks administrative actions/forms, role-related visibility, modal
  accessibility, closeout report tables, empty states, print pagination and CSS.
- P5 still checks Door/Tablet actions, arrival badges, late-add warnings, report
  audit fields, responsive/touch layouts, anchor/focus preservation and no forced
  roster scrolling. Its sync checks now inspect `currentSyncPresentation`, which
  the renderer delegates to. Its date checks target the shared date disclosure
  that replaced the removed duplicate mobile Manager date card. P6.10 CSS checks
  stop at the next phase boundary rather than accidentally reading later CSS.
- P6 still checks PWA assets, manifest identity/icons, safe cache handling,
  operational guards, Realtime inventory and publication documentation. Its
  subscription reader understands the current six-table venue-filtered loop and
  additionally requires stale-context guards plus own-profile revalidation.
- P8.1/8.1A/8.1B still check mobile guest/Staff controls, touch sizes, compact
  layout, field semantics, focus/scroll preservation and service-date disclosure.
  Wrapped deletion/Staff refresh assertions recognize `contextRequest` while
  preserving the original permission/delegation/order requirements.
- P8.2A still checks invitation UI, disabled-state contracts, validation, guarded
  SQL boundaries and server-only behavior. Exact placement of old reset hooks is
  replaced by the mandatory authenticated-context reset and response ownership.

The deterministic check-in race script retains every original scenario and
assertion. It executes the current context ownership helpers with one stable
fictional context and a local transport adapter. Dedicated foundation tests
exercise changing account/venue authority; this race harness continues to test
optimistic writes, parallel check-ins/undo, stale snapshots, failures and locks.

## Browser fixtures and cleanup

Browser suites remain mandatory. They use fictional intercepted services,
loopback servers and unique temporary profiles; they never use employee sessions
or send emails. Installed Chrome is preferred before Edge. Windows Chromium can
hand off from its launcher while a descendant retains stderr. The test resource
manager observes process `exit`, closes the connected browser even after handoff,
then verifies only the exact validated temporary profile has no processes left.
It may terminate that exact profile, reports whether forced cleanup occurred,
and still requires listener release and profile removal. User browser profiles
are excluded. A failure to prove cleanup remains a test failure.

## Diagnostics

Run raw Deno checks separately with `--all --cached-only --frozen-lockfile
--node-modules-dir=none`. Runtime adapter tests use the disclosed `--no-check`
with fictional loopback configuration and denied network/run/FFI/write/sys/import
permissions. Do not suppress declaration errors. The only previously known
external fingerprints are TS2724 in `asset:///node/stream/web.d.cts:59:49` and
TS2430 in Supabase Auth JS 2.116.0 `webauthn.dom.d.ts:501:18`.

The test invocation's resolved lock evidence is kept outside the repository in
the regression evidence folder. No generated lock or dependency upgrade is part
of this change.

Static and fixture tests do not substitute for the required real hosted staging
browser/API acceptance, advisor checks, production preflight or disabled-mode
verification. Those remain separate deployment gates.

## Fresh local results, 2026-11-08

The final combined Node invocation passed 276/276 tests, with zero skipped, including
the original invitation/config/cache/acceptance-core suites, immutable migration
replay, current operational contracts, foundation context tests, and foundation
database tests. The database test reports 1,340 approved requirements using real
PostgreSQL 17.5 RLS and auth context in its disposable WASM environment.

All nine smoke scripts exit zero. They execute 803 reusable assertion checks,
including 44 check-in race checks. The other 256 assertion reports are explicitly
retired one-time patch-scope checks described above; they are not counted as
passes. The smoke summary and full logs are in the task's regression evidence.

The Deno adapter/audit runtime invocation passed 587/587. The genuine full raw
check reports exactly the two external declaration fingerprints listed above:
application/test diagnostics 0, unexpected diagnostics 0. No suppression flags
or dependency/compiler changes were used.

The isolated invitation-acceptance browser test passed 1/1, invitation-context
browser tests passed 16/16, and public-configuration browser tests passed 30/30:
47/47 overall, zero skipped. Every launcher exited with code 0; 45 fixtures
closed without forced cleanup, and two used the exact temporary-profile
descendant cleanup after launcher handoff. All 47 verified both listeners closed
and the exact temporary profile removed. The
old test that changed an operational venue independently of the profile is now
an explicit foreign-venue-reply rejection test: the profile and existing venue
state must remain unchanged and the assigned venue must still load afterward.

## Post-acceptance refocus correction

An additional test reproduces the same-user `SIGNED_IN` event emitted when the
browser regains focus. The app now preserves the currently permitted view while
still reloading profile authority. Initial login and account switches retain the
role's default view, and changed permissions still reject the old view. The
new test fails before the fix and passes afterward. The final Node total above
includes this tenth foundation context test. Nine smoke scripts were rerun and
all exit zero; PostgreSQL requirements remain 1,340/1,340. Fresh evidence is
separate under the task's `regression/focus-fix` evidence folder, preserving the
earlier 275-test checkpoint.
