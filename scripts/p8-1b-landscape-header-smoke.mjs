import { retiredReleaseScope, hasFoundationInvitationContext } from "./historical-release-scope.mjs";
import { extractAppRuntime as currentAppRuntime } from "./p8-2b-static-comparison.mjs";
import { withoutEnvironmentCacheSafety, withoutConfigRestoreListener, withoutConfigBootstrapHeader, stagingSafetyFiles } from "./p8-2b-static-comparison.mjs";
import { createHash } from "node:crypto";
import { hasInvitationContextHooks, withoutInvitationContextHooks } from "./p8-2a-context-comparison.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const baselineCommit = "062fbe9";
const phase82BaselineCommit = "7144c3d6a19e81ac2b5df191958171242b4ea5e9";
const requiredBranch = "main";
const baselineCompactQuery = "(max-width: 540px)";
const compactQuery = "(max-width: 540px), (orientation: landscape) and (max-height: 500px) and (max-width: 900px)";
const shortLandscapeQuery = "(orientation: landscape) and (max-height: 500px) and (max-width: 900px)";
const baselineServiceControlsBootstrap = `const serviceControlsPhoneMedia = typeof window.matchMedia === "function"
  ? window.matchMedia("${baselineCompactQuery}")
  : null;
let serviceControlsPhoneLayout = serviceControlsPhoneMedia
  ? serviceControlsPhoneMedia.matches
  : window.innerWidth <= 540;`;
const currentServiceControlsBootstrap = `const serviceControlsPhoneMedia = typeof window.matchMedia === "function"
  ? window.matchMedia("${compactQuery}")
  : null;
let serviceControlsPhoneLayout = serviceControlsPhoneMedia
  ? serviceControlsPhoneMedia.matches
  : window.innerWidth <= 540
    || (window.innerWidth <= 900 && window.innerHeight <= 500 && window.innerWidth > window.innerHeight);`;
const p81Marker = "/* Phase P8.1: mobile guest management and collapsible shared service controls. */";
const p81aMarker = "/* Phase P8.1A: mobile Staff layout repair. */";
const p81bMarker = "/* Phase P8.1B: compact shared service controls in short mobile landscape. */";
const p82aMarker = "/* Phase P8.2A: in-app Staff invitations and provisioning status. */";
const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
}

function git(args) {
  return execFileSync("git", ["-c", `safe.directory=${root}`, ...args], { cwd:root, encoding:"utf8" }).replaceAll("\r\n", "\n");
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

function extractRuntime(source) {
  return currentAppRuntime(source);
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

function cssRule(source, selector) {
  const start = source.indexOf(selector);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return open >= 0 && close >= 0 ? source.slice(start, close + 1) : "";
}

function extractMediaBlocks(source) {
  const blocks = [];
  const pattern = /@media\s+([^{}]+)\{/g;
  let match;
  while ((match = pattern.exec(source))) {
    const open = pattern.lastIndex - 1;
    let depth = 1;
    let close = open + 1;
    while (close < source.length && depth > 0) {
      if (source[close] === "{") depth += 1;
      if (source[close] === "}") depth -= 1;
      close += 1;
    }
    if (depth !== 0) break;
    blocks.push({
      query:match[1].trim().replace(/\s+/g, " "),
      body:source.slice(open + 1, close - 1),
      full:source.slice(match.index, close),
      start:match.index
    });
    pattern.lastIndex = close;
  }
  return blocks;
}

function selectorsFromFlatBlock(body) {
  const selectors = [];
  let cursor = 0;
  while (cursor < body.length) {
    const open = body.indexOf("{", cursor);
    if (open < 0) break;
    const close = body.indexOf("}", open);
    if (close < 0) return [];
    const group = body.slice(cursor, open).trim();
    if (!group || group.includes("@")) return [];
    selectors.push(...group.split(",").map(value => value.trim()).filter(Boolean));
    cursor = close + 1;
  }
  return selectors;
}

function matchesMediaQuery(query, width, height) {
  return query.split(",").some(branch => (
    branch.trim().split(/\s+and\s+/i).every(rawFeature => {
      const feature = rawFeature.trim();
      const orientation = /^\(orientation:\s*(portrait|landscape)\)$/i.exec(feature);
      if (orientation) {
        return orientation[1].toLowerCase() === "landscape" ? width > height : height >= width;
      }
      const dimension = /^\((max|min)-(width|height):\s*(\d+)px\)$/i.exec(feature);
      if (!dimension) throw new Error(`Unsupported media feature: ${feature}`);
      const actual = dimension[2].toLowerCase() === "width" ? width : height;
      const limit = Number(dimension[3]);
      return dimension[1].toLowerCase() === "max" ? actual <= limit : actual >= limit;
    })
  ));
}

function fallbackMatches(width, height) {
  return width <= 540 || (width <= 900 && height <= 500 && width > height);
}

let failures = 0;

function check(condition, label) {
  if (retiredReleaseScope(label)) return;
  if (condition) {
    console.log(`[PASS] ${label}`);
    return;
  }
  failures += 1;
  console.error(`[FAIL] ${label}`);
}

const appSource = read("app.js");
check(hasFoundationInvitationContext(appSource, extractFunction), "invitation state follows mandatory authenticated-context invalidation and guarded same-venue Staff loads");
const indexSource = read("index.html");
const themeSource = read("doorflow-operational-theme.css");
const swSource = read("sw.js");
const manifestSource = read("manifest.webmanifest");
const p81SmokeSource = read("scripts/p8-1-mobile-management-smoke.mjs");
const p81aSmokeSource = read("scripts/p8-1a-staff-mobile-smoke.mjs");
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
const p81Index = themeSource.indexOf(p81Marker);
const p81aIndex = themeSource.indexOf(p81aMarker);
const p81bIndex = themeSource.indexOf(p81bMarker);
const p82aIndex = themeSource.indexOf(p82aMarker);
const p81aCss = p81aIndex >= 0 && p81bIndex > p81aIndex ? themeSource.slice(p81aIndex, p81bIndex) : "";
const p81bCss = p81bIndex >= 0
  ? themeSource.slice(p81bIndex, p82aIndex > p81bIndex ? p82aIndex : undefined)
  : "";

check(git(["branch", "--show-current"]).trim() === requiredBranch, "required production main branch is checked out");
let baselineIsAncestor = true;
try {
  execFileSync("git", ["-c", `safe.directory=${root}`, "merge-base", "--is-ancestor", baselineCommit, "HEAD"], { cwd:root, stdio:"ignore" });
} catch {
  baselineIsAncestor = false;
}
check(baselineIsAncestor, "HEAD descends from production baseline 062fbe9");
let phase82BaselineIsAncestor = true;
try {
  execFileSync("git", ["-c", `safe.directory=${root}`, "merge-base", "--is-ancestor", phase82BaselineCommit, "HEAD"], { cwd:root, stdio:"ignore" });
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
  count(appSource, /const serviceControlsPhoneMedia =/g) === 1
    && appSource.includes(currentServiceControlsBootstrap)
    && !appSource.includes(baselineServiceControlsBootstrap),
  "runtime contains exactly the bounded compact-layout matchMedia query and equivalent no-matchMedia fallback"
);

const compactMediaBlocks = extractMediaBlocks(themeSource).filter(block => (
  block.body.includes(".df-service-controls-toggle")
    && block.body.includes('[data-service-controls-mobile-layout="true"][data-service-controls-expanded="false"] .df-service-controls')
));
check(compactMediaBlocks.length === 1, "one CSS media block owns the compact service-control disclosure");
const cssCompactQuery = compactMediaBlocks[0]?.query || "";
check(cssCompactQuery === compactQuery, "CSS compact service-control condition is the required phone-or-short-landscape query");
check(cssCompactQuery === compactQuery && appSource.includes(`window.matchMedia("${cssCompactQuery}")`), "service-control JavaScript and CSS conditions agree exactly");

const viewportCases = [
  { width:844, height:390, expected:true, label:"844 x 390 iPhone landscape uses compact controls" },
  { width:667, height:375, expected:true, label:"667 x 375 iPhone landscape uses compact controls" },
  { width:390, height:844, expected:true, label:"390 x 844 phone portrait keeps compact controls" },
  { width:540, height:960, expected:true, label:"540px phone-width boundary keeps compact controls" },
  { width:541, height:960, expected:false, label:"non-short viewport above phone width stays expanded" },
  { width:900, height:500, expected:true, label:"short-landscape upper bounds remain compact" },
  { width:901, height:500, expected:false, label:"short landscape is capped at 900px width" },
  { width:900, height:501, expected:false, label:"landscape above 500px height stays expanded" },
  { width:1024, height:768, expected:false, label:"1024 x 768 tablet landscape stays expanded" },
  { width:1180, height:800, expected:false, label:"1180 x 800 desktop stays expanded" }
];
for (const scenario of viewportCases) {
  let cssMatches = false;
  try {
    cssMatches = matchesMediaQuery(cssCompactQuery, scenario.width, scenario.height);
  } catch (error) {
    check(false, `${scenario.label}: ${error.message}`);
    continue;
  }
  check(
    cssMatches === scenario.expected
      && fallbackMatches(scenario.width, scenario.height) === scenario.expected,
    scenario.label
  );
}

const normalizedRuntime = phase82BaselineApp
  .replace(currentServiceControlsBootstrap, baselineServiceControlsBootstrap)
  .replace(phase82BaselineStaffRenderer, baselineStaffRenderer);
check(
  hash(normalizeStaffRenderer(phase82BaselineStaffRenderer)) === hash(baselineStaffRenderer),
  "approved 7144c3d Phase 8.1A Staff renderer differs only by its authorized accessibility and layout hooks"
);
check(
  hash(normalizedRuntime) === hash(baselineApp),
  "approved 7144c3d app.js differs from 062fbe9 only by Phase 8.1A Staff hooks and the Phase 8.1B compact media bootstrap"
);
const historicalNormalizedIndex = phase82BaselineIndex
  .replace(phase82BaselineRuntime, baselineApp.trim())
  .replace("/doorflow-operational-theme.css?v=p8.1b", "/doorflow-operational-theme.css?v=p8.1");
check(hash(historicalNormalizedIndex) === hash(baselineIndex), "approved 7144c3d index differs from 062fbe9 only by the mirrored authorized runtime and p8.1b cache key");
const phase82NormalizedIndex = withoutRootCredentialScrub(withoutConfigBootstrapHeader(indexSource))
  .replace(runtimeSource, phase82BaselineRuntime)
  .replace("/doorflow-operational-theme.css?v=p8.2", "/doorflow-operational-theme.css?v=p8.1b");
check(hash(phase82NormalizedIndex) === hash(phase82BaselineIndex), "current index differs from 7144c3d only by the exact root credential scrub, authorized P8.2A runtime, and cache key");

for (const name of [
  "renderTopbar",
  "renderServiceControlsSummary",
  "serviceControlsAccessibleLabel",
  "syncServiceControlsDisclosure",
  "focusServiceControlsToggleBeforeHide",
  "syncServiceControlsResponsiveLayout",
  "handleServiceControlsBreakpointChange",
  "toggleServiceControls",
  "updateStaffProfile",
  "loadStaffProfilesForAdmin",
  "requirePerm",
  "checkInOneGuest",
  "undoOneGuest",
  "requestRealtimeRefresh",
  "subscribeRealtime"
]) {
  check(
    hash(withoutInvitationContextHooks(extractFunction(appSource, name))) === hash(extractFunction(baselineApp, name)),
    `${name} matches 062fbe9 after exact invitation-only ownership hooks`
  );
}
const refreshStaffProfiles = extractFunction(appSource, "refreshStaffProfiles");
check(
  refreshStaffProfiles.includes('if (!requirePerm("users")) return;')
    && refreshStaffProfiles.includes("await contextRequest(Promise.all([loadStaffProfilesForAdmin(), loadStaffInvitationsForAdmin()]), operationOwner);")
    && count(refreshStaffProfiles, /loadStaffProfilesForAdmin\(\)/g) === 1
    && count(refreshStaffProfiles, /loadStaffInvitationsForAdmin\(\)/g) === 1
    && refreshStaffProfiles.indexOf("await contextRequest(Promise.all") < refreshStaffProfiles.indexOf("render();"),
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

const compactBlock = compactMediaBlocks[0]?.body || "";
const toggleRule = cssRule(compactBlock, ".df-service-controls-toggle");
const collapsedRule = cssRule(compactBlock, '[data-service-controls-mobile-layout="true"][data-service-controls-expanded="false"] .df-service-controls');
const compactControlsRule = cssRule(compactBlock, ".df-service-controls {");
check(
  toggleRule.includes("display: flex")
    && toggleRule.includes("width: 100%")
    && toggleRule.includes("min-height: 44px")
    && collapsedRule.includes("display: none")
    && compactControlsRule.includes("grid-template-columns: minmax(0, 1fr)"),
  "P8.1 disclosure, 44px toggle, collapsed gate, and one-column expanded controls remain"
);
check(
  appSource.includes('data-service-controls-mobile-layout=')
    && appSource.includes('aria-controls="df-service-controls"')
    && appSource.includes('type="date"')
    && appSource.includes('serviceControlsPhoneMedia.addEventListener("change", handleServiceControlsBreakpointChange)')
    && appSource.includes("serviceControlsPhoneMedia?.addListener?.(handleServiceControlsBreakpointChange)"),
  "native date input, disclosure semantics, and focus-safe breakpoint listener remain"
);

const baselineCompactHeader = `@media ${baselineCompactQuery} {`;
const compactHeader = `@media ${compactQuery} {`;
const normalizedThemePrefix = p81aIndex >= 0
  ? themeSource.slice(0, p81aIndex).replace(compactHeader, baselineCompactHeader).trimEnd()
  : "";
check(
  p81Index >= 0
    && p81aIndex > p81Index
    && p81bIndex > p81aIndex
    && p82aIndex > p81bIndex
    && count(themeSource, new RegExp(p81bMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) === 1,
  "P8.1, P8.1A, P8.1B, and P8.2A CSS sections remain in cumulative order"
);
check(
  themeSource.slice(0, p81aIndex).includes(compactHeader)
    && hash(normalizedThemePrefix) === hash(baselineTheme.trimEnd()),
  "baseline CSS differs before P8.1A only by the authorized compact media header"
);

check(
  p81aCss.includes("@media (max-width: 860px)")
    && p81aCss.includes("max-height: none")
    && p81aCss.includes("overflow: visible")
    && p81aCss.includes(".df-staff-save-button")
    && p81aCss.includes("min-height: 44px")
    && !p81aCss.includes(".df-service-controls")
    && !p81aCss.includes(".df-utility-inner"),
  "P8.1A Staff visibility, flow, and full Save protections remain isolated from the service header"
);
check(
  !currentStaffRenderer.includes("<caption")
    && currentStaffRenderer.includes('aria-label="Current DoorFlow staff profiles and editable access settings"')
    && currentStaffRenderer.indexOf("df-staff-directory-region") < currentStaffRenderer.indexOf("<aside")
    && count(currentStaffRenderer, /form="staff-\$\{profile\.id\}"/g) === 3,
  "approved Staff caption, directory/guidance order, and form associations remain"
);

const p81bMediaBlocks = extractMediaBlocks(p81bCss);
check(
  p81bMediaBlocks.length === 1
    && p81bMediaBlocks[0].query === shortLandscapeQuery
    && p81bCss.slice(p81bMarker.length).trim() === p81bMediaBlocks[0].full.trim(),
  "P8.1B contains one bounded short-landscape support block and no unscoped declarations"
);
const p81bBody = p81bMediaBlocks[0]?.body || "";
const allowedP81bSelectors = new Set([
  ".df-utility-inner",
  ".df-shell-venue",
  ".df-venue-monogram",
  ".df-venue-hierarchy__compact .df-utility-label",
  ".df-user-copy",
  ".df-logout-label",
  ".df-venue-hierarchy__compact strong",
  ".df-venue-scope",
  ".df-user-context",
  ".df-logout-icon",
  ".df-utility-user",
  ".df-utility-user .df-logout-button",
  ".df-shell-service",
  ".df-shell-live .df-shell-service",
  ".df-service-context-row",
  ".df-service-sync-row",
  ".df-service-context-row > .df-service-field",
  ".df-service-context-row > .df-service-field > select",
  ".df-service-context-row > .df-service-field > input",
  ".df-shell-service .sync-pill",
  "#df-service-date",
  ".df-service-context-row > .df-service-field:last-child",
  ".df-shell-service .df-refresh-button",
  ".df-shell-live .df-shell-service .df-refresh-button",
  ".df-refresh-icon",
  ".df-refresh-label"
]);
const p81bSelectors = selectorsFromFlatBlock(p81bBody);
check(
  p81bSelectors.length > 0
    && p81bSelectors.every(selector => allowedP81bSelectors.has(selector))
    && [...allowedP81bSelectors].every(selector => p81bSelectors.includes(selector)),
  "P8.1B CSS is limited to the expected shared-header and service-control selectors"
);

const utilityRule = cssRule(p81bBody, ".df-utility-inner");
const shellRule = cssRule(p81bBody, ".df-shell-service,");
const contextRule = cssRule(p81bBody, ".df-service-context-row {");
const dateRule = cssRule(p81bBody, "#df-service-date");
const gutterRule = cssRule(p81bBody, ".df-service-context-row > .df-service-field:last-child");
check(
  utilityRule.includes("grid-template-columns: 44px minmax(0, 1fr) auto")
    && utilityRule.includes("var(--df-safe-left)")
    && utilityRule.includes("var(--df-safe-right)")
    && shellRule.includes("grid-column: 1 / -1")
    && shellRule.includes("grid-template-columns: minmax(0, 1fr)")
    && shellRule.includes("max-width: 100%"),
  "short landscape keeps the top row compact and the service summary full-width below it"
);
check(
  contextRule.includes("grid-template-columns: minmax(0, 1fr)")
    && dateRule.includes("width: 100%")
    && dateRule.includes("max-inline-size: 100%")
    && gutterRule.includes("--df-mobile-overlay-gutter: 20px")
    && gutterRule.includes("calc(100% - var(--df-mobile-overlay-gutter))"),
  "expanded short-landscape controls stack safely and retain the native date-control gutter"
);
check(
  !/overflow-x:\s*(?:hidden|clip)|width:\s*100vw|::-webkit-calendar-picker-indicator|(?:^|[;{])\s*(?:-webkit-)?appearance\s*:/im.test(p81bCss)
    && !/margin(?:-[a-z]+)?\s*:\s*-|position:\s*(?:absolute|fixed)/i.test(p81bCss),
  "P8.1B adds no horizontal-overflow masking, viewport-width hack, native-date suppression, or overlap workaround"
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
  swSource.includes('const CACHE_NAME = "doorflow-cache-v33";')
    && swSource.includes('"/doorflow-operational-theme.css"')
    && swSource.includes("purgeCredentialBearingCacheEntries(CACHE_NAME)")
    && swSource.includes("if (isNavigation && hasAuthCredentialParameters(url)) return;")
    && swSource.includes("event.respondWith(networkFirstNavigation(request, url.pathname))")
    && versionedCssPath === "/doorflow-operational-theme.css",
  "cache-v33 ordinary shell behavior remains while credential navigations bypass and purge"
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
check(!/\b(?:navigator\.userAgent|userAgentData|platform)\b/.test(appSource), "no user-agent detection is introduced");
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
  p81SmokeSource.includes("p8.2 stylesheet URL")
    && p81SmokeSource.includes("compactServiceControlsQuery")
    && p81SmokeSource.includes('"scripts/p8-1b-landscape-header-smoke.mjs"'),
  "Phase 8.1 cumulative smoke recognizes the p8.1b query, cache key, and focused smoke"
);
check(
  p81aSmokeSource.includes("currentServiceControlsBootstrap")
    && p81aSmokeSource.includes("normalizedThemePrefix")
    && p81aSmokeSource.includes("p8.2 stylesheet URL")
    && p81aSmokeSource.includes('"scripts/p8-1b-landscape-header-smoke.mjs"'),
  "Phase 8.1A smoke narrowly normalizes P8.1B while retaining runtime and CSS-prefix guards"
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
  console.error(`\nPhase 8.1B landscape header smoke failed with ${failures} issue${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("\nPhase 8.1B landscape header smoke passed.");
console.log("Static evaluation verifies the declared media logic and protected source scope; it does not prove real-iPhone rendering, rotation paint behavior, authenticated controls, live mutations, or installed-PWA lifecycle behavior. Complete owner testing on physical devices.");
