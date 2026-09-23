import { withoutEnvironmentCacheSafety, withoutConfigRestoreListener, withoutConfigBootstrapHeader, stagingSafetyFiles } from "./p8-2b-static-comparison.mjs";
import { createHash } from "node:crypto";
import { hasInvitationContextHooks, withoutInvitationContextHooks } from "./p8-2a-context-comparison.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const baselineCommit = "062fbe9";
const phase82BaselineCommit = "7144c3d6a19e81ac2b5df191958171242b4ea5e9";
const requiredBranch = "main";
const baselineCompactServiceControlsQuery = "(max-width: 540px)";
const compactServiceControlsQuery = "(max-width: 540px), (orientation: landscape) and (max-height: 500px) and (max-width: 900px)";
const baselineServiceControlsBootstrap = `const serviceControlsPhoneMedia = typeof window.matchMedia === "function"
  ? window.matchMedia("${baselineCompactServiceControlsQuery}")
  : null;
let serviceControlsPhoneLayout = serviceControlsPhoneMedia
  ? serviceControlsPhoneMedia.matches
  : window.innerWidth <= 540;`;
const currentServiceControlsBootstrap = `const serviceControlsPhoneMedia = typeof window.matchMedia === "function"
  ? window.matchMedia("${compactServiceControlsQuery}")
  : null;
let serviceControlsPhoneLayout = serviceControlsPhoneMedia
  ? serviceControlsPhoneMedia.matches
  : window.innerWidth <= 540
    || (window.innerWidth <= 900 && window.innerHeight <= 500 && window.innerWidth > window.innerHeight);`;
const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
}

function git(args) {
  return execFileSync("git", args, { cwd:root, encoding:"utf8" }).replaceAll("\r\n", "\n");
}

function fromBaseline(path) {
  return git(["show", `${baselineCommit}:${path}`]);
}

function fromPhase82Baseline(path) {
  return git(["show", `${phase82BaselineCommit}:${path}`]);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}
function withoutCredentialNavigationHardening(source) {
  const declarations = `const AUTH_CREDENTIAL_KEYS = new Set([
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "token_hash",
  "token",
  "code",
  "error",
  "error_code",
  "error_description",
  "type"
]);

function hasAuthCredentialParameters(url) {
  return [...url.searchParams.keys()].some(key => {
    const normalized = String(key || "").toLowerCase();
    return AUTH_CREDENTIAL_KEYS.has(normalized) || normalized.endsWith("_token");
  });
}

async function purgeCredentialBearingCacheEntries(cacheName) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter(request => hasAuthCredentialParameters(new URL(request.url)))
      .map(request => cache.delete(request))
  );
}
`;
  const navigationGuard = `  const isNavigation = request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html";

  // Credential-bearing navigations stay network-owned and never enter or read
  // the shell cache. URL fragments are not visible to service workers; the
  // root document synchronously scrubs both query and fragment credentials.
  if (isNavigation && hasAuthCredentialParameters(url)) return;

`;

  return source
    .replace(declarations, "")
    .replace("      .then(() => purgeCredentialBearingCacheEntries(CACHE_NAME))\n", "")
    .replace(navigationGuard, "")
    .replace("  if (isNavigation) {", '  if (request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html") {');
}
const ROOT_CREDENTIAL_SCRUB = `
  <script>
  (() => {
    const AUTH_CREDENTIAL_KEYS = new Set([
      "access_token",
      "refresh_token",
      "provider_token",
      "provider_refresh_token",
      "token_hash",
      "token",
      "code",
      "error",
      "error_code",
      "error_description",
      "type"
    ]);
    const hasCredentialKey = key => {
      const normalized = String(key || "").toLowerCase();
      return AUTH_CREDENTIAL_KEYS.has(normalized) || normalized.endsWith("_token");
    };
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
    const hasCredentialMaterial = [query, fragment]
      .some(parameters => [...parameters.keys()].some(hasCredentialKey));

    if (!hasCredentialMaterial) return;

    const credentialFreePath = window.location.pathname || "/";
    try {
      window.history.replaceState(null, document.title, credentialFreePath);
    } catch {
      window.location.replace(credentialFreePath);
    }
  })();
  </script>
`;

function withoutRootCredentialScrub(source) {
  return source.replace(ROOT_CREDENTIAL_SCRUB, "");
}

function extractFunction(source, name) {
  const escaped = name.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
  const startMatch = new RegExp(`^(?:async\\s+)?function\\s+${escaped}\\s*\\(`, "m").exec(source);
  if (!startMatch) return "";
  const rest = source.slice(startMatch.index);
  const close = /^}\s*$/m.exec(rest);
  return close ? rest.slice(0, close.index + close[0].length).trim() : "";
}

function sameFunction(current, baseline, name) {
  const currentBlock = withoutInvitationContextHooks(extractFunction(current, name));
  const baselineBlock = extractFunction(baseline, name);
  return Boolean(currentBlock && baselineBlock && hash(currentBlock) === hash(baselineBlock));
}

function functionNames(source) {
  return [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
    .map(match => match[1]);
}

function extractRuntime(indexSource) {
  const runtimeStart = indexSource.search(/(?:const|let) SUPABASE_URL\b/);
  const open = indexSource.lastIndexOf("<script>", runtimeStart);
  const close = indexSource.indexOf("</script>", runtimeStart);
  return runtimeStart >= 0 && open >= 0 && close >= 0
    ? indexSource.slice(open + "<script>".length, close).trim()
    : "";
}

function cssRule(source, selector) {
  const start = source.indexOf(selector);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return open >= 0 && close >= 0 ? source.slice(start, close + 1) : "";
}

function normalizeStaffRenderer(block) {
  return block
    .replace(
      'class="scroll-panel df-data-table-region df-staff-directory-region"',
      'class="scroll-panel df-data-table-region"'
    )
    .replace(
      '<table class="df-data-table df-staff-table" aria-label="Current DoorFlow staff profiles and editable access settings">\n                  <thead>',
      '<table class="df-data-table df-staff-table">\n                  <caption class="sr-only">Current DoorFlow staff profiles and editable access settings</caption>\n                  <thead>'
    )
    .replace(
      '<td class="df-staff-action-cell" data-label="Action"><button form="staff-${profile.id}" class="btn small df-staff-save-button" type="submit">Save</button></td>',
      '<td data-label="Action"><button form="staff-${profile.id}" class="btn small" type="submit">Save</button></td>'
    )
    .replace(
      'class="card df-admin-card df-role-guide df-staff-guidance-card"',
      'class="card df-admin-card df-role-guide"'
    )
    .replace(
      'class="card df-admin-card df-staff-guidance-card"',
      'class="card df-admin-card"'
    );
}

function normalizeP81bRuntime(source) {
  return source.replace(currentServiceControlsBootstrap, baselineServiceControlsBootstrap);
}

let failures = 0;

function check(condition, label) {
  if (condition) {
    console.log(`[PASS] ${label}`);
    return;
  }
  failures += 1;
  console.error(`[FAIL] ${label}`);
}

const appSource = read("app.js");
check(hasInvitationContextHooks(appSource, extractFunction), "all narrowly authorized invitation ownership/reset hooks remain present at their exact boundaries");
const indexSource = read("index.html");
const themeSource = read("doorflow-operational-theme.css");
const swSource = read("sw.js");
const manifestSource = read("manifest.webmanifest");
const p81SmokeSource = read("scripts/p8-1-mobile-management-smoke.mjs");
const baselineApp = fromBaseline("app.js");
const baselineIndex = fromBaseline("index.html");
const phase82BaselineApp = fromPhase82Baseline("app.js");
const phase82BaselineIndex = fromPhase82Baseline("index.html");
const baselineTheme = fromBaseline("doorflow-operational-theme.css");
const baselineSw = fromBaseline("sw.js");
const baselineManifest = fromBaseline("manifest.webmanifest");
const runtimeSource = extractRuntime(indexSource);
const currentStaffRenderer = extractFunction(appSource, "renderStaffManagement");
const baselineStaffRenderer = extractFunction(baselineApp, "renderStaffManagement");
const phase82BaselineStaffRenderer = extractFunction(phase82BaselineApp, "renderStaffManagement");
const phase82BaselineRuntime = extractRuntime(phase82BaselineIndex);
const p81aMarker = "/* Phase P8.1A: mobile Staff layout repair. */";
const p81bMarker = "/* Phase P8.1B: compact shared service controls in short mobile landscape. */";
const p81aIndex = themeSource.indexOf(p81aMarker);
const p81bIndex = themeSource.indexOf(p81bMarker);
const p81aCss = p81aIndex >= 0
  ? themeSource.slice(p81aIndex, p81bIndex >= 0 ? p81bIndex : undefined)
  : "";

check(git(["branch", "--show-current"]).trim() === requiredBranch, "required production main branch is checked out");
let baselineIsAncestor = true;
try {
  execFileSync("git", ["merge-base", "--is-ancestor", baselineCommit, "HEAD"], { cwd:root, stdio:"ignore" });
} catch {
  baselineIsAncestor = false;
}
check(baselineIsAncestor, "HEAD descends from production baseline 062fbe9");
let phase82BaselineIsAncestor = true;
try {
  execFileSync("git", ["merge-base", "--is-ancestor", phase82BaselineCommit, "HEAD"], { cwd:root, stdio:"ignore" });
} catch {
  phase82BaselineIsAncestor = false;
}
check(phase82BaselineIsAncestor, "HEAD descends from approved Phase 8.2A baseline 7144c3d");

check(Boolean(runtimeSource), "active inline runtime is present");
check(runtimeSource === appSource.trim(), "entire inline runtime and app.js mirror are synchronized");
try {
  new Function(runtimeSource);
  check(true, "inline runtime JavaScript parses");
} catch (error) {
  check(false, `inline runtime JavaScript parses: ${error.message}`);
}

check(
  hash(normalizeStaffRenderer(phase82BaselineStaffRenderer)) === hash(baselineStaffRenderer),
  "approved 7144c3d Staff renderer differs from 062fbe9 only by the authorized accessibility and CSS hooks"
);
check(
  phase82BaselineApp.includes(currentServiceControlsBootstrap)
    && hash(normalizeP81bRuntime(phase82BaselineApp).replace(phase82BaselineStaffRenderer, baselineStaffRenderer)) === hash(baselineApp),
  "approved 7144c3d runtime outside the authorized Staff renderer and compact media bootstrap is byte-identical to 062fbe9"
);
const historicalNormalizedIndex = phase82BaselineIndex
  .replace(phase82BaselineRuntime, baselineApp.trim())
  .replace("/doorflow-operational-theme.css?v=p8.1b", "/doorflow-operational-theme.css?v=p8.1");
check(hash(historicalNormalizedIndex) === hash(baselineIndex), "approved 7144c3d index changes are limited to the mirrored authorized runtime and p8.1b cache key");
const phase82NormalizedIndex = withoutRootCredentialScrub(withoutConfigBootstrapHeader(indexSource))
  .replace(runtimeSource, phase82BaselineRuntime)
  .replace("/doorflow-operational-theme.css?v=p8.2", "/doorflow-operational-theme.css?v=p8.1b");
check(hash(phase82NormalizedIndex) === hash(phase82BaselineIndex), "current index differs from 7144c3d only by the exact root credential scrub, authorized P8.2A runtime, and cache key");

check(
  !currentStaffRenderer.includes("<caption")
    && count(currentStaffRenderer, /aria-label="Current DoorFlow staff profiles and editable access settings"/g) === 1,
  "visible Staff caption is removed while the directory retains its accessible name"
);
check(
  currentStaffRenderer.includes('class="scroll-panel df-data-table-region df-staff-directory-region"')
    && currentStaffRenderer.includes('class="df-data-table df-staff-table"'),
  "Current Staff directory has stable scoped table and region hooks"
);
check(
  currentStaffRenderer.indexOf('id="staff-management-title"')
      < currentStaffRenderer.indexOf('id="current-staff-title"')
    && currentStaffRenderer.indexOf('id="current-staff-title"')
      < currentStaffRenderer.indexOf("df-staff-directory-region")
    && currentStaffRenderer.indexOf("df-staff-directory-region")
      < currentStaffRenderer.indexOf("<aside")
    && currentStaffRenderer.indexOf("<aside")
      < currentStaffRenderer.indexOf("How to Add Staff")
    && currentStaffRenderer.indexOf("How to Add Staff")
      < currentStaffRenderer.indexOf("Role Guide"),
  "Staff controls, full directory, How to Add Staff, and Role Guide retain logical source order"
);
check(
  count(currentStaffRenderer, /df-staff-guidance-card/g) === 2
    && currentStaffRenderer.includes('<aside class="stack" aria-label="Staff administration guidance">'),
  "guidance remains two normal-flow cards after the directory"
);

check(
  count(currentStaffRenderer, /id="staff-\$\{profile\.id\}"/g) === 1
    && count(currentStaffRenderer, /form="staff-\$\{profile\.id\}"/g) === 3
    && currentStaffRenderer.includes('onsubmit="updateStaffProfile(event)"')
    && currentStaffRenderer.includes('name="full_name"')
    && currentStaffRenderer.includes('name="role"')
    && currentStaffRenderer.includes('name="active"')
    && currentStaffRenderer.includes('class="btn small df-staff-save-button" type="submit">Save</button>'),
  "existing staff-* form, field, select, and Save submit associations remain"
);
check(
  currentStaffRenderer.includes("if (!perms().users)")
    && appSource.includes('admin:   { label:"Admin",      door:true,  manage:true,  users:true,  reports:true }')
    && appSource.includes('manager: { label:"Management", door:true,  manage:true,  users:false, reports:true }')
    && appSource.includes('door:    { label:"Door Staff", door:true,  manage:false, users:false, reports:false }')
    && appSource.includes('viewer:  { label:"Viewer",     door:false, manage:false, users:false, reports:true }'),
  "existing Admin-only Staff permission model remains logic-driven"
);
for (const name of [
  "updateStaffProfile",
  "loadStaffProfilesForAdmin",
  "requirePerm",
  "renderTopbar",
  "toggleServiceControls",
  "syncServiceControlsResponsiveLayout",
  "serviceControlsAccessibleLabel"
]) {
  check(
    hash(withoutInvitationContextHooks(extractFunction(appSource, name))) === hash(extractFunction(baselineApp, name)),
    `${name} matches 062fbe9 after exact invitation-only ownership hooks`
  );
}
const refreshStaffProfiles = extractFunction(appSource, "refreshStaffProfiles");
check(
  refreshStaffProfiles.includes('if (!requirePerm("users")) return;')
    && refreshStaffProfiles.includes("await Promise.all([loadStaffProfilesForAdmin(), loadStaffInvitationsForAdmin()]);")
    && count(refreshStaffProfiles, /loadStaffProfilesForAdmin\(\)/g) === 1
    && count(refreshStaffProfiles, /loadStaffInvitationsForAdmin\(\)/g) === 1
    && refreshStaffProfiles.indexOf("await Promise.all") < refreshStaffProfiles.indexOf("render();"),
  "refreshStaffProfiles retains the permission gate, refreshes both Staff surfaces once, awaits them, then renders"
);

const phase82ChangedFunctions = new Set([
  "initAuth",
  "logout",
  "syncModalFocus",
  "refreshStaffProfiles",
  "switchView",
  "closeModal",
  "renderStaffManagement",
  "renderModal"
]);
const phase82ExpectedNewFunctions = new Set([
  "staffInvitationContextIdentity",
  "syncStaffInvitationContext",
  "captureStaffInvitationContext",
  "ownsStaffInvitationContext",
  "normalizeStaffInvitation",
  "validStaffInvitationTimestamp",
  "coherentStaffInvitationReceipt",
  "validatedStaffInvitation",
  "newStaffInvitationIdempotencyKey",
  "emptyStaffInviteDraft",
  "resetStaffInvitationState",
  "staffInvitationEndpointUrl",
  "staffInvitationSetupError",
  "callStaffInvitationEndpoint",
  "mergeStaffInvitation",
  "loadStaffInvitationsForAdmin",
  "updateStaffInviteDraft",
  "handleStaffInviteRoleChange",
  "openStaffInviteModal",
  "submitStaffInvitation",
  "runStaffInvitationAction",
  "retryStaffInvitation",
  "resendStaffInvitation",
  "staffInvitationStatusLabel",
  "staffInvitationStatusClass",
  "staffInvitationLastActivity",
  "staffInvitationOutcomeNotice",
  "renderStaffInviteModal"
]);
const phase82BaselineFunctionNames = [...new Set(functionNames(phase82BaselineApp))];
const phase82CurrentFunctionNames = new Set(functionNames(appSource));
const phase82ProtectedMismatches = phase82BaselineFunctionNames.filter(name => (
  !phase82ChangedFunctions.has(name) && !sameFunction(appSource, phase82BaselineApp, name)
));
const phase82UnexpectedRemovedFunctions = phase82BaselineFunctionNames.filter(name => !phase82CurrentFunctionNames.has(name));
const phase82UnexpectedNewFunctions = [...phase82CurrentFunctionNames].filter(name => (
  !phase82BaselineFunctionNames.includes(name) && !phase82ExpectedNewFunctions.has(name)
));
const phase82MissingExpectedNewFunctions = [...phase82ExpectedNewFunctions].filter(name => !phase82CurrentFunctionNames.has(name));
check(
  phase82ProtectedMismatches.length === 0
    && phase82UnexpectedRemovedFunctions.length === 0
    && phase82UnexpectedNewFunctions.length === 0
    && phase82MissingExpectedNewFunctions.length === 0,
  "every function outside the exact Phase 8.2A allowlist remains byte-identical to 7144c3d"
);
if (phase82ProtectedMismatches.length) console.error(`       Unexpected Phase 8.2A changes: ${phase82ProtectedMismatches.join(", ")}`);
if (phase82UnexpectedRemovedFunctions.length) console.error(`       Unexpected Phase 8.2A removals: ${phase82UnexpectedRemovedFunctions.join(", ")}`);
if (phase82UnexpectedNewFunctions.length) console.error(`       Unexpected Phase 8.2A additions: ${phase82UnexpectedNewFunctions.join(", ")}`);
if (phase82MissingExpectedNewFunctions.length) console.error(`       Missing Phase 8.2A functions: ${phase82MissingExpectedNewFunctions.join(", ")}`);

check(count(themeSource, new RegExp(p81aMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) === 1, "one Phase P8.1A CSS appendix exists");
const compactMediaHeader = `@media ${compactServiceControlsQuery} {`;
const baselineCompactMediaHeader = `@media ${baselineCompactServiceControlsQuery} {`;
const normalizedThemePrefix = p81aIndex >= 0
  ? themeSource.slice(0, p81aIndex).replace(compactMediaHeader, baselineCompactMediaHeader).trimEnd()
  : "";
check(
  p81aIndex >= 0
    && themeSource.slice(0, p81aIndex).includes(compactMediaHeader)
    && hash(normalizedThemePrefix) === hash(baselineTheme.trimEnd()),
  "CSS through Phase 8.1 differs from 062fbe9 only by the authorized compact media header"
);
check(p81aCss.includes("@media (max-width: 860px)"), "Staff card repair activates at 860px and below");

const directoryRule = cssRule(p81aCss, ".df-staff-page .df-staff-workspace .scroll-panel.df-data-table-region.df-staff-directory-region");
const actionRule = cssRule(p81aCss, ".df-staff-page .df-staff-table tbody .df-staff-action-cell");
const controlRule = cssRule(p81aCss, ".df-staff-page .df-staff-table tbody td input");
const saveRule = cssRule(p81aCss, ".df-staff-page .df-staff-table tbody .df-staff-save-button");
const asideRule = cssRule(p81aCss, ".df-staff-page .df-staff-workspace > aside");

check(
  directoryRule.includes("max-height: none")
    && directoryRule.includes("height: auto")
    && directoryRule.includes("overflow: visible")
    && directoryRule.includes("overscroll-behavior: auto"),
  "mobile Staff directory removes the height cap and returns scrolling to the document"
);
check(
  actionRule.includes("width: 100%") && actionRule.includes("white-space: normal"),
  "mobile Action cell overrides the desktop one-percent width and nowrap constraint"
);
check(
  controlRule.includes("width: 100%")
    && controlRule.includes("min-width: 0")
    && controlRule.includes("min-height: 44px"),
  "mobile Staff inputs and selects are full-width 44px controls"
);
check(
  saveRule.includes("width: 100%")
    && saveRule.includes("min-width: 5rem")
    && saveRule.includes("min-height: 44px")
    && saveRule.includes("white-space: normal"),
  "mobile Save button has a visible label, safe width, and 44px target"
);
check(asideRule.includes("position: static") && asideRule.includes("align-self: stretch"), "mobile guidance aside remains in normal static flow");
check(
  p81aCss.includes("@media (max-width: 680px), (max-height: 520px) and (orientation: landscape)")
    && p81aCss.includes("grid-template-columns: minmax(0, 1fr)"),
  "phone portrait and short-landscape Staff cells place labels above controls"
);
check(
  !/position:\s*(?:absolute|fixed|sticky)|\bz-index\s*:|margin(?:-[a-z]+)?\s*:\s*-|overflow(?:-[xy])?\s*:\s*(?:hidden|clip)/i.test(p81aCss),
  "Phase 8.1A uses no overlapping position, z-index, negative-margin, or overflow-concealment workaround"
);

check(count(indexSource, /\/doorflow-operational-theme\.css\?v=p8\.2(?=["'])/g) === 1, "index uses exactly one p8.2 stylesheet URL");
check(!/\/doorflow-operational-theme\.css\?v=p8\.1b(?=["'])/.test(indexSource), "no exact p8.1b stylesheet URL remains active");
check(!/\/doorflow-operational-theme\.css\?v=p8\.1a(?=["'])/.test(indexSource), "no exact p8.1a stylesheet URL remains active");
check(!/\/doorflow-operational-theme\.css\?v=p8\.1(?=["'])/.test(indexSource), "no exact p8.1 stylesheet URL remains active");
check(count(indexSource, /<link[^>]+doorflow-operational-theme\.css/gi) === 1, "one operational theme link remains");

check(
  hash(withoutCredentialNavigationHardening(withoutEnvironmentCacheSafety(swSource))) === hash(baselineSw),
  "service worker differs from 062fbe9 only by credential-navigation and exact environment-cache safeguards"
);
check(hash(manifestSource) === hash(baselineManifest), "manifest remains byte-identical to 062fbe9");
try {
  JSON.parse(manifestSource);
  check(true, "manifest JSON parses");
} catch (error) {
  check(false, `manifest JSON parses: ${error.message}`);
}
const versionedCssPath = new URL("http://127.0.0.1/doorflow-operational-theme.css?v=p8.2").pathname;
check(
  swSource.includes('const CACHE_NAME = "doorflow-cache-v31";')
    && swSource.includes('"/doorflow-operational-theme.css"')
    && swSource.includes("purgeCredentialBearingCacheEntries(CACHE_NAME)")
    && swSource.includes("if (isNavigation && hasAuthCredentialParameters(url)) return;")
    && swSource.includes("event.respondWith(networkFirstNavigation(request, url.pathname))")
    && versionedCssPath === "/doorflow-operational-theme.css",
  "cache-v31 ordinary shell behavior remains while credential navigations bypass and purge"
);

const currentRuntimeSurface = withoutConfigRestoreListener(`${appSource}\n${indexSource}\n${swSource}`);
const baselineRuntimeSurface = `${baselineApp}\n${baselineIndex}\n${baselineSw}`;
for (const [label, pattern] of [
  ["Supabase client", /\.createClient\s*\(/g],
  ["fetch", /\bfetch\s*\(/g],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/g],
  ["timer", /\bset(?:Timeout|Interval)\s*\(/g],
  ["event listener", /\.addEventListener\s*\(/g],
  ["localStorage", /\blocalStorage\b/g],
  ["sessionStorage", /\bsessionStorage\b/g]
]) {
  const wording = label === "fetch" ? "no new low-level fetch implementation sites" : `no new ${label} sites`;
  check(count(currentRuntimeSurface, pattern) === count(baselineRuntimeSurface, pattern), wording);
}
check(!/\b(?:google-analytics|googletagmanager|segment|mixpanel|posthog|sentry)\b/i.test(`${appSource}\n${indexSource}\n${themeSource}`), "no analytics integration is introduced");
const externalAssets = source => [...source.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["'](https?:\/\/[^"']+)/gi)].map(match => match[1]).sort();
check(externalAssets(indexSource).join("|") === externalAssets(baselineIndex).join("|"), "external dependency inventory is unchanged");

const baselineTracked = git(["ls-tree", "-r", "--name-only", baselineCommit]).trim().split("\n").filter(Boolean).sort();
const currentTracked = git(["ls-files"]).trim().split("\n").filter(Boolean).sort();
const currentUntracked = git(["ls-files", "--others", "--exclude-standard"]).trim().split("\n").filter(Boolean);
const currentWorkingFiles = [...new Set([...currentTracked, ...currentUntracked])].sort();
const databaseGuarded = path => path.toLowerCase().endsWith(".sql") || /policy_snapshot\.csv$/i.test(path);
const baselineDatabaseFiles = baselineTracked.filter(databaseGuarded);
const currentDatabaseFiles = currentWorkingFiles.filter(databaseGuarded);
const allowedPhase82DatabaseFiles = new Set(["supabase/review/phase_8_2a_staff_invitations_review.sql", "supabase/review/phase_8_2b_single_venue_staff_review.sql"]);
const unexpectedDatabaseFiles = currentDatabaseFiles.filter(path => (
  !baselineDatabaseFiles.includes(path) && !allowedPhase82DatabaseFiles.has(path)
));
check(
  unexpectedDatabaseFiles.length === 0
    && baselineDatabaseFiles.every(path => currentDatabaseFiles.includes(path) && hash(read(path)) === hash(fromBaseline(path))),
  "pre-existing SQL, RLS, policy, migration, and policy-snapshot files remain unchanged; only the exact invitation and single-venue review SQL may be added"
);
const dependencyFile = path => /(^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(path);
check(currentTracked.filter(dependencyFile).join("|") === baselineTracked.filter(dependencyFile).join("|"), "no dependency manifest or lockfile is added");

check(
  p81SmokeSource.includes('const productionBranch = "main";')
    && p81SmokeSource.includes("p8.2 stylesheet URL")
    && p81SmokeSource.includes('"renderStaffManagement"')
    && p81SmokeSource.includes('"scripts/p8-1a-staff-mobile-smoke.mjs"')
    && p81SmokeSource.includes('"scripts/p8-1b-landscape-header-smoke.mjs"'),
  "legacy Phase 8.1 smoke has only the required cumulative-validation compatibility hooks"
);

const allowedChanges = new Set([
  ...stagingSafetyFiles,
  "scripts/p6-checkin-race-smoke.mjs",
  "app.js",
  "index.html",
  "sw.js",
  "doorflow-operational-theme.css",
  "scripts/p8-1-mobile-management-smoke.mjs",
  "scripts/p8-1a-staff-mobile-smoke.mjs",
  "scripts/p8-1b-landscape-header-smoke.mjs",
  "scripts/p8-2a-edge-function.test.mjs",
  "scripts/p8-2a-adapter-validation.test.ts",
  "scripts/p8-2a-audit-contract.test.ts",
  "scripts/p8-2a-invitation-context.browser.test.mjs",
  "scripts/p8-2a-browser-resources.mjs",
  "scripts/p8-2a-context-comparison.mjs",
  "supabase/functions/staff-invitations/audit.ts",
  "supabase/functions/staff-invitations/rpc-validation.ts",
  "scripts/p8-2a-staff-invitations-smoke.mjs",
  "docs/PHASE_8_2A_STAFF_INVITATIONS_DEPLOYMENT.md",
  "_headers",
  "vercel.json",
  "auth/index.html",
  "auth/accept-invite.css",
  "auth/accept-invite.js",
  "auth/accept-invite.browser.test.mjs",
  "auth/invite-acceptance-core.mjs",
  "auth/invite-acceptance-core.test.mjs",
  "supabase/config.toml",
  "supabase/functions/staff-invitations/core.ts",
  "supabase/functions/staff-invitations/index.ts",
  "supabase/functions/staff-invitations/deno.json",
  "supabase/review/phase_8_2a_staff_invitations_review.sql"
]);
const statusRecords = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
const statusPaths = statusRecords.map(record => record.slice(3).replaceAll("\\", "/"));
check(statusPaths.every(path => allowedChanges.has(path) || path.startsWith(".codex/")), "working-tree changes stay within authorized Phase 8.1A/8.1B files");
const codexRecords = statusRecords.filter(record => record.slice(3).replaceAll("\\", "/").startsWith(".codex/"));
check(codexRecords.every(record => record.startsWith("?? ")) && !currentTracked.some(path => path.startsWith(".codex/")), ".codex remains absent or wholly untracked");
check(git(["diff", "--cached", "--name-only"]).trim() === "", "nothing is staged");

if (failures) {
  console.error(`\nPhase 8.1A Staff mobile smoke failed with ${failures} issue${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("\nPhase 8.1A Staff mobile smoke passed.");
console.log("Static checks do not prove real-iPhone rendering, authenticated Staff access, live staff mutations, responsive zoom behavior, realtime delivery, or installed-PWA lifecycle; complete owner testing with approved non-production records.");
