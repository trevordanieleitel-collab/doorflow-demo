const SUPABASE_URL = "https://wdlgkwzowapzhurbbavf.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_FiasS5c034YR4w_72bBUqQ_dzcCJ5ME";
const DOORFLOW_FETCH_TIMEOUT_MS = 18000;
const DOORFLOW_SESSION_REFRESH_WINDOW_MS = 120000;
const DOORFLOW_REALTIME_RECONNECT_MS = 120000;
const DOORFLOW_ACTION_SESSION_CHECK_MS = 15000;
const DOORFLOW_WAKE_ACTION_WINDOW_MS = 10000;
const DOORFLOW_STUCK_ACTION_RESET_MS = 25000;
const DEFAULT_VENUE_NAME = "EVE";
const BOB_BRAND = {
  appName:"The B.O.B. DoorFlow",
  shortName:"DoorFlow",
  logoSrc:"/branding/bob-logo.png",
  darkLogoSrc:"/branding/bob-logo-dark.png",
  fallback:"The B.O.B."
};
const DOORFLOW_VENUE_PRESENTATION = Object.freeze({
  mappedVenueName:"EVE",
  parentVenue:"The B.O.B.",
  operatingSpace:"EVE",
  sharedGuestListLabel:"Shared Guest List",
  guestListScope:"The B.O.B. + EVE",
  resolve(venueName) {
    const currentVenue = String(venueName || this.mappedVenueName).trim() || this.mappedVenueName;
    const isMappedContext = currentVenue.toUpperCase() === this.mappedVenueName;

    if (!isMappedContext) {
      return {
        parentVenue:currentVenue,
        operatingSpace:"",
        sharedGuestListLabel:"Guest List",
        guestListScope:currentVenue,
        desktopLabel:currentVenue,
        compactLabel:currentVenue,
        reportLabel:currentVenue
      };
    }

    return {
      parentVenue:this.parentVenue,
      operatingSpace:this.operatingSpace,
      sharedGuestListLabel:this.sharedGuestListLabel,
      guestListScope:this.guestListScope,
      desktopLabel:`${this.parentVenue} / ${this.operatingSpace}`,
      compactLabel:`${this.parentVenue} \u2022 ${this.operatingSpace}`,
      reportLabel:`${this.parentVenue} \u2014 ${this.operatingSpace}`
    };
  }
});

const DOORFLOW_LIVE_GUEST_PRESENTATION = Object.freeze({
  cleanName(value) {
    return String(value || "Guest").replace(/\s+(?:\+\d+|\d+\+)\s*$/, "").trim() || "Guest";
  },
  displayName(guest) {
    return this.cleanName(guestBaseName(guest));
  }
});

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
const HOST_GUEST_TYPE = "Host";
const MAX_HOST_PLUS_ONES = 99;
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

// Clear legacy persisted service dates. A browser/PWA reload should start on
// the device's current local calendar date, not yesterday's selected event date.
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
  shellNavOpen:false,
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
  editingPlusGuestId:null,
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
  pendingSync:false,
  actionBusy:{}
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
let visibleGuestCache = { key:"", rows:[] };
let visibleGroupCache = { key:"", rows:[] };
let modalFocusOpen = false;
let modalReturnFocus = null;

function isValidISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function getLocalTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localISOFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayISO() {
  return getLocalTodayDateString();
}

function getInitialActiveDate() {
  try {
    localStorage.removeItem(DOORFLOW_ACTIVE_DATE_KEY);
  } catch (error) {
    console.warn("Could not clear saved DoorFlow date:", error);
  }

  return getLocalTodayDateString();
}

function saveActiveDate(dateString) {
  if (!isValidISODate(dateString)) return;

  try {
    localStorage.removeItem(DOORFLOW_ACTIVE_DATE_KEY);
  } catch (error) {
    console.warn("Could not clear saved DoorFlow date:", error);
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

function captureModalReturnFocus() {
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  return {
    id:active.id || "",
    onclick:active.getAttribute?.("onclick") || "",
    text:String(active.textContent || "").trim()
  };
}

function restoreModalReturnFocus(target) {
  let element = target?.id ? document.getElementById(target.id) : null;

  if (!element && target?.onclick) {
    element = [...document.querySelectorAll("button, [role='button']")].find(candidate => {
      return candidate.getAttribute("onclick") === target.onclick
        && String(candidate.textContent || "").trim() === target.text;
    }) || null;
  }

  (element || document.getElementById("main-content"))?.focus();
}

function syncModalFocus(opening) {
  const dialog = document.querySelector(".df-shell-modal-scope [role='dialog']");

  if (dialog) {
    modalFocusOpen = true;
    if (opening) {
      requestAnimationFrame(() => {
        (dialog.querySelector(".df-modal-close") || dialog)?.focus();
      });
    }
    return;
  }

  if (modalFocusOpen) {
    const target = modalReturnFocus;
    modalFocusOpen = false;
    modalReturnFocus = null;
    requestAnimationFrame(() => restoreModalReturnFocus(target));
  }
}

function handleModalKeydown(event) {
  if (!state.modal) return;

  const dialog = document.querySelector(".df-shell-modal-scope [role='dialog']");
  if (!dialog) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeModal();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = [...dialog.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
    .filter(element => !element.hidden && element.getAttribute("aria-hidden") !== "true");

  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function render() {
  const ui = captureTransientUiState();
  const root = document.getElementById("app");
  const modalOpening = Boolean(state.modal) && !modalFocusOpen;
  if (modalOpening) modalReturnFocus = captureModalReturnFocus();

  if (!auth.currentUser) {
    root.innerHTML = renderLogin();
    restoreTransientUiState(ui);
    syncModalFocus(false);
    return;
  }

  root.innerHTML = renderApp();
  restoreTransientUiState(ui);
  syncModalFocus(modalOpening);
}

async function runDb(label, fn) {
  const isAction = Boolean(auth.session?.user && label !== "Loading live data");

  try {
    state.error = "";
    clearStuckActionState(`before ${label}`);

    if (isAction) {
      activeDoorFlowAction = true;
      lastDoorFlowActionAt = Date.now();
      updateSyncStatus("Saving", `${label}...`);
      await prepareDatabaseAction(label);
    }

    return await fn();
  } catch (error) {
    console.error(error);
    state.loading = false;
    state.error = label + " failed: " + (error.message || error);
    updateSyncStatus("Action failed", error.message || String(error));
    render();
    throw error;
  } finally {
    if (isAction) {
      activeDoorFlowAction = false;
      lastDoorFlowActionAt = Date.now();
    }
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

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeNullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeServiceDay(row = {}) {
  row = row || {};
  return {
    ...row,
    id:normalizeText(row.id),
    service_date:normalizeText(row.service_date || state.activeDate),
    day_name:normalizeText(row.day_name || dayNameFromDate(row.service_date || state.activeDate)),
    venue_name:normalizeText(row.venue_name || row.venue || "The B.O.B."),
    status:normalizeText(row.status || "Active")
  };
}

function normalizeGroup(row = {}) {
  row = row || {};
  return {
    ...row,
    id:normalizeText(row.id),
    service_day_id:normalizeNullableText(row.service_day_id),
    name:normalizeText(row.name),
    group_type:normalizeText(row.group_type || "Bottle Service"),
    host_name:normalizeText(row.host_name),
    table_location:normalizeText(row.table_location),
    approved_by:normalizeText(row.approved_by || "Management"),
    notes:normalizeText(row.notes),
    status:normalizeText(row.status || "Active"),
    created_at:normalizeText(row.created_at),
    updated_at:normalizeText(row.updated_at)
  };
}

function normalizeGuest(row = {}) {
  row = row || {};
  const totalAllowed = Math.max(1, normalizeNumber(row.total_allowed, 1));
  const checkedIn = Math.max(0, Math.min(totalAllowed, normalizeNumber(row.checked_in_count, 0)));

  return {
    ...row,
    id:normalizeText(row.id),
    group_id:normalizeNullableText(row.group_id),
    first_name:normalizeText(row.first_name),
    last_name:normalizeText(row.last_name),
    guest_type:normalizeText(row.guest_type || "Guest"),
    total_allowed:totalAllowed,
    checked_in_count:checkedIn,
    notes:normalizeText(row.notes),
    last_checked_in_at:normalizeNullableText(row.last_checked_in_at),
    last_checked_in_by_name:normalizeText(row.last_checked_in_by_name),
    last_door_location:normalizeText(row.last_door_location),
    added_by_name:normalizeText(row.added_by_name),
    added_by_user_id:normalizeNullableText(row.added_by_user_id),
    added_at:normalizeNullableText(row.added_at),
    is_late_add:normalizeBoolean(row.is_late_add),
    late_add_approved_by:normalizeNullableText(row.late_add_approved_by),
    late_add_reason:normalizeNullableText(row.late_add_reason),
    created_at:normalizeText(row.created_at),
    updated_at:normalizeText(row.updated_at)
  };
}

function normalizeShiftNote(row = {}) {
  row = row || {};
  return {
    ...row,
    id:normalizeText(row.id),
    service_day_id:normalizeNullableText(row.service_day_id),
    category:normalizeText(row.category || "General Note"),
    priority:normalizeText(row.priority || "Normal"),
    note_text:normalizeText(row.note_text),
    created_by_name:normalizeText(row.created_by_name || "Unknown"),
    created_by_user_id:normalizeNullableText(row.created_by_user_id),
    created_at:normalizeText(row.created_at),
    updated_at:normalizeText(row.updated_at)
  };
}

function normalizeCheckInLog(row = {}) {
  row = row || {};
  return {
    ...row,
    id:normalizeText(row.id),
    guest_id:normalizeNullableText(row.guest_id),
    group_id:normalizeNullableText(row.group_id),
    action:normalizeText(row.action),
    amount:Math.max(0, normalizeNumber(row.amount, 0)),
    door_location:normalizeText(row.door_location),
    staff_name:normalizeText(row.staff_name),
    staff_user_id:normalizeNullableText(row.staff_user_id),
    created_at:normalizeText(row.created_at)
  };
}

function normalizeStaffProfile(row = {}) {
  row = row || {};
  return {
    ...row,
    id:normalizeText(row.id),
    user_id:normalizeNullableText(row.user_id),
    full_name:normalizeText(row.full_name),
    role:normalizeText(row.role || "door"),
    active:row.active !== false && row.active !== "false" && row.active !== 0 && row.active !== "0",
    created_at:normalizeText(row.created_at),
    updated_at:normalizeText(row.updated_at)
  };
}

function normalizeRows(rows, normalizer) {
  return (Array.isArray(rows) ? rows : []).map(row => normalizer(row));
}

function emptyGuestForm() {
  return normalizeGuest({
    first_name:"",
    last_name:"",
    guest_type:"Guest",
    total_allowed:1,
    checked_in_count:0,
    notes:"",
    is_late_add:false
  });
}

function emptyGroupForm() {
  return normalizeGroup({
    name:"",
    group_type:"Bottle Service",
    host_name:"",
    table_location:"",
    approved_by:"Management",
    notes:"",
    status:"Active"
  });
}

function emptyShiftNoteForm() {
  return normalizeShiftNote({
    category:"General Note",
    priority:"Normal",
    note_text:"",
    created_by_name:currentUser()?.name || "Unknown"
  });
}

function setActionBusy(key, busy) {
  if (!key) return;
  state.actionBusy = { ...(state.actionBusy || {}), [key]:Boolean(busy) };
}

function isActionBusy(key) {
  return Boolean(key && state.actionBusy?.[key]);
}

function isGuestCheckActionBusy(guestId) {
  return Boolean(isActionBusy(`checkin:${guestId}`) || isActionBusy(`undo:${guestId}`));
}

function refreshCheckActionSurfaces(forceRender = false) {
  resetDerivedListCaches();
  if (forceRender || !refreshLiveSurfaces()) render();
}

function guestCheckStatePayload(guest) {
  return {
    checked_in_count:guestChecked(guest),
    last_checked_in_at:guest.last_checked_in_at || null,
    last_checked_in_by_name:guest.last_checked_in_by_name || null,
    last_door_location:guest.last_door_location || null
  };
}

async function restoreGuestCheckState(id, guest) {
  const result = await withDoorFlowTimeout(
    db.from("guests").update(guestCheckStatePayload(guest)).eq("id", id),
    "Restoring guest check-in state",
    8000
  );

  must(result.data, result.error);
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
  if (id.startsWith("mobileQuick") || id.startsWith("mobileGroup") || id.startsWith("mobileShiftNote")) return true;

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

function clearStuckActionState(reason = "recovery") {
  let changed = false;
  const staleAction = activeDoorFlowAction && msSinceDate(lastDoorFlowActionAt) > DOORFLOW_STUCK_ACTION_RESET_MS;
  const staleMobileSubmit = window.__doorFlowMobileSubmitting && msSinceDate(lastDoorFlowActionAt) > DOORFLOW_STUCK_ACTION_RESET_MS;
  const staleAutoRefresh = isAutoRefreshing && msSinceDate(lastAutoRefreshAt) > DOORFLOW_STUCK_ACTION_RESET_MS;

  if (staleAction) {
    activeDoorFlowAction = false;
    changed = true;
  }

  if (staleMobileSubmit) {
    window.__doorFlowMobileSubmitting = false;
    changed = true;
  }

  if (staleAutoRefresh) {
    isAutoRefreshing = false;
    changed = true;
  }

  if (state.loading && !activeDoorFlowAction && !isAutoRefreshing && msSinceDate(state.lastSyncAt) > DOORFLOW_STUCK_ACTION_RESET_MS) {
    state.loading = false;
    changed = true;
  }

  if (changed) {
    updateSyncStatus("Reconnect", `Cleared a stale action after ${reason}. Try the button again if needed.`);
    console.warn("DoorFlow cleared stale action state:", reason);
  }

  return changed;
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
    (shiftNotes || []).map(row => compactRowStamp(row, ["id", "category", "priority", "note_text", "created_at", "updated_at"])).join("~")
  ].join("||");
}

function resetDerivedListCaches() {
  visibleGuestCache = { key:"", rows:[] };
  visibleGroupCache = { key:"", rows:[] };
}

function liveGuestListVersion() {
  return [
    state.lastDataHash,
    state.groups.length,
    state.guests.length,
    state.logs.length,
    state.groups.map(row => compactRowStamp(row, ["id", "name", "group_type", "host_name", "table_location", "status", "updated_at", "created_at"])).join("~"),
    state.guests.map(row => compactRowStamp(row, ["id", "group_id", "first_name", "last_name", "guest_type", "total_allowed", "checked_in_count", "last_checked_in_at", "last_checked_in_by_name", "last_door_location", "is_late_add", "late_add_approved_by", "late_add_reason", "notes", "updated_at", "created_at"])).join("~")
  ].join("||");
}

function liveGroupListVersion() {
  return [
    state.lastDataHash,
    state.groups.length,
    state.guests.length,
    state.groups.map(row => compactRowStamp(row, ["id", "name", "group_type", "host_name", "table_location", "status", "updated_at", "created_at"])).join("~"),
    state.guests.map(row => compactRowStamp(row, ["id", "group_id", "total_allowed", "checked_in_count", "updated_at", "created_at"])).join("~")
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
    const refreshed = await withDoorFlowTimeout(
      db.auth.refreshSession(),
      "Refreshing DoorFlow session",
      10000
    );
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
  clearStuckActionState(`starting ${label}`);

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
  clearStuckActionState(`refresh:${reason}`);

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

  const clearedStaleState = clearStuckActionState(reason);

  if (state.modal || activeDoorFlowAction || window.__doorFlowMobileSubmitting || hasUnsavedMobileManagerDraft()) {
    schedulePendingSync(reason);
    return;
  }

  const msSinceSync = msSinceDate(state.lastSyncAt);
  const shouldRefresh = clearedStaleState || state.pendingSync || msSinceSync > 15000 || reason === "online";

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

window.addEventListener("pagehide", () => {
  lastHiddenAt = Date.now();
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

window.addEventListener("unhandledrejection", event => {
  const error = event.reason;
  if (!auth.currentUser) return;

  state.loading = false;
  activeDoorFlowAction = false;
  window.__doorFlowMobileSubmitting = false;
  updateSyncStatus("Action failed", error?.message || "A DoorFlow action failed. Try again or tap Refresh Data.");
  state.error = error?.message || "A DoorFlow action failed. Try again or tap Refresh Data.";
  render();
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

  const profile = normalizeStaffProfile(data);

  if (!profile.active) {
    state.error = "This DoorFlow account is inactive.";
    auth.currentUser = null;
    auth.profile = null;
    render();
    return;
  }

  if (!roles[profile.role]) {
    state.error = `This DoorFlow account has an unknown role: ${profile.role || "blank"}.`;
    auth.currentUser = null;
    auth.profile = null;
    render();
    return;
  }

  auth.profile = profile;
  auth.currentUser = {
    id:user.id,
    email:user.email,
    name:profile.full_name,
    role:profile.role,
    active:profile.active
  };

  state.error = "";
  state.view = options.preserveView && viewAllowedForRole(profile.role, previousView)
    ? previousView
    : defaultViewForRole(profile.role);

  if (profile.role === "admin") {
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

  try {
    const { data, error } = await withDoorFlowTimeout(
      db.auth.signInWithPassword({ email, password }),
      "Logging in",
      15000
    );

    if (error) {
      state.error = error.message;
      render();
      return;
    }

    auth.session = data.session;
    await loadStaffProfile(data.user);
    await bootDatabase();
  } catch (error) {
    state.error = error?.message || "Login failed. Check connection and try again.";
    render();
  }
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
  state.editingGroupId = null;
  state.editingGuestId = null;
  state.editingPlusGuestId = null;
  state.editingShiftNoteId = null;
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

async function findVenueByName(name) {
  const result = await db
    .from("venues")
    .select("*")
    .eq("name", name)
    .order("created_at", { ascending:true })
    .limit(1);

  if (result.error) throw result.error;
  return firstRow(result.data);
}

async function findFallbackVenue() {
  const result = await db
    .from("venues")
    .select("*")
    .order("created_at", { ascending:true })
    .limit(1);

  if (result.error) throw result.error;
  return firstRow(result.data);
}

async function ensureVenue() {
  const defaultVenue = await findVenueByName(DEFAULT_VENUE_NAME);
  if (defaultVenue) return defaultVenue;

  const fallbackVenue = await findFallbackVenue();
  if (fallbackVenue) return fallbackVenue;

  if (!canManageData()) {
    throw new Error("Venue has not been created yet. Log in as admin/manager first.");
  }

  let result = await db.from("venues").insert({ name:DEFAULT_VENUE_NAME });
  if (result.error) throw result.error;

  return must(await findVenueByName(DEFAULT_VENUE_NAME), null);
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

    const serviceDay = normalizeServiceDay(await withDoorFlowTimeout(
      ensureServiceDay(dateString),
      "Loading the active service date",
      15000
    ));

    await withDoorFlowTimeout(
      ensureGeneralGroup(serviceDay.id),
      "Loading the General Guest List",
      15000
    );

    const groupsResult = await withDoorFlowTimeout(
      db
        .from("groups")
        .select("*")
        .eq("service_day_id", serviceDay.id)
        .order("created_at", { ascending:false }),
      "Loading party/group lists",
      15000
    );

    const nextGroups = normalizeRows(must(groupsResult.data, groupsResult.error), normalizeGroup);

    const groupIds = nextGroups.map(group => group.id);
    let nextGuests = [];
    let nextLogs = [];

    if (groupIds.length) {
      const guestsResult = await withDoorFlowTimeout(
        db
          .from("guests")
          .select("*")
          .in("group_id", groupIds)
          .order("last_name", { ascending:true }),
        "Loading guest names",
        15000
      );

      nextGuests = normalizeRows(must(guestsResult.data, guestsResult.error), normalizeGuest);

      const logsResult = await withDoorFlowTimeout(
        db
          .from("check_in_logs")
          .select("*")
          .in("group_id", groupIds)
          .order("created_at", { ascending:false })
          .limit(300),
        "Loading check-in history",
        15000
      );

      nextLogs = normalizeRows(must(logsResult.data, logsResult.error), normalizeCheckInLog);
    }

    const notesResult = await withDoorFlowTimeout(
      db
        .from("shift_notes")
        .select("*")
        .eq("service_day_id", serviceDay.id)
        .order("created_at", { ascending:false }),
      "Loading shift notes",
      15000
    );

    const nextShiftNotes = normalizeRows(must(notesResult.data, notesResult.error), normalizeShiftNote);

    const newDataHash = buildLiveDataHash(nextGroups, nextGuests, nextLogs, nextShiftNotes);
    const dataUnchanged = Boolean(state.lastDataHash && state.lastDataHash === newDataHash);

    state.serviceDay = serviceDay;

    if (!dataUnchanged) {
      state.groups = nextGroups;
      state.guests = nextGuests;
      state.logs = nextLogs;
      state.shiftNotes = nextShiftNotes;
      resetDerivedListCaches();
    }

    if (!selectedGroup() && specificGroups()[0]) {
      state.selectedGroupId = specificGroups()[0].id;
    }

    if (auth.currentUser?.role === "admin") {
      await loadStaffProfilesForAdmin();
    }

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
    if (!activeDoorFlowAction && dataUnchanged) {
      refreshLiveSurfaces();
    } else if (!activeDoorFlowAction && isAutoRefreshing && shouldPatchLiveRefresh()) {
      refreshLiveSurfaces();
    } else if (!activeDoorFlowAction) {
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

      if (auth.currentUser && !state.modal && shouldPatchLiveRefresh()) {
        refreshLiveSurfaces();
      } else if (auth.currentUser && !state.modal && !isUserActivelyEditing() && !hasUnsavedMobileManagerDraft()) {
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

  const serviceDay = state.serviceDay?.service_date === state.activeDate
    ? state.serviceDay
    : await ensureServiceDay(state.activeDate);

  group = normalizeGroup(await ensureGeneralGroup(serviceDay.id));

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

function guestPlusCount(guest) {
  return Math.max(0, guestTotal(guest) - 1);
}

function guestBaseName(guest) {
  return `${guest?.first_name || ""} ${guest?.last_name || ""}`.trim() || "Guest";
}

function guestDisplayName(guest) {
  const name = guestBaseName(guest);
  const plusCount = guestPlusCount(guest);
  return plusCount > 0 ? `${name} +${plusCount}` : name;
}

function appendGuestNote(existing, note) {
  const current = String(existing || "").trim();
  const addition = String(note || "").trim();
  if (!addition) return current;
  return current ? `${current}\n${addition}` : addition;
}

function normalizeSearchCorpus(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+:/.-]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTerms(value) {
  return normalizeSearchCorpus(value).split(" ").filter(Boolean);
}

function matchesSearchTerms(haystack, terms) {
  if (!terms.length) return true;
  const normalized = normalizeSearchCorpus(haystack);
  return terms.every(term => normalized.includes(term));
}

function guestStatusSearchText(guest) {
  const total = guestTotal(guest);
  const checked = guestChecked(guest);
  const remaining = guestRemaining(guest);

  return [
    checked > 0 ? "checked in" : "not checked in",
    remaining > 0 ? `${remaining} remaining` : "fully checked in",
    checked > 0 && checked < total ? "partial partially checked in" : "",
    isLateAdd(guest) ? "late add manager approved" : "",
    guest.guest_type === "Do Not Admit" ? "do not admit watch blocked" : ""
  ].join(" ");
}

function guestSearchHaystack(guest, group) {
  const plusOnes = guestPlusCount(guest);
  const lastCheckTime = guest.last_checked_in_at
    ? `${formatClock(guest.last_checked_in_at)} ${new Date(guest.last_checked_in_at).toLocaleString()}`
    : "";

  return [
    guest.first_name,
    guest.last_name,
    `${guest.first_name} ${guest.last_name}`,
    guestDisplayName(guest),
    guest.guest_type,
    guest.notes,
    guest.late_add_approved_by,
    guest.late_add_reason,
    guest.added_by_name,
    group?.name,
    group?.group_type,
    group?.host_name,
    group?.table_location,
    plusOnes ? `plus ${plusOnes} +${plusOnes}` : "plus 0",
    guestStatusSearchText(guest),
    state.activeDate,
    state.activeDay,
    lastCheckTime
  ].join(" ");
}

function groupSearchHaystack(group) {
  const stats = groupStats(group.id);
  const hostGuest = findHostGuestForGroup(group);
  const hostLabel = hostGuest ? guestDisplayName(hostGuest) : group.host_name || "N/A";

  return [
    group.name,
    group.group_type,
    group.host_name,
    hostLabel,
    group.table_location,
    group.approved_by,
    group.notes,
    group.status,
    `${stats.checked} checked in`,
    `${stats.remaining} remaining`,
    `${stats.total} total`,
    state.activeDate,
    state.activeDay
  ].join(" ");
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
  const selected = selectedGroup();
  const key = [
    state.currentMode,
    selected?.id || "",
    state.searchText,
    state.guestFilter || "ALL",
    state.sortMode,
    liveGuestListVersion()
  ].join("||");

  if (visibleGuestCache.key === key) return visibleGuestCache.rows;

  const source = state.currentMode === "GENERAL"
    ? state.guests
    : selected
      ? guestsForGroup(selected.id)
      : [];

  const terms = searchTerms(state.searchText);

  const filtered = source.filter(guest => {
    const group = state.groups.find(item => item.id === guest.group_id);
    return matchesSearchTerms(guestSearchHaystack(guest, group), terms) && guestMatchesStatusFilter(guest);
  });

  visibleGuestCache = { key, rows:sortGuests([...filtered]) };
  return visibleGuestCache.rows;
}

function visibleGroups() {
  const key = [
    state.groupSearchText,
    state.currentMode,
    state.selectedGroupId || "",
    liveGroupListVersion()
  ].join("||");

  if (visibleGroupCache.key === key) return visibleGroupCache.rows;

  const terms = searchTerms(state.groupSearchText);

  visibleGroupCache = { key, rows:specificGroups().filter(group => {
    return matchesSearchTerms(groupSearchHaystack(group), terms);
  }) };

  return visibleGroupCache.rows;
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

function groupDoorLabel(group) {
  if (!group) return "";
  return `${group.name}${group.table_location ? ` / ${group.table_location}` : ""}`;
}

function guestFullNameKey(guest) {
  return normalizeSearchCorpus(`${guest?.first_name || ""} ${guest?.last_name || ""}`);
}

function hostNameKey(name) {
  return normalizeSearchCorpus(name);
}

function parsePlusOnesInput(value, label = "Plus Ones", max = MAX_HOST_PLUS_ONES) {
  const raw = String(value ?? "").trim();
  const number = raw === "" ? 0 : Number(raw);

  if (!Number.isInteger(number) || number < 0 || number > max) {
    throw new Error(`${label} must be a whole number from 0 to ${max}.`);
  }

  return number;
}

function hostGuestsForGroup(groupId) {
  return state.guests.filter(guest => guest.group_id === groupId && String(guest.guest_type || "").toLowerCase() === HOST_GUEST_TYPE.toLowerCase());
}

function findHostGuestForGroup(group, hostName = group?.host_name || "", previousHostName = "") {
  if (!group?.id) return null;

  const hostGuests = hostGuestsForGroup(group.id);
  if (!hostGuests.length) return null;

  const nameKeys = [hostName, previousHostName, group.host_name]
    .map(hostNameKey)
    .filter(Boolean);

  const namedMatch = hostGuests.find(guest => nameKeys.includes(guestFullNameKey(guest)));
  if (namedMatch) return namedMatch;

  return hostGuests.length === 1 ? hostGuests[0] : null;
}

async function upsertPartyHostGuest(group, hostName, hostPlusOnes, options = {}) {
  const name = String(hostName || "").trim();
  if (!name) return null;

  const split = splitFullName(name);
  if (!split.first_name) {
    throw new Error("Host Name is required before saving host plus ones.");
  }

  const existingHost = findHostGuestForGroup(group, name, options.previousHostName || "");
  const totalAllowed = 1 + hostPlusOnes;
  const checkedCount = existingHost ? Math.min(guestChecked(existingHost), totalAllowed) : 0;
  const nowIso = new Date().toISOString();

  const payload = {
    group_id:group.id,
    first_name:split.first_name,
    last_name:split.last_name,
    guest_type:HOST_GUEST_TYPE,
    total_allowed:totalAllowed,
    checked_in_count:checkedCount,
    notes:existingHost?.notes || "",
    last_checked_in_at:existingHost?.last_checked_in_at || null,
    last_checked_in_by_name:existingHost?.last_checked_in_by_name || null,
    last_door_location:existingHost?.last_door_location || null,
    added_by_name:existingHost?.added_by_name || currentUser()?.name || "Management",
    added_by_user_id:existingHost?.added_by_user_id || auth.session?.user?.id || null,
    added_at:existingHost?.added_at || nowIso,
    is_late_add:existingHost?.is_late_add || false,
    late_add_approved_by:existingHost?.late_add_approved_by || null,
    late_add_reason:existingHost?.late_add_reason || null
  };

  const result = existingHost
    ? await withDoorFlowTimeout(
      db.from("guests").update({
        first_name:payload.first_name,
        last_name:payload.last_name,
        guest_type:payload.guest_type,
        total_allowed:payload.total_allowed,
        checked_in_count:payload.checked_in_count,
        notes:payload.notes
      }).eq("id", existingHost.id).select("*").limit(1),
      "Updating party host",
      15000
    )
    : await withDoorFlowTimeout(
      db.from("guests").insert(payload).select("*").limit(1),
      "Creating party host",
      15000
    );

  const savedHost = normalizeGuest(firstRow(must(result.data, result.error)) || {
    ...(existingHost || {}),
    ...payload,
    id:existingHost?.id || `local-host-${Date.now()}`
  });

  state.guests = [
    ...state.guests.filter(guest => guest.id !== savedHost.id),
    savedHost
  ];
  resetDerivedListCaches();

  return savedHost;
}

function updateHostPlusTotal(source, targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;

  const raw = String(source?.value ?? "").trim();
  const plusCount = raw === "" ? 0 : Number(raw);
  target.value = Number.isInteger(plusCount) && plusCount >= 0 ? String(1 + plusCount) : "";
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
  resetDerivedListCaches();
  syncGuestFilterControls();

  if (!refreshVisibleGuestSurface()) {
    render();
  }
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
  return guest ? guestDisplayName(guest) : "Guest record not found";
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

  const result = await withDoorFlowTimeout(
    db
      .from("staff_profiles")
      .select("*")
      .order("full_name", { ascending:true }),
    "Loading staff profiles",
    15000
  );

  if (result.error) {
    state.error = result.error.message;
    render();
    return;
  }

  state.staffProfiles = normalizeRows(result.data, normalizeStaffProfile);
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

  await runDb("Update staff profile", async () => runCriticalAction("Updating staff profile...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("staff_profiles").update(payload).eq("id", id),
      "Updating staff profile",
      15000
    );

    must(result.data, result.error);
    await loadStaffProfilesForAdmin();
    state.lastSyncAt = new Date();
    render();
  }));
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

async function useTodayDate() {
  await setActiveDate(getLocalTodayDateString());
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
  resetDerivedListCaches();
  syncSortControls();

  if (!refreshVisibleGuestSurface()) {
    render();
  }
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
  if (isGuestCheckActionBusy(id)) return;

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
  const previousGuest = normalizeGuest({ ...guest });
  const actionKey = `checkin:${id}`;
  let guestWriteSaved = false;
  const optimisticGuest = normalizeGuest({
    ...guest,
    checked_in_count:newCount,
    last_checked_in_at:nowIso,
    last_checked_in_by_name:user.name,
    last_door_location:state.doorLocation
  });

  try {
    state.error = "";
    activeDoorFlowAction = true;
    lastDoorFlowActionAt = Date.now();
    setActionBusy(actionKey, true);
    updateSyncStatus("Saving", "Checking in guest...");

    Object.assign(guest, optimisticGuest);
    refreshCheckActionSurfaces();

    await prepareDatabaseAction("Check in");

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
    guestWriteSaved = true;

    const logPayload = {
      guest_id:guest.id,
      group_id:guest.group_id,
      action:"Check In 1",
      amount:1,
      door_location:state.doorLocation,
      staff_user_id:null,
      staff_name:user.name
    };

    const logResult = await withDoorFlowTimeout(
      db.from("check_in_logs").insert(logPayload),
      "Saving check-in log",
      12000
    );

    must(logResult.data, logResult.error);

    state.lastSyncAt = new Date();
    updateSyncStatus("Saved", "Check-in saved. Syncing devices.");
    queueBackgroundRefreshAfterWrite();
  } catch (error) {
    console.error(error);
    if (guestWriteSaved) {
      try {
        await restoreGuestCheckState(id, previousGuest);
      } catch (rollbackError) {
        console.warn("DoorFlow check-in rollback failed:", rollbackError);
      }
    }
    Object.assign(guest, previousGuest);
    state.loading = false;
    state.error = "Check in failed: " + (error.message || error);
    updateSyncStatus("Action failed", error.message || String(error));
  } finally {
    activeDoorFlowAction = false;
    lastDoorFlowActionAt = Date.now();
    setActionBusy(actionKey, false);
    refreshCheckActionSurfaces(Boolean(state.error));
  }
}

async function undoOneGuest(id) {
  if (!requirePerm("door")) return;
  if (isGuestCheckActionBusy(id)) return;

  const guest = state.guests.find(item => item.id === id);
  if (!guest) return;

  const checked = guestChecked(guest);
  if (checked <= 0) return;

  const newCount = checked - 1;
  const user = currentUser();
  const previousGuest = normalizeGuest({ ...guest });
  const actionKey = `undo:${id}`;
  let guestWriteSaved = false;
  const optimisticGuest = normalizeGuest({
    ...guest,
    checked_in_count:newCount,
    last_checked_in_at:newCount > 0 ? guest.last_checked_in_at : null,
    last_checked_in_by_name:newCount > 0 ? guest.last_checked_in_by_name : null,
    last_door_location:newCount > 0 ? guest.last_door_location : null
  });

  try {
    state.error = "";
    activeDoorFlowAction = true;
    lastDoorFlowActionAt = Date.now();
    setActionBusy(actionKey, true);
    updateSyncStatus("Saving", "Undoing check-in...");

    Object.assign(guest, optimisticGuest);
    refreshCheckActionSurfaces();

    await prepareDatabaseAction("Undo check-in");

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
    guestWriteSaved = true;

    const logPayload = {
      guest_id:guest.id,
      group_id:guest.group_id,
      action:"Undo 1",
      amount:1,
      door_location:state.doorLocation,
      staff_user_id:null,
      staff_name:user.name
    };

    const logResult = await withDoorFlowTimeout(
      db.from("check_in_logs").insert(logPayload),
      "Saving undo log",
      12000
    );

    must(logResult.data, logResult.error);

    state.lastSyncAt = new Date();
    updateSyncStatus("Saved", "Undo saved. Syncing devices.");
    queueBackgroundRefreshAfterWrite();
  } catch (error) {
    console.error(error);
    if (guestWriteSaved) {
      try {
        await restoreGuestCheckState(id, previousGuest);
      } catch (rollbackError) {
        console.warn("DoorFlow undo rollback failed:", rollbackError);
      }
    }
    Object.assign(guest, previousGuest);
    state.loading = false;
    state.error = "Undo check-in failed: " + (error.message || error);
    updateSyncStatus("Action failed", error.message || String(error));
  } finally {
    activeDoorFlowAction = false;
    lastDoorFlowActionAt = Date.now();
    setActionBusy(actionKey, false);
    refreshCheckActionSurfaces(Boolean(state.error));
  }
}

function toggleGuest(id) {
  if (isGuestCheckActionBusy(id)) return;

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
  const date = state.activeDate;
  let hostPlusOnes = 0;

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

  try {
    hostPlusOnes = parsePlusOnesInput(form.get("host_plus_ones"), "Host Plus Ones");
  } catch (error) {
    alert(error.message || error);
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

    const createdGroup = normalizeGroup(firstRow(must(insertResult.data, insertResult.error)) || {
      ...payload,
      id:`local-group-${Date.now()}`,
      created_at:new Date().toISOString()
    });

    state.activeDate = date;
    state.activeDay = dayNameFromDate(date);
    saveActiveDate(date);
    state.serviceDay = serviceDay;
    state.groups = [createdGroup, ...state.groups.filter(item => item.id !== createdGroup.id)];
    state.selectedGroupId = createdGroup.id;
    state.currentMode = "GROUP";

    await upsertPartyHostGuest(createdGroup, payload.host_name, hostPlusOnes);
    await loadDataForDate(date);

    state.selectedGroupId = createdGroup.id;
    state.currentMode = "GROUP";
    state.modal = null;
    state.lastSyncAt = new Date();
    resetDerivedListCaches();

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
  let hostPlusOnes = 0;
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

  try {
    hostPlusOnes = parsePlusOnesInput(form.get("host_plus_ones"), "Host Plus Ones");
  } catch (error) {
    alert(error.message || error);
    return;
  }

  await runDb("Update group", async () => runCriticalAction("Updating party/group...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("groups").update(payload).eq("id", group.id).select("*").limit(1),
      "Updating party/group",
      15000
    );

    const updatedGroup = normalizeGroup(firstRow(must(result.data, result.error)) || { ...group, ...payload });

    state.groups = state.groups.map(item => item.id === group.id ? updatedGroup : item);
    await upsertPartyHostGuest(updatedGroup, payload.host_name, hostPlusOnes, { previousHostName:group.host_name });
    await loadDataForDate(state.activeDate);

    state.selectedGroupId = updatedGroup.id;
    state.currentMode = "GROUP";
    state.modal = null;
    state.editingGroupId = null;
    state.lastSyncAt = new Date();
    resetDerivedListCaches();

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

  await runDb("Delete group", async () => runCriticalAction("Deleting party/group...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("groups").delete().eq("id", id),
      "Deleting party/group",
      15000
    );
    must(result.data, result.error);

    state.groups = state.groups.filter(item => item.id !== id);
    state.guests = state.guests.filter(item => item.group_id !== id);
    state.selectedGroupId = specificGroups()[0]?.id || null;
    state.currentMode = "GENERAL";
    state.lastSyncAt = new Date();

    render();
    queueBackgroundRefreshAfterWrite();
  }));
}

async function createGuest(event) {
  event.preventDefault();
  if (!requirePerm("manage")) return;

  const form = new FormData(event.target);
  const target = String(form.get("target") || "general");

  const isLateAddEntry = form.get("is_late_add") === "on";

  const payload = {
    group_id:null,
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
    let group = null;

    if (target === "general") {
      group = await withDoorFlowTimeout(getGeneralGroupForActiveDate(), "Finding the General Guest List", 12000);
    } else if (target === "selected") {
      group = selectedGroup();
    } else if (target.startsWith("group:")) {
      const groupId = target.replace("group:", "");
      group = state.groups.find(item => item.id === groupId) || null;
    }

    if (!group) {
      throw new Error(target === "general" ? "DoorFlow could not find the General Guest List for this date. Tap Refresh Data and try again." : "Select or create a group first.");
    }

    payload.group_id = group.id;

    const result = await withDoorFlowTimeout(
      db.from("guests").insert(payload).select("*").limit(1),
      "Adding guest",
      15000
    );

    const insertedGuest = normalizeGuest(firstRow(must(result.data, result.error)) || {
      ...payload,
      id:`local-${Date.now()}`,
      created_at:new Date().toISOString()
    });

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

async function runCriticalAction(label, fn, actionKey = label) {
  activeDoorFlowAction = true;
  lastDoorFlowActionAt = Date.now();
  setActionBusy(actionKey, true);

  try {
    updateSyncStatus("Saving", label);
    return await fn();
  } finally {
    activeDoorFlowAction = false;
    lastDoorFlowActionAt = Date.now();
    setActionBusy(actionKey, false);
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
  const shiftNoteText = mobileDraftValue("mobileShiftNoteText");

  return Boolean(
    quickName ||
    (plusCount && plusCount !== "0") ||
    groupName ||
    groupHost ||
    groupLocation ||
    groupNotes ||
    shiftNoteText
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

  const hostPlus = document.getElementById("mobileGroupHostPlusOnes");
  if (hostPlus) hostPlus.value = "0";

  const hostTotal = document.getElementById("mobileGroupHostTotalAllowed");
  if (hostTotal) hostTotal.value = "1";

  const location = document.getElementById("mobileGroupLocation");
  if (location) location.value = "";
}

function clearMobileShiftNoteFields() {
  const noteText = document.getElementById("mobileShiftNoteText");
  const priority = document.getElementById("mobileShiftNotePriority");

  if (noteText) noteText.value = "";
  if (priority) priority.value = "Normal";
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
    window.__doorFlowMobileSubmitting = true;
    activeDoorFlowAction = true;
    lastDoorFlowActionAt = Date.now();
    showMobileManagerNotice("Adding guest...", "info");
    await prepareDatabaseAction("Mobile quick add guest");

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

    const insertedGuest = normalizeGuest(firstRow(must(insertResult.data, insertResult.error)) || {
      ...payload,
      id:`local-${Date.now()}`,
      created_at:new Date().toISOString()
    });

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
  let hostPlusOnes = 0;
  const location = readMobileField("mobileGroupLocation");
  const approvedBy = readMobileField("mobileGroupApprovedBy") || currentUser()?.name || "Management";
  const notes = readMobileField("mobileGroupNotes");

  if (!name) {
    showMobileManagerNotice("Party / Group Name is required.", "error");
    return;
  }

  try {
    hostPlusOnes = parsePlusOnesInput(readMobileField("mobileGroupHostPlusOnes"), "Host Plus Ones");
  } catch (error) {
    showMobileManagerNotice(error?.message || "Host Plus Ones must be a whole number.", "error");
    return;
  }

  try {
    window.__doorFlowMobileSubmitting = true;
    activeDoorFlowAction = true;
    lastDoorFlowActionAt = Date.now();
    showMobileManagerNotice("Creating party/group...", "info");
    await prepareDatabaseAction("Mobile create party/group");

    const serviceDay = state.serviceDay?.service_date === state.activeDate
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

    const createdGroup = normalizeGroup(firstRow(must(insertResult.data, insertResult.error)) || {
      ...payload,
      id:`local-group-${Date.now()}`,
      created_at:new Date().toISOString()
    });

    if (!state.groups.some(item => item.id === createdGroup.id)) {
      state.groups = [createdGroup, ...state.groups];
    }

    state.selectedGroupId = createdGroup.id;
    state.currentMode = "GROUP";

    await upsertPartyHostGuest(createdGroup, hostName, hostPlusOnes);
    await loadDataForDate(state.activeDate);

    state.selectedGroupId = createdGroup.id;
    state.currentMode = "GROUP";
    state.lastSyncAt = new Date();
    setMobileManagerNotice(`${name} created. You can now add named guests to that list.`, "success");
    resetDerivedListCaches();

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

async function mobileAddShiftNote() {
  if (!requirePerm("manage")) return;
  if (window.__doorFlowMobileSubmitting) return;

  clearMobileManagerNotice();

  const category = readMobileField("mobileShiftNoteCategory") || "General Note";
  const priority = readMobileField("mobileShiftNotePriority") || "Normal";
  const noteText = readMobileField("mobileShiftNoteText");

  if (!noteText) {
    showMobileManagerNotice("Type a shift note before saving.", "error");
    return;
  }

  try {
    window.__doorFlowMobileSubmitting = true;
    activeDoorFlowAction = true;
    lastDoorFlowActionAt = Date.now();
    showMobileManagerNotice("Saving shift note...", "info");
    await prepareDatabaseAction("Mobile shift note");

    const serviceDay = state.serviceDay?.service_date === state.activeDate
      ? state.serviceDay
      : await withDoorFlowTimeout(ensureServiceDay(state.activeDate), "Finding the active service date", 12000);

    const payload = {
      service_day_id:serviceDay.id,
      category:noteCategories.includes(category) ? category : "General Note",
      priority:notePriorities.includes(priority) ? priority : "Normal",
      note_text:noteText,
      created_by_name:currentUser()?.name || "Unknown",
      created_by_user_id:auth.session?.user?.id || null
    };

    const insertResult = await withDoorFlowTimeout(
      db.from("shift_notes").insert(payload).select("*").limit(1),
      "Saving shift note",
      15000
    );

    const insertedNote = normalizeShiftNote(firstRow(must(insertResult.data, insertResult.error)) || {
      ...payload,
      id:`local-note-${Date.now()}`,
      created_at:new Date().toISOString()
    });

    state.shiftNotes = [insertedNote, ...state.shiftNotes.filter(item => item.id !== insertedNote.id)];
    state.lastSyncAt = new Date();
    state.importMessage = "Shift note added.";
    setMobileManagerNotice("Shift note added for door staff.", "success");

    clearMobileShiftNoteFields();
    window.__doorFlowMobileSubmitting = false;
    render();
    queueBackgroundRefreshAfterWrite();
  } catch (error) {
    console.error(error);
    showMobileManagerNotice(error?.message || "Shift note could not be saved. Tap Refresh Data and try again.", "error");
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

  const payload = {
    group_id:null,
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
    let group = null;

    if (target === "general") {
      group = await withDoorFlowTimeout(getGeneralGroupForActiveDate(), "Finding the General Guest List", 12000);
    } else if (target.startsWith("group:")) {
      const groupId = target.replace("group:", "");
      group = state.groups.find(item => item.id === groupId) || null;
    }

    if (!group) {
      throw new Error("Select or create a list/group first.");
    }

    payload.group_id = group.id;

    const result = await withDoorFlowTimeout(
      db.from("guests").insert(payload).select("*").limit(1),
      "Adding guest",
      15000
    );

    const insertedGuest = normalizeGuest(firstRow(must(result.data, result.error)) || {
      ...payload,
      id:`local-${Date.now()}`,
      created_at:new Date().toISOString()
    });

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
  const venueContext = DOORFLOW_VENUE_PRESENTATION.resolve(state.venue?.name || DEFAULT_VENUE_NAME);
  const latestNote = state.shiftNotes[0];
  const recentAdds = recentManagerAdds(5);
  const general = generalGroup();
  const listRows = [
    general ? { id:"general", name:"General Guest List", count:guestsForGroup(general.id).length } : { id:"general", name:"General Guest List", count:0 },
    ...specificGroups().map(group => ({ id:group.id, name:group.name, count:guestsForGroup(group.id).length }))
  ];
  const mobileEditableGroups = specificGroups();
  const mobilePlusGuests = sortGuests([...state.guests]);

  return `
    <div class="mobile-manager-view">
      <section class="mobile-manager-header">
        <div class="mobile-manager-header-top">
          ${renderBrandBlock({ title:"Manager Mode", subtitle:`${venueContext.compactLabel} / ${venueContext.sharedGuestListLabel} / ${state.activeDate}`, variant:"dark", compact:true })}
          <div class="mobile-manager-live-badge">Live</div>
        </div>

        <div class="mobile-manager-stats-grid">
          <div class="mobile-manager-stat-card"><strong>${stats.total}</strong><span>Total</span></div>
          <div class="mobile-manager-stat-card"><strong>${stats.checked}</strong><span>Checked In</span></div>
          <div class="mobile-manager-stat-card"><strong>${stats.remaining}</strong><span>Remaining</span></div>
        </div>
      </section>

      ${renderMobileManagerServiceDateCard()}

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
              ${specificGroups().map(group => `<option value="group:${group.id}">${esc(group.name)}${group.host_name ? ` — ${esc(group.host_name)}` : ""}</option>`).join("")}
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

      <section class="mobile-manager-card">
        <div class="mobile-manager-title-row">
          <div>
            <h2>Adjust Plus Ones</h2>
            <p>Change the allowed plus-one count on an existing host/name.</p>
          </div>
        </div>

        <div class="mobile-manager-form">
          <div>
            <label>Existing Host / Guest</label>
            <select id="mobilePlusGuestSelect">
              <option value="">Select a name</option>
              ${mobilePlusGuests.map(guest => `<option value="${guest.id}">${esc(guestDisplayName(guest))} - ${esc(groupNameForGuest(guest))}</option>`).join("")}
            </select>
          </div>

          <button class="btn secondary mobile-manager-primary-btn" type="button" onclick="openMobilePlusOnesModal()" ${mobilePlusGuests.length ? "" : "disabled"}>Edit Plus Ones</button>
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
              <label>Host Plus Ones</label>
              <input id="mobileGroupHostPlusOnes" type="number" min="0" max="${MAX_HOST_PLUS_ONES}" step="1" value="0" inputmode="numeric" oninput="updateHostPlusTotal(this,'mobileGroupHostTotalAllowed')" />
              <p class="mobile-manager-help">Additional unnamed guests allowed under the host's name.</p>
            </div>

            <div>
              <label>Total Allowed</label>
              <input id="mobileGroupHostTotalAllowed" value="1" readonly />
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
        <div class="mobile-manager-title-row">
          <div>
            <h2>Edit Party / Host</h2>
            <p>Update host name, host plus ones, booth, and party notes.</p>
          </div>
        </div>

        <div class="mobile-manager-form">
          <div>
            <label>Party / Group</label>
            <select id="mobileEditGroupSelect">
              <option value="">Select a party/group</option>
              ${mobileEditableGroups.map(group => `<option value="${group.id}">${esc(group.name)}${group.host_name ? ` - ${esc(group.host_name)}` : ""}</option>`).join("")}
            </select>
          </div>

          <button class="btn secondary mobile-manager-primary-btn" type="button" onclick="openMobileGroupEditModal()" ${mobileEditableGroups.length ? "" : "disabled"}>Edit Party / Host</button>
        </div>
      </section>

      <section class="mobile-manager-card">
        <details class="mobile-manager-details" open>
          <summary>
            <div class="mobile-manager-inline-title">
              <span>📝</span>
              <div>
                <h2>Shift Notes</h2>
                <p>Add notes for door staff</p>
              </div>
            </div>
            <strong>⌄</strong>
          </summary>

          ${latestNote ? `
            <div class="mobile-manager-note-box">
              <strong>${esc(latestNote.category || "Tonight")}:</strong>
              <p>${esc(latestNote.note_text || "")}</p>
              <button class="btn secondary" type="button" onclick="openEditShiftNote('${latestNote.id}')">Edit Latest Note</button>
            </div>
          ` : `<div class="mobile-manager-empty-state">No shift notes have been added yet.</div>`}

          <div class="mobile-manager-form" style="margin-top:14px;">
            <div>
              <label>Category</label>
              <select id="mobileShiftNoteCategory">
                ${noteCategories.map(item => `<option>${esc(item)}</option>`).join("")}
              </select>
            </div>

            <div>
              <label>Priority</label>
              <select id="mobileShiftNotePriority">
                ${notePriorities.map(item => `<option>${esc(item)}</option>`).join("")}
              </select>
            </div>

            <div>
              <label>Note</label>
              <textarea id="mobileShiftNoteText" rows="4" placeholder="Example: VIP table arriving at 10:30 PM. Approved by manager." autocapitalize="sentences"></textarea>
              ${renderEmojiKeyboard("mobileShiftNoteText")}
            </div>

            <button class="btn mobile-manager-primary-btn" type="button" onclick="mobileAddShiftNote()">Add Shift Note</button>
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
                <strong>${esc(guestDisplayName(guest))}</strong>
                <span>${isLateAdd(guest) ? "Late Add" : "Added"}</span>
              </div>
              <div class="row-actions">
                <button type="button" class="btn secondary small" onclick="openPlusOnesModal('${guest.id}')">Edit Plus Ones</button>
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

  await runDb("Update guest", async () => runCriticalAction("Updating guest...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("guests").update(payload).eq("id", guest.id).select("*").limit(1),
      "Updating guest",
      15000
    );

    const updatedGuest = normalizeGuest(firstRow(must(result.data, result.error)) || { ...guest, ...payload });

    state.modal = null;
    state.editingGuestId = null;
    state.guests = state.guests.map(item => item.id === guest.id ? updatedGuest : item);
    state.lastSyncAt = new Date();

    render();
    queueBackgroundRefreshAfterWrite();
  }));
}

async function savePlusOnes(event) {
  event.preventDefault();
  if (!requirePerm("manage")) return;

  const guest = state.guests.find(item => item.id === state.editingPlusGuestId);
  if (!guest) {
    alert("DoorFlow could not find that guest on the selected service date. Tap Refresh Data and try again.");
    return;
  }

  const group = state.groups.find(item => item.id === guest.group_id);
  if (!group || (state.serviceDay?.id && group.service_day_id !== state.serviceDay.id)) {
    alert("This guest is not on the currently selected service date. Refresh Data before changing plus ones.");
    return;
  }

  const form = new FormData(event.target);
  const rawPlusCount = String(form.get("plus_count") || "").trim();
  const plusCount = Number(rawPlusCount);
  const approvedBy = String(form.get("approved_by") || "").trim();
  const reason = String(form.get("reason") || "").trim();

  if (rawPlusCount === "" || !Number.isInteger(plusCount) || plusCount < 0 || plusCount > 20) {
    alert("New Plus Ones must be a whole number from 0 to 20.");
    return;
  }

  if (!approvedBy) {
    alert("Approved By is required before changing plus ones.");
    return;
  }

  const totalAllowed = 1 + plusCount;
  const checkedCount = guestChecked(guest);

  if (totalAllowed < checkedCount) {
    alert(`This guest already has ${checkedCount} checked in. Set plus ones to at least +${Math.max(0, checkedCount - 1)} or undo check-ins first.`);
    return;
  }

  const oldPlusCount = guestPlusCount(guest);
  const noteLine = `Plus ones adjusted from +${oldPlusCount} to +${plusCount} by ${approvedBy}${reason ? `: ${reason}` : ""}`;
  const payload = {
    total_allowed:totalAllowed,
    checked_in_count:checkedCount,
    notes:appendGuestNote(guest.notes, noteLine)
  };

  await runDb("Adjust plus ones", async () => runCriticalAction("Adjusting plus ones...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("guests").update(payload).eq("id", guest.id).select("*").limit(1),
      "Adjusting plus ones",
      15000
    );

    const updatedGuest = normalizeGuest(firstRow(must(result.data, result.error)) || { ...guest, ...payload });

    state.guests = state.guests.map(item => item.id === guest.id ? updatedGuest : item);
    state.lastSyncAt = new Date();
    resetDerivedListCaches();

    try {
      const user = currentUser();
      await withDoorFlowTimeout(db.from("check_in_logs").insert({
        guest_id:guest.id,
        group_id:guest.group_id,
        action:`Adjust Plus Ones +${oldPlusCount} to +${plusCount}`,
        amount:Math.abs(plusCount - oldPlusCount),
        door_location:state.doorLocation,
        staff_user_id:null,
        staff_name:user?.name || approvedBy
      }), "Logging plus-one adjustment", 8000);
    } catch (error) {
      console.warn("DoorFlow plus-one adjustment log skipped:", error);
    }

    await loadDataForDate(state.activeDate);

    state.modal = null;
    state.editingPlusGuestId = null;
    state.lastSyncAt = new Date();
    resetDerivedListCaches();

    render();
  }, `plus:${guest.id}`));
}

async function deleteGuest(id) {
  if (!requirePerm("manage")) return;
  if (!confirm("Delete this name from the list?")) return;

  await runDb("Delete guest", async () => runCriticalAction("Deleting guest...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("guests").delete().eq("id", id),
      "Deleting guest",
      15000
    );
    must(result.data, result.error);
    state.guests = state.guests.filter(item => item.id !== id);
    state.lastSyncAt = new Date();
    render();
    queueBackgroundRefreshAfterWrite();
  }));
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

  await runDb("Clear General Guest List", async () => runCriticalAction("Clearing General Guest List...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("guests").delete().eq("group_id", group.id),
      "Clearing General Guest List",
      15000
    );
    must(result.data, result.error);

    state.guests = state.guests.filter(item => item.group_id !== group.id);
    state.importMessage = `Cleared ${count} name${count === 1 ? "" : "s"} from General Guest List.`;
    state.lastSyncAt = new Date();

    render();
    queueBackgroundRefreshAfterWrite();
  }));
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

  await runDb("Clear group names", async () => runCriticalAction("Clearing group names...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("guests").delete().eq("group_id", group.id),
      "Clearing group names",
      15000
    );
    must(result.data, result.error);

    state.guests = state.guests.filter(item => item.group_id !== group.id);
    state.importMessage = `Cleared ${count} name${count === 1 ? "" : "s"} from ${group.name}.`;
    state.lastSyncAt = new Date();

    render();
    queueBackgroundRefreshAfterWrite();
  }));
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

  const defaultType = String(form.get("defaultType") || "Guest");
  const bulkText = String(form.get("bulkNames") || "").trim();

  if (!bulkText) {
    alert("Paste at least one name first.");
    return;
  }

  const rows = parseBulkNames(bulkText)
    .filter(item => item.first_name && item.last_name)
    .map(item => ({
      group_id:null,
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

  await runDb("Bulk add names", async () => runCriticalAction("Adding pasted names...", async () => {
    let group = null;

    if (target === "general") {
      group = await withDoorFlowTimeout(getGeneralGroupForActiveDate(), "Finding the General Guest List", 12000);
    } else if (target === "selected") {
      group = selectedGroup();
    } else if (target.startsWith("group:")) {
      const groupId = target.replace("group:", "");
      group = state.groups.find(item => item.id === groupId) || null;
    }

    if (!group) {
      throw new Error("Select or create a group first.");
    }

    const rowsForInsert = rows.map(row => ({ ...row, group_id:group.id }));
    const result = await withDoorFlowTimeout(
      db.from("guests").insert(rowsForInsert).select("*"),
      "Adding pasted names",
      18000
    );
    must(result.data, result.error);

    state.selectedGroupId = group.id;
    state.currentMode = target === "general" ? "GENERAL" : "GROUP";
    state.importMessage = `Bulk added ${rows.length} name${rows.length === 1 ? "" : "s"} into ${group.name}.`;
    state.modal = null;
    state.guests = [...state.guests, ...normalizeRows((result.data && result.data.length) ? result.data : rowsForInsert, normalizeGuest)];
    state.lastSyncAt = new Date();

    render();
    queueBackgroundRefreshAfterWrite();
  }));
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

  const valid = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const guest = rowToGuest(row, null);

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

  await runDb("Import file", async () => runCriticalAction("Importing names...", async () => {
    let group = null;

    if (targetMode === "general") {
      group = await withDoorFlowTimeout(getGeneralGroupForActiveDate(), "Finding the General Guest List", 12000);
    } else if (targetMode === "selected") {
      group = selectedGroup();
    } else if (targetMode.startsWith("group:")) {
      const groupId = targetMode.replace("group:", "");
      group = state.groups.find(item => item.id === groupId) || null;
    }

    if (!group) {
      throw new Error(targetMode === "general" ? "DoorFlow could not find the General Guest List for this date. Tap Refresh Data and try again." : "Select or create a group first.");
    }

    const validForInsert = valid.map(guest => ({ ...guest, group_id:group.id }));
    const result = await withDoorFlowTimeout(
      db.from("guests").insert(validForInsert).select("*"),
      "Importing names",
      18000
    );
    must(result.data, result.error);

    state.selectedGroupId = group.id;
    state.importMessage = `Imported ${valid.length} name${valid.length === 1 ? "" : "s"} into ${group.name}. ${skipped.length ? `Skipped ${skipped.length} row${skipped.length === 1 ? "" : "s"}.` : ""}`;
    state.guests = [...state.guests, ...normalizeRows((result.data && result.data.length) ? result.data : validForInsert, normalizeGuest)];
    state.lastSyncAt = new Date();

    render();
    queueBackgroundRefreshAfterWrite();
  }));
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
    ["Date","Day","Group","Group Type","Host","Table","First Name","Last Name","Display Name","Plus Ones","Guest Type","Total Allowed","Checked In Count","Remaining","Fully Checked In","Late Add","Approved By","Late Add Reason","Added By","Added At","Checked In At","Checked In By","Door","Notes"],
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
        guestDisplayName(guest),
        guestPlusCount(guest),
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

const noteEmojiOptions = [
  { label:"Star", value:"\u2b50" },
  { label:"Fire", value:"\ud83d\udd25" },
  { label:"Alert", value:"\ud83d\udea8" },
  { label:"Check", value:"\u2705" },
  { label:"Crown", value:"\ud83d\udc51" },
  { label:"Bottle", value:"\ud83c\udf7e" },
  { label:"Birthday", value:"\ud83c\udf82" },
  { label:"Warning", value:"\u26a0\ufe0f" },
  { label:"Money", value:"\ud83d\udcb5" },
  { label:"Clipboard", value:"\ud83d\udccb" },
  { label:"Door", value:"\ud83d\udeaa" },
  { label:"Headset", value:"\ud83c\udfa7" },
  { label:"Ice", value:"\ud83e\uddca" },
  { label:"Clean", value:"\ud83e\uddf9" },
  { label:"Note", value:"\ud83d\udcdd" }
];

function insertEmojiIntoField(targetId, emoji) {
  const field = document.getElementById(targetId);
  if (!field) return;

  if (typeof field.setRangeText === "function" && typeof field.selectionStart === "number") {
    field.setRangeText(emoji, field.selectionStart, field.selectionEnd, "end");
  } else {
    field.value = `${field.value || ""}${emoji}`;
  }

  field.dispatchEvent(new Event("input", { bubbles:true }));
  field.focus();
  markUserInputActivity();
}

function renderEmojiKeyboard(targetId) {
  return `
    <div class="emoji-keyboard" aria-label="Emoji keyboard">
      ${noteEmojiOptions.map(item => `
        <button class="emoji-key" type="button" title="${esc(item.label)}" aria-label="Insert ${esc(item.label)} emoji" onclick="insertEmojiIntoField('${esc(targetId)}', '${esc(item.value)}')">${esc(item.value)}</button>
      `).join("")}
    </div>
  `;
}

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

  const form = new FormData(event.target);

  const payload = {
    service_day_id:null,
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

  await runDb("Create shift note", async () => runCriticalAction("Adding shift note...", async () => {
    const serviceDay = state.serviceDay?.service_date === state.activeDate
      ? state.serviceDay
      : await withDoorFlowTimeout(ensureServiceDay(state.activeDate), "Finding the active service date", 12000);

    payload.service_day_id = serviceDay.id;

    const result = await withDoorFlowTimeout(
      db.from("shift_notes").insert(payload).select("*").limit(1),
      "Adding shift note",
      15000
    );

    const insertedNote = normalizeShiftNote(firstRow(must(result.data, result.error)) || {
      ...payload,
      id:`local-note-${Date.now()}`,
      created_at:new Date().toISOString()
    });

    event.target.reset();
    state.shiftNotes = [insertedNote, ...state.shiftNotes.filter(item => item.id !== insertedNote.id)];
    state.lastSyncAt = new Date();
    state.importMessage = "Shift note added.";
    render();
    queueBackgroundRefreshAfterWrite();
  }));
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

  await runDb("Update shift note", async () => runCriticalAction("Updating shift note...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("shift_notes").update(payload).eq("id", note.id).select("*").limit(1),
      "Updating shift note",
      15000
    );

    const updatedNote = normalizeShiftNote(firstRow(must(result.data, result.error)) || { ...note, ...payload });

    state.editingShiftNoteId = null;
    state.modal = null;
    state.shiftNotes = state.shiftNotes.map(item => item.id === note.id ? updatedNote : item);
    state.lastSyncAt = new Date();
    state.importMessage = "Shift note updated.";
    render();
    queueBackgroundRefreshAfterWrite();
  }));
}

async function deleteShiftNote(id) {
  if (!requirePerm("manage")) return;

  if (!confirm("Delete this shift note?")) return;

  await runDb("Delete shift note", async () => runCriticalAction("Deleting shift note...", async () => {
    const result = await withDoorFlowTimeout(
      db.from("shift_notes").delete().eq("id", id),
      "Deleting shift note",
      15000
    );
    must(result.data, result.error);

    state.shiftNotes = state.shiftNotes.filter(item => item.id !== id);
    state.lastSyncAt = new Date();
    state.importMessage = "Shift note deleted.";
    render();
    queueBackgroundRefreshAfterWrite();
  }));
}

function renderShiftNotesPanel(showComposer = true) {
  const notes = state.shiftNotes || [];

  return `
    <section class="card df-admin-card df-shift-notes-panel" aria-labelledby="shift-notes-title">
      <header class="df-admin-section-header">
        <div>
          <p class="df-admin-kicker">Service-day record</p>
          <h2 id="shift-notes-title">Manager / Shift Notes</h2>
          <p>Adding to <strong>${esc(state.activeDate)}</strong>. Use this for live notes that door staff and managers need for the night.</p>
        </div>
        <span class="df-status-badge df-status-badge--neutral">${notes.length} ${notes.length === 1 ? "note" : "notes"}</span>
      </header>

      ${showComposer && perms()?.manage ? `
        <form onsubmit="createShiftNote(event)" class="form df-admin-form df-shift-note-composer">
          <div class="two">
            <div>
              <label for="shiftNoteCategory">Category</label>
              <select id="shiftNoteCategory" name="category">
                ${noteCategories.map(item => `<option>${esc(item)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label for="shiftNotePriority">Priority</label>
              <select id="shiftNotePriority" name="priority">
                ${notePriorities.map(item => `<option>${esc(item)}</option>`).join("")}
              </select>
            </div>
          </div>

          <div>
            <label for="shiftNoteComposerText">Note</label>
            <textarea id="shiftNoteComposerText" name="note_text" rows="4" placeholder="Example: VIP table arriving around 10:30 PM. Approved by manager."></textarea>
            ${renderEmojiKeyboard("shiftNoteComposerText")}
          </div>

          <div class="row-actions">
            <button class="btn" type="submit">Add Shift Note</button>
          </div>
        </form>
      ` : ""}

      ${notes.length ? `
        <div class="shift-note-list">
          ${notes.map(note => `
            <article class="shift-note-card df-shift-note-record">
              <div class="party-meta">
                <span class="badge ${noteCategoryClass(note.category)}">${esc(note.category || "General Note")}</span>
                <span class="badge ${notePriorityClass(note.priority)}">${esc(note.priority || "Normal")}</span>
                <span class="badge general">${esc(noteTime(note))}</span>
                <span class="badge general">By ${esc(note.created_by_name || "Unknown")}</span>
              </div>

              <p class="shift-note-text">${esc(note.note_text || "")}</p>

              ${perms()?.manage ? `
                <div class="row-actions">
                  <button type="button" class="btn secondary small" onclick="openEditShiftNote('${note.id}')">Edit Note</button>
                  <button type="button" class="btn danger small" onclick="deleteShiftNote('${note.id}')">Delete Note</button>
                </div>
              ` : ""}
            </article>
          `).join("")}
        </div>
      ` : `
        ${renderAdminState("empty", "No shift notes", "No manager or shift notes have been added for this date yet.")}
      `}
    </section>
  `;
}



function renderShiftNotesForDoorStaff() {
  const notes = state.shiftNotes || [];

  if (!notes.length) {
    return `
      <section class="card df-door-shift-notes df-door-shift-notes--empty" aria-labelledby="door-shift-notes-title">
        <header class="df-door-section-heading">
          <div><p class="df-door-kicker">Shift brief</p><h2 id="door-shift-notes-title">Manager / Shift Notes</h2></div>
        </header>
        <div class="df-door-empty-state" role="status"><strong>No shift notes</strong><span>No manager or shift notes have been added for this date yet.</span></div>
      </section>
    `;
  }

  return `
    <section class="card df-door-shift-notes" aria-labelledby="door-shift-notes-title">
      <header class="df-door-section-heading">
        <div><p class="df-door-kicker">Shift brief</p><h2 id="door-shift-notes-title">Manager / Shift Notes</h2></div>
        <p>Read these before working the door. These are live instructions from management for the active service day.</p>
      </header>

      <div class="row-actions df-door-note-actions">
        <button type="button" class="btn secondary small" onclick="loadDataForDate(state.activeDate)">Refresh Notes</button>
      </div>

      <div class="shift-note-list df-door-note-list">
        ${notes.map(note => `
          <article class="shift-note-card df-door-note-card">
            <div class="party-meta">
              <span class="badge ${noteCategoryClass(note.category)}">${esc(note.category || "General Note")}</span>
              <span class="badge ${notePriorityClass(note.priority)}">${esc(note.priority || "Normal")}</span>
              <span class="badge general">${esc(noteTime(note))}</span>
              <span class="badge general">By ${esc(note.created_by_name || "Unknown")}</span>
            </div>

            <p class="shift-note-text">${esc(note.note_text || "")}</p>
          </article>
        `).join("")}
      </div>
    </section>
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
        display_name:guestDisplayName(guest),
        first_name:guest.first_name,
        last_name:guest.last_name,
        guest_type:guest.guest_type,
        plus_ones:guestPlusCount(guest),
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
      display_name:guestDisplayName(guest),
      first_name:guest.first_name,
      last_name:guest.last_name,
      group_name:groupNameForGuest(guest),
      guest_type:guest.guest_type,
      plus_ones:guestPlusCount(guest),
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
    venue:state.venue?.name || DEFAULT_VENUE_NAME,
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
      display_name:guestDisplayName(guest),
      first_name:guest.first_name,
      last_name:guest.last_name,
      group_name:groupNameForGuest(guest),
      guest_type:guest.guest_type,
      plus_ones:guestPlusCount(guest),
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
        <td>${esc(guest.display_name || `${guest.first_name} ${guest.last_name}`)}</td>
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
      <h2 style="margin-bottom:4px;">${esc(BOB_BRAND.appName)} Close Out Report</h2>
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
    ["Section","Group","Guest","Plus Ones","Guest Type","Total Allowed","Checked In","Remaining","Late Add","Approved By","Reason/Notes","Added By","Added At"],
    ...report.groups.flatMap(group => group.guests.map(guest => [
      "Guest",
      group.group_name,
      guest.display_name || `${guest.first_name} ${guest.last_name}`,
      guest.plus_ones,
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
  const venueContext = DOORFLOW_VENUE_PRESENTATION.resolve(report.venue);
  const lateAdds = report.late_adds || [];
  const noShows = report.no_shows || [];
  const shiftNotes = report.shift_notes || [];
  const activityLogs = report.activity_logs || [];
  const generatedAt = new Date(report.generated_at).toLocaleString();

  return `
    <div class="modal-backdrop df-admin-modal-backdrop df-closeout-report-backdrop">
      <article class="modal df-admin-modal df-closeout-modal df-closeout-report" role="dialog" aria-modal="true" aria-labelledby="closeout-report-title" aria-describedby="closeout-report-context" tabindex="-1">
        <header class="df-closeout-report__header">
          <div class="df-closeout-report__identity">
            <span class="df-closeout-report__monogram" aria-hidden="true">${esc(shellInitials(venueContext.parentVenue, "V"))}</span>
            <div class="df-closeout-report__heading">
              <p class="df-closeout-report__eyebrow">DoorFlow operational report</p>
              <h2 id="closeout-report-title">Close Out Report</h2>
              <p id="closeout-report-context" class="df-closeout-report__context"><strong>${esc(venueContext.reportLabel)}</strong><span>${esc(venueContext.sharedGuestListLabel)}</span><span aria-hidden="true">&middot;</span><span>${esc(report.day_name)} ${esc(report.service_date)}</span></p>
              <p class="df-closeout-report__generated">Generated by ${esc(report.generated_by)} on ${esc(generatedAt)}</p>
            </div>
          </div>

          <div class="df-closeout-report__actions" aria-label="Report actions">
            <button type="button" class="btn secondary" onclick="downloadCloseOutReportCsv()">Export Report CSV</button>
            <button type="button" class="btn secondary" onclick="printCloseOutReport()">Print</button>
            <button class="df-modal-close df-closeout-report__close" type="button" onclick="closeModal()" aria-label="Close report" title="Close report">&times;</button>
          </div>
        </header>

        <section class="df-closeout-report__summary" aria-label="Closeout summary">
          <article class="df-closeout-report__metric"><span>Total Allowed</span><strong>${report.summary.total_allowed}</strong></article>
          <article class="df-closeout-report__metric df-closeout-report__metric--success"><span>Checked In</span><strong>${report.summary.checked_in}</strong></article>
          <article class="df-closeout-report__metric df-closeout-report__metric--warning"><span>Remaining / No-Shows</span><strong>${report.summary.remaining}</strong></article>
          <article class="df-closeout-report__metric"><span>Late Adds</span><strong>${lateAdds.length}</strong></article>
        </section>

        <div class="df-closeout-report__body">

          <section class="df-closeout-report__section" aria-labelledby="closeout-groups-title">
            <header class="df-closeout-report__section-header"><div><p class="df-closeout-report__section-kicker">Attendance</p><h3 id="closeout-groups-title">Group Breakdown</h3><p>Attendance totals by group for the selected service date.</p></div></header>
            ${report.groups.length ? `
              <div class="df-closeout-report__table-wrap" role="region" aria-label="Group Breakdown table" tabindex="0">
                <table class="df-closeout-report__table">
                  <caption class="sr-only">Group attendance breakdown</caption>
                  <thead><tr><th scope="col">Group</th><th scope="col">Type</th><th scope="col">Host</th><th scope="col">Table</th><th scope="col">Allowed</th><th scope="col">Checked In</th><th scope="col">Remaining</th></tr></thead>
                  <tbody>
                    ${report.groups.map(group => `
                      <tr>
                        <td data-label="Group"><strong>${esc(group.group_name)}</strong></td>
                        <td data-label="Type">${esc(group.group_type)}</td>
                        <td data-label="Host">${esc(group.host_name || "")}</td>
                        <td data-label="Table">${esc(group.table_location || "")}</td>
                        <td class="df-closeout-report__number" data-label="Allowed">${group.total_allowed}</td>
                        <td class="df-closeout-report__number" data-label="Checked In">${group.checked_in}</td>
                        <td class="df-closeout-report__number" data-label="Remaining">${group.remaining}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `<div class="df-closeout-report__empty" role="status"><span aria-hidden="true">&#8212;</span><p>No groups recorded.</p></div>`}
          </section>

          <section class="df-closeout-report__section" aria-labelledby="closeout-late-adds-title">
            <header class="df-closeout-report__section-header"><div><p class="df-closeout-report__section-kicker">Review</p><h3 id="closeout-late-adds-title">Late Adds</h3><p>Manager-approved additions recorded for this service date.</p></div></header>
            ${lateAdds.length ? `
              <div class="df-closeout-report__table-wrap" role="region" aria-label="Late Adds table" tabindex="0">
                <table class="df-closeout-report__table">
                  <caption class="sr-only">Late additions for the selected service date</caption>
                  <thead><tr><th scope="col">Guest</th><th scope="col">Group</th><th scope="col">Type</th><th scope="col">Approved By</th><th scope="col">Reason</th><th scope="col">Added By</th><th scope="col">Added At</th></tr></thead>
                  <tbody>
                    ${lateAdds.map(guest => `
                      <tr>
                        <td data-label="Guest"><strong>${esc(guest.display_name || `${guest.first_name} ${guest.last_name}`)}</strong></td>
                        <td data-label="Group">${esc(guest.group_name)}</td>
                        <td data-label="Type">${esc(guest.guest_type)}</td>
                        <td data-label="Approved By">${esc(guest.approved_by || "")}</td>
                        <td data-label="Reason">${esc(guest.reason || "")}</td>
                        <td data-label="Added By">${esc(guest.added_by || "")}</td>
                        <td data-label="Added At">${guest.added_at ? esc(new Date(guest.added_at).toLocaleString()) : ""}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `<div class="df-closeout-report__empty" role="status"><span aria-hidden="true">&#8212;</span><p>No late adds recorded.</p></div>`}
          </section>

          <section class="df-closeout-report__section" aria-labelledby="closeout-no-shows-title">
            <header class="df-closeout-report__section-header"><div><p class="df-closeout-report__section-kicker">Remaining attendance</p><h3 id="closeout-no-shows-title">No-Shows / Remaining Guests</h3><p>Guests with attendance still remaining at the time of this report.</p></div></header>
            ${noShows.length ? `
              <div class="df-closeout-report__table-wrap" role="region" aria-label="No-Shows and Remaining Guests table" tabindex="0">
                <table class="df-closeout-report__table">
                  <caption class="sr-only">No-shows and guests remaining</caption>
                  <thead><tr><th scope="col">Guest</th><th scope="col">Group</th><th scope="col">Type</th><th scope="col">Checked In</th><th scope="col">Remaining</th><th scope="col">Notes</th></tr></thead>
                  <tbody>
                    ${noShows.map(guest => `
                      <tr>
                        <td data-label="Guest"><strong>${esc(guest.display_name || `${guest.first_name} ${guest.last_name}`)}</strong></td>
                        <td data-label="Group">${esc(guest.group_name)}</td>
                        <td data-label="Type">${esc(guest.guest_type)}</td>
                        <td class="df-closeout-report__number" data-label="Checked In">${guest.checked_in_count}/${guest.total_allowed}</td>
                        <td class="df-closeout-report__number" data-label="Remaining">${guest.remaining}</td>
                        <td data-label="Notes">${esc(guest.notes || "")}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `<div class="df-closeout-report__empty" role="status"><span aria-hidden="true">&#8212;</span><p>No no-shows / remaining guests.</p></div>`}
          </section>

          <section class="df-closeout-report__section" aria-labelledby="closeout-notes-title">
            <header class="df-closeout-report__section-header"><div><p class="df-closeout-report__section-kicker">Shift record</p><h3 id="closeout-notes-title">Manager / Shift Notes</h3><p>Operational notes recorded by management for this service date.</p></div></header>
            ${shiftNotes.length ? `
              <div class="df-closeout-report__table-wrap" role="region" aria-label="Manager and Shift Notes table" tabindex="0">
                <table class="df-closeout-report__table">
                  <caption class="sr-only">Manager and shift notes</caption>
                  <thead><tr><th scope="col">Category</th><th scope="col">Priority</th><th scope="col">Note</th><th scope="col">By</th><th scope="col">Time</th></tr></thead>
                  <tbody>
                    ${shiftNotes.map(note => `
                      <tr>
                        <td data-label="Category">${esc(note.category || "")}</td>
                        <td data-label="Priority">${esc(note.priority || "")}</td>
                        <td data-label="Note">${esc(note.note_text || "")}</td>
                        <td data-label="By">${esc(note.created_by_name || "")}</td>
                        <td data-label="Time">${note.created_at ? esc(new Date(note.created_at).toLocaleString()) : ""}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `<div class="df-closeout-report__empty" role="status"><span aria-hidden="true">&#8212;</span><p>No shift notes recorded.</p></div>`}
          </section>

          <section class="df-closeout-report__section" aria-labelledby="closeout-activity-title">
            <header class="df-closeout-report__section-header"><div><p class="df-closeout-report__section-kicker">Door record</p><h3 id="closeout-activity-title">Recent Door Activity</h3><p>The most recent recorded check-in activity for this service date.</p></div></header>
            ${activityLogs.length ? `
              <div class="df-closeout-report__table-wrap" role="region" aria-label="Recent Door Activity table" tabindex="0">
                <table class="df-closeout-report__table">
                  <caption class="sr-only">Recent door activity</caption>
                  <thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Guest</th><th scope="col">Group</th><th scope="col">Staff</th><th scope="col">Door</th></tr></thead>
                  <tbody>
                    ${activityLogs.slice(0,60).map(log => `
                      <tr>
                        <td data-label="Time">${log.time ? esc(new Date(log.time).toLocaleString()) : ""}</td>
                        <td data-label="Action">${esc(log.action || "")}</td>
                        <td data-label="Guest"><strong>${esc(log.guest_name || "")}</strong></td>
                        <td data-label="Group">${esc(log.group_name || "")}</td>
                        <td data-label="Staff">${esc(log.staff_name || "")}</td>
                        <td data-label="Door">${esc(log.door_location || "")}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `<div class="df-closeout-report__empty" role="status"><span aria-hidden="true">&#8212;</span><p>No recent activity logs recorded.</p></div>`}
          </section>
        </div>

        <footer class="df-closeout-report__footer"><span>DoorFlow operational closeout report</span><span>End of report</span></footer>
      </article>
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

function openPlusOnesModal(id) {
  if (!requirePerm("manage")) return;
  state.editingPlusGuestId = id;
  state.modal = "plusOnes";
  render();
}

function openMobilePlusOnesModal() {
  if (!requirePerm("manage")) return;

  const id = String(document.getElementById("mobilePlusGuestSelect")?.value || "");
  if (!id) {
    showMobileManagerNotice("Select an existing guest before editing plus ones.", "error");
    return;
  }

  openPlusOnesModal(id);
}

function openMobileGroupEditModal() {
  if (!requirePerm("manage")) return;

  const id = String(document.getElementById("mobileEditGroupSelect")?.value || "");
  if (!id) {
    showMobileManagerNotice("Select a party/group before editing.", "error");
    return;
  }

  openGroupModal(id);
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
  state.editingPlusGuestId = null;
  state.editingShiftNoteId = null;
  render();

  if (auth.currentUser && state.pendingSync) {
    setTimeout(() => flushPendingSync("modal-close"), 150);
  }
}

/* RENDER */

function renderDoorFlowLockup() {
  return `
    <span class="df-doorflow-lockup" aria-label="DoorFlow">
      <span class="df-doorflow-mark" aria-hidden="true"></span>
      <span class="df-doorflow-wordmark">Door<span>Flow</span></span>
    </span>
  `;
}

function shellInitials(value, fallback = "DF") {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  return words.slice(0, 2).map(word => word[0]).join("").toUpperCase();
}

function shellUsesDrawer() {
  return window.matchMedia("(max-width: 1080px)").matches;
}

function setShellNavOpen(open, restoreFocus = false) {
  const shouldOpen = Boolean(open && shellUsesDrawer());
  state.shellNavOpen = shouldOpen;

  const sidebar = document.getElementById("df-primary-sidebar");
  const backdrop = document.getElementById("df-nav-backdrop");
  const menuButton = document.getElementById("df-shell-menu");

  sidebar?.classList.toggle("is-open", shouldOpen);
  if (sidebar) {
    if (!shouldOpen && shellUsesDrawer()) sidebar.setAttribute("inert", "");
    else sidebar.removeAttribute("inert");
  }
  if (backdrop) backdrop.hidden = !shouldOpen;
  if (menuButton) {
    menuButton.setAttribute("aria-expanded", String(shouldOpen));
    menuButton.setAttribute("aria-label", shouldOpen ? "Close navigation menu" : "Open navigation menu");
    menuButton.title = shouldOpen ? "Close navigation menu" : "Open navigation menu";
    const symbol = menuButton.querySelector("[data-shell-menu-symbol]");
    if (symbol) symbol.textContent = shouldOpen ? "\u00d7" : "\u2630";
  }

  document.body.classList.toggle("df-shell-nav-open", shouldOpen);
  if (restoreFocus) menuButton?.focus();
}

function toggleShellNav() {
  setShellNavOpen(!state.shellNavOpen);
}

function closeShellNav(restoreFocus = false) {
  setShellNavOpen(false, restoreFocus);
}

function shellNavigate(view) {
  closeShellNav(false);
  switchView(view);
}

function handleShellKeydown(event) {
  if (event.key === "Escape" && state.shellNavOpen) {
    event.preventDefault();
    closeShellNav(true);
  }
}

function renderLogin() {
  state.shellNavOpen = false;
  document.body.classList.remove("df-shell-nav-open");

  return `
    <div class="df-login-screen">
      <section class="df-login-brand-panel" aria-label="DoorFlow hospitality operations">
        ${renderDoorFlowLockup()}
        <div class="df-login-brand-copy">
          <p class="df-login-eyebrow">Hospitality operations</p>
          <h1>Welcome to DoorFlow.</h1>
          <p>Guest list, arrival, and closeout tools for your venue team.</p>
        </div>
        <p class="df-login-brand-foot">Secure staff access for authorized venue teams.</p>
      </section>

      <main class="df-login-form-panel">
        <div class="df-login-card">
          <p class="df-login-eyebrow">Staff access</p>
          <h2>Sign in</h2>
          <p>Use your authorized DoorFlow staff account.</p>

          ${state.error ? `<div class="notice redbox" role="alert"><strong>Error:</strong> ${esc(state.error)}</div>` : ""}

          <form onsubmit="login(event)" class="form">
            <div>
              <label for="df-login-email">Email</label>
              <input id="df-login-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" />
            </div>
            <div>
              <label for="df-login-password">Password</label>
              <input id="df-login-password" name="password" type="password" autocomplete="current-password" />
            </div>
            <button class="btn" type="submit">Log In</button>
          </form>

          <p class="df-login-help">Access and available tools are determined by your active staff profile.</p>
        </div>
      </main>
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

function renderBrandBlock(options = {}) {
  const title = options.title || BOB_BRAND.appName;
  const subtitle = options.subtitle || "";
  const variant = options.variant || "default";
  const logoSrc = variant === "dark" ? BOB_BRAND.darkLogoSrc : BOB_BRAND.logoSrc;
  const compactClass = options.compact ? " compact-brand" : "";

  return `
    <div class="brand bob-brand ${esc(variant)}${compactClass}">
      <div class="logo bob-logo-shell" aria-label="${esc(BOB_BRAND.fallback)}">
        <span class="bob-logo-fallback">${esc(BOB_BRAND.fallback)}</span>
        <img class="bob-logo-img" src="${esc(logoSrc)}" alt="${esc(BOB_BRAND.fallback)} logo" loading="eager" decoding="async" onerror="this.hidden=true" />
      </div>
      <div>
        <h1>${esc(title)}</h1>
        ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
      </div>
    </div>
  `;
}

function renderTopbar() {
  const user = currentUser();
  const venueContext = DOORFLOW_VENUE_PRESENTATION.resolve(state.venue?.name || DEFAULT_VENUE_NAME);
  const venueInitials = shellInitials(venueContext.parentVenue, "V");
  const userInitials = shellInitials(user.name, "U");

  return `
    <header class="df-utility-bar">
      <div class="df-utility-inner">
        <button id="df-shell-menu" class="df-shell-menu" type="button" aria-controls="df-primary-sidebar" aria-expanded="${state.shellNavOpen ? "true" : "false"}" aria-label="${state.shellNavOpen ? "Close" : "Open"} navigation menu" title="${state.shellNavOpen ? "Close" : "Open"} navigation menu" onclick="toggleShellNav()">
          <span data-shell-menu-symbol aria-hidden="true">${state.shellNavOpen ? "&times;" : "&#9776;"}</span>
        </button>

        <div class="df-shell-venue" aria-label="Parent venue ${esc(venueContext.parentVenue)}${venueContext.operatingSpace ? `; operating space ${esc(venueContext.operatingSpace)}` : ""}; ${esc(venueContext.sharedGuestListLabel)}">
          <span class="df-venue-monogram" aria-hidden="true">${esc(venueInitials)}</span>
          <div class="df-venue-copy df-venue-hierarchy">
            <div class="df-venue-hierarchy__expanded">
              <div class="df-venue-hierarchy__item"><span class="df-utility-label">Venue</span><strong>${esc(venueContext.parentVenue)}</strong></div>
              ${venueContext.operatingSpace ? `<div class="df-venue-hierarchy__item"><span class="df-utility-label">Operating space</span><strong>${esc(venueContext.operatingSpace)}</strong></div>` : ""}
            </div>
            <div class="df-venue-hierarchy__compact"><span class="df-utility-label">Venue</span><strong title="${esc(venueContext.desktopLabel)}">${esc(venueContext.compactLabel)}</strong></div>
            <span class="df-venue-scope">${esc(venueContext.sharedGuestListLabel)}</span>
          </div>
        </div>

        <div class="df-shell-service" aria-label="Service context">
          <label class="df-service-field">
            <span class="df-utility-label">Day</span>
            <select onchange="setActiveDay(this.value)">
              ${days.map(day => `<option ${day === state.activeDay ? "selected" : ""}>${day}</option>`).join("")}
            </select>
          </label>
          <label class="df-service-field">
            <span class="df-utility-label">Service date</span>
            <input id="df-service-date" type="date" value="${esc(state.activeDate)}" onchange="setActiveDate(this.value)" />
          </label>
          ${renderSyncPill()}
          <button type="button" class="btn secondary small df-refresh-button" onclick="manualRefreshData()" aria-label="Refresh live data" title="Refresh live data"><span class="df-refresh-icon" aria-hidden="true">RF</span></button>
        </div>

        <div class="df-utility-user">
          <div class="df-user-context" aria-label="${esc(user.name)}; ${esc(roleLabel(user.role))}">
            <div class="df-user-copy">
              <strong title="${esc(user.name)}">${esc(user.name)}</strong>
              <span>${esc(roleLabel(user.role))}</span>
            </div>
            <span class="df-user-avatar" aria-hidden="true">${esc(userInitials)}</span>
          </div>
          <button type="button" class="btn secondary small df-logout-button" onclick="closeShellNav(false);logout()" aria-label="Log out ${esc(user.name)}">
            <span class="df-logout-icon" aria-hidden="true">OUT</span>
            <span class="df-logout-label">Log Out</span>
          </button>
        </div>
      </div>
    </header>
  `;
}

function renderTabs() {
  const p = perms();
  const navItem = (view, label, symbol, allowed) => {
    if (!allowed) return "";
    const current = state.view === view ? ` aria-current="page"` : "";
    return `<li><button type="button" class="df-nav-item"${current} onclick="shellNavigate('${view}')"><span class="df-nav-symbol" aria-hidden="true">${symbol}</span><span>${label}</span></button></li>`;
  };

  return `
    <nav class="df-primary-nav" aria-label="Primary navigation">
      <ul>
        ${navItem("door", "Door Check-In", "DC", p.door)}
        ${navItem("tabletDoor", "Tablet Door Mode", "TD", p.door)}
        ${navItem("manage", "Management", "MG", p.manage)}
        ${navItem("users", "Staff", "ST", p.users)}
        ${navItem("reports", "Reports", "RP", p.reports)}
      </ul>
    </nav>
  `;
}

function renderDateBar() {
  const group = selectedGroup();
  const contextLabel = state.currentMode === "GENERAL" ? "General Guest List" : (group?.name || "Selected Group");

  return `
    <section class="card tight df-operational-context-card df-door-context" aria-labelledby="door-context-title">
      <header class="df-door-context__heading">
        <div><p class="df-door-kicker">Operating context</p><h2 id="door-context-title">${esc(contextLabel)}</h2></div>
        <p>${esc(state.activeDay)} <span aria-hidden="true">&middot;</span> ${esc(state.activeDate)}</p>
      </header>
      <div class="datebar df-door-context__controls">
        <div class="df-door-field">
          <label for="doorGroupSelect">Selected Party / Group</label>
          <select id="doorGroupSelect" onchange="selectGroup(this.value)">
            ${specificGroups().length
              ? specificGroups().map(item => `<option value="${item.id}" ${item.id === group?.id ? "selected" : ""}>${esc(item.name)} — ${esc(item.host_name || item.group_type)}</option>`).join("")
              : `<option>No specific groups for this date</option>`
            }
          </select>
        </div>

        <div class="df-door-field">
          <label for="doorLocationSelect">Door Location</label>
          <select id="doorLocationSelect" onchange="state.doorLocation=this.value;render()">
            ${["Front Door","Rear Door","EVE Door","VIP Check-In"].map(option => `<option ${option === state.doorLocation ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </div>
      </div>
    </section>
  `;
}

function renderManagerServiceDateCard() {
  return `
    <div class="card">
      <h2>Service Date</h2>
      <p class="subtle">Adding to: <strong>${esc(state.activeDay)} ${esc(state.activeDate)}</strong></p>

      <div class="form two">
        <div>
          <label>Service Date</label>
          <input type="date" value="${esc(state.activeDate)}" onchange="setActiveDate(this.value)" />
        </div>

        <div>
          <label>Quick Action</label>
          <button class="btn secondary" type="button" onclick="useTodayDate()">Use Today</button>
        </div>
      </div>
    </div>
  `;
}

function renderMobileManagerServiceDateCard() {
  return `
    <section class="mobile-manager-card">
      <div class="mobile-manager-title-row">
        <div>
          <h2>Service Date</h2>
          <p>Adding to ${esc(state.activeDate)}</p>
        </div>
      </div>

      <div class="mobile-manager-form">
        <div>
          <label>Service Date</label>
          <input type="date" value="${esc(state.activeDate)}" onchange="setActiveDate(this.value)" />
        </div>

        <button class="btn secondary mobile-manager-primary-btn" type="button" onclick="useTodayDate()">Use Today</button>
      </div>
    </section>
  `;
}

function renderStats() {
  const stats = dayStats();

  return `
    <div id="dayStatsPanel" class="stats df-door-metrics" aria-label="Door attendance summary">
      <div class="stat df-door-metric"><span>Groups</span><strong>${stats.groups}</strong></div>
      <div class="stat df-door-metric df-door-metric--complete"><span>Complete Groups</span><strong>${stats.completeGroups}</strong></div>
      <div class="stat df-door-metric"><span>Total Allowed</span><strong>${stats.total}</strong></div>
      <div class="stat df-door-metric df-door-metric--checked"><span>Checked In</span><strong>${stats.checked}</strong></div>
      <div class="stat df-door-metric df-door-metric--remaining"><span>Still Remaining</span><strong>${stats.remaining}</strong></div>
    </div>
  `;
}

function renderGroupList(showActions = false) {
  const stats = dayStats();

  const generalCard = `
    <div class="party-card df-door-party-card df-door-party-card--general ${state.currentMode === "GENERAL" ? "selected" : ""}" role="button" tabindex="0" aria-pressed="${state.currentMode === "GENERAL" ? "true" : "false"}" onclick="setMode('GENERAL')" onkeydown="if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setMode('GENERAL')}">
      <div class="df-door-party-card__top">
        <div><p class="df-door-kicker">All arrivals</p><h3 class="party-title">General Guest List</h3></div>
        <span class="df-door-party-state">${state.currentMode === "GENERAL" ? "Selected" : "Master list"}</span>
      </div>
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

      ${!groups.length ? `<div class="notice warn df-door-empty-state" role="status"><strong>No party groups</strong><span>No bottle service or special party groups are scheduled for this date.</span></div>` : ""}

      ${groups.map(group => {
        const groupStat = groupStats(group.id);
        const hostGuest = findHostGuestForGroup(group);
        const hostLabel = showActions
          ? (hostGuest ? guestDisplayName(hostGuest) : group.host_name || "N/A")
          : (hostGuest ? DOORFLOW_LIVE_GUEST_PRESENTATION.displayName(hostGuest) : DOORFLOW_LIVE_GUEST_PRESENTATION.cleanName(group.host_name || "N/A"));
        const complete = groupStat.total > 0 && groupStat.remaining === 0;
        const started = groupStat.checked > 0 && groupStat.remaining > 0;
        const selected = state.currentMode === "GROUP" && group.id === selectedGroup()?.id;
        const statusLabel = complete ? "Complete" : started ? "Partially Arrived" : "Not Arrived";

        return `
          <div class="party-card df-door-party-card ${selected ? "selected" : ""} ${complete ? "complete" : started ? "started" : ""}" role="button" tabindex="0" aria-pressed="${selected ? "true" : "false"}" onclick="selectGroup('${group.id}')" onkeydown="if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();selectGroup('${group.id}')}">
            <div class="df-door-party-card__top">
              <h3 class="party-title">${esc(group.name)}</h3>
              <span class="df-door-party-state">${statusLabel}</span>
            </div>
            <div class="party-meta">
              <span class="badge ${typeClass(group.group_type)}">${esc(group.group_type)}</span>
              <span class="badge general">Host: ${esc(hostLabel)}</span>
              ${group.table_location ? `<span class="badge general">${esc(group.table_location)}</span>` : ""}
              <span class="badge in">${groupStat.checked} in</span>
              <span class="badge remaining">${groupStat.remaining} left</span>
            </div>
            <p class="subtle" style="margin:0;">${esc(group.notes || "No notes listed.")}</p>

            ${selected && !showActions ? `
              <div class="df-door-party-focus" aria-label="Selected group summary">
                <div><span>Total</span><strong>${groupStat.total}</strong></div>
                <div><span>In</span><strong>${groupStat.checked}</strong></div>
                <div><span>Left</span><strong>${groupStat.remaining}</strong></div>
                ${group.approved_by ? `<p>Approved by ${esc(group.approved_by)}</p>` : ""}
              </div>
            ` : ""}

            ${showActions ? `
              <div class="row-actions" style="margin-top:10px;">
                <button type="button" class="btn secondary small" onclick="event.stopPropagation(); openGroupModal('${group.id}')">Edit</button>
                <button type="button" class="btn danger small" onclick="event.stopPropagation(); clearGroupNames('${group.id}')">Clear Names</button>
                <button type="button" class="btn danger small" onclick="event.stopPropagation(); deleteGroup('${group.id}')">Delete</button>
              </div>
            ` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderGuestList(showActions = false, guests = visibleGuests()) {
  if (!guests.length) {
    return `<div class="notice warn df-door-empty-state" role="status"><strong>No guests found</strong><span>No names found for the selected view.</span></div>`;
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
        const checkInBusy = isActionBusy(`checkin:${guest.id}`);
        const undoBusy = isActionBusy(`undo:${guest.id}`);
        const guestBusy = checkInBusy || undoBusy;

        return `
          <div class="guest-row df-door-guest-row ${fullyIn ? "checked is-complete" : checked > 0 ? "is-partial" : "is-pending"}">
            <button type="button" class="guest-check df-door-guest-check" onclick="toggleGuest('${guest.id}')" aria-label="Toggle check-in for ${esc(DOORFLOW_LIVE_GUEST_PRESENTATION.displayName(guest))}" ${guestBusy ? "disabled" : ""}>${fullyIn ? "✓" : checked > 0 ? checked : ""}</button>

            <div class="df-door-guest-copy">
              <div class="name-line df-door-guest-name-line df-door-live-name-row">
                <p class="guest-name">${esc(DOORFLOW_LIVE_GUEST_PRESENTATION.displayName(guest))}</p>
                <span class="count-pill">${checked}/${total}</span>
              </div>
              <p class="guest-detail">
                ${esc(guest.guest_type)}
                ${group ? ` · ${esc(groupDoorLabel(group))}` : ""}
                ${guest.notes ? ` · ${esc(guest.notes)}` : ""}
              </p>
              <div class="df-door-live-status-row">
                ${fullyIn ? `<span class="badge in df-door-status df-door-status--complete">Fully In</span>` : remaining > 0 ? `<span class="badge remaining df-door-status df-door-status--remaining">${remaining} left</span>` : ""}
                ${isLateAdd(guest) ? `<span class="badge remaining df-live-approval-state">${guest.late_add_approved_by ? "Late Add" : "Needs Approval"}</span>` : ""}
              </div>
              ${showLast ? `<p class="guest-detail">Last check-in by ${esc(guest.last_checked_in_by_name || "")} at ${esc(guest.last_door_location || "")}</p>` : ""}
            </div>

            <div class="row-actions df-door-guest-actions">
              ${checkInBusy ? `<button type="button" class="btn green small df-door-checkin-action" disabled>Saving...</button>` : remaining > 0 ? `<button type="button" class="btn green small df-door-checkin-action" onclick="checkInOneGuest('${guest.id}')" ${guestBusy ? "disabled" : ""}>Check In 1</button>` : `<span class="badge in df-door-status df-door-status--complete">Fully In</span>`}
              ${undoBusy ? `<button type="button" class="btn secondary small df-door-undo-action" disabled>Saving...</button>` : checked > 0 ? `<button type="button" class="btn secondary small df-door-undo-action" onclick="undoOneGuest('${guest.id}')" ${guestBusy ? "disabled" : ""}>Undo 1</button>` : ""}
              ${showActions ? `
                <button type="button" class="btn secondary small" onclick="openGuestModal('${guest.id}')">Edit</button>
                <button type="button" class="btn secondary small" onclick="openPlusOnesModal('${guest.id}')">Edit Plus Ones</button>
                <button type="button" class="btn danger small" onclick="deleteGuest('${guest.id}')">Delete</button>
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
      <section id="selectedGroupPanel" class="card df-door-selected-group df-door-selected-group--empty" aria-labelledby="selected-group-title">
        <header class="df-door-section-heading"><div><p class="df-door-kicker">Party focus</p><h2 id="selected-group-title">Selected Group</h2></div></header>
        <div class="df-door-empty-state" role="status"><strong>No group selected</strong><span>No party or bottle service group selected.</span></div>
      </section>
    `;
  }

  const stats = groupStats(group.id);
  const hostGuest = findHostGuestForGroup(group);
  const hostLabel = hostGuest ? guestDisplayName(hostGuest) : group.host_name || "N/A";
  const groupComplete = stats.total > 0 && stats.remaining === 0;
  const groupStarted = stats.checked > 0 && stats.remaining > 0;
  const groupStatus = groupComplete ? "Complete" : groupStarted ? "Partially Arrived" : "Not Arrived";

  return `
    <section id="selectedGroupPanel" class="card df-door-selected-group ${groupComplete ? "is-complete" : groupStarted ? "is-partial" : "is-pending"}" aria-labelledby="selected-group-title">
      <header class="df-door-selected-group__header"><div><p class="df-door-kicker">Party focus</p><h2 id="selected-group-title">${esc(group.name)}</h2></div><span class="df-door-party-state">${groupStatus}</span></header>
      <p class="subtle">${esc(group.group_type)} · Host: ${esc(hostLabel)}</p>

      <div class="stats df-door-selected-metrics" style="grid-template-columns:repeat(3,1fr);margin-bottom:0;">
        <div class="stat"><span>Total</span><strong>${stats.total}</strong></div>
        <div class="stat"><span>In</span><strong>${stats.checked}</strong></div>
        <div class="stat"><span>Left</span><strong>${stats.remaining}</strong></div>
      </div>

      <div class="divider"></div>

      <div class="df-door-selected-group__details">
        <p class="subtle"><strong>Table/Location:</strong> ${esc(group.table_location || "Not listed")}</p>
        <p class="subtle"><strong>Approved By:</strong> ${esc(group.approved_by || "Not listed")}</p>
        <p class="subtle"><strong>Notes:</strong> ${esc(group.notes || "No notes listed.")}</p>
      </div>

      ${perms().manage ? `
        <div class="row-actions df-door-group-actions">
          <button type="button" class="btn secondary small" onclick="openGroupModal('${group.id}')">Edit Group</button>
          <button type="button" class="btn danger small" onclick="deleteGroup('${group.id}')">Delete Group</button>
        </div>
      ` : ""}
    </section>
  `;
}

function renderMainWorkspace(showManagement = false) {
  const title = state.currentMode === "GENERAL" ? "General Guest List" : `${selectedGroup() ? esc(selectedGroup().name) : "Selected Group"} Names`;
  const subtitle = state.currentMode === "GENERAL"
    ? "This master list shows everyone for the selected date, including bottle service attendees."
    : "This shows only the names under the selected group.";
  const guests = visibleGuests();
  const venueContext = DOORFLOW_VENUE_PRESENTATION.resolve(state.venue?.name || DEFAULT_VENUE_NAME);
  const filterPanel = `
    <section class="card tight df-door-filter-panel" aria-label="Guest search and filters">
      <div class="toolbar df-door-filter-toolbar">
        <input id="mainSearchInput" aria-label="Search guests" placeholder="${state.currentMode === "GENERAL" ? "Search general guest list..." : "Search selected group..."}" value="${esc(state.searchText)}" oninput="updateMainSearch(this.value)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />

        <select id="mainListModeSelect" aria-label="Guest list view" onchange="setMode(this.value)">
          <option value="GENERAL" ${state.currentMode === "GENERAL" ? "selected" : ""}>General Guest List</option>
          <option value="GROUP" ${state.currentMode === "GROUP" ? "selected" : ""}>Selected Group Only</option>
        </select>

        <select id="mainGuestFilterSelect" aria-label="Guest status filter" onchange="setGuestFilter(this.value)">
          ${guestFilterOptions.map(option => `<option value="${option.value}" ${option.value === (state.guestFilter || "ALL") ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
        </select>

        <select id="mainSortModeSelect" aria-label="Guest sort order" onchange="setSortMode(this.value)">
          ${sortOptions.map(option => `<option value="${option.value}" ${option.value === state.sortMode ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
        </select>

        ${showManagement
          ? `<button type="button" class="btn" onclick="openGuestModal()">Add Individual Guest</button>`
          : `<button type="button" class="btn secondary df-door-clear-action" onclick="clearMainSearch()">Clear Search</button>`
        }
      </div>
    </section>
  `;

  return `
    <div class="df-door-operating-workspace${showManagement ? " is-management" : ""}"${showManagement ? "" : ' aria-labelledby="door-checkin-title"'}>
      ${showManagement ? "" : `
        <header class="df-door-view-header">
          <div><p class="df-door-kicker">Live service</p><h1 id="door-checkin-title">Door Check-In</h1><p>Find arrivals, confirm the right party, and keep the door moving with confidence.</p></div>
          <div class="df-door-view-header__context" aria-label="${esc(venueContext.compactLabel)}; ${esc(venueContext.sharedGuestListLabel)}; door ${esc(state.doorLocation)}">
            <span>${esc(venueContext.compactLabel)}</span>
            <span>Door: ${esc(state.doorLocation)}</span>
            <strong>${esc(venueContext.sharedGuestListLabel)} &middot; ${guests.length} guests shown</strong>
          </div>
        </header>
      `}

      ${renderDateBar()}
      ${renderStats()}
      ${showManagement ? "" : filterPanel}

    <div class="grid df-door-workspace">
      <main class="stack df-door-roster-column">
        ${showManagement ? filterPanel : ""}

        <section class="card df-door-guest-panel" aria-labelledby="door-guest-list-title">
          <header class="df-door-section-heading">
            <div>${showManagement ? "" : `<p class="df-door-kicker">Arrival roster</p>`}<h2 id="door-guest-list-title">${title}</h2><p class="subtle">${subtitle}</p></div>
          </header>
          <div class="party-meta df-door-list-meta">
            <span id="mainFilterBadge" class="badge general">Filter: ${esc(activeFilterLabel())}</span>
            <span id="mainShownCount" class="badge general">${guests.length} shown</span>
          </div>
          <div id="guestScrollPanel" class="scroll-panel">
            ${renderGuestList(showManagement, guests)}
          </div>
        </section>

        ${showManagement ? `
          <div class="card">
            <h2>Bulk Paste Names</h2>
            <p class="subtle">Paste one name per line and add them to the General Guest List or selected group.</p>
            <button type="button" class="btn secondary" onclick="openBulkPasteModal()">Open Bulk Paste Tool</button>
          </div>

          <div class="card">
            <h2>Upload Names from Excel / CSV</h2>
            <p class="subtle">Adding to: <strong>${esc(state.activeDate)}</strong>. Recommended columns: First Name, Last Name, Guest Type, Party Size or Plus Count, Notes.</p>

            ${state.importMessage ? `<div class="notice ${state.importMessage.startsWith("Imported") || state.importMessage.startsWith("Bulk") || state.importMessage.startsWith("Cleared") ? "greenbox" : "redbox"}">${esc(state.importMessage)}</div>` : ""}

            <div class="form two">
              <div>
                <label>Upload Target</label>
                <select id="uploadTarget">
                  <option value="general">General Guest List / Individual Guest</option>
                  ${specificGroups().map(item => `<option value="group:${item.id}">${esc(item.name)}${item.host_name ? ` — ${esc(item.host_name)}` : ""}</option>`).join("")}
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

      <aside class="stack df-door-support-column">
        <section class="card df-door-party-panel" aria-labelledby="door-party-list-title">
          <header class="df-door-section-heading"><div>${showManagement ? "" : `<p class="df-door-kicker">Party browser</p>`}<h2 id="door-party-list-title">Party / Bottle Service Groups</h2><p class="subtle">Click General Guest List to see everyone, or click a group to see only that group.</p></div></header>
          <input id="groupSearchInput" aria-label="Search party groups" placeholder="Search groups..." value="${esc(state.groupSearchText)}" oninput="updateGroupSearch(this.value)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
          <div id="groupScrollPanel" class="scroll-panel short">
            ${renderGroupList(showManagement)}
          </div>
        </section>

        ${showManagement ? renderSelectedGroupPanel() : ""}
      </aside>
    </div>
    </div>
  `;
}

function shouldShowManagementActions() {
  return Boolean(state.view === "manage" && perms().manage);
}

function replaceRenderedElement(id, html) {
  const current = document.getElementById(id);
  if (!current) return false;

  const template = document.createElement("template");
  template.innerHTML = String(html || "").trim();
  const next = template.content.firstElementChild;
  if (!next) return false;

  current.replaceWith(next);
  return true;
}

function syncGuestFilterControls() {
  ["mainGuestFilterSelect", "tabletGuestFilterSelect"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = state.guestFilter || "ALL";
  });
}

function syncSortControls() {
  ["mainSortModeSelect", "tabletSortModeSelect"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = state.sortMode || "LAST_ASC";
  });
}

function refreshSyncStatusSurface() {
  let touched = false;
  const syncPill = document.querySelector(".sync-pill");
  if (syncPill) {
    const template = document.createElement("template");
    template.innerHTML = renderSyncPill();
    const next = template.content.firstElementChild;
    if (next) {
      syncPill.replaceWith(next);
      touched = true;
    }
  }

  const footer = document.querySelector(".mobile-manager-sync-footer");
  if (footer) {
    const template = document.createElement("template");
    template.innerHTML = renderMobileSyncFooter();
    const next = template.content.firstElementChild;
    if (next) {
      footer.replaceWith(next);
      touched = true;
    }
  }

  return touched;
}

function refreshStatsSurface() {
  let touched = replaceRenderedElement("dayStatsPanel", renderStats());
  const tabletSummary = document.getElementById("tabletMobileSummaryBar");
  const tabletStats = document.getElementById("tabletDayStatsPanel");

  if (tabletSummary) {
    const stats = dayStats();
    tabletSummary.innerHTML = `
      <div class="mobile-summary-item"><span>In</span><strong>${stats.checked}</strong></div>
      <div class="mobile-summary-item"><span>Left</span><strong>${stats.remaining}</strong></div>
      <div class="mobile-summary-item"><span>Total</span><strong>${stats.total}</strong></div>
    `;
    touched = true;
  }

  if (tabletStats) {
    const stats = dayStats();
    tabletStats.innerHTML = `
      <div class="stat"><span>Checked In</span><strong>${stats.checked}</strong></div>
      <div class="stat"><span>Remaining</span><strong>${stats.remaining}</strong></div>
      <div class="stat"><span>Total Allowed</span><strong>${stats.total}</strong></div>
    `;
    touched = true;
  }

  return touched;
}

function refreshVisibleGuestSurface() {
  const guests = visibleGuests();
  let touched = false;

  const mainFilter = document.getElementById("mainFilterBadge");
  if (mainFilter) {
    mainFilter.textContent = `Filter: ${activeFilterLabel()}`;
    touched = true;
  }

  const mainCount = document.getElementById("mainShownCount");
  if (mainCount) {
    mainCount.textContent = `${guests.length} shown`;
    touched = true;
  }

  const guestPanel = document.getElementById("guestScrollPanel");
  if (guestPanel) {
    guestPanel.innerHTML = renderGuestList(shouldShowManagementActions(), guests);
    touched = true;
  }

  const tabletCount = document.getElementById("tabletShownCount");
  if (tabletCount) {
    tabletCount.textContent = `${guests.length} shown`;
    touched = true;
  }

  const tabletFilter = document.getElementById("tabletFilterBadge");
  if (tabletFilter) {
    tabletFilter.textContent = `Filter: ${activeFilterLabel()}`;
    touched = true;
  }

  const tabletGrid = document.getElementById("tabletCardGrid");
  if (tabletGrid) {
    tabletGrid.innerHTML = renderTabletGuestCards(guests);
    touched = true;
  }

  refreshStatsSurface();
  syncGuestFilterControls();
  syncSortControls();

  return touched;
}

function refreshGroupListSurface() {
  const groupPanel = document.getElementById("groupScrollPanel");
  if (!groupPanel) return false;

  groupPanel.innerHTML = renderGroupList(shouldShowManagementActions());
  return true;
}

function refreshSelectedGroupPanelSurface() {
  return replaceRenderedElement("selectedGroupPanel", renderSelectedGroupPanel());
}

function refreshLiveSurfaces() {
  const touchedSync = refreshSyncStatusSurface();
  const touchedStats = refreshStatsSurface();
  const touchedGuests = refreshVisibleGuestSurface();
  const touchedGroups = refreshGroupListSurface();
  const touchedSelectedGroup = refreshSelectedGroupPanelSurface();
  return touchedSync || touchedStats || touchedGuests || touchedGroups || touchedSelectedGroup;
}

function shouldPatchLiveRefresh() {
  const activeId = String(document.activeElement?.id || "");
  if (["mainSearchInput", "groupSearchInput", "tabletSearchInput"].includes(activeId)) return true;
  return userRecentlyTyped(2000);
}

function updateMainSearch(value) {
  state.searchText = value;
  resetDerivedListCaches();

  if (!refreshVisibleGuestSurface()) {
    render();
  }
}

function clearMainSearch() {
  state.searchText = "";
  resetDerivedListCaches();

  ["mainSearchInput", "tabletSearchInput"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = "";
  });

  if (!refreshVisibleGuestSurface()) {
    render();
  }
}

function updateGroupSearch(value) {
  state.groupSearchText = value;
  resetDerivedListCaches();

  if (!refreshGroupListSurface()) {
    render();
  }
}

function clearTabletSearchFilter() {
  state.searchText = "";
  state.guestFilter = "ALL";
  resetDerivedListCaches();

  const input = document.getElementById("tabletSearchInput");
  if (input) input.value = "";

  syncGuestFilterControls();

  if (!refreshVisibleGuestSurface()) {
    render();
  }
}


function updateTabletSearch(value) {
  state.searchText = value;
  resetDerivedListCaches();

  if (!refreshVisibleGuestSurface()) {
    render();
  }
}

function renderTabletGuestCards(guests) {
  return guests.length ? guests.map(guest => {
    const group = state.groups.find(item => item.id === guest.group_id);
    const total = guestTotal(guest);
    const checked = guestChecked(guest);
    const remaining = guestRemaining(guest);
    const fullyIn = isGuestFullyIn(guest);
    const checkInBusy = isActionBusy(`checkin:${guest.id}`);
    const undoBusy = isActionBusy(`undo:${guest.id}`);
    const guestBusy = checkInBusy || undoBusy;

    return `
      <article class="tablet-guest-card df-tablet-guest-card ${fullyIn ? "checked is-complete" : checked > 0 ? "is-partial" : "is-pending"}" aria-label="${esc(DOORFLOW_LIVE_GUEST_PRESENTATION.displayName(guest))}, ${fullyIn ? "fully checked in" : `${remaining} remaining`}">
        <div class="tablet-guest-top">
          <div class="df-tablet-guest-copy">
            <p class="tablet-guest-name">${esc(DOORFLOW_LIVE_GUEST_PRESENTATION.displayName(guest))}</p>
            <p class="tablet-guest-meta">${esc(guest.guest_type)}${group ? ` · ${esc(groupDoorLabel(group))}` : ""}${guest.notes ? ` · ${esc(guest.notes)}` : ""}</p>
            ${isLateAdd(guest) ? `<span class="badge remaining df-live-approval-state">${guest.late_add_approved_by ? "Late Add" : "Needs Approval"}</span>` : ""}
          </div>
          <div class="tablet-count df-tablet-guest-count">${checked}/${total}</div>
        </div>

        <p class="tablet-note df-tablet-guest-status"><strong>${fullyIn ? "Checked In" : checked > 0 ? "Partially Arrived" : "Not Arrived"}</strong><span>${fullyIn ? "Fully checked in" : `${remaining} remaining`}${checked > 0 && guest.last_checked_in_by_name ? ` · Last by ${esc(guest.last_checked_in_by_name)} at ${esc(guest.last_door_location || "")}` : ""}</span></p>

        <div class="tablet-actions df-tablet-guest-actions">
          ${checkInBusy ? `<button type="button" class="btn green tablet-check-btn df-door-checkin-action" disabled>Saving...</button>` : remaining > 0 ? `<button type="button" class="btn green tablet-check-btn df-door-checkin-action" onclick="checkInOneGuest('${guest.id}')" ${guestBusy ? "disabled" : ""}>Check In 1</button>` : `<button type="button" class="btn green tablet-check-btn df-door-checkin-action" disabled>Fully In</button>`}
          ${undoBusy ? `<button type="button" class="btn secondary tablet-undo-btn df-door-undo-action" disabled>Saving...</button>` : checked > 0 ? `<button type="button" class="btn secondary tablet-undo-btn df-door-undo-action" onclick="undoOneGuest('${guest.id}')" ${guestBusy ? "disabled" : ""}>Undo 1</button>` : `<button type="button" class="btn secondary tablet-undo-btn df-door-undo-action" disabled>Undo 1</button>`}
        </div>
      </article>
    `;
  }).join("") : `<div class="tablet-empty df-door-empty-state" role="status"><strong>No guests found</strong><span>Try clearing search or switching list view.</span></div>`;
}


function renderTabletDoorMode() {
  const guests = visibleGuests();
  const stats = dayStats();
  const venueContext = DOORFLOW_VENUE_PRESENTATION.resolve(state.venue?.name || DEFAULT_VENUE_NAME);
  const selectedListValue = state.currentMode === "GENERAL" ? "GENERAL" : (selectedGroup()?.id || "GENERAL");
  const activeGroup = selectedGroup();
  const activeGroupStats = activeGroup ? groupStats(activeGroup.id) : null;
  const activeGroupStatus = activeGroupStats
    ? (activeGroupStats.total > 0 && activeGroupStats.remaining === 0 ? "Complete" : activeGroupStats.checked > 0 ? "Partially Arrived" : "Not Arrived")
    : "No Group Selected";
  const activeListSummary = activeGroupStats
    ? `${activeGroupStats.checked}/${activeGroupStats.total} in, ${activeGroupStats.remaining} left`
    : `${stats.checked}/${stats.total} in, ${stats.remaining} left`;

  return `
    <section class="df-tablet-door-mode" aria-labelledby="tablet-door-title">
    <header class="df-tablet-mode-header">
      <div class="df-tablet-mode-header__brand">${renderDoorFlowLockup()}<div><p class="df-door-kicker">Dedicated door workspace</p><h1 id="tablet-door-title">Tablet Door Mode</h1></div></div>
      <div class="df-tablet-mode-header__context" aria-label="Parent venue ${esc(venueContext.parentVenue)}${venueContext.operatingSpace ? `; operating space ${esc(venueContext.operatingSpace)}` : ""}; ${esc(venueContext.sharedGuestListLabel)}; door ${esc(state.doorLocation)}">
        <span class="df-tablet-venue-label">${esc(venueContext.compactLabel)}</span>
        <span class="df-tablet-list-scope">${esc(venueContext.sharedGuestListLabel)}</span>
        <span>${esc(state.activeDay)} ${esc(state.activeDate)}</span>
        <strong>Door: ${esc(state.doorLocation)}</strong>
      </div>
    </header>

    ${renderDateBar()}

    <div id="tabletMobileSummaryBar" class="mobile-summary-bar df-tablet-mobile-summary" aria-label="Tablet attendance summary">
      <div class="mobile-summary-item"><span>In</span><strong>${stats.checked}</strong></div>
      <div class="mobile-summary-item"><span>Left</span><strong>${stats.remaining}</strong></div>
      <div class="mobile-summary-item"><span>Total</span><strong>${stats.total}</strong></div>
    </div>

    <div class="tablet-door-shell">
      <section class="card df-tablet-overview" aria-labelledby="tablet-attendance-title">
        <header class="df-door-section-heading"><div><p class="df-door-kicker">Service pulse</p><h2 id="tablet-attendance-title">Attendance at a glance</h2><p>Large-format arrival totals for the active service day.</p></div></header>

        <div id="tabletDayStatsPanel" class="stats df-tablet-stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:0;">
          <div class="stat"><span>Checked In</span><strong>${stats.checked}</strong></div>
          <div class="stat"><span>Remaining</span><strong>${stats.remaining}</strong></div>
          <div class="stat"><span>Total Allowed</span><strong>${stats.total}</strong></div>
        </div>
      </section>

      <section class="tablet-action-bar df-tablet-command-bar" aria-label="Tablet guest search and filters">
        <div class="tablet-action-grid df-tablet-control-grid">
          <div class="df-tablet-search-field">
            <label for="tabletSearchInput">Search Guest</label>
            <input id="tabletSearchInput" class="tablet-search" placeholder="Type guest name..." value="${esc(state.searchText)}" oninput="updateTabletSearch(this.value)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
          </div>

          <div class="df-tablet-list-field">
            <label for="tabletListSelect">Guest List / Party</label>
            <select id="tabletListSelect" onchange="selectTabletList(this.value)">
              <option value="GENERAL" ${selectedListValue === "GENERAL" ? "selected" : ""}>General Guest List</option>
              ${specificGroups().map(group => `
                <option value="${group.id}" ${selectedListValue === group.id ? "selected" : ""}>${esc(group.name)}${group.host_name ? ` — ${esc(group.host_name)}` : ""}</option>
              `).join("")}
            </select>
          </div>

          <div class="df-tablet-filter-field">
            <label for="tabletGuestFilterSelect">Filter</label>
            <select id="tabletGuestFilterSelect" onchange="setGuestFilter(this.value)">
              ${guestFilterOptions.map(option => `<option value="${option.value}" ${option.value === (state.guestFilter || "ALL") ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
            </select>
          </div>

          <div class="df-tablet-sort-field">
            <label for="tabletSortModeSelect">Sort</label>
            <select id="tabletSortModeSelect" onchange="setSortMode(this.value)">
              ${sortOptions.map(option => `<option value="${option.value}" ${option.value === state.sortMode ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
            </select>
          </div>

          <div class="df-tablet-clear-field">
            <span class="df-tablet-control-label">Quick Clear</span>
            <button type="button" class="btn secondary df-door-clear-action" onclick="clearTabletSearchFilter()">Clear Search/Filter</button>
          </div>
        </div>
      </section>

      <div class="card tight df-tablet-result-meta">
        <div class="party-meta" aria-label="Current tablet result status">
          <span id="tabletFilterBadge" class="badge general">Filter: ${esc(activeFilterLabel())}</span>
          <span id="tabletShownCount" class="badge general">${guests.length} shown</span>
        </div>
        <div class="df-tablet-active-list" aria-label="Active guest list summary">
          <strong>${activeGroup ? esc(activeGroup.name) : "General Guest List"}</strong>
          <span class="df-door-party-state">${activeGroup ? activeGroupStatus : "Master List"}</span>
          <span>${activeListSummary}</span>
        </div>
      </div>

      ${renderShiftNotesForDoorStaff()}

      <div class="df-tablet-content-layout is-roster-only">
        <section class="df-tablet-results" aria-labelledby="tablet-results-title">
          <header class="df-door-section-heading"><div><p class="df-door-kicker">Arrival results</p><h2 id="tablet-results-title">Guests</h2><p>${guests.length} names match the current list, search, filter, and sort.</p></div></header>
          <div id="tabletCardGrid" class="tablet-card-grid">
            ${renderTabletGuestCards(guests)}
          </div>
        </section>
      </div>
    </div>
    </section>
  `;
}

function renderAdminPageHeader({ eyebrow, title, description, meta = [] }) {
  return `
    <header class="df-admin-page-header">
      <div class="df-admin-page-heading">
        <p class="df-admin-eyebrow">${esc(eyebrow)}</p>
        <h1>${esc(title)}</h1>
        <p class="df-admin-lede">${esc(description)}</p>
      </div>
      ${meta.length ? `
        <dl class="df-admin-context" aria-label="Current operational context">
          ${meta.map(item => `
            <div>
              <dt>${esc(item.label)}</dt>
              <dd>${esc(item.value)}</dd>
            </div>
          `).join("")}
        </dl>
      ` : ""}
    </header>
  `;
}

function renderAdminState(tone, title, message) {
  return `
    <div class="df-admin-state df-admin-state--${esc(tone)}" ${tone === "error" ? 'role="alert"' : 'role="status"'}>
      <strong>${esc(title)}</strong>
      <p>${esc(message)}</p>
    </div>
  `;
}

function renderManagement() {
  const venueContext = DOORFLOW_VENUE_PRESENTATION.resolve(state.venue?.name || DEFAULT_VENUE_NAME);

  return `
    ${renderMobileManagerView()}
    <div class="stack manage-desktop-view df-admin-page df-management-page">
      ${renderAdminPageHeader({
        eyebrow:"Guest list administration",
        title:"Management",
        description:"Build the service-day guest list, manage parties, and keep operational notes in one workspace.",
        meta:[
          { label:"Venue", value:venueContext.parentVenue },
          ...(venueContext.operatingSpace ? [{ label:"Operating space", value:venueContext.operatingSpace }] : []),
          { label:"Guest-list scope", value:venueContext.guestListScope },
          { label:"Service date", value:`${state.activeDay} ${state.activeDate}` }
        ]
      })}

      ${renderManagerServiceDateCard()}

      <section class="card df-admin-card df-management-actions" aria-labelledby="management-controls-title">
        <header class="df-admin-section-header">
          <div>
            <p class="df-admin-kicker">Administrative actions</p>
            <h2 id="management-controls-title">Management Controls</h2>
            <p>Create groups, add names, import lists, clear the master list, and export the current service day.</p>
          </div>
        </header>

        <div class="row-actions df-admin-action-bar">
          <button type="button" class="btn" onclick="openGroupModal()">Create Party</button>
          <button type="button" class="btn secondary" onclick="openGuestModal()">Add Individual Guest</button>
          <button type="button" class="btn secondary" onclick="openBulkPasteModal()">Bulk Paste Names</button>
          <button type="button" class="btn secondary" onclick="setMode('GENERAL')">View General Guest List</button>
          <button type="button" class="btn danger" onclick="clearGeneralGuestList()">Clear General Guest List</button>
          <button type="button" class="btn secondary" onclick="previewCloseOutReport()">Preview Close Out Report</button>
          <button type="button" class="btn secondary" onclick="exportCsv()">Export Current Day CSV</button>
        </div>
      </section>

      ${state.loading ? renderAdminState("loading", "Loading management records", "DoorFlow is refreshing the selected service day.") : ""}
      ${renderShiftNotesPanel(true)}${renderMainWorkspace(true)}
    </div>
  `;
}

function renderStaffManagement() {
  if (!perms().users) {
    return `
      <div class="df-admin-page">
        ${renderAdminPageHeader({ eyebrow:"Access control", title:"Staff", description:"Manage staff access and operational roles." })}
        ${renderAdminState("error", "No access", "This account cannot manage staff.")}
      </div>
    `;
  }

  const venueContext = DOORFLOW_VENUE_PRESENTATION.resolve(state.venue?.name || DEFAULT_VENUE_NAME);

  return `
    <div class="df-admin-page df-staff-page">
      ${renderAdminPageHeader({
        eyebrow:"Access control",
        title:"Staff",
        description:"Review the active DoorFlow team and maintain role and access assignments.",
        meta:[
          { label:"Venue", value:venueContext.parentVenue },
          ...(venueContext.operatingSpace ? [{ label:"Operating space", value:venueContext.operatingSpace }] : []),
          { label:"Guest-list scope", value:venueContext.guestListScope },
          { label:"Profiles", value:String(state.staffProfiles.length) }
        ]
      })}

      ${state.loading ? renderAdminState("loading", "Loading staff", "DoorFlow is refreshing staff profiles.") : ""}

      <div class="grid df-staff-workspace">
        <main class="stack">
          <section class="card df-admin-card" aria-labelledby="staff-management-title">
            <header class="df-admin-section-header">
              <div>
                <p class="df-admin-kicker">Directory controls</p>
                <h2 id="staff-management-title">Staff Management</h2>
                <p>Manage DoorFlow roles and active status for users already created in Supabase Authentication.</p>
              </div>
              <button type="button" class="btn secondary" onclick="refreshStaffProfiles()">Refresh Staff List</button>
            </header>
          </section>

          <section class="card df-admin-card" aria-labelledby="current-staff-title">
            <header class="df-admin-section-header">
              <div>
                <p class="df-admin-kicker">Authorized profiles</p>
                <h2 id="current-staff-title">Current Staff</h2>
                <p>Change a staff member's role or active access. New email/password users must be created in Supabase Authentication first.</p>
              </div>
            </header>

            <div class="scroll-panel df-data-table-region">
              ${state.staffProfiles.length ? `
                <table class="df-data-table df-staff-table">
                  <caption class="sr-only">Current DoorFlow staff profiles and editable access settings</caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Role</th>
                      <th scope="col">Status</th>
                      <th scope="col">Created</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${state.staffProfiles.map(profile => `
                      <tr>
                        <td data-label="Name">
                          <form id="staff-${profile.id}" onsubmit="updateStaffProfile(event)">
                            <input type="hidden" name="id" value="${profile.id}" />
                            <input name="full_name" value="${esc(profile.full_name)}" aria-label="Full name for ${esc(profile.full_name || "staff profile")}" />
                          </form>
                        </td>
                        <td data-label="Role">
                          <select form="staff-${profile.id}" name="role" aria-label="Role for ${esc(profile.full_name || "staff profile")}">
                            ${["admin","manager","door","viewer"].map(role => `<option value="${role}" ${role === profile.role ? "selected" : ""}>${roleLabel(role)}</option>`).join("")}
                          </select>
                        </td>
                        <td data-label="Status">
                          <select class="df-status-control" form="staff-${profile.id}" name="active" aria-label="Status for ${esc(profile.full_name || "staff profile")}">
                            <option value="true" ${profile.active ? "selected" : ""}>Active</option>
                            <option value="false" ${!profile.active ? "selected" : ""}>Inactive</option>
                          </select>
                        </td>
                        <td data-label="Created">${profile.created_at ? new Date(profile.created_at).toLocaleDateString() : ""}</td>
                        <td data-label="Action"><button form="staff-${profile.id}" class="btn small" type="submit">Save</button></td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              ` : renderAdminState("empty", "No staff profiles loaded", "Use Refresh Staff List to load the current staff directory.")}
            </div>
          </section>
        </main>

        <aside class="stack" aria-label="Staff administration guidance">
          <section class="card df-admin-card">
            <p class="df-admin-kicker">Provisioning</p>
            <h2>How to Add Staff</h2>
            <p class="subtle">Create the email/password user in Supabase Authentication first, then add that user's UID to staff_profiles.</p>
          </section>

          <section class="card df-admin-card df-role-guide">
            <p class="df-admin-kicker">Permission reference</p>
            <h2>Role Guide</h2>
            <dl>
              <div><dt>Admin</dt><dd>Full app access and staff management.</dd></div>
              <div><dt>Manager</dt><dd>Manage guest lists, groups, reports, and check-ins.</dd></div>
              <div><dt>Door Staff</dt><dd>Door check-in only.</dd></div>
              <div><dt>Viewer</dt><dd>Reports only.</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  `;
}

function renderReports() {
  const stats = dayStats();
  const lateAdds = state.guests.filter(guest => isLateAdd(guest));
  const venueContext = DOORFLOW_VENUE_PRESENTATION.resolve(state.venue?.name || DEFAULT_VENUE_NAME);

  return `
    <div class="stack df-admin-page df-reports-page">
      ${renderAdminPageHeader({
        eyebrow:"Operations review",
        title:"Reports & Closeout",
        description:"Review attendance, service activity, shift notes, and the current closeout record for the selected date.",
        meta:[
          { label:"Venue", value:venueContext.parentVenue },
          ...(venueContext.operatingSpace ? [{ label:"Operating space", value:venueContext.operatingSpace }] : []),
          { label:"Guest-list scope", value:venueContext.guestListScope },
          { label:"Service date", value:`${state.activeDay} ${state.activeDate}` }
        ]
      })}

      <section class="df-admin-toolbar" aria-label="Report controls">
        <div class="df-admin-toolbar-context">${renderDateBar()}</div>
        <div class="row-actions df-admin-toolbar-actions">
          <button type="button" class="btn" onclick="exportCsv()">Export Current Day CSV</button>
          <button type="button" class="btn secondary" onclick="loadDataForDate(state.activeDate)">Refresh Report</button>
          <button type="button" class="btn secondary" onclick="previewCloseOutReport()">Preview Close Out</button>
        </div>
      </section>

      ${state.loading ? renderAdminState("loading", "Loading report", "DoorFlow is refreshing attendance and activity for this service date.") : ""}

      <section class="df-admin-summary-grid" aria-label="Service-day summary">
        <article class="df-summary-card"><span>Groups</span><strong>${stats.groups}</strong><small>${stats.completeGroups} complete</small></article>
        <article class="df-summary-card"><span>Total Allowed</span><strong>${stats.total}</strong><small>Across all listed guests</small></article>
        <article class="df-summary-card df-summary-card--success"><span>Checked In</span><strong>${stats.checked}</strong><small>Recorded arrivals</small></article>
        <article class="df-summary-card ${stats.remaining ? "df-summary-card--warning" : "df-summary-card--success"}"><span>Remaining</span><strong>${stats.remaining}</strong><small>${stats.remaining ? "Still expected" : "Complete"}</small></article>
        <article class="df-summary-card"><span>Late Adds</span><strong>${lateAdds.length}</strong><small>For this service date</small></article>
        <article class="df-summary-card"><span>Activity Logs</span><strong>${state.logs.length}</strong><small>Recorded door actions</small></article>
      </section>

      <div class="df-report-grid">
        <main class="stack">
          <section class="card df-admin-card" aria-labelledby="attendance-breakdown-title">
            <header class="df-admin-section-header">
              <div>
                <p class="df-admin-kicker">Attendance</p>
                <h2 id="attendance-breakdown-title">Group Breakdown</h2>
                <p>Current attendance totals for every group on the selected service date.</p>
              </div>
            </header>
            <div class="df-data-table-region">
              ${state.groups.length ? `
                <table class="df-data-table df-responsive-record-table">
                  <caption class="sr-only">Attendance totals by group</caption>
                  <thead><tr><th scope="col">Group</th><th scope="col">Type</th><th scope="col">Allowed</th><th scope="col">Checked In</th><th scope="col">Remaining</th></tr></thead>
                  <tbody>
                    ${state.groups.map(group => {
                      const groupStat = groupStats(group.id);
                      return `<tr><td data-label="Group"><strong>${esc(group.name)}</strong></td><td data-label="Type">${esc(group.group_type || "")}</td><td data-label="Allowed">${groupStat.total}</td><td data-label="Checked In">${groupStat.checked}</td><td data-label="Remaining">${groupStat.remaining}</td></tr>`;
                    }).join("")}
                  </tbody>
                </table>
              ` : renderAdminState("empty", "No groups for this date", "Attendance totals will appear after groups or guests are added.")}
            </div>
          </section>

          <section class="card df-admin-card" aria-labelledby="activity-log-title">
            <header class="df-admin-section-header">
              <div>
                <p class="df-admin-kicker">Operational record</p>
                <h2 id="activity-log-title">Check-In Activity Log</h2>
                <p>Shows who was checked in, their group, the staff member, door location, and recorded time.</p>
              </div>
            </header>
            <div id="reportScrollPanel" class="scroll-panel df-data-table-region">
              ${state.logs.length ? `
                <table class="df-data-table df-responsive-record-table">
                  <caption class="sr-only">Check-in activity for the selected service date</caption>
                  <thead><tr><th scope="col">Time</th><th scope="col">Guest</th><th scope="col">Group</th><th scope="col">Action</th><th scope="col">Staff</th><th scope="col">Door</th></tr></thead>
                  <tbody>
                    ${state.logs.map(log => `
                      <tr>
                        <td data-label="Time">${esc(logTime(log))}</td>
                        <td data-label="Guest"><strong>${esc(guestNameFromLog(log))}</strong></td>
                        <td data-label="Group">${esc(groupNameFromLog(log))}</td>
                        <td data-label="Action">${esc(log.action || "")}</td>
                        <td data-label="Staff">${esc(log.staff_name || "")}</td>
                        <td data-label="Door">${esc(log.door_location || "")}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              ` : renderAdminState("empty", "No check-in activity", "Door activity will appear here after the first recorded action for this date.")}
            </div>
          </section>

          <section class="card df-admin-card" aria-labelledby="guest-status-title">
            <header class="df-admin-section-header">
              <div>
                <p class="df-admin-kicker">Guest status</p>
                <h2 id="guest-status-title">Current Guest Status</h2>
                <p>Quick operational view of all names for this date.</p>
              </div>
            </header>
            <div class="scroll-panel df-data-table-region">
              ${state.guests.length ? `
                <table class="df-data-table df-responsive-record-table">
                  <caption class="sr-only">Current guest attendance status</caption>
                  <thead><tr><th scope="col">Name</th><th scope="col">Group</th><th scope="col">Type</th><th scope="col">Checked In</th><th scope="col">Remaining</th><th scope="col">Door</th></tr></thead>
                  <tbody>
                    ${sortGuests([...state.guests]).map(guest => {
                      const group = state.groups.find(item => item.id === guest.group_id);
                      return `
                        <tr>
                          <td data-label="Name"><strong>${esc(guestDisplayName(guest))}</strong></td>
                          <td data-label="Group">${esc(group?.name || "")}</td>
                          <td data-label="Type">${esc(guest.guest_type || "")}</td>
                          <td data-label="Checked In">${guestChecked(guest)} / ${guestTotal(guest)}</td>
                          <td data-label="Remaining">${guestRemaining(guest)}</td>
                          <td data-label="Door">${esc(guest.last_door_location || "")}</td>
                        </tr>
                      `;
                    }).join("")}
                  </tbody>
                </table>
              ` : renderAdminState("empty", "No guests listed", "Guest status will appear after names are added to this service date.")}
            </div>
          </section>
        </main>

        <aside class="stack" aria-label="Closeout review">
          <section class="card df-admin-card df-closeout-actions" aria-labelledby="closeout-actions-title">
            <p class="df-admin-kicker">Closeout</p>
            <h2 id="closeout-actions-title">Service-Day Record</h2>
            <p class="subtle">Preview the existing closeout report before printing or exporting its current data.</p>
            <div class="row-actions">
              <button type="button" class="btn" onclick="previewCloseOutReport()">Preview Close Out Report</button>
              <button type="button" class="btn secondary" onclick="exportCsv()">Export Current Day CSV</button>
            </div>
          </section>

          <section class="card df-admin-card" aria-labelledby="report-shift-notes-title">
            <header class="df-admin-section-header">
              <div>
                <p class="df-admin-kicker">Shift record</p>
                <h2 id="report-shift-notes-title">Shift Notes</h2>
                <p>Manager notes attached to this service date.</p>
              </div>
            </header>
            ${state.shiftNotes.length ? `
              <div class="df-report-note-list">
                ${state.shiftNotes.map(note => `
                  <article class="df-report-note">
                    <div class="party-meta">
                      <span class="badge ${noteCategoryClass(note.category)}">${esc(note.category || "General Note")}</span>
                      <span class="badge ${notePriorityClass(note.priority)}">${esc(note.priority || "Normal")}</span>
                    </div>
                    <p>${esc(note.note_text || "")}</p>
                    <small>By ${esc(note.created_by_name || "Unknown")} &middot; ${esc(noteTime(note))}</small>
                  </article>
                `).join("")}
              </div>
            ` : renderAdminState("empty", "No shift notes", "No manager or shift notes have been added for this date.")}
          </section>

          ${renderSelectedGroupPanel()}
        </aside>
      </div>
    </div>
  `;
}

function renderGroupModal() {
  const existingGroup = state.editingGroupId ? state.groups.find(item => item.id === state.editingGroupId) : null;
  const isEdit = Boolean(existingGroup);
  const group = isEdit ? normalizeGroup(existingGroup) : emptyGroupForm();
  const hostGuest = isEdit ? findHostGuestForGroup(group) : null;
  const hostPlusOnes = hostGuest ? guestPlusCount(hostGuest) : 0;

  return `
    <div class="modal-backdrop df-admin-modal-backdrop" onclick="if(event.target.classList.contains('modal-backdrop')) closeModal()">
      <div class="modal df-admin-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "Edit Party or Group" : "Create Party or Group"}" tabindex="-1">
        <button class="df-modal-close" type="button" onclick="closeModal()" aria-label="Close party form" title="Close">&times;</button>
        <h2>${isEdit ? "Edit Party / Group" : "Create Party / Group"}</h2>
        <p class="subtle">Service Date: <strong>${esc(state.activeDate)}</strong></p>

        <form onsubmit="${isEdit ? "updateGroup(event)" : "createGroup(event)"}" class="form two df-admin-form">
          <div>
            <label for="groupName">Party / Group Name</label>
            <input id="groupName" name="name" value="${esc(group?.name || "")}" placeholder="Smith Bottle Service" />
          </div>

          <div>
            <label for="groupType">Type</label>
            <select id="groupType" name="group_type">
              ${groupTypes.map(type => `<option ${type === (group?.group_type || "Bottle Service") ? "selected" : ""}>${esc(type)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label for="groupDate">Service Date</label>
            <input id="groupDate" name="date" type="date" value="${esc(state.activeDate)}" readonly />
          </div>

          <div>
            <label for="groupHostName">Host Name</label>
            <input id="groupHostName" name="host_name" value="${esc(group?.host_name || "")}" placeholder="John Smith" />
          </div>

          <div>
            <label for="groupHostPlusOnes">Host Plus Ones</label>
            <input id="groupHostPlusOnes" name="host_plus_ones" type="number" min="0" max="${MAX_HOST_PLUS_ONES}" step="1" value="${hostPlusOnes}" oninput="updateHostPlusTotal(this,'groupHostTotalAllowed')" />
            <p class="subtle" style="margin:6px 0 0;">Additional unnamed guests allowed under the host's name.</p>
          </div>

          <div>
            <label for="groupHostTotalAllowed">Total Allowed</label>
            <input id="groupHostTotalAllowed" value="${1 + hostPlusOnes}" readonly />
          </div>

          <div>
            <label for="groupTableLocation">Booth / Location</label>
            <select id="groupTableLocation" name="table_location">
              <option value="" ${!(group?.table_location) ? "selected" : ""}>Select booth/location</option>
              ${group?.table_location && !boothOptions.includes(group.table_location) ? `<option selected value="${esc(group.table_location)}">${esc(group.table_location)}</option>` : ""}
              ${boothOptions.map(booth => `<option value="${esc(booth)}" ${booth === (group?.table_location || "") ? "selected" : ""}>${esc(booth)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label for="groupApprovedBy">Approved By</label>
            <input id="groupApprovedBy" name="approved_by" value="${esc(group?.approved_by || "Management")}" />
          </div>

          <div>
            <label for="groupStatus">Status</label>
            <select id="groupStatus" name="status">
              ${["Active","Draft","Closed"].map(status => `<option ${status === (group?.status || "Active") ? "selected" : ""}>${status}</option>`).join("")}
            </select>
          </div>

          <div style="grid-column:1/-1;">
            <label for="groupNotes">Notes</label>
            <textarea id="groupNotes" name="notes" rows="3">${esc(group?.notes || "")}</textarea>
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
  const existingGuest = state.editingGuestId ? state.guests.find(item => item.id === state.editingGuestId) : null;
  const isEdit = Boolean(existingGuest);
  const guest = isEdit ? normalizeGuest(existingGuest) : emptyGuestForm();

  return `
    <div class="modal-backdrop df-admin-modal-backdrop" onclick="if(event.target.classList.contains('modal-backdrop')) closeModal()">
      <div class="modal df-admin-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "Edit guest name" : "Add guest name"}" tabindex="-1">
        <button class="df-modal-close" type="button" onclick="closeModal()" aria-label="Close guest form" title="Close">&times;</button>
        <h2>${isEdit ? "Edit Name" : "Add Name"}</h2>
        <p class="subtle">${isEdit ? "Editing this name on" : "Adding to"}: <strong>${esc(state.activeDate)}</strong></p>

        <form onsubmit="${isEdit ? "updateGuest(event)" : "createGuest(event)"}" class="form two df-admin-form">
          ${!isEdit ? `
            <div style="grid-column:1/-1;">
              <label for="guestTarget">Add To</label>
              <select id="guestTarget" name="target">
                <option value="general">General Guest List / Individual Guest</option>
                ${specificGroups().map(item => `<option value="group:${item.id}">${esc(item.name)}${item.host_name ? ` — ${esc(item.host_name)}` : ""}</option>`).join("")}
              </select>
            </div>
          ` : ""}

          <div>
            <label for="guestFirstName">First Name</label>
            <input id="guestFirstName" name="first_name" value="${esc(guest?.first_name || "")}" />
          </div>

          <div>
            <label for="guestLastName">Last Name</label>
            <input id="guestLastName" name="last_name" value="${esc(guest?.last_name || "")}" />
          </div>

          <div>
            <label for="guestType">Guest Type</label>
            <select id="guestType" name="guest_type">
              ${guestTypes.map(type => `<option ${type === (guest?.guest_type || "Guest") ? "selected" : ""}>${esc(type)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label for="guestTotalAllowed">Total Allowed / Party Size</label>
            <input id="guestTotalAllowed" name="total_allowed" type="number" min="1" value="${guestTotal(guest || { total_allowed:1 })}" />
          </div>

          ${!isEdit ? `
            <div>
              <label style="display:flex;align-items:center;gap:8px;margin-top:30px;">
                <input id="guestAlreadyCheckedIn" style="width:auto;" type="checkbox" name="checked_in" />
                Already checked in
              </label>
            </div>
          ` : `<div></div>`}

          <div style="grid-column:1/-1;">
            <label for="guestNotes">Notes</label>
            <textarea id="guestNotes" name="notes" rows="3">${esc(guest?.notes || "")}</textarea>
          </div>

          <div style="grid-column:1/-1;" class="card tight">
            <div class="name-line" style="margin-bottom:10px;">
              <input id="guestLateAdd" type="checkbox" name="is_late_add" ${guest && isLateAdd(guest) ? "checked" : ""} style="width:auto;" />
              <label for="guestLateAdd" style="margin:0;">Late Add / Manager Approved Entry</label>
            </div>

            <div class="two">
              <div>
                <label for="guestLateAddApprovedBy">Approved By</label>
                <input id="guestLateAddApprovedBy" name="late_add_approved_by" placeholder="Manager name" value="${esc(guest?.late_add_approved_by || "")}" />
              </div>
              <div>
                <label for="guestLateAddReason">Reason / Approval Note</label>
                <input id="guestLateAddReason" name="late_add_reason" placeholder="Example: Late VIP approval" value="${esc(guest?.late_add_reason || "")}" />
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

function renderPlusOnesModal() {
  const guest = state.editingPlusGuestId ? state.guests.find(item => item.id === state.editingPlusGuestId) : null;

  if (!guest) {
    return `
      <div class="modal-backdrop df-admin-modal-backdrop" onclick="if(event.target.classList.contains('modal-backdrop')) closeModal()">
        <div class="modal df-admin-modal" role="dialog" aria-modal="true" aria-label="Adjust Plus Ones" tabindex="-1">
          <button class="df-modal-close" type="button" onclick="closeModal()" aria-label="Close plus ones form" title="Close">&times;</button>
          <h2>Adjust Plus Ones</h2>
          <div class="notice redbox">DoorFlow could not find that guest on the selected service date. Tap Refresh Data, then try again.</div>
          <div class="row-actions">
            <button class="btn secondary" type="button" onclick="closeModal()">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  const group = state.groups.find(item => item.id === guest.group_id);
  const currentPlus = guestPlusCount(guest);
  const checked = guestChecked(guest);
  const busy = isActionBusy(`plus:${guest.id}`);

  return `
    <div class="modal-backdrop df-admin-modal-backdrop" onclick="if(event.target.classList.contains('modal-backdrop')) closeModal()">
      <div class="modal df-admin-modal" role="dialog" aria-modal="true" aria-label="Adjust Plus Ones" tabindex="-1">
        <button class="df-modal-close" type="button" onclick="closeModal()" aria-label="Close plus ones form" title="Close">&times;</button>
        <h2>Adjust Plus Ones</h2>
        <p class="subtle">Service Date: <strong>${esc(state.activeDate)}</strong>${group ? ` &bull; ${esc(group.name)}` : ""}</p>

        <div class="notice greenbox">
          This updates the allowed plus-one count on the existing host record only. No unnamed guest rows will be created.
        </div>

        <form onsubmit="savePlusOnes(event)" class="form two df-admin-form">
          <div style="grid-column:1/-1;">
            <label for="plusHostName">Host Name</label>
            <input id="plusHostName" value="${esc(guestBaseName(guest))}" readonly />
          </div>

          <div>
            <label for="plusCurrentCount">Current Plus Ones</label>
            <input id="plusCurrentCount" value="+${currentPlus}" readonly />
          </div>

          <div>
            <label for="plusCurrentChecked">Current Checked In</label>
            <input id="plusCurrentChecked" value="${checked} / ${guestTotal(guest)}" readonly />
          </div>

          <div>
            <label for="plusNewCount">New Plus Ones</label>
            <input id="plusNewCount" name="plus_count" type="number" min="0" max="20" step="1" value="${currentPlus}" required />
          </div>

          <div>
            <label for="plusApprovedBy">Approved By</label>
            <input id="plusApprovedBy" name="approved_by" value="${esc(currentUser()?.name || "")}" placeholder="Manager name" required />
          </div>

          <div style="grid-column:1/-1;">
            <label for="plusReason">Notes / Reason</label>
            <textarea id="plusReason" name="reason" rows="3" placeholder="Example: Host approved two additional guests"></textarea>
          </div>

          <div style="grid-column:1/-1;" class="row-actions">
            <button class="btn" type="submit" ${busy ? "disabled" : ""}>${busy ? "Saving..." : "Save Plus Ones"}</button>
            <button class="btn secondary" type="button" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderBulkModal() {
  return `
    <div class="modal-backdrop df-admin-modal-backdrop" onclick="if(event.target.classList.contains('modal-backdrop')) closeModal()">
      <div class="modal df-admin-modal" role="dialog" aria-modal="true" aria-label="Bulk Paste Names" tabindex="-1">
        <button class="df-modal-close" type="button" onclick="closeModal()" aria-label="Close bulk paste form" title="Close">&times;</button>
        <h2>Bulk Paste Names</h2>
        <p class="subtle">Adding to: <strong>${esc(state.activeDate)}</strong>. Paste one name per line. Supports plus counts like Sarah Johnson +2.</p>

        <div class="notice warn">
          <strong>Examples:</strong><br>
          John Smith<br>
          Sarah Johnson +2<br>
          David Miller - VIP - Owner approved
        </div>

        <form onsubmit="bulkAddNames(event)" class="form df-admin-form">
          <div class="form two">
            <div>
              <label for="bulkTarget">Add To</label>
              <select id="bulkTarget" name="target">
                <option value="general">General Guest List / Individual Guest</option>
                ${specificGroups().map(item => `<option value="group:${item.id}">${esc(item.name)}${item.host_name ? ` — ${esc(item.host_name)}` : ""}</option>`).join("")}
              </select>
            </div>

            <div>
              <label for="bulkDefaultType">Default Guest Type</label>
              <select id="bulkDefaultType" name="defaultType">
                ${guestTypes.map(type => `<option ${type === "Guest" ? "selected" : ""}>${esc(type)}</option>`).join("")}
              </select>
            </div>
          </div>

          <div>
            <label for="bulkNames">Paste Names</label>
            <textarea id="bulkNames" name="bulkNames" rows="12" placeholder="John Smith&#10;Sarah Johnson +2&#10;David Miller - VIP - Owner approved"></textarea>
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
  const note = normalizeShiftNote((state.shiftNotes || []).find(item => item.id === state.editingShiftNoteId));

  if (!note.id) {
    return "";
  }

  return `
    <div class="modal-backdrop df-admin-modal-backdrop">
      <div class="modal df-admin-modal" role="dialog" aria-modal="true" aria-label="Edit Shift Note" tabindex="-1">
        <button class="df-modal-close" type="button" onclick="closeModal()" aria-label="Close shift note form" title="Close">&times;</button>
        <h2>Edit Shift Note</h2>
        <p class="subtle">Update the category, priority, or note text for this service day.</p>

        <form onsubmit="updateShiftNote(event)" class="form df-admin-form">
          <div class="two">
            <div>
              <label for="shiftNoteEditCategory">Category</label>
              <select id="shiftNoteEditCategory" name="category">
                ${noteCategories.map(item => `<option ${item === note.category ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </div>

            <div>
              <label for="shiftNoteEditPriority">Priority</label>
              <select id="shiftNoteEditPriority" name="priority">
                ${notePriorities.map(item => `<option ${item === note.priority ? "selected" : ""}>${esc(item)}</option>`).join("")}
              </select>
            </div>
          </div>

          <div>
            <label for="shiftNoteEditText">Note</label>
            <textarea id="shiftNoteEditText" name="note_text" rows="6">${esc(note.note_text || "")}</textarea>
            ${renderEmojiKeyboard("shiftNoteEditText")}
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
  if (state.modal === "plusOnes") return renderPlusOnesModal();
  if (state.modal === "bulk") return renderBulkModal();
  if (state.modal === "shiftNote") return renderShiftNoteModal();
  if (state.modal === "closeoutReport") return renderCloseOutReportModal();
  return "";
}

function renderApp() {
  let content = "";

  if (state.view === "door") content = `<div class="stack df-door-checkin-view">${renderShiftNotesForDoorStaff()}${renderMainWorkspace(false)}</div>`;
  if (state.view === "tabletDoor") content = renderTabletDoorMode();
  if (state.view === "manage") content = renderManagement();
  if (state.view === "users") content = renderStaffManagement();
  if (state.view === "reports") content = renderReports();

  const isLiveServiceView = state.view === "door" || state.view === "tabletDoor";
  const sidebarClass = state.shellNavOpen ? "df-sidebar is-open" : "df-sidebar";
  const drawerInert = !state.shellNavOpen && shellUsesDrawer() ? ` inert` : "";

  return `
    <a class="df-skip-link" href="#main-content">Skip to main content</a>
    <div class="df-app-shell ${isLiveServiceView ? "df-shell-live" : "df-shell-admin"}">
      <aside id="df-primary-sidebar" class="${sidebarClass}" aria-label="DoorFlow navigation"${drawerInert}>
        <div class="df-sidebar-header">${renderDoorFlowLockup()}</div>
        ${renderTabs()}
        <p class="df-sidebar-note">${isLiveServiceView ? "Low-light live-service workspace" : "Operational navigation"}</p>
      </aside>

      <button id="df-nav-backdrop" class="df-nav-backdrop" type="button" aria-label="Close navigation menu" onclick="closeShellNav(true)" ${state.shellNavOpen ? "" : "hidden"}></button>

      <div class="df-shell-content">
        ${renderTopbar()}
        <main id="main-content" class="df-main-content ${isLiveServiceView ? "df-live-service-content df-door-theme" : "df-admin-theme"}" tabindex="-1">
          <div class="page${isLiveServiceView ? " df-door-page" : ""}">
            ${state.error ? `<div class="notice redbox df-admin-state-inline${isLiveServiceView ? " df-door-system-state df-door-system-state--error" : ""}" role="alert"><strong>Error:</strong> ${esc(state.error)}</div>` : ""}
            ${isLiveServiceView && state.loading ? `<div class="notice df-door-system-state df-door-system-state--loading" role="status"><strong>Syncing DoorFlow data</strong><span>Refreshing the active service day.</span></div>` : ""}
            <div class="notice greenbox df-admin-state-inline${isLiveServiceView ? " df-door-system-state df-door-system-state--live" : ""}" role="status"><strong>Live database mode:</strong> guests and check-ins are stored in Supabase and sync across devices.</div>
            ${content}
          </div>
        </main>
      </div>
    </div>
    <div class="df-shell-modal-scope">${renderModal()}</div>
  `;
}

Object.assign(window, {
  login,
  logout,
  toggleShellNav,
  closeShellNav,
  shellNavigate,
  switchView,
  setActiveDay,
  setActiveDate,
  useTodayDate,
  selectGroup,
  setMode,
  setSortMode,
  selectTabletList,
  updateMainSearch,
  updateGroupSearch,
  updateTabletSearch,
  clearMainSearch,
  clearTabletSearchFilter,
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
  mobileAddShiftNote,
  savePlusOnes,
  updateHostPlusTotal,
  insertEmojiIntoField,
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
  openPlusOnesModal,
  openMobilePlusOnesModal,
  openMobileGroupEditModal,
  openBulkPasteModal,
  closeModal,
  render,
  isLateAdd
});

document.addEventListener("keydown", handleModalKeydown);
document.addEventListener("keydown", handleShellKeydown);
window.matchMedia("(min-width: 1081px)").addEventListener("change", () => closeShellNav(false));

render();
initAuth();
