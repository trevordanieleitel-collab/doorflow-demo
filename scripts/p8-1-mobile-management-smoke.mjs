import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const baselineCommit = "ead1060";
const requiredBranch = "codex/phase-8-1-mobile-management";
const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
}

function git(args) {
  return execFileSync("git", args, { cwd:root, encoding:"utf8" }).replaceAll("\r\n", "\n");
}

function fromBaseline(path) {
  return git(["show", baselineCommit + ":" + path]);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

function extractFunction(source, name) {
  const escaped = name.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
  const startMatch = new RegExp("^(?:async\\s+)?function\\s+" + escaped + "\\s*\\(", "m").exec(source);
  if (!startMatch) return "";
  const start = startMatch.index;
  const rest = source.slice(start);
  const close = /^}\s*$/m.exec(rest);
  if (!close) return "";
  return rest.slice(0, close.index + close[0].length).trim();
}

function extractRuntime(indexSource) {
  const runtimeStart = indexSource.indexOf("const SUPABASE_URL");
  const open = indexSource.lastIndexOf("<script>", runtimeStart);
  const close = indexSource.indexOf("</script>", runtimeStart);
  return runtimeStart >= 0 && open >= 0 && close >= 0
    ? indexSource.slice(open + "<script>".length, close).trim()
    : "";
}

function canonicalRuntime(source) {
  return String(source || "").replaceAll("\r\n", "\n").trim();
}

function sameFunction(current, baseline, name) {
  const currentBlock = extractFunction(current, name);
  const baselineBlock = extractFunction(baseline, name);
  return Boolean(currentBlock && baselineBlock && hash(currentBlock) === hash(baselineBlock));
}

function functionNames(source) {
  return [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
    .map(match => match[1]);
}

function withoutSessionUiReset(source) {
  return source.replace(/^[ \t]*resetManagementSessionUiState\(\);\r?\n/gm, "");
}

function hasForbiddenWork(source) {
  return /\bdb\b|\.from\s*\(|\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|addEventListener\s*\(|setTimeout\s*\(|setInterval\s*\(/.test(source);
}

let failures = 0;

function check(condition, label) {
  if (condition) {
    console.log("[PASS] " + label);
    return;
  }
  failures += 1;
  console.error("[FAIL] " + label);
}

const appSource = read("app.js");
const indexSource = read("index.html");
const themeSource = read("doorflow-operational-theme.css");
const swSource = read("sw.js");
const manifestSource = read("manifest.webmanifest");
const baselineApp = fromBaseline("app.js");
const baselineIndex = fromBaseline("index.html");
const baselineTheme = fromBaseline("doorflow-operational-theme.css");
const baselineSw = fromBaseline("sw.js");
const baselineManifest = fromBaseline("manifest.webmanifest");
const runtimeSource = extractRuntime(indexSource);
const p81Marker = "/* Phase P8.1: mobile guest management and collapsible shared service controls. */";
const p81Index = themeSource.indexOf(p81Marker);
const p81Css = p81Index >= 0 ? themeSource.slice(p81Index) : "";

check(git(["branch", "--show-current"]).trim() === requiredBranch, "required Phase 8.1 branch is checked out");
let baselineIsAncestor = true;
try {
  execFileSync("git", ["merge-base", "--is-ancestor", baselineCommit, "HEAD"], { cwd:root, stdio:"ignore" });
} catch {
  baselineIsAncestor = false;
}
check(baselineIsAncestor, "HEAD descends from production baseline ead1060");

check(Boolean(runtimeSource), "active inline runtime is present");
check(canonicalRuntime(runtimeSource) === canonicalRuntime(appSource), "entire inline runtime and app.js mirror are synchronized");
try {
  new Function(runtimeSource);
  check(true, "inline runtime JavaScript parses");
} catch (error) {
  check(false, "inline runtime JavaScript parses: " + error.message);
}

check(count(indexSource, /\/doorflow-operational-theme\.css\?v=p8\.1/g) === 1, "index uses exactly one deterministic p8.1 stylesheet URL");
check(!/\/doorflow-operational-theme\.css\?v=p6\.10/.test(indexSource), "active stylesheet link no longer uses p6.10");
check(count(indexSource, /<link[^>]+doorflow-operational-theme\.css/gi) === 1, "one operational theme link remains");
check(!/<script[^>]+src=["'](?:\.\/)?app\.js["']/i.test(indexSource), "index.html remains the active inline runtime");

check(p81Index >= 0, "Phase 8.1 stylesheet appendix exists");
check(
  p81Index >= 0 && hash(themeSource.slice(0, p81Index).trimEnd()) === hash(baselineTheme.trimEnd()),
  "all production CSS through P6.10 remains byte-identical to baseline"
);
check(p81Css.includes(".mobile-management-guests") && p81Css.includes(".mobile-management-guest-card"), "mobile guest list styles exist");
check(
  /\.mobile-management-guest-actions\s+\.btn\s*\{[^}]*\bmin-height:\s*44px\s*;/s.test(p81Css),
  "mobile Edit/Delete controls retain approximately 44px touch targets"
);
check(p81Css.includes("@media (max-width: 540px)") && p81Css.includes(".df-service-controls-toggle"), "phone service-control disclosure styles use the 540px breakpoint");
check(
  p81Css.includes('[data-service-controls-mobile-layout="true"][data-service-controls-expanded="false"] .df-service-controls'),
  "only the focus-synchronized collapsed phone layout hides the controlled service panel"
);
check(
  !/overflow-x:\s*(?:hidden|clip)|::-webkit-calendar-picker-indicator|appearance\s*:|-webkit-appearance\s*:/.test(p81Css),
  "Phase 8.1 adds no overflow masking or native date-control suppression"
);
check(
  themeSource.includes("/* Phase P6.9: stacked phone service context and iPhone edge clearance. */")
    && themeSource.includes("/* Phase P6.10: final iOS Service Date overlay gutter. */")
    && themeSource.includes("--df-mobile-overlay-gutter: 20px"),
  "P6.9/P6.10 stacked date and native overlay-gutter protections remain"
);

const rolesBlock = appSource.match(/const roles = \{[\s\S]*?\n\};/)?.[0] || "";
check(
  /admin:\s+\{[^}]*manage:true/.test(rolesBlock)
    && /manager:\s+\{[^}]*manage:true/.test(rolesBlock)
    && /door:\s+\{[^}]*manage:false/.test(rolesBlock)
    && /viewer:\s+\{[^}]*manage:false/.test(rolesBlock),
  "existing role map grants guest management only to Admin and Manager"
);

const mobileRenderer = extractFunction(appSource, "renderMobileManageGuests");
const mobileRows = extractFunction(appSource, "renderMobileManagementGuestRows");
const mobileFilter = extractFunction(appSource, "mobileManagementGuests");
const mobileScopeResolver = extractFunction(appSource, "resolvedMobileManagementGuestScope");
const mobileSearch = extractFunction(appSource, "updateMobileManagementGuestSearch");
const mobileScope = extractFunction(appSource, "setMobileManagementGuestScope");
const mobileRefresh = extractFunction(appSource, "refreshMobileManagementGuestSurface");
const mobileDelete = extractFunction(appSource, "deleteMobileManagementGuest");
const mobileManagerView = extractFunction(appSource, "renderMobileManagerView");

check(
  mobileRenderer.includes('if (!canManageData()) return "";')
    && sameFunction(appSource, baselineApp, "canManageData")
    && sameFunction(appSource, baselineApp, "requirePerm"),
  "mobile Manage Guests is logic-gated by existing management permissions"
);
check(
  mobileRenderer.includes('id="mobileManageGuests"')
    && mobileRenderer.includes('id="mobileManagementGuestSearch"')
    && mobileRenderer.includes('id="mobileManagementGuestScope"')
    && mobileRenderer.includes('id="mobileManagementGuestCount"')
    && mobileRenderer.includes('id="mobileManagementGuestList"'),
  "mobile Manage Guests section, search, scope, count, and list exist"
);
check(
  mobileFilter.includes("state.guests")
    && mobileScopeResolver.includes("state.groups")
    && mobileFilter.includes("state.mobileManagementGuestSearch")
    && mobileScopeResolver.includes("state.mobileManagementGuestScope")
    && !mobileFilter.includes("state.searchText")
    && !mobileFilter.includes("state.guestFilter"),
  "mobile search/scope derive from loaded date state without altering Door filters"
);
check(
  [mobileRenderer, mobileRows, mobileFilter, mobileScopeResolver, mobileSearch, mobileScope, mobileRefresh].every(block => block && !hasForbiddenWork(block)),
  "mobile rendering and local filtering helpers contain no query, storage, timer, or listener work"
);
check(mobileRows.includes("No guests have been added for this service date."), "required no-guests empty state is exact");
check(
  mobileRows.includes("guestDisplayName(guest)")
    && mobileRows.includes("groupNameForGuest(guest)")
    && mobileRows.includes("guest.guest_type")
    && mobileRows.includes("Allowed ")
    && mobileRows.includes("checked in")
    && mobileRows.includes("remaining")
    && mobileRows.includes("isLateAdd(guest)"),
  "mobile records include name, list/group, type, allowance, arrival state, and relevant late-add state"
);
check(
  mobileRows.includes('data-management-guest-action="edit"')
    && mobileRows.includes("openGuestModal")
    && mobileRows.includes('data-management-guest-action="delete"')
    && mobileRows.includes("deleteMobileManagementGuest")
    && mobileRows.includes("btn danger"),
  "visible Edit and distinct Delete actions route to existing guest workflows"
);
check(
  mobileDelete.includes("await deleteGuest(id)")
    && mobileDelete.includes("isActionBusy(actionKey)")
    && !hasForbiddenWork(mobileDelete.replace("await deleteGuest(id)", "")),
  "mobile Delete wrapper prevents repeats and delegates to the existing delete handler"
);
check(
  mobileManagerView.indexOf("<h2>Quick Add</h2>") >= 0
    && mobileManagerView.indexOf("<h2>Quick Add</h2>") < mobileManagerView.indexOf("renderMobileManageGuests()"),
  "Quick Add remains immediately near the mobile manager summary"
);

for (const operation of ["insert", "update", "delete", "upsert"]) {
  const expression = new RegExp(`\\bdb\\s*\\.\\s*from\\s*\\(\\s*["']guests["']\\s*\\)\\s*\\.\\s*${operation}\\s*\\(`, "g");
  check(count(appSource, expression) === count(baselineApp, expression), "guest " + operation + " mutation call-site count matches baseline");
}
check(sameFunction(appSource, baselineApp, "updateGuest"), "existing guest edit payload, validation, and reconciliation are unchanged");
check(sameFunction(appSource, baselineApp, "deleteGuest"), "existing guest confirmation, delete payload, and reconciliation are unchanged");

const managementRender = extractFunction(appSource, "renderManagement");
check(
  !appSource.includes("function renderManagerServiceDateCard")
    && !appSource.includes("function renderMobileManagerServiceDateCard")
    && !appSource.includes("Change Service Date"),
  "redundant desktop and mobile Management date-card renderers are removed"
);
check(
  !managementRender.includes('label:"Service date"')
    && !managementRender.includes("renderManagerServiceDateCard"),
  "Management no longer repeats a Service Date label or selector"
);

const topbar = extractFunction(appSource, "renderTopbar");
const serviceSummary = extractFunction(appSource, "renderServiceControlsSummary");
const serviceAccessibleLabel = extractFunction(appSource, "serviceControlsAccessibleLabel");
const refreshServiceSummary = extractFunction(appSource, "refreshServiceControlsSummary");
const syncServiceDisclosure = extractFunction(appSource, "syncServiceControlsDisclosure");
const focusServiceControlsBeforeHide = extractFunction(appSource, "focusServiceControlsToggleBeforeHide");
const responsiveServiceControls = extractFunction(appSource, "syncServiceControlsResponsiveLayout");
const syncPresentation = extractFunction(appSource, "currentSyncPresentation");
const toggleServiceControls = extractFunction(appSource, "toggleServiceControls");
const refreshSync = extractFunction(appSource, "refreshSyncStatusSurface");
const exportsBlock = appSource.slice(appSource.indexOf("Object.assign(window"));

check(
  topbar.includes('id="df-service-date"')
    && topbar.includes('onchange="setActiveDay(this.value)"')
    && topbar.includes('onchange="setActiveDate(this.value)"')
    && topbar.includes('onclick="manualRefreshData()"'),
  "shared topbar retains Day, Service Date, sync, and Refresh controls"
);
check(
  topbar.includes('id="df-service-controls-toggle"')
    && topbar.includes('type="button"')
    && topbar.includes('aria-controls="df-service-controls"')
    && topbar.includes("aria-expanded=")
    && topbar.includes("Show")
    && topbar.includes("Hide"),
  "shared service disclosure has native button and dynamic ARIA semantics"
);
check(
  topbar.includes("serviceControlsAccessibleLabel()")
    && serviceAccessibleLabel.includes("state.activeDay")
    && serviceAccessibleLabel.includes("state.activeDate")
    && serviceAccessibleLabel.includes("currentSyncPresentation()")
    && serviceAccessibleLabel.includes("Show service controls")
    && serviceAccessibleLabel.includes("Hide service controls")
    && refreshServiceSummary.includes('setAttribute("aria-label", serviceControlsAccessibleLabel())')
    && syncServiceDisclosure.includes('setAttribute("aria-label", serviceControlsAccessibleLabel(expanded))'),
  "accessible disclosure name tracks its visible day, date, sync status, and action"
);
check(
  topbar.indexOf('id="df-service-controls-toggle"') < topbar.indexOf('id="df-service-controls"'),
  "disclosure precedes its controlled content in DOM order"
);
check(
  serviceSummary.includes("state.activeDay")
    && serviceSummary.includes("state.activeDate")
    && serviceSummary.includes("currentSyncPresentation()")
    && syncPresentation.includes("state.syncStatus")
    && syncPresentation.includes("state.error")
    && syncPresentation.includes("state.loading"),
  "collapsed summary uses actual day, date, and resolved sync state"
);
check(
  toggleServiceControls.includes("focusServiceControlsToggleBeforeHide()")
    && toggleServiceControls.indexOf("focusServiceControlsToggleBeforeHide()") < toggleServiceControls.indexOf("state.serviceControlsExpanded = nextExpanded")
    && focusServiceControlsBeforeHide.includes("controls?.contains(document.activeElement)")
    && focusServiceControlsBeforeHide.includes("preventScroll:true")
    && !toggleServiceControls.includes("render()"),
  "collapse moves inner focus first and toggles without rerendering or scrolling"
);
check(
  topbar.includes('data-service-controls-mobile-layout=')
    && responsiveServiceControls.includes("nextPhoneLayout && !serviceControlsPhoneLayout && !state.serviceControlsExpanded")
    && responsiveServiceControls.indexOf("focusServiceControlsToggleBeforeHide()") < responsiveServiceControls.indexOf("serviceControlsPhoneLayout = nextPhoneLayout")
    && appSource.includes('serviceControlsPhoneMedia.addEventListener("change", handleServiceControlsBreakpointChange)')
    && appSource.includes("serviceControlsPhoneMedia?.addListener?.(handleServiceControlsBreakpointChange)"),
  "desktop-to-phone breakpoint moves focus before enabling collapsed-layout CSS"
);
check(
  exportsBlock.includes("toggleServiceControls") && refreshSync.includes("refreshServiceControlsSummary()"),
  "disclosure handler is exported and partial sync refreshes its summary"
);
check(
  appSource.includes("serviceControlsExpanded:false")
    && appSource.includes("state.serviceControlsExpanded = nextExpanded")
    && extractFunction(appSource, "resetManagementSessionUiState").includes("state.serviceControlsExpanded = false")
    && withoutSessionUiReset(extractFunction(appSource, "initAuth")) === extractFunction(baselineApp, "initAuth")
    && withoutSessionUiReset(extractFunction(appSource, "logout")) === extractFunction(baselineApp, "logout"),
  "expanded/collapsed choice is in memory, survives tab renders, and resets only with the authenticated session"
);
check(
  count(appSource, /\blocalStorage\b/g) === count(baselineApp, /\blocalStorage\b/g)
    && count(appSource, /\bsessionStorage\b/g) === count(baselineApp, /\bsessionStorage\b/g),
  "Phase 8.1 introduces no localStorage or sessionStorage use"
);

const captureScroll = extractFunction(appSource, "captureScrollPositions");
const captureManagementAnchor = extractFunction(appSource, "captureManagementGuestAnchor");
const prepareManagementAnchor = extractFunction(appSource, "prepareManagementGuestAction");
const restoreManagementAnchor = extractFunction(appSource, "restoreManagementGuestAnchor");
const restoreModalFocus = extractFunction(appSource, "restoreModalReturnFocus");
const syncModalFocus = extractFunction(appSource, "syncModalFocus");
const transientCapture = extractFunction(appSource, "captureTransientUiState");
const transientRestore = extractFunction(appSource, "restoreTransientUiState");
const managementAnchorSurface = [captureManagementAnchor, prepareManagementAnchor, restoreManagementAnchor].join("\n");

check(captureScroll.includes('"mobileManagementGuestList"'), "mobile management list scrollTop joins existing transient preservation");
check(
  captureManagementAnchor.includes("previousGuestId")
    && captureManagementAnchor.includes("nextGuestId")
    && captureManagementAnchor.includes("activeControl?.dataset.managementGuestAction")
    && restoreManagementAnchor.includes("snapshot.nextGuestId")
    && restoreManagementAnchor.includes("snapshot.previousGuestId")
    && restoreManagementAnchor.includes("control || (!card ? panel : null)")
    && restoreManagementAnchor.includes("pendingManagementGuestAnchor?.generation"),
  "mobile edit/delete and ordinary refresh anchoring preserve the active, neighboring, or empty-list focus target"
);
check(
  restoreManagementAnchor.includes("keepForPendingDelete")
    && restoreManagementAnchor.includes("isActionBusy(`mobile-delete:${primaryGuestId}`)")
    && restoreManagementAnchor.includes("snapshot.view !== state.view")
    && restoreManagementAnchor.includes("pendingIsCurrent && !deleteStillBusy")
    && mobileDelete.includes("(guestStillExists && !failed)")
    && mobileDelete.includes("failed && guestStillExists && state.view === snapshot?.view")
    && mobileDelete.includes("state.view !== snapshot?.view"),
  "realtime and failed Delete repaints retain the action anchor while cancel/off-view settlement clears it"
);
check(
  syncModalFocus.includes('pendingManagementGuestAnchor?.action === "edit"')
    && syncModalFocus.includes("restoreModalReturnFocus(target, managementSnapshot)")
    && restoreModalFocus.includes("managementSnapshot.nextGuestId")
    && restoreModalFocus.includes("managementSnapshot.previousGuestId")
    && restoreModalFocus.includes('document.getElementById("mobileManagementGuestList")')
    && restoreModalFocus.includes("preventScroll:true"),
  "a filtered-out edited row returns modal focus to its logical neighbor without scrolling"
);
check(
  transientCapture.includes("managementGuest:") && transientRestore.includes("restoreManagementGuestAnchor"),
  "full renders include the isolated Management guest anchor"
);
check(
  !/scrollTo\s*\(\s*0\s*,\s*0|scrollIntoView|setTimeout\s*\(|setInterval\s*\(|addEventListener\s*\(\s*["']scroll/.test(managementAnchorSurface),
  "Management anchoring adds no top jump, arbitrary timer, or continuous scroll listener"
);

const intentionallyChangedBaselineFunctions = new Set([
  "captureScrollPositions",
  "captureTransientUiState",
  "restoreTransientUiState",
  "restoreModalReturnFocus",
  "syncModalFocus",
  "updateSyncStatus",
  "initAuth",
  "logout",
  "renderMobileManagerView",
  "renderSyncPill",
  "renderTopbar",
  "renderManagerServiceDateCard",
  "renderMobileManagerServiceDateCard",
  "refreshSyncStatusSurface",
  "refreshLiveSurfaces",
  "renderManagement"
]);
const expectedNewFunctions = new Set([
  "captureManagementGuestAnchor",
  "prepareManagementGuestAction",
  "restoreManagementGuestAnchor",
  "resetManagementSessionUiState",
  "resolvedMobileManagementGuestScope",
  "mobileManagementGuests",
  "renderMobileManagementGuestScopeOptions",
  "renderMobileManagementGuestRows",
  "renderMobileManageGuests",
  "refreshMobileManagementGuestSurface",
  "updateMobileManagementGuestSearch",
  "setMobileManagementGuestScope",
  "deleteMobileManagementGuest",
  "currentSyncPresentation",
  "formatServiceControlsDate",
  "serviceControlsAccessibleLabel",
  "renderServiceControlsSummary",
  "refreshServiceControlsSummary",
  "syncServiceControlsDisclosure",
  "focusServiceControlsToggleBeforeHide",
  "syncServiceControlsResponsiveLayout",
  "handleServiceControlsBreakpointChange",
  "toggleServiceControls"
]);
const baselineFunctionNames = [...new Set(functionNames(baselineApp))];
const currentFunctionNames = new Set(functionNames(appSource));
const protectedMismatches = baselineFunctionNames.filter(name => (
  !intentionallyChangedBaselineFunctions.has(name) && !sameFunction(appSource, baselineApp, name)
));
const unexpectedRemovedFunctions = baselineFunctionNames.filter(name => (
  !currentFunctionNames.has(name)
    && name !== "renderManagerServiceDateCard"
    && name !== "renderMobileManagerServiceDateCard"
));
const unexpectedNewFunctions = [...currentFunctionNames].filter(name => (
  !baselineFunctionNames.includes(name) && !expectedNewFunctions.has(name)
));
const missingExpectedNewFunctions = [...expectedNewFunctions].filter(name => !currentFunctionNames.has(name));
check(
  protectedMismatches.length === 0
    && unexpectedRemovedFunctions.length === 0
    && unexpectedNewFunctions.length === 0
    && missingExpectedNewFunctions.length === 0,
  "every baseline function outside the explicit Phase 8.1 allowlist is byte-identical"
);
if (protectedMismatches.length) console.error("       Unexpectedly changed functions: " + protectedMismatches.join(", "));
if (unexpectedRemovedFunctions.length) console.error("       Unexpectedly removed functions: " + unexpectedRemovedFunctions.join(", "));
if (unexpectedNewFunctions.length) console.error("       Unexpectedly added functions: " + unexpectedNewFunctions.join(", "));
if (missingExpectedNewFunctions.length) console.error("       Missing expected functions: " + missingExpectedNewFunctions.join(", "));

const protectedCriticalFunctions = [
  "requirePerm", "viewAllowedForRole", "login", "bootDatabase", "ensureVenue", "ensureServiceDay",
  "ensureGeneralGroup", "loadDataForDate", "setActiveDay", "setActiveDate", "useTodayDate", "createGroup",
  "updateGroup", "deleteGroup", "createGuest", "updateGuest", "deleteGuest", "createShiftNote", "updateShiftNote",
  "deleteShiftNote", "setActionBusy", "isActionBusy", "beginLiveDataSnapshot", "shouldApplyLiveDataSnapshot",
  "checkInOneGuest", "undoOneGuest", "toggleGuest", "requestRealtimeRefresh", "subscribeRealtime",
  "captureLiveRosterAnchor", "prepareLiveRosterAction", "restoreLiveRosterAnchor", "visibleGuests",
  "updateMainSearch", "setGuestFilter", "render"
];
check(
  protectedCriticalFunctions.every(name => sameFunction(appSource, baselineApp, name)),
  "protected auth/date/CRUD/race/realtime/Door/scroll functions match baseline"
);

check(hash(swSource) === hash(baselineSw), "service worker remains byte-identical to production baseline");
check(hash(manifestSource) === hash(baselineManifest), "manifest remains byte-identical to production baseline");
try {
  JSON.parse(manifestSource);
  check(true, "manifest JSON parses");
} catch (error) {
  check(false, "manifest JSON parses: " + error.message);
}
const versionedCssPath = new URL("http://127.0.0.1/doorflow-operational-theme.css?v=p8.1").pathname;
check(
  swSource.includes('const CACHE_NAME = "doorflow-cache-v30";')
    && swSource.includes('"/doorflow-operational-theme.css"')
    && versionedCssPath === "/doorflow-operational-theme.css",
  "p8.1 stylesheet pathname remains in unchanged cache-v30 shell allowlist"
);
check(
  swSource.includes('request.method !== "GET"')
    && swSource.includes("url.origin !== self.location.origin")
    && swSource.includes('url.pathname.includes("/rest/")')
    && swSource.includes('request.mode === "navigate"')
    && !swSource.includes("self.skipWaiting")
    && !swSource.includes("location.reload"),
  "service-worker request exclusions, network-first navigation, and lifecycle safeguards remain"
);

const currentSurface = appSource + "\n" + indexSource + "\n" + themeSource + "\n" + swSource;
const baselineSurface = baselineApp + "\n" + baselineIndex + "\n" + baselineTheme + "\n" + baselineSw;
for (const [label, pattern] of [
  ["Supabase client creation", /\.createClient\s*\(/g],
  ["fetch call", /\bfetch\s*\(/g],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/g],
  ["timer", /\bset(?:Timeout|Interval)\s*\(/g]
]) {
  check(count(currentSurface, pattern) === count(baselineSurface, pattern), "no new " + label + " sites");
}
const breakpointListener = 'serviceControlsPhoneMedia.addEventListener("change", handleServiceControlsBreakpointChange);';
const currentWithoutBreakpointListener = currentSurface.replaceAll(breakpointListener, "");
check(
  count(currentSurface, /\.addEventListener\s*\(/g) === count(baselineSurface, /\.addEventListener\s*\(/g) + 2
    && count(currentSurface, /serviceControlsPhoneMedia\.addEventListener\("change", handleServiceControlsBreakpointChange\)/g) === 2
    && count(currentWithoutBreakpointListener, /\.addEventListener\s*\(/g) === count(baselineSurface, /\.addEventListener\s*\(/g),
  "the only new event listener is the focus-safe phone-breakpoint listener in each mirrored runtime"
);
const externalAssets = source => [...source.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["'](https?:\/\/[^"']+)/gi)].map(match => match[1]).sort();
check(
  externalAssets(indexSource).join("|") === externalAssets(baselineIndex).join("|"),
  "external script and stylesheet dependency inventory is unchanged"
);
check(!/\b(?:google-analytics|googletagmanager|segment|mixpanel|posthog|sentry)\b/i.test(currentSurface), "no analytics integration is introduced");

const baselineTracked = git(["ls-tree", "-r", "--name-only", baselineCommit]).trim().split("\n").filter(Boolean).sort();
const currentTracked = git(["ls-files"]).trim().split("\n").filter(Boolean).sort();
const isDatabaseGuarded = path => path.toLowerCase().endsWith(".sql") || /policy_snapshot\.csv$/i.test(path);
const baselineDatabaseFiles = baselineTracked.filter(isDatabaseGuarded);
const currentDatabaseFiles = currentTracked.filter(isDatabaseGuarded);
check(
  baselineDatabaseFiles.join("|") === currentDatabaseFiles.join("|")
    && baselineDatabaseFiles.every(path => hash(read(path)) === hash(fromBaseline(path))),
  "SQL, RLS, policy, migration, and policy-snapshot files are unchanged"
);
const dependencyFile = path => /(^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(path);
check(
  currentTracked.filter(dependencyFile).join("|") === baselineTracked.filter(dependencyFile).join("|"),
  "no package manifest or dependency lockfile is added"
);

const allowedChanges = new Set([
  "index.html",
  "app.js",
  "doorflow-operational-theme.css",
  "scripts/p8-1-mobile-management-smoke.mjs",
  "docs/OPERATIONAL_UI_DESIGN_SYSTEM.md",
  "ui-redesign/README.md"
]);
const statusRecords = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
const statusPaths = statusRecords.map(record => record.slice(3).replaceAll("\\", "/"));
check(
  statusPaths.every(path => allowedChanges.has(path) || path.startsWith(".codex/")),
  "working-tree changes stay within the authorized Phase 8.1 files"
);
const codexRecords = statusRecords.filter(record => record.slice(3).replaceAll("\\", "/").startsWith(".codex/"));
check(
  codexRecords.every(record => record.startsWith("?? "))
    && !currentTracked.some(path => path.startsWith(".codex/")),
  ".codex is absent or remains wholly untracked"
);
check(git(["diff", "--cached", "--name-only"]).trim() === "", "nothing is staged");

if (failures) {
  console.error("\nPhase 8.1 static smoke failed with " + failures + " issue" + (failures === 1 ? "" : "s") + ".");
  process.exit(1);
}

console.log("\nPhase 8.1 static smoke passed.");
console.log("Static checks do not prove responsive rendering, authenticated role behavior, live mutations, scroll/focus outcomes, realtime delivery, or PWA lifecycle behavior; complete the manual owner checklist.");
