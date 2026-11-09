// Test resources only. Never imported by the application.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, lstat, mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function bounded(promise, label, timeout = 10000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout);
  })]).finally(() => clearTimeout(timer));
}

export function observeExit(child) {
  // Subscribe immediately after spawn; cleanup must not miss an earlier exit.
  const result = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    // Windows Chromium may hand off to a child browser that retains stderr.
    // `close` waits for those inherited pipes; `exit` is the process lifetime.
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  // Mark handled until the finally block awaits it, without converting failure.
  result.catch(() => {});
  return result;
}

async function stopExactOwnedProfile(profileDirectory) {
  if (process.platform !== "win32") return { terminated:0 };
  const target = resolve(profileDirectory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(target.slice(dirname(target).length + 1), /^doorflow-(?:acceptance|context)-browser-[A-Za-z0-9]+$/);
  // No user profile, executable-name-wide kill, or unvalidated PID is accepted.
  // The path is passed as environment data, never interpolated into shell code.
  const script = `
$ErrorActionPreference='Stop'
$fixtureDirectory=[IO.Path]::GetFullPath($env:DOORFLOW_OWNED_TEST_PROFILE).TrimEnd('\\')
function OwnedFixture($process) {
  $argument=[regex]::Match([string]$process.CommandLine,'--user-data-dir=(?:"([^\"]+)"|([^\\s\"]+))')
  if(-not $argument.Success){return $false}
  $directory=if($argument.Groups[1].Success){$argument.Groups[1].Value}else{$argument.Groups[2].Value}
  return [string]::Equals([IO.Path]::GetFullPath($directory).TrimEnd('\\'),$fixtureDirectory,[StringComparison]::OrdinalIgnoreCase)
}
$targets=@(Get-CimInstance Win32_Process -Filter "name='chrome.exe' OR name='msedge.exe'" | Where-Object { OwnedFixture $_ })
foreach($target in $targets){
  $current=Get-CimInstance Win32_Process -Filter "ProcessId=$($target.ProcessId)"
  if($current -and (OwnedFixture $current)){Stop-Process -Id $current.ProcessId -Force -ErrorAction SilentlyContinue; Wait-Process -Id $current.ProcessId -Timeout 3 -ErrorAction SilentlyContinue}
}
$remaining=@(Get-CimInstance Win32_Process -Filter "name='chrome.exe' OR name='msedge.exe'" | Where-Object { OwnedFixture $_ })
if($remaining.Count){throw 'Exact owned browser profile did not terminate'}
@{terminated=$targets.Count}|ConvertTo-Json -Compress
`;
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide:true, timeout:10000, maxBuffer:8192,
    env:{ ...process.env, DOORFLOW_OWNED_TEST_PROFILE:target }
  });
  return JSON.parse(stdout.trim());
}

async function assertPortClosed(port) {
  await bounded(new Promise((resolveClosed, reject) => {
    const socket = connect({ host:"127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); reject(new Error("Owned test listener still open")); });
    socket.once("error", error => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolveClosed();
      else reject(error);
    });
  }), "Listener release", 2000);
}

export async function disposeBrowser({ child, exited, cdp, server, profileDirectory, debugPort, targetId, sessionId }) {
  const errors = [];
  let nativeExit;
  let forcedTermination = false;
  try {
    // CDP can refer to the handed-off child after the original Windows launcher
    // exits. Always close that connection's browser, not just a live launcher.
    if (cdp) {
      if (targetId) {
        try {
        // This browser/profile and exact loopback origin belong solely to the
        // test. Release its worker/page before asking Edge to exit; a live
        // acceptance cache worker must not retain the temporary profile.
        const address = server.address();
        assert(address && address.address === "127.0.0.1");
        await bounded(cdp.send("Storage.clearDataForOrigin", {
          origin:`http://127.0.0.1:${address.port}`, storageTypes:"service_workers"
        }, sessionId), "Owned worker release", 5000);
        const closed = await bounded(cdp.send("Target.closeTarget", { targetId }), "Owned page close", 5000);
        assert.equal(closed.success, true, "Owned page must close");
        } catch (error) { errors.push(error); }
      }
      // Browser.close can close the connection before acknowledging the command.
      // Only a subsequently observed process exit can establish successful close.
      const closeRequest = cdp.send("Browser.close");
      closeRequest.catch(() => {});
      await bounded(Promise.race([closeRequest, exited]), "Browser close", 5000)
        .catch(error => { errors.push(error); });
    }
    try { nativeExit = await bounded(exited, "Owned browser exit", 7000); }
    catch {
      forcedTermination = true;
      if (process.platform === "win32") await stopExactOwnedProfile(profileDirectory);
      else if (child.exitCode === null && child.signalCode === null) child.kill();
      nativeExit = await bounded(exited, "Owned browser termination", 3000);
    }
    if (nativeExit.code !== 0 || nativeExit.signal) errors.push(new Error("Owned browser did not exit normally"));
  } catch (error) { errors.push(error); }
  finally { try { cdp?.close(); } catch (error) { errors.push(error); } }
  // Also clean a launcher handoff or a failed startup. This exact-profile check
  // proves no fixture descendants survive before its directory is removed.
  try {
    const cleanup = await stopExactOwnedProfile(profileDirectory);
    forcedTermination ||= cleanup.terminated > 0;
  } catch (error) { errors.push(error); }
  try {
    const address = server.address();
    server.closeAllConnections?.();
    await bounded(new Promise((resolveClosed, reject) => {
      server.close(error => error ? reject(error) : resolveClosed());
    }), "Owned HTTP server close", 3000);
    assert.equal(server.listening, false);
    if (address?.port) await assertPortClosed(address.port);
    if (debugPort) await assertPortClosed(debugPort);
  } catch (error) { errors.push(error); }
  try {
    const target = resolve(profileDirectory);
    assert.equal(dirname(target), resolve(tmpdir()), "Only this test's direct temporary child may be removed");
    assert.match(target.slice(dirname(target).length + 1), /^doorflow-(?:acceptance|context)-browser-/);
    const info = await lstat(target);
    assert(info.isDirectory() && !info.isSymbolicLink(), "Temporary profile cannot be a link");
    // Bounded filesystem retries handle Windows releasing its own profile locks.
    await bounded(rm(target, { recursive:true, force:false, maxRetries:8, retryDelay:100 }), "Owned profile removal", 8000);
    await assert.rejects(lstat(target), { code:"ENOENT" });
  } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, `Owned browser resource cleanup failed: ${errors.map(error=>error.message).join("; ")}`);
  return { processExited:true, nativeExit, forcedTermination, httpListenerClosed:true, debugListenerClosed:Boolean(debugPort), profileRemoved:true };
}

export class Cdp {
  next = 0;
  pending = new Map();
  handlers = new Map();
  async connect(url) {
    this.socket = new WebSocket(url);
    await bounded(new Promise((resolveOpen, reject) => {
      this.socket.addEventListener("open", resolveOpen, { once:true });
      this.socket.addEventListener("error", () => reject(new Error("CDP connection failed")), { once:true });
    }), "CDP connect");
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        for (const handler of this.handlers.get(`${message.sessionId || ""}:${message.method}`) || []) handler(message.params);
      }
    });
  }
  on(session, event, callback) {
    const key = `${session || ""}:${event}`;
    if (!this.handlers.has(key)) this.handlers.set(key, []);
    this.handlers.get(key).push(callback);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    return bounded(new Promise((resolveReply, reject) => {
      this.pending.set(id, { resolve:resolveReply, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    }), method).finally(() => this.pending.delete(id));
  }
  close() {
    for (const pending of this.pending.values()) pending.reject(new Error("Owned CDP connection closed"));
    this.pending.clear();
    this.socket?.close();
  }
}

export async function launchBrowser(server) {
  let browser;
  for (const candidate of ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]) {
    try { await access(candidate); browser = candidate; break; } catch { /* Explicit installed candidates only. */ }
  }
  assert(browser, "A prepared local browser is required; do not skip this suite");
  const profileDirectory = await mkdtemp(join(tmpdir(), "doorflow-context-browser-"));
  const child = spawn(browser, ["--headless", "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-gpu", "--disable-sync", "--metrics-recording-only", "--no-default-browser-check", "--no-first-run", "--remote-allow-origins=*", "--remote-debugging-port=0", `--user-data-dir=${profileDirectory}`, "about:blank"], { windowsHide:true, stdio:["ignore", "ignore", "pipe"] });
  const exited = observeExit(child);
  const resource = { child, exited, server, profileDirectory };
  try {
    const endpoint = await bounded(new Promise((resolveEndpoint, reject) => {
      let output = "";
      child.stderr.on("data", chunk => {
        output = (output + chunk.toString()).slice(-8192);
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
        if (match) resolveEndpoint(match[1]);
      });
      exited.then(() => reject(new Error("Browser exited before CDP initialization")), reject);
    }), "Browser endpoint");
    resource.debugPort = Number(new URL(endpoint).port);
    resource.cdp = new Cdp();
    await resource.cdp.connect(endpoint);
    return resource;
  } catch (error) {
    try { await disposeBrowser(resource); } catch (cleanup) { throw new AggregateError([error, cleanup]); }
    throw error;
  }
}

export async function evaluate(cdp, session, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise:true, returnByValue:true }, session);
  assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description || result.exceptionDetails?.text || "Browser evaluation failed");
  return result.result?.value;
}
