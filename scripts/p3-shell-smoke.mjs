import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const protectedFunctions = [
  "renderMainWorkspace",
  "renderGuestList",
  "renderTabletGuestCards",
  "renderTabletDoorMode",
  "renderGroupList",
  "renderSelectedGroupPanel",
  "renderShiftNotesForDoorStaff",
  "renderStaffManagement",
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
  "buildCloseOutReportData",
  "buildCloseOutReportHtml",
  "downloadCloseOutJson",
  "closeOutNight",
  "previewCloseOutReport",
  "printCloseOutReport",
  "downloadCloseOutReportCsv"
];

const shellFunctions = [
  "renderDoorFlowLockup",
  "shellInitials",
  "shellUsesDrawer",
  "setShellNavOpen",
  "toggleShellNav",
  "closeShellNav",
  "shellNavigate",
  "handleShellKeydown",
  "renderLogin",
  "renderTopbar",
  "renderTabs",
  "renderDateBar",
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
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).replaceAll("\r\n", "\n");
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

function normalizeProtectedPresentation(name, source) {
  if (name === "renderMainWorkspace") {
    return source.replace('class="grid df-door-workspace"', 'class="grid"');
  }
  if (name === "renderStaffManagement") {
    return source.replace('class="grid df-staff-workspace"', 'class="grid"');
  }
  return source;
}

const indexHtml = read("index.html");
const appJs = read("app.js");
const themeCss = read("doorflow-operational-theme.css");
const baselineIndex = fromHead("index.html");
const baselineApp = fromHead("app.js");
const runtime = extractRuntime(indexHtml);
const baselineRuntime = extractRuntime(baselineIndex);

check(Boolean(runtime), "inline operational runtime remains in index.html");
check(count(indexHtml, /<link\s+rel="stylesheet"\s+href="\/doorflow-operational-theme\.css">/g) === 1, "operational theme is linked exactly once");
check(count(runtime, /<nav class="df-primary-nav"/g) === 1, "runtime produces one primary navigation structure");
check(count(runtime, /\$\{renderTabs\(\)\}/g) === 1, "authenticated shell renders the navigation tree once");

for (const className of [
  "df-app-shell",
  "df-sidebar",
  "df-shell-content",
  "df-utility-bar",
  "df-main-content",
  "df-nav-backdrop",
  "df-admin-theme"
]) {
  check(runtime.includes(className), `required shell class ${className}`);
}

for (const contract of [
  'onsubmit="login(event)"',
  'id="df-login-email"',
  'name="email"',
  'id="df-login-password"',
  'name="password"'
]) {
  check(runtime.includes(contract), `login contract ${contract}`);
}

for (const role of ["admin", "manager", "door", "viewer"]) {
  check(new RegExp(`\\b${role}\\s*:\\s*\\{`).test(runtime), `role identifier ${role}`);
}

check(runtime.includes('id="df-service-date"'), "service-date control identifier");
check(runtime.includes('onchange="setActiveDay(this.value)"'), "service-day handler contract");
check(runtime.includes('onchange="setActiveDate(this.value)"'), "service-date handler contract");
check(runtime.includes('onclick="closeShellNav(false);logout()"'), "logout handler contract");
check(runtime.includes('aria-current="page"'), "accessible active navigation contract");
check(runtime.includes('aria-controls="df-primary-sidebar"'), "drawer control relationship");
check(runtime.includes('document.addEventListener("keydown", handleShellKeydown)'), "single global drawer keyboard binding");
check(count(runtime, /class="grid df-door-workspace"/g) === 1, "Door workspace responsive class exists once in runtime");
check(count(appJs, /class="grid df-door-workspace"/g) === 1, "Door workspace responsive class exists once in mirror");
check(count(runtime, /class="grid df-staff-workspace"/g) === 1, "Staff responsive class exists once in runtime");
check(count(appJs, /class="grid df-staff-workspace"/g) === 1, "Staff responsive class exists once in mirror");
check(/\.df-main-content\s*\{[^}]*container-name:\s*df-main-content;[^}]*container-type:\s*inline-size;/s.test(themeCss), "main content exposes a named inline-size query container");
check(/\.df-door-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(20rem,\s*26\.875rem\);/s.test(themeCss), "Door workspace uses safe two-column minmax tracks");
check(/@container\s+df-main-content\s*\(max-width:\s*68rem\)[\s\S]*?\.df-door-workspace\s*,[\s\S]*?\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s.test(themeCss), "Door workspace has a content-width stacked rule");
check(/\.df-door-workspace\s*>\s*aside\s*\{[^}]*position:\s*static;[^}]*align-self:\s*start;/s.test(themeCss), "Door workspace right panel remains in normal flow");
check(/\.df-door-workspace\s+\.toolbar\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s.test(themeCss), "Door workspace filters wrap without fixed tracks");
check(/\.df-staff-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(18rem,\s*26\.875rem\);/s.test(themeCss), "Staff workspace uses safe two-column minmax tracks");
check(/@container\s+df-main-content\s*\(max-width:\s*68rem\)[\s\S]*?\.df-staff-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s.test(themeCss), "Staff workspace has a content-width stacked rule");
check(/@media\s*\(max-width:\s*860px\)[\s\S]*?\.df-staff-workspace\s+tbody\s+tr\s*\{[^}]*display:\s*grid;/s.test(themeCss), "Staff table has a narrow-screen record layout");
check(/\.df-staff-workspace\s+h2,[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*break-word;/s.test(themeCss), "Staff text uses normal wrapping without clipping");

const baselineSurface = `${baselineIndex}\n${baselineApp}`;
const currentSurface = `${indexHtml}\n${appJs}`;
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

for (const name of protectedFunctions) {
  const currentIndexBlock = extractFunction(runtime, name);
  const baselineIndexBlock = extractFunction(baselineRuntime, name);
  const currentAppBlock = extractFunction(appJs, name);
  const baselineAppBlock = extractFunction(baselineApp, name);
  const present = currentIndexBlock && baselineIndexBlock && currentAppBlock && baselineAppBlock;
  const normalizedCurrentIndex = normalizeProtectedPresentation(name, currentIndexBlock);
  const normalizedCurrentApp = normalizeProtectedPresentation(name, currentAppBlock);
  const matched = present
    && hash(normalizedCurrentIndex) === hash(baselineIndexBlock)
    && hash(normalizedCurrentApp) === hash(baselineAppBlock)
    && hash(currentIndexBlock) === hash(currentAppBlock);
  const qualifier = ["renderMainWorkspace", "renderStaffManagement"].includes(name) ? " (presentation class only)" : "";
  check(Boolean(matched), `protected function ${name}${qualifier}`);
}

for (const name of shellFunctions) {
  const runtimeBlock = extractFunction(runtime, name);
  const mirrorBlock = extractFunction(appJs, name);
  check(Boolean(runtimeBlock && mirrorBlock && hash(runtimeBlock) === hash(mirrorBlock)), `shell mirror ${name}`);
}

const statusRecords = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
const changedPaths = statusRecords.map(record => record.slice(3).replaceAll("\\", "/"));
const forbiddenChanges = changedPaths.filter(path =>
  path.endsWith(".sql")
  || /(^|\/)(sw\.js|manifest\.webmanifest)$/.test(path)
  || /rls|policy_snapshot/i.test(path)
);
check(forbiddenChanges.length === 0, "SQL, RLS, policy snapshot, service worker, and manifest files are unchanged");

const allowedChanges = new Set([
  "app.js",
  "index.html",
  "doorflow-operational-theme.css",
  "scripts/p3-shell-smoke.mjs",
  "docs/OPERATIONAL_UI_DESIGN_SYSTEM.md",
  "ui-redesign/README.md"
]);
check(changedPaths.every(path => allowedChanges.has(path)), "working changes stay inside the approved P3 file set");

if (failures) {
  console.error(`P3 shell smoke failed: ${failures} check(s).`);
  process.exit(1);
}

console.log(`P3 shell smoke passed: ${protectedFunctions.length - 2} protected functions matched exactly; renderMainWorkspace and renderStaffManagement matched after normalizing presentation-only classes.`);
