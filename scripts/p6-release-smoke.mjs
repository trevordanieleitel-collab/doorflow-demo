import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const baselineCommit = "1ce0f3c";
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
const p61ExpectedHashes = new Map([
  ["checkInOneGuest", "26aae0ac6add4db5ee4469f0a69901545c8b20e2557c88d9d1652fa2eaa6d180"],
  ["undoOneGuest", "13c9d6f65079903a9c8444bca71fb805f4a0843548f30012c1080631f377b809"],
  ["loadDataForDate", "a589bf926a8f3e59278c7d9bec192fd758e337399d20136c765b3eefe1f80eed"],
  ["hasPendingGuestCheckActions", "684881e91704db71daf69643cfd77605a74a3e6073f44a67edad6ec0697d3d65"],
  ["markGuestCheckStateChanged", "e0d0926199f5af396ea0b045da3536ec804a853d7c657bcf3d83081c9e83523a"],
  ["beginLiveDataSnapshot", "97dc8344afc43cec8388b477879845a38f5d1228a42cea64126e18abbdfb536a"],
  ["shouldApplyLiveDataSnapshot", "42c515c75f4582290b883144c89fce09e7ac4f1801f305aa99045aeee849c8e6"]
]);
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
const authorizedChangedFunctions = new Set([...p61AuthorizedFunctions, ...p65AuthorizedFunctions]);
const requiredRealtimeTables = [
  "guests",
  "groups",
  "check_in_logs",
  "shift_notes",
  "service_days",
  "staff_profiles"
];
const p66ProtectedGroups = {
  "Check In, Undo, and race": [
    "setActionBusy",
    "isActionBusy",
    "isGuestCheckActionBusy",
    "hasPendingGuestCheckActions",
    "markGuestCheckStateChanged",
    "beginLiveDataSnapshot",
    "shouldApplyLiveDataSnapshot",
    "refreshCheckActionSurfaces",
    "guestCheckStatePayload",
    "restoreGuestCheckState",
    "loadDataForDate",
    "checkInOneGuest",
    "undoOneGuest",
    "queueBackgroundRefreshAfterWrite"
  ],
  "Realtime and backup polling": [
    "clearStuckActionState",
    "shouldReconnectRealtimeAfterIdle",
    "shouldSkipAutoRefresh",
    "schedulePendingSync",
    "realtimePayloadAppliesToActiveDate",
    "refreshLiveDataSilently",
    "requestRealtimeRefresh",
    "startAutoRefresh",
    "startRealtimeHealthCheck",
    "stopRealtimeHealthCheck",
    "stopAutoRefresh",
    "manualRefreshData",
    "flushPendingSync",
    "scheduleResumeRecovery",
    "recoverFromIdle",
    "unsubscribeRealtime",
    "subscribeRealtime",
    "shouldPatchLiveRefresh"
  ],
  "Permissions and database guards": [
    "currentUser",
    "perms",
    "requirePerm",
    "defaultViewForRole",
    "viewAllowedForRole",
    "canManageData",
    "prepareDatabaseAction",
    "switchView"
  ],
  "Service-date state and handlers": [
    "setActiveDay",
    "setActiveDate",
    "useTodayDate"
  ]
};

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

function fromBaseline(path) {
  return git(["show", `${baselineCommit}:${path}`]);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function exactMembers(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && [...actual].sort().join("|") === [...expected].sort().join("|");
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
  const next = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|\nObject\.assign\(window/.exec(rest);
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

function realtimeSubscriptionTables(source) {
  const block = extractFunction(source, "subscribeRealtime");
  return [...block.matchAll(
    /\.on\(\s*"postgres_changes"\s*,\s*\{\s*event:\s*"\*"\s*,\s*schema:\s*"public"\s*,\s*table:\s*"([a-z_]+)"\s*\}/g
  )].map(match => match[1]);
}

function markdownSection(source, heading) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = source.indexOf("\n", start);
  const next = source.indexOf("\n## ", bodyStart + 1);
  return source.slice(bodyStart + 1, next < 0 ? source.length : next);
}

function normalizedSql(source) {
  return source.toLowerCase().replaceAll("`", "").replace(/\s+/g, " ").trim();
}

function pngDimensions(path) {
  const data = readFileSync(resolve(root, path));
  const signature = data.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" || data.length < 24) return null;
  return { width:data.readUInt32BE(16), height:data.readUInt32BE(20) };
}

function runSmoke(path, label) {
  try {
    execFileSync(process.execPath, [resolve(root, path)], { cwd:root, encoding:"utf8", stdio:"pipe" });
    check(true, label);
  } catch (error) {
    check(false, label);
    const detail = `${error.stdout || ""}${error.stderr || ""}`.trim();
    if (detail) console.error(detail);
  }
}

const requiredFiles = [
  "index.html",
  "app.js",
  "doorflow-operational-theme.css",
  "sw.js",
  "manifest.webmanifest",
  "scripts/p3-shell-smoke.mjs",
  "scripts/p4-admin-smoke.mjs",
  "scripts/p5-door-smoke.mjs",
  "scripts/p6-checkin-race-smoke.mjs",
  "scripts/p6-release-smoke.mjs",
  "docs/P6_RELEASE_HARDENING.md",
  "docs/DOORFLOW_RELEASE_RUNBOOK.md",
  "docs/DOORFLOW_ROLLBACK_RUNBOOK.md",
  "docs/P6_MANUAL_ACCEPTANCE_CHECKLIST.md",
  "docs/P6_REALTIME_CONFIGURATION.md"
];

for (const path of requiredFiles) {
  check(existsSync(resolve(root, path)), `required release file exists: ${path}`);
}

check(git(["rev-parse", "--short", "HEAD"]).trim() === baselineCommit, `HEAD remains P6 baseline ${baselineCommit}`);
check(git(["branch", "--show-current"]).trim() === "codex/premium-editorial-ui-redesign", "release candidate remains on the required branch");

const indexHtml = read("index.html");
const appJs = read("app.js");
const themeCss = read("doorflow-operational-theme.css");
const serviceWorker = read("sw.js");
const manifestSource = read("manifest.webmanifest");
const realtimeConfigurationDoc = read("docs/P6_REALTIME_CONFIGURATION.md");
const rollbackRunbook = read("docs/DOORFLOW_ROLLBACK_RUNBOOK.md");
const baselineIndex = fromBaseline("index.html");
const baselineApp = fromBaseline("app.js");
const baselineTheme = fromBaseline("doorflow-operational-theme.css");
const baselineManifest = fromBaseline("manifest.webmanifest");
const baselineServiceWorker = fromBaseline("sw.js");
const runtime = extractRuntime(indexHtml);
const baselineRuntime = extractRuntime(baselineIndex);

check(Boolean(runtime), "inline operational runtime remains in index.html");
check(!/<script[^>]+src=["'](?:\.\/)?app\.js["']/i.test(indexHtml), "index.html remains the active inline runtime");
check(hash(appJs) === "bae5fea19a92ded2ded128b076875f4399a30d11fa5a800a2ded7608e82b86f7", "P6.10 preserves app.js byte-for-byte");
check(count(indexHtml, /<link\s+rel="stylesheet"\s+href="\/doorflow-operational-theme\.css\?v=p6\.10">/g) === 1, "P6.10 gives the approved theme one fresh cache key");
check(count(indexHtml, /<link\s+rel="stylesheet"\s+href="\/doorflow-operational-theme\.css\?v=p6\.9">/g) === 0, "P6.10 leaves no active P6.9 stylesheet key");
check(count(indexHtml, /<link\s+rel="stylesheet"\s+href="\/doorflow-operational-theme\.css(?:\?[^"']*)?">/g) === 1, "P6.10 keeps exactly one operational theme link");
check(
  hash(indexHtml.replace("/doorflow-operational-theme.css?v=p6.10", "/doorflow-operational-theme.css"))
    === "d183710a9f10728aa43953387ee0fbea82ae29f7e78808a3f9b8c9fd0b0f9434",
  "P6.10 changes only the reviewed stylesheet cache key in index.html"
);
check(hash(indexHtml) !== hash(baselineIndex), "index.html contains the authorized P6.1 inline-runtime hardening");
check(hash(appJs) !== hash(baselineApp), "app.js contains the synchronized P6.1 mirror hardening");
const p65ThemeMarker = "/* Phase P6.5:";
const p65ThemeIndex = themeCss.indexOf(p65ThemeMarker);
const p67ThemeMarker = "/* Phase P6.7:";
const p67ThemeIndex = themeCss.indexOf(p67ThemeMarker);
const p69ThemeMarker = "/* Phase P6.9:";
const p69ThemeIndex = themeCss.indexOf(p69ThemeMarker);
const p610ThemeMarker = "/* Phase P6.10:";
const p610ThemeIndex = themeCss.indexOf(p610ThemeMarker);
const p69Css = p69ThemeIndex >= 0 ? themeCss.slice(p69ThemeIndex, p610ThemeIndex >= 0 ? p610ThemeIndex : undefined) : "";
const p610Css = p610ThemeIndex >= 0 ? themeCss.slice(p610ThemeIndex) : "";
check(p65ThemeIndex >= 0 && count(themeCss, /\/\* Phase P6\.5:/g) === 1, "operational CSS contains one P6.5 boundary");
check(p65ThemeIndex >= 0 && hash(themeCss.slice(0, p65ThemeIndex).trimEnd()) === hash(baselineTheme.trimEnd()), "operational CSS before P6.5 remains byte-identical to the P5 baseline");
check(p67ThemeIndex > p65ThemeIndex && count(themeCss, /\/\* Phase P6\.7:/g) === 1, "operational CSS contains one later P6.7 boundary");
check(p67ThemeIndex > p65ThemeIndex && hash(themeCss.slice(p65ThemeIndex, p67ThemeIndex).trimEnd()) === "2846db7ac13247dddd03d890556e08854429849f94ee6ac7afa95b462dab1752", "P6.7 preserves the complete P6.5 CSS section");
check(p69ThemeIndex > p67ThemeIndex && count(themeCss, /\/\* Phase P6\.9:/g) === 1, "operational CSS contains one later P6.9 boundary");
check(p69ThemeIndex > p67ThemeIndex && hash(themeCss.slice(0, p69ThemeIndex).trimEnd()) === "c29f337408c203e4bb5f6adf60cbf2faea331eb53c62da097b1e44a26684fd4e", "P6.9 preserves the complete reviewed P6.8 stylesheet prefix");
check(p610ThemeIndex > p69ThemeIndex && count(themeCss, /\/\* Phase P6\.10:/g) === 1, "operational CSS contains one later P6.10 boundary");
check(p610ThemeIndex > p69ThemeIndex && hash(themeCss.slice(0, p610ThemeIndex).trimEnd()) === "d47d94fc047682808d1336d8b1058cc95e8fda33a9056a904de959d3376d5f25", "P6.10 preserves the complete reviewed P6.9 stylesheet");
check(hash(themeCss) === "759137bffba1de2ac6bfe6d867afd0e5b96fd10a25fee97677c8e092dbc15a99", "P6.10 stylesheet contains only the reviewed iOS date-wrapper gutter appendix");
check(/@media\s*\(max-width:\s*540px\)[\s\S]*?\.df-service-context-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s.test(p69Css), "P6.9 stacks phone Day and Service Date fields");
check(/\.df-service-context-row\s*>\s*\.df-service-field,[\s\S]*?\.df-service-context-row\s*>\s*\.df-service-field\s*>\s*select,[\s\S]*?\.df-service-context-row\s*>\s*\.df-service-field\s*>\s*input\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s.test(p69Css), "P6.9 bounds both phone service fields and their native controls");
check(/\.df-utility-inner\s*\{[^}]*padding-inline-end:\s*calc\(24px\s*\+\s*var\(--df-safe-right\)\);/s.test(p69Css), "P6.9 reserves 24px plus the safe-area inset at the phone right edge");
check(count(p69Css, /var\(--df-safe-right\)/g) === 1, "P6.9 applies the right safe-area inset exactly once");
check(!/overflow(?:-x|-inline)?\s*:\s*(?:hidden|clip)/i.test(p69Css), "P6.9 adds no overflow-hiding workaround");
check(/@media\s*\(max-width:\s*540px\)[\s\S]*?\.df-service-context-row\s*>\s*\.df-service-field:last-child\s*\{[^}]*--df-mobile-overlay-gutter:\s*20px;[^}]*box-sizing:\s*border-box;[^}]*justify-self:\s*start;[^}]*width:\s*calc\(100%\s*-\s*var\(--df-mobile-overlay-gutter\)\);[^}]*min-width:\s*0;[^}]*max-width:\s*calc\(100%\s*-\s*var\(--df-mobile-overlay-gutter\)\);/s.test(p610Css), "P6.10 narrows the immediate native date wrapper by a dedicated 20px gutter");
check(/\.df-service-context-row\s*>\s*\.df-service-field:last-child\s*\{[^}]*inline-size:\s*calc\(100%\s*-\s*var\(--df-mobile-overlay-gutter\)\);[^}]*min-inline-size:\s*0;[^}]*max-inline-size:\s*calc\(100%\s*-\s*var\(--df-mobile-overlay-gutter\)\);/s.test(p610Css), "P6.10 carries the same gutter through logical sizing");
check(!/overflow(?:-x|-inline)?\s*:\s*(?:hidden|clip)/i.test(p610Css), "P6.10 adds no overflow-hiding workaround");
check(!/overflow(?:-x|-inline)\s*:\s*(?:hidden|clip)/i.test(themeCss), "operational CSS contains no horizontal overflow-hiding workaround");
check(!/calendar-picker-indicator|appearance\s*:\s*none/i.test(`${p69Css}\n${p610Css}`), "P6.10 leaves the native date affordance intact");
check(hash(themeCss) !== hash(baselineTheme), "operational CSS contains the authorized P6.5 presentation layer");
check(hash(manifestSource) === hash(baselineManifest), "manifest identity and presentation remain byte-identical to the P5 baseline");
check(hash(serviceWorker) === "5eeacdf87e5646cb43bdd5fd2320e0bc5a9290f41e84834424b18a60054ffee1", "P6.10 preserves the P6 service worker byte-for-byte");
check(hash(serviceWorker) !== hash(baselineServiceWorker), "service worker is intentionally hardened from the P5 baseline");

const functionNames = [...appJs.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]);
const baselineFunctionNames = [...baselineApp.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]);
check(functionNames.filter(name => !authorizedNewFunctions.has(name)).join("|") === baselineFunctionNames.join("|"), "function inventory matches baseline ordering plus authorized P6.1/P6.5 helpers");
check(functionNames.length === baselineFunctionNames.length + authorizedNewFunctions.size, "function inventory adds only authorized P6.1/P6.5 helpers");

const mirrorMismatches = functionNames.filter(name => {
  const appBlock = extractFunction(appJs, name);
  const runtimeBlock = extractFunction(runtime, name);
  return !appBlock || !runtimeBlock || hash(appBlock) !== hash(runtimeBlock);
});
check(mirrorMismatches.length === 0, `runtime/mirror function parity (${functionNames.length} functions)`);
if (mirrorMismatches.length) console.error(`  Mismatches: ${mirrorMismatches.join(", ")}`);

const appRealtimeTables = realtimeSubscriptionTables(appJs);
const runtimeRealtimeTables = realtimeSubscriptionTables(runtime);
check(
  exactMembers(appRealtimeTables, requiredRealtimeTables),
  "app.js subscribes once to exactly the six required public Realtime tables"
);
check(
  exactMembers(runtimeRealtimeTables, requiredRealtimeTables),
  "inline runtime subscribes once to exactly the six required public Realtime tables"
);
check(
  appRealtimeTables.join("|") === runtimeRealtimeTables.join("|"),
  "Realtime subscription inventory and order match runtime/mirror"
);

const unrelatedBaselineMismatches = functionNames.filter(name => !authorizedChangedFunctions.has(name)).filter(name => {
  const blocks = [
    extractFunction(appJs, name),
    extractFunction(runtime, name),
    extractFunction(baselineApp, name),
    extractFunction(baselineRuntime, name)
  ].map(block => normalizeP61BaselineBlock(name, block));
  return blocks.some(block => !block) || new Set(blocks.map(hash)).size !== 1;
});
check(unrelatedBaselineMismatches.length === 0, "all unrelated functions remain byte-identical to the P5 baseline");
if (unrelatedBaselineMismatches.length) console.error(`  Mismatches: ${unrelatedBaselineMismatches.join(", ")}`);

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

for (const [name, expectedHash] of p61ExpectedHashes) {
  check(
    hash(extractFunction(appJs, name)) === expectedHash
      && hash(extractFunction(runtime, name)) === expectedHash,
    `P6.7 preserves the reviewed P6.1 hash for ${name}`
  );
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

const protectedNames = functionNames.filter(name => !presentationFunctions.has(name));
const unchangedProtectedNames = protectedNames.filter(name => !p61AuthorizedFunctions.has(name));
const baselineProtectedNames = baselineFunctionNames.filter(name => !presentationFunctions.has(name));
check(protectedNames.length === baselineProtectedNames.length + p61NewFunctions.size, "non-presentation inventory adds only four P6.1 helpers");
check(unchangedProtectedNames.length === baselineProtectedNames.length - p61ChangedFunctions.size, `${unchangedProtectedNames.length} unrelated non-presentation functions remain baseline protected`);

for (const [label, names] of [
  ["unchanged pending, duplicate-prevention, and rollback", ["toggleGuest", "isGuestCheckActionBusy", "guestCheckStatePayload", "restoreGuestCheckState", "duplicateMatchesForName", "confirmDuplicateSingle"]],
  ["authentication, permission, and database guards", ["initAuth", "loadStaffProfile", "login", "logout", "perms", "requirePerm", "prepareDatabaseAction"]],
  ["unchanged loaders, venue authority, and realtime", ["ensureVenue", "ensureServiceDay", "subscribeRealtime", "requestRealtimeRefresh", "recoverFromIdle"]],
  ["guest, group, staff, and shift-note mutations", ["createGroup", "updateGroup", "deleteGroup", "createGuest", "updateGuest", "deleteGuest", "updateStaffProfile", "createShiftNote", "updateShiftNote", "deleteShiftNote"]],
  ["reports, closeout, export, and print", ["dayStats", "buildCloseOutReportData", "buildCloseOutReportHtml", "downloadCloseOutJson", "downloadCloseOutReportCsv", "printCloseOutReport", "exportCsv"]]
]) {
  check(names.every(name => !unrelatedBaselineMismatches.includes(name)), `${label} functions match baseline`);
}

for (const [label, names] of Object.entries(p66ProtectedGroups)) {
  const missing = names.filter(name => !extractFunction(appJs, name) || !extractFunction(runtime, name));
  const mirrorMismatch = names.filter(name => {
    const appBlock = extractFunction(appJs, name);
    const runtimeBlock = extractFunction(runtime, name);
    return appBlock && runtimeBlock && hash(appBlock) !== hash(runtimeBlock);
  });
  const baselineMismatch = names
    .filter(name => !p61AuthorizedFunctions.has(name))
    .filter(name => unrelatedBaselineMismatches.includes(name));
  check(missing.length === 0, `${label} protected functions remain present`);
  check(mirrorMismatch.length === 0, `${label} protected functions retain runtime/mirror parity`);
  check(baselineMismatch.length === 0, `${label} functions outside P6.1 remain baseline-identical`);
}

const inventorySection = markdownSection(
  realtimeConfigurationDoc,
  "Complete required publication inventory"
);
const documentedRealtimeTables = [
  ...inventorySection.matchAll(/^- `public\.([a-z_]+)`\s*$/gm)
].map(match => match[1]);
check(
  exactMembers(documentedRealtimeTables, requiredRealtimeTables),
  "Realtime configuration document lists exactly the six required public tables"
);
check(
  exactMembers(documentedRealtimeTables, appRealtimeTables),
  "documented publication inventory matches DoorFlow subscriptions"
);

const normalizedRealtimeConfiguration = normalizedSql(realtimeConfigurationDoc);
check(
  normalizedRealtimeConfiguration.includes(
    "alter publication supabase_realtime add table public.service_days, public.staff_profiles;"
  ),
  "Realtime configuration document records the scoped owner-applied publication addition"
);
check(
  normalizedRealtimeConfiguration.includes("from pg_publication_tables")
    && normalizedRealtimeConfiguration.includes("where pubname = 'supabase_realtime'")
    && /expected result is exactly six distinct rows/i.test(realtimeConfigurationDoc),
  "Realtime configuration document includes the read-only six-row inventory verification"
);
check(
  normalizedRealtimeConfiguration.includes("from pg_publication")
    && normalizedRealtimeConfiguration.includes("pubupdate")
    && /pubupdate\s*=\s*true/i.test(realtimeConfigurationDoc),
  "Realtime configuration document includes publication event-flag verification"
);
check(
  /static validation cannot verify the live publication state/i.test(realtimeConfigurationDoc),
  "Realtime documentation states the static-validation boundary"
);

const realtimeRollbackSection = markdownSection(
  rollbackRunbook,
  "Realtime publication-only rollback"
);
const normalizedRealtimeRollback = normalizedSql(realtimeRollbackSection);
check(
  normalizedRealtimeRollback.includes(
    "alter publication supabase_realtime drop table public.service_days, public.staff_profiles;"
  ),
  "rollback runbook contains the scoped publication-membership rollback"
);
check(
  /does not delete either table or any row/i.test(realtimeRollbackSection),
  "rollback states that publication removal does not delete data"
);
check(
  /use it only when[\s\S]*verified[\s\S]*Realtime regression/i.test(realtimeRollbackSection),
  "publication rollback is limited to a verified Realtime regression"
);
check(
  rollbackRunbook.includes("## Realtime publication-only rollback")
    && rollbackRunbook.includes("## Revert the UI release")
    && rollbackRunbook.includes("## No application-data, schema, or RLS rollback"),
  "Realtime-publication, UI, and database-incident procedures remain separate"
);

try {
  new Function(runtime);
  check(true, "inline runtime JavaScript parses");
} catch (error) {
  check(false, `inline runtime JavaScript parses: ${error.message}`);
}

try {
  execFileSync(process.execPath, ["--check", resolve(root, "sw.js")], { cwd:root, stdio:"pipe" });
  check(true, "service worker JavaScript parses");
} catch (error) {
  check(false, "service worker JavaScript parses");
}

let manifest = null;
try {
  manifest = JSON.parse(manifestSource);
  check(true, "manifest parses as JSON");
} catch (error) {
  check(false, `manifest parses as JSON: ${error.message}`);
}

if (manifest) {
  check(manifest.name === "The B.O.B. DoorFlow" && manifest.short_name === "DoorFlow", "manifest preserves approved product identity");
  check(manifest.start_url === "/" && manifest.scope === "/", "manifest start_url and scope remain root-scoped");
  check(manifest.display === "standalone", "manifest retains standalone display mode");
  check(/^#[0-9a-f]{6}$/i.test(manifest.background_color) && /^#[0-9a-f]{6}$/i.test(manifest.theme_color), "manifest colors are valid hex colors");
  for (const icon of manifest.icons || []) {
    const path = icon.src.replace(/^\//, "");
    const dimensions = existsSync(resolve(root, path)) ? pngDimensions(path) : null;
    const declared = String(icon.sizes || "").split("x").map(Number);
    check(Boolean(dimensions), `manifest icon exists and is PNG: ${icon.src}`);
    check(Boolean(dimensions && dimensions.width === declared[0] && dimensions.height === declared[1]), `manifest icon dimensions match ${icon.sizes}: ${icon.src}`);
  }
}

const cacheName = serviceWorker.match(/const CACHE_NAME = "([^"]+)";/)?.[1];
const cachePrefix = serviceWorker.match(/const CACHE_PREFIX = "([^"]+)";/)?.[1];
const shellMatch = serviceWorker.match(/const APP_SHELL = (\[[\s\S]*?\]);/);
let shellAssets = [];
try {
  shellAssets = shellMatch ? JSON.parse(shellMatch[1]) : [];
} catch {}

check(baselineServiceWorker.includes('const CACHE_NAME = "doorflow-cache-v29";'), "previous cache name is doorflow-cache-v29");
check(cacheName === "doorflow-cache-v30", "release candidate cache name is doorflow-cache-v30");
check(cachePrefix === "doorflow-cache-", "DoorFlow-owned cache prefix is explicit");
check(shellAssets.includes("/doorflow-operational-theme.css"), "operational stylesheet is pre-cached");
check(!shellAssets.includes("/app.js"), "unused app.js mirror is not pre-cached");
check(!shellAssets.some(path => path.startsWith("/icons/")), "obsolete legacy icon paths are not pre-cached");

for (const asset of shellAssets) {
  const path = asset === "/" ? "index.html" : asset.replace(/^\//, "");
  check(existsSync(resolve(root, path)), `pre-cached asset exists: ${asset}`);
}

check(!serviceWorker.includes("skipWaiting" + "();"), "service worker does not force immediate activation");
check(serviceWorker.includes("key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME"), "activate removes only old DoorFlow-owned caches");
check(!serviceWorker.includes("filter(key => key !== CACHE_NAME)"), "activate does not globally delete unrelated caches");
check(serviceWorker.includes('if (request.method !== "GET") return;'), "non-GET and mutation requests are not intercepted");
check(serviceWorker.includes("if (url.origin !== self.location.origin) return;"), "cross-origin requests are not intercepted");
check(["/rest/", "/auth/", "/realtime/", "/api/"].every(path => serviceWorker.includes(path)), "same-origin API and authentication paths are excluded");
check(serviceWorker.includes('fetch(request, { cache:"no-store" })'), "navigation uses network-first no-store fetching");
check(serviceWorker.includes('caches.match("/index.html")'), "navigation has a cached shell fallback");
check(serviceWorker.includes("APP_SHELL_PATHS.has(url.pathname)"), "static caching is restricted to the explicit shell allowlist");
check(!/location\.reload\s*\(|clients\.matchAll\s*\(/.test(serviceWorker), "service worker does not force an automatic reload");
check(!/background\s*sync|SyncManager|periodicSync/i.test(serviceWorker), "service worker adds no background sync");

const currentSurface = `${indexHtml}\n${appJs}\n${themeCss}\n${serviceWorker}`;
const baselineSurface = `${baselineIndex}\n${baselineApp}\n${baselineTheme}\n${baselineServiceWorker}`;
for (const [label, pattern] of [
  ["localStorage references", /\blocalStorage\b/g],
  ["sessionStorage references", /\bsessionStorage\b/g],
  ["Supabase client creation", /\.createClient\s*\(/g]
]) {
  check(count(currentSurface, pattern) === count(baselineSurface, pattern), `no new ${label}`);
}

for (const token of ["googletagmanager", "gtag(", "mixpanel", "segment.io"]) {
  check(!currentSurface.toLowerCase().includes(token), `no analytics reference ${token}`);
}
check(!/fonts\.(googleapis|gstatic)\.com/i.test(`${indexHtml}\n${themeCss}`), "no external font service");
check(!/@import\b/i.test(themeCss), "operational CSS adds no import");

const openBraces = count(themeCss, /\{/g);
const closeBraces = count(themeCss, /\}/g);
check(openBraces === closeBraces, `CSS braces are balanced (${openBraces}/${closeBraces})`);

const statusRecords = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
const changedPaths = statusRecords
  .filter(record => {
    const path = record.slice(3).replaceAll("\\", "/");
    return !(record.startsWith("?? ") && path === ".codex/config.toml");
  })
  .map(record => record.slice(3).replaceAll("\\", "/"));
const forbiddenChanges = changedPaths.filter(path => path.endsWith(".sql") || /rls|policy_snapshot/i.test(path));
check(forbiddenChanges.length === 0, "SQL, RLS, migration, rollback SQL, and policy snapshot files are unchanged");

const allowedChanges = new Set([
  "app.js",
  "index.html",
  "doorflow-operational-theme.css",
  "sw.js",
  "scripts/p3-shell-smoke.mjs",
  "scripts/p4-admin-smoke.mjs",
  "scripts/p5-door-smoke.mjs",
  "scripts/p6-checkin-race-smoke.mjs",
  "scripts/p6-release-smoke.mjs",
  "docs/OPERATIONAL_UI_DESIGN_SYSTEM.md",
  "docs/P6_RELEASE_HARDENING.md",
  "docs/DOORFLOW_RELEASE_RUNBOOK.md",
  "docs/DOORFLOW_ROLLBACK_RUNBOOK.md",
  "docs/P6_MANUAL_ACCEPTANCE_CHECKLIST.md",
  "docs/P6_REALTIME_CONFIGURATION.md",
  "ui-redesign/README.md"
]);
check(changedPaths.every(path => allowedChanges.has(path)), "working changes stay inside the approved P6 file set");

const releaseDocs = {
  "docs/P6_RELEASE_HARDENING.md":["P6.6 Realtime publication configuration", "PWA strategy", "Role matrix", "Remaining risks", "Release acceptance criteria"],
  "docs/DOORFLOW_RELEASE_RUNBOOK.md":["Pre-release checks", "Quiet window", "PWA cache verification", "Stop conditions"],
  "docs/DOORFLOW_ROLLBACK_RUNBOOK.md":["Rollback triggers", "Realtime publication-only rollback", "No application-data, schema, or RLS rollback", "Incident notes template"],
  "docs/P6_MANUAL_ACCEPTANCE_CHECKLIST.md":["P6.6 owner-supplied evidence", "Failed writes", "Rapid actions", "Realtime", "Low light", "Rollback readiness"],
  "docs/P6_REALTIME_CONFIGURATION.md":["Original symptom", "Complete required publication inventory", "Read-only publication verification", "Publication event flags", "Realtime publication-only rollback", "Static-validation limitation"]
};
for (const [path, headings] of Object.entries(releaseDocs)) {
  const source = read(path);
  check(headings.every(heading => source.includes(heading)), `${path} contains required release sections`);
}

runSmoke("scripts/p3-shell-smoke.mjs", "P3 shell smoke passes under P6");
runSmoke("scripts/p4-admin-smoke.mjs", "P4 administrative smoke passes under P6");
runSmoke("scripts/p5-door-smoke.mjs", "P5 Door smoke passes under P6");
runSmoke("scripts/p6-checkin-race-smoke.mjs", "P6.1 deterministic check-in race smoke passes");

for (const path of ["index.html", "app.js", "doorflow-operational-theme.css", "sw.js", "manifest.webmanifest"]) {
  console.log(`[INFO] ${path}: ${statSync(resolve(root, path)).size} bytes`);
}

if (failures) {
  console.error(`\nP6 release smoke failed with ${failures} issue${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`\nP6 release smoke passed: ${unchangedProtectedNames.length} unrelated protected functions match baseline, ${p61AuthorizedFunctions.size} P6.1 functions and ${p65AuthorizedFunctions.size} P6.5 presentation functions pass authorized checks, and ${presentationFunctions.size} presentation functions retain runtime/mirror parity.`);
console.log("Static checks do not prove authenticated roles, live mutations, realtime behavior, PWA lifecycle behavior, responsive layout, low-light hardware usability, or offline recovery.");
console.log("Static checks verify source/document agreement only; they do not query or prove live supabase_realtime publication membership, publication event flags, or delivered Postgres Changes events.");
console.log("Static checks do not prove real iPhone Safari/Chrome rendering, native date-control intrinsic geometry, or scrollbar-edge clearance.");
