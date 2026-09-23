import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fixtureConfig, bindFixtureHtml } from "../scripts/p8-2b-config-fixture.mjs";
import { disposeBrowser, observeExit } from "../scripts/p8-2a-browser-resources.mjs";

const AUTH_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const APP_DIRECTORY = dirname(AUTH_DIRECTORY);
const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
const BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".webmanifest", "application/manifest+json; charset=utf-8"]
]);

const FILES = new Map([
  ["/auth/", "index.html"],
  ["/auth/index.html", "index.html"],
  ["/auth/accept-invite.css", "accept-invite.css"],
  ["/auth/accept-invite.js", "accept-invite.js"],
  ["/auth/invite-acceptance-core.mjs", "invite-acceptance-core.mjs"]
]);

const APP_FILES = new Map([
  ["/public-config.js", "public-config.js"],
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/sw.js", "sw.js"],
  ["/doorflow-operational-theme.css", "doorflow-operational-theme.css"],
  ["/manifest.webmanifest", "manifest.webmanifest"],
  ["/branding/bob-logo.png", "branding/bob-logo.png"],
  ["/branding/bob-logo-dark.png", "branding/bob-logo-dark.png"],
  ["/branding/bob-icon-192.png", "branding/bob-icon-192.png"],
  ["/branding/bob-icon-512.png", "branding/bob-icon-512.png"],
  ["/branding/bob-icon-maskable-512.png", "branding/bob-icon-maskable-512.png"]
]);

function debugStage(stage) {
  if (process.env.DOORFLOW_BROWSER_TEST_DEBUG === "1") {
    process.stderr.write(`[acceptance-browser] ${stage}\n`);
  }
}

const FAKE_SDK_MODULE = `
export function createClient(_url, _key, options) {
  const invitedIdentity = {
    id: "fictional-invite-user",
    email: "invitee@example.test",
    invited_at: "2026-09-18T12:00:00Z"
  };
  const probe = window.__doorflowAcceptanceProbe = {
    getUserCalls: 0,
    updateUserCalls: 0,
    signOutCalls: 0,
    disposeCalls: 0,
    stopAutoRefreshCalls: 0,
    boundedFetchInstalled: typeof options?.global?.fetch === "function",
    persistentSessionEnabled: options?.auth?.persistSession !== false,
    reusedWindowStorage: options?.auth?.storage === window.localStorage,
    isolatedStorageClearedBeforeSignOut: false
  };
  options.auth.storage.setItem("fictional-invite-session", "retained-only-in-memory");

  return {
    auth: {
      async setSession() {
        return {
          data: {
            session: {
              access_token: "fictional-retained-session",
              user: { id: invitedIdentity.id, email: invitedIdentity.email }
            }
          },
          error: null
        };
      },
      async getUser() {
        probe.getUserCalls += 1;
        if (probe.getUserCalls === 1) {
          return { data: { user: invitedIdentity }, error: null };
        }
        return {
          data: {
            user: {
              id: "fictional-existing-admin",
              email: "admin@example.test",
              invited_at: "2026-09-18T11:00:00Z"
            }
          },
          error: null
        };
      },
      async updateUser() {
        probe.updateUserCalls += 1;
        return { data: { user: invitedIdentity }, error: null };
      },
      async signOut() {
        probe.signOutCalls += 1;
        probe.isolatedStorageClearedBeforeSignOut = options.auth.storage.getItem("fictional-invite-session") === null;
        return { error: null };
      },
      stopAutoRefresh() {
        probe.stopAutoRefreshCalls += 1;
      },
      async dispose() {
        probe.disposeCalls += 1;
      }
    }
  };
}
`;

async function availableBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the explicit local candidates.
    }
  }
  return "";
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function waitForDevTools(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("Browser debugging endpoint did not start.")), 10000);
    const finish = value => {
      clearTimeout(timer);
      resolve(value);
    };

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      stderr = `${stderr}${chunk}`.slice(-8192);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(match[1]);
    });
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`Browser exited before debugging started (${code}).`));
    });
  });
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(reject, new Error("Browser debugging connection timed out.")), 10000);
      const finish = (complete, value) => {
        clearTimeout(timer);
        this.socket.removeEventListener("open", onOpen);
        this.socket.removeEventListener("error", onError);
        this.socket.removeEventListener("close", onClose);
        complete(value);
      };
      const onOpen = () => finish(resolve);
      const onError = event => finish(reject, event?.error || new Error("Browser debugging connection failed."));
      const onClose = () => finish(reject, new Error("Browser debugging connection closed before opening."));
      this.socket.addEventListener("open", onOpen, { once: true });
      this.socket.addEventListener("error", onError, { once: true });
      this.socket.addEventListener("close", onClose, { once: true });
    });
    this.socket.addEventListener("message", event => this.#receive(event.data));
  }

  #receive(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
      return;
    }

    const key = `${message.sessionId || "browser"}:${message.method}`;
    for (const handler of this.handlers.get(key) || []) handler(message.params || {});
  }

  on(sessionId, method, handler) {
    const key = `${sessionId || "browser"}:${method}`;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key).add(handler);
    return () => this.handlers.get(key)?.delete(handler);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out sending ${method}.`));
      }, 10000);
      this.pending.set(id, {
        resolve:value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject:error => {
          clearTimeout(timer);
          reject(error);
        },
        timer
      });
      try {
        this.socket.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  waitFor(sessionId, method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      const unsubscribe = this.on(sessionId, method, params => {
        clearTimeout(timer);
        unsubscribe();
        resolve(params);
      });
    });
  }

  close() {
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    this.socket?.close();
  }
}

async function evaluate(cdp, sessionId, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Browser evaluation failed.");
  }
  return response.result?.value;
}

async function waitForCondition(cdp, sessionId, expression, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}

test("isolated browser flow blocks identity drift before password mutation", async t => {
  const browserPath = await availableBrowser();
  if (!browserPath) {
    t.skip("Chrome or Edge is required for the local browser acceptance test.");
    return;
  }

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const config = await fixtureConfig(`http://127.0.0.1:${server.address().port}`);
    if (pathname === "/api/doorflow-public-config.json") {
      response.writeHead(200, {"Cache-Control":"no-store", "Content-Type":"application/json"});
      response.end(JSON.stringify(config)); return;
    }
    const authFilename = FILES.get(pathname);
    const appFilename = APP_FILES.get(pathname);
    const filename = authFilename || appFilename;
    if (!filename) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end("Not found");
      return;
    }

    try {
      const body = await readFile(join(authFilename ? AUTH_DIRECTORY : APP_DIRECTORY, filename));
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": CONTENT_TYPES.get(extname(filename)) || "application/octet-stream",
        "Referrer-Policy": "no-referrer"
      });
      response.end(filename.endsWith(".html") ? bindFixtureHtml(body.toString(), config) : body);
    } catch {
      response.writeHead(500, { "Cache-Control": "no-store" });
      response.end("Unavailable");
    }
  });

  const address = await listen(server);
  const profileDirectory = await mkdtemp(join(tmpdir(), "doorflow-acceptance-browser-"));
  const child = spawn(browserPath, [
    "--headless",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-gpu",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-default-browser-check",
    "--no-first-run",
    "--remote-allow-origins=*",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    "about:blank"
  ], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  });
  const exited = observeExit(child);
  child.once("exit", (code, signal) => debugStage(`browser exited (${code ?? "none"}/${signal || "none"})`));

  let cdp;
  let debugPort;
  let testTargetId;
  let testSessionId;
  try {
    debugStage("waiting for browser endpoint");
    const endpoint = await waitForDevTools(child);
    debugPort = Number(new URL(endpoint).port);
    debugStage("connecting to browser endpoint");
    cdp = new CdpConnection(endpoint);
    await cdp.connect();
    debugStage("creating target");

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    testTargetId = targetId;
    const attached = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const sessionId = attached.sessionId;
    testSessionId = sessionId;
    const productionRequests = [];
    const interceptionErrors = [];
    let sdkInterceptions = 0;

    cdp.on(sessionId, "Network.requestWillBeSent", params => {
      if (/\.supabase\.co(?:\/|$)/i.test(params.request?.url || "")) {
        productionRequests.push(params.request.url);
      }
    });
    cdp.on(sessionId, "Fetch.requestPaused", params => {
      const requestUrl = params.request?.url || "";
      const isAcceptanceSdk = requestUrl === SDK_URL;
      const isReviewedCdn = /^https:\/\/(?:cdn\.jsdelivr\.net|cdn\.sheetjs\.com)\//i.test(requestUrl);
      const action = isReviewedCdn
        ? cdp.send("Fetch.fulfillRequest", {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Access-Control-Allow-Origin", value: "*" },
            { name: "Cache-Control", value: "no-store" },
            { name: "Content-Type", value: "text/javascript; charset=utf-8" }
          ],
          body: Buffer.from(isAcceptanceSdk ? FAKE_SDK_MODULE : "").toString("base64")
        }, sessionId)
        : cdp.send("Fetch.continueRequest", { requestId: params.requestId }, sessionId);
      if (isAcceptanceSdk) sdkInterceptions += 1;
      action.catch(error => interceptionErrors.push(error.message));
    });

    await Promise.all([
      cdp.send("Page.enable", {}, sessionId),
      cdp.send("Runtime.enable", {}, sessionId),
      cdp.send("Network.enable", {}, sessionId),
      cdp.send("Network.setBlockedURLs", {
        urls: ["https://*.supabase.co/*", "https://cdn.sheetjs.com/*"]
      }, sessionId),
      cdp.send("Fetch.enable", {
        patterns: [{ urlPattern: "https://cdn.jsdelivr.net/*", requestStage: "Request" }]
      }, sessionId)
    ]);
    debugStage("interception enabled");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.localStorage.setItem("doorflow-browser-admin", "existing-admin-session-sentinel");
        window.__doorflowBrowserErrors = [];
        window.addEventListener("error", event => window.__doorflowBrowserErrors.push(String(event.message)));
        window.addEventListener("unhandledrejection", () => window.__doorflowBrowserErrors.push("unhandled rejection"));
      `
    }, sessionId);

    const appOrigin = `http://127.0.0.1:${address.port}`;
    let loaded = cdp.waitFor(sessionId, "Page.loadEventFired");
    await cdp.send("Page.navigate", { url: `${appOrigin}/` }, sessionId);
    await loaded;
    await waitForCondition(cdp, sessionId, "Boolean(navigator.serviceWorker.controller)");

    loaded = cdp.waitFor(sessionId, "Page.loadEventFired");
    await cdp.send("Page.navigate", { url: `${appOrigin}/?view=door#ordinary-section` }, sessionId);
    await loaded;
    assert.equal(
      await evaluate(cdp, sessionId, "window.location.href"),
      `${appOrigin}/?view=door#ordinary-section`,
      "ordinary root query and fragment state must remain intact"
    );

    loaded = cdp.waitFor(sessionId, "Page.loadEventFired");
    await cdp.send("Page.navigate", {
      url: `${appOrigin}/?token_hash=fictional-token-hash&type=invite#access_token=fictional-root-access&refresh_token=fictional-root-refresh`
    }, sessionId);
    await loaded;
    assert.equal(
      await evaluate(cdp, sessionId, "window.location.href"),
      `${appOrigin}/`,
      "misrouted root invitation credentials must be removed before app startup"
    );

    loaded = cdp.waitFor(sessionId, "Page.loadEventFired");
    await cdp.send("Page.navigate", {
      url: `${appOrigin}/?error=access_denied&error_code=otp_expired&error_description=fictional-sensitive-detail&type=invite`
    }, sessionId);
    await loaded;
    assert.equal(
      await evaluate(cdp, sessionId, "window.location.href"),
      `${appOrigin}/`,
      "misrouted provider error details must be removed even without a token"
    );

    const cacheState = await evaluate(cdp, sessionId, `(async () => {
      const result = {};
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        result[name] = (await cache.keys()).map(request => request.url);
      }
      return result;
    })()`);
    assert.ok(Array.isArray(cacheState["doorflow-cache-v31"]));
    assert.ok(cacheState["doorflow-cache-v31"].some(url => url.includes("?view=door")));
    assert.equal(
      Object.values(cacheState).flat().some(url => /(?:access_token|refresh_token|token_hash|error_description|[?&]type=invite)/i.test(url)),
      false,
      "credential and provider-error URLs must never enter CacheStorage"
    );
    debugStage("root credential scrub and service-worker cache isolation verified");

    loaded = cdp.waitFor(sessionId, "Page.loadEventFired");
    const invitationUrl = `http://127.0.0.1:${address.port}/auth/#access_token=fictional-access&refresh_token=fictional-refresh&type=invite`;
    await cdp.send("Page.navigate", { url: invitationUrl }, sessionId);
    await loaded;
    debugStage("page loaded");
    await waitForCondition(
      cdp,
      sessionId,
      `Boolean(window.__doorflowAcceptanceProbe) && !document.getElementById("password-form").hidden`
    );

    const ready = await evaluate(cdp, sessionId, `({
      href: window.location.href,
      adminSentinel: window.localStorage.getItem("doorflow-browser-admin"),
      probe: window.__doorflowAcceptanceProbe,
      accountSummary: document.getElementById("account-summary").textContent
    })`);
    assert.equal(ready.href, `http://127.0.0.1:${address.port}/auth/`);
    assert.equal(ready.adminSentinel, "existing-admin-session-sentinel");
    assert.equal(ready.probe.getUserCalls, 1);
    assert.equal(ready.probe.boundedFetchInstalled, true);
    assert.equal(ready.probe.persistentSessionEnabled, false);
    assert.equal(ready.probe.reusedWindowStorage, false);
    assert.match(ready.accountSummary, /invitee@example\.test/);
    debugStage("verified invitation session");

    await evaluate(cdp, sessionId, `(() => {
      const ephemeralPassword = crypto.randomUUID() + "Aa1!";
      document.getElementById("new-password").value = ephemeralPassword;
      document.getElementById("confirm-password").value = ephemeralPassword;
      document.getElementById("password-form").requestSubmit();
    })()`);
    await waitForCondition(
      cdp,
      sessionId,
      `window.__doorflowAcceptanceProbe.signOutCalls === 1`
    );
    debugStage("identity drift blocked");

    const finalState = await evaluate(cdp, sessionId, `({
      adminSentinel: window.localStorage.getItem("doorflow-browser-admin"),
      errors: window.__doorflowBrowserErrors,
      probe: window.__doorflowAcceptanceProbe,
      statusTitle: document.getElementById("status-title").textContent,
      formHidden: document.getElementById("password-form").hidden,
      successHidden: document.getElementById("success-panel").hidden,
      passwordLength: document.getElementById("new-password").value.length,
      confirmationLength: document.getElementById("confirm-password").value.length
    })`);
    assert.equal(finalState.probe.getUserCalls, 2);
    assert.equal(finalState.probe.updateUserCalls, 0);
    assert.equal(finalState.probe.stopAutoRefreshCalls, 1);
    assert.equal(finalState.probe.disposeCalls, 1);
    assert.equal(finalState.probe.isolatedStorageClearedBeforeSignOut, true);
    assert.equal(finalState.adminSentinel, "existing-admin-session-sentinel");
    assert.equal(finalState.statusTitle, "Invitation identity could not be verified");
    assert.equal(finalState.formHidden, true);
    assert.equal(finalState.successHidden, true);
    assert.equal(finalState.passwordLength, 0);
    assert.equal(finalState.confirmationLength, 0);
    assert.deepEqual(finalState.errors, []);
    assert.equal(sdkInterceptions, 1);
    assert.deepEqual(interceptionErrors, []);
    assert.deepEqual(productionRequests, []);
    debugStage("assertions complete");
  } finally {
    debugStage("cleanup start");
    const cleanup = await disposeBrowser({ child, exited, cdp, server, profileDirectory, debugPort, targetId:testTargetId, sessionId:testSessionId });
    console.log(JSON.stringify({ cleanup }));
  }
});
