import { createHash } from "node:crypto";
import { hasInvitationContextHooks, withoutInvitationContextHooks } from "./p8-2a-context-comparison.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const baselineCommit = "7144c3d6a19e81ac2b5df191958171242b4ea5e9";
const root = resolve(import.meta.dirname, "..");
const p82Marker = "/* Phase P8.2A: in-app Staff invitations and provisioning status. */";

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
  const start = new RegExp(`^(?:async\\s+)?function\\s+${escaped}\\s*\\(`, "m").exec(source);
  if (!start) return "";
  const rest = source.slice(start.index);
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

function extractSqlFunction(source, name) {
  const start = source.indexOf(`create function public.${name}(`);
  if (start < 0) return "";
  const rest = source.slice(start);
  const end = rest.indexOf("\n$$;");
  return end >= 0 ? rest.slice(0, end + "\n$$;".length) : "";
}

function buildInvitationValidator(source) {
  const auditRepairCodes = /const STAFF_INVITATION_AUDIT_REPAIR_CODES = new Set\(\[[\s\S]*?\]\);/.exec(source)?.[0] || "";
  const dependencies = [
    "normalizeText",
    "normalizeNullableText",
    "normalizeNumber",
    "normalizeBoolean",
    "normalizeStaffInvitation",
    "validStaffInvitationTimestamp",
    "coherentStaffInvitationReceipt",
    "validatedStaffInvitation"
  ];
  const functions = dependencies.map(name => extractFunction(source, name));
  if (!auditRepairCodes || functions.some(item => !item)) throw new Error("invitation validator dependency missing");
  return new Function(`${auditRepairCodes}\n${functions.join("\n\n")}\nreturn validatedStaffInvitation;`)();
}

function lines(value) {
  return String(value || "").trim().split("\n").map(item => item.trim()).filter(Boolean);
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

let failures = 0;
function check(condition, label) {
  if (condition) {
    console.log(`[PASS] ${label}`);
  } else {
    failures += 1;
    console.error(`[FAIL] ${label}`);
  }
}

const app = read("app.js");
check(hasInvitationContextHooks(app, extractFunction), "all narrowly authorized invitation ownership/reset hooks remain present at their exact boundaries");
const index = read("index.html");
const runtime = extractRuntime(index);
const css = read("doorflow-operational-theme.css");
const sw = read("sw.js");
const manifest = read("manifest.webmanifest");
const headers = read("_headers");
const vercel = read("vercel.json");
const acceptanceHtml = read("auth/index.html");
const acceptanceJs = read("auth/accept-invite.js");
const acceptanceBrowserTest = read("auth/accept-invite.browser.test.mjs");
const acceptanceCore = read("auth/invite-acceptance-core.mjs");
const edgeCore = read("supabase/functions/staff-invitations/core.ts");
const edgeEntry = read("supabase/functions/staff-invitations/index.ts");
const functionConfig = read("supabase/config.toml");
const reviewSql = read("supabase/review/phase_8_2a_staff_invitations_review.sql");
const deploymentGuide = read("docs/PHASE_8_2A_STAFF_INVITATIONS_DEPLOYMENT.md");
const baselineApp = fromBaseline("app.js");
const baselineSw = fromBaseline("sw.js");
const baselineManifest = fromBaseline("manifest.webmanifest");

check(git(["branch", "--show-current"]).trim() === "main", "production main branch is checked out");
let baselineIsAncestor = true;
try {
  execFileSync("git", ["merge-base", "--is-ancestor", baselineCommit, "HEAD"], { cwd:root, stdio:"ignore" });
} catch {
  baselineIsAncestor = false;
}
check(baselineIsAncestor, `HEAD descends from immutable approved baseline ${baselineCommit}`);

check(Boolean(runtime) && runtime === app.trim(), "operational inline runtime and app.js mirror are synchronized");
try {
  new Function(runtime);
  check(true, "operational inline runtime JavaScript parses");
} catch (error) {
  check(false, `operational inline runtime JavaScript parses: ${error.message}`);
}
check(count(index, /\/doorflow-operational-theme\.css\?v=p8\.2(?=["'])/g) === 1, "one fresh p8.2 stylesheet URL is active");
check(count(css, new RegExp(p82Marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) === 1, "one scoped Phase 8.2A CSS appendix exists");
check(
  hash(withoutCredentialNavigationHardening(sw)) === hash(baselineSw),
  "service worker differs from the approved baseline only by credential-navigation bypass and purge"
);
check(hash(manifest) === hash(baselineManifest), "manifest remains byte-identical to the approved baseline");
try {
  JSON.parse(manifest);
  JSON.parse(vercel);
  check(true, "manifest and Vercel configuration JSON parse");
} catch (error) {
  check(false, `manifest and Vercel configuration JSON parse: ${error.message}`);
}
check(
  sw.includes('const CACHE_NAME = "doorflow-cache-v30";')
    && sw.includes('url.pathname.includes("/auth/")')
    && sw.includes("purgeCredentialBearingCacheEntries(CACHE_NAME)")
    && sw.includes("if (isNavigation && hasAuthCredentialParameters(url)) return;")
    && sw.includes("event.respondWith(networkFirstNavigation(request, url.pathname))")
    && !sw.includes('"/auth/index.html"'),
  "cache-v30, ordinary network-first shell navigation, and /auth/ exclusion remain while credential URLs bypass and purge"
);

const firstExternalScript = index.indexOf('<script src="https://');
const rootCredentialScrub = index.indexOf("const AUTH_CREDENTIAL_KEYS = new Set([");
check(
  rootCredentialScrub >= 0
    && firstExternalScript > rootCredentialScrub
    && index.indexOf("window.history.replaceState", rootCredentialScrub) < firstExternalScript
    && index.indexOf("window.location.replace", rootCredentialScrub) < firstExternalScript
    && index.includes('"error_description"')
    && index.includes('"type"')
    && sw.includes('"error_description"')
    && sw.includes('"type"')
    && index.includes('auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:false }')
    && app.includes('auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:false }'),
  "root credentials are synchronously scrubbed before external scripts and normal persistent auth ignores URL sessions"
);

const staffRenderer = extractFunction(app, "renderStaffManagement");
const inviteModal = extractFunction(app, "renderStaffInviteModal");
const inviteSubmit = extractFunction(app, "submitStaffInvitation");
const inviteAction = extractFunction(app, "runStaffInvitationAction");
const invitationCall = extractFunction(app, "callStaffInvitationEndpoint");
const invitationValidator = extractFunction(app, "validatedStaffInvitation");
const invitationLoad = extractFunction(app, "loadStaffInvitationsForAdmin");
const refreshStaff = extractFunction(app, "refreshStaffProfiles");
const switchView = extractFunction(app, "switchView");

check(count(staffRenderer, /id="addStaffButton"/g) === 1 && staffRenderer.includes("openStaffInviteModal()"), "Staff has one clear Add Staff action");
check(
  inviteModal.includes('name="full_name"')
    && inviteModal.includes('name="email" type="email"')
    && inviteModal.includes('name="role"')
    && inviteModal.includes('id="staffInviteVenue"')
    && inviteModal.includes("readonly")
    && inviteModal.includes("Send Invitation")
    && inviteModal.includes("Cancel")
    && !/type=["']password/i.test(inviteModal),
  "invite form has the required identity, role, read-only venue, actions, and no password field"
);
check(
  extractFunction(app, "emptyStaffInviteDraft").includes('role:"door"')
    && inviteModal.includes("Admin grants full staff-management access"),
  "Door Staff is the default and Admin selection has an explicit privilege warning"
);
check(
  count(staffRenderer, /form="staff-\$\{profile\.id\}"/g) === 3
    && staffRenderer.includes('onsubmit="updateStaffProfile(event)"')
    && staffRenderer.includes('class="btn small df-staff-save-button" type="submit">Save</button>')
    && staffRenderer.indexOf("Invitation Status") < staffRenderer.indexOf("How to Add Staff")
    && staffRenderer.indexOf("How to Add Staff") < staffRenderer.indexOf("Role Guide"),
  "existing Staff form associations, Save action, status separation, and guidance order remain"
);
check(
  inviteSubmit.includes("state.staffInviteSubmitting")
    && inviteSubmit.includes("state.staffInviteDraft = { full_name:fullName, email, role, idempotency_key:idempotencyKey }")
    && !inviteSubmit.match(/catch[\s\S]*state\.staffInviteDraft\s*=\s*emptyStaffInviteDraft/),
  "duplicate submission is blocked and recoverable failures preserve the invite draft"
);
check(
  invitationCall.includes("ensureFreshAuthSession")
    && invitationCall.includes("Bearer ${session.access_token}")
    && invitationCall.includes("apikey:SUPABASE_PUBLIC_KEY")
    && !/\.auth\.admin\b/.test(`${app}\n${index}`),
  "browser calls the protected endpoint with a real user token and contains no Auth Admin API"
);
check(
  invitationCall.includes("invalid_invitation_response")
    && invitationValidator.includes("full_name")
    && invitationValidator.includes("attempt_count")
    && invitationValidator.includes("can_retry")
    && invitationValidator.includes("optionalStrings.every")
    && invitationValidator.includes("coherentStaffInvitationReceipt")
    && invitationValidator.includes("Number.isInteger(row.attempt_count)")
    && invitationValidator.includes("Number.isInteger(row.retry_after_seconds)")
    && invitationValidator.includes("[0-9a-f]{8}"),
  "browser rejects incomplete or malformed success receipts instead of inventing invitation state"
);
try {
  const validateInvitation = buildInvitationValidator(app);
  const sentReceipt = {
    id:"90000000-0000-4000-8000-000000000001",
    full_name:"Staff Member",
    email:"staff@example.com",
    role:"door",
    status:"sent",
    send_state:"provider_accepted",
    profile_state:"created",
    attempt_count:1,
    created_at:"2026-09-17T12:00:00.000Z",
    last_attempt_at:"2026-09-17T12:01:00.000Z",
    last_sent_at:"2026-09-17T12:02:00.000Z",
    accepted_at:null,
    failure_code:null,
    failure_message:null,
    can_retry:false,
    can_resend:true,
    retry_after_seconds:0
  };
  const acceptedReceipt = {
    ...sentReceipt,
    status:"accepted",
    profile_state:"existing",
    accepted_at:"2026-09-17T12:03:00.000Z",
    failure_code:"accepted_audit_pending",
    failure_message:"Acceptance is verified, but its audit evidence still needs repair.",
    can_resend:false
  };
  const acceptedProfilePartial = {
    ...sentReceipt,
    status:"profile_pending",
    profile_state:"failed",
    accepted_at:"2026-09-17T12:03:00.000Z",
    failure_code:"accepted_profile_missing",
    failure_message:"The invitation was accepted, but the staff profile still needs setup.",
    can_retry:true,
    can_resend:false
  };
  const failedProviderReceipt = {
    ...sentReceipt,
    status:"failed",
    send_state:"failed",
    profile_state:"pending",
    last_sent_at:null,
    failure_code:"provider_rejected",
    failure_message:"The invitation provider rejected the request.",
    can_retry:true,
    can_resend:false
  };
  const reservedReceipt = {
    ...failedProviderReceipt,
    status:"reserved",
    send_state:"not_attempted",
    attempt_count:0,
    last_attempt_at:null,
    failure_code:null,
    failure_message:null
  };
  const processingReceipt = {
    ...reservedReceipt,
    status:"processing",
    attempt_count:1,
    last_attempt_at:"2026-09-17T12:01:00.000Z",
    can_retry:false,
    retry_after_seconds:300
  };
  const profilePendingReceipt = {
    ...sentReceipt,
    status:"profile_pending",
    profile_state:"failed",
    failure_code:"profile_write_failed",
    failure_message:"The staff profile still needs setup.",
    can_retry:true,
    can_resend:false
  };
  const profileAuditPendingReceipt = {
    ...sentReceipt,
    status:"profile_pending",
    profile_state:"created",
    failure_code:"profile_audit_pending",
    failure_message:"The staff profile is preserved, but required invitation audit evidence needs repair.",
    can_retry:false,
    can_resend:false,
    retry_after_seconds:0
  };
  const providerAuditPendingReceipt = {
    ...sentReceipt,
    status:"profile_pending",
    profile_state:"pending",
    failure_code:"provider_audit_pending",
    failure_message:"Provider acceptance is preserved, but required audit evidence needs repair.",
    can_retry:false,
    can_resend:false,
    retry_after_seconds:0
  };
  const provisioningAuditPendingReceipt = {
    ...sentReceipt,
    failure_code:"provisioning_audit_pending",
    failure_message:"Provisioning is preserved, but completion audit evidence needs repair.",
    can_retry:false,
    can_resend:false,
    retry_after_seconds:0
  };
  const failedAcceptedProfileReceipt = {
    ...sentReceipt,
    status:"failed",
    profile_state:"failed",
    accepted_at:"2026-09-17T12:03:00.000Z",
    failure_code:"accepted_profile_role_conflict",
    failure_message:"The accepted account has a conflicting profile.",
    can_resend:false
  };
  const failedResendReceipt = {
    ...sentReceipt,
    status:"failed",
    send_state:"failed",
    last_attempt_at:"2026-09-17T12:05:00.000Z",
    failure_code:"provider_rejected",
    failure_message:"The resend was rejected.",
    can_retry:false,
    can_resend:false,
    retry_after_seconds:300
  };
  const reconciliationReceipt = {
    ...failedProviderReceipt,
    status:"reconciliation_required",
    send_state:"unknown",
    failure_code:"provider_outcome_unknown",
    can_retry:false
  };
  const legitimateReceipts = [
    reservedReceipt,
    processingReceipt,
    sentReceipt,
    acceptedReceipt,
    profilePendingReceipt,
    profileAuditPendingReceipt,
    providerAuditPendingReceipt,
    provisioningAuditPendingReceipt,
    acceptedProfilePartial,
    failedAcceptedProfileReceipt,
    failedResendReceipt,
    failedProviderReceipt,
    reconciliationReceipt
  ];
  const contradictoryReceipts = [
    { ...sentReceipt, send_state:"failed" },
    { ...sentReceipt, profile_state:"failed" },
    { ...sentReceipt, last_sent_at:null },
    { ...sentReceipt, accepted_at:"2026-09-17T12:03:00.000Z" },
    { ...acceptedReceipt, accepted_at:null },
    { ...acceptedReceipt, send_state:"failed" },
    { ...acceptedReceipt, profile_state:"failed" },
    { ...acceptedReceipt, can_retry:true },
    { ...acceptedReceipt, can_resend:true },
    { ...acceptedReceipt, retry_after_seconds:1 },
    { ...sentReceipt, last_sent_at:"2026-09-17T11:59:00.000Z" },
    { ...sentReceipt, attempt_count:1.5 },
    { ...sentReceipt, retry_after_seconds:-1 },
    { ...sentReceipt, created_at:"not-a-date" },
    { ...sentReceipt, email:42 },
    { ...profileAuditPendingReceipt, failure_code:"profile_write_failed" },
    { ...profileAuditPendingReceipt, can_retry:true },
    { ...profileAuditPendingReceipt, can_resend:true },
    { ...profileAuditPendingReceipt, retry_after_seconds:1 },
    { ...providerAuditPendingReceipt, can_resend:true },
    { ...provisioningAuditPendingReceipt, retry_after_seconds:1 }
  ];
  check(
    legitimateReceipts.every(receipt => Boolean(validateInvitation(receipt)))
      && contradictoryReceipts.every(receipt => validateInvitation(receipt) === null),
    "invitation receipt validator accepts supported partial states and rejects contradictory terminal states"
  );
} catch (error) {
  check(false, `invitation receipt validator behavior executes: ${error.message}`);
}
check(
  extractFunction(app, "staffInvitationLastActivity")
    .includes("invitation.accepted_at || invitation.last_sent_at || invitation.last_attempt_at || invitation.created_at"),
  "invitation Last Activity prefers acceptance, send, attempt, then creation time"
);
check(
  !staffRenderer.includes("callStaffInvitationEndpoint")
    && !staffRenderer.includes("loadStaffInvitationsForAdmin()")
    && switchView.includes('if (view === "users")')
    && switchView.includes("loadStaffInvitationsForAdmin()")
    && refreshStaff.includes("loadStaffInvitationsForAdmin()")
    && invitationLoad.includes('callStaffInvitationEndpoint("GET", null, owner)'),
  "invitation status loads only on Staff entry, refresh, and explicit workflow actions—not render or keystroke"
);
check(
  app.includes("Invitation setup required")
    && app.includes("No invitation result was confirmed")
    && app.includes("Email delivery is not confirmed")
    && invitationCall.includes('error.code === "invitation_service_not_deployed"')
    && !invitationCall.includes("response.status === 404 ||")
    && inviteSubmit.includes("Promise.allSettled")
    && inviteAction.includes("Promise.allSettled")
    && app.includes("staffInvitationOutcomeNotice"),
  "UI reports disabled/unavailable, ambiguous, and provider-accepted states honestly"
);
check(
  app.includes('"provider_audit_pending"')
    && app.includes('"profile_audit_pending"')
    && app.includes('"provisioning_audit_pending"')
    && app.includes('"accepted_audit_pending"')
    && extractFunction(app, "staffInvitationOutcomeNotice").includes("STAFF_INVITATION_AUDIT_REPAIR_CODES")
    && extractFunction(app, "staffInvitationStatusLabel").includes('return "Audit repair needed"')
    && extractFunction(app, "staffInvitationStatusClass").includes('return "warn"'),
  "UI presents every recoverable audit-pending state as repair-needed rather than successful or actionable"
);
check(
  css.slice(css.indexOf(p82Marker)).includes("min-height: 44px")
    && inviteModal.includes('role="dialog" aria-modal="true"')
    && extractFunction(app, "syncModalFocus").includes("!dialog.contains(document.activeElement)")
    && extractFunction(app, "handleModalKeydown").includes('event.key !== "Tab"')
    && app.includes('document.addEventListener("keydown", handleModalKeydown)'),
  "Phase 8.2A keeps comfortable phone controls and the existing modal focus trap"
);

const protectedFunctions = [
  "requirePerm", "login", "bootDatabase", "loadDataForDate", "setActiveDay", "setActiveDate",
  "createGroup", "updateGroup", "deleteGroup", "createGuest", "updateGuest", "deleteGuest",
  "updateStaffProfile", "loadStaffProfilesForAdmin", "checkInOneGuest", "undoOneGuest", "toggleGuest",
  "requestRealtimeRefresh", "subscribeRealtime", "renderTopbar", "renderReports", "exportCsv"
];
const changedProtected = protectedFunctions.filter(name => (
  !extractFunction(app, name) || hash(withoutInvitationContextHooks(extractFunction(app, name))) !== hash(extractFunction(baselineApp, name))
));
check(changedProtected.length === 0, "protected auth, CRUD, Staff edit, check-in, realtime, report, and export functions match baseline");
if (changedProtected.length) console.error(`       Changed protected functions: ${changedProtected.join(", ")}`);

check(
  acceptanceHtml.indexOf('<script src="./accept-invite.js"></script>') < acceptanceHtml.indexOf('<link rel="stylesheet"')
    && acceptanceHtml.includes('name="referrer" content="no-referrer"')
    && acceptanceHtml.includes("no-store, max-age=0")
    && acceptanceHtml.includes("Content-Security-Policy")
    && !/analytics|googletagmanager|segment|mixpanel|posthog|sentry/i.test(`${acceptanceHtml}\n${acceptanceJs}`),
  "standalone acceptance page scrubs before subresources and declares no-referrer/no-store/CSP without analytics"
);
check(
  acceptanceJs.includes("history.replaceState")
    && acceptanceJs.includes("@supabase/supabase-js@2.116.0")
    && acceptanceCore.includes("persistSession: false")
    && acceptanceCore.includes("detectSessionInUrl: false")
    && acceptanceCore.includes("createMemoryStorage")
    && acceptanceCore.includes("verifyInvitationSession")
    && acceptanceCore.includes("auth.getUser()")
    && acceptanceCore.includes("user.invited_at")
    && acceptanceCore.includes("auth.updateUser({ password })")
    && acceptanceJs.includes("verifyRetainedInvitationSession")
    && acceptanceJs.includes("MAX_VERIFICATION_ATTEMPTS")
    && acceptanceHtml.includes('id="retry-verification-button"'),
  "acceptance uses an isolated retained session, bounded explicit verification retry, and provider-enforced password update"
);
check(
  acceptanceCore.includes("createBoundedAuthFetch")
    && acceptanceCore.includes("expectedIdentity")
    && acceptanceCore.includes("safeProviderPasswordMessage")
    && acceptanceJs.includes("disposeInvitationSession")
    && acceptanceJs.includes('window.addEventListener("pagehide"')
    && acceptanceBrowserTest.includes('Fetch.enable')
    && acceptanceBrowserTest.indexOf('Fetch.enable') < acceptanceBrowserTest.indexOf('Page.navigate')
    && acceptanceBrowserTest.includes('Network.setBlockedURLs')
    && acceptanceBrowserTest.includes('updateUserCalls, 0')
    && acceptanceBrowserTest.includes('existing-admin-session-sentinel')
    && acceptanceBrowserTest.includes('doorflow-cache-v30')
    && acceptanceBrowserTest.includes('misrouted provider error details')
    && acceptanceBrowserTest.includes('credential and provider-error URLs must never enter CacheStorage'),
  "acceptance bounds Auth calls, rechecks identity, isolates root credentials/errors from CacheStorage, and has pre-navigation browser interception"
);
check(
  acceptanceHtml.includes('id="success-panel" class="success-panel" role="status" aria-live="polite"')
    && acceptanceJs.indexOf("successPanel.focus()") < acceptanceJs.indexOf("void disposeInvitationSession()")
    && acceptanceJs.includes("SESSION_DISPOSAL_TIMEOUT_MS"),
  "password success is focused and announced before bounded best-effort local sign-out"
);
check(
  headers.includes("/auth/*")
    && headers.includes("Referrer-Policy: no-referrer")
    && headers.includes("Cache-Control: no-store, max-age=0, must-revalidate")
    && headers.includes("Content-Security-Policy: frame-ancestors 'none'")
    && headers.includes("X-Frame-Options: DENY")
    && vercel.includes('"source": "/auth/(.*)"')
    && vercel.includes('"value": "no-referrer"')
    && count(vercel, /"key": "X-Frame-Options", "value": "DENY"/g) >= 4
    && count(vercel, /"key": "Content-Security-Policy", "value": "frame-ancestors 'none'"/g) >= 4,
  "both hosting configurations protect main and /auth/ documents with anti-framing plus existing privacy headers"
);

check(
  edgeEntry.includes('npm:@supabase/supabase-js@2.116.0')
    && edgeEntry.includes('const decision = parseRpcReply(name, data, expected);')
    && edgeEntry.includes('if (!decision) throw invalidReply();')
    && edgeCore.includes('export function validateDecisionRpcResult<T>(rpcName: DecisionRpcName, result: T)')
    && count(edgeEntry, /createClient<InvitationAdapterDatabase>\(/g) === 2
    && edgeEntry.includes("verifier.auth.getUser(token)")
    && edgeEntry.includes("admin.auth.admin.inviteUserByEmail")
    && edgeEntry.includes("persistSession:false")
    && edgeEntry.includes("detectSessionInUrl:false")
    && edgeCore.includes('profile.role !== "admin"')
    && edgeCore.includes("!profile.active")
    && edgeCore.includes("profile.venue_id"),
  "Edge source pins the SDK, separates verifier/admin clients, verifies the bearer, and requires active Admin venue scope"
);
check(
  edgeCore.includes('new Set(["action", "full_name", "email", "role", "idempotency_key"])')
    && edgeCore.includes('new Set(["action", "invitation_id"])')
    && edgeCore.includes("rejectUnexpectedFields")
    && edgeCore.includes("full_name:row.full_name")
    && edgeCore.includes("[PROVIDER_CREATION_MARKER_KEY]:creationMarker")
    && edgeCore.includes("providerCreationMarker(user) !== creationMarker")
    && !edgeCore.includes("data:{ role")
    && !edgeCore.includes("data:{ venue"),
  "endpoint rejects spoofed fields and never stores role/venue authority in editable Auth metadata"
);
check(
  edgeCore.includes("claimInvitation")
    && edgeCore.includes("authorizeProviderDispatch")
    && edgeCore.includes("recordProviderOutcome")
    && edgeCore.includes("operation_lost")
    && edgeCore.includes("dispatch_authorized")
    && edgeCore.includes("provider_outcome_unknown")
    && edgeCore.includes("reconciliation_required")
    && edgeCore.includes("resend_cooldown")
    && edgeCore.includes("provider_accepted")
    && edgeCore.includes("expectedAuthUserId")
    && edgeCore.includes("user.id !== expectedAuthUserId")
    && edgeEntry.includes("doorflow_authorize_staff_invitation_dispatch")
    && edgeEntry.includes("doorflow_record_staff_invitation_provider_outcome"),
  "fenced claims, durable dispatch authorization, conservative ambiguity, cooldown, and identity-before-persistence are explicit"
);
check(
  edgeCore.includes('new Set(["attempt_count"])')
    && edgeCore.includes("MAX_AUDIT_DETAILS_BYTES")
    && edgeCore.includes("invalid_audit_metadata")
    && edgeCore.includes("Array.isArray(value)")
    && edgeEntry.includes("logSafeError:({ request_id, code, status })")
    && !edgeEntry.includes("console.error(error")
    && functionConfig.includes("verify_jwt = true")
    && edgeEntry.includes("DOORFLOW_STAFF_PROVISIONING_ENABLED")
    && edgeEntry.includes('booleanEnv("DOORFLOW_STAFF_PROVISIONING_ENABLED", false)')
    && edgeEntry.includes("createBoundedFetch")
    && edgeEntry.includes("resolveSupabaseServerKeys")
    && edgeEntry.includes('Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")')
    && edgeEntry.includes('Deno.env.get("SUPABASE_SECRET_KEYS")')
    && edgeEntry.includes('Deno.env.get("DOORFLOW_SUPABASE_KEY_NAME")')
    && edgeEntry.includes('Deno.env.get("DOORFLOW_SUPABASE_KEY_PROJECT_REF")')
    && edgeCore.includes("parseStrictStringDictionary")
    && edgeCore.includes("entries.has(key)")
    && edgeCore.includes("Incomplete platform key dictionaries")
    && edgeCore.includes("Configured platform key name was not found in both dictionaries")
    && edgeCore.includes("Incomplete or mismatched direct Supabase key configuration"),
  "typed audit metadata, safe logging, bounded provider I/O, explicit keys, JWT verification, and disabled-by-default provisioning are enforced"
);
check(
  edgeCore.includes("request.body.getReader()")
    && edgeCore.includes("MAX_REQUEST_BYTES")
    && edgeCore.includes('content-type')
    && edgeEntry.includes("lookupAuthUserByEmail")
    && edgeEntry.includes("doorflow_lookup_staff_invitation_auth_user")
    && !edgeEntry.includes("listUsers("),
  "actual streamed bytes are bounded and unknown Auth identity uses the reviewed exact lookup without directory enumeration"
);

check(
  reviewSql.startsWith("-- DoorFlow Phase 8.2A.1 staff invitations\n-- REVIEW ONLY / UNAPPLIED.")
    && count(reviewSql, /create table public\.staff_invitations/g) === 1
    && count(reviewSql, /create table public\.staff_invitation_attempts/g) === 1
    && count(reviewSql, /create table public\.staff_invitation_audit/g) === 1
    && reviewSql.includes("enable row level security")
    && reviewSql.includes("force row level security")
    && reviewSql.includes("from public, anon, authenticated, service_role")
    && reviewSql.includes("security invoker")
    && reviewSql.includes("security definer")
    && reviewSql.includes("set search_path = ''")
    && reviewSql.includes("staff_invitations_normalized_email_unique")
    && reviewSql.includes("staff_invitations_actor_idempotency_unique")
    && reviewSql.includes("staff_invitation_attempts_invitation_fence_unique")
    && reviewSql.includes("staff_invitation_audit_canonical_event_unique")
    && reviewSql.includes("doorflow_lookup_staff_invitation_auth_user"),
  "review-only SQL adds fenced attempts, canonical audit identity, global email uniqueness, browser denial, forced RLS, and a locked exact Auth lookup"
);
const lockedVenueBoundaryFunctions = [
  "doorflow_authorize_staff_invitation_dispatch",
  "doorflow_recover_staff_invitation_dispatch",
  "doorflow_finalize_staff_invitation_profile",
  "doorflow_reconcile_staff_invitation"
];
check(
  lockedVenueBoundaryFunctions.every(name => {
    const body = extractSqlFunction(reviewSql, name);
    const invitationRead = body.indexOf("select invitation.* into v_row");
    const locked = body.indexOf("for update;", invitationRead);
    const notFound = body.indexOf("if not found", locked);
    const venueGuard = body.indexOf("if v_actor.venue_id <> v_row.venue_id", notFound);
    const identityDrift = body.indexOf("if v_row.auth_user_id is distinct from v_peek_auth_user_id", notFound);
    const rowBearingDecision = body.indexOf("pg_catalog.to_jsonb(v_row)", notFound);
    return body.length > 0
      && invitationRead >= 0
      && locked > invitationRead
      && notFound > locked
      && venueGuard > notFound
      && identityDrift > venueGuard
      && rowBearingDecision > venueGuard;
  }),
  "locked invitation RPCs reject a cross-venue actor before identity-drift or row-bearing decisions"
);
check(
  deploymentGuide.includes("## State and external-operation boundaries")
    && deploymentGuide.includes("## Required audit classification")
    && deploymentGuide.includes("## Disabling and already-running work")
    && deploymentGuide.includes("## Installation order")
    && deploymentGuide.includes("## Recovery matrix")
    && deploymentGuide.includes("## Non-destructive rollback")
    && deploymentGuide.includes("durable dispatch boundary")
    && deploymentGuide.includes("does not claim exactly-once email delivery")
    && deploymentGuide.includes("custom SMTP")
    && deploymentGuide.includes("SPF")
    && deploymentGuide.includes("DKIM")
    && deploymentGuide.includes("DOORFLOW_INVITE_REDIRECT_URL")
    && deploymentGuide.includes("DOORFLOW_ALLOWED_ORIGINS")
    && deploymentGuide.includes("mutation-capable")
    && deploymentGuide.includes("Do not delete/change Auth users"),
  "deployment guide covers dispatch limits, already-running work, mutation-capable GET, SMTP/domain, recovery, verification, and non-destructive rollback"
);

const baselineFiles = lines(git(["ls-tree", "-r", "--name-only", baselineCommit])).sort();
const tracked = lines(git(["ls-files"]));
const untracked = lines(git(["ls-files", "--others", "--exclude-standard"]));
const workingFiles = [...new Set([...tracked, ...untracked])].filter(path => !path.startsWith(".codex/")).sort();
const expectedNewFiles = [
  "auth/accept-invite.css",
  "auth/accept-invite.js",
  "auth/accept-invite.browser.test.mjs",
  "auth/index.html",
  "auth/invite-acceptance-core.mjs",
  "auth/invite-acceptance-core.test.mjs",
  "docs/PHASE_8_2A_STAFF_INVITATIONS_DEPLOYMENT.md",
  "scripts/p8-2a-edge-function.test.mjs",
  "scripts/p8-2a-adapter-validation.test.ts",
  "scripts/p8-2a-audit-contract.test.ts",
  "scripts/p8-2a-invitation-context.browser.test.mjs",
  "scripts/p8-2a-browser-resources.mjs",
  "scripts/p8-2a-context-comparison.mjs",
  "supabase/functions/staff-invitations/audit.ts",
  "supabase/functions/staff-invitations/rpc-validation.ts",
  "scripts/p8-2a-staff-invitations-smoke.mjs",
  "supabase/config.toml",
  "supabase/functions/staff-invitations/core.ts",
  "supabase/functions/staff-invitations/deno.json",
  "supabase/functions/staff-invitations/index.ts",
  "supabase/review/phase_8_2a_staff_invitations_review.sql"
].sort();
const actualNewFiles = workingFiles.filter(path => !baselineFiles.includes(path)).sort();
check(actualNewFiles.join("|") === expectedNewFiles.join("|"), "new Phase 8.2A file inventory is exact and review SQL stays outside migrations");

const authorizedBaselineChanges = new Set([
  "_headers", "app.js", "doorflow-operational-theme.css", "index.html", "sw.js", "vercel.json",
  "scripts/p8-1-mobile-management-smoke.mjs",
  "scripts/p8-1a-staff-mobile-smoke.mjs",
  "scripts/p8-1b-landscape-header-smoke.mjs"
]);
const unexpectedBaselineChanges = baselineFiles.filter(path => {
  if (authorizedBaselineChanges.has(path)) return false;
  if (!existsSync(resolve(root, path))) return true;
  return hash(read(path)) !== hash(fromBaseline(path));
});
check(unexpectedBaselineChanges.length === 0, "all baseline files outside the exact Phase 8.2A compatibility scope remain byte-identical");
if (unexpectedBaselineChanges.length) console.error(`       Unexpected baseline changes: ${unexpectedBaselineChanges.join(", ")}`);

const statusRecords = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
const statusPaths = statusRecords.map(record => record.slice(3).replaceAll("\\", "/"));
const allowedStatus = new Set([...authorizedBaselineChanges, ...expectedNewFiles]);
check(statusPaths.every(path => allowedStatus.has(path) || path.startsWith(".codex/")), "working-tree changes stay within the exact Phase 8.2A inventory");
const codexRecords = statusRecords.filter(record => record.slice(3).replaceAll("\\", "/").startsWith(".codex/"));
check(codexRecords.every(record => record.startsWith("?? ")) && !tracked.some(path => path.startsWith(".codex/")), ".codex remains wholly untracked and untouched");
check(git(["diff", "--cached", "--name-only"]).trim() === "", "nothing is staged");

if (failures) {
  console.error(`\nPhase 8.2A staff-invitation smoke failed with ${failures} issue${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("\nPhase 8.2A staff-invitation smoke passed.");
console.log("Static checks do not prove deployed SQL, Edge/Deno execution, SMTP delivery, redirect allowlisting, provider templates, or end-to-end cloud behavior. Complete the deployment guide in a non-production project before activation.");
