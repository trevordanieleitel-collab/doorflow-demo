import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const presentationFunctions = new Set([
  "captureTransientUiState",
  "restoreTransientUiState",
  "renderMobileManagerView",
  "renderShiftNotesForDoorStaff",
  "renderCloseOutReportModal",
  "renderSyncPill",
  "renderTopbar",
  "renderDateBar",
  "renderMobileManagerServiceDateCard",
  "renderStats",
  "renderGroupList",
  "renderGuestList",
  "renderSelectedGroupPanel",
  "renderMainWorkspace",
  "renderTabletGuestCards",
  "renderTabletDoorMode",
  "renderManagement",
  "renderStaffManagement",
  "renderReports",
  "renderApp",
  "refreshSyncStatusSurface",
  "refreshVisibleGuestSurface",
  "captureLiveRosterAnchor",
  "prepareLiveRosterAction",
  "restoreLiveRosterAnchor"
]);
const p61ChangedFunctions = new Set([
  "checkInOneGuest",
  "undoOneGuest",
  "loadDataForDate"
]);
const p61NewFunctions = new Set([
  "hasPendingGuestCheckActions",
  "markGuestCheckStateChanged",
  "beginLiveDataSnapshot",
  "shouldApplyLiveDataSnapshot"
]);
const p61AuthorizedFunctions = new Set([...p61ChangedFunctions, ...p61NewFunctions]);
const p65ChangedPresentationFunctions = new Set([
  "captureTransientUiState",
  "restoreTransientUiState",
  "renderMobileManagerView",
  "renderShiftNotesForDoorStaff",
  "renderCloseOutReportModal",
  "renderSyncPill",
  "renderTopbar",
  "renderMobileManagerServiceDateCard",
  "renderGuestList",
  "refreshSyncStatusSurface",
  "refreshVisibleGuestSurface",
  "renderTabletGuestCards",
  "renderTabletDoorMode",
  "renderApp"
]);
const p65NewPresentationFunctions = new Set([
  "captureLiveRosterAnchor",
  "prepareLiveRosterAction",
  "restoreLiveRosterAnchor"
]);
const p65AuthorizedFunctions = new Set([...p65ChangedPresentationFunctions, ...p65NewPresentationFunctions]);
const authorizedNewFunctions = new Set([...p61NewFunctions, ...p65NewPresentationFunctions]);

let failures = 0;

function check(condition, label) {
  if (condition) {
    console.log(`[PASS] ${label}`);
    return;
  }
  failures += 1;
  console.error(`[FAIL] ${label}`);
}

function read(path) {
  return readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
}

function git(args) {
  return execFileSync("git", args, { cwd:root, encoding:"utf8" }).replaceAll("\r\n", "\n");
}

function fromHead(path) {
  return git(["show", `HEAD:${path}`]);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function extractRuntime(html) {
  const match = html.match(/<script>\s*([\s\S]*?)\s*render\(\);\s*initAuth\(\);\s*<\/script>/);
  return match ? `${match[1]}\nrender();\ninitAuth();` : "";
}

function extractFunction(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startMatch = new RegExp(`^(?:async\\s+)?function\\s+${escaped}\\s*\\(`, "m").exec(source);
  if (!startMatch) return "";

  const start = startMatch.index;
  const rest = source.slice(start + startMatch[0].length);
  const boundary = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|\nObject\.assign\(window/;
  const next = boundary.exec(rest);
  const end = next ? start + startMatch[0].length + next.index : source.length;
  return source.slice(start, end).trim();
}

function normalizeP61BaselineBlock(name, source) {
  if (name !== "doorFlowFetch") return source;
  return source
    .replace("\nlet liveDataLoadSequence = 0;", "")
    .replace("\nlet guestCheckStateVersion = 0;", "")
    .replace("\nlet liveRosterAnchorGeneration = 0;", "")
    .replace("\nlet pendingLiveRosterAnchor = null;", "");
}

function extractVenuePresentation(source) {
  const match = source.match(/const DOORFLOW_VENUE_PRESENTATION = Object\.freeze\(\{[\s\S]*?\n\}\);/);
  return match ? match[0] : "";
}

function extractLiveGuestPresentation(source) {
  const match = source.match(/const DOORFLOW_LIVE_GUEST_PRESENTATION = Object\.freeze\(\{[\s\S]*?\n\}\);/);
  return match ? match[0] : "";
}

const indexHtml = read("index.html");
const appJs = read("app.js");
const themeCss = read("doorflow-operational-theme.css");
const baselineIndex = fromHead("index.html");
const baselineApp = fromHead("app.js");
const phaseP4Theme = git(["show", "2bbe1ae:doorflow-operational-theme.css"]);
const runtime = extractRuntime(indexHtml);
const baselineRuntime = extractRuntime(baselineIndex);
const p5Css = themeCss.split("/* Phase P5:")[1] || "";
const p51Css = themeCss.split("/* Phase P5.1:")[1] || "";
const p52Css = themeCss.split("/* Phase P5.2:")[1] || "";
const p53Css = themeCss.split("/* Phase P5.3:")[1] || "";
const p65Css = themeCss.split("/* Phase P6.5:")[1] || "";
const p67Css = (themeCss.split("/* Phase P6.7:")[1] || "").split("/* Phase P6.9:")[0];
const p69Css = (themeCss.split("/* Phase P6.9:")[1] || "").split("/* Phase P6.10:")[0];
const p610Css = themeCss.split("/* Phase P6.10:")[1] || "";
const preP5Css = themeCss.split("/* Phase P5:")[0].trimEnd();

check(Boolean(runtime), "inline operational runtime remains in index.html");
check(!/<script[^>]+src=["'](?:\.\/)?app\.js["']/i.test(indexHtml), "index.html remains the active inline runtime");
check(count(indexHtml, /<link\s+rel="stylesheet"\s+href="\/doorflow-operational-theme\.css\?v=p6\.10">/g) === 1, "P6.10 loads the approved theme through one fresh cache key");
check(count(indexHtml, /<link\s+rel="stylesheet"\s+href="\/doorflow-operational-theme\.css\?v=p6\.9">/g) === 0, "P6.10 leaves no active P6.9 stylesheet key");

const appVenuePresentation = extractVenuePresentation(appJs);
const runtimeVenuePresentation = extractVenuePresentation(runtime);
check(Boolean(appVenuePresentation && runtimeVenuePresentation && hash(appVenuePresentation) === hash(runtimeVenuePresentation)), "venue presentation configuration retains runtime/mirror parity");
for (const value of ["The B.O.B.", "EVE", "Shared Guest List", "The B.O.B. + EVE"]) {
  check(appVenuePresentation.includes(value), `venue presentation configuration includes ${value}`);
}
check(appJs.includes('const DEFAULT_VENUE_NAME = "EVE";') && baselineApp.includes('const DEFAULT_VENUE_NAME = "EVE";'), "database venue fallback remains EVE");

const appLiveGuestPresentation = extractLiveGuestPresentation(appJs);
const runtimeLiveGuestPresentation = extractLiveGuestPresentation(runtime);
check(Boolean(appLiveGuestPresentation && runtimeLiveGuestPresentation && hash(appLiveGuestPresentation) === hash(runtimeLiveGuestPresentation)), "live guest-name presentation configuration retains runtime/mirror parity");
check(appLiveGuestPresentation.includes("\\+\\d+") && appLiveGuestPresentation.includes("\\d+\\+"), "live guest-name presentation removes trailing +N and N+ size tokens");

const functionNames = [...appJs.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]);
const baselineFunctionNames = [...baselineApp.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]);
check(functionNames.filter(name => !authorizedNewFunctions.has(name)).join("|") === baselineFunctionNames.join("|"), "function inventory and ordering match baseline plus authorized P6.1/P6.5 helpers");
check(functionNames.length === baselineFunctionNames.length + authorizedNewFunctions.size, `function inventory adds exactly ${authorizedNewFunctions.size} authorized P6.1/P6.5 helpers`);

const mirrorMismatches = functionNames.filter(name => {
  const appBlock = extractFunction(appJs, name);
  const runtimeBlock = extractFunction(runtime, name);
  return !appBlock || !runtimeBlock || hash(appBlock) !== hash(runtimeBlock);
});
check(mirrorMismatches.length === 0, `runtime/mirror parity (${functionNames.length} functions)`);
if (mirrorMismatches.length) console.error(`  Mismatches: ${mirrorMismatches.join(", ")}`);

const protectedNames = functionNames.filter(name => !presentationFunctions.has(name));
const unchangedProtectedNames = protectedNames.filter(name => !p61AuthorizedFunctions.has(name));
const protectedMismatches = unchangedProtectedNames.filter(name => {
  const blocks = [
    extractFunction(appJs, name),
    extractFunction(runtime, name),
    extractFunction(baselineApp, name),
    extractFunction(baselineRuntime, name)
  ].map(block => normalizeP61BaselineBlock(name, block));
  return blocks.some(block => !block) || new Set(blocks.map(hash)).size !== 1;
});
check(protectedMismatches.length === 0, `all ${unchangedProtectedNames.length} unrelated non-presentation functions match HEAD byte-for-byte`);
if (protectedMismatches.length) console.error(`  Mismatches: ${protectedMismatches.join(", ")}`);

for (const name of p61ChangedFunctions) {
  const current = extractFunction(appJs, name);
  const mirror = extractFunction(runtime, name);
  const baseline = extractFunction(baselineApp, name);
  check(Boolean(current && mirror && baseline && hash(current) === hash(mirror) && hash(current) !== hash(baseline)), `P6.1 authorized change ${name}`);
}

for (const name of p61NewFunctions) {
  const current = extractFunction(appJs, name);
  const mirror = extractFunction(runtime, name);
  check(Boolean(current && mirror && hash(current) === hash(mirror) && !extractFunction(baselineApp, name) && !extractFunction(baselineRuntime, name)), `P6.1 new helper ${name}`);
}

for (const name of p65ChangedPresentationFunctions) {
  const current = extractFunction(appJs, name);
  const mirror = extractFunction(runtime, name);
  const baseline = extractFunction(baselineApp, name);
  check(Boolean(current && mirror && baseline && hash(current) === hash(mirror) && hash(current) !== hash(baseline)), `P6.5 authorized presentation change ${name}`);
}

for (const name of p65NewPresentationFunctions) {
  const current = extractFunction(appJs, name);
  const mirror = extractFunction(runtime, name);
  check(Boolean(current && mirror && hash(current) === hash(mirror) && !extractFunction(baselineApp, name) && !extractFunction(baselineRuntime, name)), `P6.5 new presentation helper ${name}`);
}

for (const name of presentationFunctions) {
  const current = extractFunction(appJs, name);
  const mirror = extractFunction(runtime, name);
  check(Boolean(current && mirror && hash(current) === hash(mirror)), `presentation renderer mirror ${name}`);
}

const criticalIds = [
  "dayStatsPanel",
  "mainSearchInput",
  "mainListModeSelect",
  "mainGuestFilterSelect",
  "mainSortModeSelect",
  "guestScrollPanel",
  "groupSearchInput",
  "groupScrollPanel",
  "selectedGroupPanel",
  "doorGroupSelect",
  "doorLocationSelect",
  "tabletMobileSummaryBar",
  "tabletDayStatsPanel",
  "tabletSearchInput",
  "tabletListSelect",
  "tabletGuestFilterSelect",
  "tabletSortModeSelect",
  "tabletFilterBadge",
  "tabletShownCount",
  "tabletCardGrid"
];

for (const id of criticalIds) {
  const occurrences = count(runtime, new RegExp(`id=["']${id}["']`, "g"));
  const expected = id === "selectedGroupPanel" ? 2 : 1;
  check(occurrences === expected, `Door contract id ${id} has expected source count ${expected}`);
}

const eventContracts = [
  'oninput="updateMainSearch(this.value)"',
  'oninput="updateGroupSearch(this.value)"',
  'oninput="updateTabletSearch(this.value)"',
  'onchange="setGuestFilter(this.value)"',
  'onchange="setSortMode(this.value)"',
  'onchange="selectTabletList(this.value)"',
  'onchange="state.doorLocation=this.value;render()"',
  'onclick="clearMainSearch()"',
  'onclick="clearTabletSearchFilter()"',
  'onclick="prepareLiveRosterAction(event,\'${guest.id}\',\'checkin\');checkInOneGuest(\'${guest.id}\')"',
  'onclick="prepareLiveRosterAction(event,\'${guest.id}\',\'undo\');undoOneGuest(\'${guest.id}\')"'
];

for (const contract of eventContracts) {
  check(runtime.includes(contract), `Door event contract ${contract}`);
}

for (const [label, currentPattern, baselinePattern] of [
  ["check-in action", /onclick="prepareLiveRosterAction\(event,'\$\{guest\.id\}','checkin'\);checkInOneGuest\('\$\{guest\.id\}'\)"/g, /onclick="checkInOneGuest\('\$\{guest\.id\}'\)"/g],
  ["undo action", /onclick="prepareLiveRosterAction\(event,'\$\{guest\.id\}','undo'\);undoOneGuest\('\$\{guest\.id\}'\)"/g, /onclick="undoOneGuest\('\$\{guest\.id\}'\)"/g],
  ["group selection action", /onclick="selectGroup\('\$\{group\.id\}'\)"/g, /onclick="selectGroup\('\$\{group\.id\}'\)"/g],
  ["single primary navigation", /<nav class="df-primary-nav"/g, /<nav class="df-primary-nav"/g]
]) {
  const currentCount = count(runtime, currentPattern);
  const baselineCount = count(baselineRuntime, baselinePattern);
  check(currentCount === baselineCount, `${label} count matches baseline (${baselineCount})`);
}

for (const className of [
  "df-door-theme",
  "df-door-checkin-view",
  "df-door-operating-workspace",
  "df-door-view-header",
  "df-door-context",
  "df-door-metrics",
  "df-door-filter-panel",
  "df-door-guest-panel",
  "df-door-guest-row",
  "df-door-checkin-action",
  "df-door-undo-action",
  "df-door-party-card",
  "df-door-party-focus",
  "df-door-roster-column",
  "df-door-support-column",
  "df-door-selected-group",
  "df-door-shift-notes",
  "df-tablet-door-mode",
  "df-tablet-mode-header",
  "df-tablet-command-bar",
  "df-tablet-control-grid",
  "df-tablet-content-layout",
  "df-tablet-active-list",
  "df-tablet-guest-card",
  "is-roster-only",
  "df-door-empty-state",
  "df-door-live-name-row",
  "df-door-live-status-row",
  "df-live-approval-state"
]) {
  check(runtime.includes(className), `runtime includes ${className}`);
  check(themeCss.includes(`.${className}`), `theme includes ${className}`);
}

for (const className of [
  "df-venue-hierarchy",
  "df-venue-scope",
  "df-tablet-venue-label",
  "df-tablet-list-scope"
]) {
  check(runtime.includes(className), `runtime includes venue hierarchy class ${className}`);
  check(themeCss.includes(`.${className}`), `theme includes venue hierarchy class ${className}`);
}

for (const token of [
  "--df-door-bg",
  "--df-door-surface",
  "--df-door-surface-raised",
  "--df-door-surface-active",
  "--df-door-border",
  "--df-door-border-strong",
  "--df-door-text",
  "--df-door-muted",
  "--df-door-blue",
  "--df-door-cyan",
  "--df-door-success",
  "--df-door-warning",
  "--df-door-danger",
  "--df-door-focus",
  "--df-door-shadow"
]) {
  check(p5Css.includes(token), `Door token ${token}`);
}

check(Boolean(p5Css), "P5 CSS boundary marker exists");
check(Boolean(p51Css), "P5.1 CSS boundary marker exists");
check(Boolean(p52Css), "P5.2 CSS boundary marker exists");
check(Boolean(p53Css), "P5.3 CSS boundary marker exists");
check(preP5Css === phaseP4Theme.trimEnd(), "all committed Phase P4 CSS remains byte-identical before the P5 boundary");
check(!p5Css.includes(".df-admin-theme"), "P5 theme does not target the administrative theme");
check(/\.df-door-theme\s*\{[^}]*background:\s*var\(--df-door-bg\);/s.test(p5Css), "Door theme has a scoped dark canvas");
check(/\.df-shell-live\s+\.df-utility-bar\s*\{[^}]*background:\s*#0a1928;/s.test(p5Css), "live-service shell receives the dark utility treatment");
check(/\.df-door-theme\s+\.df-door-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(17rem,\s*21rem\);/s.test(p51Css), "Door workspace keeps the group browser in a bounded right column");
check(/@container\s+df-main-content\s*\(max-width:\s*56rem\)[\s\S]*?\.df-door-theme\s+\.df-door-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s.test(p51Css), "Door workspace stacks before the right column becomes cramped");
check(/@container\s+df-door-roster\s*\(min-width:\s*46rem\)[\s\S]*?\.guest-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s.test(p51Css), "wide Door rosters use a density-safe two-column layout");
check(/@container\s+df-main-content\s*\(max-width:\s*52rem\)[\s\S]*?\.df-door-guest-row\s*\{[^}]*grid-template-columns:\s*36px\s*minmax\(0,\s*1fr\);/s.test(p51Css), "Door guest rows reflow by content width");
check(/\.df-tablet-content-layout\.is-roster-only\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s.test(p51Css), "Tablet results reclaim the former Party Context column");
check(/\.tablet-card-grid\s*\{[^}]*minmax\(min\(100%,\s*17rem\),\s*1fr\)/s.test(p51Css), "Tablet guest grid uses compact responsive card tracks");
check(/\.df-tablet-guest-card\s*\{[^}]*min-height:\s*168px;/s.test(p51Css), "Tablet guest cards use the compact P5.1 height");
check(/\.tablet-check-btn,[\s\S]*?min-height:\s*52px;/s.test(p51Css), "tablet check-in controls retain large touch targets");
check(/@container\s+df-main-content\s*\(max-width:\s*40rem\)[\s\S]*?\.tablet-check-btn,[\s\S]*?min-height:\s*48px;/s.test(p51Css), "phone check-in controls retain minimum touch targets");
check(/@container\s+df-main-content\s*\(max-width:\s*40rem\)[\s\S]*?\.df-tablet-control-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s.test(p51Css), "phone Tablet controls use a compact two-column grid");
check(/\.df-door-live-name-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s.test(p52Css), "live guest names keep a stable name and count row");
check(/\.df-live-approval-state\s*\{[^}]*white-space:\s*normal;/s.test(p52Css), "live approval state remains text-backed and wrappable");
check(/@media\s*\(max-width:\s*430px\)[\s\S]*?\.df-door-guest-row\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*5px\s+6px;/s.test(p53Css), "narrow-phone Door cards remove fixed height and reduce padding");
check(/@media\s*\(max-width:\s*430px\)[\s\S]*?\.df-tablet-guest-card\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*7px;/s.test(p53Css), "phone-sized Tablet cards remove fixed height and reduce padding");
check(/@media\s*\(max-width:\s*430px\)[\s\S]*?\.df-door-guest-actions\s+\.btn,[\s\S]*?min-height:\s*44px;/s.test(p53Css), "narrow-phone Door actions retain 44px targets");
check(/@media\s*\(max-width:\s*430px\)[\s\S]*?\.tablet-check-btn,[\s\S]*?min-height:\s*44px;/s.test(p53Css), "narrow-phone Tablet actions retain 44px targets");
check(/@media\s*\(max-height:\s*600px\)\s*and\s*\(orientation:\s*landscape\)[\s\S]*?min-height:\s*0;/s.test(p53Css), "short landscape receives compact live card height");
check(!p53Css.includes(".df-admin-theme"), "P5.3 compact density remains outside administrative screens");
check(/\.df-door-theme\s+\.btn\s*\{[^}]*min-height:\s*48px;/s.test(p5Css), "Door controls retain minimum touch targets");
check(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition-duration:\s*0\.01ms\s*!important;/s.test(p5Css), "Door presentation honors reduced motion");
check(!/word-break:\s*break-all/i.test(p5Css), "Door labels never use break-all wrapping");
check(!/overflow-x:\s*hidden/i.test(p5Css), "P5 does not hide horizontal overflow defects");
check(!/\banimation(?:-name)?:/i.test(p5Css), "P5 adds no continuous animation");

const mainWorkspace = extractFunction(runtime, "renderMainWorkspace");
const tabletDoorMode = extractFunction(runtime, "renderTabletDoorMode");
const managementView = extractFunction(runtime, "renderManagement");
const topbar = extractFunction(runtime, "renderTopbar");
const staffView = extractFunction(runtime, "renderStaffManagement");
const reportsView = extractFunction(runtime, "renderReports");
const closeoutView = extractFunction(runtime, "renderCloseOutReportModal");
const groupList = extractFunction(runtime, "renderGroupList");
const guestList = extractFunction(runtime, "renderGuestList");
const tabletGuestCards = extractFunction(runtime, "renderTabletGuestCards");
const mobileManagerView = extractFunction(runtime, "renderMobileManagerView");
const mobileManagerServiceDate = extractFunction(runtime, "renderMobileManagerServiceDateCard");
const renderAppBlock = extractFunction(runtime, "renderApp");
const syncPill = extractFunction(runtime, "renderSyncPill");
const shiftBrief = extractFunction(runtime, "renderShiftNotesForDoorStaff");
const captureAnchor = extractFunction(runtime, "captureLiveRosterAnchor");
const prepareAnchor = extractFunction(runtime, "prepareLiveRosterAction");
const restoreAnchor = extractFunction(runtime, "restoreLiveRosterAnchor");
const captureTransient = extractFunction(runtime, "captureTransientUiState");
const restoreTransient = extractFunction(runtime, "restoreTransientUiState");
const refreshVisibleGuests = extractFunction(runtime, "refreshVisibleGuestSurface");
const closeoutData = extractFunction(runtime, "buildCloseOutReportData");
const closeoutCsv = extractFunction(runtime, "downloadCloseOutReportCsv");
check(mainWorkspace.includes('class="stack df-door-support-column"') && mainWorkspace.includes('class="card df-door-party-panel"'), "Door right column contains the Party / Bottle Service Groups browser");
check(mainWorkspace.indexOf('${showManagement ? "" : filterPanel}') < mainWorkspace.indexOf('<div class="grid df-door-workspace">'), "Door filter sits above the roster and group-browser grid");
check(mainWorkspace.includes('${showManagement ? renderSelectedGroupPanel() : ""}'), "standalone selected-group panel is omitted from live Door Check-In only");
check(managementView.includes("renderMainWorkspace(true)") && mainWorkspace.includes('${showManagement ? renderSelectedGroupPanel() : ""}'), "Management retains its selected-group panel");
check(!tabletDoorMode.includes("df-tablet-party-context") && !tabletDoorMode.includes("tablet-party-context-title"), "Tablet standalone Party Context panel is removed");
check(tabletDoorMode.includes("df-tablet-active-list"), "Tablet active list context is integrated into the compact result summary");
check(topbar.includes("df-venue-hierarchy__expanded") && topbar.includes("Operating space") && topbar.includes("df-venue-scope"), "utility bar distinguishes parent venue, operating space, and guest-list scope");
check(mainWorkspace.includes("Door:") && mainWorkspace.includes("venueContext.compactLabel"), "Door Check-In separates venue hierarchy from physical door");
check(tabletDoorMode.includes("df-tablet-venue-label") && tabletDoorMode.includes("df-tablet-list-scope") && tabletDoorMode.includes("Door:"), "Tablet Door Mode exposes compact hierarchy, list scope, and physical door");
for (const [label, renderer] of [["Management", managementView], ["Staff", staffView], ["Reports", reportsView]]) {
  check(renderer.includes('label:"Venue"') && renderer.includes('label:"Operating space"') && renderer.includes('label:"Guest-list scope"'), `${label} context distinguishes venue hierarchy`);
}
check(closeoutView.includes("venueContext.reportLabel") && closeoutView.includes("venueContext.sharedGuestListLabel"), "closeout preview identifies The B.O.B. / EVE shared-list context");
check(guestList.includes("DOORFLOW_LIVE_GUEST_PRESENTATION.displayName(guest)") && !guestList.includes("guestDisplayName(guest)"), "Door guest cards display live-clean names without numeric plus suffixes");
check(tabletGuestCards.includes("DOORFLOW_LIVE_GUEST_PRESENTATION.displayName(guest)") && !tabletGuestCards.includes("guestDisplayName(guest)"), "Tablet guest cards display live-clean names without numeric plus suffixes");
check(groupList.includes("showActions") && groupList.includes("guestDisplayName(hostGuest)") && groupList.includes("DOORFLOW_LIVE_GUEST_PRESENTATION.displayName(hostGuest)"), "live party host labels omit numeric plus suffixes without changing Management labels");
check(guestList.includes("${checked}/${total}") && tabletGuestCards.includes("${checked}/${total}"), "arrival-count badges remain present in Door and Tablet cards");
for (const [label, renderer] of [["Door", guestList], ["Tablet", tabletGuestCards]]) {
  check(!renderer.includes("lateAddMetaText") && !renderer.includes("late_add_reason") && !renderer.includes("added_by_name") && !renderer.includes("added_at"), `${label} cards omit verbose late-add audit fields`);
  check(renderer.includes('guest.late_add_approved_by ? "Late Add" : "Needs Approval"'), `${label} cards preserve concise missing-approval warning`);
}
check(["late_adds", "approved_by", "reason", "added_by", "added_at"].every(field => closeoutData.includes(field)), "closeout data retains all Late Adds audit fields");
check(["Late Adds", "Approved By", "Reason", "Added By", "Added At"].every(label => closeoutView.includes(label)), "closeout preview retains Late Adds audit columns");
check(["Late Add", "Approved By", "Reason/Notes", "Added By", "Added At"].every(label => closeoutCsv.includes(label)), "closeout CSV retains Late Adds audit columns");

const serviceRows = topbar.match(/<div class="df-service-context-row">([\s\S]*?)<\/div>\s*<div class="df-service-sync-row">([\s\S]*?)<\/div>/);
check(Boolean(serviceRows && !/renderSyncPill|df-refresh-button/.test(serviceRows[1]) && /renderSyncPill\(\)/.test(serviceRows[2]) && /df-refresh-button/.test(serviceRows[2])), "date controls and status/Refresh remain in separate utility rows");
check(topbar.includes('<select onchange="setActiveDay(this.value)">') && topbar.includes('<input id="df-service-date" type="date" value="${esc(state.activeDate)}" onchange="setActiveDate(this.value)" />'), "native Day and Service Date controls retain values, type, ID, and handlers");
check(/<div class="df-service-context-row">[\s\S]*?<label class="df-service-field">[\s\S]*?<select[\s\S]*?<\/label>\s*<label class="df-service-field">[\s\S]*?<input id="df-service-date" type="date"[\s\S]*?<\/label>\s*<\/div>/s.test(topbar), "native Service Date remains in the final immediate service-field wrapper targeted by P6.10");
check(/df-service-context-row[\s\S]*df-service-date[\s\S]*df-service-sync-row[\s\S]*renderSyncPill\(\)[\s\S]*df-refresh-label/s.test(topbar), "utility service rows retain date, truthful sync pill, and visible Refresh label");
check(count(renderAppBlock, /renderSyncPill\("notice"\)/g) === 1, "live views render one consolidated sync notice");
check(syncPill.includes('state.error ? "Error"') && syncPill.includes('state.loading ? "Syncing"') && syncPill.includes('state.syncStatus || "Live"'), "sync notice derives its label from current error, loading, and sync state");
check(syncPill.includes('statusKey.includes("saving")') && syncPill.includes('statusKey.includes("syncing")') && syncPill.includes('statusKey.includes("failed")'), "sync notice gives transitional and failed states truthful warning/error tones");
check(count(syncPill, /df-door-live-sync-notice/g) === 1, "sync renderer defines one compact live-service notice");
check(["df-door-shift-notes--empty", "df-door-shift-brief-row", "df-door-shift-empty-summary"].every(token => shiftBrief.includes(token)), "empty Shift Brief uses the compact semantic treatment");
check(mobileManagerView.indexOf("Quick Add") < mobileManagerView.indexOf("${renderMobileManagerServiceDateCard()}"), "mobile Manager places Quick Add before the duplicate date control");
check(!mobileManagerView.includes("mobile-manager-live-badge") && !mobileManagerView.includes(" / ${state.activeDate}"), "mobile Manager removes hardcoded Live and repeated header date copy");
check(mobileManagerServiceDate.includes('<details id="mobileManagerServiceDateDetails"') && mobileManagerServiceDate.includes('onchange="setActiveDate(this.value)"') && mobileManagerServiceDate.includes('onclick="useTodayDate()"'), "mobile Manager date remains available on demand with existing handlers");
check(renderAppBlock.indexOf("${renderShiftNotesForDoorStaff()}${renderMainWorkspace(false)}") >= 0 && renderAppBlock.indexOf("${renderShiftNotesForDoorStaff()}${renderTabletDoorMode()}") >= 0, "Door and Tablet place Shift Brief before the operational workspace");

for (const [label, renderer] of [["Door", guestList], ["Tablet", tabletGuestCards]]) {
  check(renderer.includes("data-live-roster-card") && renderer.includes('data-guest-id="${esc(guest.id)}"'), `${label} cards expose stable existing guest identifiers`);
  check(count(renderer, /data-roster-action=/g) > 0 && count(renderer, /data-roster-action=/g) === count(renderer, /<button type="button"[^>]*data-roster-action=/g), `${label} roster actions remain non-submit buttons`);
}
check(captureAnchor.includes('state.view !== "door" && state.view !== "tabletDoor"'), "stable-anchor capture is scoped to Door live-service views");
check(captureAnchor.includes("document.scrollingElement") && captureAnchor.includes('document.getElementById("guestScrollPanel")'), "stable-anchor capture audits document and nested Door roster scrollers");
check(captureAnchor.includes("getBoundingClientRect()") && captureAnchor.includes("cardOffset"), "stable-anchor capture records the card's visual offset");
check(restoreAnchor.indexOf("snapshot.nextGuestId") < restoreAnchor.indexOf("snapshot.previousGuestId"), "missing or reordered records fall back to the next then previous guest");
check(restoreAnchor.includes("requestAnimationFrame") && !restoreAnchor.includes("setTimeout"), "anchor restoration uses one deterministic frame and no timeout");
check(restoreAnchor.includes("snapshot.generation !== liveRosterAnchorGeneration"), "stale action generations cannot restore an older position");
check(restoreAnchor.includes('data-roster-action="${name}"') && restoreAnchor.includes("focus({ preventScroll:true })"), "keyboard focus returns to the updated action without scrolling");
check(prepareAnchor.includes("document.activeElement === control"), "touch input does not receive forced focus unless the action control held focus");
check(prepareAnchor.includes("queueMicrotask") && prepareAnchor.includes("!isGuestCheckActionBusy(primaryGuestId)"), "blocked or no-op actions clear their unused anchor before later refreshes");
check(restoreAnchor.includes("focusIsUnclaimed") && restoreAnchor.includes('activeElement === document.getElementById("main-content")'), "focus restoration does not steal a newer field or control focus");
check(captureTransient.includes("liveRoster:") && restoreTransient.includes("restoreLiveRosterAnchor"), "full renders preserve the live roster anchor");
check(refreshVisibleGuests.indexOf("captureLiveRosterAnchor") < refreshVisibleGuests.indexOf("guestPanel.innerHTML") && refreshVisibleGuests.indexOf("restoreLiveRosterAnchor") > refreshVisibleGuests.indexOf("tabletGrid.innerHTML"), "partial roster refresh captures before replacement and restores afterward");
check(count(runtime, /let liveRosterAnchorGeneration = 0;/g) === 1 && count(runtime, /let pendingLiveRosterAnchor = null;/g) === 1 && count(appJs, /let liveRosterAnchorGeneration = 0;/g) === 1 && count(appJs, /let pendingLiveRosterAnchor = null;/g) === 1, "anchor generation state exists exactly once in runtime and mirror");
check(/Object\.assign\(window,[\s\S]*?prepareLiveRosterAction,/s.test(runtime), "presentation-only action preparation remains callable from inline handlers");

const noForcedScrollFunctions = ["checkInOneGuest", "undoOneGuest", "manualRefreshData", "refreshLiveDataSilently", "requestRealtimeRefresh", "subscribeRealtime"];
for (const name of noForcedScrollFunctions) {
  const block = extractFunction(runtime, name);
  check(!/scrollTo\s*\(\s*0\s*,\s*0|scrollIntoView\s*\(/.test(block), `${name} does not force the roster to the top or another record`);
}
for (const name of ["refreshLiveDataSilently", "requestRealtimeRefresh", "subscribeRealtime"]) {
  const block = extractFunction(runtime, name);
  check(!block.includes("prepareLiveRosterAction") && !block.includes("liveRosterAnchorGeneration"), `${name} cannot create a local action anchor or supersede its generation`);
}

check(Boolean(p65Css), "P6.5 mobile/print CSS boundary marker exists");
check(Boolean(p67Css), "P6.7 phone date-collision CSS boundary exists");
check(Boolean(p69Css), "P6.9 stacked phone service-context CSS boundary exists");
check(Boolean(p610Css), "P6.10 iOS Service Date overlay-gutter CSS boundary exists");
check(/@media\s*\(max-width:\s*540px\)[\s\S]*?\.df-service-context-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*auto\)\s*minmax\(0,\s*1fr\);/s.test(p67Css), "P6.7 bounded side-by-side service-context rule remains preserved");
check(/\.df-service-context-row\s*>\s*\.df-service-field\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s.test(p67Css), "both service-date row children may shrink inside their tracks");
check(/#df-service-date\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s.test(p67Css), "native Service Date input is border-box and container-bounded");
check(/\.df-utility-inner\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*padding-inline-start:\s*max\(10px,\s*calc\(var\(--df-safe-left\)\s*\+\s*10px\)\);[^}]*padding-inline-end:\s*max\(16px,\s*calc\(var\(--df-safe-right\)\s*\+\s*10px\)\);/s.test(p67Css), "phone utility content reserves deliberate safe-area-aware edge padding");
check(/\.df-shell-service,[\s\S]*?\.df-service-context-row\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s.test(p67Css), "phone service wrapper remains bounded by the utility container");
check(/@media\s*\(max-width:\s*540px\)[\s\S]*?\.df-service-context-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s.test(p69Css), "P6.9 stacks Day and Service Date in one bounded phone column");
check(/\.df-service-context-row\s*>\s*\.df-service-field,[\s\S]*?\.df-service-context-row\s*>\s*\.df-service-field\s*>\s*select,[\s\S]*?\.df-service-context-row\s*>\s*\.df-service-field\s*>\s*input\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s.test(p69Css), "P6.9 makes both phone service fields and native controls full-width and bounded");
check(/\.df-utility-inner\s*\{[^}]*padding-inline-end:\s*calc\(24px\s*\+\s*var\(--df-safe-right\)\);/s.test(p69Css), "P6.9 reserves 24px plus the safe-area inset at the phone right edge");
check(count(p69Css, /var\(--df-safe-right\)/g) === 1, "P6.9 applies the right safe-area inset exactly once");
check(/#df-service-date\s*\{[^}]*display:\s*block;[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*inline-size:\s*100%;[^}]*min-inline-size:\s*0;[^}]*max-inline-size:\s*100%;/s.test(p69Css), "P6.9 keeps the native Service Date input fully container-bound");
check(/@media\s*\(max-width:\s*540px\)[\s\S]*?\.df-service-context-row\s*>\s*\.df-service-field:last-child\s*\{[^}]*--df-mobile-overlay-gutter:\s*20px;[^}]*box-sizing:\s*border-box;[^}]*justify-self:\s*start;[^}]*width:\s*calc\(100%\s*-\s*var\(--df-mobile-overlay-gutter\)\);[^}]*min-width:\s*0;[^}]*max-width:\s*calc\(100%\s*-\s*var\(--df-mobile-overlay-gutter\)\);/s.test(p610Css), "P6.10 narrows the immediate phone Service Date wrapper by a dedicated 20px overlay gutter");
check(/\.df-service-context-row\s*>\s*\.df-service-field:last-child\s*\{[^}]*inline-size:\s*calc\(100%\s*-\s*var\(--df-mobile-overlay-gutter\)\);[^}]*min-inline-size:\s*0;[^}]*max-inline-size:\s*calc\(100%\s*-\s*var\(--df-mobile-overlay-gutter\)\);/s.test(p610Css), "P6.10 applies the same bounded gutter through logical sizing");
const p69UtilityGutter = Number(p69Css.match(/padding-inline-end:\s*calc\((\d+)px\s*\+\s*var\(--df-safe-right\)\)/)?.[1] || 0);
const p610OverlayGutter = Number(p610Css.match(/--df-mobile-overlay-gutter:\s*(\d+)px/)?.[1] || 0);
check(p610OverlayGutter >= 18 && p610OverlayGutter <= 24 && p69UtilityGutter + p610OverlayGutter >= 40, "P6.10 statically represents at least 16px beyond the reviewed phone edge reserve");
check(/@media\s*\(max-width:\s*540px\)[\s\S]*?\.df-service-sync-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto;/s.test(p65Css), "phone connection row separates status from Refresh");
check(/@media\s*\(max-width:\s*380px\)[\s\S]*?\.df-service-sync-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s.test(p65Css), "very narrow phones stack connection and Refresh");
check(themeCss.includes("--df-safe-top: env(safe-area-inset-top, 0px)") && themeCss.includes("--df-safe-bottom: env(safe-area-inset-bottom, 0px)") && p65Css.includes("var(--df-safe-top)") && p65Css.includes("var(--df-safe-bottom)"), "phone shell consumes top and bottom safe-area insets");
check(p65Css.includes(".df-door-live-sync-notice") && p65Css.includes(".df-door-shift-notes--empty"), "phone live status and empty Shift Brief use compact scoped treatments");
check(/\.df-door-context__controls\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s.test(p65Css) && /@media\s*\(max-width:\s*380px\)[\s\S]*?\.df-door-theme\s+\.df-door-context__controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s.test(p65Css), "Operating Context uses safe two-track and stacked phone layouts");
check(!/overflow-x:\s*hidden/i.test(p65Css), "P6.5 does not conceal horizontal overflow defects");
check(!/overflow(?:-x|-inline)?\s*:\s*(?:hidden|clip)/i.test(p67Css), "P6.7 does not conceal edge defects with overflow hiding");
check(!/overflow(?:-x|-inline)?\s*:\s*(?:hidden|clip)/i.test(p69Css), "P6.9 does not conceal edge defects with overflow hiding");
check(!/overflow(?:-x|-inline)?\s*:\s*(?:hidden|clip)/i.test(p610Css), "P6.10 does not conceal the native date field with overflow hiding");
check(!/overflow(?:-x|-inline)\s*:\s*(?:hidden|clip)/i.test(themeCss), "operational CSS contains no horizontal overflow-hiding workaround");
check(!/calendar-picker-indicator|appearance\s*:\s*none/i.test(`${p67Css}\n${p69Css}\n${p610Css}`), "P6.10 preserves the native calendar affordance");
check(!/\b(?:width|max-width|min-width)\s*:[^;]*100(?:d|s|l)?vw/i.test(p67Css), "P6.7 uses container width rather than viewport-width calculations");
check(!/\b(?:width|max-width|min-width)\s*:[^;]*100(?:d|s|l)?vw/i.test(p69Css), "P6.9 uses container width rather than viewport-width calculations");
check(!/\b(?:width|max-width|min-width|inline-size|max-inline-size|min-inline-size)\s*:[^;]*100(?:d|s|l)?vw/i.test(p610Css), "P6.10 uses container width rather than viewport-width calculations");

const baselineSurface = `${baselineIndex}\n${baselineApp}`;
const currentSurface = `${indexHtml}\n${appJs}`;
for (const [label, pattern] of [
  ["fetch calls", /\bfetch\s*\(/g],
  ["XMLHttpRequest references", /\bXMLHttpRequest\b/g],
  ["localStorage references", /\blocalStorage\b/g],
  ["sessionStorage references", /\bsessionStorage\b/g],
  ["Supabase client creation", /\.createClient\s*\(/g],
  ["setTimeout calls", /\bsetTimeout\s*\(/g],
  ["setInterval calls", /\bsetInterval\s*\(/g],
  ["event listener registrations", /\.addEventListener\s*\(/g]
]) {
  check(count(currentSurface, pattern) === count(baselineSurface, pattern), `no new ${label}`);
}

for (const token of ["googletagmanager", "gtag(", "mixpanel", "segment.io"]) {
  check(!`${indexHtml}\n${appJs}\n${themeCss}`.toLowerCase().includes(token), `no analytics reference ${token}`);
}

check(!/@import\b/i.test(p5Css), "P5 adds no CSS import");
check(!/url\(\s*["']?https?:/i.test(p5Css), "P5 adds no remote assets");
check(!/fonts\.(googleapis|gstatic)\.com/i.test(`${indexHtml}\n${themeCss}`), "P5 adds no external font service");

const statusRecords = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
const changedPaths = statusRecords
  .filter(record => {
    const path = record.slice(3).replaceAll("\\", "/");
    return !(record.startsWith("?? ") && path === ".codex/config.toml");
  })
  .map(record => record.slice(3).replaceAll("\\", "/"));
const forbiddenChanges = changedPaths.filter(path =>
  path.endsWith(".sql")
  || /rls|policy_snapshot/i.test(path)
);
check(forbiddenChanges.length === 0, "SQL, RLS, and policy snapshot files are unchanged");

const allowedChanges = new Set([
  "app.js",
  "index.html",
  "doorflow-operational-theme.css",
  "scripts/p3-shell-smoke.mjs",
  "scripts/p4-admin-smoke.mjs",
  "scripts/p5-door-smoke.mjs",
  "scripts/p6-checkin-race-smoke.mjs",
  "scripts/p6-release-smoke.mjs",
  "sw.js",
  "manifest.webmanifest",
  "docs/OPERATIONAL_UI_DESIGN_SYSTEM.md",
  "docs/P6_RELEASE_HARDENING.md",
  "docs/DOORFLOW_RELEASE_RUNBOOK.md",
  "docs/DOORFLOW_ROLLBACK_RUNBOOK.md",
  "docs/P6_MANUAL_ACCEPTANCE_CHECKLIST.md",
  "docs/P6_REALTIME_CONFIGURATION.md",
  "ui-redesign/README.md"
]);
check(changedPaths.every(path => allowedChanges.has(path)), "working changes stay inside the approved P5 file set");

if (failures) {
  console.error(`\nP5 Door smoke failed with ${failures} issue${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`\nP5 Door smoke passed: ${unchangedProtectedNames.length} unrelated non-presentation functions match HEAD, ${p61AuthorizedFunctions.size} P6.1 functions and ${p65AuthorizedFunctions.size} P6.5 presentation functions passed authorized checks, and ${presentationFunctions.size} approved presentation functions retain mirror parity.`);
console.log("Static checks do not prove visual quality, authenticated role behavior, or live Supabase behavior.");
