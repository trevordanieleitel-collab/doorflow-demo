import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const presentationFunctions = new Set([
  "renderMobileManagerView",
  "renderShiftNotesForDoorStaff",
  "renderCloseOutReportModal",
  "renderTopbar",
  "renderDateBar",
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
  "renderApp"
]);

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
const baselineTheme = fromHead("doorflow-operational-theme.css");
const runtime = extractRuntime(indexHtml);
const baselineRuntime = extractRuntime(baselineIndex);
const p5Css = themeCss.split("/* Phase P5:")[1] || "";
const p51Css = themeCss.split("/* Phase P5.1:")[1] || "";
const p52Css = themeCss.split("/* Phase P5.2:")[1] || "";
const p53Css = themeCss.split("/* Phase P5.3:")[1] || "";
const preP5Css = themeCss.split("/* Phase P5:")[0].trimEnd();

check(Boolean(runtime), "inline operational runtime remains in index.html");
check(!/<script[^>]+src=["'](?:\.\/)?app\.js["']/i.test(indexHtml), "index.html remains the active inline runtime");

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
check(functionNames.join("|") === baselineFunctionNames.join("|"), "function inventory and ordering match the Phase P4 baseline");

const mirrorMismatches = functionNames.filter(name => {
  const appBlock = extractFunction(appJs, name);
  const runtimeBlock = extractFunction(runtime, name);
  return !appBlock || !runtimeBlock || hash(appBlock) !== hash(runtimeBlock);
});
check(mirrorMismatches.length === 0, `runtime/mirror parity (${functionNames.length} functions)`);
if (mirrorMismatches.length) console.error(`  Mismatches: ${mirrorMismatches.join(", ")}`);

const protectedNames = functionNames.filter(name => !presentationFunctions.has(name));
const protectedMismatches = protectedNames.filter(name => {
  const blocks = [
    extractFunction(appJs, name),
    extractFunction(runtime, name),
    extractFunction(baselineApp, name),
    extractFunction(baselineRuntime, name)
  ];
  return blocks.some(block => !block) || new Set(blocks.map(hash)).size !== 1;
});
check(protectedMismatches.length === 0, `all ${protectedNames.length} non-presentation functions match HEAD byte-for-byte`);
if (protectedMismatches.length) console.error(`  Mismatches: ${protectedMismatches.join(", ")}`);

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
  'onclick="checkInOneGuest(\'${guest.id}\')"',
  'onclick="undoOneGuest(\'${guest.id}\')"'
];

for (const contract of eventContracts) {
  check(runtime.includes(contract), `Door event contract ${contract}`);
}

for (const [label, pattern] of [
  ["desktop check-in action", /onclick="checkInOneGuest\('\$\{guest\.id\}'\)"/g],
  ["desktop undo action", /onclick="undoOneGuest\('\$\{guest\.id\}'\)"/g],
  ["group selection action", /onclick="selectGroup\('\$\{group\.id\}'\)"/g],
  ["single primary navigation", /<nav class="df-primary-nav"/g]
]) {
  const currentCount = count(runtime, pattern);
  const baselineCount = count(baselineRuntime, pattern);
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
check(preP5Css === baselineTheme.trimEnd(), "all committed Phase P4 CSS remains byte-identical before the P5 boundary");
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
const changedPaths = statusRecords.map(record => record.slice(3).replaceAll("\\", "/"));
const forbiddenChanges = changedPaths.filter(path =>
  path.endsWith(".sql")
  || /(^|\/)(sw\.js|manifest\.webmanifest)$/.test(path)
  || /rls|policy_snapshot/i.test(path)
);
check(forbiddenChanges.length === 0, "SQL, RLS, policy snapshot, service worker, and manifest files are unchanged");
check(hash(read("sw.js")) === hash(fromHead("sw.js")), "service worker matches HEAD");
check(hash(read("manifest.webmanifest")) === hash(fromHead("manifest.webmanifest")), "manifest matches HEAD");

const allowedChanges = new Set([
  "app.js",
  "index.html",
  "doorflow-operational-theme.css",
  "scripts/p3-shell-smoke.mjs",
  "scripts/p4-admin-smoke.mjs",
  "scripts/p5-door-smoke.mjs",
  "docs/OPERATIONAL_UI_DESIGN_SYSTEM.md",
  "ui-redesign/README.md"
]);
check(changedPaths.every(path => allowedChanges.has(path)), "working changes stay inside the approved P5 file set");

if (failures) {
  console.error(`\nP5 Door smoke failed with ${failures} issue${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`\nP5 Door smoke passed: ${protectedNames.length} non-presentation functions match HEAD and ${presentationFunctions.size} approved presentation renderers retain mirror parity.`);
console.log("Static checks do not prove visual quality, authenticated role behavior, or live Supabase behavior.");
