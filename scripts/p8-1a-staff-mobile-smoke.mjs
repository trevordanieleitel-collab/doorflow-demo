import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const baselineCommit = "062fbe9";
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

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

function extractFunction(source, name) {
  const escaped = name.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
  const startMatch = new RegExp(`^(?:async\\s+)?function\\s+${escaped}\\s*\\(`, "m").exec(source);
  if (!startMatch) return "";
  const rest = source.slice(startMatch.index);
  const close = /^}\s*$/m.exec(rest);
  return close ? rest.slice(0, close.index + close[0].length).trim() : "";
}

function extractRuntime(indexSource) {
  const runtimeStart = indexSource.indexOf("const SUPABASE_URL");
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
const indexSource = read("index.html");
const themeSource = read("doorflow-operational-theme.css");
const swSource = read("sw.js");
const manifestSource = read("manifest.webmanifest");
const p81SmokeSource = read("scripts/p8-1-mobile-management-smoke.mjs");
const baselineApp = fromBaseline("app.js");
const baselineIndex = fromBaseline("index.html");
const baselineTheme = fromBaseline("doorflow-operational-theme.css");
const baselineSw = fromBaseline("sw.js");
const baselineManifest = fromBaseline("manifest.webmanifest");
const runtimeSource = extractRuntime(indexSource);
const currentStaffRenderer = extractFunction(appSource, "renderStaffManagement");
const baselineStaffRenderer = extractFunction(baselineApp, "renderStaffManagement");
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

check(Boolean(runtimeSource), "active inline runtime is present");
check(runtimeSource === appSource.trim(), "entire inline runtime and app.js mirror are synchronized");
try {
  new Function(runtimeSource);
  check(true, "inline runtime JavaScript parses");
} catch (error) {
  check(false, `inline runtime JavaScript parses: ${error.message}`);
}

check(
  hash(normalizeStaffRenderer(currentStaffRenderer)) === hash(baselineStaffRenderer),
  "Staff renderer differs from 062fbe9 only by the authorized accessibility and CSS hooks"
);
check(
  appSource.includes(currentServiceControlsBootstrap)
    && hash(normalizeP81bRuntime(appSource).replace(currentStaffRenderer, baselineStaffRenderer)) === hash(baselineApp),
  "all app.js runtime outside the authorized Staff renderer and compact media bootstrap remains byte-identical to 062fbe9"
);
const normalizedIndex = indexSource
  .replace(runtimeSource, baselineApp.trim())
  .replace("/doorflow-operational-theme.css?v=p8.1b", "/doorflow-operational-theme.css?v=p8.1");
check(hash(normalizedIndex) === hash(baselineIndex), "index changes are limited to the mirrored authorized runtime and the p8.1b cache key");

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
  "refreshStaffProfiles",
  "requirePerm",
  "renderTopbar",
  "toggleServiceControls",
  "syncServiceControlsResponsiveLayout",
  "serviceControlsAccessibleLabel"
]) {
  check(
    hash(extractFunction(appSource, name)) === hash(extractFunction(baselineApp, name)),
    `${name} remains byte-identical to 062fbe9`
  );
}

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

check(count(indexSource, /\/doorflow-operational-theme\.css\?v=p8\.1b(?=["'])/g) === 1, "index uses exactly one p8.1b stylesheet URL");
check(!/\/doorflow-operational-theme\.css\?v=p8\.1a(?=["'])/.test(indexSource), "no exact p8.1a stylesheet URL remains active");
check(!/\/doorflow-operational-theme\.css\?v=p8\.1(?=["'])/.test(indexSource), "no exact p8.1 stylesheet URL remains active");
check(count(indexSource, /<link[^>]+doorflow-operational-theme\.css/gi) === 1, "one operational theme link remains");

check(hash(swSource) === hash(baselineSw), "service worker remains byte-identical to 062fbe9");
check(hash(manifestSource) === hash(baselineManifest), "manifest remains byte-identical to 062fbe9");
try {
  JSON.parse(manifestSource);
  check(true, "manifest JSON parses");
} catch (error) {
  check(false, `manifest JSON parses: ${error.message}`);
}
const versionedCssPath = new URL("http://127.0.0.1/doorflow-operational-theme.css?v=p8.1b").pathname;
check(
  swSource.includes('const CACHE_NAME = "doorflow-cache-v30";')
    && swSource.includes('"/doorflow-operational-theme.css"')
    && versionedCssPath === "/doorflow-operational-theme.css",
  "p8.1b stylesheet pathname remains in the unchanged cache-v30 shell allowlist"
);

const currentRuntimeSurface = `${appSource}\n${indexSource}\n${swSource}`;
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
  check(count(currentRuntimeSurface, pattern) === count(baselineRuntimeSurface, pattern), `no new ${label} sites`);
}
check(!/\b(?:google-analytics|googletagmanager|segment|mixpanel|posthog|sentry)\b/i.test(`${appSource}\n${indexSource}\n${themeSource}`), "no analytics integration is introduced");
const externalAssets = source => [...source.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["'](https?:\/\/[^"']+)/gi)].map(match => match[1]).sort();
check(externalAssets(indexSource).join("|") === externalAssets(baselineIndex).join("|"), "external dependency inventory is unchanged");

const baselineTracked = git(["ls-tree", "-r", "--name-only", baselineCommit]).trim().split("\n").filter(Boolean).sort();
const currentTracked = git(["ls-files"]).trim().split("\n").filter(Boolean).sort();
const databaseGuarded = path => path.toLowerCase().endsWith(".sql") || /policy_snapshot\.csv$/i.test(path);
const baselineDatabaseFiles = baselineTracked.filter(databaseGuarded);
const currentDatabaseFiles = currentTracked.filter(databaseGuarded);
check(
  baselineDatabaseFiles.join("|") === currentDatabaseFiles.join("|")
    && baselineDatabaseFiles.every(path => hash(read(path)) === hash(fromBaseline(path))),
  "SQL, RLS, policy, migration, and policy-snapshot files remain unchanged"
);
const dependencyFile = path => /(^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(path);
check(currentTracked.filter(dependencyFile).join("|") === baselineTracked.filter(dependencyFile).join("|"), "no dependency manifest or lockfile is added");

check(
  p81SmokeSource.includes('const productionBranch = "main";')
    && p81SmokeSource.includes("p8.1b stylesheet URL")
    && p81SmokeSource.includes('"renderStaffManagement"')
    && p81SmokeSource.includes('"scripts/p8-1a-staff-mobile-smoke.mjs"')
    && p81SmokeSource.includes('"scripts/p8-1b-landscape-header-smoke.mjs"'),
  "legacy Phase 8.1 smoke has only the required cumulative-validation compatibility hooks"
);

const allowedChanges = new Set([
  "app.js",
  "index.html",
  "doorflow-operational-theme.css",
  "scripts/p8-1-mobile-management-smoke.mjs",
  "scripts/p8-1a-staff-mobile-smoke.mjs",
  "scripts/p8-1b-landscape-header-smoke.mjs"
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
