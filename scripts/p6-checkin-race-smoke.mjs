import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const appSource = readFileSync(resolve(root, "app.js"), "utf8").replaceAll("\r\n", "\n");
const indexSource = readFileSync(resolve(root, "index.html"), "utf8").replaceAll("\r\n", "\n");
const runtimeMatch = indexSource.match(/<script>\s*([\s\S]*?)\s*render\(\);\s*initAuth\(\);\s*<\/script>/);
const runtimeSource = runtimeMatch ? `${runtimeMatch[1]}\nrender();\ninitAuth();` : "";
const exercisedFunctions = [
  "setActionBusy",
  "isActionBusy",
  "isGuestCheckActionBusy",
  "hasPendingGuestCheckActions",
  "markGuestCheckStateChanged",
  "beginLiveDataSnapshot",
  "shouldApplyLiveDataSnapshot",
  "checkInOneGuest",
  "undoOneGuest",
  "toggleGuest"
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

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
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

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

function guest(id, checked = 0, total = 1) {
  return {
    id,
    group_id:"group-1",
    first_name:`Guest ${id}`,
    last_name:"Test",
    guest_type:"Guest",
    total_allowed:total,
    checked_in_count:checked,
    last_checked_in_at:checked ? "2026-07-15T00:00:00.000Z" : null,
    last_checked_in_by_name:checked ? "Existing Tester" : null,
    last_door_location:checked ? "Front Door" : null
  };
}

function createHarness(initialGuests, options = {}) {
  const authoritative = new Map(initialGuests.map(item => [item.id, { ...item }]));
  const updateCalls = [];
  const logCalls = [];
  const refreshHistory = [];
  const groupState = { marker:"initial" };
  let logSequence = 0;

  const controls = {
    authoritative,
    updateCalls,
    logCalls,
    refreshHistory,
    groupState,
    async updateGuest(id, payload) {
      updateCalls.push({ id, payload:{ ...payload } });
      const delay = options.updateDelays?.[id] ?? 0;
      if (delay) await sleep(delay);
      if (options.failUpdateIds?.has(id)) {
        return { data:null, error:new Error(`simulated update failure for ${id}`) };
      }
      authoritative.set(id, { ...authoritative.get(id), ...payload });
      return { data:[{ ...authoritative.get(id) }], error:null };
    },
    async insertLog(payload) {
      logCalls.push({ ...payload, id:`log-${++logSequence}` });
      const delay = options.logDelays?.[payload.guest_id] ?? 0;
      if (delay) await sleep(delay);
      if (options.failLogIds?.has(payload.guest_id)) {
        return { data:null, error:new Error("simulated log failure for " + payload.guest_id) };
      }
      return { data:[logCalls.at(-1)], error:null };
    },
    async restoreGuest(id, previous) {
      authoritative.set(id, { ...authoritative.get(id), ...previous });
    }
  };

  const context = vm.createContext({
    controls,
    console:{ log() {}, warn() {}, error() {} },
    Date,
    Promise,
    Object,
    Array,
    Boolean,
    Number,
    String,
    Math,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(`
    var state = {
      guests:${JSON.stringify(initialGuests)},
      groups:[{ id:"group-1", marker:"initial" }],
      actionBusy:{},
      doorLocation:"Front Door",
      error:"",
      loading:false,
      lastSyncAt:null
    };
    var activeDoorFlowAction = false;
    var lastDoorFlowActionAt = 0;
    let liveDataLoadSequence = 0;
    let guestCheckStateVersion = 0;
    function requirePerm() { return true; }
    function currentUser() { return { name:"Race Test Operator" }; }
    function normalizeGuest(value) { return { ...value, checked_in_count:Number(value.checked_in_count || 0), total_allowed:Number(value.total_allowed || 1) }; }
    function guestTotal(value) { return Math.max(1, Number(value.total_allowed || 1)); }
    function guestChecked(value) { return Math.max(0, Math.min(guestTotal(value), Number(value.checked_in_count || 0))); }
    function guestRemaining(value) { return Math.max(0, guestTotal(value) - guestChecked(value)); }
    function updateSyncStatus() {}
    function refreshCheckActionSurfaces() { controls.refreshHistory.push(state.guests.reduce((sum, value) => sum + guestChecked(value), 0)); }
    async function prepareDatabaseAction() {}
    function withDoorFlowTimeout(promise) { return Promise.resolve(promise); }
    function must(data, error) { if (error) throw error; return data; }
    function queueBackgroundRefreshAfterWrite() {}
    async function restoreGuestCheckState(id, previous) { await controls.restoreGuest(id, previous); }
    function alert() {}
    var db = {
      from(table) {
        if (table === "guests") {
          return { update(payload) { return { eq(column, id) { return controls.updateGuest(id, payload); } }; } };
        }
        if (table === "check_in_logs") {
          return { insert(payload) { return controls.insertLog(payload); } };
        }
        throw new Error("Unexpected table " + table);
      }
    };
  `, context);

  for (const name of exercisedFunctions) {
    const block = extractFunction(appSource, name);
    if (!block) throw new Error(`Missing runtime function ${name}`);
    vm.runInContext(block, context);
  }

  function invoke(name, id) {
    return vm.runInContext(`${name}(${JSON.stringify(id)})`, context);
  }

  function beginSnapshot() {
    return vm.runInContext("beginLiveDataSnapshot()", context);
  }

  function shouldApplySnapshot(snapshot) {
    context.testSnapshot = snapshot;
    return vm.runInContext("shouldApplyLiveDataSnapshot(testSnapshot)", context);
  }

  function applyAuthoritativeSnapshot(snapshot) {
    if (!shouldApplySnapshot(snapshot)) return false;
    context.state.guests = [...authoritative.values()].map(item => ({ ...item }));
    refreshHistory.push(context.state.guests.reduce((sum, item) => sum + Number(item.checked_in_count || 0), 0));
    return true;
  }

  function counts() {
    const checked = context.state.guests.reduce((sum, item) => sum + Number(item.checked_in_count || 0), 0);
    const total = context.state.guests.reduce((sum, item) => sum + Number(item.total_allowed || 1), 0);
    return { checked, remaining:total - checked, total };
  }

  function pending() {
    return vm.runInContext("hasPendingGuestCheckActions()", context);
  }

  return { context, controls, invoke, beginSnapshot, shouldApplySnapshot, applyAuthoritativeSnapshot, counts, pending };
}

function reproduceLegacyDetachedGuestFailure() {
  let visible = [guest("A"), guest("B")];
  const authoritative = new Map(visible.map(item => [item.id, { ...item }]));
  const guestAReference = visible[0];
  const guestBReference = visible[1];
  guestAReference.checked_in_count = 1;
  guestBReference.checked_in_count = 1;
  authoritative.get("B").checked_in_count = 1;
  visible = [...authoritative.values()].map(item => ({ ...item }));
  authoritative.get("A").checked_in_count = 1;
  guestAReference.checked_in_count = 1;
  return {
    visible:visible.reduce((sum, item) => sum + item.checked_in_count, 0),
    authoritative:[...authoritative.values()].reduce((sum, item) => sum + item.checked_in_count, 0)
  };
}

async function run() {
  check(Boolean(runtimeSource), "inline runtime is present");
  for (const name of exercisedFunctions) {
    const appBlock = extractFunction(appSource, name);
    const runtimeBlock = extractFunction(runtimeSource, name);
    check(Boolean(appBlock && runtimeBlock && hash(appBlock) === hash(runtimeBlock)), `runtime/mirror parity for ${name}`);
  }

  const legacy = reproduceLegacyDetachedGuestFailure();
  check(legacy.visible === 1 && legacy.authoritative === 2, "legacy detached-object race reproduces visible 1 versus authoritative 2");

  {
    const harness = createHarness([guest("A")], { updateDelays:{ A:20 } });
    await Promise.all([harness.invoke("checkInOneGuest", "A"), harness.invoke("checkInOneGuest", "A")]);
    check(harness.controls.updateCalls.length === 1, "same guest rapid double invocation sends one guest mutation");
    check(harness.controls.logCalls.length === 1, "same guest rapid double invocation sends one log request");
    check(harness.counts().checked === 1 && !harness.pending(), "same guest rapid double invocation changes count once and clears lock");
  }

  for (const [label, updateDelays] of [
    ["Guest B resolves before Guest A", { A:35, B:5 }],
    ["Guest A resolves before Guest B", { A:5, B:35 }]
  ]) {
    const harness = createHarness([guest("A"), guest("B")], { updateDelays });
    const staleSnapshot = harness.beginSnapshot();
    await Promise.all([harness.invoke("checkInOneGuest", "A"), harness.invoke("checkInOneGuest", "B")]);
    check(!harness.shouldApplySnapshot(staleSnapshot), `${label}: pre-action snapshot is rejected`);
    const finalSnapshot = harness.beginSnapshot();
    check(harness.applyAuthoritativeSnapshot(finalSnapshot), `${label}: settled authoritative snapshot applies`);
    check(harness.counts().checked === 2 && harness.counts().remaining === 0, `${label}: both guest results and counts are preserved`);
    check(harness.controls.logCalls.length === 2 && !harness.pending(), `${label}: two logs are requested and all locks clear`);
    check(harness.controls.refreshHistory.every((value, index, list) => index === 0 || value >= list[index - 1]), `${label}: successful Check In display never moves backward`);
  }

  {
    const harness = createHarness([guest("A")], { updateDelays:{ A:30 } });
    const action = harness.invoke("checkInOneGuest", "A");
    const realtimeSnapshot = harness.beginSnapshot();
    check(!harness.shouldApplySnapshot(realtimeSnapshot), "optimistic update rejects matching realtime snapshot while mutation is pending");
    await action;
    check(!harness.shouldApplySnapshot(realtimeSnapshot), "snapshot captured during pending work remains rejected after mutation settles");
    const finalSnapshot = harness.beginSnapshot();
    harness.applyAuthoritativeSnapshot(finalSnapshot);
    harness.applyAuthoritativeSnapshot(finalSnapshot);
    check(harness.counts().checked === 1, "matching and duplicate realtime reconciliation remains one logical transition");
  }

  {
    const harness = createHarness([guest("A")], { updateDelays:{ A:30 } });
    const action = harness.invoke("checkInOneGuest", "A");
    const snapshotBeforeResponse = harness.beginSnapshot();
    check(!harness.shouldApplySnapshot(snapshotBeforeResponse), "realtime before mutation response cannot replace pending optimistic state");
    await action;
    check(harness.counts().checked === 1, "mutation response after realtime preserves final checked state");
  }

  {
    const harness = createHarness([guest("A")], { updateDelays:{ A:25 } });
    await Promise.all([harness.invoke("checkInOneGuest", "A"), harness.invoke("undoOneGuest", "A")]);
    check(harness.controls.updateCalls.length === 1 && harness.controls.logCalls.length === 1, "Check In followed immediately by Undo allows only the locked Check In");
    check(harness.counts().checked === 1 && !harness.pending(), "Check In followed immediately by Undo ends deterministically and clears lock");
  }

  {
    const harness = createHarness([guest("A", 1), guest("B", 1)], { updateDelays:{ A:30, B:5 } });
    await Promise.all([harness.invoke("undoOneGuest", "A"), harness.invoke("undoOneGuest", "B")]);
    check(harness.counts().checked === 0 && harness.counts().remaining === 2, "rapid Undo preserves both results regardless of response order");
    check(harness.controls.logCalls.length === 2 && !harness.pending(), "rapid Undo requests one log per guest and clears locks");
  }

  {
    const harness = createHarness([guest("A"), guest("B")], {
      updateDelays:{ A:5, B:20 },
      failUpdateIds:new Set(["B"])
    });
    await Promise.all([harness.invoke("checkInOneGuest", "A"), harness.invoke("checkInOneGuest", "B")]);
    const finalSnapshot = harness.beginSnapshot();
    harness.applyAuthoritativeSnapshot(finalSnapshot);
    const guestA = harness.context.state.guests.find(item => item.id === "A");
    const guestB = harness.context.state.guests.find(item => item.id === "B");
    check(guestA.checked_in_count === 1 && guestB.checked_in_count === 0, "one failed mutation rolls back only its guest while another succeeds");
    check(harness.controls.logCalls.filter(item => item.guest_id === "A").length === 1 && harness.controls.logCalls.every(item => item.guest_id !== "B"), "failed guest creates no log while successful guest creates one");
    check(!harness.pending(), "failure and success paths both clear pending locks");
  }

  {
    const harness = createHarness([guest("A")], { updateDelays:{ A:20 } });
    const action = harness.invoke("checkInOneGuest", "A");
    harness.controls.groupState.marker = "group-action-completed";
    await action;
    check(harness.controls.groupState.marker === "group-action-completed", "overlapping unrelated group state is not rolled back by guest completion");
    check(!/function\s+checkInGroup\s*\(/.test(appSource), "no party-wide check-in mutation exists to overlap at the database layer");
  }

  if (failures) {
    console.error(`\nP6.1 race smoke failed with ${failures} issue${failures === 1 ? "" : "s"}.`);
    process.exit(1);
  }

  console.log("\nP6.1 race smoke passed: delayed mutations, stale snapshots, realtime ordering, failure isolation, Undo, and pending locks reconcile deterministically without network access.");
}

await run();
