const SUPABASE_URL = "https://wdlgkwzowapzhurbbavf.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_FiasS5c034YR4w_72bBUqQ_dzcCJ5ME";
const DOORFLOW_FETCH_TIMEOUT_MS = 18000;
const DOORFLOW_SESSION_REFRESH_WINDOW_MS = 120000;
const DOORFLOW_REALTIME_RECONNECT_MS = 120000;
const DOORFLOW_ACTION_SESSION_CHECK_MS = 15000;
const DOORFLOW_WAKE_ACTION_WINDOW_MS = 10000;

function doorFlowFetch(input, init = {}) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const timer = setTimeout(() => controller.abort(), DOORFLOW_FETCH_TIMEOUT_MS);

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once:true });
  }

  return fetch(input, {
    ...init,
    cache:init.cache || "no-store",
    signal:controller.signal
  }).finally(() => clearTimeout(timer));
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
  global:{ fetch:doorFlowFetch },
  auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
});

const roles = {
  admin:   { label:"Admin",      door:true,  manage:true,  users:true,  reports:true },
  manager: { label:"Management", door:true,  manage:true,  users:false, reports:true },
  door:    { label:"Door Staff", door:true,  manage:false, users:false, reports:false },
  viewer:  { label:"Viewer",     door:false, manage:false, users:false, reports:true }
};

const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const groupTypes = ["Bottle Service", "VIP Party", "Private Party", "Staff Party", "Vendor Group"];
const boothOptions = ["POD1", "POD2", "POD3", "POD4", "POD5", "POD6", "POD7", "POD8", "POD9", "DJ Pod", "Fulton St. Corner"];
const guestTypes = ["Guest", "VIP", "Comp", "Host", "Birthday", "Bottle Service", "Staff", "Vendor", "Do Not Admit"];
const sortOptions = [
  { value:"LAST_ASC", label:"Last Name A-Z" },
  { value:"LAST_DESC", label:"Last Name Z-A" },
  { value:"FIRST_ASC", label:"First Name A-Z" },
  { value:"FIRST_DESC", label:"First Name Z-A" },
  { value:"UNCHECKED", label:"Unchecked First" },
  { value:"CHECKED", label:"Checked First" }
];

const guestFilterOptions = [
  { value:"ALL", label:"All Guests" },
  { value:"NOT_CHECKED_IN", label:"Not Checked In" },
  { value:"CHECKED_IN", label:"Checked In" },
  { value:"PARTIAL", label:"Partially Checked In" },
  { value:"FULLY_IN", label:"Fully Checked In" },
  { value:"LATE_ADD", label:"Late Adds" },
  { value:"GENERAL_ONLY", label:"General Guest List Only" },
  { value:"GROUP_ONLY", label:"Party / Group Guests Only" },
  { value:"BOTTLE_SERVICE", label:"Bottle Service" },
  { value:"VIP", label:"VIP / VIP Parties" },
  { value:"DO_NOT_ADMIT", label:"Do Not Admit" }
];

let auth = {
  session:null,
  currentUser:null,
  profile:null
};

// Keep the selected service date through browser/PWA refreshes.
// Also avoid UTC rollover issues that can make the app jump to tomorrow at night.
const DOORFLOW_ACTIVE_DATE_KEY = "doorflow_active_date_v1";
const initialActiveDate = getInitialActiveDate();

let state = {
  loading:false,
  error:"",
  venue:null,
  serviceDay:null,
  groups:[],
  guests:[],
  logs:[],
  shiftNotes:[],
  staffProfiles:[],
  view:"door",
  activeDate:initialActiveDate,
  activeDay:dayNameFromDate(initialActiveDate),
  selectedGroupId:null,
  currentMode:"GENERAL",
  searchText:"",
  groupSearchText:"",
  sortMode:"LAST_ASC",
  guestFilter:"ALL",
  doorLocation:"Front Door",
  modal:null,
  editingGroupId:null,
  editingGuestId:null,
  editingShiftNoteId:null,
  importMessage:"",
  mobileManagerNotice:null,
  syncStatus:"Connecting",
  syncMessage:"Starting live sync",
  realtimeStatus:"Not connected",
  realtimeSubscribedAt:null,
  lastSyncAt:null,
  lastResumeAt:null,
  lastRealtimeAt:null,
  lastDataHash:"",
  pendingSync:false
};

let realtimeChannel = null;
let realtimeDebounceTimer = null;
let realtimeHealthTimer = null;
let autoRefreshTimer = null;
let resumeRecoveryTimer = null;
let lastAutoRefreshAt = null;
let lastHiddenAt = null;
let lastActionSessionCheckAt = null;
let isAutoRefreshing = false;
let isResumeRecovering = false;
let isBootingDatabase = false;
let lastUserInputAt = 0;
let activeDoorFlowAction = false;
let lastDoorFlowActionAt = 0;

function isValidISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function localISOFromDate(date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0,10);
}

function todayISO() {
  return localISOFromDate(new Date());
}

function getInitialActiveDate() {
  try {
    const storedDate = localStorage.getItem(DOORFLOW_ACTIVE_DATE_KEY);
    if (isValidISODate(storedDate)) return storedDate;
  } catch (error) {
    console.warn("Could not read saved DoorFlow date:", error);
  }

  return todayISO();
}

function saveActiveDate(dateString) {
  if (!isValidISODate(dateString)) return;

  try {
    localStorage.setItem(DOORFLOW_ACTIVE_DATE_KEY, dateString);
  } catch (error) {
    console.warn("Could not save DoorFlow date:", error);
  }
}

function dayNameFromDate(dateString) {
  const date = new Date(dateString + "T12:00:00");
  const jsDay = date.getDay();
  return days[jsDay === 0 ? 6 : jsDay - 1];
}

function nextDateForDay(dayName) {
  const targetIndex = days.indexOf(dayName);
  const today = new Date();
  const currentIndex = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const offset = (targetIndex - currentIndex + 7) % 7;
  const result = new Date(today);
  result.setDate(today.getDate() + offset);
  return localISOFromDate(result);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function currentUser() {
  return auth.currentUser;
}

function perms() {
  const user = currentUser();
  return user ? roles[user.role] : null;
}

function requirePerm(permission) {
  const p = perms();
  if (!p || !p[permission]) {
    alert("This account does not have access to that function.");
    return false;
  }
  return true;
}

function roleLabel(role) {
  return roles[role]?.label || role;
}

function defaultViewForRole(role) {
  return roles[role]?.door ? "door" : "reports";
}

function viewAllowedForRole(role, view) {
  const p = roles[role];
  if (!p) return false;
  if (view === "door" || view === "tabletDoor") return p.door;
  if (view === "manage") return p.manage;
  if (view === "users") return p.users;
  if (view === "reports") return p.reports;
  return false;
}

function captureFocusedInput() {
  const active = document.activeElement;
  if (!active || !active.id) return null;
  const isTextInput = active.tagName === "INPUT" || active.tagName === "TEXTAREA";
  if (!isTextInput) return null;
  return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
}

function restoreFocusedInput(focusInfo) {
  if (!focusInfo || !focusInfo.id) return;
  requestAnimationFrame(() => {
    const element = document.getElementById(focusInfo.id);
    if (!element) return;
    element.focus();
    try {
      if (focusInfo.start !== null && focusInfo.start !== undefined) {
        element.setSelectionRange(focusInfo.start, focusInfo.end);
      }
    } catch {}
  });
}

function captureScrollPositions() {
  const ids = ["guestScrollPanel", "groupScrollPanel", "reportScrollPanel"];
  const positions = {};
  ids.forEach(id => {
    const element = document.getElementById(id);
    if (element) positions[id] = element.scrollTop;
  });
  return positions;
}

function restoreScrollPositions(positions) {
  requestAnimationFrame(() => {
    Object.keys(positions || {}).forEach(id => {
      const element = document.getElementById(id);
      if (element) element.scrollTop = positions[id];
    });
  });
}

function captureFormFieldValues() {
  const fields = {};
  document.querySelectorAll("input[id], select[id], textarea[id]").forEach(element => {
    fields[element.id] = {
      tag:element.tagName,
      type:String(element.type || "").toLowerCase(),
      value:element.value,
      checked:Boolean(element.checked)
    };
  });
  return fields;
}

function restoreFormFieldValues(fields) {
  requestAnimationFrame(() => {
    Object.entries(fields || {}).forEach(([id, saved]) => {
      const element = document.getElementById(id);
      if (!element || !saved) return;

      if (saved.type === "checkbox" || saved.type === "radio") {
        element.checked = Boolean(saved.checked);
        return;
      }

      // If a select option no longer exists after a data update, keep the newly-rendered default.
      if (element.tagName === "SELECT") {
        const hasOption = Array.from(element.options || []).some(option => option.value === saved.value);
        if (!hasOption) return;
      }

      element.value = saved.value;
    });
  });
}

function captureDetailsState() {
  const details = {};
  document.querySelectorAll("details[id]").forEach(element => {
    details[element.id] = element.open;
  });
  return details;
}

function restoreDetailsState(details) {
  requestAnimationFrame(() => {
    Object.entries(details || {}).forEach(([id, wasOpen]) => {
      const element = document.getElementById(id);
      if (element) element.open = Boolean(wasOpen);
    });
  });
}

function captureTransientUiState() {
  return {
    focus:captureFocusedInput(),
    scroll:captureScrollPositions(),
    fields:captureFormFieldValues(),
    details:captureDetailsState()
  };
}

function restoreTransientUiState(ui) {
  restoreFormFieldValues(ui?.fields);
  restoreDetailsState(ui?.details);
  restoreFocusedInput(ui?.focus);
  restoreScrollPositions(ui?.scroll);
}

function render() {
  const ui = captureTransientUiState();
  const root = document.getElementById("app");

  if (!auth.currentUser) {
    root.innerHTML = renderLogin();
    restoreTransientUiState(ui);
    return;
  }

  root.innerHTML = renderApp();
  restoreTransientUiState(ui);
}

async function runDb(label, fn) {
  try {
    state.error = "";
    if (auth.session?.user && label !== "Loading live data") {
      await prepareDatabaseAction(label);
    }
    return await fn();
  } catch (error) {
    console.error(error);
    state.loading = false;
    state.error = label + " failed: " + (error.message || error);
    render();
    throw error;
  }
}

function must(data, error) {
  if (error) throw error;
  return data;
}

function firstRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function newestMatchingRow(rows, predicate) {
  if (!Array.isArray(rows)) return null;
  return rows.find(predicate) || null;
}


/* AUTO REFRESH / LIVE SYNC */

function markUserInputActivity() {
  lastUserInputAt = Date.now();
}

["input", "keydown", "change", "pointerdown", "click", "touchstart"].forEach(eventName => {
  document.addEventListener(eventName, markUserInputActivity, true);
});
document.addEventListener("focusout", () => {
  if (auth.currentUser && state.pendingSync) {
    setTimeout(() => flushPendingSync("input-blur"), 350);
  }
}, true);

function userRecentlyTyped(windowMs = 2500) {
  return Date.now() - lastUserInputAt < windowMs;
}

function isUserActivelyEditing() {
  if (activeDoorFlowAction || window.__doorFlowMobileSubmitting) return true;

  const active = document.activeElement;
  if (!active) return false;

  const tag = String(active.tagName || "").toLowerCase();
  const isEditable = tag === "input" || tag === "textarea" || tag === "select" || active.isContentEditable;
  if (!isEditable) return false;

  // Mobile manager forms should not be interrupted while a manager has a field open.
  // For the tablet search box, allow refresh once typing pauses so door screens still update.
  const id = String(active.id || "");
  if (id.startsWith("mobileQuick") || id.startsWith("mobileGroup")) return true;

  return userRecentlyTyped(3000);
}

function updateSyncStatus(status, message) {
  state.syncStatus = status;
  state.syncMessage = message || "";
}

function msSinceDate(value) {
  const time = value ? new Date(value).getTime() : 0;
  return time ? Date.now() - time : Infinity;
}

function shouldReconnectRealtimeAfterIdle() {
  if (!realtimeChannel) return true;
  if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state.realtimeStatus)) return true;
  if (state.realtimeStatus !== "SUBSCRIBED") return true;
  if (lastHiddenAt) return true;
  if (
    msSinceDate(state.lastSyncAt) > DOORFLOW_REALTIME_RECONNECT_MS &&
    msSinceDate(state.lastRealtimeAt) > DOORFLOW_REALTIME_RECONNECT_MS
  ) return true;
  return false;
}

function isWakeRecoveryReason(reason = "") {
  return ["visibilitychange", "focus", "pageshow", "pageshow-cache"].includes(String(reason));
}

function shouldSkipAutoRefresh(options = {}) {
  const force = Boolean(options.force);

  if (!auth.currentUser) return true;
  if (!state.activeDate) return true;
  if (document.hidden) return true;
  if (isAutoRefreshing) return true;

  if (!force && state.modal) return true;
  if (!force && activeDoorFlowAction) return true;
  if (!force && hasUnsavedMobileManagerDraft()) return true;
  if (!force && userRecentlyTyped(1200)) return true;
  if (!force && isUserActivelyEditing()) return true;

  return false;
}

function schedulePendingSync(reason = "pending") {
  state.pendingSync = true;
  updateSyncStatus("Pending", `Update waiting while user is active (${reason}).`);
}

function compactRowStamp(row, fields) {
  return fields.map(field => String(row?.[field] ?? "")).join("|");
}

function buildLiveDataHash(groups, guests, logs, shiftNotes) {
  return [
    (groups || []).map(row => compactRowStamp(row, ["id", "name", "group_type", "host_name", "status", "updated_at", "created_at"])).join("~"),
    (guests || []).map(row => compactRowStamp(row, ["id", "group_id", "first_name", "last_name", "guest_type", "total_allowed", "checked_in_count", "is_late_add", "late_add_approved_by", "late_add_reason", "notes", "updated_at", "created_at"])).join("~"),
    (logs || []).map(row => compactRowStamp(row, ["id", "guest_id", "group_id", "action", "amount", "created_at"])).join("~"),
    (shiftNotes || []).map(row => compactRowStamp(row, ["id", "note", "notes", "created_at", "updated_at"])).join("~")
  ].join("||");
}

function realtimePayloadAppliesToActiveDate(table, payload = {}) {
  if (!state.serviceDay?.id) return true;

  const row = payload.new || payload.old || {};

  if (table === "guests" || table === "check_in_logs") {
    const activeGroupIds = new Set(state.groups.map(group => group.id));
    const newGroupId = payload.new?.group_id;
    const oldGroupId = payload.old?.group_id;
    return activeGroupIds.has(newGroupId) || activeGroupIds.has(oldGroupId);
  }

  if (table === "groups" || table === "shift_notes") {
    return row.service_day_id === state.serviceDay.id;
  }

  if (table === "service_days") {
    return row.id === state.serviceDay.id || row.service_date === state.activeDate;
  }

  if (table === "staff_profiles") {
    return auth.currentUser?.role === "admin";
  }

  return true;
}

async function ensureFreshAuthSession(reason = "session") {
  const { data, error } = await db.auth.getSession();
  if (error) throw error;

  let session = data.session || null;

  if (!session?.user) {
    auth.session = null;
    auth.currentUser = null;
    auth.profile = null;
    stopAutoRefresh();
    unsubscribeRealtime();
    return null;
  }

  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
  const expiresSoon = expiresAtMs && expiresAtMs - Date.now() < DOORFLOW_SESSION_REFRESH_WINDOW_MS;

  if (expiresSoon) {
    const refreshed = await db.auth.refreshSession();
    if (refreshed.error) throw refreshed.error;
    session = refreshed.data.session || session;
  }

  auth.session = session;

  if (!auth.currentUser || auth.currentUser.id !== session.user.id) {
    await loadStaffProfile(session.user, { preserveView:true });
  }

  return session;
}

function syncRealtimeAuth(session) {
  try {
    if (session?.access_token && db.realtime && typeof db.realtime.setAuth === "function") {
      db.realtime.setAuth(session.access_token);
    }
  } catch (error) {
    console.warn("DoorFlow realtime auth refresh warning:", error);
  }
}

function shouldVerifyActionSession() {
  if (lastHiddenAt) return true;
  if (msSinceDate(state.lastResumeAt) < DOORFLOW_WAKE_ACTION_WINDOW_MS) return true;
  if (msSinceDate(lastActionSessionCheckAt) > DOORFLOW_ACTION_SESSION_CHECK_MS) return true;
  if (state.realtimeStatus !== "SUBSCRIBED") return true;
  return false;
}

async function verifyActionSessionWithServer() {
  const result = await withDoorFlowTimeout(
    db.auth.getUser(),
    "Reconnecting DoorFlow session",
    8000
  );

  if (result.error) throw result.error;
  lastActionSessionCheckAt = new Date();
  return result.data?.user || null;
}

async function prepareDatabaseAction(label = "Database action") {
  if (navigator.onLine === false) {
    throw new Error("This device appears offline. Reconnect Wi-Fi/cellular, then try again.");
  }

  const session = await ensureFreshAuthSession(`action:${label}`);
  if (!session) throw new Error("Session expired. Log in again.");

  syncRealtimeAuth(session);

  if (shouldVerifyActionSession()) {
    await verifyActionSessionWithServer();
  }

  if (shouldReconnectRealtimeAfterIdle()) {
    subscribeRealtime();
  }

  lastHiddenAt = null;
}

async function refreshLiveDataSilently(reason = "auto", options = {}) {
  if (shouldSkipAutoRefresh(options)) {
    schedulePendingSync(reason);
    return;
  }

  try {
    isAutoRefreshing = true;
    lastAutoRefreshAt = new Date();
    updateSyncStatus("Syncing", `Refreshing from ${reason}.`);
    await loadDataForDate(state.activeDate);
    state.pendingSync = false;
  } catch (error) {
    console.warn("DoorFlow live refresh failed:", reason, error);
    updateSyncStatus("Reconnect", error?.message || "Live refresh failed. Use Refresh Data if needed.");
    render();
  } finally {
    isAutoRefreshing = false;
  }
}

function requestRealtimeRefresh(source = "database", payload = null) {
  if (!auth.currentUser) return;
  if (payload && !realtimePayloadAppliesToActiveDate(source, payload)) return;

  state.lastRealtimeAt = new Date();

  if (realtimeDebounceTimer) {
    clearTimeout(realtimeDebounceTimer);
  }

  realtimeDebounceTimer = setTimeout(() => {
    refreshLiveDataSilently(`realtime:${source}`);
  }, 450);
}

function startAutoRefresh() {
  stopAutoRefresh();

  // Backup sync. Realtime should handle most updates. Keep this less aggressive
  // so tablets/phones do not feel like they are constantly repainting.
  autoRefreshTimer = setInterval(() => {
    if (state.realtimeStatus === "SUBSCRIBED" && state.lastRealtimeAt) {
      const msSinceRealtime = Date.now() - new Date(state.lastRealtimeAt).getTime();
      if (msSinceRealtime < 12000) return;
    }

    refreshLiveDataSilently("interval");
  }, 30000);
}

function startRealtimeHealthCheck() {
  stopRealtimeHealthCheck();

  realtimeHealthTimer = setInterval(() => {
    if (!auth.currentUser || document.hidden || navigator.onLine === false) return;

    if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state.realtimeStatus)) {
      subscribeRealtime();
      refreshLiveDataSilently("realtime-reconnect", { force:true });
      return;
    }

    const lastSyncMs = state.lastSyncAt ? new Date(state.lastSyncAt).getTime() : 0;
    const msSinceSync = lastSyncMs ? Date.now() - lastSyncMs : Infinity;

    if (msSinceSync > 90000 && !isUserActivelyEditing() && !hasUnsavedMobileManagerDraft()) {
      recoverFromIdle("health-check");
    }
  }, 45000);
}

function stopRealtimeHealthCheck() {
  if (realtimeHealthTimer) {
    clearInterval(realtimeHealthTimer);
    realtimeHealthTimer = null;
  }
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  if (realtimeDebounceTimer) {
    clearTimeout(realtimeDebounceTimer);
    realtimeDebounceTimer = null;
  }

  if (resumeRecoveryTimer) {
    clearTimeout(resumeRecoveryTimer);
    resumeRecoveryTimer = null;
  }

  stopRealtimeHealthCheck();
}

async function manualRefreshData() {
  await refreshLiveDataSilently("manual", { force:true });
}

function flushPendingSync(reason = "resume") {
  if (!auth.currentUser || document.hidden) return;

  if (state.pendingSync) {
    if (state.modal || isUserActivelyEditing() || hasUnsavedMobileManagerDraft() || activeDoorFlowAction) {
      updateSyncStatus("Pending", `Update waiting while user finishes (${reason}).`);
      return;
    }

    refreshLiveDataSilently(reason, { force:true });
    return;
  }

  const lastSyncMs = state.lastSyncAt ? new Date(state.lastSyncAt).getTime() : 0;
  const msSinceSync = lastSyncMs ? Date.now() - lastSyncMs : Infinity;

  // Do not force-refresh on every focus/tap. On iOS PWAs, focus events can fire
  // while a manager is about to press a button, which can make the app feel frozen.
  if (msSinceSync > 20000 && !state.modal && !isUserActivelyEditing() && !hasUnsavedMobileManagerDraft()) {
    refreshLiveDataSilently(reason);
  }
}

function scheduleResumeRecovery(reason = "resume", delayMs = 650) {
  if (resumeRecoveryTimer) {
    clearTimeout(resumeRecoveryTimer);
  }

  resumeRecoveryTimer = setTimeout(() => {
    resumeRecoveryTimer = null;
    recoverFromIdle(reason);
  }, delayMs);
}

async function recoverFromIdle(reason = "resume") {
  if (!auth.currentUser || document.hidden || isResumeRecovering) return;

  if (state.modal || activeDoorFlowAction || window.__doorFlowMobileSubmitting || hasUnsavedMobileManagerDraft()) {
    schedulePendingSync(reason);
    return;
  }

  const msSinceSync = msSinceDate(state.lastSyncAt);
  const shouldRefresh = state.pendingSync || msSinceSync > 15000 || reason === "online";

  if (!shouldRefresh && !shouldReconnectRealtimeAfterIdle() && !isWakeRecoveryReason(reason)) {
    return;
  }

  try {
    isResumeRecovering = true;
    state.lastResumeAt = new Date();
    updateSyncStatus("Syncing", `Reconnecting after ${reason}.`);

    const session = await ensureFreshAuthSession(reason);

    if (!session) {
      updateSyncStatus("Signed out", "Session expired. Log in again.");
      render();
      return;
    }

    syncRealtimeAuth(session);

    if (shouldReconnectRealtimeAfterIdle() || isWakeRecoveryReason(reason)) {
      subscribeRealtime();
    }

    if (shouldRefresh) {
      await refreshLiveDataSilently(`resume:${reason}`, { force:true });
    } else {
      render();
    }
  } catch (error) {
    console.warn("DoorFlow idle recovery failed:", reason, error);
    updateSyncStatus("Reconnect", error?.message || "Live sync needs attention. Tap Refresh Data if needed.");
    render();
  } finally {
    if (!document.hidden) lastHiddenAt = null;
    isResumeRecovering = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    lastHiddenAt = Date.now();
    return;
  }

  if (auth.currentUser) {
    scheduleResumeRecovery("visibilitychange", 500);
  }
});

window.addEventListener("focus", () => {
  if (auth.currentUser) {
    scheduleResumeRecovery("focus", 500);
  }
});

window.addEventListener("pageshow", event => {
  if (auth.currentUser) {
    scheduleResumeRecovery(event.persisted ? "pageshow-cache" : "pageshow", 500);
  }
});

window.addEventListener("online", () => {
  if (auth.currentUser) {
    updateSyncStatus("Syncing", "Connection restored. Refreshing live data.");
    scheduleResumeRecovery("online", 500);
  }
});

window.addEventListener("offline", () => {
  updateSyncStatus("Offline", "Device appears offline. Live updates are paused.");
  if (auth.currentUser) render();
});

/* AUTH */

async function initAuth() {
  const { data, error } = await db.auth.getSession();

  if (error) {
    state.error = error.message;
    render();
    return;
  }

  auth.session = data.session || null;

  if (auth.session?.user) {
    await loadStaffProfile(auth.session.user);
  }

  db.auth.onAuthStateChange(async (event, session) => {
    auth.session = session || null;

    if (session?.user) {
      if (event === "TOKEN_REFRESHED" && auth.currentUser?.id === session.user.id) {
        updateSyncStatus(state.syncStatus || "Live", "Session refreshed. Live sync is still active.");
        return;
      }

      const preserveView = event === "TOKEN_REFRESHED" || Boolean(auth.currentUser);
      await loadStaffProfile(session.user, { preserveView });

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        updateSyncStatus(state.syncStatus || "Live", "Session refreshed. Live sync is still active.");
        return;
      }

      await bootDatabase();
    } else {
      stopAutoRefresh();
      unsubscribeRealtime();

      auth.session = null;
      auth.currentUser = null;
      auth.profile = null;
      state.groups = [];
      state.guests = [];
      state.logs = [];
      state.staffProfiles = [];
      state.selectedGroupId = null;
      state.currentMode = "GENERAL";
      state.searchText = "";
      state.groupSearchText = "";
      state.modal = null;
      render();
    }
  });

  render();

  if (auth.currentUser) {
    await bootDatabase();
  }
}

async function loadStaffProfile(user, options = {}) {
  const previousView = state.view;

  const { data, error } = await db
    .from("staff_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    state.error = error.message;
    auth.currentUser = null;
    auth.profile = null;
    render();
    return;
  }

  if (!data) {
    state.error = "This login exists in Supabase Auth, but it has not been added to DoorFlow staff_profiles yet.";
    auth.currentUser = null;
    auth.profile = null;
    render();
    return;
  }

  if (!data.active) {
    state.error = "This DoorFlow account is inactive.";
    auth.currentUser = null;
    auth.profile = null;
    render();
    return;
  }

  if (!roles[data.role]) {
    state.error = `This DoorFlow account has an unknown role: ${data.role || "blank"}.`;
    auth.currentUser = null;
    auth.profile = null;
    render();
    return;
  }

  auth.profile = data;
  auth.currentUser = {
    id:user.id,
    email:user.email,
    name:data.full_name,
    role:data.role,
    active:data.active
  };

  state.error = "";
  state.view = options.preserveView && viewAllowedForRole(data.role, previousView)
    ? previousView
    : defaultViewForRole(data.role);

  if (data.role === "admin") {
    await loadStaffProfilesForAdmin();
  }

  render();
}

async function login(event) {
  event.preventDefault();

  const form = new FormData(event.target);
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");

  if (!email || !password) {
    alert("Email and password are required.");
    return;
  }

  const { data, error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    state.error = error.message;
    render();
    return;
  }

  auth.session = data.session;
  await loadStaffProfile(data.user);
  await bootDatabase();
}

async function logout() {
  try {
    await db.auth.signOut({ scope:"local" });
  } catch (error) {
    console.warn("Logout warning:", error);
  }

  stopAutoRefresh();
  unsubscribeRealtime();

  auth.session = null;
  auth.currentUser = null;
  auth.profile = null;

  state.groups = [];
  state.guests = [];
  state.logs = [];
  state.shiftNotes = [];
  state.staffProfiles = [];
  state.selectedGroupId = null;
  state.currentMode = "GENERAL";
  state.searchText = "";
  state.groupSearchText = "";
  state.modal = null;
  state.error = "";

  Object.keys(localStorage).forEach(key => {
    if (key.startsWith("sb-") || key.includes("supabase")) {
      localStorage.removeItem(key);
    }
  });

  render();
}

/* DATABASE LOAD */

async function bootDatabase() {
  if (!auth.currentUser) return;

  if (isBootingDatabase) return;

  try {
    isBootingDatabase = true;
    const session = await ensureFreshAuthSession("boot");
    if (!session) {
      state.error = "Session expired. Log in again.";
      render();
      return;
    }
    await loadDataForDate(state.activeDate);
    subscribeRealtime();
    startAutoRefresh();
    startRealtimeHealthCheck();
  } finally {
    isBootingDatabase = false;
  }
}

function canManageData() {
  return Boolean(perms()?.manage);
}

async function ensureVenue() {
  let result = await db
    .from("venues")
    .select("*")
    .eq("name","EVE")
    .order("created_at", { ascending:true })
    .limit(1);

  if (result.error) throw result.error;
  if (firstRow(result.data)) return firstRow(result.data);

  if (!canManageData()) {
    throw new Error("Venue has not been created yet. Log in as admin/manager first.");
  }

  result = await db.from("venues").insert({ name:"EVE" });
  if (result.error) throw result.error;

  result = await db
    .from("venues")
    .select("*")
    .eq("name","EVE")
    .order("created_at", { ascending:true })
    .limit(1);

  return must(firstRow(result.data), result.error);
}

async function ensureServiceDay(dateString) {
  const venue = await ensureVenue();
  const dayName = dayNameFromDate(dateString);

  let result = await db
    .from("service_days")
    .select("*")
    .eq("venue_id", venue.id)
    .eq("service_date", dateString)
    .order("created_at", { ascending:true })
    .limit(1);

  if (result.error) throw result.error;

  let serviceDay = firstRow(result.data);

  if (!serviceDay) {
    if (!canManageData()) {
      throw new Error("This date has not been created yet. Ask management to open this date first.");
    }

    result = await db
      .from("service_days")
      .insert({ venue_id:venue.id, service_date:dateString, day_name:dayName });

    if (result.error) throw result.error;

    result = await db
      .from("service_days")
      .select("*")
      .eq("venue_id", venue.id)
      .eq("service_date", dateString)
      .order("created_at", { ascending:true })
      .limit(1);

    if (result.error) throw result.error;
    serviceDay = firstRow(result.data);
  }

  state.venue = venue;
  state.serviceDay = serviceDay;
  return serviceDay;
}

async function findGeneralGroupForServiceDay(serviceDayId) {
  if (!serviceDayId) return null;

  let result = await db
    .from("groups")
    .select("*")
    .eq("service_day_id", serviceDayId)
    .eq("name", "General Guest List")
    .order("created_at", { ascending:true })
    .limit(1);

  if (result.error) throw result.error;
  let group = firstRow(result.data);
  if (group) return group;

  result = await db
    .from("groups")
    .select("*")
    .eq("service_day_id", serviceDayId)
    .eq("group_type", "General Guest List")
    .order("created_at", { ascending:true })
    .limit(1);

  if (result.error) throw result.error;
  return firstRow(result.data);
}

async function ensureGeneralGroup(serviceDayId) {
  const existing = await findGeneralGroupForServiceDay(serviceDayId);
  if (existing) return existing;

  if (!canManageData()) {
    throw new Error("General Guest List does not exist for this date yet. Ask management to open this date first.");
  }

  const insertResult = await db.from("groups").insert({
    service_day_id:serviceDayId,
    name:"General Guest List",
    group_type:"General Guest List",
    host_name:"Door List",
    table_location:"Front Door",
    approved_by:"Management",
    notes:"Master guest list for this date.",
    status:"Active"
  });

  if (insertResult.error) throw insertResult.error;

  const created = await findGeneralGroupForServiceDay(serviceDayId);
  if (!created) {
    throw new Error("DoorFlow could not find or create the General Guest List for this date. Use Refresh Data, then try again.");
  }

  return created;
}

async function loadDataForDate(dateString) {
  return runDb("Loading live data", async () => {
    if (auth.session?.user) {
      const session = await ensureFreshAuthSession("load-data");
      if (!session) throw new Error("Session expired. Log in again.");
    }

    if (!isAutoRefreshing && !state.modal && !activeDoorFlowAction && !hasUnsavedMobileManagerDraft()) {
      state.loading = true;
      render();
    }

    state.activeDate = dateString;
    state.activeDay = dayNameFromDate(dateString);
    saveActiveDate(dateString);

    const serviceDay = await ensureServiceDay(dateString);
    await ensureGeneralGroup(serviceDay.id);

    const groupsResult = await db
      .from("groups")
      .select("*")
      .eq("service_day_id", serviceDay.id)
      .order("created_at", { ascending:false });

    state.groups = must(groupsResult.data, groupsResult.error) || [];

    const groupIds = state.groups.map(group => group.id);

    if (groupIds.length) {
      const guestsResult = await db
        .from("guests")
        .select("*")
        .in("group_id", groupIds)
        .order("last_name", { ascending:true });

      state.guests = must(guestsResult.data, guestsResult.error) || [];

      const logsResult = await db
        .from("check_in_logs")
        .select("*")
        .in("group_id", groupIds)
        .order("created_at", { ascending:false })
        .limit(300);

      state.logs = must(logsResult.data, logsResult.error) || [];
    } else {
      state.guests = [];
      state.logs = [];
    }

    const notesResult = await db
      .from("shift_notes")
      .select("*")
      .eq("service_day_id", serviceDay.id)
      .order("created_at", { ascending:false });

    state.shiftNotes = must(notesResult.data, notesResult.error) || [];

    if (!selectedGroup() && specificGroups()[0]) {
      state.selectedGroupId = specificGroups()[0].id;
    }

    if (auth.currentUser?.role === "admin") {
      await loadStaffProfilesForAdmin();
    }

    const newDataHash = buildLiveDataHash(state.groups, state.guests, state.logs, state.shiftNotes);
    const dataUnchanged = Boolean(state.lastDataHash && state.lastDataHash === newDataHash);
    state.lastDataHash = newDataHash;

    state.loading = false;
    state.lastSyncAt = new Date();
    if (state.realtimeStatus === "SUBSCRIBED") {
      updateSyncStatus("Live", "Realtime connected. Backup refresh is active.");
    } else if (navigator.onLine === false) {
      updateSyncStatus("Offline", "Device appears offline. Live updates are paused.");
    } else {
      updateSyncStatus("Polling", "Using backup refresh. Realtime may still be connecting.");
    }

    // Auto-refresh should not repaint the whole app when nothing actually changed.
    // This is what makes phones/tablets feel smoother during live service.
    if (!activeDoorFlowAction && (!isAutoRefreshing || !dataUnchanged)) {
      render();
    }
  });
}

function unsubscribeRealtime() {
  if (realtimeChannel) {
    try {
      db.removeChannel(realtimeChannel);
    } catch (error) {
      console.warn("DoorFlow realtime unsubscribe warning:", error);
    }
    realtimeChannel = null;
  }
}

function subscribeRealtime() {
  unsubscribeRealtime();

  updateSyncStatus("Connecting", "Connecting realtime updates.");
  state.realtimeStatus = "CONNECTING";

  const channelName = `doorflow-live-${state.serviceDay?.id || state.activeDate || "all"}-${Date.now()}`;

  realtimeChannel = db.channel(channelName)
    .on("postgres_changes", { event:"*", schema:"public", table:"guests" }, payload => requestRealtimeRefresh("guests", payload))
    .on("postgres_changes", { event:"*", schema:"public", table:"groups" }, payload => requestRealtimeRefresh("groups", payload))
    .on("postgres_changes", { event:"*", schema:"public", table:"check_in_logs" }, payload => requestRealtimeRefresh("check_in_logs", payload))
    .on("postgres_changes", { event:"*", schema:"public", table:"shift_notes" }, payload => requestRealtimeRefresh("shift_notes", payload))
    .on("postgres_changes", { event:"*", schema:"public", table:"service_days" }, payload => requestRealtimeRefresh("service_days", payload))
    .on("postgres_changes", { event:"*", schema:"public", table:"staff_profiles" }, payload => {
      if (realtimePayloadAppliesToActiveDate("staff_profiles", payload)) {
        loadStaffProfilesForAdmin();
      }
    })
    .subscribe(status => {
      state.realtimeStatus = status;

      if (status === "SUBSCRIBED") {
        state.realtimeSubscribedAt = new Date();
        state.lastRealtimeAt = new Date();
        updateSyncStatus("Live", "Realtime connected. Backup refresh is active.");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        updateSyncStatus("Polling", "Realtime is reconnecting. Backup refresh is still active.");
      } else {
        updateSyncStatus("Connecting", `Realtime status: ${status}`);
      }

      if (auth.currentUser && !state.modal && !isUserActivelyEditing() && !hasUnsavedMobileManagerDraft()) {
        render();
      }
    });
}

/* DATA HELPERS */

function generalGroup() {
  return state.groups.find(group => group.name === "General Guest List" || group.group_type === "General Guest List") || null;
}

async function getGeneralGroupForActiveDate() {
  let group = generalGroup();
  if (group) return group;

  const serviceDay = state.serviceDay?.id
    ? state.serviceDay
    : await ensureServiceDay(state.activeDate);

  group = await ensureGeneralGroup(serviceDay.id);

  if (group && !state.groups.some(item => item.id === group.id)) {
    state.groups = [group, ...state.groups];
  }

  return group;
}

function specificGroups() {
  return state.groups.filter(group => !(group.name === "General Guest List" || group.group_type === "General Guest List"));
}

function selectedGroup() {
  const selected = state.groups.find(group => group.id === state.selectedGroupId);
  if (selected && !(selected.name === "General Guest List" || selected.group_type === "General Guest List")) return selected;
  return specificGroups()[0] || null;
}

function guestsForGroup(groupId) {
  return state.guests.filter(guest => guest.group_id === groupId);
}

function guestTotal(guest) {
  return Math.max(1, Number(guest?.total_allowed || 1));
}

function guestChecked(guest) {
  return Math.max(0, Math.min(guestTotal(guest), Number(guest?.checked_in_count || 0)));
}

function guestRemaining(guest) {
  return Math.max(0, guestTotal(guest) - guestChecked(guest));
}

function isGuestFullyIn(guest) {
  return guestChecked(guest) >= guestTotal(guest);
}

function groupStats(groupId) {
  const guests = guestsForGroup(groupId);

  return {
    total: guests.reduce((sum, guest) => sum + guestTotal(guest), 0),
    checked: guests.reduce((sum, guest) => sum + guestChecked(guest), 0),
    remaining: guests.reduce((sum, guest) => sum + guestRemaining(guest), 0)
  };
}

function dayStats() {
  return {
    groups: state.groups.length,
    total: state.guests.reduce((sum, guest) => sum + guestTotal(guest), 0),
    checked: state.guests.reduce((sum, guest) => sum + guestChecked(guest), 0),
    remaining: state.guests.reduce((sum, guest) => sum + guestRemaining(guest), 0),
    completeGroups: specificGroups().filter(group => {
      const stats = groupStats(group.id);
      return stats.total > 0 && stats.remaining === 0;
    }).length
  };
}

function sortGuests(list) {
  const last = guest => `${guest.last_name} ${guest.first_name}`.toLowerCase();
  const first = guest => `${guest.first_name} ${guest.last_name}`.toLowerCase();

  if (state.sortMode === "LAST_ASC") return list.sort((a,b) => last(a).localeCompare(last(b)));
  if (state.sortMode === "LAST_DESC") return list.sort((a,b) => last(b).localeCompare(last(a)));
  if (state.sortMode === "FIRST_ASC") return list.sort((a,b) => first(a).localeCompare(first(b)));
  if (state.sortMode === "FIRST_DESC") return list.sort((a,b) => first(b).localeCompare(first(a)));
  if (state.sortMode === "UNCHECKED") return list.sort((a,b) => Number(isGuestFullyIn(a)) - Number(isGuestFullyIn(b)) || last(a).localeCompare(last(b)));
  if (state.sortMode === "CHECKED") return list.sort((a,b) => Number(isGuestFullyIn(b)) - Number(isGuestFullyIn(a)) || last(a).localeCompare(last(b)));

  return list;
}

function visibleGuests() {
  const source = state.currentMode === "GENERAL"
    ? state.guests
    : selectedGroup()
      ? guestsForGroup(selectedGroup().id)
      : [];

  const query = state.searchText.trim().toLowerCase();

  const filtered = source.filter(guest => {
    const group = state.groups.find(item => item.id === guest.group_id);
    const groupText = group ? `${group.name} ${group.group_type} ${group.host_name || ""}` : "";
    const searchMatch = !query || `${guest.first_name} ${guest.last_name} ${guest.guest_type} ${guest.notes || ""} ${guest.late_add_approved_by || ""} ${guest.late_add_reason || ""} ${guest.added_by_name || ""} ${groupText}`.toLowerCase().includes(query);
    return searchMatch && guestMatchesStatusFilter(guest);
  });

  return sortGuests([...filtered]);
}

function visibleGroups() {
  const query = state.groupSearchText.trim().toLowerCase();

  return specificGroups().filter(group => {
    return !query || `${group.name} ${group.group_type} ${group.host_name || ""} ${group.table_location || ""} ${group.notes || ""}`.toLowerCase().includes(query);
  });
}

function typeClass(type) {
  const value = String(type || "").toLowerCase();
  if (value.includes("bottle")) return "bottle";
  if (value.includes("vip")) return "vip";
  if (value.includes("private")) return "private";
  if (value.includes("do not")) return "blocked";
  return "general";
}

function groupNameForGuest(guest) {
  const group = state.groups.find(item => item.id === guest.group_id);
  return group ? group.name : "Unknown Group";
}


function isGeneralGroup(group) {
  return Boolean(group && (group.name === "General Guest List" || group.group_type === "General Guest List"));
}

function groupForGuest(guest) {
  return state.groups.find(item => item.id === guest.group_id) || null;
}

function guestMatchesStatusFilter(guest) {
  const filter = state.guestFilter || "ALL";
  const checked = guestChecked(guest);
  const total = guestTotal(guest);
  const remaining = guestRemaining(guest);
  const group = groupForGuest(guest);
  const groupType = String(group?.group_type || "").toLowerCase();
  const guestType = String(guest?.guest_type || "").toLowerCase();

  if (filter === "ALL") return true;
  if (filter === "NOT_CHECKED_IN") return checked === 0;
  if (filter === "CHECKED_IN") return checked > 0;
  if (filter === "PARTIAL") return checked > 0 && remaining > 0;
  if (filter === "FULLY_IN") return checked >= total;
  if (filter === "LATE_ADD") return isLateAdd(guest);
  if (filter === "GENERAL_ONLY") return isGeneralGroup(group);
  if (filter === "GROUP_ONLY") return !isGeneralGroup(group);
  if (filter === "BOTTLE_SERVICE") return groupType.includes("bottle") || guestType.includes("bottle");
  if (filter === "VIP") return groupType.includes("vip") || guestType.includes("vip");
  if (filter === "DO_NOT_ADMIT") return guestType.includes("do not");

  return true;
}

function setGuestFilter(value) {
  state.guestFilter = value || "ALL";
  state.searchText = state.searchText || "";
  render();
}

function activeFilterLabel() {
  return guestFilterOptions.find(option => option.value === (state.guestFilter || "ALL"))?.label || "All Guests";
}

function filteredGuestCount() {
  return visibleGuests().length;
}


function guestFromLog(log) {
  return state.guests.find(item => item.id === log.guest_id) || null;
}

function groupFromLog(log) {
  const guest = guestFromLog(log);
  if (guest) return state.groups.find(item => item.id === guest.group_id) || null;
  return state.groups.find(item => item.id === log.group_id) || null;
}

function guestNameFromLog(log) {
  const guest = guestFromLog(log);
  return guest ? `${guest.first_name} ${guest.last_name}` : "Guest record not found";
}

function groupNameFromLog(log) {
  const group = groupFromLog(log);
  return group ? group.name : "Group not found";
}

function logTime(log) {
  try {
    return new Date(log.created_at).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
  } catch {
    return log.created_at || "";
  }
}

/* DUPLICATE HELPERS */

function normalizeGuestName(first, last) {
  return `${String(first || "").trim().toLowerCase()}|${String(last || "").trim().toLowerCase()}`;
}

function duplicateMatchesForName(first, last, excludeGuestId = null) {
  const key = normalizeGuestName(first, last);
  return state.guests.filter(guest => guest.id !== excludeGuestId && normalizeGuestName(guest.first_name, guest.last_name) === key);
}

function duplicateWarningText(duplicates, first, last) {
  const locations = [...new Set(duplicates.map(groupNameForGuest))].join(", ");
  return `"${first} ${last}" already exists on ${state.activeDate} under: ${locations}.`;
}

function confirmDuplicateSingle(first, last, excludeGuestId = null) {
  const duplicates = duplicateMatchesForName(first, last, excludeGuestId);
  if (!duplicates.length) return true;
  return confirm(`${duplicateWarningText(duplicates, first, last)}\n\nAdd anyway?`);
}

function duplicateWarningsForRows(rows) {
  const existing = new Map();
  state.guests.forEach(guest => {
    const key = normalizeGuestName(guest.first_name, guest.last_name);
    if (!existing.has(key)) existing.set(key, []);
    existing.get(key).push(guest);
  });

  const incoming = new Map();
  const warnings = [];

  rows.forEach(row => {
    const key = normalizeGuestName(row.first_name, row.last_name);
    const name = `${row.first_name} ${row.last_name}`;

    if (existing.has(key)) {
      const locations = [...new Set(existing.get(key).map(groupNameForGuest))].join(", ");
      warnings.push(`${name} already exists under: ${locations}`);
    }

    if (incoming.has(key)) {
      warnings.push(`${name} appears more than once in this import/paste list`);
    }

    incoming.set(key, true);
  });

  return warnings;
}

function confirmDuplicateRows(rows, sourceLabel) {
  const warnings = duplicateWarningsForRows(rows);
  if (!warnings.length) return true;

  const preview = warnings.slice(0,12).join("\n");
  const extra = warnings.length > 12 ? `\n...and ${warnings.length - 12} more possible duplicate issue(s).` : "";

  return confirm(`${sourceLabel} found ${warnings.length} possible duplicate issue(s):\n\n${preview}${extra}\n\nAdd anyway?`);
}


/* LATE-ADD APPROVAL TRACKING */

function isLateAdd(guest) {
  return Boolean(guest?.is_late_add || guest?.late_add_approved_by || guest?.late_add_reason);
}

function lateAddStatusText(guest) {
  if (!isLateAdd(guest)) return "";
  const approvedBy = guest.late_add_approved_by || "Approval not listed";
  const addedBy = guest.added_by_name || "Unknown";
  return `Late Add · Approved by ${approvedBy} · Added by ${addedBy}`;
}

function lateAddMetaText(guest) {
  if (!isLateAdd(guest)) return "";
  const parts = [];

  if (guest.late_add_approved_by) parts.push(`Approved by ${guest.late_add_approved_by}`);
  if (guest.added_by_name) parts.push(`Added by ${guest.added_by_name}`);
  if (guest.added_at) {
    try {
      parts.push(`Added ${new Date(guest.added_at).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" })}`);
    } catch {
      parts.push(`Added ${guest.added_at}`);
    }
  }
  if (guest.late_add_reason) parts.push(`Reason: ${guest.late_add_reason}`);

  return parts.join(" · ");
}

function lateAddBadge(guest) {
  return isLateAdd(guest) ? `<span class="badge remaining">Late Add</span>` : "";
}


/* STAFF MANAGEMENT */

async function loadStaffProfilesForAdmin() {
  if (!auth.currentUser || auth.currentUser.role !== "admin") return;

  const result = await db
    .from("staff_profiles")
    .select("*")
    .order("full_name", { ascending:true });

  if (result.error) {
    state.error = result.error.message;
    render();
    return;
  }

  state.staffProfiles = result.data || [];
}

async function updateStaffProfile(event) {
  event.preventDefault();
  if (!requirePerm("users")) return;

  const form = new FormData(event.target);
  const id = String(form.get("id") || "");
  const payload = {
    full_name:String(form.get("full_name") || "").trim(),
    role:String(form.get("role") || "door"),
    active:String(form.get("active")) === "true"
  };

  if (!id || !payload.full_name) {
    alert("Staff member and name are required.");
    return;
  }

  await prepareDatabaseAction("Update staff profile");

  const result = await db.from("staff_profiles").update(payload).eq("id", id);

  if (result.error) {
    state.error = result.error.message;
    render();
    return;
  }

  await loadStaffProfilesForAdmin();
  render();
}

async function refreshStaffProfiles() {
  if (!requirePerm("users")) return;
  await loadStaffProfilesForAdmin();
  render();
}

/* ACTIONS */

async function setActiveDay(day) {
  const date = nextDateForDay(day);
  saveActiveDate(date);
  await loadDataForDate(date);
}

async function setActiveDate(date) {
  if (!isValidISODate(date)) return;
  saveActiveDate(date);
  await loadDataForDate(date);
}

function selectGroup(id) {
  state.selectedGroupId = id;
  state.currentMode = "GROUP";
  state.searchText = "";
  render();
}

function setMode(mode) {
  state.currentMode = mode;
  state.searchText = "";
  render();
}

function setSortMode(value) {
  state.sortMode = value;
  render();
}

function selectTabletList(value) {
  if (value === "GENERAL") {
    state.currentMode = "GENERAL";
    state.selectedGroupId = null;
    state.searchText = "";
    render();
    return;
  }

  state.selectedGroupId = value;
  state.currentMode = "GROUP";
  state.searchText = "";
  render();
}

function switchView(view) {
  const p = perms();

  if (view === "door" && !p.door) return alert("No door access.");
  if (view === "tabletDoor" && !p.door) return alert("No door access.");
  if (view === "manage" && !p.manage) return alert("No management access.");
  if (view === "users" && !p.users) return alert("No staff management access.");
  if (view === "reports" && !p.reports) return alert("No report access.");

  state.view = view;

  if (view === "users") {
    loadStaffProfilesForAdmin();
  }

  render();
}

async function checkInOneGuest(id) {
  if (!requirePerm("door")) return;

  const guest = state.guests.find(item => item.id === id);
  if (!guest) return;

  if (guest.guest_type === "Do Not Admit") {
    alert("This guest is marked Do Not Admit. Contact management.");
    return;
  }

  if (guestRemaining(guest) <= 0) return;

  const newCount = guestChecked(guest) + 1;
  const user = currentUser();
  const nowIso = new Date().toISOString();

  await runDb("Check in", async () => {
    const updateResult = await withDoorFlowTimeout(
      db
        .from("guests")
        .update({
          checked_in_count:newCount,
          last_checked_in_at:nowIso,
          last_checked_in_by_name:user.name,
          last_door_location:state.doorLocation
        })
        .eq("id", id),
      "Saving check-in",
      12000
    );

    must(updateResult.data, updateResult.error);

    const logResult = await withDoorFlowTimeout(db.from("check_in_logs").insert({
      guest_id:guest.id,
      group_id:guest.group_id,
      action:"Check In 1",
      amount:1,
      door_location:state.doorLocation,
      staff_user_id:null,
      staff_name:user.name
    }), "Saving check-in log", 12000);

    must(logResult.data, logResult.error);

    guest.checked_in_count = newCount;
    guest.last_checked_in_at = nowIso;
    guest.last_checked_in_by_name = user.name;
    guest.last_door_location = state.doorLocation;

    render();
  });
}

async function undoOneGuest(id) {
  if (!requirePerm("door")) return;

  const guest = state.guests.find(item => item.id === id);
  if (!guest) return;

  const checked = guestChecked(guest);
  if (checked <= 0) return;

  const newCount = checked - 1;
  const user = currentUser();

  await runDb("Undo check-in", async () => {
    const updateResult = await withDoorFlowTimeout(
      db
        .from("guests")
        .update({
          checked_in_count:newCount,
          last_checked_in_at:newCount > 0 ? guest.last_checked_in_at : null,
          last_checked_in_by_name:newCount > 0 ? guest.last_checked_in_by_name : null,
          last_door_location:newCount > 0 ? guest.last_door_location : null
        })
        .eq("id", id),
      "Saving undo check-in",
      12000
    );

    must(updateResult.data, updateResult.error);

    const logResult = await withDoorFlowTimeout(db.from("check_in_logs").insert({
      guest_id:guest.id,
      group_id:guest.group_id,
      action:"Undo 1",
      amount:1,
      door_location:state.doorLocation,
      staff_user_id:null,
      staff_name:user.name
    }), "Saving undo log", 12000);

    must(logResult.data, logResult.error);

    guest.checked_in_count = newCount;
    render();
  });
}

function toggleGuest(id) {
  const guest = state.guests.find(item => item.id === id);
  if (!guest) return;

  if (guestRemaining(guest) > 0) {
    checkInOneGuest(id);
  } else {
    undoOneGuest(id);
  }
}

async function createGroup(event) {
  event.preventDefault();
  if (!requirePerm("manage")) return;

  const form = new FormData(event.target);
  const date = String(form.get("date") || state.activeDate);

  const payload = {
    service_day_id:null,
    name:String(form.get("name") || "").trim(),
    group_type:String(form.get("group_type") || "Bottle Service"),
    host_name:String(form.get("host_name") || "").trim(),
    table_location:String(form.get("table_location") || "").trim(),
    approved_by:String(form.get("approved_by") || "Management").trim(),
    notes:String(form.get("notes") || "").trim(),
    status:String(form.get("status") || "Active")
  };

  if (!payload.name) {
    alert("Group name is required.");
    return;
  }

  await runDb("Create group", async () => runCriticalAction("Creating party/group...", async () => {
    const serviceDay = state.serviceDay?.service_date === date
      ? state.serviceDay
      : await withDoorFlowTimeout(ensureServiceDay(date), "Finding the active service date", 12000);

    payload.service_day_id = serviceDay.id;

    const insertResult = await withDoorFlowTimeout(
      db.from("groups").insert(payload).select("*").limit(1),
      "Creating party/group",
      15000
    );

    const createdGroup = firstRow(must(insertResult.data, insertResult.error)) || {
      ...payload,
      id:`local-group-${Date.now()}`,
      created_at:new Date().toISOString()
    };

    state.activeDate = date;
    state.activeDay = dayNameFromDate(date);
    saveActiveDate(date);
    state.serviceDay = serviceDay;
    state.groups = [createdGroup, ...state.groups.filter(item => item.id !== createdGroup.id)];
    state.selectedGroupId = createdGroup.id;
    state.currentMode = "GROUP";
    state.modal = null;
    state.lastSyncAt = new Date();

    render();
    queueBackgroundRefreshAfterWrite();
  }));
}

async function updateGroup(event) {
  event.preventDefault();
  if (!requirePerm("manage")) return;

  const group = state.groups.find(item => item.id === state.editingGroupId);
  if (!group) return;

  const form = new FormData(event.target);
  const payload = {
    name:String(form.get("name") || "").trim(),
    group_type:String(form.get("group_type") || "Bottle Service"),
    host_name:String(form.get("host_name") || "").trim(),
    table_location:String(form.get("table_location") || "").trim(),
    approved_by:String(form.get("approved_by") || "Management").trim(),
    notes:String(form.get("notes") || "").trim(),
    status:String(form.get("status") || "Active")
  };

  if (!payload.name) {
    alert("Group name is required.");
    return;
  }

  await runDb("Update group", async () => runCriticalAction("Updating party/group...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("groups").update(payload).eq("id", group.id).select("*").limit(1),
      "Updating party/group",
      15000
    );

    const updatedGroup = firstRow(must(result.data, result.error)) || { ...group, ...payload };

    state.groups = state.groups.map(item => item.id === group.id ? updatedGroup : item);
    state.modal = null;
    state.editingGroupId = null;
    state.lastSyncAt = new Date();

    render();
    queueBackgroundRefreshAfterWrite();
  }));
}

async function deleteGroup(id) {
  if (!requirePerm("manage")) return;

  const group = state.groups.find(item => item.id === id);
  if (!group) return;

  if (group.name === "General Guest List" || group.group_type === "General Guest List") {
    alert("The master General Guest List cannot be deleted.");
    return;
  }

  if (!confirm(`Delete "${group.name}" and all names under it?`)) return;

  await runDb("Delete group", async () => {
    const result = await db.from("groups").delete().eq("id", id);
    must(result.data, result.error);

    state.selectedGroupId = specificGroups()[0]?.id || null;
    state.currentMode = "GENERAL";

    await loadDataForDate(state.activeDate);
  });
}

async function createGuest(event) {
  event.preventDefault();
  if (!requirePerm("manage")) return;

  const form = new FormData(event.target);
  const target = String(form.get("target") || "general");

  await prepareDatabaseAction("Create guest");

  let group = null;

  try {
    if (target === "general") {
      group = await getGeneralGroupForActiveDate();
    } else if (target === "selected") {
      group = selectedGroup();
    } else if (target.startsWith("group:")) {
      const groupId = target.replace("group:", "");
      group = state.groups.find(item => item.id === groupId) || null;
    }
  } catch (error) {
    alert(error?.message || "DoorFlow could not find the selected list. Use Refresh Data and try again.");
    return;
  }

  if (!group) {
    alert(target === "general" ? "DoorFlow could not find the General Guest List for this date. Tap Refresh Data and try again." : "Select or create a group first.");
    return;
  }

  const isLateAddEntry = form.get("is_late_add") === "on";

  const payload = {
    group_id:group.id,
    first_name:String(form.get("first_name") || "").trim(),
    last_name:String(form.get("last_name") || "").trim(),
    guest_type:String(form.get("guest_type") || "Guest"),
    total_allowed:Math.max(1, Number(form.get("total_allowed") || 1)),
    checked_in_count:form.get("checked_in") ? 1 : 0,
    notes:String(form.get("notes") || "").trim(),
    last_checked_in_at:form.get("checked_in") ? new Date().toISOString() : null,
    last_checked_in_by_name:form.get("checked_in") ? currentUser().name : null,
    last_door_location:form.get("checked_in") ? state.doorLocation : null,
    added_by_name:currentUser()?.name || "Unknown",
    added_by_user_id:auth.session?.user?.id || null,
    added_at:new Date().toISOString(),
    is_late_add:isLateAddEntry,
    late_add_approved_by:isLateAddEntry ? String(form.get("late_add_approved_by") || "").trim() : null,
    late_add_reason:isLateAddEntry ? String(form.get("late_add_reason") || "").trim() : null
  };

  if (!payload.first_name || !payload.last_name) {
    alert("First and last name are required.");
    return;
  }

  if (payload.is_late_add && !payload.late_add_approved_by) {
    alert("Late-add entries require an Approved By name.");
    return;
  }

  if (!confirmDuplicateSingle(payload.first_name, payload.last_name)) return;

  await runDb("Create guest", async () => runCriticalAction("Adding guest...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("guests").insert(payload).select("*").limit(1),
      "Adding guest",
      15000
    );

    const insertedGuest = firstRow(must(result.data, result.error)) || {
      ...payload,
      id:`local-${Date.now()}`,
      created_at:new Date().toISOString()
    };

    state.guests = [...state.guests.filter(item => item.id !== insertedGuest.id), insertedGuest];
    state.selectedGroupId = group.id;
    state.currentMode = isGeneralGroup(group) ? "GENERAL" : "GROUP";
    state.modal = null;
    state.lastSyncAt = new Date();

    render();
    queueBackgroundRefreshAfterWrite();
  }));
}



function setMobileManagerNotice(message, type = "info") {
  state.mobileManagerNotice = { message:String(message || ""), type:String(type || "info") };
}

function clearMobileManagerNotice() {
  state.mobileManagerNotice = null;
}

function showMobileManagerNotice(message, type = "info") {
  setMobileManagerNotice(message, type);
  const box = document.getElementById("mobileManagerMessage");
  if (box) {
    box.textContent = state.mobileManagerNotice.message;
    box.className = `mobile-manager-message ${state.mobileManagerNotice.type}`;
  }
}

function scrollToMobileCreateGroup() {
  const details = document.getElementById("mobileCreateGroupDetails");
  if (details) details.open = true;

  const input = document.getElementById("mobileGroupName");
  if (input) {
    input.scrollIntoView({ behavior:"smooth", block:"center" });
    setTimeout(() => input.focus(), 250);
  }
}

function readMobileField(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function withDoorFlowTimeout(promise, label = "Database request", timeoutMs = 15000) {
  let timer = null;

  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out. Tap Refresh Data before trying again so you do not accidentally add a duplicate.`));
      }, timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function runCriticalAction(label, fn) {
  activeDoorFlowAction = true;
  lastDoorFlowActionAt = Date.now();

  try {
    updateSyncStatus("Saving", label);
    return await fn();
  } finally {
    activeDoorFlowAction = false;
    lastDoorFlowActionAt = Date.now();
  }
}

function queueBackgroundRefreshAfterWrite() {
  window.setTimeout(() => {
    if (!auth.currentUser) return;
    refreshLiveDataSilently("post-write").catch(error => {
      console.warn("DoorFlow background refresh after write failed:", error);
      updateSyncStatus("Polling", "Saved locally. Tap Refresh Data if another device does not update.");
      render();
    });
  }, 650);
}

function mobileDraftValue(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function hasUnsavedMobileManagerDraft() {
  const quickName = mobileDraftValue("mobileQuickGuestName");
  const plusCount = mobileDraftValue("mobileQuickPlusCount");
  const groupName = mobileDraftValue("mobileGroupName");
  const groupHost = mobileDraftValue("mobileGroupHost");
  const groupLocation = mobileDraftValue("mobileGroupLocation");
  const groupNotes = mobileDraftValue("mobileGroupNotes");

  return Boolean(
    quickName ||
    (plusCount && plusCount !== "0") ||
    groupName ||
    groupHost ||
    groupLocation ||
    groupNotes
  );
}

function clearMobileQuickAddFields() {
  const guestName = document.getElementById("mobileQuickGuestName");
  const plusCount = document.getElementById("mobileQuickPlusCount");
  const reason = document.getElementById("mobileQuickReason");

  if (guestName) guestName.value = "";
  if (plusCount) plusCount.value = "0";
  if (reason) reason.value = "Added by manager during shift";
}

function clearMobileCreateGroupFields() {
  ["mobileGroupName", "mobileGroupHost", "mobileGroupNotes"].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.value = "";
  });

  const location = document.getElementById("mobileGroupLocation");
  if (location) location.value = "";
}


async function mobileQuickAddGuest() {
  if (!requirePerm("manage")) return;
  if (window.__doorFlowMobileSubmitting) return;

  clearMobileManagerNotice();

  let fullName = readMobileField("mobileQuickGuestName");
  const target = readMobileField("mobileQuickTarget") || "general";
  const approvedBy = readMobileField("mobileQuickApprovedBy");
  const reason = readMobileField("mobileQuickReason") || "Added by manager during shift";
  let plusCount = Math.max(0, Number(readMobileField("mobileQuickPlusCount") || 0));

  const inlinePlusMatch = fullName.match(/\s\+(\d+)\s*$/);
  if (inlinePlusMatch) {
    plusCount = Math.max(plusCount, Number(inlinePlusMatch[1] || 0));
    fullName = fullName.replace(/\s\+\d+\s*$/, "").trim();
  }

  plusCount = Math.max(0, Math.min(99, plusCount));
  const split = splitFullName(fullName);

  if (!split.first_name || !split.last_name) {
    showMobileManagerNotice("Enter the guest's first and last name.", "error");
    return;
  }

  if (!approvedBy) {
    showMobileManagerNotice("Approved By is required for manager quick adds.", "error");
    return;
  }

  let group = null;

  try {
    await prepareDatabaseAction("Mobile quick add guest");

    window.__doorFlowMobileSubmitting = true;
    activeDoorFlowAction = true;
    showMobileManagerNotice("Adding guest...", "info");

    if (target === "general") {
      group = await withDoorFlowTimeout(getGeneralGroupForActiveDate(), "Finding the General Guest List", 12000);
    } else if (target.startsWith("group:")) {
      const groupId = target.replace("group:", "");
      group = state.groups.find(item => item.id === groupId) || null;
    }

    if (!group) {
      showMobileManagerNotice("Select the General Guest List or create/select a party first.", "error");
      return;
    }

    const payload = {
      group_id:group.id,
      first_name:split.first_name,
      last_name:split.last_name,
      guest_type:"Guest",
      total_allowed:1 + plusCount,
      checked_in_count:0,
      notes:reason,
      last_checked_in_at:null,
      last_checked_in_by_name:null,
      last_door_location:null,
      added_by_name:currentUser()?.name || "Unknown",
      added_by_user_id:auth.session?.user?.id || null,
      added_at:new Date().toISOString(),
      is_late_add:true,
      late_add_approved_by:approvedBy,
      late_add_reason:reason
    };

    if (!confirmDuplicateSingle(payload.first_name, payload.last_name)) {
      showMobileManagerNotice("Guest add canceled.", "info");
      return;
    }

    const insertResult = await withDoorFlowTimeout(
      db.from("guests").insert(payload).select("*").limit(1),
      "Adding guest",
      15000
    );

    const insertedGuest = firstRow(must(insertResult.data, insertResult.error)) || {
      ...payload,
      id:`local-${Date.now()}`,
      created_at:new Date().toISOString()
    };

    // Optimistic local update so the phone does not sit on "Adding guest..."
    // while waiting for the full list refresh/realtime event.
    if (!state.guests.some(item => item.id === insertedGuest.id)) {
      state.guests = [...state.guests, insertedGuest];
    }

    state.selectedGroupId = group.id;
    state.currentMode = isGeneralGroup(group) ? "GENERAL" : "GROUP";
    state.lastSyncAt = new Date();
    setMobileManagerNotice(`${payload.first_name} ${payload.last_name}${plusCount ? ` +${plusCount}` : ""} added to ${group.name}.`, "success");

    clearMobileQuickAddFields();
    window.__doorFlowMobileSubmitting = false;
    render();
    queueBackgroundRefreshAfterWrite();
  } catch (error) {
    console.error(error);
    showMobileManagerNotice(error?.message || "Guest could not be added. Tap Refresh Data and try again.", "error");
  } finally {
    window.__doorFlowMobileSubmitting = false;
    activeDoorFlowAction = false;
    lastDoorFlowActionAt = Date.now();
  }
}

async function mobileQuickCreateGroup() {
  if (!requirePerm("manage")) return;
  if (window.__doorFlowMobileSubmitting) return;

  clearMobileManagerNotice();

  const name = readMobileField("mobileGroupName");
  const groupType = readMobileField("mobileGroupType") || "VIP Party";
  const hostName = readMobileField("mobileGroupHost");
  const location = readMobileField("mobileGroupLocation");
  const approvedBy = readMobileField("mobileGroupApprovedBy") || currentUser()?.name || "Management";
  const notes = readMobileField("mobileGroupNotes");

  if (!name) {
    showMobileManagerNotice("Party / Group Name is required.", "error");
    return;
  }

  try {
    await prepareDatabaseAction("Mobile create party/group");

    window.__doorFlowMobileSubmitting = true;
    activeDoorFlowAction = true;
    showMobileManagerNotice("Creating party/group...", "info");

    const serviceDay = state.serviceDay?.id
      ? state.serviceDay
      : await withDoorFlowTimeout(ensureServiceDay(state.activeDate), "Finding the active service date", 12000);

    const payload = {
      service_day_id:serviceDay.id,
      name,
      group_type:groupType,
      host_name:hostName,
      table_location:location,
      approved_by:approvedBy,
      notes,
      status:"Active"
    };

    const insertResult = await withDoorFlowTimeout(
      db.from("groups").insert(payload).select("*").limit(1),
      "Creating party/group",
      15000
    );

    const createdGroup = firstRow(must(insertResult.data, insertResult.error)) || {
      ...payload,
      id:`local-group-${Date.now()}`,
      created_at:new Date().toISOString()
    };

    if (!state.groups.some(item => item.id === createdGroup.id)) {
      state.groups = [createdGroup, ...state.groups];
    }

    state.selectedGroupId = createdGroup.id;
    state.currentMode = "GROUP";
    state.lastSyncAt = new Date();
    setMobileManagerNotice(`${name} created. You can now add guests to that list.`, "success");

    clearMobileCreateGroupFields();
    window.__doorFlowMobileSubmitting = false;
    render();
    queueBackgroundRefreshAfterWrite();
  } catch (error) {
    console.error(error);
    showMobileManagerNotice(error?.message || "Party/group could not be created. Tap Refresh Data and try again.", "error");
  } finally {
    window.__doorFlowMobileSubmitting = false;
    activeDoorFlowAction = false;
    lastDoorFlowActionAt = Date.now();
  }
}


async function createQuickManagerGuest(event) {
  event.preventDefault();
  if (!requirePerm("manage")) return;

  const form = new FormData(event.target);
  const target = String(form.get("target") || "general");
  let fullName = String(form.get("guest_name") || "").trim();
  const approvedBy = String(form.get("approved_by") || "").trim();
  const reason = String(form.get("late_add_reason") || "Added by manager during shift").trim();
  let plusCount = Math.max(0, Number(form.get("plus_count") || 0));

  const inlinePlusMatch = fullName.match(/\s\+(\d+)\s*$/);
  if (inlinePlusMatch) {
    plusCount = Math.max(plusCount, Number(inlinePlusMatch[1] || 0));
    fullName = fullName.replace(/\s\+\d+\s*$/, "").trim();
  }

  plusCount = Math.max(0, Math.min(99, plusCount));
  const totalAllowed = 1 + plusCount;

  const split = splitFullName(fullName);

  if (!split.first_name || !split.last_name) {
    alert("Enter the guest's first and last name.");
    return;
  }

  if (!approvedBy) {
    alert("Approved By is required for manager quick adds.");
    return;
  }

  let group = null;

  if (target === "general") {
    group = await getGeneralGroupForActiveDate();
  } else if (target.startsWith("group:")) {
    const groupId = target.replace("group:", "");
    group = state.groups.find(item => item.id === groupId) || null;
  }

  if (!group) {
    alert("Select or create a list/group first.");
    return;
  }

  const payload = {
    group_id:group.id,
    first_name:split.first_name,
    last_name:split.last_name,
    guest_type:"Guest",
    total_allowed:totalAllowed,
    checked_in_count:0,
    notes:reason,
    last_checked_in_at:null,
    last_checked_in_by_name:null,
    last_door_location:null,
    added_by_name:currentUser()?.name || "Unknown",
    added_by_user_id:auth.session?.user?.id || null,
    added_at:new Date().toISOString(),
    is_late_add:true,
    late_add_approved_by:approvedBy,
    late_add_reason:reason
  };

  if (!confirmDuplicateSingle(payload.first_name, payload.last_name)) return;

  await runDb("Quick add guest", async () => runCriticalAction("Adding guest...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("guests").insert(payload).select("*").limit(1),
      "Adding guest",
      15000
    );

    const insertedGuest = firstRow(must(result.data, result.error)) || {
      ...payload,
      id:`local-${Date.now()}`,
      created_at:new Date().toISOString()
    };

    state.guests = [...state.guests.filter(item => item.id !== insertedGuest.id), insertedGuest];
    state.selectedGroupId = group.id;
    state.currentMode = group.name === "General Guest List" || group.group_type === "General Guest List" ? "GENERAL" : "GROUP";
    state.lastSyncAt = new Date();

    render();
    queueBackgroundRefreshAfterWrite();
  }));
}

function recentManagerAdds(limit = 5) {
  return [...state.guests]
    .filter(guest => isLateAdd(guest) || guest.added_by_name)
    .sort((a,b) => String(b.added_at || b.created_at || "").localeCompare(String(a.added_at || a.created_at || "")))
    .slice(0, limit);
}

function renderMobileManagerView() {
  const stats = dayStats();
  const latestNote = state.shiftNotes[0];
  const recentAdds = recentManagerAdds(5);
  const general = generalGroup();
  const listRows = [
    general ? { id:"general", name:"General Guest List", count:guestsForGroup(general.id).length } : { id:"general", name:"General Guest List", count:0 },
    ...specificGroups().map(group => ({ id:group.id, name:group.name, count:guestsForGroup(group.id).length }))
  ];

  return `
    <div class="mobile-manager-view">
      <section class="mobile-manager-header">
        <div class="mobile-manager-header-top">
          <div>
            <p class="mobile-manager-kicker">DoorFlow</p>
            <h2>Manager Mode</h2>
            <p class="mobile-manager-subtitle">The B.O.B. • ${esc(state.activeDate)}</p>
          </div>
          <div class="mobile-manager-live-badge">Live</div>
        </div>

        <div class="mobile-manager-stats-grid">
          <div class="mobile-manager-stat-card"><strong>${stats.total}</strong><span>Total</span></div>
          <div class="mobile-manager-stat-card"><strong>${stats.checked}</strong><span>Checked In</span></div>
          <div class="mobile-manager-stat-card"><strong>${stats.remaining}</strong><span>Remaining</span></div>
        </div>
      </section>

      <section class="mobile-manager-card">
        <div class="mobile-manager-title-row">
          <div>
            <h2>Quick Add</h2>
            <p>Fast manager additions during service.</p>
          </div>
          <strong style="font-size:24px;">+</strong>
        </div>

        <div id="mobileManagerMessage" class="mobile-manager-message ${state.mobileManagerNotice ? esc(state.mobileManagerNotice.type || "info") : ""}">${state.mobileManagerNotice ? esc(state.mobileManagerNotice.message || "") : ""}</div>

        <div class="mobile-manager-form">
          <div>
            <label>Guest Name</label>
            <input id="mobileQuickGuestName" placeholder="First and last name" autocomplete="off" autocorrect="off" autocapitalize="words" />
          </div>

          <div>
            <label>Plus Ones</label>
            <input id="mobileQuickPlusCount" type="number" min="0" max="99" value="0" inputmode="numeric" />
            <p class="mobile-manager-help">0 = named guest only. 1 = guest +1. 2 = guest +2.</p>
          </div>

          <div>
            <label>Add To</label>
            <select id="mobileQuickTarget">
              <option value="general">General Guest List</option>
              ${specificGroups().map(group => `<option value="group:${group.id}" ${group.id === selectedGroup()?.id ? "selected" : ""}>${esc(group.name)}${group.host_name ? ` — ${esc(group.host_name)}` : ""}</option>`).join("")}
            </select>
          </div>

          <div>
            <label>Approved By</label>
            <input id="mobileQuickApprovedBy" value="${esc(currentUser()?.name || "")}" placeholder="Manager name" autocomplete="off" autocapitalize="words" />
          </div>

          <div>
            <label>Notes</label>
            <textarea id="mobileQuickReason" placeholder="Example: Added by manager during shift">Added by manager during shift</textarea>
          </div>

          <button class="btn mobile-manager-primary-btn" type="button" onclick="mobileQuickAddGuest()">Add Guest</button>
        </div>
      </section>

      <div class="mobile-manager-two-buttons">
        <button class="btn secondary mobile-manager-wide-btn" type="button" onclick="scrollToMobileCreateGroup()">Create Party / Group</button>
        <button class="btn secondary" type="button" onclick="switchView('door')">Search List</button>
        <button class="btn secondary" type="button" onclick="manualRefreshData()">Refresh Data</button>
      </div>

      <section class="mobile-manager-card">
        <details id="mobileCreateGroupDetails" class="mobile-manager-details">
          <summary>
            <div>
              <h2>Create Party / Group</h2>
              <p>Create a new list from your phone.</p>
            </div>
            <strong>⌄</strong>
          </summary>

          <div class="mobile-manager-form" style="margin-top:14px;">
            <div>
              <label>Party / Group Name</label>
              <input id="mobileGroupName" placeholder="Example: Smith Party" autocomplete="off" autocapitalize="words" />
            </div>

            <div>
              <label>Type</label>
              <select id="mobileGroupType">
                ${groupTypes.map(type => `<option>${esc(type)}</option>`).join("")}
              </select>
            </div>

            <div>
              <label>Host Name</label>
              <input id="mobileGroupHost" placeholder="Optional" autocomplete="off" autocapitalize="words" />
            </div>

            <div>
              <label>Booth / Location</label>
              <select id="mobileGroupLocation">
                <option value="">Select booth/location</option>
                ${boothOptions.map(booth => `<option value="${esc(booth)}">${esc(booth)}</option>`).join("")}
              </select>
            </div>

            <div>
              <label>Approved By</label>
              <input id="mobileGroupApprovedBy" value="${esc(currentUser()?.name || "Management")}" autocomplete="off" autocapitalize="words" />
            </div>

            <div>
              <label>Notes</label>
              <textarea id="mobileGroupNotes" placeholder="Optional notes"></textarea>
            </div>

            <button class="btn mobile-manager-primary-btn" type="button" onclick="mobileQuickCreateGroup()">Create Party / Group</button>
          </div>
        </details>
      </section>

      <section class="mobile-manager-card">
        <details class="mobile-manager-details">
          <summary>
            <div class="mobile-manager-inline-title">
              <span>📝</span>
              <div>
                <h2>Shift Notes</h2>
                <p>Visible to door staff</p>
              </div>
            </div>
            <strong>⌄</strong>
          </summary>

          <div class="mobile-manager-note-box">
            <strong>${latestNote ? esc(latestNote.category || "Tonight") : "Tonight"}:</strong>
            <p>${latestNote ? esc(latestNote.note_text || "") : "No shift notes have been added yet."}</p>
            <button class="btn secondary" type="button" onclick="${latestNote ? `openEditShiftNote('${latestNote.id}')` : `alert('No shift notes have been added yet. Use the full manager screen on tablet/desktop to create the first note.')`}">Edit Shift Notes</button>
          </div>
        </details>
      </section>

      <section class="mobile-manager-card">
        <div class="mobile-manager-inline-title">
          <span>👥</span>
          <div>
            <h2>Today's Lists</h2>
            <p>Quick view of active lists and counts.</p>
          </div>
        </div>

        <div class="mobile-manager-list-stack">
          ${listRows.map(row => `
            <button class="mobile-manager-list-row" type="button" onclick="${row.id === "general" ? "setMode('GENERAL')" : `selectGroup('${row.id}')`}">
              <span>${esc(row.name)}</span>
              <strong>${row.count}</strong>
            </button>
          `).join("")}
        </div>
      </section>

      <section class="mobile-manager-card">
        <div class="mobile-manager-inline-title">
          <span>⚠️</span>
          <div>
            <h2>Recent Manager Adds</h2>
            <p>Quick audit trail for the door.</p>
          </div>
        </div>

        <div class="mobile-manager-recent-stack">
          ${recentAdds.length ? recentAdds.map(guest => `
            <div class="mobile-manager-recent-row">
              <div class="mobile-manager-recent-top">
                <strong>${esc(guest.first_name)} ${esc(guest.last_name)}${guestTotal(guest) > 1 ? ` +${guestTotal(guest) - 1}` : ""}</strong>
                <span>${isLateAdd(guest) ? "Late Add" : "Added"}</span>
              </div>
              <p>${esc(groupNameForGuest(guest))} • Approved by ${esc(guest.late_add_approved_by || guest.added_by_name || "Manager")}</p>
            </div>
          `).join("") : `<div class="mobile-manager-empty-state">No manager additions yet.</div>`}
        </div>
      </section>

      <section class="mobile-manager-card">
        <details class="mobile-manager-details">
          <summary>
            <div>
              <h2>Advanced Management</h2>
              <p>Bulk tools, reports, and cleanup.</p>
            </div>
            <strong>⌄</strong>
          </summary>

          <div class="mobile-manager-advanced-grid">
            <button class="btn secondary" type="button" onclick="scrollToMobileCreateGroup()">Create Party / Group</button>
            <button class="btn secondary" type="button" onclick="openGuestModal()">Full Add Guest Form</button>
            <button class="btn secondary" type="button" onclick="openBulkPasteModal()">Bulk Paste Names</button>
            <button class="btn secondary" type="button" onclick="previewCloseOutReport()">Close Out Report</button>
            <button class="btn danger" type="button" onclick="clearGeneralGuestList()">Clear General Guest List</button>
          </div>
        </details>
      </section>

      ${renderMobileSyncFooter()}
    </div>
  `;
}

async function updateGuest(event) {
  event.preventDefault();
  if (!requirePerm("manage")) return;

  const guest = state.guests.find(item => item.id === state.editingGuestId);
  if (!guest) return;

  const form = new FormData(event.target);
  const totalAllowed = Math.max(1, Number(form.get("total_allowed") || 1));

  const isLateAddEntry = form.get("is_late_add") === "on";

  const payload = {
    first_name:String(form.get("first_name") || "").trim(),
    last_name:String(form.get("last_name") || "").trim(),
    guest_type:String(form.get("guest_type") || "Guest"),
    total_allowed:totalAllowed,
    checked_in_count:Math.min(guestChecked(guest), totalAllowed),
    notes:String(form.get("notes") || "").trim(),
    is_late_add:isLateAddEntry,
    late_add_approved_by:isLateAddEntry ? String(form.get("late_add_approved_by") || "").trim() : null,
    late_add_reason:isLateAddEntry ? String(form.get("late_add_reason") || "").trim() : null
  };

  if (!payload.first_name || !payload.last_name) {
    alert("First and last name are required.");
    return;
  }

  if (payload.is_late_add && !payload.late_add_approved_by) {
    alert("Late-add entries require an Approved By name.");
    return;
  }

  if (!confirmDuplicateSingle(payload.first_name, payload.last_name, guest.id)) return;

  await runDb("Update guest", async () => {
    const result = await db.from("guests").update(payload).eq("id", guest.id);
    must(result.data, result.error);

    state.modal = null;
    state.editingGuestId = null;

    await loadDataForDate(state.activeDate);
  });
}

async function deleteGuest(id) {
  if (!requirePerm("manage")) return;
  if (!confirm("Delete this name from the list?")) return;

  await runDb("Delete guest", async () => {
    const result = await db.from("guests").delete().eq("id", id);
    must(result.data, result.error);
    await loadDataForDate(state.activeDate);
  });
}

async function clearGeneralGuestList() {
  if (!requirePerm("manage")) return;

  const group = generalGroup();

  if (!group) {
    alert("No General Guest List found for this date.");
    return;
  }

  const count = guestsForGroup(group.id).length;

  if (!count) {
    alert("The General Guest List is already empty for this date.");
    return;
  }

  if (!confirm(`Clear ${count} name${count === 1 ? "" : "s"} from the General Guest List for ${state.activeDate}?\n\nBottle service and party/group names will NOT be deleted.`)) return;

  await runDb("Clear General Guest List", async () => {
    const result = await db.from("guests").delete().eq("group_id", group.id);
    must(result.data, result.error);

    state.importMessage = `Cleared ${count} name${count === 1 ? "" : "s"} from General Guest List.`;

    await loadDataForDate(state.activeDate);
  });
}

async function clearGroupNames(id) {
  if (!requirePerm("manage")) return;

  const group = state.groups.find(item => item.id === id);

  if (!group) {
    alert("Group not found.");
    return;
  }

  if (group.name === "General Guest List" || group.group_type === "General Guest List") {
    await clearGeneralGuestList();
    return;
  }

  const count = guestsForGroup(group.id).length;

  if (!count) {
    alert(`"${group.name}" already has no names.`);
    return;
  }

  if (!confirm(`Clear ${count} name${count === 1 ? "" : "s"} from "${group.name}"?\n\nThis will keep the party/group itself, but remove every name under it. This cannot be undone.`)) return;

  await runDb("Clear group names", async () => {
    const result = await db.from("guests").delete().eq("group_id", group.id);
    must(result.data, result.error);

    state.importMessage = `Cleared ${count} name${count === 1 ? "" : "s"} from ${group.name}.`;

    await loadDataForDate(state.activeDate);
  });
}

/* BULK AND EXCEL */

function parseBulkNames(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      let cleanLine = line.replace(/\t+/g, " ").trim();
      let parts = cleanLine.includes(" - ")
        ? cleanLine.split(" - ").map(part => part.trim())
        : cleanLine.includes(",")
          ? cleanLine.split(",").map(part => part.trim())
          : [cleanLine];

      let namePart = parts[0] || "";
      let guest_type = parts[1] || "Guest";
      let notes = parts.slice(2).join(" - ");
      let total_allowed = 1;

      const plusMatch = namePart.match(/\s\+(\d+)\s*$/);
      if (plusMatch) {
        total_allowed = 1 + Number(plusMatch[1] || 0);
        namePart = namePart.replace(/\s\+\d+\s*$/, "").trim();
      }

      const namePieces = namePart.split(/\s+/).filter(Boolean);
      let first_name = "";
      let last_name = "";

      if (namePieces.length === 1) {
        first_name = namePieces[0];
      } else {
        first_name = namePieces.slice(0, -1).join(" ");
        last_name = namePieces[namePieces.length - 1];
      }

      return { first_name, last_name, guest_type, notes, total_allowed };
    });
}

async function bulkAddNames(event) {
  event.preventDefault();
  if (!requirePerm("manage")) return;

  const form = new FormData(event.target);
  const target = String(form.get("target") || "general");

  let group = null;

  if (target === "general") {
    group = await getGeneralGroupForActiveDate();
  } else if (target === "selected") {
    group = selectedGroup();
  } else if (target.startsWith("group:")) {
    const groupId = target.replace("group:", "");
    group = state.groups.find(item => item.id === groupId) || null;
  }

  const defaultType = String(form.get("defaultType") || "Guest");
  const bulkText = String(form.get("bulkNames") || "").trim();

  if (!bulkText) {
    alert("Paste at least one name first.");
    return;
  }

  if (!group) {
    alert("Select or create a group first.");
    return;
  }

  const rows = parseBulkNames(bulkText)
    .filter(item => item.first_name && item.last_name)
    .map(item => ({
      group_id:group.id,
      first_name:item.first_name,
      last_name:item.last_name,
      guest_type:item.guest_type && item.guest_type !== "Guest" ? item.guest_type : defaultType,
      total_allowed:Math.max(1, Number(item.total_allowed || 1)),
      checked_in_count:0,
      notes:item.notes || "",
      added_by_name:currentUser()?.name || "Unknown",
      added_by_user_id:auth.session?.user?.id || null,
      added_at:new Date().toISOString(),
      is_late_add:false,
      late_add_approved_by:null,
      late_add_reason:null
    }));

  if (!rows.length) {
    alert("No valid names found.");
    return;
  }

  if (!confirmDuplicateRows(rows, "Bulk paste")) return;

  await runDb("Bulk add names", async () => {
    const result = await db.from("guests").insert(rows);
    must(result.data, result.error);

    state.selectedGroupId = group.id;
    state.currentMode = target === "general" ? "GENERAL" : "GROUP";
    state.importMessage = `Bulk added ${rows.length} name${rows.length === 1 ? "" : "s"} into ${group.name}.`;
    state.modal = null;

    await loadDataForDate(state.activeDate);
  });
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readField(row, names) {
  const normalized = {};
  Object.keys(row).forEach(key => normalized[normalizeHeader(key)] = row[key]);

  for (const name of names) {
    const value = normalized[normalizeHeader(name)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function splitFullName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name:"", last_name:"" };
  if (parts.length === 1) return { first_name:parts[0], last_name:"" };
  return { first_name:parts.slice(0,-1).join(" "), last_name:parts[parts.length - 1] };
}

function rowToGuest(row, groupId) {
  let first_name = readField(row, ["First Name", "First", "FName"]);
  let last_name = readField(row, ["Last Name", "Last", "LName", "Surname"]);
  const full = readField(row, ["Name", "Full Name", "Guest Name", "Attendee Name"]);

  if ((!first_name || !last_name) && full) {
    const split = splitFullName(full);
    first_name = first_name || split.first_name;
    last_name = last_name || split.last_name;
  }

  const partySize = readField(row, ["Party Size", "Total Guests", "Total", "Group Size"]);
  const plus = readField(row, ["Plus Count", "Plus", "Plus One", "+"]);

  const total_allowed = partySize
    ? Math.max(1, Number(partySize) || 1)
    : Math.max(1, 1 + (Number(plus) || 0));

  return {
    group_id:groupId,
    first_name,
    last_name,
    guest_type:readField(row, ["Guest Type", "Attendee Type", "Type", "Category"]) || "Guest",
    total_allowed,
    checked_in_count:0,
    notes:readField(row, ["Notes", "Note", "Comments", "Details"]),
    added_by_name:currentUser()?.name || "Unknown",
    added_by_user_id:auth.session?.user?.id || null,
    added_at:new Date().toISOString(),
    is_late_add:false,
    late_add_approved_by:null,
    late_add_reason:null
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i+1];

    if (char === '"' && quote && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quote = !quote;
    } else if (char === "," && !quote) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quote) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift() || [];

  return rows
    .filter(row => row.some(cell => String(cell || "").trim() !== ""))
    .map(row => {
      const object = {};
      headers.forEach((header, index) => object[header] = row[index] || "");
      return object;
    });
}

async function importRows(rows, targetMode) {
  if (!requirePerm("manage")) return;

  let group = null;

  if (targetMode === "general") {
    try {
      group = await getGeneralGroupForActiveDate();
    } catch (error) {
      state.importMessage = error?.message || "DoorFlow could not find the General Guest List for this date.";
      render();
      return;
    }
  } else if (targetMode === "selected") {
    group = selectedGroup();
  } else if (targetMode.startsWith("group:")) {
    const groupId = targetMode.replace("group:", "");
    group = state.groups.find(item => item.id === groupId) || null;
  }

  if (!group) {
    state.importMessage = targetMode === "general" ? "DoorFlow could not find the General Guest List for this date. Tap Refresh Data and try again." : "Select or create a group first.";
    render();
    return;
  }

  const valid = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const guest = rowToGuest(row, group.id);

    if (!guest.first_name || !guest.last_name) {
      skipped.push(index + 2);
      return;
    }

    valid.push(guest);
  });

  if (!valid.length) {
    state.importMessage = "No valid names found.";
    render();
    return;
  }

  if (!confirmDuplicateRows(valid, "Excel/CSV import")) return;

  await runDb("Import file", async () => {
    const result = await db.from("guests").insert(valid);
    must(result.data, result.error);

    state.selectedGroupId = group.id;
    state.importMessage = `Imported ${valid.length} name${valid.length === 1 ? "" : "s"} into ${group.name}. ${skipped.length ? `Skipped ${skipped.length} row${skipped.length === 1 ? "" : "s"}.` : ""}`;

    await loadDataForDate(state.activeDate);
  });
}

function handleFileUpload(event) {
  if (!requirePerm("manage")) return;

  const targetMode = document.getElementById("uploadTarget")?.value || "general";
  const file = event.target.files && event.target.files[0];

  if (!file) return;

  const extension = file.name.split(".").pop().toLowerCase();
  const reader = new FileReader();

  reader.onerror = () => {
    state.importMessage = "The file could not be read.";
    render();
  };

  reader.onload = async loadEvent => {
    try {
      let rows = [];

      if (extension === "csv") {
        rows = parseCsv(String(loadEvent.target.result || ""));
      } else {
        const workbook = XLSX.read(loadEvent.target.result, { type:"array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { defval:"" });
      }

      await importRows(rows, targetMode);
      event.target.value = "";
    } catch (error) {
      console.error(error);
      state.importMessage = "Import failed. First row should include First Name / Last Name, or Full Name.";
      render();
    }
  };

  if (extension === "csv") reader.readAsText(file);
  else reader.readAsArrayBuffer(file);
}

function exportCsv() {
  if (!requirePerm("reports")) return;

  const rows = [
    ["Date","Day","Group","Group Type","Host","Table","First Name","Last Name","Guest Type","Total Allowed","Checked In Count","Remaining","Fully Checked In","Late Add","Approved By","Late Add Reason","Added By","Added At","Checked In At","Checked In By","Door","Notes"],
    ...state.guests.map(guest => {
      const group = state.groups.find(item => item.id === guest.group_id);

      return [
        state.activeDate,
        state.activeDay,
        group?.name || "",
        group?.group_type || "",
        group?.host_name || "",
        group?.table_location || "",
        guest.first_name,
        guest.last_name,
        guest.guest_type,
        guestTotal(guest),
        guestChecked(guest),
        guestRemaining(guest),
        isGuestFullyIn(guest) ? "Yes" : "No",
        isLateAdd(guest) ? "Yes" : "No",
        guest.late_add_approved_by || "",
        guest.late_add_reason || "",
        guest.added_by_name || "",
        guest.added_at || "",
        guest.last_checked_in_at || "",
        guest.last_checked_in_by_name || "",
        guest.last_door_location || "",
        guest.notes || ""
      ];
    })
  ];

  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `doorflow_${state.activeDate}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}



/* MANAGER / SHIFT NOTES */

const noteCategories = [
  "General Note",
  "Cover / Pricing",
  "VIP / Bottle Service",
  "Staffing",
  "Security Concern",
  "Do Not Admit / Watch",
  "Maintenance / Facility",
  "End of Night"
];

const notePriorities = [
  "Normal",
  "Important",
  "Urgent"
];

function notePriorityClass(priority) {
  const value = String(priority || "").toLowerCase();
  if (value.includes("urgent")) return "blocked";
  if (value.includes("important")) return "remaining";
  return "general";
}

function noteCategoryClass(category) {
  const value = String(category || "").toLowerCase();
  if (value.includes("vip") || value.includes("bottle")) return "vip";
  if (value.includes("security") || value.includes("watch") || value.includes("do not")) return "blocked";
  if (value.includes("cover") || value.includes("pricing")) return "remaining";
  if (value.includes("end")) return "in";
  return "general";
}

function noteTime(note) {
  try {
    return new Date(note.created_at).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
  } catch {
    return note.created_at || "";
  }
}

async function createShiftNote(event) {
  event.preventDefault();
  if (!requirePerm("manage")) return;

  if (!state.serviceDay?.id) {
    alert("Service day is not loaded yet.");
    return;
  }

  const form = new FormData(event.target);

  const payload = {
    service_day_id:state.serviceDay.id,
    category:String(form.get("category") || "General Note"),
    priority:String(form.get("priority") || "Normal"),
    note_text:String(form.get("note_text") || "").trim(),
    created_by_name:currentUser()?.name || "Unknown",
    created_by_user_id:auth.session?.user?.id || null
  };

  if (!payload.note_text) {
    alert("Type a note before saving.");
    return;
  }

  await runDb("Create shift note", async () => {
    const result = await db.from("shift_notes").insert(payload);
    must(result.data, result.error);

    event.target.reset();
    state.importMessage = "Shift note added.";
    await loadDataForDate(state.activeDate);
  });
}

function openEditShiftNote(id) {
  if (!requirePerm("manage")) return;
  state.editingShiftNoteId = id;
  state.modal = "shiftNote";
  render();
}

async function updateShiftNote(event) {
  event.preventDefault();
  if (!requirePerm("manage")) return;

  const note = (state.shiftNotes || []).find(item => item.id === state.editingShiftNoteId);

  if (!note) {
    alert("Shift note not found.");
    return;
  }

  const form = new FormData(event.target);

  const payload = {
    category:String(form.get("category") || "General Note"),
    priority:String(form.get("priority") || "Normal"),
    note_text:String(form.get("note_text") || "").trim()
  };

  if (!payload.note_text) {
    alert("Type a note before saving.");
    return;
  }

  await runDb("Update shift note", async () => {
    const result = await db.from("shift_notes").update(payload).eq("id", note.id);
    must(result.data, result.error);

    state.editingShiftNoteId = null;
    state.modal = null;
    state.importMessage = "Shift note updated.";
    await loadDataForDate(state.activeDate);
  });
}

async function deleteShiftNote(id) {
  if (!requirePerm("manage")) return;

  if (!confirm("Delete this shift note?")) return;

  await runDb("Delete shift note", async () => {
    const result = await db.from("shift_notes").delete().eq("id", id);
    must(result.data, result.error);

    state.importMessage = "Shift note deleted.";
    await loadDataForDate(state.activeDate);
  });
}

function renderShiftNotesPanel(showComposer = true) {
  const notes = state.shiftNotes || [];

  return `
    <div class="card">
      <h2>Manager / Shift Notes</h2>
      <p class="subtle">Use this for live notes that door staff and managers need for the night. Examples: cover charge, VIP instructions, problem guests, staffing notes, and end-of-night notes.</p>

      ${showComposer && perms()?.manage ? `
        <form onsubmit="createShiftNote(event)" class="form" style="margin-bottom:16px;">
          <div class="two">
            <div>
              <label>Category</label>
              <select name="category">
                ${noteCategories.map(item => `<option>${esc(item)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label>Priority</label>
              <select name="priority">
                ${notePriorities.map(item => `<option>${esc(item)}</option>`).join("")}
              </select>
            </div>
          </div>

          <div>
            <label>Note</label>
            <textarea name="note_text" rows="4" placeholder="Example: VIP table arriving around 10:30 PM. Approved by manager."></textarea>
          </div>

          <div class="row-actions">
            <button class="btn" type="submit">Add Shift Note</button>
          </div>
        </form>
      ` : ""}

      ${notes.length ? `
        <div class="shift-note-list">
          ${notes.map(note => `
            <div class="shift-note-card">
              <div class="party-meta">
                <span class="badge ${noteCategoryClass(note.category)}">${esc(note.category || "General Note")}</span>
                <span class="badge ${notePriorityClass(note.priority)}">${esc(note.priority || "Normal")}</span>
                <span class="badge general">${esc(noteTime(note))}</span>
                <span class="badge general">By ${esc(note.created_by_name || "Unknown")}</span>
              </div>

              <p class="shift-note-text">${esc(note.note_text || "")}</p>

              ${perms()?.manage ? `
                <div class="row-actions">
                  <button class="btn secondary small" onclick="openEditShiftNote('${note.id}')">Edit Note</button>
                  <button class="btn danger small" onclick="deleteShiftNote('${note.id}')">Delete Note</button>
                </div>
              ` : ""}
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="notice warn">No manager or shift notes have been added for this date yet.</div>
      `}
    </div>
  `;
}



function renderShiftNotesForDoorStaff() {
  const notes = state.shiftNotes || [];

  if (!notes.length) {
    return `
      <div class="card">
        <h2>Manager / Shift Notes</h2>
        <p class="subtle" style="margin:0;">No manager or shift notes have been added for this date yet.</p>
      </div>
    `;
  }

  return `
    <div class="card">
      <h2>Manager / Shift Notes</h2>
      <p class="subtle">Read these before working the door. These are live instructions from management for the active service day.</p>

      <div class="row-actions" style="margin-bottom:12px;">
        <button class="btn secondary small" onclick="loadDataForDate(state.activeDate)">Refresh Notes</button>
      </div>

      <div class="shift-note-list">
        ${notes.map(note => `
          <div class="shift-note-card">
            <div class="party-meta">
              <span class="badge ${noteCategoryClass(note.category)}">${esc(note.category || "General Note")}</span>
              <span class="badge ${notePriorityClass(note.priority)}">${esc(note.priority || "Normal")}</span>
              <span class="badge general">${esc(noteTime(note))}</span>
              <span class="badge general">By ${esc(note.created_by_name || "Unknown")}</span>
            </div>

            <p class="shift-note-text">${esc(note.note_text || "")}</p>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}


/* CLOSE OUT NIGHT */

function buildCloseOutReportData() {
  const stats = dayStats();

  const groupSummaries = state.groups.map(group => {
    const groupStat = groupStats(group.id);
    const guests = guestsForGroup(group.id);

    return {
      group_id:group.id,
      group_name:group.name,
      group_type:group.group_type,
      host_name:group.host_name || "",
      table_location:group.table_location || "",
      total_allowed:groupStat.total,
      checked_in:groupStat.checked,
      remaining:groupStat.remaining,
      guests:guests.map(guest => ({
        first_name:guest.first_name,
        last_name:guest.last_name,
        guest_type:guest.guest_type,
        total_allowed:guestTotal(guest),
        checked_in_count:guestChecked(guest),
        remaining:guestRemaining(guest),
        fully_checked_in:isGuestFullyIn(guest),
        last_checked_in_at:guest.last_checked_in_at || "",
        last_checked_in_by_name:guest.last_checked_in_by_name || "",
        last_door_location:guest.last_door_location || "",
        is_late_add:isLateAdd(guest),
        late_add_approved_by:guest.late_add_approved_by || "",
        late_add_reason:guest.late_add_reason || "",
        added_by_name:guest.added_by_name || "",
        added_at:guest.added_at || "",
        notes:guest.notes || ""
      }))
    };
  });

  const noShows = state.guests
    .filter(guest => guestRemaining(guest) > 0)
    .map(guest => ({
      first_name:guest.first_name,
      last_name:guest.last_name,
      group_name:groupNameForGuest(guest),
      guest_type:guest.guest_type,
      total_allowed:guestTotal(guest),
      checked_in_count:guestChecked(guest),
      remaining:guestRemaining(guest),
      notes:guest.notes || ""
    }));

  const activityLogs = state.logs.map(log => ({
    time:log.created_at,
    action:log.action,
    amount:log.amount,
    guest_name:guestNameFromLog(log),
    group_name:groupNameFromLog(log),
    staff_name:log.staff_name || "",
    door_location:log.door_location || ""
  }));

  return {
    venue:state.venue?.name || "EVE",
    service_date:state.activeDate,
    day_name:state.activeDay,
    generated_at:new Date().toISOString(),
    generated_by:currentUser()?.name || "Unknown",
    summary:{
      groups:stats.groups,
      complete_groups:stats.completeGroups,
      total_allowed:stats.total,
      checked_in:stats.checked,
      remaining:stats.remaining,
      no_show_records:noShows.length
    },
    groups:groupSummaries,
    late_adds:state.guests.filter(guest => isLateAdd(guest)).map(guest => ({
      first_name:guest.first_name,
      last_name:guest.last_name,
      group_name:groupNameForGuest(guest),
      guest_type:guest.guest_type,
      approved_by:guest.late_add_approved_by || "",
      reason:guest.late_add_reason || "",
      added_by:guest.added_by_name || "",
      added_at:guest.added_at || ""
    })),
    no_shows:noShows,
    shift_notes:(state.shiftNotes || []).map(note => ({
      category:note.category,
      priority:note.priority,
      note_text:note.note_text,
      created_by_name:note.created_by_name,
      created_at:note.created_at
    })),
    activity_logs:activityLogs
  };
}

function buildCloseOutReportHtml(report) {
  const groupRows = report.groups.map(group => `
    <tr>
      <td>${esc(group.group_name)}</td>
      <td>${esc(group.group_type)}</td>
      <td>${esc(group.host_name || "")}</td>
      <td>${esc(group.table_location || "")}</td>
      <td>${group.total_allowed}</td>
      <td>${group.checked_in}</td>
      <td>${group.remaining}</td>
    </tr>
  `).join("");

  const noShowRows = report.no_shows.length
    ? report.no_shows.map(guest => `
      <tr>
        <td>${esc(guest.first_name)} ${esc(guest.last_name)}</td>
        <td>${esc(guest.group_name)}</td>
        <td>${esc(guest.guest_type)}</td>
        <td>${guest.checked_in_count}/${guest.total_allowed}</td>
        <td>${guest.remaining}</td>
        <td>${esc(guest.notes || "")}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6">No no-shows / remaining guests.</td></tr>`;

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <h2 style="margin-bottom:4px;">DoorFlow Close Out Report</h2>
      <p style="margin-top:0;color:#6b7280;">${esc(report.venue)} · ${esc(report.day_name)} · ${esc(report.service_date)}</p>

      <h3>Summary</h3>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:760px;">
        <tr><td><strong>Total Allowed</strong></td><td>${report.summary.total_allowed}</td></tr>
        <tr><td><strong>Checked In</strong></td><td>${report.summary.checked_in}</td></tr>
        <tr><td><strong>Still Remaining / No-Show Count</strong></td><td>${report.summary.remaining}</td></tr>
        <tr><td><strong>Groups</strong></td><td>${report.summary.groups}</td></tr>
        <tr><td><strong>Complete Groups</strong></td><td>${report.summary.complete_groups}</td></tr>
        <tr><td><strong>Generated By</strong></td><td>${esc(report.generated_by)}</td></tr>
        <tr><td><strong>Generated At</strong></td><td>${new Date(report.generated_at).toLocaleString()}</td></tr>
      </table>

      <h3>Group Breakdown</h3>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;">
        <thead>
          <tr style="background:#f9fafb;">
            <th align="left">Group</th>
            <th align="left">Type</th>
            <th align="left">Host</th>
            <th align="left">Table</th>
            <th align="left">Allowed</th>
            <th align="left">Checked In</th>
            <th align="left">Remaining</th>
          </tr>
        </thead>
        <tbody>${groupRows}</tbody>
      </table>

      <h3>No-Shows / Remaining Guests</h3>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;">
        <thead>
          <tr style="background:#f9fafb;">
            <th align="left">Guest</th>
            <th align="left">Group</th>
            <th align="left">Type</th>
            <th align="left">Checked In</th>
            <th align="left">Remaining</th>
            <th align="left">Notes</th>
          </tr>
        </thead>
        <tbody>${noShowRows}</tbody>
      </table>

      <p style="color:#6b7280;font-size:12px;margin-top:24px;">
        Sent automatically from DoorFlow Close Out Night.
      </p>
    </div>
  `;
}

function downloadCloseOutJson(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type:"application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `doorflow_closeout_${state.activeDate}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function closeOutNight() {
  previewCloseOutReport();
}

function previewCloseOutReport() {
  if (!requirePerm("reports")) return;

  state.modal = "closeoutReport";
  render();
}

function printCloseOutReport() {
  window.print();
}

function downloadCloseOutReportCsv() {
  if (!requirePerm("reports")) return;

  const report = buildCloseOutReportData();

  const rows = [
    ["Section","Group","Guest","Guest Type","Total Allowed","Checked In","Remaining","Late Add","Approved By","Reason/Notes","Added By","Added At"],
    ...report.groups.flatMap(group => group.guests.map(guest => [
      "Guest",
      group.group_name,
      `${guest.first_name} ${guest.last_name}`,
      guest.guest_type,
      guest.total_allowed,
      guest.checked_in_count,
      guest.remaining,
      guest.is_late_add ? "Yes" : "No",
      guest.late_add_approved_by || "",
      guest.late_add_reason || guest.notes || "",
      guest.added_by_name || "",
      guest.added_at || ""
    ])),
    ...report.shift_notes.map(note => [
      "Shift Note",
      "",
      "",
      note.category,
      "",
      "",
      "",
      "",
      "",
      note.note_text,
      note.created_by_name,
      note.created_at
    ])
  ];

  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `doorflow_closeout_report_${state.activeDate}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function renderCloseOutReportModal() {
  const report = buildCloseOutReportData();
  const lateAdds = report.late_adds || [];
  const noShows = report.no_shows || [];
  const shiftNotes = report.shift_notes || [];
  const activityLogs = report.activity_logs || [];

  return `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:1100px;">
        <div class="closeout-print-header">
          <div>
            <h2>DoorFlow Close Out Report</h2>
            <p class="subtle" style="margin:0;">${esc(report.venue)} · ${esc(report.day_name)} · ${esc(report.service_date)}</p>
            <p class="subtle" style="margin:4px 0 0;">Generated by ${esc(report.generated_by)} · ${new Date(report.generated_at).toLocaleString()}</p>
          </div>

          <div class="row-actions">
            <button class="btn secondary" onclick="downloadCloseOutReportCsv()">Export Report CSV</button>
            <button class="btn secondary" onclick="printCloseOutReport()">Print</button>
            <button class="btn" onclick="closeModal()">Close</button>
          </div>
        </div>

        <div class="closeout-summary-grid">
          <div class="stat"><span>Total Allowed</span><strong>${report.summary.total_allowed}</strong></div>
          <div class="stat"><span>Checked In</span><strong>${report.summary.checked_in}</strong></div>
          <div class="stat"><span>Remaining / No-Shows</span><strong>${report.summary.remaining}</strong></div>
          <div class="stat"><span>Late Adds</span><strong>${lateAdds.length}</strong></div>
        </div>

        <div class="closeout-report-section">
          <h3>Group Breakdown</h3>
          <table class="closeout-report-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Type</th>
                <th>Host</th>
                <th>Table</th>
                <th>Allowed</th>
                <th>Checked In</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              ${report.groups.map(group => `
                <tr>
                  <td>${esc(group.group_name)}</td>
                  <td>${esc(group.group_type)}</td>
                  <td>${esc(group.host_name || "")}</td>
                  <td>${esc(group.table_location || "")}</td>
                  <td>${group.total_allowed}</td>
                  <td>${group.checked_in}</td>
                  <td>${group.remaining}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        <div class="closeout-report-section">
          <h3>Late Adds</h3>
          <table class="closeout-report-table">
            <thead>
              <tr>
                <th>Guest</th>
                <th>Group</th>
                <th>Type</th>
                <th>Approved By</th>
                <th>Reason</th>
                <th>Added By</th>
                <th>Added At</th>
              </tr>
            </thead>
            <tbody>
              ${lateAdds.length ? lateAdds.map(guest => `
                <tr>
                  <td>${esc(guest.first_name)} ${esc(guest.last_name)}</td>
                  <td>${esc(guest.group_name)}</td>
                  <td>${esc(guest.guest_type)}</td>
                  <td>${esc(guest.approved_by || "")}</td>
                  <td>${esc(guest.reason || "")}</td>
                  <td>${esc(guest.added_by || "")}</td>
                  <td>${guest.added_at ? esc(new Date(guest.added_at).toLocaleString()) : ""}</td>
                </tr>
              `).join("") : `<tr><td colspan="7">No late adds recorded.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="closeout-report-section">
          <h3>No-Shows / Remaining Guests</h3>
          <table class="closeout-report-table">
            <thead>
              <tr>
                <th>Guest</th>
                <th>Group</th>
                <th>Type</th>
                <th>Checked In</th>
                <th>Remaining</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${noShows.length ? noShows.map(guest => `
                <tr>
                  <td>${esc(guest.first_name)} ${esc(guest.last_name)}</td>
                  <td>${esc(guest.group_name)}</td>
                  <td>${esc(guest.guest_type)}</td>
                  <td>${guest.checked_in_count}/${guest.total_allowed}</td>
                  <td>${guest.remaining}</td>
                  <td>${esc(guest.notes || "")}</td>
                </tr>
              `).join("") : `<tr><td colspan="6">No no-shows / remaining guests.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="closeout-report-section">
          <h3>Manager / Shift Notes</h3>
          <table class="closeout-report-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Priority</th>
                <th>Note</th>
                <th>By</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              ${shiftNotes.length ? shiftNotes.map(note => `
                <tr>
                  <td>${esc(note.category || "")}</td>
                  <td>${esc(note.priority || "")}</td>
                  <td>${esc(note.note_text || "")}</td>
                  <td>${esc(note.created_by_name || "")}</td>
                  <td>${note.created_at ? esc(new Date(note.created_at).toLocaleString()) : ""}</td>
                </tr>
              `).join("") : `<tr><td colspan="5">No shift notes recorded.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="closeout-report-section">
          <h3>Recent Door Activity</h3>
          <table class="closeout-report-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Guest</th>
                <th>Group</th>
                <th>Staff</th>
                <th>Door</th>
              </tr>
            </thead>
            <tbody>
              ${activityLogs.length ? activityLogs.slice(0,60).map(log => `
                <tr>
                  <td>${log.time ? esc(new Date(log.time).toLocaleString()) : ""}</td>
                  <td>${esc(log.action || "")}</td>
                  <td>${esc(log.guest_name || "")}</td>
                  <td>${esc(log.group_name || "")}</td>
                  <td>${esc(log.staff_name || "")}</td>
                  <td>${esc(log.door_location || "")}</td>
                </tr>
              `).join("") : `<tr><td colspan="6">No recent activity logs recorded.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}


/* MODAL OPENERS */

function openGroupModal(id = null) {
  if (!requirePerm("manage")) return;
  state.editingGroupId = id;
  state.modal = "group";
  render();
}

function openGuestModal(id = null) {
  if (!requirePerm("manage")) return;
  state.editingGuestId = id;
  state.modal = "guest";
  render();
}

function openBulkPasteModal() {
  if (!requirePerm("manage")) return;
  state.modal = "bulk";
  render();
}

function closeModal() {
  state.modal = null;
  state.editingGroupId = null;
  state.editingGuestId = null;
  state.editingShiftNoteId = null;
  render();

  if (auth.currentUser && state.pendingSync) {
    setTimeout(() => flushPendingSync("modal-close"), 150);
  }
}

/* RENDER */

function renderLogin() {
  return `
    <div class="auth">
      <div class="card">
        <div class="brand" style="margin-bottom:18px;">
          <div class="logo">DF</div>
          <div>
            <h1>DoorFlow Login</h1>
            <p>Supabase email/password account</p>
          </div>
        </div>

        <div class="notice greenbox">
          <strong>Real account mode:</strong> sign in with the email/password account created in Supabase Authentication.
        </div>

        ${state.error ? `<div class="notice redbox"><strong>Error:</strong> ${esc(state.error)}</div>` : ""}

        <form onsubmit="login(event)" class="form">
          <div>
            <label>Email</label>
            <input name="email" type="email" autocomplete="email" placeholder="you@example.com" />
          </div>
          <div>
            <label>Password</label>
            <input name="password" type="password" autocomplete="current-password" />
          </div>
          <button class="btn" type="submit">Log In</button>
        </form>

        <div class="divider"></div>
        <p class="subtle" style="margin:0;">Staff access is controlled by the <strong>staff_profiles</strong> table in Supabase.</p>
      </div>
    </div>
  `;
}

function formatClock(value) {
  if (!value) return "not yet";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "not yet";
  return date.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
}

function syncClassName() {
  const status = String(state.syncStatus || "").toLowerCase();
  if (status.includes("offline") || status.includes("error")) return "bad";
  if (status.includes("polling") || status.includes("pending") || status.includes("reconnect") || status.includes("connecting")) return "warn";
  return "good";
}

function renderSyncPill() {
  const status = state.loading ? "Syncing" : (state.syncStatus || "Live");
  const last = formatClock(state.lastSyncAt);
  const title = state.syncMessage || "DoorFlow live sync";
  return `<span class="pill sync-pill ${syncClassName()}" title="${esc(title)}"><span class="sync-dot"></span>${esc(status)} · Updated ${esc(last)}</span>`;
}

function renderMobileSyncFooter() {
  const status = state.loading ? "Syncing" : (state.syncStatus || "Live");
  const last = formatClock(state.lastSyncAt);
  return `<div class="mobile-manager-sync-footer ${syncClassName()}"><span class="sync-dot"></span><span>${esc(status)} · Updated ${esc(last)}</span></div>`;
}

function renderTopbar() {
  const user = currentUser();

  return `
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="logo">DF</div>
          <div>
            <h1>DoorFlow</h1>
            <p>${esc(state.activeDay)} · ${esc(state.activeDate)} · Live Database</p>
          </div>
        </div>

        <div class="top-actions">
          ${renderSyncPill()}
          <button type="button" class="btn secondary small" onclick="manualRefreshData()">Refresh Data</button>
          <span class="pill">${esc(user.name)} · ${roleLabel(user.role)}</span>
          <button type="button" class="btn secondary small" onclick="logout()">Log Out</button>
        </div>
      </div>
    </header>
  `;
}

function renderTabs() {
  const p = perms();

  return `
    <div class="tabs">
      ${p.door ? `<button class="tab ${state.view === "door" ? "active" : ""}" onclick="switchView('door')">Door Check-In</button>` : ""}
      ${p.door ? `<button class="tab ${state.view === "tabletDoor" ? "active" : ""}" onclick="switchView('tabletDoor')">Tablet Door Mode</button>` : ""}
      ${p.manage ? `<button class="tab ${state.view === "manage" ? "active" : ""}" onclick="switchView('manage')">Management</button>` : ""}
      ${p.users ? `<button class="tab ${state.view === "users" ? "active" : ""}" onclick="switchView('users')">Staff</button>` : ""}
      ${p.reports ? `<button class="tab ${state.view === "reports" ? "active" : ""}" onclick="switchView('reports')">Reports</button>` : ""}
    </div>
  `;
}

function renderDateBar() {
  const group = selectedGroup();

  return `
    <div class="card tight">
      <div class="datebar">
        <div>
          <label>Day</label>
          <select onchange="setActiveDay(this.value)">
            ${days.map(day => `<option ${day === state.activeDay ? "selected" : ""}>${day}</option>`).join("")}
          </select>
        </div>

        <div>
          <label>Calendar Date</label>
          <input type="date" value="${esc(state.activeDate)}" onchange="setActiveDate(this.value)" />
        </div>

        <div>
          <label>Selected Party / Group</label>
          <select onchange="selectGroup(this.value)">
            ${specificGroups().length
              ? specificGroups().map(item => `<option value="${item.id}" ${item.id === group?.id ? "selected" : ""}>${esc(item.name)} — ${esc(item.host_name || item.group_type)}</option>`).join("")
              : `<option>No specific groups for this date</option>`
            }
          </select>
        </div>

        <div>
          <label>Door Location</label>
          <select onchange="state.doorLocation=this.value;render()">
            ${["Front Door","Rear Door","EVE Door","VIP Check-In"].map(option => `<option ${option === state.doorLocation ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>
  `;
}

function renderStats() {
  const stats = dayStats();

  return `
    <div class="stats">
      <div class="stat"><span>Groups</span><strong>${stats.groups}</strong></div>
      <div class="stat"><span>Complete Groups</span><strong>${stats.completeGroups}</strong></div>
      <div class="stat"><span>Total Allowed</span><strong>${stats.total}</strong></div>
      <div class="stat"><span>Checked In</span><strong>${stats.checked}</strong></div>
      <div class="stat"><span>Still Remaining</span><strong>${stats.remaining}</strong></div>
    </div>
  `;
}

function renderGroupList(showActions = false) {
  const stats = dayStats();

  const generalCard = `
    <div class="party-card ${state.currentMode === "GENERAL" ? "selected" : ""}" onclick="setMode('GENERAL')">
      <h3 class="party-title">General Guest List</h3>
      <div class="party-meta">
        <span class="badge general">Master List</span>
        <span class="badge in">${stats.checked} in</span>
        <span class="badge remaining">${stats.remaining} left</span>
      </div>
      <p class="subtle" style="margin:0;">Shows every name for this date, including bottle service and party attendees.</p>
    </div>
  `;

  const groups = visibleGroups();

  return `
    <div class="party-list">
      ${generalCard}

      ${!groups.length ? `<div class="notice warn">No bottle service or special party groups are scheduled for this date.</div>` : ""}

      ${groups.map(group => {
        const groupStat = groupStats(group.id);
        const complete = groupStat.total > 0 && groupStat.remaining === 0;
        const started = groupStat.checked > 0 && groupStat.remaining > 0;

        return `
          <div class="party-card ${state.currentMode === "GROUP" && group.id === selectedGroup()?.id ? "selected" : ""} ${complete ? "complete" : started ? "started" : ""}" onclick="selectGroup('${group.id}')">
            <h3 class="party-title">${esc(group.name)}</h3>
            <div class="party-meta">
              <span class="badge ${typeClass(group.group_type)}">${esc(group.group_type)}</span>
              <span class="badge general">Host: ${esc(group.host_name || "N/A")}</span>
              ${group.table_location ? `<span class="badge general">${esc(group.table_location)}</span>` : ""}
              <span class="badge in">${groupStat.checked} in</span>
              <span class="badge remaining">${groupStat.remaining} left</span>
            </div>
            <p class="subtle" style="margin:0;">${esc(group.notes || "No notes listed.")}</p>

            ${showActions ? `
              <div class="row-actions" style="margin-top:10px;">
                <button class="btn secondary small" onclick="event.stopPropagation(); openGroupModal('${group.id}')">Edit</button>
                <button class="btn danger small" onclick="event.stopPropagation(); clearGroupNames('${group.id}')">Clear Names</button>
                <button class="btn danger small" onclick="event.stopPropagation(); deleteGroup('${group.id}')">Delete</button>
              </div>
            ` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderGuestList(showActions = false) {
  const guests = visibleGuests();

  if (!guests.length) {
    return `<div class="notice warn">No names found for the selected view.</div>`;
  }

  return `
    <div class="guest-list">
      ${guests.map(guest => {
        const group = state.groups.find(item => item.id === guest.group_id);
        const total = guestTotal(guest);
        const checked = guestChecked(guest);
        const remaining = guestRemaining(guest);
        const fullyIn = isGuestFullyIn(guest);
        const showLast = checked > 0 && guest.last_checked_in_by_name;

        return `
          <div class="guest-row ${fullyIn ? "checked" : ""}">
            <button class="guest-check" onclick="toggleGuest('${guest.id}')">${fullyIn ? "✓" : checked > 0 ? checked : ""}</button>

            <div>
              <div class="name-line">
                <p class="guest-name">${esc(guest.first_name)} ${esc(guest.last_name)}</p>
                <span class="count-pill">${checked}/${total}</span>
                ${fullyIn ? `<span class="badge in">Fully In</span>` : remaining > 0 ? `<span class="badge remaining">${remaining} left</span>` : ""}
                ${lateAddBadge(guest)}
              </div>
              <p class="guest-detail">
                ${esc(guest.guest_type)}
                ${group ? ` · ${esc(group.name)}` : ""}
                ${guest.notes ? ` · ${esc(guest.notes)}` : ""}
              </p>
              ${isLateAdd(guest) ? `<p class="late-add-detail">${esc(lateAddMetaText(guest))}</p>` : ""}
              ${showLast ? `<p class="guest-detail">Last check-in by ${esc(guest.last_checked_in_by_name || "")} at ${esc(guest.last_door_location || "")}</p>` : ""}
            </div>

            <div class="row-actions">
              ${remaining > 0 ? `<button class="btn green small" onclick="checkInOneGuest('${guest.id}')">Check In 1</button>` : `<span class="badge in">Fully In</span>`}
              ${checked > 0 ? `<button class="btn secondary small" onclick="undoOneGuest('${guest.id}')">Undo 1</button>` : ""}
              ${showActions ? `
                <button class="btn secondary small" onclick="openGuestModal('${guest.id}')">Edit</button>
                <button class="btn danger small" onclick="deleteGuest('${guest.id}')">Delete</button>
              ` : ""}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderSelectedGroupPanel() {
  const group = selectedGroup();

  if (!group) {
    return `
      <div class="card">
        <h2>Selected Group</h2>
        <p class="subtle">No party or bottle service group selected.</p>
      </div>
    `;
  }

  const stats = groupStats(group.id);

  return `
    <div class="card">
      <h2>${esc(group.name)}</h2>
      <p class="subtle">${esc(group.group_type)} · Host: ${esc(group.host_name || "N/A")}</p>

      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:0;">
        <div class="stat"><span>Total</span><strong>${stats.total}</strong></div>
        <div class="stat"><span>In</span><strong>${stats.checked}</strong></div>
        <div class="stat"><span>Left</span><strong>${stats.remaining}</strong></div>
      </div>

      <div class="divider"></div>

      <p class="subtle"><strong>Table/Location:</strong> ${esc(group.table_location || "Not listed")}</p>
      <p class="subtle"><strong>Approved By:</strong> ${esc(group.approved_by || "Not listed")}</p>
      <p class="subtle"><strong>Notes:</strong> ${esc(group.notes || "No notes listed.")}</p>

      ${perms().manage ? `
        <div class="row-actions">
          <button class="btn secondary small" onclick="openGroupModal('${group.id}')">Edit Group</button>
          <button class="btn danger small" onclick="deleteGroup('${group.id}')">Delete Group</button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderMainWorkspace(showManagement = false) {
  const title = state.currentMode === "GENERAL" ? "General Guest List" : `${selectedGroup() ? esc(selectedGroup().name) : "Selected Group"} Names`;
  const subtitle = state.currentMode === "GENERAL"
    ? "This master list shows everyone for the selected date, including bottle service attendees."
    : "This shows only the names under the selected group.";

  return `
    ${renderDateBar()}
    ${renderStats()}

    <div class="grid">
      <main class="stack">
        <div class="card tight">
          <div class="toolbar">
            <input id="mainSearchInput" placeholder="${state.currentMode === "GENERAL" ? "Search general guest list..." : "Search selected group..."}" value="${esc(state.searchText)}" oninput="state.searchText=this.value;render()" />

            <select onchange="setMode(this.value)">
              <option value="GENERAL" ${state.currentMode === "GENERAL" ? "selected" : ""}>General Guest List</option>
              <option value="GROUP" ${state.currentMode === "GROUP" ? "selected" : ""}>Selected Group Only</option>
            </select>

            <select onchange="setGuestFilter(this.value)">
              ${guestFilterOptions.map(option => `<option value="${option.value}" ${option.value === (state.guestFilter || "ALL") ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
            </select>

            <select onchange="setSortMode(this.value)">
              ${sortOptions.map(option => `<option value="${option.value}" ${option.value === state.sortMode ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
            </select>

            ${showManagement
              ? `<button class="btn" onclick="openGuestModal()">Add Individual Guest</button>`
              : `<button class="btn secondary" onclick="state.searchText='';render()">Clear Search</button>`
            }
          </div>
        </div>

        <div class="card">
          <h2>${title}</h2>
          <p class="subtle">${subtitle}</p>
          <div class="party-meta" style="margin-bottom:12px;">
            <span class="badge general">Filter: ${esc(activeFilterLabel())}</span>
            <span class="badge general">${visibleGuests().length} shown</span>
          </div>
          <div id="guestScrollPanel" class="scroll-panel">
            ${renderGuestList(showManagement)}
          </div>
        </div>

        ${showManagement ? `
          <div class="card">
            <h2>Bulk Paste Names</h2>
            <p class="subtle">Paste one name per line and add them to the General Guest List or selected group.</p>
            <button class="btn secondary" onclick="openBulkPasteModal()">Open Bulk Paste Tool</button>
          </div>

          <div class="card">
            <h2>Upload Names from Excel / CSV</h2>
            <p class="subtle">Recommended columns: First Name, Last Name, Guest Type, Party Size or Plus Count, Notes.</p>

            ${state.importMessage ? `<div class="notice ${state.importMessage.startsWith("Imported") || state.importMessage.startsWith("Bulk") || state.importMessage.startsWith("Cleared") ? "greenbox" : "redbox"}">${esc(state.importMessage)}</div>` : ""}

            <div class="form two">
              <div>
                <label>Upload Target</label>
                <select id="uploadTarget">
                  <option value="general">General Guest List / Individual Guest</option>
                  ${specificGroups().map(item => `<option value="group:${item.id}" ${item.id === selectedGroup()?.id ? "selected" : ""}>${esc(item.name)}${item.host_name ? ` — ${esc(item.host_name)}` : ""}</option>`).join("")}
                </select>
              </div>

              <div>
                <label>Excel / CSV File</label>
                <input type="file" accept=".xlsx,.xls,.csv" onchange="handleFileUpload(event)" />
              </div>
            </div>
          </div>
        ` : ""}
      </main>

      <aside class="stack">
        <div class="card">
          <h2>Party / Bottle Service Groups</h2>
          <p class="subtle">Click General Guest List to see everyone, or click a group to see only that group.</p>
          <input id="groupSearchInput" placeholder="Search groups..." value="${esc(state.groupSearchText)}" oninput="state.groupSearchText=this.value;render()" style="margin-bottom:12px;" />
          <div id="groupScrollPanel" class="scroll-panel short">
            ${renderGroupList(showManagement)}
          </div>
        </div>

        ${renderSelectedGroupPanel()}
      </aside>
    </div>
  `;
}


function updateTabletSearch(value) {
  state.searchText = value;

  const guests = visibleGuests();
  const grid = document.getElementById("tabletCardGrid");
  const count = document.getElementById("tabletShownCount");

  if (count) {
    count.textContent = `${guests.length} shown`;
  }

  if (grid) {
    grid.innerHTML = renderTabletGuestCards(guests);
  }
}

function renderTabletGuestCards(guests) {
  return guests.length ? guests.map(guest => {
    const group = state.groups.find(item => item.id === guest.group_id);
    const total = guestTotal(guest);
    const checked = guestChecked(guest);
    const remaining = guestRemaining(guest);
    const fullyIn = isGuestFullyIn(guest);

    return `
      <div class="tablet-guest-card ${fullyIn ? "checked" : ""}">
        <div class="tablet-guest-top">
          <div>
            <p class="tablet-guest-name">${esc(guest.first_name)} ${esc(guest.last_name)}</p>
            <p class="tablet-guest-meta">${esc(guest.guest_type)}${group ? ` · ${esc(group.name)}` : ""}${guest.notes ? ` · ${esc(guest.notes)}` : ""}</p>
            ${isLateAdd(guest) ? `<p class="late-add-detail">${esc(lateAddMetaText(guest))}</p>` : ""}
          </div>
          <div class="tablet-count">${checked}/${total}</div>
        </div>

        <p class="tablet-note">${fullyIn ? "Fully checked in" : `${remaining} remaining`}${checked > 0 && guest.last_checked_in_by_name ? ` · Last by ${esc(guest.last_checked_in_by_name)} at ${esc(guest.last_door_location || "")}` : ""}</p>

        <div class="tablet-actions">
          ${remaining > 0 ? `<button class="btn green tablet-check-btn" onclick="checkInOneGuest('${guest.id}')">Check In 1</button>` : `<button class="btn green tablet-check-btn" disabled>Fully In</button>`}
          ${checked > 0 ? `<button class="btn secondary tablet-undo-btn" onclick="undoOneGuest('${guest.id}')">Undo 1</button>` : `<button class="btn secondary tablet-undo-btn" disabled>Undo 1</button>`}
        </div>
      </div>
    `;
  }).join("") : `<div class="tablet-empty">No guests found. Try clearing search or switching list view.</div>`;
}


function renderTabletDoorMode() {
  const guests = visibleGuests();
  const stats = dayStats();
  const selectedListValue = state.currentMode === "GENERAL" ? "GENERAL" : (selectedGroup()?.id || "GENERAL");

  return `
    ${renderDateBar()}

    <div class="mobile-summary-bar">
      <div class="mobile-summary-item"><span>In</span><strong>${stats.checked}</strong></div>
      <div class="mobile-summary-item"><span>Left</span><strong>${stats.remaining}</strong></div>
      <div class="mobile-summary-item"><span>Total</span><strong>${stats.total}</strong></div>
    </div>

    <div class="tablet-door-shell">
      <div class="card">
        <h2>Tablet Door Mode</h2>
        <p class="subtle">Large-format check-in screen for iPad/tablet use at the door.</p>

        <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:0;">
          <div class="stat"><span>Checked In</span><strong>${stats.checked}</strong></div>
          <div class="stat"><span>Remaining</span><strong>${stats.remaining}</strong></div>
          <div class="stat"><span>Total Allowed</span><strong>${stats.total}</strong></div>
        </div>
      </div>

      <div class="tablet-action-bar">
        <div class="tablet-action-grid">
          <div>
            <label>Search Guest</label>
            <input id="tabletSearchInput" class="tablet-search" placeholder="Type guest name..." value="${esc(state.searchText)}" oninput="updateTabletSearch(this.value)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
          </div>

          <div>
            <label>Guest List / Party</label>
            <select onchange="selectTabletList(this.value)">
              <option value="GENERAL" ${selectedListValue === "GENERAL" ? "selected" : ""}>General Guest List</option>
              ${specificGroups().map(group => `
                <option value="${group.id}" ${selectedListValue === group.id ? "selected" : ""}>${esc(group.name)}${group.host_name ? ` — ${esc(group.host_name)}` : ""}</option>
              `).join("")}
            </select>
          </div>

          <div>
            <label>Quick Clear</label>
            <button class="btn secondary" onclick="state.searchText='';state.guestFilter='ALL';render()">Clear Search/Filter</button>
          </div>
        </div>

        <div class="tablet-filter-row">
          <div>
            <label>Filter</label>
            <select onchange="setGuestFilter(this.value)">
              ${guestFilterOptions.map(option => `<option value="${option.value}" ${option.value === (state.guestFilter || "ALL") ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label>Sort</label>
            <select onchange="setSortMode(this.value)">
              ${sortOptions.map(option => `<option value="${option.value}" ${option.value === state.sortMode ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="card tight">
        <div class="party-meta">
          <span class="badge general">Filter: ${esc(activeFilterLabel())}</span>
          <span id="tabletShownCount" class="badge general">${guests.length} shown</span>
        </div>
      </div>

      ${renderShiftNotesForDoorStaff()}

      <div id="tabletCardGrid" class="tablet-card-grid">
        ${renderTabletGuestCards(guests)}
      </div>
    </div>
  `;
}

function renderManagement() {
  return `
    ${renderMobileManagerView()}
    <div class="stack manage-desktop-view">
      <div class="card">
        <h2>Management Controls</h2>
        <p class="subtle">Create groups, add names, bulk paste, upload Excel, clear the master list, and export reports.</p>

        <div class="row-actions">
          <button class="btn" onclick="openGroupModal()">Create Party</button>
          <button class="btn secondary" onclick="openGuestModal()">Add Individual Guest</button>
          <button class="btn secondary" onclick="openBulkPasteModal()">Bulk Paste Names</button>
          <button class="btn secondary" onclick="setMode('GENERAL')">View General Guest List</button>
          <button class="btn danger" onclick="clearGeneralGuestList()">Clear General Guest List</button>
          <button class="btn secondary" onclick="previewCloseOutReport()">Preview Close Out Report</button>
          <button class="btn secondary" onclick="exportCsv()">Export Current Day CSV</button>
        </div>
      </div>

      ${renderShiftNotesPanel(true)}${renderMainWorkspace(true)}
    </div>
  `;
}

function renderStaffManagement() {
  if (!perms().users) {
    return `<div class="card"><h2>No Access</h2><p class="subtle">This account cannot manage staff.</p></div>`;
  }

  return `
    <div class="grid">
      <main class="stack">
        <div class="card">
          <h2>Staff Management</h2>
          <p class="subtle">Manage DoorFlow roles and active status for users already created in Supabase Authentication.</p>
          <button class="btn secondary" onclick="refreshStaffProfiles()">Refresh Staff List</button>
        </div>

        <div class="card">
          <h2>Current Staff</h2>
          <p class="subtle">Change a staff member's role or deactivate access. New email/password users still need to be created in Supabase Authentication first.</p>

          <div class="scroll-panel">
            ${state.staffProfiles.length ? `
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Save</th>
                  </tr>
                </thead>

                <tbody>
                  ${state.staffProfiles.map(profile => `
                    <tr>
                      <td>
                        <form id="staff-${profile.id}" onsubmit="updateStaffProfile(event)">
                          <input type="hidden" name="id" value="${profile.id}" />
                          <input name="full_name" value="${esc(profile.full_name)}" />
                        </form>
                      </td>
                      <td>
                        <select form="staff-${profile.id}" name="role">
                          ${["admin","manager","door","viewer"].map(role => `<option value="${role}" ${role === profile.role ? "selected" : ""}>${roleLabel(role)}</option>`).join("")}
                        </select>
                      </td>
                      <td>
                        <select form="staff-${profile.id}" name="active">
                          <option value="true" ${profile.active ? "selected" : ""}>Active</option>
                          <option value="false" ${!profile.active ? "selected" : ""}>Inactive</option>
                        </select>
                      </td>
                      <td>${profile.created_at ? new Date(profile.created_at).toLocaleDateString() : ""}</td>
                      <td><button form="staff-${profile.id}" class="btn small" type="submit">Save</button></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            ` : `<p class="subtle">No staff profiles loaded. Click Refresh Staff List.</p>`}
          </div>
        </div>
      </main>

      <aside class="stack">
        <div class="card">
          <h2>How to Add Staff</h2>
          <p class="subtle">Create the email/password user in Supabase Authentication first, then add that user's UID to staff_profiles.</p>
        </div>

        <div class="card">
          <h2>Role Guide</h2>
          <p class="subtle"><strong>Admin:</strong> full app access and staff management.</p>
          <p class="subtle"><strong>Manager:</strong> manage guest lists, groups, reports, and check-ins.</p>
          <p class="subtle"><strong>Door Staff:</strong> door check-in only.</p>
          <p class="subtle" style="margin-bottom:0;"><strong>Viewer:</strong> reports only.</p>
        </div>
      </aside>
    </div>
  `;
}

function renderReports() {
  const stats = dayStats();

  return `
    ${renderDateBar()}
    ${renderStats()}

    <div class="grid">
      <main class="stack">
        <div class="card">
          <h2>Reports</h2>\n        <p class="subtle">Late Adds This Date: <strong>${state.guests.filter(guest => isLateAdd(guest)).length}</strong></p>
          <p class="subtle">Current date: <strong>${esc(state.activeDay)} ${esc(state.activeDate)}</strong></p>
          <div class="row-actions">
            <button class="btn" onclick="exportCsv()">Export Current Day CSV</button>
            <button class="btn secondary" onclick="loadDataForDate(state.activeDate)">Refresh Report</button>
          </div>
        </div>

        <div class="card">
          <h2>Daily Summary</h2>
          <div class="stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:0;">
            <div class="stat"><span>Total Allowed</span><strong>${stats.total}</strong></div>
            <div class="stat"><span>Checked In</span><strong>${stats.checked}</strong></div>
            <div class="stat"><span>Remaining</span><strong>${stats.remaining}</strong></div>
            <div class="stat"><span>Activity Logs</span><strong>${state.logs.length}</strong></div>
          </div>
        </div>

        <div class="card">
          <h2>Check-In Activity Log</h2>
          <p class="subtle">Shows who was checked in, which group they were under, who checked them in, where, and when.</p>
          <div id="reportScrollPanel" class="scroll-panel">
            ${state.logs.length ? `
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Guest</th>
                    <th>Group</th>
                    <th>Action</th>
                    <th>Staff</th>
                    <th>Door</th>
                  </tr>
                </thead>
                <tbody>
                  ${state.logs.map(log => `
                    <tr>
                      <td>${esc(logTime(log))}</td>
                      <td><strong>${esc(guestNameFromLog(log))}</strong></td>
                      <td>${esc(groupNameFromLog(log))}</td>
                      <td>${esc(log.action || "")}</td>
                      <td>${esc(log.staff_name || "")}</td>
                      <td>${esc(log.door_location || "")}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            ` : `<p class="subtle">No check-in activity yet for this date.</p>`}
          </div>
        </div>

        <div class="card">
          <h2>Current Guest Status</h2>
          <p class="subtle">Quick operational view of all names for this date.</p>
          <div class="scroll-panel">
            ${state.guests.length ? `
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Group</th>
                    <th>Type</th>
                    <th>Checked In</th>
                    <th>Remaining</th>
                    <th>Door</th>
                  </tr>
                </thead>

                <tbody>
                  ${sortGuests([...state.guests]).map(guest => {
                    const group = state.groups.find(item => item.id === guest.group_id);

                    return `
                      <tr>
                        <td><strong>${esc(guest.first_name)} ${esc(guest.last_name)}</strong></td>
                        <td>${esc(group?.name || "")}</td>
                        <td>${esc(guest.guest_type || "")}</td>
                        <td>${guestChecked(guest)} / ${guestTotal(guest)}</td>
                        <td>${guestRemaining(guest)}</td>
                        <td>${esc(guest.last_door_location || "")}</td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            ` : `<p class="subtle">No guests are listed for this date.</p>`}
          </div>
        </div>
      </main>

      <aside class="stack">
        ${renderSelectedGroupPanel()}
      </aside>
    </div>
  `;
}

function renderGroupModal() {
  const group = state.editingGroupId ? state.groups.find(item => item.id === state.editingGroupId) : null;
  const isEdit = Boolean(group);

  return `
    <div class="modal-backdrop" onclick="if(event.target.classList.contains('modal-backdrop')) closeModal()">
      <div class="modal">
        <h2>${isEdit ? "Edit Party / Group" : "Create Party / Group"}</h2>

        <form onsubmit="${isEdit ? "updateGroup(event)" : "createGroup(event)"}" class="form two">
          <div>
            <label>Party / Group Name</label>
            <input name="name" value="${esc(group?.name || "")}" placeholder="Smith Bottle Service" />
          </div>

          <div>
            <label>Type</label>
            <select name="group_type">
              ${groupTypes.map(type => `<option ${type === (group?.group_type || "Bottle Service") ? "selected" : ""}>${esc(type)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label>Date</label>
            <input name="date" type="date" value="${esc(state.activeDate)}" />
          </div>

          <div>
            <label>Host Name</label>
            <input name="host_name" value="${esc(group?.host_name || "")}" />
          </div>

          <div>
            <label>Booth / Location</label>
            <select name="table_location">
              <option value="" ${!(group?.table_location) ? "selected" : ""}>Select booth/location</option>
              ${group?.table_location && !boothOptions.includes(group.table_location) ? `<option selected value="${esc(group.table_location)}">${esc(group.table_location)}</option>` : ""}
              ${boothOptions.map(booth => `<option value="${esc(booth)}" ${booth === (group?.table_location || "") ? "selected" : ""}>${esc(booth)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label>Approved By</label>
            <input name="approved_by" value="${esc(group?.approved_by || "Management")}" />
          </div>

          <div>
            <label>Status</label>
            <select name="status">
              ${["Active","Draft","Closed"].map(status => `<option ${status === (group?.status || "Active") ? "selected" : ""}>${status}</option>`).join("")}
            </select>
          </div>

          <div style="grid-column:1/-1;">
            <label>Notes</label>
            <textarea name="notes" rows="3">${esc(group?.notes || "")}</textarea>
          </div>

          <div style="grid-column:1/-1;" class="row-actions">
            <button class="btn" type="submit">${isEdit ? "Save Group" : "Create Group"}</button>
            <button class="btn secondary" type="button" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderGuestModal() {
  const guest = state.editingGuestId ? state.guests.find(item => item.id === state.editingGuestId) : null;
  const isEdit = Boolean(guest);

  return `
    <div class="modal-backdrop" onclick="if(event.target.classList.contains('modal-backdrop')) closeModal()">
      <div class="modal">
        <h2>${isEdit ? "Edit Name" : "Add Name"}</h2>

        <form onsubmit="${isEdit ? "updateGuest(event)" : "createGuest(event)"}" class="form two">
          ${!isEdit ? `
            <div style="grid-column:1/-1;">
              <label>Add To</label>
              <select name="target">
                <option value="general">General Guest List / Individual Guest</option>
                ${specificGroups().map(item => `<option value="group:${item.id}" ${item.id === selectedGroup()?.id ? "selected" : ""}>${esc(item.name)}${item.host_name ? ` — ${esc(item.host_name)}` : ""}</option>`).join("")}
              </select>
            </div>
          ` : ""}

          <div>
            <label>First Name</label>
            <input name="first_name" value="${esc(guest?.first_name || "")}" />
          </div>

          <div>
            <label>Last Name</label>
            <input name="last_name" value="${esc(guest?.last_name || "")}" />
          </div>

          <div>
            <label>Guest Type</label>
            <select name="guest_type">
              ${guestTypes.map(type => `<option ${type === (guest?.guest_type || "Guest") ? "selected" : ""}>${esc(type)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label>Total Allowed / Party Size</label>
            <input name="total_allowed" type="number" min="1" value="${guestTotal(guest || { total_allowed:1 })}" />
          </div>

          ${!isEdit ? `
            <div>
              <label style="display:flex;align-items:center;gap:8px;margin-top:30px;">
                <input style="width:auto;" type="checkbox" name="checked_in" />
                Already checked in
              </label>
            </div>
          ` : `<div></div>`}

          <div style="grid-column:1/-1;">
            <label>Notes</label>
            <textarea name="notes" rows="3">${esc(guest?.notes || "")}</textarea>
          </div>

          <div style="grid-column:1/-1;" class="card tight">
            <div class="name-line" style="margin-bottom:10px;">
              <input type="checkbox" name="is_late_add" ${guest && isLateAdd(guest) ? "checked" : ""} style="width:auto;" />
              <label style="margin:0;">Late Add / Manager Approved Entry</label>
            </div>

            <div class="two">
              <div>
                <label>Approved By</label>
                <input name="late_add_approved_by" placeholder="Manager name" value="${esc(guest?.late_add_approved_by || "")}" />
              </div>
              <div>
                <label>Reason / Approval Note</label>
                <input name="late_add_reason" placeholder="Example: Late VIP approval" value="${esc(guest?.late_add_reason || "")}" />
              </div>
            </div>

            <p class="subtle" style="margin:10px 0 0;">Use this when a name is added after the list is already live or after management approval is required.</p>
          </div>

          <div style="grid-column:1/-1;" class="row-actions">
            <button class="btn" type="submit">${isEdit ? "Save Name" : "Add Name"}</button>
            <button class="btn secondary" type="button" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderBulkModal() {
  const group = selectedGroup();

  return `
    <div class="modal-backdrop" onclick="if(event.target.classList.contains('modal-backdrop')) closeModal()">
      <div class="modal">
        <h2>Bulk Paste Names</h2>
        <p class="subtle">Paste one name per line. Supports plus counts like Sarah Johnson +2.</p>

        <div class="notice warn">
          <strong>Examples:</strong><br>
          John Smith<br>
          Sarah Johnson +2<br>
          David Miller - VIP - Owner approved
        </div>

        <form onsubmit="bulkAddNames(event)" class="form">
          <div class="form two">
            <div>
              <label>Add To</label>
              <select name="target">
                <option value="general">General Guest List / Individual Guest</option>
                ${specificGroups().map(item => `<option value="group:${item.id}" ${item.id === group?.id ? "selected" : ""}>${esc(item.name)}${item.host_name ? ` — ${esc(item.host_name)}` : ""}</option>`).join("")}
              </select>
            </div>

            <div>
              <label>Default Guest Type</label>
              <select name="defaultType">
                ${guestTypes.map(type => `<option ${type === "Guest" ? "selected" : ""}>${esc(type)}</option>`).join("")}
              </select>
            </div>
          </div>

          <div>
            <label>Paste Names</label>
            <textarea name="bulkNames" rows="12" placeholder="John Smith&#10;Sarah Johnson +2&#10;David Miller - VIP - Owner approved"></textarea>
          </div>

          <div class="row-actions">
            <button class="btn" type="submit">Add Names</button>
            <button class="btn secondary" type="button" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderShiftNoteModal() {
  const note = (state.shiftNotes || []).find(item => item.id === state.editingShiftNoteId);

  if (!note) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>Edit Shift Note</h2>
        <p class="subtle">Update the category, priority, or note text for this service day.</p>

        <form onsubmit="updateShiftNote(event)" class="form">
          <div class="two">
            <div>
              <label>Category</label>
              <select name="category">
                ${noteCategories.map(item => `<option ${item === note.category ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </div>

            <div>
              <label>Priority</label>
              <select name="priority">
                ${notePriorities.map(item => `<option ${item === note.priority ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </div>
          </div>

          <div>
            <label>Note</label>
            <textarea name="note_text" rows="6">${esc(note.note_text || "")}</textarea>
          </div>

          <div class="row-actions">
            <button class="btn" type="submit">Save Note Changes</button>
            <button class="btn secondary" type="button" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}


function renderModal() {
  if (state.modal === "group") return renderGroupModal();
  if (state.modal === "guest") return renderGuestModal();
  if (state.modal === "bulk") return renderBulkModal();
  if (state.modal === "shiftNote") return renderShiftNoteModal();
  if (state.modal === "closeoutReport") return renderCloseOutReportModal();
  return "";
}

function renderApp() {
  let content = "";

  if (state.view === "door") content = `<div class="stack">${renderShiftNotesForDoorStaff()}${renderMainWorkspace(false)}</div>`;
  if (state.view === "tabletDoor") content = renderTabletDoorMode();
  if (state.view === "manage") content = renderManagement();
  if (state.view === "users") content = renderStaffManagement();
  if (state.view === "reports") content = renderReports();

  return `
    ${renderTopbar()}
    <div class="page">
      ${state.error ? `<div class="notice redbox"><strong>Error:</strong> ${esc(state.error)}</div>` : ""}
      <div class="notice greenbox"><strong>Live database mode:</strong> guests and check-ins are stored in Supabase and sync across devices.</div>
      ${renderTabs()}
      ${content}
    </div>
    ${renderModal()}
  `;
}

Object.assign(window, {
  login,
  logout,
  switchView,
  setActiveDay,
  setActiveDate,
  selectGroup,
  setMode,
  setSortMode,
  selectTabletList,
  checkInOneGuest,
  undoOneGuest,
  toggleGuest,
  createGroup,
  updateGroup,
  deleteGroup,
  createGuest,
  createQuickManagerGuest,
  mobileQuickAddGuest,
  mobileQuickCreateGroup,
  scrollToMobileCreateGroup,
  manualRefreshData,
  updateGuest,
  deleteGuest,
  clearGeneralGuestList,
  updateStaffProfile,
  refreshStaffProfiles,
  bulkAddNames,
  handleFileUpload,
  exportCsv,
  openGroupModal,
  openGuestModal,
  openBulkPasteModal,
  closeModal,
  render,
  isLateAdd
});

render();
initAuth();
