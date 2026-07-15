import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const protectedFunctions = [
  "perms",
  "requirePerm",
  "viewAllowedForRole",
  "checkInOneGuest",
  "undoOneGuest",
  "toggleGuest",
  "createGuest",
  "createQuickManagerGuest",
  "mobileQuickAddGuest",
  "updateGuest",
  "savePlusOnes",
  "deleteGuest",
  "bulkAddNames",
  "importRows",
  "createGroup",
  "mobileQuickCreateGroup",
  "updateGroup",
  "deleteGroup",
  "clearGroupNames",
  "clearGeneralGuestList",
  "upsertPartyHostGuest",
  "mobileAddShiftNote",
  "createShiftNote",
  "updateShiftNote",
  "deleteShiftNote",
  "updateStaffProfile",
  "initAuth",
  "login",
  "logout",
  "loadStaffProfile",
  "bootDatabase",
  "ensureVenue",
  "ensureServiceDay",
  "loadDataForDate",
  "loadStaffProfilesForAdmin",
  "subscribeRealtime",
  "unsubscribeRealtime",
  "refreshLiveDataSilently",
  "requestRealtimeRefresh",
  "runDb",
  "prepareDatabaseAction",
  "withDoorFlowTimeout",
  "runCriticalAction",
  "dayStats",
  "exportCsv",
  "buildCloseOutReportData",
  "buildCloseOutReportHtml",
  "downloadCloseOutJson",
  "closeOutNight",
  "previewCloseOutReport",
  "printCloseOutReport",
  "downloadCloseOutReportCsv"
];

const protectedDoorRenderers = [
  "renderMainWorkspace",
  "renderGuestList",
  "renderTabletGuestCards",
  "renderTabletDoorMode",
  "renderGroupList",
  "renderSelectedGroupPanel",
  "renderShiftNotesForDoorStaff"
];

const administrativeRenderers = [
  "captureModalReturnFocus",
  "restoreModalReturnFocus",
  "syncModalFocus",
  "handleModalKeydown",
  "render",
  "renderAdminPageHeader",
  "renderAdminState",
  "renderManagement",
  "renderStaffManagement",
  "renderReports",
  "renderShiftNotesPanel",
  "renderCloseOutReportModal",
  "renderGroupModal",
  "renderGuestModal",
  "renderPlusOnesModal",
  "renderBulkModal",
  "renderShiftNoteModal",
  "renderModal",
  "renderApp"
];

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

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

const indexHtml = read("index.html");
const appJs = read("app.js");
const themeCss = read("doorflow-operational-theme.css");
const baselineIndex = fromHead("index.html");
const baselineApp = fromHead("app.js");
const baselineTheme = fromHead("doorflow-operational-theme.css");
const runtime = extractRuntime(indexHtml);
const baselineRuntime = extractRuntime(baselineIndex);

check(Boolean(runtime), "inline operational runtime remains in index.html");
check(!/<script[^>]+src=["'](?:\.\/)?app\.js["']/i.test(indexHtml), "index.html remains the inline runtime and does not load app.js");
check(count(indexHtml, /<link\s+rel="stylesheet"\s+href="\/doorflow-operational-theme\.css">/g) === 1, "operational theme remains linked exactly once");

const protectedMismatches = protectedFunctions.filter(name => {
  const blocks = [
    extractFunction(runtime, name),
    extractFunction(appJs, name),
    extractFunction(baselineRuntime, name),
    extractFunction(baselineApp, name)
  ];
  return blocks.some(block => !block) || new Set(blocks.map(hash)).size !== 1;
});
check(protectedMismatches.length === 0, `protected operational hashes match HEAD (${protectedFunctions.length} logic functions)`);
if (protectedMismatches.length) console.error(`  Mismatches: ${protectedMismatches.join(", ")}`);

const doorMirrorMismatches = protectedDoorRenderers.filter(name => {
  const runtimeBlock = extractFunction(runtime, name);
  const appBlock = extractFunction(appJs, name);
  return !runtimeBlock || !appBlock || hash(runtimeBlock) !== hash(appBlock);
});
check(doorMirrorMismatches.length === 0, `P5 Door renderer mirror parity (${protectedDoorRenderers.length} functions)`);
if (doorMirrorMismatches.length) console.error(`  Mismatches: ${doorMirrorMismatches.join(", ")}`);

const mirrorMismatches = administrativeRenderers.filter(name => {
  const runtimeBlock = extractFunction(runtime, name);
  const appBlock = extractFunction(appJs, name);
  return !runtimeBlock || !appBlock || hash(runtimeBlock) !== hash(appBlock);
});
check(mirrorMismatches.length === 0, `administrative renderer mirror parity (${administrativeRenderers.length} functions)`);
if (mirrorMismatches.length) console.error(`  Mismatches: ${mirrorMismatches.join(", ")}`);

const closeoutBlock = extractFunction(runtime, "renderCloseOutReportModal");
check(Boolean(closeoutBlock), "closeout report renderer exists");
for (const className of [
  "df-closeout-report",
  "df-closeout-report__header",
  "df-closeout-report__summary",
  "df-closeout-report__section",
  "df-closeout-report__table-wrap",
  "df-closeout-report__table",
  "df-closeout-report__empty"
]) {
  check(closeoutBlock.includes(className), `closeout renderer includes ${className}`);
  check(themeCss.includes(`.${className}`), `closeout theme includes ${className}`);
}

check(count(closeoutBlock, /onclick="closeModal\(\)"/g) === 1, "closeout report exposes one close handler");
check(count(closeoutBlock, /aria-label="Close report"/g) === 1, "closeout report exposes one accessible close label");
check(count(closeoutBlock, /class="df-closeout-report__table-wrap"/g) === 5, "all five report tables use bounded containers");
check(count(closeoutBlock, /class="df-closeout-report__table"/g) === 5, "all five report tables use the scoped table class");
check(count(closeoutBlock, /class="df-closeout-report__empty"/g) === 5, "all five report sections define deliberate empty states");
check(!closeoutBlock.includes("closeout-print-header") && !closeoutBlock.includes("closeout-report-table"), "legacy closeout spreadsheet markup is removed");
check(!closeoutBlock.includes(">Close</button>"), "redundant text Close action is removed");

const closeoutSectionIds = [
  'id="closeout-groups-title"',
  'id="closeout-late-adds-title"',
  'id="closeout-no-shows-title"',
  'id="closeout-notes-title"',
  'id="closeout-activity-title"'
];
check(closeoutSectionIds.every((sectionId, index) => {
  const position = closeoutBlock.indexOf(sectionId);
  const previous = index ? closeoutBlock.indexOf(closeoutSectionIds[index - 1]) : -1;
  return position >= 0 && position > previous;
}), "closeout section order is preserved");

check(/\.df-shell-modal-scope\s+\.df-closeout-report\s*\{[^}]*width:\s*min\(72rem,\s*calc\(100vw\s*-\s*2rem\)\);[^}]*max-height:\s*calc\(100dvh\s*-\s*2rem\);[^}]*overflow:\s*auto;/s.test(themeCss), "closeout modal uses viewport-safe dimensions and internal scrolling");
check(/\.df-closeout-report__table-wrap\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s.test(themeCss), "closeout horizontal scrolling is contained per table");
check(/@media\s*\(max-width:\s*700px\)[\s\S]*?\.df-closeout-report__table\s+tbody\s+td::before\s*\{[^}]*content:\s*attr\(data-label\);/s.test(themeCss), "closeout tables become labeled mobile records");
check(/@page\s+doorflow-closeout\s*\{[^}]*size:\s*landscape;[^}]*margin:\s*0\.45in;/s.test(themeCss), "closeout print uses a dedicated landscape page setup");
check(/@media\s+print\s*\{[\s\S]*?\.df-closeout-report__actions,[\s\S]*?display:\s*none\s*!important;/s.test(themeCss), "closeout print hides report actions and close control");
check(/@media\s+print\s*\{[\s\S]*?#app:has\(\.df-closeout-report\)\s*>\s*\.df-app-shell\s*\{[^}]*display:\s*none\s*!important;/s.test(themeCss), "closeout print hides the unrelated application shell without hiding the report");
check(!/@media\s+print\s*\{[\s\S]*?#app\s*\{[^}]*display:\s*none\s*!important;/s.test(themeCss), "closeout print never hides the report's #app ancestor");
check(/\.df-shell-modal-scope\s+\.df-closeout-report\s*\{[^}]*page:\s*doorflow-closeout;/s.test(themeCss), "closeout report opts into the dedicated print page");
check(/@media\s+print\s*\{[\s\S]*?\.df-closeout-report__table\s+thead\s*\{[^}]*display:\s*table-header-group\s*!important;/s.test(themeCss), "closeout print restores repeating table headers");
check(!/\.df-closeout-report[^}]*overflow-x:\s*hidden/i.test(themeCss), "closeout styling does not hide horizontal overflow defects");

for (const className of [
  "df-admin-page",
  "df-admin-page-header",
  "df-admin-summary-grid",
  "df-report-grid",
  "df-data-table",
  "df-responsive-record-table",
  "df-admin-state",
  "df-management-page",
  "df-shift-notes-panel",
  "df-staff-workspace",
  "df-admin-modal"
]) {
  check(runtime.includes(className), `runtime includes ${className}`);
  check(themeCss.includes(`.${className}`), `theme includes ${className}`);
}

for (const contract of [
  'onclick="exportCsv()"',
  'onclick="loadDataForDate(state.activeDate)"',
  'onclick="previewCloseOutReport()"',
  'onsubmit="createShiftNote(event)"',
  'onsubmit="updateShiftNote(event)"',
  'onsubmit="updateStaffProfile(event)"',
  'onclick="openGroupModal()"',
  'onclick="openGuestModal()"',
  'onclick="openBulkPasteModal()"',
  'id="groupHostTotalAllowed"',
  'id="shiftNoteComposerText"',
  'id="shiftNoteEditText"',
  'form="staff-${profile.id}"',
  'role="dialog"',
  'aria-modal="true"'
]) {
  check(runtime.includes(contract), `required administrative contract ${contract}`);
}

for (const fieldId of [
  "groupName",
  "groupType",
  "guestFirstName",
  "guestLastName",
  "bulkNames",
  "shiftNoteCategory",
  "shiftNotePriority"
]) {
  check(runtime.includes(`for="${fieldId}"`) && runtime.includes(`id="${fieldId}"`), `label association ${fieldId}`);
}

check(runtime.includes('document.addEventListener("keydown", handleModalKeydown)'), "administrative modal keyboard handler is registered");
check(runtime.includes("modalReturnFocus"), "administrative modal focus restoration state exists");
check(/\.df-shell-modal-scope\s+\.df-admin-modal\s*\{[^}]*max-height:\s*calc\(100dvh\s*-\s*32px\);[^}]*overflow:\s*auto;/s.test(themeCss), "administrative dialogs use viewport-safe internal scrolling");
check(/\.df-admin-theme\s+\.df-responsive-record-table\s+tbody\s+td::before\s*\{[^}]*content:\s*attr\(data-label\);/s.test(themeCss), "report tables expose labeled mobile records");

const currentSurface = `${indexHtml}\n${appJs}`;
const baselineSurface = `${baselineIndex}\n${baselineApp}`;
for (const [label, pattern] of [
  ["fetch calls", /\bfetch\s*\(/g],
  ["XMLHttpRequest references", /\bXMLHttpRequest\b/g],
  ["localStorage references", /\blocalStorage\b/g],
  ["sessionStorage references", /\bsessionStorage\b/g],
  ["Supabase client creation", /\.createClient\s*\(/g]
]) {
  check(count(currentSurface, pattern) === count(baselineSurface, pattern), `no new ${label}`);
}

for (const token of ["googletagmanager", "gtag(", "mixpanel", "segment.io"]) {
  check(!`${indexHtml}\n${appJs}\n${themeCss}`.toLowerCase().includes(token), `no analytics reference ${token}`);
}

check(!/@import\b/i.test(themeCss), "no CSS import or remote font loader");
check(!/url\(\s*["']?https?:/i.test(themeCss), "no remote stylesheet assets");
check(!/fonts\.(googleapis|gstatic)\.com/i.test(`${indexHtml}\n${themeCss}`), "no external font service");

const p4Css = (themeCss.split("/* Phase P4 administrative workflow system.")[1] || "").split("/* Phase P5:")[0];
const preP4Css = themeCss.split("/* Phase P4 administrative workflow system.")[0].trimEnd();
check(Boolean(p4Css), "P4 CSS boundary marker exists");
check(!/\.df-(?:door-workspace|live-service-content|tablet-card-grid|guest-row|checkin)/i.test(p4Css), "P4 CSS does not target Door or live-service internals");
check(baselineTheme.startsWith(preP4Css), "P4 CSS is inserted after an unchanged committed P3 prefix");

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
check(changedPaths.every(path => allowedChanges.has(path)), "working changes stay inside the approved P4 file set");

if (failures) {
  console.error(`\nP4 administrative smoke failed with ${failures} issue${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("\nP4 administrative smoke passed. Static checks do not prove visual layout, authenticated role behavior, or live database behavior.");
